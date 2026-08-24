import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type MemoryRow = { id: string; userId: number; category: "fact" | "dialog_topic" | "profile"; value: string; memoryKey: string | null; role: "fast" | "smart" | "context" | "flagship" | null; source: "manual" | "auto"; sessionId: string | null; sourceMessageId: number | null; lastSeenAt: Date; createdAt: Date; updatedAt: Date };

const state = vi.hoisted(() => ({
  selectRows: [] as unknown[][],
  inserted: [] as unknown[],
  updated: [] as unknown[],
  deleted: [] as unknown[],
}));

function queryResult(rows: unknown[]) {
  const result = Object.assign(rows, {
    orderBy: vi.fn(() => result),
    limit: vi.fn(() => result),
  });
  return result;
}

const mockDb = vi.hoisted(() => ({
  select: vi.fn(() => ({
    from: vi.fn(() => ({
      where: vi.fn(() => queryResult(state.selectRows.shift() ?? [])),
    })),
  })),
  insert: vi.fn(() => ({ values: vi.fn((value: unknown) => { state.inserted.push(value); return Promise.resolve(); }) })),
  update: vi.fn(() => ({ set: vi.fn((value: unknown) => { state.updated.push(value); return { where: vi.fn(() => Promise.resolve([{ affectedRows: 1 }])) }; }) })),
  delete: vi.fn(() => ({ where: vi.fn((condition: unknown) => { state.deleted.push(condition); return Promise.resolve([{ affectedRows: 1 }]); }) })),
}));

vi.mock("drizzle-orm/mysql2", () => ({ drizzle: () => mockDb }));

import { deleteAllOwnedChatSessions, deleteMemoryEntry, deleteOwnedChatSession, listDueMemoryExtractionJobReferences, listMemoryEntries, upsertMemoryEntry } from "./db";

const now = new Date("2026-08-22T10:00:00.000Z");
function row(overrides: Partial<MemoryRow> = {}): MemoryRow {
  return {
    id: "11111111-1111-4111-8111-111111111111", userId: 7, category: "dialog_topic", value: "2026-08-22 Flash: единая память", memoryKey: "topic:fast:единая память", role: "fast", source: "auto", sessionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", sourceMessageId: 11, lastSeenAt: new Date("2026-08-22T09:00:00.000Z"), createdAt: now, updatedAt: now, ...overrides,
  };
}

describe("memory database helper invariants", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    process.env.DATABASE_URL = "mysql://test";
    state.selectRows = [];
    state.inserted = [];
    state.updated = [];
    state.deleted = [];
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("refreshes the same topic only for the same user/chat inside 24 hours and advances lastSeenAt", async () => {
    const existing = row();
    const refreshed = { ...existing, lastSeenAt: new Date("2026-08-22T10:00:00.000Z") };
    state.selectRows = [[existing], [refreshed]];

    const result = await upsertMemoryEntry(7, "dialog_topic", existing.value, { memoryKey: existing.memoryKey, role: "fast", sessionId: existing.sessionId, source: "auto" });

    expect(result).toEqual(refreshed);
    expect(state.updated).toHaveLength(1);
    expect(state.updated[0]).toMatchObject({ value: existing.value, sessionId: existing.sessionId, lastSeenAt: expect.any(Date) });
    expect(state.inserted).toHaveLength(0);
  });

  it("does not merge a matching topic from another chat and never trims entries by capacity", async () => {
    const otherChat = row({ sessionId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" });
    const stored = row({ id: "22222222-2222-4222-8222-222222222222", sessionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" });
    state.selectRows = [[otherChat], [stored]];

    const result = await upsertMemoryEntry(7, "dialog_topic", stored.value, { memoryKey: stored.memoryKey, role: "fast", sessionId: stored.sessionId, source: "auto" });

    expect(result).toEqual(stored);
    expect(state.inserted).toHaveLength(1);
    expect(state.deleted).toHaveLength(0);
  });

  it("returns every fact in lastSeen order and keeps deletion user-scoped", async () => {
    const facts = Array.from({ length: 31 }, (_, index) => row({ id: `fact-${index}`, category: "fact", value: `Факт номер ${index + 1}`, lastSeenAt: new Date(now.getTime() - index * 1_000) }));
    state.selectRows = [facts];

    const listed = await listMemoryEntries(7, "fact");
    const deleted = await deleteMemoryEntry(7, "33333333-3333-4333-8333-333333333333");

    expect(listed).toHaveLength(31);
    expect(listed[0]?.id).toBe("fact-0");
    expect(listed[30]?.id).toBe("fact-30");
    expect(deleted).toBe(true);
  });

  it("cascades only the current user's dialog topics for an owned chat before deleting that chat", async () => {
    state.selectRows = [[{ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }]];

    const deleted = await deleteOwnedChatSession(7, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");

    expect(deleted).toBe(true);
    expect(state.deleted).toHaveLength(2);
    expect(mockDb.delete).toHaveBeenCalledTimes(2);
  });

  it("bulk-deletes only the caller's chats and their dialog topics", async () => {
    state.selectRows = [[{ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }, { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" }]];

    const deletedCount = await deleteAllOwnedChatSessions(7);

    expect(deletedCount).toBe(1);
    expect(state.deleted).toHaveLength(2);
    expect(mockDb.delete).toHaveBeenCalledTimes(2);
  });

  it("returns only bounded text-free references for due extraction jobs", async () => {
    state.selectRows = [[{ userId: 7, assistantMessageId: 101 }, { userId: 8, assistantMessageId: 202 }]];

    const references = await listDueMemoryExtractionJobReferences(99);

    expect(references.map(({ userId, assistantMessageId }) => ({ userId, assistantMessageId }))).toEqual([{ userId: 7, assistantMessageId: 101 }, { userId: 8, assistantMessageId: 202 }]);
    expect(mockDb.select).toHaveBeenCalledWith(expect.objectContaining({ userId: expect.anything(), assistantMessageId: expect.anything() }));
  });
});
