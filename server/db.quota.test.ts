import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  rows: [] as Array<{ userId: number; windowStarted: Date; requestCount: number; updatedAt: Date }>,
  inserted: [] as unknown[],
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
      where: vi.fn(() => ({ limit: vi.fn().mockImplementation(async () => state.rows) })),
    })),
  })),
}));

vi.mock("drizzle-orm/mysql2", () => ({ drizzle: () => mockDb }));

import { consumeChatStreamRequestQuota } from "./db";

describe("durable chat-stream quota", () => {
  beforeEach(() => {
    process.env.DATABASE_URL = "mysql://test";
    state.rows = [];
    state.inserted = [];
    vi.clearAllMocks();
  });

  it("returns 429-admission data for an over-limit user without storing request content or session identifiers", async () => {
    const now = Date.now();
    state.rows = [{ userId: 44, windowStarted: new Date(now - 10_000), requestCount: 61, updatedAt: new Date(now) }];

    const result = await consumeChatStreamRequestQuota(44, 60, 60_000);

    expect(result).toEqual({ allowed: false, retryAfterSeconds: 50 });
    expect(state.inserted).toHaveLength(1);
    expect(state.inserted[0]).toMatchObject({ userId: 44, requestCount: 1, windowStarted: expect.any(Date) });
    expect(state.inserted[0]).not.toHaveProperty("content");
    expect(state.inserted[0]).not.toHaveProperty("sessionId");
    expect(state.inserted[0]).not.toHaveProperty("clientMessageId");
  });

  it("keeps each request keyed by its authenticated user and permits counts at the configured boundary", async () => {
    const now = Date.now();
    state.rows = [{ userId: 45, windowStarted: new Date(now - 5_000), requestCount: 60, updatedAt: new Date(now) }];

    const result = await consumeChatStreamRequestQuota(45, 60, 60_000);

    expect(result.allowed).toBe(true);
    expect(state.inserted[0]).toMatchObject({ userId: 45 });
  });
});
