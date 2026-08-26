import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { decodeHistoryPageCursor, encodeHistoryPageCursor, HISTORY_PAGE_DEFAULT_LIMIT, HISTORY_PAGE_MAX_LIMIT, normalizeHistoryPageLimit } from "./history-pagination";

const dbSource = readFileSync(resolve(import.meta.dirname, "db.ts"), "utf8");

function sourceBetween(startMarker: string, endMarker: string) {
  const start = dbSource.indexOf(startMarker);
  const end = dbSource.indexOf(endMarker, start);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return dbSource.slice(start, end);
}

describe("opt-in history pagination", () => {
  const secret = "deterministic-test-secret";
  const sessionId = "session-a";

  it("uses a bounded page-size policy without exposing a zero or unbounded request", () => {
    expect(HISTORY_PAGE_DEFAULT_LIMIT).toBe(60);
    expect(HISTORY_PAGE_MAX_LIMIT).toBe(100);
    expect(normalizeHistoryPageLimit(undefined)).toBe(60);
    expect(normalizeHistoryPageLimit(0)).toBe(1);
    expect(normalizeHistoryPageLimit(-12)).toBe(1);
    expect(normalizeHistoryPageLimit(7)).toBe(7);
    expect(normalizeHistoryPageLimit(10_000)).toBe(100);
  });

  it("accepts only a signed cursor for its original session and exposes no session identifier", () => {
    const cursor = encodeHistoryPageCursor(secret, sessionId, { createdAt: 1_725_000_000_000, id: 42 });
    expect(cursor).not.toContain(sessionId);
    expect(decodeHistoryPageCursor(secret, sessionId, cursor)).toMatchObject({ createdAt: 1_725_000_000_000, id: 42 });
    expect(decodeHistoryPageCursor(secret, "session-b", cursor)).toBeNull();
  });

  it("rejects malformed and tampered cursors deterministically", () => {
    const cursor = encodeHistoryPageCursor(secret, sessionId, { createdAt: 1_725_000_000_000, id: 42 });
    expect(decodeHistoryPageCursor(secret, sessionId, "not-a-cursor")).toBeNull();
    expect(decodeHistoryPageCursor(secret, sessionId, `${cursor}x`)).toBeNull();
    expect(decodeHistoryPageCursor("different-secret", sessionId, cursor)).toBeNull();
  });

  it("keeps the paged DB helper owned, cursor-scoped, newest-first for retrieval and chronological for UI output", () => {
    const source = sourceBetween("export async function listSessionMessagesPage", "/**\n * Appends a message once");
    expect(source).toContain("requireOwnedSession(userId, await getOwnedChatSession(userId, sessionId))");
    expect(source).toContain("decodeHistoryPageCursor(cursorSecret, sessionId, input.before)");
    expect(source).toContain("or(lt(messages.createdAt, beforeDate), and(eq(messages.createdAt, beforeDate), lt(messages.id, cursor.id)))");
    expect(source).toContain("orderBy(desc(messages.createdAt), desc(messages.id)).limit(limit + 1)");
    expect(source).toContain("messages: [...newestFirstPage].reverse()");
    expect(source).toContain("nextCursor: hasOlder && oldest");
    expect(source).not.toContain("listSessionMessages(userId, sessionId)");
  });

  it("preserves the legacy full-history helper for existing provider, export and compatibility callers", () => {
    const legacy = sourceBetween("export async function listSessionMessages", "/** Resolves exactly one message after the same verified session ownership boundary. */");
    expect(legacy).toContain("orderBy(asc(messages.createdAt), asc(messages.id))");
    expect(legacy).not.toContain(".limit(");
  });
});
