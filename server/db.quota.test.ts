import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  rows: [] as Array<{ userId: number; roleId?: string; windowStarted: Date; requestCount: number; updatedAt: Date }>,
  inserted: [] as unknown[],
  wheres: [] as unknown[],
}));

const mockDb = vi.hoisted(() => ({
  insert: vi.fn(() => ({
    values: vi.fn((value: unknown) => {
      state.inserted.push(value);
      return { onDuplicateKeyUpdate: vi.fn().mockResolvedValue(undefined) };
    }),
  })),
  select: vi.fn(() => ({
    from: vi.fn(() => ({
      where: vi.fn((condition: unknown) => {
        state.wheres.push(condition);
        return { limit: vi.fn().mockImplementation(async () => state.rows) };
      }),
    })),
  })),
}));

vi.mock("drizzle-orm/mysql2", () => ({ drizzle: () => mockDb }));

import { CHAT_QUOTA_ROLE_IDS, consumeChatStreamRequestQuota, consumeMyApiRequestQuota } from "./db";
import { ROLE_IDS } from "./providers";

/** The four public Kairema role slugs, each of which must carry its own 15-request allowance. */
const ROLES = ["fast", "smart", "context", "flagship"] as const;
const ROLE_LIMIT = 15;

/**
 * Collects the drizzle column names a condition references.
 *
 * A drizzle `and(eq(a, x), eq(b, y))` is a graph with cycles (each column points back at its
 * table, which points back at its columns), so `JSON.stringify` throws on it and a plain recursive
 * walk over own properties finds nothing: the columns live inside nested `SQL` chunks reached via
 * `queryChunks`. This walks the chunks with a visited set instead, which is cycle-safe and does not
 * depend on the condition being serialisable.
 */
function referencedColumnNames(condition: unknown, seen = new Set<unknown>()): string[] {
  if (condition === null || typeof condition !== "object" || seen.has(condition)) return [];
  seen.add(condition);
  const names: string[] = [];
  if ("name" in condition && typeof (condition as { name: unknown }).name === "string") {
    names.push((condition as { name: string }).name);
  }
  const chunks = (condition as { queryChunks?: unknown }).queryChunks;
  if (Array.isArray(chunks)) {
    for (const chunk of chunks) names.push(...referencedColumnNames(chunk, seen));
  }
  return names;
}

describe("durable chat-stream quota", () => {
  beforeEach(() => {
    process.env.DATABASE_URL = "mysql://test";
    state.rows = [];
    state.inserted = [];
    state.wheres = [];
    vi.clearAllMocks();
  });

  it("returns 429-admission data for an over-limit user without storing request content or session identifiers", async () => {
    const now = Date.now();
    state.rows = [{ userId: 44, roleId: "fast", windowStarted: new Date(now - 10_000), requestCount: ROLE_LIMIT + 1, updatedAt: new Date(now) }];

    const result = await consumeChatStreamRequestQuota(44, "fast", ROLE_LIMIT, 60_000);

    expect(result).toEqual({ allowed: false, retryAfterSeconds: 50 });
    expect(state.inserted).toHaveLength(1);
    expect(state.inserted[0]).toMatchObject({ userId: 44, roleId: "fast", requestCount: 1, windowStarted: expect.any(Date) });
    expect(state.inserted[0]).not.toHaveProperty("content");
    expect(state.inserted[0]).not.toHaveProperty("sessionId");
    expect(state.inserted[0]).not.toHaveProperty("clientMessageId");
  });

  it("keeps each request keyed by its authenticated user and permits counts at the configured boundary", async () => {
    const now = Date.now();
    state.rows = [{ userId: 45, roleId: "smart", windowStarted: new Date(now - 5_000), requestCount: ROLE_LIMIT, updatedAt: new Date(now) }];

    const result = await consumeChatStreamRequestQuota(45, "smart", ROLE_LIMIT, 60_000);

    expect(result.allowed).toBe(true);
    expect(state.inserted[0]).toMatchObject({ userId: 45, roleId: "smart" });
  });
});

describe("per-role Kairema allowance", () => {
  beforeEach(() => {
    process.env.DATABASE_URL = "mysql://test";
    state.rows = [];
    state.inserted = [];
    state.wheres = [];
    vi.clearAllMocks();
  });

  /** Simulates one stored bucket for a user+role and returns the admission verdict. */
  async function charge(userId: number, roleId: string, requestCount: number) {
    const now = Date.now();
    state.rows = [{ userId, roleId, windowStarted: new Date(now - 1_000), requestCount, updatedAt: new Date(now) }];
    return consumeChatStreamRequestQuota(userId, roleId, ROLE_LIMIT, 60_000);
  }

  it("gives each of the four public roles its own 15-request allowance", async () => {
    for (const roleId of ROLES) {
      // The 15th request of this role is admitted...
      expect((await charge(7, roleId, ROLE_LIMIT)).allowed).toBe(true);
      // ...and the 16th is refused, so the allowance is exactly 15 for that role alone.
      expect((await charge(7, roleId, ROLE_LIMIT + 1)).allowed).toBe(false);
    }
  });

  it("does not let an exhausted Flash allowance block Think", async () => {
    // Flash is spent for this user...
    expect((await charge(8, "fast", ROLE_LIMIT + 1)).allowed).toBe(false);
    // ...while Think still has its full, untouched allowance.
    expect((await charge(8, "smart", 1)).allowed).toBe(true);
    expect((await charge(8, "smart", ROLE_LIMIT)).allowed).toBe(true);
  });

  it("does not let an exhausted Think allowance block Flash", async () => {
    expect((await charge(9, "smart", ROLE_LIMIT + 1)).allowed).toBe(false);
    expect((await charge(9, "fast", ROLE_LIMIT)).allowed).toBe(true);
  });

  it("stores the bucket under the stable role slug, never a model id", async () => {
    // The upstream model behind a role is server-only and changes over time; the quota identity
    // must stay the slug so a re-pointed role keeps counting the same bucket.
    await charge(10, "flagship", 3);
    expect(state.inserted[0]).toMatchObject({ userId: 10, roleId: "flagship" });
    expect(state.inserted[0].roleId).not.toContain("/");
    expect(ROLE_IDS).toContain(state.inserted[0].roleId);
  });

  it("scopes the read-back to the user and the role together", async () => {
    // Reading back by user alone would let one role's counter answer for another role's request.
    await charge(11, "context", 4);
    expect(state.wheres).toHaveLength(1);
    const columns = referencedColumnNames(state.wheres[0]);
    expect(columns).toContain("userId");
    expect(columns).toContain("roleId");
    expect(columns).not.toContain("sessionId");
  });

  it("refuses an unknown role instead of minting a fresh bucket", async () => {
    // A role outside the four public slugs must not create a new, permanently empty counter that
    // would then be handed a full allowance.
    await expect(consumeChatStreamRequestQuota(12, "minimax/minimax-m3:free", ROLE_LIMIT, 60_000)).rejects.toThrow();
    expect(state.inserted).toHaveLength(0);
    await expect(consumeChatStreamRequestQuota(12, "", ROLE_LIMIT, 60_000)).rejects.toThrow();
    expect(state.inserted).toHaveLength(0);
  });

  it("keeps the accepted role set in step with the public roles", async () => {
    // The literal set in db.ts is asserted against ROLE_IDS so the two cannot drift apart silently.
    expect([...CHAT_QUOTA_ROLE_IDS].sort()).toEqual([...ROLE_IDS].sort());
  });
});

describe("durable My API quota", () => {
  beforeEach(() => {
    process.env.DATABASE_URL = "mysql://test";
    state.rows = [];
    state.inserted = [];
    vi.clearAllMocks();
  });

  it("admits the request that reaches the limit and refuses the one past it", async () => {
    const now = Date.now();
    state.rows = [{ userId: 51, windowStarted: new Date(now), requestCount: 15, updatedAt: new Date(now) }];
    await expect(consumeMyApiRequestQuota(51, 15, 60_000)).resolves.toMatchObject({ allowed: true });
    state.rows = [{ userId: 51, windowStarted: new Date(now), requestCount: 16, updatedAt: new Date(now) }];
    await expect(consumeMyApiRequestQuota(51, 15, 60_000)).resolves.toMatchObject({ allowed: false });
  });

  it("counts against a window of its own, never the ordinary chat window", async () => {
    const now = Date.now();
    state.rows = [{ userId: 52, windowStarted: new Date(now), requestCount: 1, updatedAt: new Date(now) }];
    await consumeMyApiRequestQuota(52, 15, 60_000);
    // The My API call wrote its own row keyed by the user, with no session or prompt alongside it.
    expect(state.inserted[0]).toMatchObject({ userId: 52, requestCount: 1 });
    expect(state.inserted[0]).not.toHaveProperty("content");
    expect(state.inserted[0]).not.toHaveProperty("sessionId");
  });

  it("tells the caller how long to wait before retrying", async () => {
    const now = Date.now();
    state.rows = [{ userId: 53, windowStarted: new Date(now - 10_000), requestCount: 99, updatedAt: new Date(now) }];
    await expect(consumeMyApiRequestQuota(53, 15, 60_000)).resolves.toEqual({ allowed: false, retryAfterSeconds: 50 });
  });

  it("fails loudly when the window row cannot be read back", async () => {
    state.rows = [];
    await expect(consumeMyApiRequestQuota(54, 15, 60_000)).rejects.toThrow(/My API/);
  });
});
