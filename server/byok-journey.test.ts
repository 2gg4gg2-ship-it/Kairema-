import { EventEmitter } from "node:events";
import type { Request, Response } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";

/**
 * The whole My API journey in one test, with only the network and the database faked.
 *
 * The provider layer, the endpoint derivation, the key envelope and the stream reader are the real
 * implementations; the only things replaced are the upstream HTTP calls and the SQL. That is what
 * makes this a check of the feature rather than of the mocks: a request the user could actually
 * make has to produce a request the server would actually send.
 */

const store = vi.hoisted(() => ({
  configs: new Map<string, Record<string, unknown>>(),
  settings: { myApiProvider: null as string | null },
  chatQuota: vi.fn(),
}));

/**
 * Capacity is a separate subsystem with its own tests and needs the live quota tables. Here the
 * lease is a pass-through, so the journey exercises the provider, the key envelope and the stream
 * reader without a database that does not exist in this process.
 */
vi.mock("./capacity-controller", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./capacity-controller")>()),
  beginCapacityGeneration: vi.fn(async () => ({
    policy: { enabled: false },
    wcu: 1,
    modifiers: {},
    reserveAttempt: vi.fn(async () => ({ settled: false })),
    release: vi.fn(),
  })),
  settleCapacityReservation: vi.fn(async () => undefined),
}));

vi.mock("./db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./db")>()),
  // The same shapes the real functions read and write, held in memory for the length of a test.
  listUserProviderConfigs: vi.fn(async (userId: number) => [...store.configs.values()].filter((row) => row.userId === userId)),
  getUserProviderConfig: vi.fn(async (userId: number, provider: string) => store.configs.get(`${userId}:${provider}`)),
  upsertUserProviderConfig: vi.fn(async (input: { userId: number; provider: string; activeModel: string; encryptedApiKey: string; keyHint: string; displayName?: string | null; baseUrl?: string | null; modelsEndpoint?: string | null }) => {
    const row = {
      id: store.configs.size + 1,
      userId: input.userId,
      provider: input.provider,
      activeModel: input.activeModel,
      encryptedApiKey: input.encryptedApiKey,
      keyHint: input.keyHint,
      displayName: input.displayName ?? null,
      baseUrl: input.baseUrl ?? null,
      modelsEndpoint: input.modelsEndpoint ?? null,
      createdAt: new Date(0),
      updatedAt: new Date(0),
    };
    store.configs.set(`${input.userId}:${input.provider}`, row);
    return row;
  }),
  // Mirrors the real helper: the pointer is cleared only when the row that went away was the
  // active binding, so nothing dangles and no other provider's selection is disturbed.
  deleteUserProviderConfig: vi.fn(async (userId: number, provider: string) => {
    store.configs.delete(`${userId}:${provider}`);
    if (store.settings.myApiProvider === provider) store.settings.myApiProvider = null;
    return { removed: true as const };
  }),
  setUserProviderActiveModel: vi.fn(async (userId: number, provider: string, activeModel: string) => {
    const key = `${userId}:${provider}`;
    const row = { ...store.configs.get(key), activeModel };
    store.configs.set(key, row);
    return row;
  }),
  setActiveUserProvider: vi.fn(async (_userId: number, provider: string) => { store.settings.myApiProvider = provider; return store.settings; }),
  getUserSettings: vi.fn(async () => store.settings),
  getActiveUserProviderBinding: vi.fn(async (userId: number) => {
    const provider = store.settings.myApiProvider;
    if (!provider) return undefined;
    const row = store.configs.get(`${userId}:${provider}`);
    if (!row) return undefined;
    return {
      provider,
      model: row.activeModel as string,
      encryptedApiKey: row.encryptedApiKey as string,
      keyHint: row.keyHint as string,
      displayName: row.displayName as string | null,
      baseUrl: row.baseUrl as string | null,
      modelsEndpoint: row.modelsEndpoint as string | null,
      updatedAt: row.updatedAt as Date,
    };
  }),
  consumeChatStreamRequestQuota: store.chatQuota,
}));

import { createChatStreamHandler, resetChatStreamRateLimits } from "./chat-stream";
import { appRouter } from "./routers";
import { __resetUserProviderKeyCacheForTests } from "./user-provider-secrets";

const KEY = "sk-or-v1-journey-secret-4242";
const SESSION_ID = "550e8400-e29b-41d4-a716-446655440000";

const encoder = new TextEncoder();

/** The upstream OpenRouter calls this test allows, recorded in order. */
type UpstreamCall = { url: string; init: RequestInit };
let upstream: UpstreamCall[] = [];

function jsonResponse(body: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

/** The frame shape OpenRouter really sends on a streamed chat completion. */
function sseResponse(text: string) {
  const frame = (content: string) => `event: message\ndata: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`;
  return {
    ok: true,
    status: 200,
    body: new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(frame(text)));
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      },
    }),
    json: async () => null,
  };
}

function stubUpstream() {
  upstream = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    upstream.push({ url, init: init ?? {} });
    if (url.endsWith("/api/v1/key")) return jsonResponse({ data: { label: "journey-key" } });
    if (url.endsWith("/api/v1/models")) {
      return jsonResponse({ data: [{ id: "vendor/model-a", name: "Model A" }, { id: "vendor/model-b", name: "Model B" }] });
    }
    if (url.endsWith("/api/v1/chat/completions") || url.endsWith("/v1/chat/completions")) return sseResponse("Ответ провайдера");
    if (url.endsWith("/v1/models")) return jsonResponse({ data: [{ id: "vendor/custom-1", name: "Custom One" }] });
    throw new Error(`unexpected upstream call: ${url}`);
  }));
}

function caller() {
  return appRouter.createCaller({
    user: { id: 42, openId: "user-42", email: "user@example.com", name: "Kazea", loginMethod: "manus", role: "user", createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date(), isGuest: 0 },
    req: { headers: {} } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  });
}

function streamHandler(overrides: Record<string, unknown> = {}) {
  return createChatStreamHandler({
    authenticateRequest: vi.fn().mockResolvedValue({ id: 42 }),
    getOrCreateGuestUser: vi.fn().mockResolvedValue(null),
    getOwnedChatSession: vi.fn().mockResolvedValue({ id: SESSION_ID, title: "Разговор" }),
    appendChatMessage: vi.fn().mockResolvedValue({ id: 1, created: true }),
    updateChatTitle: vi.fn(),
    listSessionTranscriptWindow: vi.fn().mockResolvedValue({ messages: [{ id: 1, role: "user" as const, content: "Привет", createdAt: new Date(0) }], budget: { maxContentChars: 18_000, maxCandidateMessages: 12, maxPriorTurns: 4 } }),
    buildChatContext: vi.fn().mockResolvedValue({ style: "default" }),
    enqueueMemoryExtractionJob: vi.fn().mockResolvedValue({ created: true }),
    processMemoryExtractionJob: vi.fn().mockResolvedValue(undefined),
    chatWithRoleStream: vi.fn(),
    auditChatStream: vi.fn(),
    ...overrides,
  } as never);
}

function response() {
  return Object.assign(new EventEmitter(), {
    status: vi.fn().mockReturnThis(), set: vi.fn().mockReturnThis(), flushHeaders: vi.fn(), write: vi.fn(), end: vi.fn(), json: vi.fn(),
  }) as unknown as Response;
}

function sseEvents(res: Response) {
  return (res.write as ReturnType<typeof vi.fn>).mock.calls.map(([chunk]) => String(chunk));
}

function eventData(res: Response, event: string) {
  const chunk = sseEvents(res).find((value) => value.includes(`event: ${event}`));
  return chunk ? JSON.parse(chunk!.match(/data: (.+)/)![1]!) : null;
}

async function streamMessage(handler: ReturnType<typeof streamHandler>, myApi: boolean) {
  const res = response();
  const req = { body: { sessionId: SESSION_ID, modelId: "fast", content: "Привет", myApi } } as unknown as Request;
  await handler(req, res, vi.fn());
  return res;
}

beforeEach(() => {
  __resetUserProviderKeyCacheForTests();
  process.env.USER_PROVIDER_KEY_ENCRYPTION_KEY = "a".repeat(64);
  store.configs.clear();
  store.settings.myApiProvider = null;
  store.chatQuota.mockReset().mockResolvedValue({ allowed: true, retryAfterSeconds: 0 });
  resetChatStreamRateLimits();
  stubUpstream();
  vi.spyOn(console, "info").mockImplementation(() => undefined);
});

describe("the My API journey from connecting a provider to a real answer", () => {
  it("checks the key, lists models, saves the encrypted key, switches model and streams from the saved binding", async () => {
    // 1. The key is verified before anything is stored: the provider's own key route answers.
    const check = await caller().userProviders.test({ provider: "openrouter", apiKey: KEY });
    expect(check).toMatchObject({ ok: true, provider: "openrouter", label: "journey-key" });
    expect(upstream.map((call) => call.url)).toEqual(["https://openrouter.ai/api/v1/key"]);

    // 2. The catalog is the provider's live one, fetched with the typed key in the body only.
    const catalog = await caller().userProviders.models({ provider: "openrouter", apiKey: KEY });
    expect(catalog.models.map((model) => model.id)).toEqual(["vendor/model-a", "vendor/model-b"]);
    expect(store.configs.size).toBe(0);

    // 3. Saving writes an encrypted envelope and makes the provider active for My API.
    const saved = await caller().userProviders.save({ provider: "openrouter", apiKey: KEY, activeModel: "vendor/model-a", makeActive: true });
    expect(saved).toMatchObject({ provider: "openrouter", activeModel: "vendor/model-a", keyHint: "••••4242" });
    const storedRow = store.configs.get("42:openrouter")!;
    expect(storedRow.encryptedApiKey).toMatch(/^kbyok1\./);
    expect(JSON.stringify(storedRow)).not.toContain(KEY);
    expect(store.settings.myApiProvider).toBe("openrouter");

    // 4. Reopening the screen shows the saved provider, model and a masked key, never a secret.
    const listed = await caller().userProviders.list();
    expect(listed.activeProvider).toBe("openrouter");
    expect(listed.storageReady).toBe(true);
    expect(listed.configs).toHaveLength(1);
    expect(listed.configs[0]).toMatchObject({ provider: "openrouter", activeModel: "vendor/model-a", keyHint: "••••4242", displayName: null, baseUrl: null, modelsEndpoint: null });
    expect(JSON.stringify(listed.configs)).not.toContain(KEY);

    // 5. Changing the model persists it; the request carries no key at all.
    const beforeSwitch = upstream.length;
    const switched = await caller().userProviders.setActiveModel({ provider: "openrouter", activeModel: "vendor/model-b" });
    expect(switched.activeModel).toBe("vendor/model-b");
    // The switch needed no credential from the client: the key only ever appears in the header
    // the server itself puts on the provider call.
    for (const call of upstream.slice(beforeSwitch)) {
      expect(call.url).not.toContain(KEY);
      expect(String(call.init.body ?? "")).not.toContain(KEY);
    }
    expect(store.configs.get("42:openrouter")!.activeModel).toBe("vendor/model-b");
    expect(store.configs.get("42:openrouter")!.encryptedApiKey).toBe(storedRow.encryptedApiKey);

    // 6. A My API turn reaches that provider with that model and the stored key, and the platform
    //    role chain is never consulted.
    const platformCalls = vi.fn();
    const res = await streamMessage(streamHandler({ chatWithRoleStream: platformCalls }), true);
    const completion = upstream.at(-1)!;
    expect(completion.url).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect((completion.init.headers as Record<string, string>).Authorization).toBe(`Bearer ${KEY}`);
    expect(JSON.parse(String(completion.init.body)).model).toBe("vendor/model-b");
    expect(platformCalls).not.toHaveBeenCalled();
    expect(eventData(res, "done")).toMatchObject({ content: "Ответ провайдера" });
    // The key travels to the provider and nowhere else.
    expect(sseEvents(res).join("")).not.toContain(KEY);
  });

  it("runs a custom provider on the URL the user typed, deriving the catalog without doubling /v1", async () => {
    const api = caller();
    // The user pastes the API URL exactly as the provider documents it.
    const created = await api.userProviders.createCustom({ displayName: "Мой провайдер", baseUrl: "https://api.example.com/v1", apiKey: "sk-custom-journey-7777", activeModel: "vendor/custom-1", makeActive: true });
    expect(created).toMatchObject({ displayName: "Мой провайдер", baseUrl: "https://api.example.com/v1", activeModel: "vendor/custom-1" });
    expect(store.configs.get("42:custom-1a2b3c4d5e6f70819a2b") ?? [...store.configs.values()][0]!.baseUrl).toBe("https://api.example.com/v1");
    expect(store.settings.myApiProvider).toMatch(/^custom-/);

    // Neither the catalog nor the completion path grew a second /v1 segment.
    for (const call of upstream) {
      expect(call.url).not.toContain("/v1/v1");
    }
    expect(upstream.map((call) => call.url)).toContain("https://api.example.com/v1/models");

    const platformCalls = vi.fn();
    const res = await streamMessage(streamHandler({ chatWithRoleStream: platformCalls }), true);
    const completion = upstream.at(-1)!;
    expect(completion.url).toBe("https://api.example.com/v1/chat/completions");
    expect(JSON.parse(String(completion.init.body)).model).toBe("vendor/custom-1");
    expect(platformCalls).not.toHaveBeenCalled();
    expect(eventData(res, "done")).toMatchObject({ content: "Ответ провайдера" });
    // The answer is labelled with the user's own provider name, not with a Kairema role.
    expect(eventData(res, "done")).toMatchObject({ label: "Мой провайдер · vendor/custom-1" });
    // The stored row keeps the key encrypted and the browser only ever saw the mask.
    const storedRow = [...store.configs.values()][0]!;
    expect(storedRow.encryptedApiKey).toMatch(/^kbyok1\./);
    expect(JSON.stringify(storedRow)).not.toContain("sk-custom-journey-7777");
    const listed = await api.userProviders.list();
    expect(JSON.stringify(listed)).not.toContain("sk-custom-journey-7777");
    expect(listed.configs[0]).toMatchObject({ keyHint: "••••7777", displayName: "Мой провайдер" });
  });

  it("keeps an ordinary chat turn on the platform path and never contacts the user provider", async () => {
    await caller().userProviders.save({ provider: "openrouter", apiKey: KEY, activeModel: "vendor/model-a", makeActive: true });
    const platformAnswer = vi.fn(async (_role: string, _history: unknown, _settings: unknown, onDelta: (delta: string) => void) => {
      onDelta("Ответ Kairema");
      return { content: "Ответ Kairema", modelUsed: "fast", provider: "openrouter", fallbackUsed: false, label: "Kairema Flash", status: { state: "ready", badge: "Готов", category: null, http: 200, checkedAt: "", confirmed: "" } };
    });
    const res = await streamMessage(streamHandler({ chatWithRoleStream: platformAnswer }), false);

    expect(platformAnswer).toHaveBeenCalledOnce();
    expect(upstream.every((call) => !call.url.includes("/chat/completions"))).toBe(true);
    expect(eventData(res, "done")).toMatchObject({ content: "Ответ Kairema" });
  });

  it("keeps the active binding when a different provider is removed", async () => {
    const api = caller();
    const custom = await api.userProviders.createCustom({ displayName: "Второй", baseUrl: "https://api.example.com/v1", apiKey: "sk-custom-journey-7777", activeModel: "vendor/custom-1" });
    await api.userProviders.save({ provider: "openrouter", apiKey: KEY, activeModel: "vendor/model-a", makeActive: true });
    expect(store.configs.get("42:openrouter")!.encryptedApiKey).toMatch(/^kbyok1\./);

    await api.userProviders.remove({ provider: custom.provider });
    expect(store.configs.size).toBe(1);
    // The active provider is untouched: its row, its key and the pointer all survive.
    expect(store.settings.myApiProvider).toBe("openrouter");
    const listed = await api.userProviders.list();
    expect(listed.configs.map((config) => config.provider)).toEqual(["openrouter"]);

    const platformCalls = vi.fn();
    await streamMessage(streamHandler({ chatWithRoleStream: platformCalls }), true);
    expect(platformCalls).not.toHaveBeenCalled();
    expect(upstream.at(-1)!.url).toContain("/chat/completions");
  });

  it("stops using a provider the user disconnects, instead of falling back to Kairema", async () => {
    const api = caller();
    await api.userProviders.save({ provider: "openrouter", apiKey: KEY, activeModel: "vendor/model-a", makeActive: true });
    expect((await streamMessage(streamHandler({}), true)) && upstream.at(-1)!.url).toContain("/chat/completions");

    await api.userProviders.remove({ provider: "openrouter" });
    expect(store.configs.size).toBe(0);
    // Removing the active provider leaves nothing dangling: the pointer is cleared in the same
    // operation, so the screen shows "not configured" and the server finds no binding.
    const listed = await api.userProviders.list();
    expect(listed.activeProvider).toBeNull();
    expect(listed.configs).toEqual([]);
    expect(store.settings.myApiProvider).toBeNull();

    const platformCalls = vi.fn();
    const before = upstream.length;
    const res = await streamMessage(streamHandler({ chatWithRoleStream: platformCalls }), true);
    expect(platformCalls).not.toHaveBeenCalled();
    expect(upstream.length).toBe(before);
    expect(eventData(res, "error")?.message).toMatch(/не настроен/);
  });

  it("refuses a My API turn with no saved provider and never silently answers from Kairema", async () => {
    const platformCalls = vi.fn();
    const res = await streamMessage(streamHandler({ chatWithRoleStream: platformCalls }), true);

    expect(platformCalls).not.toHaveBeenCalled();
    expect(eventData(res, "error")?.message).toMatch(/не настроен/);
  });
});
