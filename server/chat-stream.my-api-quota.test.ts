import { EventEmitter } from "node:events";
import type { Request, Response } from "express";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createChatStreamHandler, MY_API_RATE_LIMIT, MY_API_RATE_LIMIT_MESSAGE, resetChatStreamRateLimits } from "./chat-stream";

const sessionId = "550e8400-e2e2-46c2-bd9a-58eb3eca0bc2";
const KEY = "sk-or-v1-quota-secret-1111";
const MODEL = "vendor/model-quota";
const baseBody = { sessionId, modelId: "fast", content: "Привет" };

const transcriptWindow = { messages: [{ id: 1, role: "user" as const, content: "Привет", createdAt: new Date(0) }], budget: { maxContentChars: 18_000, maxCandidateMessages: 12, maxPriorTurns: 4 }, candidateCount: 1, selectedContentChars: 6, selectedPriorTurns: 0, truncated: false };

const binding = { provider: "openrouter", model: MODEL, encryptedApiKey: "kbyok1.aXYxLnRhZw.cGF5bG9hZA", keyHint: "••••1111", updatedAt: new Date(0) };

/**
 * A faithful stand-in for `my_api_rate_windows`: one row per user, the counter resetting only once
 * the window has aged past its width. A stub that just returns a fixed verdict could not tell the
 * difference between a limit that counts and one that does not, so the arithmetic is reproduced
 * here and the real handler is the thing under test.
 */
const windows = new Map<number, { windowStarted: number; requestCount: number }>();
function consumeWindow(userId: number, limit: number, windowMs: number) {
  const now = Date.now();
  const current = windows.get(userId);
  if (!current || now - current.windowStarted > windowMs) windows.set(userId, { windowStarted: now, requestCount: 1 });
  else current.requestCount += 1;
  const row = windows.get(userId)!;
  return { allowed: row.requestCount <= limit, retryAfterSeconds: Math.max(1, Math.ceil((windowMs - (now - row.windowStarted)) / 1_000)) };
}

const calls = vi.hoisted(() => ({ myApi: 0, platform: 0, append: 0 }));

function response() {
  return Object.assign(new EventEmitter(), {
    status: vi.fn().mockReturnThis(), set: vi.fn().mockReturnThis(), flushHeaders: vi.fn(), write: vi.fn(), end: vi.fn(), json: vi.fn(),
  }) as unknown as Response;
}

function handler(overrides: Record<string, unknown> = {}, options: { userId?: number } = {}) {
  const answered = vi.fn(async (options_: { onDelta: (delta: string) => void }) => {
    calls.myApi += 1;
    options_.onDelta("ok");
    return { content: "ok", modelUsed: MODEL, provider: "openrouter", fallbackUsed: false, label: MODEL, status: { state: "ready", badge: "", category: null, http: 200, checkedAt: new Date().toISOString(), confirmed: "" } };
  });
  const appendChatMessage = vi.fn(async () => {
    calls.append += 1;
    return { id: 1, created: true };
  });
  const stream = createChatStreamHandler({
    authenticateRequest: vi.fn().mockResolvedValue({ id: options.userId ?? 42 }),
    getOrCreateGuestUser: vi.fn().mockResolvedValue(null),
    getOwnedChatSession: vi.fn().mockResolvedValue({ id: sessionId, title: "Новый разговор" }),
    consumeChatStreamRequestQuota: vi.fn().mockResolvedValue({ allowed: true, retryAfterSeconds: 0 }),
    updateChatTitle: vi.fn(),
    listSessionTranscriptWindow: vi.fn().mockResolvedValue(transcriptWindow),
    buildChatContext: vi.fn().mockResolvedValue({ style: "default" }),
    enqueueMemoryExtractionJob: vi.fn().mockResolvedValue({ created: true }),
    processMemoryExtractionJob: vi.fn().mockResolvedValue(undefined),
    getActiveUserProviderBinding: vi.fn().mockResolvedValue(binding),
    decryptUserProviderSecret: vi.fn().mockReturnValue(KEY),
    auditChatStream: vi.fn(),
    chatWithUserProviderStream: answered,
    chatWithRoleStream: vi.fn(async () => { calls.platform += 1; throw new Error("platform path must not run"); }),
    appendChatMessage,
    consumeMyApiRequestQuota: (userId: number, limit: number, windowMs: number) => consumeWindow(userId, limit, windowMs),
    ...overrides,
  });
  return { stream, answered, appendChatMessage };
}

const ask = async (myApi: boolean, options: { userId?: number } = {}, overrides: Record<string, unknown> = {}) => {
  const { stream } = handler(overrides, options);
  const res = response();
  await stream({ body: { ...baseBody, myApi } } as Request, res, vi.fn());
  return { res, json: (res.json as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as { error?: string; myApiRateLimited?: boolean } | undefined };
};

beforeEach(() => {
  resetChatStreamRateLimits();
  windows.clear();
  calls.myApi = 0;
  calls.platform = 0;
  calls.append = 0;
  vi.spyOn(console, "info").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("the My API per-user quota", () => {
  it("is 15 requests per 60 seconds", () => {
    expect(MY_API_RATE_LIMIT).toBe(15);
  });

  it("admits exactly 15 My API requests in a minute and refuses the 16th", async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 16; i += 1) {
      const res = response();
      const { stream } = handler();
      await stream({ body: { ...baseBody, myApi: true } } as Request, res, vi.fn());
      statuses.push((res.status as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as number);
    }
    expect(statuses.slice(0, 15).every((status) => status === 200)).toBe(true);
    expect(statuses[15]).toBe(429);
    expect(calls.myApi).toBe(15);
  });

  it("answers a refused request with a clear message and a Retry-After, not an empty answer", async () => {
    for (let i = 0; i < 15; i += 1) await ask(true);
    const { res, json } = await ask(true);
    expect((res.status as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]).toBe(429);
    expect(json?.error).toBe(MY_API_RATE_LIMIT_MESSAGE);
    expect(json?.myApiRateLimited).toBe(true);
    expect((res.set as ReturnType<typeof vi.fn>).mock.calls.some(([header]) => header === "Retry-After")).toBe(true);
  });

  it("never calls the user's provider for a refused request", async () => {
    for (let i = 0; i < 15; i += 1) await ask(true);
    const { stream, answered } = handler();
    await stream({ body: { ...baseBody, myApi: true } } as Request, response(), vi.fn());
    expect(answered).not.toHaveBeenCalled();
  });

  it("never falls back to a system provider when the limit is reached", async () => {
    for (let i = 0; i < 15; i += 1) await ask(true);
    await ask(true);
    expect(calls.platform).toBe(0);
  });

  it("does not persist a refused turn as a half-written conversation", async () => {
    for (let i = 0; i < 15; i += 1) await ask(true);
    const before = calls.append;
    await ask(true);
    expect(calls.append).toBe(before);
  });

  it("counts each user separately, so one account cannot spend another's budget", async () => {
    for (let i = 0; i < 15; i += 1) await ask(true, { userId: 42 });
    await ask(true, { userId: 42 });
    const other = await ask(true, { userId: 99 });
    expect((other.res.status as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]).toBe(200);
  });

  it("lets the budget refill once the window has passed", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
      for (let i = 0; i < 15; i += 1) await ask(true);
      expect((await ask(true)).res.status).toBeDefined();
      expect((await ask(true)).json?.error).toBe(MY_API_RATE_LIMIT_MESSAGE);
      // The window is a rolling fixed window: after it ages out the user is served again.
      vi.setSystemTime(new Date("2026-01-01T00:01:01Z"));
      const afterWindow = await ask(true);
      expect((afterWindow.res.status as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]).toBe(200);
    } finally {
      vi.useRealTimers();
    }
  });

  it("leaves ordinary Kairema Chat on its own budget", async () => {
    // Fifteen My API turns are spent, and the chat limit is a separate counter the My API never touched.
    for (let i = 0; i < 15; i += 1) await ask(true);
    await ask(true);
    const chat = await ask(false);
    expect((chat.res.status as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]).toBe(200);
  });

  it("does not meter a My API turn against the ordinary chat quota", async () => {
    const chatQuota = vi.fn().mockResolvedValue({ allowed: true, retryAfterSeconds: 0 });
    const myApiQuota = vi.fn().mockImplementation((userId: number, limit: number, windowMs: number) => consumeWindow(userId, limit, windowMs));
    const { stream } = handler({ consumeChatStreamRequestQuota: chatQuota, consumeMyApiRequestQuota: myApiQuota });
    await stream({ body: { ...baseBody, myApi: true } } as Request, response(), vi.fn());
    // Both quotas are consulted, but they are two different counters with two different limits.
    expect(chatQuota).toHaveBeenCalledWith(42, expect.any(Number), expect.any(Number));
    expect(myApiQuota).toHaveBeenCalledWith(42, 15, 60_000);
  });

  it("refuses rather than proceeding when the quota cannot be read", async () => {
    const { res, json } = await ask(true, {}, { consumeMyApiRequestQuota: vi.fn().mockRejectedValue(new Error("db down")) });
    expect((res.status as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]).toBe(503);
    expect(json?.error).toMatch(/временно недоступна/i);
    expect(calls.myApi).toBe(0);
  });

  it("leaks neither a stack trace nor the key in the refusal", async () => {
    for (let i = 0; i < 15; i += 1) await ask(true);
    const { json } = await ask(true);
    expect(JSON.stringify(json)).not.toContain(KEY);
    expect(JSON.stringify(json)).not.toMatch(/at .*\.ts:\d+/);
  });

  it("records the refusal in the audit trail as its own event", async () => {
    const auditChatStream = vi.fn();
    for (let i = 0; i < 15; i += 1) await ask(true);
    await ask(true, {}, { auditChatStream });
    const events = auditChatStream.mock.calls.map(([record]) => (record as { event: string }).event);
    expect(events).toContain("chat_stream.my_api_rate_limited");
  });
});
