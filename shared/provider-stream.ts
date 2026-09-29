/**
 * Provider stream adapter.
 *
 * One SSE reader and one delta extractor, shared by the server path and the browser-direct path,
 * because both consume the same family of OpenAI-style and Anthropic-style event streams and both
 * must make identical decisions about what is visible text. A frame parsed differently on the
 * server than in the browser would mean the same provider produces two different answers depending
 * on where it ran, which is exactly the class of bug that is hard to see and hard to report.
 *
 * It is deliberately dependency-free and DOM-free so it can run in a browser, in Node, and in a
 * test, and it is pure with respect to the stream it is handed: pass a ReadableStream or anything
 * with the same read() contract.
 */

export type StreamFrame = {
  /** The decoded payload of one `data:` line, or null for a frame that carried none. */
  data: unknown;
  /** The raw data text, kept for diagnostics. Never a body containing user content in logs. */
  raw: string;
};

export type StreamErrorPayload = {
  message: string;
  type: string;
  code: string | null;
};

/** What a stream reported besides its text: usage, finish reason, or a provider-side error. */
export type StreamOutcome = {
  finishReason: string | null;
  usage: Record<string, number> | null;
  error: StreamErrorPayload | null;
};

export function emptyStreamOutcome(): StreamOutcome {
  return { finishReason: null, usage: null, error: null };
}

/**
 * Joins the `data:` lines of one SSE block.
 *
 * A block can legally carry several data lines and a payload can be split across them, so taking
 * only the first line silently truncates a long frame. Comments (`:keep-alive`) and non-data lines
 * are ignored rather than treated as a parse failure.
 */
export function dataFromSseBlock(block: string): string {
  return block
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart())
    .join("\n");
}

/**
 * Pulls the visible text out of a value that may be a string, an array of typed parts, or a single
 * typed part object.
 *
 * The object case matters: an Anthropic block delta is `{ type: "text_delta", text: "..." }`, not
 * an array and not a string. Accepting only strings and arrays is what turned that provider's
 * answers into empty bubbles.
 */
function answerText(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    let out = "";
    for (const part of value) {
      if (typeof part === "string") { out += part; continue; }
      if (!part || typeof part !== "object") continue;
      const record = part as Record<string, unknown>;
      // Only `text` parts are answer text. A `thinking`/`reasoning`/`tool` part is not, and is
      // skipped rather than rendered: the model worked those out for itself and the user asked a
      // question, not for the scratchpad.
      if (record.type !== undefined && record.type !== "text" && !/text_delta/.test(String(record.type))) continue;
      if (typeof record.text === "string") out += record.text;
    }
    return out;
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    // A single delta part. `text_delta` is the visible kind; `thinking_delta` is not, and letting
    // it through would publish the model's reasoning as if it were the answer.
    if (typeof record.text === "string" && (record.type === undefined || record.type === "text" || /text_delta/.test(String(record.type)))) {
      return record.text;
    }
  }
  return "";
}

/**
 * Extracts the visible delta from one frame, across every shape seen in the wild.
 *
 * The shapes are not interchangeable and a missing one is how a paid answer reaches the user as
 * "the provider returned an empty answer": OpenAI streams nest under `choices[0].delta.content`,
 * Anthropic streams use `delta.text`, several gateways send content as parts, non-stream replies
 * carry the whole answer under `message.content`, and some compatible endpoints still use the
 * legacy `choices[0].text`.
 *
 * Whitespace is returned exactly as received. Trimming here is what welds chunks together into
 * "Helloworldhowareyou?" — the space between two deltas is real content the user typed into the
 * model's answer.
 */
export function streamDelta(payload: unknown): string {
  if (typeof payload === "string") return payload;
  if (!payload || typeof payload !== "object") return "";
  const frame = payload as Record<string, unknown>;

  const choice = Array.isArray(frame.choices) ? (frame.choices[0] as Record<string, unknown> | undefined) : undefined;
  const delta = choice && typeof choice.delta === "object" ? (choice.delta as Record<string, unknown>) : undefined;
  const message = choice && typeof choice.message === "object" ? (choice.message as Record<string, unknown>) : undefined;
  const frameMessage = typeof frame.message === "object" ? (frame.message as Record<string, unknown>) : undefined;

  const candidates: unknown[] = [
    delta?.content,
    delta?.text,
    // Anthropic streams the block delta at the top level, with no `choices` array at all.
    // Reading it only under choices[0] is why an Anthropic answer can arrive as an empty bubble.
    frame.type === "content_block_delta" ? frame.delta : undefined,
    message?.content,
    message?.text,
    frameMessage?.content,
    frameMessage?.text,
    choice?.output !== undefined ? (choice.output as Record<string, unknown>)?.content : undefined,
    choice?.text,
    frame.content,
  ];
  for (const candidate of candidates) {
    const text = answerText(candidate);
    if (text) return text;
  }
  return "";
}

/** Reads usage counts if the frame carries them. Only numbers are kept. */
export function streamUsage(payload: unknown): Record<string, number> | null {
  if (!payload || typeof payload !== "object") return null;
  const usage = (payload as Record<string, unknown>).usage;
  if (!usage || typeof usage !== "object") return null;
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(usage as Record<string, unknown>)) {
    if (typeof value === "number" && Number.isFinite(value)) out[key] = value;
  }
  return Object.keys(out).length ? out : null;
}

export function streamFinishReason(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const frame = payload as Record<string, unknown>;
  const choice = Array.isArray(frame.choices) ? (frame.choices[0] as Record<string, unknown> | undefined) : undefined;
  const reason = choice?.finish_reason ?? frame.finish_reason ?? frame.stop_reason;
  return typeof reason === "string" ? reason : null;
}

/**
 * Recognises a provider-side error delivered *inside* a 200 stream.
 *
 * A gateway that answers 200 and then streams `{"error": {...}}` is common enough that a stream
 * which simply ends produces a blank bubble and a retry, when what actually happened was a
 * permanent failure such as a bad key. The message is passed through for display; the raw frame is
 * never logged.
 */
export function streamError(payload: unknown): StreamErrorPayload | null {
  if (!payload || typeof payload !== "object") return null;
  const frame = payload as Record<string, unknown>;
  const error = frame.error;
  if (!error) return null;
  if (typeof error === "string") return { message: error, type: "provider_error", code: null };
  if (typeof error !== "object") return null;
  const record = error as Record<string, unknown>;
  const message = typeof record.message === "string" ? record.message : "";
  if (!message && record.type === undefined && record.code === undefined) return null;
  return {
    message: message || "Провайдер вернул ошибку в потоке ответа.",
    type: typeof record.type === "string" ? record.type : "provider_error",
    code: typeof record.code === "string" ? record.code : null,
  };
}

export const SSE_DONE = "[DONE]";

/**
 * Reads an event stream frame by frame and hands each payload to `onFrame`.
 *
 * Handles the three things that break naive readers: a frame split across network chunks, several
 * `data:` lines in one block, and a trailing block with no blank line after it. An abort signal
 * ends the read immediately and is reported through `onAbort` rather than thrown, so a cancelled
 * turn unwinds the same way a completed one does instead of surfacing as a failure.
 */
export async function readEventStream(input: {
  body: { getReader(): { read(): Promise<{ done: boolean; value?: Uint8Array }>; releaseLock(): void } } | null;
  signal?: AbortSignal;
  onFrame: (payload: unknown, raw: string) => void;
  onDone?: () => void;
  onAbort?: () => void;
  onError?: (error: unknown) => void;
}): Promise<StreamOutcome> {
  const outcome = emptyStreamOutcome();
  const reader = input.body?.getReader();
  if (!reader) return outcome;
  const decoder = new TextDecoder();
  let buffer = "";
  let finished = false;

  const consume = (block: string) => {
    const raw = dataFromSseBlock(block).trim();
    if (!raw) return;
    if (raw === SSE_DONE) { finished = true; return; }
    let payload: unknown;
    try {
      payload = JSON.parse(raw);
    } catch {
      // A frame that is not JSON is not an error: providers interleave comment frames and
      // keep-alives, and a mid-stream proxy can split a large object. Ignoring is correct.
      return;
    }
    const error = streamError(payload);
    if (error) { outcome.error = error; return; }
    const finish = streamFinishReason(payload);
    if (finish) outcome.finishReason = finish;
    const usage = streamUsage(payload);
    if (usage) outcome.usage = usage;
    input.onFrame(payload, raw);
  };

  try {
    while (true) {
      if (input.signal?.aborted) { input.onAbort?.(); return outcome; }
      const { done, value } = await reader.read();
      if (done) break;
      // `stream: true` matters: a multi-byte character split across two chunks is only decodable
      // when the decoder is told more bytes are coming.
      buffer += decoder.decode(value, { stream: true });
      const blocks = buffer.split(/\r?\n\r?\n/);
      // The tail is incomplete until a blank line arrives; parsing it early truncates a frame.
      buffer = blocks.pop() ?? "";
      for (const block of blocks) { consume(block); if (finished) return outcome; }
    }
    buffer += decoder.decode();
    if (buffer.trim()) consume(buffer);
    if (finished) input.onDone?.();
    return outcome;
  } catch (error) {
    if (input.signal?.aborted) { input.onAbort?.(); return outcome; }
    input.onError?.(error);
    return outcome;
  } finally {
    try { reader.releaseLock(); } catch { /* already released by the runtime on abort */ }
  }
}

/**
 * Filters reasoning/thinking tags out of a visible text stream.
 *
 * Stateful, because a tag can be split across two deltas and matching a half tag would let the
 * model's scratchpad through. Text that merely contains a `<` is held back only until it is clear
 * whether a tag follows, then released, so ordinary prose is never delayed or dropped.
 */
export function createReasoningFilter(): (chunk: string, final?: boolean) => string {
  let pending = "";
  let hidden: string | null = null;
  return (chunk: string, final = false) => {
    pending += chunk;
    let output = "";
    while (pending) {
      if (hidden) {
        const close = pending.match(new RegExp(`</${hidden}\\s*>`, "i"));
        if (close?.index !== undefined) { pending = pending.slice(close.index + close[0].length); hidden = null; continue; }
        if (final) pending = "";
        else { const tail = pending.lastIndexOf("<"); pending = tail >= 0 ? pending.slice(tail) : ""; }
        break;
      }
      const opening = pending.match(/<(think|reasoning|thought)(?:\s[^>]*)?>/i);
      if (opening?.index !== undefined) {
        output += pending.slice(0, opening.index);
        pending = pending.slice(opening.index + opening[0].length);
        hidden = opening[1]!.toLowerCase();
        continue;
      }
      if (final) { output += pending; pending = ""; break; }
      const tail = pending.lastIndexOf("<");
      if (tail >= 0 && pending.length - tail < 24) { output += pending.slice(0, tail); pending = pending.slice(tail); }
      else { output += pending; pending = ""; }
      break;
    }
    return output;
  };
}
