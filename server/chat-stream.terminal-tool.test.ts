/**
 * The server-driven terminal round trip, exercised across two real handler invocations.
 *
 * <p>Each test here runs the handler twice against the same session, because the whole point of the
 * design is that the turn is resumed by a *second HTTP request* carrying its own state. A test that
 * asked one handler to do both halves would pass even with a process-local pending-call map, and
 * would prove nothing about the multi-instance claim.
 */

import { EventEmitter } from "node:events";
import type { Request, Response } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { chatQuota, storedAssistant } = vi.hoisted(() => ({ chatQuota: vi.fn(), storedAssistant: vi.fn() }));
// `clientMessageId` is carried across a whole turn, tool rounds included, so the handler's
// idempotency lookup runs on every request of the turn. It is stubbed here so the tests stay
// offline; the lookup's own behaviour is not what this file is about.
vi.mock("./db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./db")>()),
  consumeChatStreamRequestQuota: chatQuota,
  getStoredAssistantForClientMessage: storedAssistant,
}));

import { createChatStreamHandler, resetChatStreamRateLimits } from "./chat-stream";
import { TERMINAL_TOOL_NAME } from "@shared/terminal-tool";
import type { ChatMessage } from "./providers";

const SESSION_ID = "550e8400-e29b-41d4-a716-446655440000";

const transcriptWindow = (messages = [{ id: 1, role: "user" as const, content: "Где я?", createdAt: new Date(0) }]) => ({
  messages,
  budget: { maxContentChars: 18_000, maxCandidateMessages: 12, maxPriorTurns: 4 },
  candidateCount: messages.length,
  selectedContentChars: messages.reduce((total, message) => total + message.content.length, 0),
  selectedPriorTurns: 0,
  truncated: false,
});

function streamResponse() {
  const writes: string[] = [];
  const res = Object.assign(new EventEmitter(), {
    status: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    flushHeaders: vi.fn(),
    write: vi.fn((chunk: string) => { writes.push(chunk); }),
    end: vi.fn(),
    json: vi.fn(),
  }) as unknown as Response;
  return { res, writes, events: () => writes.join("").match(/event: (\w+)/g)?.map((e) => e.slice(7)) ?? [] };
}

function eventsOf(writes: string[], name: string) {
  return writes
    .filter((chunk) => chunk.includes(`event: ${name}`))
    .map((chunk) => JSON.parse(String(chunk).match(/data: (.+)\n/)?.[1] ?? "{}"));
}

/** A handler whose model turns are scripted, recording the history each round was given. */
function scriptedHandler(options: {
  turns: Array<{ content?: string; toolCalls?: Array<{ id: string; name: string; arguments: string }> }>;
  toolAccess?: boolean;
}) {
  const histories: ChatMessage[][] = [];
  const toolsSeen: unknown[] = [];
  const settingsSeen: Array<Record<string, unknown>> = [];
  const appendChatMessage = vi.fn(async (_userId: number, _sessionId: string, role: string, content: string) => ({ id: role === "user" ? 1 : 2, created: true, role, content }));
  const chatWithRoleStream = vi.fn(async (_modelId: string, history: ChatMessage[], settings: unknown, _onDelta: unknown, _signal: unknown, _actor: unknown, tools: unknown) => {
    histories.push(history);
    settingsSeen.push((settings ?? {}) as Record<string, unknown>);
    toolsSeen.push(tools);
    const turn = options.turns[Math.min(histories.length - 1, options.turns.length - 1)]!;
    return {
      content: turn.content ?? "",
      modelUsed: "test-model",
      provider: "openrouter" as const,
      fallbackUsed: false,
      label: "Test",
      status: { state: "ready" as const, badge: "", category: null, http: null, checkedAt: "", confirmed: "" },
      ...(turn.toolCalls ? { toolCalls: turn.toolCalls.map((c) => ({ id: c.id, type: "function" as const, function: { name: c.name, arguments: c.arguments } })) } : {}),
    };
  });
  const listSessionTranscriptWindow = vi.fn().mockResolvedValue(transcriptWindow());
  const handler = createChatStreamHandler({
    authenticateRequest: vi.fn().mockResolvedValue({ id: 42 }),
    getOwnedChatSession: vi.fn().mockResolvedValue({ id: SESSION_ID, title: "Новый разговор" }),
    appendChatMessage,
    updateChatTitle: vi.fn(),
    listSessionTranscriptWindow,
    buildChatContext: vi.fn().mockResolvedValue({ ...(options.toolAccess === undefined ? {} : { toolAccess: options.toolAccess }) }),
    enqueueMemoryExtractionJob: vi.fn().mockResolvedValue({ created: true }),
    processMemoryExtractionJob: vi.fn().mockResolvedValue(undefined),
    chatWithRoleStream,
    auditChatStream: vi.fn(),
  });
  return { handler, histories, toolsSeen, settingsSeen, appendChatMessage };
}

const firstRequest = (extra: Record<string, unknown> = {}) => ({
  body: { sessionId: SESSION_ID, modelId: "fast", content: "Где я?", clientMessageId: "6f1c1f6e-0f0e-4a3e-9d1a-6a2b3c4d5e6f", localTerminal: true, ...extra },
}) as unknown as Request;

describe("the server hands a requested command to the device", () => {
  beforeEach(() => {
    resetChatStreamRateLimits();
    chatQuota.mockReset().mockResolvedValue({ allowed: true, retryAfterSeconds: 0 });
    storedAssistant.mockReset().mockResolvedValue(null);
  });

  it("emits a tool_call event carrying a callId, the name and the arguments", async () => {
    const { handler } = scriptedHandler({ turns: [{ toolCalls: [{ id: "provider-id", name: TERMINAL_TOOL_NAME, arguments: '{"command":"pwd"}' }] }] });
    const { res, writes, events } = streamResponse();

    await handler(firstRequest(), res, vi.fn());

    const [call] = eventsOf(writes, "tool_call");
    expect(call).toMatchObject({ name: TERMINAL_TOOL_NAME, arguments: '{"command":"pwd"}', unsupported: false });
    expect(typeof call!.callId).toBe("string");
    expect(call!.callId).toMatch(/^call_[0-9a-f]{32}$/);
    // The continuation must not echo a provider-supplied id: the server rebuilds the assistant
    // message itself and has to choose both halves of the tool_call_id pair.
    expect(call!.callId).not.toBe("provider-id");
    expect(typeof call!.continuation).toBe("string");
    expect(events()).toEqual(["start", "tool_call"]);
  });

  it("never emits done before the continuation has been answered", async () => {
    const { handler } = scriptedHandler({ turns: [{ toolCalls: [{ id: "p", name: TERMINAL_TOOL_NAME, arguments: "{}" }] }] });
    const { res, writes } = streamResponse();
    await handler(firstRequest(), res, vi.fn());
    expect(writes.join("")).not.toContain("event: done");
    expect(res.end).toHaveBeenCalledOnce();
  });

  it("offers no tools at all to a client that did not declare a local terminal", async () => {
    const { handler, toolsSeen, histories } = scriptedHandler({ turns: [{ content: "Обычный ответ" }] });
    const { res } = streamResponse();
    await handler(firstRequest({ localTerminal: undefined }), res, vi.fn());
    expect(toolsSeen[0]).toBeUndefined();
    expect(histories[0]).toEqual([{ role: "user", content: "Где я?" }]);
  });

  it("offers no tools to a web-shaped myApi turn, leaving the client-side loop as the only path", async () => {
    const { handler, toolsSeen } = scriptedHandler({ turns: [{ content: "Ответ" }] });
    const { res } = streamResponse();
    await handler(firstRequest({ myApi: true }), res, vi.fn());
    expect(toolsSeen[0]).toBeUndefined();
  });

  it("offers no tools when the account has toolAccess switched off", async () => {
    const { handler, toolsSeen } = scriptedHandler({ turns: [{ content: "Ответ" }], toolAccess: false });
    const { res } = streamResponse();
    await handler(firstRequest(), res, vi.fn());
    expect(toolsSeen[0]).toBeUndefined();
  });

  it("offers the shared terminal tool definition, not a copy", async () => {
    const { handler, toolsSeen } = scriptedHandler({ turns: [{ content: "Ответ" }], toolAccess: true });
    const { res } = streamResponse();
    await handler(firstRequest(), res, vi.fn());
    expect(toolsSeen[0]).toEqual([expect.objectContaining({ function: expect.objectContaining({ name: TERMINAL_TOOL_NAME }) })]);
  });

  it("tells the model about the terminal on a turn that offers it", async () => {
    const { handler, settingsSeen } = scriptedHandler({ turns: [{ content: "Ответ" }], toolAccess: true });
    const { res } = streamResponse();
    await handler(firstRequest(), res, vi.fn());
    expect(settingsSeen[0]).toMatchObject({ terminalTool: true });
  });

  it("says nothing about a terminal when the client declared none", async () => {
    const { handler, settingsSeen } = scriptedHandler({ turns: [{ content: "Ответ" }] });
    const { res } = streamResponse();
    await handler(firstRequest({ localTerminal: undefined }), res, vi.fn());
    expect(settingsSeen[0]!.terminalTool).toBeUndefined();
  });

  it("says nothing about a terminal on a myApi turn", async () => {
    // A myApi turn runs against the caller's own provider through a different function, so it never
    // reaches the prompt that would mention the terminal. Asserting the prompt builder was not asked
    // to build one is stronger than asserting the text is absent from a turn that never had it.
    const { handler, settingsSeen } = scriptedHandler({ turns: [{ content: "Ответ" }] });
    const { res } = streamResponse();
    await handler(firstRequest({ myApi: true }), res, vi.fn());
    expect(settingsSeen).toEqual([]);
  });

  it("says nothing about a terminal when the account switched tools off", async () => {
    const { handler, settingsSeen } = scriptedHandler({ turns: [{ content: "Ответ" }], toolAccess: false });
    const { res } = streamResponse();
    await handler(firstRequest(), res, vi.fn());
    expect(settingsSeen[0]!.terminalTool).toBeUndefined();
  });

  it("reports an invented tool as unsupported instead of pretending it can run", async () => {
    const { handler } = scriptedHandler({ turns: [{ toolCalls: [{ id: "p", name: "send_email", arguments: '{"to":"a@b.c"}' }] }] });
    const { res, writes } = streamResponse();
    await handler(firstRequest(), res, vi.fn());
    const [call] = eventsOf(writes, "tool_call");
    expect(call).toMatchObject({ name: "send_email", unsupported: true, continuation: null });
    // Nothing is signed, so there is nothing a client could come back with.
    expect(call!.continuation).toBeNull();
  });
});

describe("a continuation resumes the turn from the signed call", () => {
  beforeEach(() => {
    resetChatStreamRateLimits();
    chatQuota.mockReset().mockResolvedValue({ allowed: true, retryAfterSeconds: 0 });
    storedAssistant.mockReset().mockResolvedValue(null);
  });

  it("sends the assistant tool_calls and the matching role=tool result on the next turn", async () => {
    const { handler, histories } = scriptedHandler({ turns: [{ toolCalls: [{ id: "p", name: TERMINAL_TOOL_NAME, arguments: '{"command":"pwd"}' }] }, { content: "Ты в /home/kairema" }] });
    const first = streamResponse();
    await handler(firstRequest(), first.res, vi.fn());
    const call = eventsOf(first.writes, "tool_call")[0]!;

    const second = streamResponse();
    await handler({
      body: {
        sessionId: SESSION_ID, modelId: "fast", clientMessageId: "6f1c1f6e-0f0e-4a3e-9d1a-6a2b3c4d5e6f",
        localTerminal: true,
        toolResult: { continuation: call.continuation, result: { ok: true, stdout: "/home/kairema", stderr: "", exitCode: 0, timedOut: false, truncated: false, confirmationRequired: false } },
      },
    } as unknown as Request, second.res, vi.fn());

    // The resumed history carries the previous question, the assistant turn that asked, and the
    // result keyed to the very id that turn used.
    expect(histories[1]).toEqual([
      { role: "user", content: "Где я?" },
      { role: "assistant", content: "", tool_calls: [{ id: call.callId, type: "function", function: { name: TERMINAL_TOOL_NAME, arguments: '{"command":"pwd"}' } }] },
      { role: "tool", tool_call_id: call.callId, name: TERMINAL_TOOL_NAME, content: JSON.stringify({ ok: true, stdout: "/home/kairema", stderr: "", exitCode: 0, timedOut: false, truncated: false, confirmationRequired: false }) },
    ]);
    expect(second.writes.join("")).toContain("event: done");
    expect(eventsOf(second.writes, "done")[0]).toMatchObject({ content: "Ты в /home/kairema" });
  });

  it("resumes a second tool round rather than ending the turn", async () => {
    const { handler, histories } = scriptedHandler({ turns: [
      { toolCalls: [{ id: "p1", name: TERMINAL_TOOL_NAME, arguments: '{"command":"cd test"}' }] },
      { toolCalls: [{ id: "p2", name: TERMINAL_TOOL_NAME, arguments: '{"command":"pwd"}' }] },
      { content: "Готово" },
    ] });
    const first = streamResponse();
    await handler(firstRequest(), first.res, vi.fn());
    const callOne = eventsOf(first.writes, "tool_call")[0]!;

    const second = streamResponse();
    await handler({
      body: { sessionId: SESSION_ID, modelId: "fast", clientMessageId: "6f1c1f6e-0f0e-4a3e-9d1a-6a2b3c4d5e6f", localTerminal: true, toolResult: { continuation: callOne.continuation, result: { ok: true, stdout: "", exitCode: 0 } } },
    } as unknown as Request, second.res, vi.fn());

    expect(second.writes.join("")).toContain("event: tool_call");
    expect(second.writes.join("")).not.toContain("event: done");
    const callTwo = eventsOf(second.writes, "tool_call")[0]!;
    expect(callTwo.callId).not.toBe(callOne.callId);

    const third = streamResponse();
    await handler({
      body: { sessionId: SESSION_ID, modelId: "fast", clientMessageId: "6f1c1f6e-0f0e-4a3e-9d1a-6a2b3c4d5e6f", localTerminal: true, toolResult: { continuation: callTwo.continuation, result: { ok: true, stdout: "/home/kairema/test", exitCode: 0 } } },
    } as unknown as Request, third.res, vi.fn());

    expect(third.writes.join("")).toContain("event: done");
    // Three rounds, three provider turns, and the second history already held the first round-trip.
    expect(histories).toHaveLength(3);
    expect(histories[2]!.filter((m) => m.role === "tool")).toHaveLength(2);
  });

  it("adds no second user message for a continuation", async () => {
    const { handler, appendChatMessage } = scriptedHandler({ turns: [{ toolCalls: [{ id: "p", name: TERMINAL_TOOL_NAME, arguments: "{}" }] }, { content: "Готово" }] });
    const first = streamResponse();
    await handler(firstRequest(), first.res, vi.fn());
    const call = eventsOf(first.writes, "tool_call")[0]!;
    const second = streamResponse();
    await handler({
      body: { sessionId: SESSION_ID, modelId: "fast", clientMessageId: "6f1c1f6e-0f0e-4a3e-9d1a-6a2b3c4d5e6f", localTerminal: true, toolResult: { continuation: call.continuation, result: { ok: true, exitCode: 0 } } },
    } as unknown as Request, second.res, vi.fn());
    expect(appendChatMessage.mock.calls.filter(([, , role]) => role === "user")).toHaveLength(1);
  });

  it("derives context for a continuation from the original question", async () => {
    const { handler } = scriptedHandler({ turns: [{ toolCalls: [{ id: "p", name: TERMINAL_TOOL_NAME, arguments: "{}" }] }, { content: "Готово" }] });
    const first = streamResponse();
    await handler(firstRequest(), first.res, vi.fn());
    const call = eventsOf(first.writes, "tool_call")[0]!;
    const { appendChatMessage } = scriptedHandler({ turns: [{ content: "x" }] });
    const buildSpy = vi.fn().mockResolvedValue({ toolAccess: true });
    const local = createChatStreamHandler({
      authenticateRequest: vi.fn().mockResolvedValue({ id: 42 }),
      getOwnedChatSession: vi.fn().mockResolvedValue({ id: SESSION_ID, title: "Разговор" }),
      appendChatMessage, updateChatTitle: vi.fn(),
      listSessionTranscriptWindow: vi.fn().mockResolvedValue(transcriptWindow()),
      buildChatContext: buildSpy,
      enqueueMemoryExtractionJob: vi.fn(), processMemoryExtractionJob: vi.fn(),
      chatWithRoleStream: vi.fn().mockResolvedValue({ content: "Готово", modelUsed: "m", provider: "openrouter", fallbackUsed: false, label: "T", status: { state: "ready", badge: "", category: null, http: null, checkedAt: "", confirmed: "" } }),
      auditChatStream: vi.fn(),
    });
    const second = streamResponse();
    await local({
      body: { sessionId: SESSION_ID, modelId: "fast", clientMessageId: "6f1c1f6e-0f0e-4a3e-9d1a-6a2b3c4d5e6f", localTerminal: true, toolResult: { continuation: call.continuation, result: { ok: true, exitCode: 0 } } },
    } as unknown as Request, second.res, vi.fn());
    expect(buildSpy.mock.calls[0]?.[2]).toMatchObject({ query: "Где я?" });
  });
});

describe("a continuation is refused unless it verifies", () => {
  beforeEach(() => {
    resetChatStreamRateLimits();
    chatQuota.mockReset().mockResolvedValue({ allowed: true, retryAfterSeconds: 0 });
    storedAssistant.mockReset().mockResolvedValue(null);
  });

  const badRequests: Array<[string, Record<string, unknown>]> = [
    ["a malformed token", { continuation: "not-a-token", result: { ok: true, exitCode: 0 } }],
    ["an empty token", { continuation: "", result: { ok: true, exitCode: 0 } }],
    ["a result that is not an object", { continuation: "x.y", result: "stdout" }],
    ["a non-string stdout", { continuation: "x.y", result: { stdout: { nested: true } } }],
  ];

  it.each(badRequests)("rejects %s", async (_label, toolResult) => {
    const { handler, histories } = scriptedHandler({ turns: [{ content: "Ответ" }] });
    const { res } = streamResponse();
    await handler({ body: { sessionId: SESSION_ID, modelId: "fast", localTerminal: true, toolResult } } as unknown as Request, res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(400);
    expect(histories).toHaveLength(0);
  });

  it("rejects a continuation whose token belongs to another session", async () => {
    const { handler } = scriptedHandler({ turns: [{ toolCalls: [{ id: "p", name: TERMINAL_TOOL_NAME, arguments: "{}" }] }, { content: "x" }] });
    const first = streamResponse();
    await handler(firstRequest(), first.res, vi.fn());
    const call = eventsOf(first.writes, "tool_call")[0]!;
    const { handler: other, histories } = scriptedHandler({ turns: [{ content: "y" }] });
    const res = streamResponse();
    await other({
      body: { sessionId: "99999999-9999-4999-8999-999999999999", modelId: "fast", localTerminal: true, toolResult: { continuation: call.continuation, result: { ok: true, exitCode: 0 } } },
    } as unknown as Request, res.res, vi.fn());
    expect(res.res.status).toHaveBeenCalledWith(400);
    expect(histories).toHaveLength(0);
  });

  it("rejects a continuation once the account has turned tools off", async () => {
    const mintHandler = scriptedHandler({ turns: [{ toolCalls: [{ id: "p", name: TERMINAL_TOOL_NAME, arguments: "{}" }] }] });
    const first = streamResponse();
    await mintHandler.handler(firstRequest(), first.res, vi.fn());
    const call = eventsOf(first.writes, "tool_call")[0]!;
    const { handler, histories } = scriptedHandler({ turns: [{ content: "x" }], toolAccess: false });
    const res = streamResponse();
    await handler({
      body: { sessionId: SESSION_ID, modelId: "fast", localTerminal: true, toolResult: { continuation: call.continuation, result: { ok: true, exitCode: 0 } } },
    } as unknown as Request, res.res, vi.fn());
    expect(res.res.status).toHaveBeenCalledWith(400);
    expect(histories).toHaveLength(0);
  });

  it("refuses a request with neither a question nor a tool result", async () => {
    const { handler } = scriptedHandler({ turns: [{ content: "x" }] });
    const res = streamResponse();
    await handler({ body: { sessionId: SESSION_ID, modelId: "fast" } } as unknown as Request, res.res, vi.fn());
    expect(res.res.status).toHaveBeenCalledWith(400);
  });
});