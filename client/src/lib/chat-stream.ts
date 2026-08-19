export type StreamSource = { title: string; url: string; publishedAt?: string | null };
export type StreamDonePayload = { content?: string; modelUsed?: string; label?: string; sources?: StreamSource[]; ragSources?: StreamSource[] };

export function sseEventFromBlock(block: string) {
  const event = block.split(/\r?\n/).find((line) => line.startsWith("event:"))?.slice(6).trim() ?? "message";
  const data = block.split(/\r?\n/).filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trimStart()).join("\n");
  return { event, data: data ? JSON.parse(data) as Record<string, unknown> : {} };
}

export async function consumeChatStream(
  response: Response,
  handlers: { onDelta: (content: string) => void; onDone: (payload: StreamDonePayload) => void },
) {
  if (!response.body) throw new Error("Не удалось начать потоковый ответ.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let completed = false;

  const consumeBlock = (block: string) => {
    const { event, data } = sseEventFromBlock(block);
    if (event === "delta" && typeof data.content === "string") handlers.onDelta(data.content);
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
  if (!completed) throw new Error("Поток завершился до получения итогового ответа.");
}
