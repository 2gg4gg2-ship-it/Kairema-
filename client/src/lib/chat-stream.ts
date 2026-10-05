export type StreamSource = { title: string; url: string; publishedAt?: string | null };
export type StreamLiveValue = { kind: "temperature" | "conditions" | "clock" | "rate"; status: "confirmed" | "unconfirmed" | "not_found" };
export type StreamDonePayload = {
  content?: string;
  modelUsed?: string;
  label?: string;
  searchStatus?: { state?: "found" | "empty" | "degraded" | "error"; verificationStatus?: "verified" | "no_results" | "degraded" | "unavailable"; sourcesCount?: number; freshnessBlocked?: boolean; staleRagOnly?: boolean; sourceDateMin?: string; sourceDateMax?: string; liveValue?: StreamLiveValue };
  sources?: StreamSource[];
  webGrounding?: { intent?: "PREFERRED" | "REQUIRED"; state?: "verified" | "disabled" | "empty" | "degraded" | "unavailable" | "admission_denied"; sourcesCount?: number; citations?: StreamSource[]; freshnessBlocked?: boolean };
};

/**
 * A command the model asked to run, as the server issued it.
 *
 * <p>`continuation` is the opaque signed token that lets the server resume the turn when the result
 * comes back. It carries the tool name and arguments in authentic form, so the client neither
 * supplies nor repeats them — it only adds what only it can know, which is the output.
 */
export type StreamToolCall = {
  callId: string;
  name: string;
  arguments: string;
  /** True when the model asked for a tool this build does not offer; nothing should be executed. */
  unsupported: boolean;
  continuation: string | null;
};

export function sseEventFromBlock(block: string) {
  const event = block.split(/\r?\n/).find((line) => line.startsWith("event:"))?.slice(6).trim() ?? "message";
  const data = block.split(/\r?\n/).filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trimStart()).join("\n");
  return { event, data: data ? JSON.parse(data) as Record<string, unknown> : {} };
}

export async function consumeChatStream(
  response: Response,
  handlers: {
    onDelta: (content: string) => void;
    onDone: (payload: StreamDonePayload) => void;
    /** Called for a `tool_call`. Never routed to `onDelta`: a command is not assistant prose. */
    onToolCall?: (call: StreamToolCall) => void;
  },
) {
  if (!response.body) throw new Error("Не удалось начать потоковый ответ.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let completed = false;
  let awaitingTool = false;

  const consumeBlock = (block: string) => {
    const { event, data } = sseEventFromBlock(block);
    if (event === "delta" && typeof data.content === "string") handlers.onDelta(data.content);
    if (event === "tool_call") {
      // A turn that paused for a command has not finished, so it neither completes the stream nor
      // becomes text. The stream ends here and the caller resumes with a continuation request.
      awaitingTool = true;
      if (typeof data.callId === "string" && typeof data.name === "string") {
        handlers.onToolCall?.({
          callId: data.callId,
          name: data.name,
          arguments: typeof data.arguments === "string" ? data.arguments : "{}",
          unsupported: data.unsupported === true,
          continuation: typeof data.continuation === "string" ? data.continuation : null,
        });
      }
    }
    if (event === "error") throw new Error(typeof data.message === "string" ? data.message : "Потоковый ответ завершился с ошибкой.");
    if (event === "done") {
      completed = true;
      handlers.onDone(data as StreamDonePayload);
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const blocks = buffer.split(/\r?\n\r?\n/);
    buffer = blocks.pop() ?? "";
    blocks.forEach(consumeBlock);
  }
  buffer += decoder.decode();
  if (buffer.trim()) consumeBlock(buffer);
  // A stream that paused for a tool call ends without `done` on purpose. Treating that as a dropped
  // connection would turn every tool round into a user-visible failure.
  if (!completed && !awaitingTool) throw new Error("Поток завершился до получения итогового ответа.");
  return { completed, awaitingTool };
}
