/* @vitest-environment jsdom */
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React, { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { consumeChatStream } from "@/lib/chat-stream";
import { AIChatBox, type Message } from "./AIChatBox";

const encoder = new TextEncoder();
let releaseFinalStream: (() => void) | null = null;

afterEach(() => {
  releaseFinalStream = null;
  cleanup();
});

function StreamingHarness() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const send = (content: string) => {
    const assistantId = "optimistic-assistant";
    setMessages([
      { id: "user-message", role: "user", content },
      { id: assistantId, role: "assistant", content: "", providerLabel: "Kairema", model: "openrouter/free", status: "печатает" },
    ]);
    setIsLoading(true);
    const finalChunk = new Promise<void>((resolve) => { releaseFinalStream = resolve; });
    const response = new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('event: delta\ndata: {"content":"Первый фрагмент"}\n\n'));
        void finalChunk.then(() => {
          controller.enqueue(encoder.encode('event: delta\ndata: {"content":" ответа"}\n\nevent: done\ndata: {"content":"Первый фрагмент ответа","modelUsed":"openrouter/free","label":"Kairema Auto-Router"}\n\n'));
          controller.close();
        });
      },
    }));
    void consumeChatStream(response, {
      onDelta: (delta) => setMessages((items) => items.map((item) => item.id === assistantId ? { ...item, content: item.content + delta } : item)),
      onDone: (result) => setMessages([
        { id: "user-message", role: "user", content },
        { id: "saved-assistant", role: "assistant", content: result.content ?? "", providerLabel: result.label, model: result.modelUsed, status: "полный ответ" },
      ]),
    }).finally(() => setIsLoading(false));
  };

  return <AIChatBox messages={messages} onSendMessage={send} isLoading={isLoading} />;
}

describe("AIChatBox user flows", () => {
  it("invokes both export controls for the active chat", async () => {
    const user = userEvent.setup();
    const onExportMarkdown = vi.fn();
    const onExportPdf = vi.fn();
    render(<AIChatBox messages={[{ role: "user", content: "Только выбранная история" }]} onSendMessage={vi.fn()} canExport onExportMarkdown={onExportMarkdown} onExportPdf={onExportPdf} />);

    await user.click(screen.getByRole("button", { name: "Markdown" }));
    await user.click(screen.getByRole("button", { name: "PDF" }));

    expect(onExportMarkdown).toHaveBeenCalledOnce();
    expect(onExportPdf).toHaveBeenCalledOnce();
  });

  it("invokes copy, regenerate and cancel controls for an assistant reply", async () => {
    const user = userEvent.setup();
    const reply: Message = { id: "assistant-1", role: "assistant", content: "Текст ответа", providerLabel: "Kairema Быстрый", model: "test-model", status: "полный ответ" };
    const onCopyAssistant = vi.fn();
    const onRegenerate = vi.fn();
    const onCancelStream = vi.fn();
    const { rerender } = render(<AIChatBox messages={[reply]} onSendMessage={vi.fn()} onCopyAssistant={onCopyAssistant} onRegenerate={onRegenerate} onCancelStream={onCancelStream} />);

    await user.click(screen.getByRole("button", { name: "Копировать" }));
    await user.click(screen.getByRole("button", { name: "Ещё вариант" }));

    expect(onCopyAssistant).toHaveBeenCalledWith(reply);
    expect(onRegenerate).toHaveBeenCalledWith(reply);

    rerender(<AIChatBox messages={[reply]} onSendMessage={vi.fn()} isLoading onCopyAssistant={onCopyAssistant} onRegenerate={onRegenerate} onCancelStream={onCancelStream} />);
    await user.click(screen.getByRole("button", { name: "Отменить генерацию" }));
    expect(onCancelStream).toHaveBeenCalledOnce();
  });

  it("renders a delta before the stream completes and replaces it with the persisted final answer", async () => {
    const user = userEvent.setup();
    const { container } = render(<StreamingHarness />);
    const textarea = container.querySelector("textarea");
    if (!textarea) throw new Error("Composer is missing");

    await user.type(textarea, "Начать поток");
    await user.keyboard("{Enter}");

    await waitFor(() => expect(screen.getByText("Первый фрагмент")).toBeTruthy());
    releaseFinalStream?.();
    await waitFor(() => expect(screen.getByText("Первый фрагмент ответа")).toBeTruthy());
    expect(screen.getByText(/полный ответ/)).toBeTruthy();
    expect(screen.queryByText("печатает")).toBeNull();
  });
});
