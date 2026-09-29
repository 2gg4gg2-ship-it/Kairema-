import { describe, expect, it } from "vitest";

import {
  createReasoningFilter,
  dataFromSseBlock,
  readEventStream,
  streamDelta,
  streamError,
  streamFinishReason,
  streamUsage,
} from "@shared/provider-stream";

const encoder = new TextEncoder();

function bodyFrom(chunks: string[]) {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

/** Collects the visible text of a stream exactly as the real consumers do. */
async function collect(chunks: string[], signal?: AbortSignal) {
  const parts: string[] = [];
  const reasoning = createReasoningFilter();
  const outcome = await readEventStream({
    body: bodyFrom(chunks),
    ...(signal ? { signal } : {}),
    onFrame: (payload) => {
      const visible = reasoning(streamDelta(payload), false);
      if (visible) parts.push(visible);
    },
  });
  const tail = reasoning("", true);
  if (tail) parts.push(tail);
  return { text: parts.join(""), outcome };
}

describe("reading an event stream", () => {
  it("delivers a plain string content delta", async () => {
    const { text } = await collect([`data: ${JSON.stringify({ choices: [{ delta: { content: "hello" } }] })}\n\n`]);
    expect(text).toBe("hello");
  });

  it("delivers content sent as an array of typed parts", async () => {
    // Several gateways send parts rather than a string; reading only a string yields an empty
    // answer for a reply the user already paid for.
    const { text } = await collect([
      `data: ${JSON.stringify({ content: [{ type: "text", text: "one " }, { type: "text", text: "two" }] })}\n\n`,
    ]);
    expect(text).toBe("one two");
  });

  it("delivers a non-stream answer carried under message.content", async () => {
    const { text } = await collect([
      `data: ${JSON.stringify({ choices: [{ message: { content: "whole answer" } }] })}\n\n`,
    ]);
    expect(text).toBe("whole answer");
  });

  it("delivers an Anthropic-style delta.text", async () => {
    const { text } = await collect([`data: ${JSON.stringify({ type: "content_block_delta", delta: { text: "claude" } })}\n\n`]);
    expect(text).toBe("claude");
  });

  it("delivers a legacy choices[0].text completion", async () => {
    const { text } = await collect([`data: ${JSON.stringify({ choices: [{ text: "legacy" }] })}\n\n`]);
    expect(text).toBe("legacy");
  });

  it("joins several data lines belonging to one block", async () => {
    // A block may split its payload across lines; taking only the first truncates the frame.
    const block = 'data: {"choices":[{"delta":\ndata: {"content":"split"}}]}\n\n';
    const { text } = await collect([block]);
    expect(text).toBe("split");
  });

  it("reassembles a frame that arrives in pieces across network chunks", async () => {
    const frame = `data: ${JSON.stringify({ choices: [{ delta: { content: "reassembled" } }] })}\n\n`;
    const middle = Math.floor(frame.length / 2);
    const { text } = await collect([frame.slice(0, middle), frame.slice(middle)]);
    expect(text).toBe("reassembled");
  });

  it("reassembles a multi-byte character split across chunks", async () => {
    // Without a streaming decoder the partial sequence is replaced and the answer gains a stray
    // replacement character in the middle of a word.
    const text = "Привет";
    const frame = `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`;
    const bytes = encoder.encode(frame);
    const cut = bytes.indexOf(0xd0) + 1; // middle of the first Cyrillic code point
    // Feeding the raw bytes in two chunks must not corrupt the text.
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes.slice(0, cut));
        controller.enqueue(bytes.slice(cut));
        controller.close();
      },
    });
    const parts: string[] = [];
    await readEventStream({ body, onFrame: (payload) => { const d = streamDelta(payload); if (d) parts.push(d); } });
    expect(parts.join("")).toBe(text);
  });

  it("stops at [DONE] and ignores anything after it", async () => {
    const { text } = await collect([
      `data: ${JSON.stringify({ choices: [{ delta: { content: "kept" } }] })}\n\n`,
      "data: [DONE]\n\n",
      `data: ${JSON.stringify({ choices: [{ delta: { content: "ignored" } }] })}\n\n`,
    ]);
    expect(text).toBe("kept");
  });

  it("preserves whitespace between deltas exactly", async () => {
    // Trimming per chunk is what produced "Helloworldhowareyou?": the space was never the
    // provider's fault, it was trimmed on the way through.
    const { text } = await collect([
      `data: ${JSON.stringify({ choices: [{ delta: { content: "Hello" } }] })}\n\n`,
      `data: ${JSON.stringify({ choices: [{ delta: { content: " world" } }] })}\n\n`,
      `data: ${JSON.stringify({ choices: [{ delta: { content: "\n\nHow" } }] })}\n\n`,
      `data: ${JSON.stringify({ choices: [{ delta: { content: " are you?" } }] })}\n\n`,
    ]);
    expect(text).toBe("Hello world\n\nHow are you?");
  });

  it("keeps Markdown intact, including a GFM table", async () => {
    const markdown = "## Title\n\n- one\n- two\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n\n**bold** and `code`";
    const { text } = await collect([`data: ${JSON.stringify({ choices: [{ delta: { content: markdown } }] })}\n\n`]);
    // The adapter's job is to deliver the provider's bytes untouched; rendering is Markdown's.
    expect(text).toBe(markdown);
    expect(text).toContain("| --- | --- |");
    expect(text).toContain("**bold**");
  });

  it("never surfaces reasoning content as answer text", async () => {
    const { text } = await collect([
      `data: ${JSON.stringify({ choices: [{ delta: { reasoning_content: "internal chain of thought" } }] })}\n\n`,
      `data: ${JSON.stringify({ choices: [{ delta: { content: "visible answer" } }] })}\n\n`,
    ]);
    expect(text).toBe("visible answer");
    expect(text).not.toContain("internal chain");
  });

  it("strips a thinking block even when it arrives inline in the same stream", async () => {
    const reasoning = createReasoningFilter();
    const parts: string[] = [];
    for (const chunk of ["before <thi", "nk>secret plan</think> after"]) {
      const visible = reasoning(chunk, false);
      if (visible) parts.push(visible);
    }
    const tail = reasoning("", true);
    if (tail) parts.push(tail);
    expect(parts.join("")).toBe("before  after");
  });

  it("never lets a non-text content part through", async () => {
    const { text } = await collect([
      `data: ${JSON.stringify({ content: [{ type: "thinking", text: "hidden" }, { type: "text", text: "shown" }] })}\n\n`,
    ]);
    expect(text).toBe("shown");
  });

  it("records the finish reason and usage when the provider sends them", async () => {
    const { outcome } = await collect([
      `data: ${JSON.stringify({ choices: [{ delta: { content: "x" } }] })}\n\n`,
      `data: ${JSON.stringify({ choices: [{ finish_reason: "stop" }], usage: { prompt_tokens: 10, completion_tokens: 4 } })}\n\n`,
    ]);
    expect(outcome.finishReason).toBe("stop");
    expect(outcome.usage).toEqual({ prompt_tokens: 10, completion_tokens: 4 });
  });

  it("surfaces an error delivered inside a 200 stream", async () => {
    // A gateway that answers 200 and then streams an error would otherwise produce a blank bubble
    // and a retry, when the real cause was permanent.
    const { outcome } = await collect([`data: ${JSON.stringify({ error: { message: "key revoked", type: "authentication_error" } })}\n\n`]);
    expect(outcome.error).toEqual({ message: "key revoked", type: "authentication_error", code: null });
  });

  it("ignores keep-alive comments and unparseable frames", async () => {
    const { text } = await collect([
      ": keep-alive\n\n",
      `data: ${JSON.stringify({ choices: [{ delta: { content: "survived" } }] })}\n\n`,
      "data: {not json\n\n",
    ]);
    expect(text).toBe("survived");
  });

  it("delivers a trailing frame that has no blank line after it", async () => {
    // The stream can end mid-frame; flushing the tail is what stops a real answer being dropped.
    const { text } = await collect([`data: ${JSON.stringify({ choices: [{ delta: { content: "tail" } }] })}`]);
    expect(text).toBe("tail");
  });

  it("stops promptly when the caller aborts", async () => {
    const controller = new AbortController();
    let aborted = false;
    const body = new ReadableStream<Uint8Array>({
      start(streamController) {
        streamController.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: "partial" } }] })}\n\n`));
        // Never closes: only the abort can end this read.
      },
    });
    const pending = readEventStream({
      body,
      signal: controller.signal,
      onFrame: () => { controller.abort(); },
      onAbort: () => { aborted = true; },
    });
    await pending;
    expect(aborted).toBe(true);
  });

  it("yields an empty result rather than throwing when there is no body", async () => {
    const outcome = await readEventStream({ body: null, onFrame: () => { throw new Error("must not run"); } });
    expect(outcome.finishReason).toBeNull();
    expect(outcome.error).toBeNull();
  });
});

describe("stream helpers", () => {
  it("ignores comment and non-data lines in a block", () => {
    expect(dataFromSseBlock(": comment\nevent: message\ndata: {\"a\":1}")).toBe('{"a":1}');
  });

  it("returns nothing for a frame that carries no text", () => {
    expect(streamDelta({ choices: [{ finish_reason: "stop" }] })).toBe("");
    expect(streamDelta(null)).toBe("");
    expect(streamDelta(42)).toBe("");
  });

  it("keeps only numeric usage fields", () => {
    expect(streamUsage({ usage: { prompt_tokens: 5, model: "x" } })).toEqual({ prompt_tokens: 5 });
    expect(streamUsage({})).toBeNull();
  });

  it("reads finish reason from either the OpenAI or the Anthropic field", () => {
    expect(streamFinishReason({ choices: [{ finish_reason: "length" }] })).toBe("length");
    expect(streamFinishReason({ stop_reason: "end_turn" })).toBe("end_turn");
    expect(streamFinishReason({})).toBeNull();
  });

  it("reads a provider error in object or string form", () => {
    expect(streamError({ error: { message: "nope" } })?.message).toBe("nope");
    expect(streamError({ error: "plain" })?.message).toBe("plain");
    expect(streamError({ choices: [] })).toBeNull();
  });

  it("is safe to flush repeatedly, as the real callers do", () => {
    const reasoning = createReasoningFilter();
    expect(reasoning("visible", true)).toBe("visible");
    // A second flush must not duplicate or lose text.
    expect(reasoning("", true)).toBe("");
  });
});
