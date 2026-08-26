import { createHmac, timingSafeEqual } from "node:crypto";

export const HISTORY_PAGE_DEFAULT_LIMIT = 60;
export const HISTORY_PAGE_MAX_LIMIT = 100;

export type HistoryPageCursor = {
  createdAt: number;
  id: number;
  sessionTag: string;
};

function historyCursorSessionTag(secret: string, sessionId: string) {
  return createHmac("sha256", secret).update(`history-page-session:v1:${sessionId}`).digest("base64url").slice(0, 24);
}

function historyCursorSignature(secret: string, payload: string) {
  return createHmac("sha256", secret).update(`history-page-cursor:v1:${payload}`).digest("base64url");
}

export function normalizeHistoryPageLimit(value: number | undefined) {
  return Math.min(Math.max(value ?? HISTORY_PAGE_DEFAULT_LIMIT, 1), HISTORY_PAGE_MAX_LIMIT);
}

/** Creates a signed, session-bound cursor with no content or user identifier. */
export function encodeHistoryPageCursor(secret: string, sessionId: string, point: Pick<HistoryPageCursor, "id" | "createdAt">) {
  const payload = Buffer.from(JSON.stringify({
    createdAt: point.createdAt,
    id: point.id,
    sessionTag: historyCursorSessionTag(secret, sessionId),
  }), "utf8").toString("base64url");
  return `${payload}.${historyCursorSignature(secret, payload)}`;
}

/** Returns null for malformed, tampered or cross-session cursors. */
export function decodeHistoryPageCursor(secret: string, sessionId: string, cursor: string): HistoryPageCursor | null {
  const parts = cursor.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  const expected = historyCursorSignature(secret, parts[0]);
  const given = Buffer.from(parts[1]);
  const expectedBuffer = Buffer.from(expected);
  if (given.length !== expectedBuffer.length || !timingSafeEqual(given, expectedBuffer)) return null;
  try {
    const value = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8")) as Partial<HistoryPageCursor>;
    if (!Number.isFinite(value.createdAt) || !Number.isInteger(value.id) || (value.id ?? 0) <= 0 || value.sessionTag !== historyCursorSessionTag(secret, sessionId)) return null;
    const createdAt = new Date(value.createdAt!);
    return Number.isNaN(createdAt.getTime()) ? null : { createdAt: createdAt.getTime(), id: value.id!, sessionTag: value.sessionTag };
  } catch {
    return null;
  }
}
