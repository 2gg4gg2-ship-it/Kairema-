import { EventEmitter } from "node:events";
import type { Request, Response } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CHAT_STREAM_RATE_LIMIT, createChatStreamHandler, chatStreamRateLimitMessage } from "./chat-stream";
import { MODEL_IDS, MODEL_ROLES } from "./providers";

/** The four public roles, each of which must get its own 15-request allowance. */
const ROLES = ["fast", "smart", "context", "flagship"] as const;
const LIMIT = 15;

const sessionId = "550e8400-e29b-41d4-a716-446655440000";
const transcriptWindow = { messages: [{ id: 1, role: "user" as const, content: "Привет", createdAt: new Date(0) }], budget: { maxContentChars: 18_000, maxCandidateMessages: 12, maxPriorTurns: 4 }, candidateCount: 1, selectedContentChars: 6, selectedPriorTurns: 0, truncated: false };

/**
 * A stand-in for `chat_stream_rate_windows` that is keyed by user *and* role, so the tests below
 * exercise the same independence the real primary key provides: a bucket belongs to one role and
 * spending it can never be observed by another.
 */
const windows = new Map<string, { windowStarted: number; requestCount: number }>();

function consumeWindow(userId: number, roleId: string, limit: number, windowMs: number) {
  const now = Date.now();
  const key = `${userId}:${roleId}`;
  const existing = windows.get(key);
  if (!existing || now - existing.windowStarted > windowMs) {
    windows.set(key, { windowStarted: now, requestCount: 1 });
  } else {
    existing.requestCount += 1;
  }
  const row = windows.get(key)!;
  return { allowed: row.requestCount <= limit, retryAfterSeconds: Math.max(1, Math.ceil((windowMs - (now - row.windowStarted)) / 1_000)) };
}

function response() {
  return Object.assign(new EventEmitter(), {
    status: vi.fn().mockReturnThis(), set: vi.fn().mockReturnThis(), flushHeaders: vi.fn(), write: vi.fn(), end: vi.fn(), json: vi.fn(),
  }) as unknown as Response;
}

type Consume = (userId: number, roleId: string, limit: number, windowMs: number) => { allowed: boolean; retryAfterSeconds: number };

function handler(consume: Consume) {
  return createChatStreamHandler({
    authenticateRequest: vi.fn().mockResolvedValue({ id: 42 }),
    getOrCreateGuestUser: vi.fn().mockResolvedValue(null),
    getOwnedChatSession: vi.fn().mockResolvedValue({ id: sessionId, title: "Новый разговор" }),
    consumeChatStreamRequestQuota: consume,
    consumeMyApiRequestQuota: vi.fn().mockResolvedValue({ allowed: true, retryAfterSeconds: 0 }),
    updateChatTitle: vi.fn(),
    listSessionTranscriptWindow: vi.fn().mockResolvedValue(transcriptWindow),
    buildChatContext: vi.fn().mockResolvedValue({ style: "default" }),
    enqueueMemoryExtractionJob: vi.fn().mockResolvedValue({ created: true }),
    processMemoryExtractionJob: vi.fn().mockResolvedValue(undefined),
    getActiveUserProviderBinding: vi.fn().mockResolvedValue(null),
    decryptUserProviderSecret: vi.fn(),
    auditChatStream: vi.fn(),
    chatWithUserProviderStream: vi.fn(),
    chatWithRoleStream: vi.fn(async () => ({ content: "ok", modelUsed: "fast", provider: "openrouter", fallbackUsed: false, label: "Kairema Flash", status: { state: "ready", badge: "", category: null, http: 200, checkedAt: new Date().toISOString(), confirmed: "" } })),
    appendChatMessage: vi.fn(async () => ({ id: 1, created: true })),
  } as never);
}

/** Sends one ordinary Kairema turn on `roleId` and reports the HTTP status. */
async function send(roleId: string, consume: Consume) {
  const stream = handler(consume);
  const res = response();
  await stream({ body: { sessionId, modelId: roleId, content: "Привет" } } as Request, res, vi.fn());
  const status = (res.status as ReturnType<typeof vi.fn>).mock.calls.map((call) => call[0]);
  return status.includes(429) ? 429 : 200;
}

const consume: Consume = (userId, roleId, limit, windowMs) => consumeWindow(userId, roleId, limit, windowMs);

beforeEach(() => {
  windows.clear();
  vi.clearAllMocks();
});

describe("per-role Kairema request allowance", () => {
  it("allows 15 requests per role and refuses the 16th on that same role", async () => {
    for (const roleId of ROLES) {
      for (let i = 0; i < LIMIT; i += 1) {
        expect(await send(roleId, consume)).toBe(200);
      }
      expect(await send(roleId, consume)).toBe(429);
    }
  });

  it("does not let an exhausted Flash allowance block Think", async () => {
    for (let i = 0; i < LIMIT + 1; i += 1) await send("fast", consume);
    expect(await send("fast", consume)).toBe(429);
    // Think, Context and Apex still have their full, independent allowance.
    for (const roleId of ["smart", "context", "flagship"] as const) {
      for (let i = 0; i < LIMIT; i += 1) {
        expect(await send(roleId, consume)).toBe(200);
      }
    }
  });

  it("does not let an exhausted Think allowance block Flash", async () => {
    for (let i = 0; i < LIMIT + 1; i += 1) await send("smart", consume);
    expect(await send("smart", consume)).toBe(429);
    for (let i = 0; i < LIMIT; i += 1) {
      expect(await send("fast", consume)).toBe(200);
    }
  });

  it("names the affected role in the 429 and discloses no internal detail", async () => {
    for (let i = 0; i < LIMIT + 1; i += 1) await send("fast", consume);
    const stream = handler(consume);
    const res = response();
    await stream({ body: { sessionId, modelId: "fast", content: "Привет" } } as Request, res, vi.fn());
    const body = (res.json as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as { error: string };
    expect(body.error).toBe(chatStreamRateLimitMessage("fast"));
    expect(body.error).toContain("Kairema Flash");
    expect(body.error).not.toMatch(/chat_stream_rate_windows|requestCount|userId|SELECT|INSERT/i);
  });

  it("keeps each role's counter separate rather than sharing one budget", async () => {
    // A single shared 60-request bucket would have refused the 16th request overall; four
    // independent ones admit 15 per role, so all 60 turns below succeed.
    let admitted = 0;
    for (const roleId of ROLES) {
      for (let i = 0; i < LIMIT; i += 1) {
        if ((await send(roleId, consume)) === 200) admitted += 1;
      }
    }
    expect(admitted).toBe(ROLES.length * LIMIT);
  });

  it("charges the bucket by the stable role slug the client asked for", async () => {
    await send("flagship", consume);
    // The key is the slug, so the upstream model behind Apex is irrelevant to the counter.
    expect([...windows.keys()]).toEqual(["42:flagship"]);
  });
});

describe("per-role allowance configuration", () => {
  it("gives every public role the same 15-request allowance", () => {
    expect(CHAT_STREAM_RATE_LIMIT).toBe(15);
    expect(MODEL_ROLES).toHaveLength(4);
    for (const role of MODEL_ROLES) {
      expect(ROLES).toContain(role.key);
    }
  });

  it("leaves the public role names and slugs unchanged", () => {
    expect([...MODEL_IDS].sort()).toEqual([...ROLES].sort());
    expect(MODEL_ROLES.map((role) => role.label)).toEqual([
      "Kairema Flash",
      "Kairema Think",
      "Kairema Context",
      "Kairema Apex",
    ]);
  });
});
