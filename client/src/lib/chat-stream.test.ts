/**
 * How the client reads a stream that paused for a command.
 *
 * <p>The distinction this file protects is the one between "the turn is over" and "the turn is
 * waiting". A stream that ends after a `tool_call` has no `done` and that is correct, so the reader
 * must report a pause rather than raising the same error it raises for a connection that died
 * mid-answer.
 */

import { describe, expect, it, vi } from "vitest";
import { consumeChatStream, sseEventFromBlock } from "./chat-stream";

function streamOf(chunks: string[]) {
  const encoder = new TextEncoder();
  let index = 0;
  return {
    body: {
      getReader: () => ({
        read: async () => (index < chunks.length ? { done: false, value: encoder.encode(chunks[index++]!) } : { done: true, value: undefined }),
      }),
    },
  } as unknown as Response;
}

const toolCallFrame = (payload: Record<string, unknown>) => `event: tool_call\ndata: ${JSON.stringify(payload)}\n\n`;

describe("a turn that pauses for a command", () => {
  it("reports the call and refuses to call it finished", async () => {
    const calls: unknown[] = [];
    const onDone = vi.fn();
    const outcome = await consumeChatStream(streamOf([
      `event: start\ndata: {"sessionId":"s"}\n\n`,
      toolCallFrame({ callId: "call_1", name: "terminal", arguments: '{"command":"pwd"}', unsupported: false, continuation: "signed.token" }),
    ]), { onDelta: vi.fn(), onDone, onToolCall: (call) => calls.push(call) });

    expect(outcome).toEqual({ completed: false, awaitingTool: true });
    expect(onDone).not.toHaveBeenCalled();
    expect(calls).toEqual([{ callId: "call_1", name: "terminal", arguments: '{"command":"pwd"}', unsupported: false, continuation: "signed.token" }]);
  });

  it("does not throw the dropped-connection error on a pause", async () => {
    await expect(consumeChatStream(streamOf([toolCallFrame({ callId: "c", name: "terminal", arguments: "{}", unsupported: false, continuation: "t" })]), { onDelta: vi.fn(), onDone: vi.fn(), onToolCall: vi.fn() })).resolves.toBeTruthy();
  });

  it("never shows a command as assistant text", async () => {
    const onDelta = vi.fn();
    await consumeChatStream(streamOf([`event: delta\ndata: {"content":"before"}\n\n`, toolCallFrame({ callId: "c", name: "terminal", arguments: '{"command":"rm -rf /"}', unsupported: false, continuation: "t" })]), { onDelta, onDone: vi.fn(), onToolCall: vi.fn() });
    expect(onDelta.mock.calls).toEqual([["before"]]);
  });

  it("still throws when a stream ends without either an answer or a call", async () => {
    await expect(consumeChatStream(streamOf([`event: delta\ndata: {"content":"half"}\n\n`]), { onDelta: vi.fn(), onDone: vi.fn(), onToolCall: vi.fn() })).rejects.toThrow(/Поток завершился/);
  });

  it("treats a malformed frame as no call rather than as a command", async () => {
    const onToolCall = vi.fn();
    await consumeChatStream(streamOf([toolCallFrame({ name: "terminal" })]), { onDelta: vi.fn(), onDone: vi.fn(), onToolCall });
    expect(onToolCall).not.toHaveBeenCalled();
  });

  it("defaults missing fields instead of passing undefined into the runner", async () => {
    const calls: Array<Record<string, unknown>> = [];
    await consumeChatStream(streamOf([toolCallFrame({ callId: "c", name: "shell", unsupported: "yes", continuation: 7 })]), { onDelta: vi.fn(), onDone: vi.fn(), onToolCall: (call) => calls.push(call) });
    expect(calls[0]).toEqual({ callId: "c", name: "shell", arguments: "{}", unsupported: false, continuation: null });
  });
});

describe("a normal turn", () => {
  it("completes as before", async () => {
    const deltas: string[] = [];
    const outcome = await consumeChatStream(streamOf([
      `event: delta\ndata: {"content":"a"}\n\n`,
      `event: delta\ndata: {"content":"b"}\n\n`,
      `event: done\ndata: {"content":"ab"}\n\n`,
    ]), { onDelta: (content) => deltas.push(content), onDone: vi.fn() });
    expect(deltas).toEqual(["a", "b"]);
    expect(outcome).toEqual({ completed: true, awaitingTool: false });
  });

  it("joins a frame split across two reads", async () => {
    const calls: unknown[] = [];
    await consumeChatStream(streamOf([`event: tool_ca`, `ll\ndata: {"callId":"c","name":"terminal","arguments":"{}","continuation":"t"}\n\n`]), { onDelta: vi.fn(), onDone: vi.fn(), onToolCall: (call) => calls.push(call) });
    expect(calls).toHaveLength(1);
  });
});

describe("frame parsing", () => {
  it("reads the event name and its data", () => {
    expect(sseEventFromBlock(`event: delta\ndata: {"content":"x"}`)).toEqual({ event: "delta", data: { content: "x" } });
  });

  it("falls back to a plain message event", () => {
    expect(sseEventFromBlock(`data: {"a":1}`)).toEqual({ event: "message", data: { a: 1 } });
  });
});