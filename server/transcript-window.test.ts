import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { selectTranscriptWindow, TRANSCRIPT_WINDOW_BUDGETS, type TranscriptMessage } from "./transcript-window";

function message(id: number, role: "user" | "assistant", content = `${role}-${id}`): TranscriptMessage {
  return { id, role, content, createdAt: new Date(id * 1_000) };
}

function sourceBetween(source: string, start: string, end: string) {
  const offset = source.indexOf(start);
  if (offset < 0) throw new Error(`Missing start marker: ${start}`);
  const tail = source.slice(offset);
  const endOffset = tail.indexOf(end);
  if (endOffset < 0) throw new Error(`Missing end marker: ${end}`);
  return tail.slice(0, endOffset);
}

describe("transcript-window selector", () => {
  it("declares bounded, role-specific policies that leave the 16K active ingress intact", () => {
    expect(TRANSCRIPT_WINDOW_BUDGETS).toEqual({
      fast: { maxContentChars: 18_000, maxCandidateMessages: 12, maxPriorTurns: 4 },
      smart: { maxContentChars: 30_000, maxCandidateMessages: 20, maxPriorTurns: 8 },
      context: { maxContentChars: 48_000, maxCandidateMessages: 32, maxPriorTurns: 14 },
      flagship: { maxContentChars: 40_000, maxCandidateMessages: 28, maxPriorTurns: 12 },
    });
  });

  it("retains a chronological contiguous tail of complete prior exchanges and the active user request", () => {
    const candidates = [
      message(1, "user"), message(2, "assistant"), message(3, "user"), message(4, "assistant"),
      message(5, "user"), message(6, "assistant"), message(7, "user"), message(8, "assistant"),
      message(9, "user"), message(10, "assistant"), message(11, "user", "active request"),
    ];
    const selected = selectTranscriptWindow("fast", [...candidates].reverse());

    expect(selected.messages.map((item) => item.id)).toEqual([3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(selected.messages.at(-1)).toMatchObject({ role: "user", content: "active request" });
    expect(selected.selectedPriorTurns).toBe(4);
    expect(selected.truncated).toBe(true);
  });

  it("keeps a complete short conversation unchanged when it already fits the role budget", () => {
    const candidates = [message(1, "user", "short question"), message(2, "assistant", "short answer"), message(3, "user", "next question")];
    const selected = selectTranscriptWindow("fast", candidates);

    expect(selected.messages).toEqual(candidates);
    expect(selected.truncated).toBe(false);
    expect(selected.selectedPriorTurns).toBe(1);
  });

  it("keeps the active user request while refusing partial older exchanges when the char budget is exhausted", () => {
    const active = message(3, "user", "a".repeat(16_000));
    const selected = selectTranscriptWindow("fast", [message(1, "user", "b".repeat(1_500)), message(2, "assistant", "c".repeat(1_000)), active]);

    expect(selected.messages).toEqual([active]);
    expect(selected.selectedContentChars).toBe(16_000);
    expect(selected.selectedContentChars).toBeLessThanOrEqual(TRANSCRIPT_WINDOW_BUDGETS.fast.maxContentChars);
    expect(selected.truncated).toBe(true);
  });

  it("bounds a very long conversation deterministically without arbitrary non-contiguous sampling", () => {
    const candidates = Array.from({ length: 201 }, (_, index) => message(index + 1, index === 200 || index % 2 === 0 ? "user" : "assistant"));
    const selected = selectTranscriptWindow("context", candidates);

    expect(selected.messages).toHaveLength(29);
    expect(selected.messages.map((item) => item.id)).toEqual(Array.from({ length: 29 }, (_, index) => index + 173));
    expect(selected.messages.at(-1)?.id).toBe(201);
    expect(selected.selectedContentChars).toBeLessThanOrEqual(TRANSCRIPT_WINDOW_BUDGETS.context.maxContentChars);
    expect(selected.truncated).toBe(true);
  });

  it("does not form an LLM transcript without a user request and never mutates caller-owned rows", () => {
    const candidates = [message(1, "assistant", "orphan")];
    const snapshot = JSON.stringify(candidates);
    const selected = selectTranscriptWindow("context", candidates);

    expect(selected.messages).toEqual([]);
    expect(selected.truncated).toBe(true);
    expect(JSON.stringify(candidates)).toBe(snapshot);
  });

  it("filters missing/duplicate records before selection and keeps deterministic chronological ordering", () => {
    const candidates = [
      null as unknown as TranscriptMessage,
      message(3, "user", "active"),
      message(1, "user", "first"),
      message(2, "assistant", "reply"),
      message(1, "user", "duplicate must not win"),
      { id: 4, role: "system" as "user", content: "invalid role", createdAt: new Date(4_000) },
    ];
    const selected = selectTranscriptWindow("smart", candidates);

    expect(selected.messages.map((item) => [item.id, item.content])).toEqual([[1, "first"], [2, "reply"], [3, "active"]]);
  });

  it("handles concurrent/newer rows only through an explicit stored upper anchor", () => {
    const source = readFileSync(new URL("./db.ts", import.meta.url), "utf8");
    const boundedHelper = sourceBetween(source, "export async function listSessionTranscriptWindow", "/**\n * Opt-in user-scoped history page");

    expect(boundedHelper).toContain("throughMessageId");
    expect(boundedHelper).toContain("requireOwnedSession(userId, await getOwnedChatSession(userId, sessionId))");
    expect(boundedHelper).toContain("eq(messages.sessionId, sessionId)");
    expect(boundedHelper).toContain("lte(messages.id, boundaryRecord.id)");
    expect(boundedHelper).toContain("orderBy(desc(messages.createdAt), desc(messages.id)).limit(budget.maxCandidateMessages)");
    expect(boundedHelper).toContain("return selectTranscriptWindow(role, [...newestFirst].reverse())");
    expect(boundedHelper).not.toContain("listSessionMessages(userId, sessionId)");
  });
});

describe("LLM entrypoints use the bounded transcript path", () => {
  it("uses anchor-bounded reader after save and excludes the regenerated assistant target", () => {
    const source = readFileSync(new URL("./chat-stream.ts", import.meta.url), "utf8");
    const handler = sourceBetween(source, "export function createChatStreamHandler", "export function registerChatStreamRoute");

    expect(handler).toContain("listSessionTranscriptWindow(user.id, input.sessionId, input.modelId, { throughMessageId: append.id })");
    expect(handler).toContain("listSessionTranscriptWindow(user.id, input.sessionId, input.modelId, { beforeMessageId: target.id })");
    expect(handler).toContain("const storedSettings = await dependencies.buildChatContext(user.id, input.sessionId");
    expect(handler).toContain("dependencies.chatWithRoleStream(");
    expect(handler).toContain("(transcript?.messages ?? []).map((message) => ({ role: message.role, content: message.content }))");
    expect(handler).not.toContain("listSessionMessages(user.id, input.sessionId)");
  });

  it("uses the same bounded reader in the protected non-stream route while leaving public history endpoint intact", () => {
    const source = readFileSync(new URL("./routers.ts", import.meta.url), "utf8");
    const send = sourceBetween(source, "send: protectedProcedure", "  }),\n});");

    expect(send).toContain("listSessionTranscriptWindow(ctx.user.id, input.sessionId, input.modelId, { throughMessageId: savedUser.id })");
    expect(send).not.toContain("listSessionMessages(ctx.user.id, input.sessionId)");
    expect(source).toContain("messages: protectedProcedure");
  });
});
