import { describe, expect, it } from "vitest";
import { consumeChatStream } from "../client/src/lib/chat-stream";

const encoder = new TextEncoder();

describe("client SSE consumption", () => {
  it("emits incremental deltas and the final payload in the same order used by the chat UI", async () => {
    const response = new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('event: start\ndata: {"sessionId":"a"}\n\nevent: delta\ndata: {"content":"Привет"}\n\n'));
        controller.enqueue(encoder.encode('event: delta\ndata: {"content":", мир"}\n\nevent: done\ndata: {"content":"Привет, мир","modelUsed":"openrouter/free","label":"Kairema Auto-Router"}\n\n'));
        controller.close();
      },
    }));
    const deltas: string[] = [];
    let completed: { content?: string; modelUsed?: string; label?: string } | undefined;

    await consumeChatStream(response, { onDelta: (content) => deltas.push(content), onDone: (payload) => { completed = payload; } });

    expect(deltas).toEqual(["Привет", ", мир"]);
    expect(completed).toEqual({ content: "Привет, мир", modelUsed: "openrouter/free", label: "Kairema Auto-Router" });
  });
});
