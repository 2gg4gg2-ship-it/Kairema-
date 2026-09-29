import { EventEmitter } from "node:events";
import type { Request, Response } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";

const chatQuota = vi.hoisted(() => vi.fn());
const myApiQuota = vi.hoisted(() => vi.fn());
vi.mock("./db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./db")>()),
  consumeChatStreamRequestQuota: chatQuota,
  consumeMyApiRequestQuota: myApiQuota,
}));

import { createChatStreamHandler, resetChatStreamRateLimits } from "./chat-stream";
import { UserProviderGuestNotAllowedError, UserProviderNotConfiguredError, UserProviderError } from "./user-providers";

const sessionId = "550e8400-e29b-41d4-a716-446655440000";
const KEY = "sk-or-v1-stream-secret-4321";
const MODEL = "vendor/model-x";
const baseBody = { sessionId, modelId: "fast", content: "Привет" };

const transcriptWindow = { messages: [{ id: 1, role: "user" as const, content: "Привет", createdAt: new Date(0) }], budget: { maxContentChars: 18_000, maxCandidateMessages: 12, maxPriorTurns: 4 }, candidateCount: 1, selectedContentChars: 6, selectedPriorTurns: 0, truncated: false };

function response() {
  return Object.assign(new EventEmitter(), {
    status: vi.fn().mockReturnThis(), set: vi.fn().mockReturnThis(), flushHeaders: vi.fn(), write: vi.fn(), end: vi.fn(), json: vi.fn(),
  }) as unknown as Response;
}

function writes(res: Response) {
  return (res.write as ReturnType<typeof vi.fn>).mock.calls.map(([chunk]) => String(chunk)).join("");
}

function eventPayload(res: Response, event: string) {
  const chunk = (res.write as ReturnType<typeof vi.fn>).mock.calls.map(([value]) => String(value)).find((value) => value.includes(`event: ${event}`));
  return chunk ? JSON.parse(chunk!.match(/data: (.+)/)![1]!) : null;
}

const binding = { provider: "openrouter", model: MODEL, encryptedApiKey: "kbyok1.aXYxLnRhZw.cGF5bG9hZA", keyHint: "••••4321", updatedAt: new Date(0) };

function handlerWith(overrides: Record<string, unknown>, options: { isGuest?: boolean } = {}) {
  return createChatStreamHandler({
    // A guest reaches the handler only when no verified session resolved.
    authenticateRequest: vi.fn().mockResolvedValue(options.isGuest ? null : { id: 42 }),
    getOrCreateGuestUser: options.isGuest ? vi.fn().mockResolvedValue({ id: 77, isGuest: true }) : vi.fn().mockResolvedValue(null),
    getOwnedChatSession: vi.fn().mockResolvedValue({ id: sessionId, title: "Новый разговор" }),
    consumeChatStreamRequestQuota: chatQuota,
    consumeMyApiRequestQuota: myApiQuota,
    deleteOwnedSessionUserMessage: vi.fn().mockResolvedValue(true),
    appendChatMessage: vi.fn().mockResolvedValue({ id: 1, created: true }),
    updateChatTitle: vi.fn(),
    listSessionTranscriptWindow: vi.fn().mockResolvedValue(transcriptWindow),
    buildChatContext: vi.fn().mockResolvedValue({ style: "default" }),
    enqueueMemoryExtractionJob: vi.fn().mockResolvedValue({ created: true }),
    processMemoryExtractionJob: vi.fn().mockResolvedValue(undefined),
    chatWithRoleStream: vi.fn(),
    chatWithUserProviderStream: vi.fn(),
    getActiveUserProviderBinding: vi.fn().mockResolvedValue(binding),
    listUserProviderConfigs: vi.fn().mockResolvedValue([]),
    decryptUserProviderSecret: vi.fn().mockReturnValue(KEY),
    auditChatStream: vi.fn(),
    ...overrides,
  } as never);
}

beforeEach(() => {
  resetChatStreamRateLimits();
  chatQuota.mockReset().mockResolvedValue({ allowed: true, retryAfterSeconds: 0 });
  myApiQuota.mockReset().mockResolvedValue({ allowed: true, retryAfterSeconds: 0 });
  vi.spyOn(console, "info").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("my api execution path", () => {
  it("runs the caller's own provider and never the system role path", async () => {
    const byok = vi.fn(async (_options: { onDelta: (delta: string) => void }) => {
      _options.onDelta("Мой ");
      _options.onDelta("ответ");
      return { content: "Мой ответ", modelUsed: MODEL, provider: "openrouter", fallbackUsed: false, label: MODEL, status: { state: "ready", badge: "Готов", category: null, http: 200, checkedAt: new Date().toISOString(), confirmed: "" } };
    });
    const platform = vi.fn();
    const res = response();
    await handlerWith({ chatWithUserProviderStream: byok, chatWithRoleStream: platform })({ body: { ...baseBody, myApi: true } } as Request, res, vi.fn());
    expect(byok).toHaveBeenCalledTimes(1);
    expect(platform).not.toHaveBeenCalled();
    expect(writes(res)).toContain("event: done");
    expect(eventPayload(res, "done")).toMatchObject({ content: "Мой ответ" });
  });

  it("passes the decrypted key, the active model and the caller's id", async () => {
    const byok = vi.fn().mockResolvedValue({ content: "ok", modelUsed: MODEL, provider: "openrouter", fallbackUsed: false, label: MODEL, status: { state: "ready", badge: "", category: null, http: 200, checkedAt: "", confirmed: "" } });
    const decrypt = vi.fn().mockReturnValue(KEY);
    const getBinding = vi.fn().mockResolvedValue(binding);
    const res = response();
    await handlerWith({ chatWithUserProviderStream: byok, decryptUserProviderSecret: decrypt, getActiveUserProviderBinding: getBinding })({ body: { ...baseBody, myApi: true } } as Request, res, vi.fn());
    expect(getBinding).toHaveBeenCalledWith(42);
    expect(decrypt).toHaveBeenCalledWith(binding.encryptedApiKey);
    const options = byok.mock.calls[0]![0] as { provider: string; model: string; apiKey: string; actor: { userId: number } };
    expect(options).toMatchObject({ provider: "openrouter", model: MODEL, apiKey: KEY });
    expect(options.actor.userId).toBe(42);
  });

  it("keeps the key out of the SSE stream, the audit record and the persisted transcript", async () => {
    const audit = vi.fn();
    const append = vi.fn().mockResolvedValue({ id: 1, created: true });
    const byok = vi.fn().mockResolvedValue({ content: "ok", modelUsed: MODEL, provider: "openrouter", fallbackUsed: false, label: MODEL, status: { state: "ready", badge: "", category: null, http: 200, checkedAt: "", confirmed: "" } });
    const res = response();
    await handlerWith({ chatWithUserProviderStream: byok, appendChatMessage: append, auditChatStream: audit })({ body: { ...baseBody, myApi: true } } as Request, res, vi.fn());
    expect(writes(res)).not.toContain(KEY);
    expect(writes(res)).not.toContain("kbyok1");
    expect(JSON.stringify(audit.mock.calls)).not.toContain(KEY);
    expect(JSON.stringify(append.mock.calls)).not.toContain(KEY);
  });

  it("reports a clear error and never falls back when BYOK is not configured", async () => {
    const platform = vi.fn();
    const res = response();
    await handlerWith({ chatWithUserProviderStream: vi.fn(), chatWithRoleStream: platform, getActiveUserProviderBinding: vi.fn().mockResolvedValue(undefined) })({ body: { ...baseBody, myApi: true } } as Request, res, vi.fn());
    expect(eventPayload(res, "error")).toMatchObject({ message: expect.stringContaining("не настроен") });
    expect(platform).not.toHaveBeenCalled();
  });

  it("does not fall back to a system provider when the user's provider fails", async () => {
    const platform = vi.fn();
    const byok = vi.fn().mockRejectedValue(new UserProviderError("AUTH", "Провайдер отклонил API-ключ.", 401));
    const res = response();
    await handlerWith({ chatWithUserProviderStream: byok, chatWithRoleStream: platform })({ body: { ...baseBody, myApi: true } } as Request, res, vi.fn());
    expect(byok).toHaveBeenCalledTimes(1);
    expect(platform).not.toHaveBeenCalled();
    expect(eventPayload(res, "error")).toMatchObject({ message: expect.stringContaining("отклонил API-ключ") });
  });

  it("never puts a raw provider body into the SSE error event", async () => {
    const byok = vi.fn().mockRejectedValue(new UserProviderError("UNKNOWN", "Провайдер вернул неожиданный ответ. Повторите попытку позже."));
    const res = response();
    await handlerWith({ chatWithUserProviderStream: byok })({ body: { ...baseBody, myApi: true } } as Request, res, vi.fn());
    expect(writes(res)).not.toContain(KEY);
    expect(writes(res)).not.toContain("kbyok1");
  });

  it("refuses My API for a guest session before touching any credential", async () => {
    const byok = vi.fn();
    const decrypt = vi.fn();
    const getBinding = vi.fn();
    const res = response();
    await handlerWith({ chatWithUserProviderStream: byok, decryptUserProviderSecret: decrypt, getActiveUserProviderBinding: getBinding }, { isGuest: true })({ body: { ...baseBody, myApi: true } } as Request, res, vi.fn());
    expect(getBinding).not.toHaveBeenCalled();
    expect(decrypt).not.toHaveBeenCalled();
    expect(byok).not.toHaveBeenCalled();
    expect(eventPayload(res, "error")).toMatchObject({ message: expect.stringContaining("гостев") });
  });

  it("marks the audit record so a BYOK turn is separable from a platform turn", async () => {
    const audit = vi.fn();
    const byok = vi.fn().mockResolvedValue({ content: "ok", modelUsed: MODEL, provider: "openrouter", fallbackUsed: false, label: MODEL, status: { state: "ready", badge: "", category: null, http: 200, checkedAt: "", confirmed: "" } });
    const res = response();
    await handlerWith({ chatWithUserProviderStream: byok, auditChatStream: audit })({ body: { ...baseBody, myApi: true } } as Request, res, vi.fn());
    expect(audit.mock.calls[0]![0]).toMatchObject({ event: "chat_stream.completed", executionMode: "my_api", provider: "openrouter" });
  });
});

describe("existing chat path regression", () => {
  it("keeps using the system role chain when myApi is absent", async () => {
    const platform = vi.fn(async (_roleId, _history, _settings, onDelta) => {
      onDelta("Обычный ");
      onDelta("ответ");
      return { content: "Обычный ответ", modelUsed: "gpt-oss-20b", provider: "groq", fallbackUsed: false, label: "Kairema Flash", status: { state: "ready", badge: "Готов", category: null, http: 200, checkedAt: "", confirmed: "" } };
    });
    const byok = vi.fn();
    const audit = vi.fn();
    const res = response();
    await handlerWith({ chatWithRoleStream: platform, chatWithUserProviderStream: byok, auditChatStream: audit })({ body: baseBody } as Request, res, vi.fn());
    expect(platform).toHaveBeenCalledTimes(1);
    expect(byok).not.toHaveBeenCalled();
    expect(eventPayload(res, "done")).toMatchObject({ content: "Обычный ответ", label: "Kairema Flash" });
    expect(audit.mock.calls[0]![0]).toMatchObject({ executionMode: "platform", provider: "groq" });
  });

  it("keeps using the system role chain when myApi is explicitly false", async () => {
    const platform = vi.fn().mockResolvedValue({ content: "ok", modelUsed: "m", provider: "groq", fallbackUsed: false, label: "Kairema Flash", status: { state: "ready", badge: "", category: null, http: 200, checkedAt: "", confirmed: "" } });
    const byok = vi.fn();
    const res = response();
    await handlerWith({ chatWithRoleStream: platform, chatWithUserProviderStream: byok })({ body: { ...baseBody, myApi: false } } as Request, res, vi.fn());
    expect(platform).toHaveBeenCalledTimes(1);
    expect(byok).not.toHaveBeenCalled();
  });

  it("still reports a platform failure through the existing public error text", async () => {
    const platform = vi.fn().mockRejectedValue(new Error("upstream exploded sk-or-v1-leaked"));
    const res = response();
    await handlerWith({ chatWithRoleStream: platform })({ body: baseBody } as Request, res, vi.fn());
    expect(eventPayload(res, "error")).toMatchObject({ message: expect.stringContaining("Что произошло") });
  });
});

describe("guest isolation of the byok error surface", () => {
  it("returns the guest refusal even when a binding would be present", async () => {
    const byok = vi.fn();
    const res = response();
    const handler = handlerWith({ chatWithUserProviderStream: byok }, { isGuest: true });
    await handler({ body: { ...baseBody, myApi: true } } as Request, res, vi.fn());
    expect(byok).not.toHaveBeenCalled();
    expect(UserProviderGuestNotAllowedError).toBeDefined();
    expect(UserProviderNotConfiguredError).toBeDefined();
  });
});

describe("custom provider binding in the my api path", () => {
  const customBinding = {
    provider: "custom-abc123",
    displayName: "Мой провайдер",
    baseUrl: "https://api.example.com/v1",
    modelsEndpoint: null,
    model: MODEL,
    encryptedApiKey: "kbyok1.aXYxLnRhZw.cGF5bG9hZA",
    keyHint: "••••4321",
    updatedAt: new Date(0),
  };

  it("rebuilds the endpoint from the stored row and labels the answer with the given name", async () => {
    const byok = vi.fn().mockResolvedValue({ content: "ok", modelUsed: MODEL, provider: "custom-abc123", fallbackUsed: false, label: MODEL, status: { state: "ready", badge: "", category: null, http: 200, checkedAt: "", confirmed: "" } });
    const res = response();
    await handlerWith({ chatWithUserProviderStream: byok, getActiveUserProviderBinding: vi.fn().mockResolvedValue(customBinding) })({ body: { ...baseBody, myApi: true } } as Request, res, vi.fn());

    const options = byok.mock.calls[0]![0] as { provider: { isCustom: boolean; chatEndpoint: string; displayName: string }; apiKey: string };
    expect(options.provider).toMatchObject({ isCustom: true, displayName: "Мой провайдер", chatEndpoint: "https://api.example.com/v1/chat/completions" });
    expect(options.apiKey).toBe(KEY);
  });

  it("honours a stored models endpoint when the provider configured one", async () => {
    const byok = vi.fn().mockResolvedValue({ content: "ok", modelUsed: MODEL, provider: "custom-abc123", fallbackUsed: false, label: MODEL, status: { state: "ready", badge: "", category: null, http: 200, checkedAt: "", confirmed: "" } });
    const res = response();
    await handlerWith({ chatWithUserProviderStream: byok, getActiveUserProviderBinding: vi.fn().mockResolvedValue({ ...customBinding, modelsEndpoint: "https://api.example.com/catalog" }) })({ body: { ...baseBody, myApi: true } } as Request, res, vi.fn());
    const options = byok.mock.calls[0]![0] as { provider: { modelsEndpoint: string } };
    expect(options.provider.modelsEndpoint).toBe("https://api.example.com/catalog");
  });

  it("never falls back to the system role chain when a custom provider fails", async () => {
    const byok = vi.fn().mockRejectedValue(new Error("custom endpoint unreachable"));
    const platform = vi.fn();
    const res = response();
    await handlerWith({ chatWithUserProviderStream: byok, chatWithRoleStream: platform, getActiveUserProviderBinding: vi.fn().mockResolvedValue(customBinding) })({ body: { ...baseBody, myApi: true } } as Request, res, vi.fn());
    expect(byok).toHaveBeenCalledTimes(1);
    expect(platform).not.toHaveBeenCalled();
    expect(eventPayload(res, "error")).toMatchObject({ message: expect.stringContaining("Что произошло") });
  });

  it("does not leak the upstream URL or key in the public error", async () => {
    const byok = vi.fn().mockRejectedValue(new Error("failed for https://api.example.com/v1 with sk-or-v1-leaked"));
    const res = response();
    await handlerWith({ chatWithUserProviderStream: byok, getActiveUserProviderBinding: vi.fn().mockResolvedValue(customBinding) })({ body: { ...baseBody, myApi: true } } as Request, res, vi.fn());
    const payload = JSON.stringify(eventPayload(res, "error"));
    expect(payload).not.toContain("api.example.com");
    expect(payload).not.toContain("sk-or-v1-leaked");
  });
});

describe("answer attribution for a custom provider", () => {
  const customBinding = {
    provider: "custom-abc123",
    displayName: "Мой провайдер",
    baseUrl: "https://api.example.com/v1",
    modelsEndpoint: null,
    model: MODEL,
    encryptedApiKey: "kbyok1.aXYxLnRhZw.cGF5bG9hZA",
    keyHint: "••••4321",
    updatedAt: new Date(0),
  };

  it("UX-2: the custom label is the built-in one, the model id is untouched", async () => {
    const byok = vi.fn().mockResolvedValue({ content: "ok", modelUsed: MODEL, provider: "custom-abc123", fallbackUsed: false, label: "Мой провайдер · " + MODEL, status: { state: "ready", badge: "", category: null, http: 200, checkedAt: "", confirmed: "" } });
    const res = response();
    await handlerWith({ chatWithUserProviderStream: byok, getActiveUserProviderBinding: vi.fn().mockResolvedValue(customBinding) })({ body: { ...baseBody, myApi: true } } as Request, res, vi.fn());

    const options = byok.mock.calls[0]![0] as { model: string; modelLabel: string };
    // The binding feeds generation unchanged; attribution happens on the way back out.
    expect(options.model).toBe(MODEL);
    expect(options.modelLabel).toBe(MODEL);
    expect(eventPayload(res, "done")).toMatchObject({ modelUsed: MODEL, label: `Мой провайдер · ${MODEL}` });
  });
});

describe("a turn that produced no answer", () => {
  it("rolls back its own question and leaves the rest of the conversation alone", async () => {
    const deleteMessage = vi.fn().mockResolvedValue(true);
    const append = vi.fn().mockResolvedValue({ id: 77, created: true });
    const byok = vi.fn().mockRejectedValue(new UserProviderError("PROVIDER_UNAVAILABLE", "Провайдер временно недоступен. Повторите попытку позже.", 503));
    const res = response();
    await handlerWith({ chatWithUserProviderStream: byok, appendChatMessage: append, deleteOwnedSessionUserMessage: deleteMessage })({ body: { ...baseBody, myApi: true } } as Request, res, vi.fn());

    // The question was written before the provider was called, so the failure has to take it back.
    expect(append).toHaveBeenCalledTimes(1);
    expect(deleteMessage).toHaveBeenCalledWith(42, sessionId, 77);
    expect(writes(res)).toContain("event: error");
  });

  it("keeps the transcript untouched when the rollback itself fails", async () => {
    const deleteMessage = vi.fn().mockRejectedValue(new Error("db unavailable"));
    const byok = vi.fn().mockRejectedValue(new UserProviderError("UNKNOWN", "Провайдер вернул пустой ответ. Повторите попытку.", 200));
    const res = response();
    await handlerWith({ chatWithUserProviderStream: byok, deleteOwnedSessionUserMessage: deleteMessage })({ body: { ...baseBody, myApi: true } } as Request, res, vi.fn());
    // A rollback that fails must not replace the user's error with a second error.
    expect(writes(res)).toContain("event: error");
  });

  it("never rolls back a question for a turn that succeeded", async () => {
    const deleteMessage = vi.fn().mockResolvedValue(true);
    const byok = vi.fn().mockResolvedValue({ content: "ok", modelUsed: MODEL, provider: "openrouter", fallbackUsed: false, label: MODEL, status: { state: "ready", badge: "", category: null, http: 200, checkedAt: new Date().toISOString(), confirmed: "" } });
    const res = response();
    await handlerWith({ chatWithUserProviderStream: byok, deleteOwnedSessionUserMessage: deleteMessage })({ body: { ...baseBody, myApi: true } } as Request, res, vi.fn());
    expect(writes(res)).toContain("event: done");
    expect(deleteMessage).not.toHaveBeenCalled();
  });

  it("does not roll back a turn that was refused before the question was stored", async () => {
    const deleteMessage = vi.fn().mockResolvedValue(true);
    const append = vi.fn().mockResolvedValue({ id: 77, created: true });
    const byok = vi.fn();
    const res = response();
    await handlerWith({ chatWithUserProviderStream: byok, appendChatMessage: append, deleteOwnedSessionUserMessage: deleteMessage, consumeMyApiRequestQuota: myApiQuota.mockResolvedValue({ allowed: false, retryAfterSeconds: 42 }) })({ body: { ...baseBody, myApi: true } } as Request, res, vi.fn());
    expect(append).not.toHaveBeenCalled();
    expect(deleteMessage).not.toHaveBeenCalled();
    expect(byok).not.toHaveBeenCalled();
  });
});
