import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const dbSource = readFileSync(resolve(import.meta.dirname, "db.ts"), "utf8");
const schemaSource = readFileSync(resolve(import.meta.dirname, "../drizzle/schema.ts"), "utf8");

function sourceBetween(startMarker: string, endMarker: string) {
  const start = dbSource.indexOf(startMarker);
  const end = dbSource.indexOf(endMarker, start);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return dbSource.slice(start, end);
}

describe("scale-safe database hot paths", () => {
  it("keeps idempotent replay owner-scoped and avoids loading complete chat history", () => {
    const source = sourceBetween("export async function getStoredAssistantForClientMessage", "export async function updateChatTitle");
    expect(source).toContain("getOwnedChatSession(userId, sessionId)");
    expect(source).toContain("eq(messages.clientMessageId, clientMessageId)");
    expect(source).toContain("gt(messages.id, userMessage.id)");
    expect(source).toContain(".limit(1)");
    expect(source).toContain("return followingMessage?.role === \"assistant\" ? followingMessage : undefined");
    expect(source).not.toContain("listSessionMessages(userId, sessionId)");
    expect(source).not.toContain("eq(messages.role, \"assistant\"),");
  });

  it("claims at most one due memory job in SQL before the atomic update", () => {
    const source = sourceBetween("export async function claimMemoryExtractionJob", "export type MemoryExtractionJobReference");
    expect(source).toContain("and(...conditions)");
    expect(source).toContain(".limit(1)");
    expect(source).toContain("eq(memoryExtractionJobs.status, candidate.status)");
    expect(source).toContain("eq(memoryExtractionJobs.attempts, candidate.attempts)");
    expect(source).not.toContain("rows.find");
  });

  it("reads only the owned extraction message pair instead of session history", () => {
    const source = sourceBetween("export async function getMemoryExtractionJobTurn", "export async function completeMemoryExtractionJob");
    expect(source).toContain("getOwnedChatSession(userId, job.sessionId)");
    expect(source).toContain("eq(messages.id, job.userMessageId)");
    expect(source).toContain("eq(messages.id, job.assistantMessageId)");
    expect(source).toContain("Promise.all");
    expect(source).not.toContain("select().from(messages).where(eq(messages.sessionId, job.sessionId))");
  });

  it("keeps user-facing memory lists complete while allowing the server context to request a bounded SQL window", () => {
    const source = sourceBetween("export async function listMemoryEntries", "export async function upsertMemoryEntry");
    expect(source).toContain("options: { limit?: number } = {}")
    expect(source).toContain("const rows = limit > 0 ? await query.limit(limit) : await query")
    expect(source).toContain("Math.min(requestedLimit, 100)")
  });

  it("keeps durable ordinary chat ingress quota separate from the admin-only Dev API quota", () => {
    const source = sourceBetween("export async function consumeChatStreamRequestQuota", "export async function recordDevApiAudit");
    expect(schemaSource).toContain('mysqlTable("chat_stream_rate_windows"');
    expect(source).toContain("db.insert(chatStreamRateWindows)");
    expect(source).toContain("eq(chatStreamRateWindows.userId, userId)");
    expect(source).not.toContain("devApiRateWindows");
  });

  it("keeps SSE active-stream capacity bounded locally and releases reservation in a finally block", () => {
    const streamSource = readFileSync(resolve(import.meta.dirname, "chat-stream.ts"), "utf8");
    expect(streamSource).toContain("CHAT_STREAM_MAX_ACTIVE_PER_INSTANCE = 12");
    expect(streamSource).toContain("CHAT_STREAM_MAX_ACTIVE_PER_USER = 2");
    expect(streamSource).toContain("const activeStream = reserveActiveChatStream(user.id)");
    expect(streamSource).toContain("releaseActiveStream?.();");
  });
});
