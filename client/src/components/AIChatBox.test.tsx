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

  it("renders only the safe web-search status beneath an assistant reply", () => {
    const reply: Message = {
      id: "assistant-search",
      role: "assistant",
      content: "Проверенный ответ",
      providerLabel: "Kairema Flash",
      model: "hidden-server-model",
      status: "полный ответ",
      searchStatus: { state: "found", verificationStatus: "verified", sourcesCount: 2 },
    };
    render(<AIChatBox messages={[reply]} onSendMessage={vi.fn()} />);

    expect(screen.getByRole("status").textContent).toContain("Источники проверены");
    expect(screen.queryByText(/Tavily|Google|OpenRouter/i)).toBeNull();
    expect(screen.queryByText(/https?:\/\//i)).toBeNull();
  });

  it("opens temporary image and document previews from a sent user message", async () => {
    const user = userEvent.setup();
    render(<AIChatBox messages={[{
      id: "user-image",
      role: "user",
      content: "Проверь это фото",
      attachments: [
        { id: "attachment-1", fileName: "sample.webp", mimeType: "image/webp", sizeBytes: 1234, kind: "image", previewUrl: "https://preview.example.test/sample.webp" },
        { id: "attachment-2", fileName: "notes.pdf", mimeType: "application/pdf", sizeBytes: 4567, kind: "document", previewUrl: "https://preview.example.test/notes.pdf" },
      ],
    }]} onSendMessage={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "Открыть предпросмотр: sample.webp" }));
    const imagePreview = screen.getByRole("img", { name: "sample.webp" });
    expect(imagePreview.getAttribute("src")).toBe("https://preview.example.test/sample.webp");
    expect(screen.getByRole("dialog").textContent).toContain("sample.webp");

    await user.keyboard("{Escape}");
    await user.click(screen.getByRole("button", { name: "Открыть предпросмотр: notes.pdf" }));
    const documentPreview = screen.getByTitle("notes.pdf");
    expect(documentPreview.getAttribute("src")).toBe("https://preview.example.test/notes.pdf");
    expect(screen.getByRole("dialog").textContent).toContain("notes.pdf");
  });

  it("keeps the temporary preview URL in the composer and deletes the temporary attachment on X", async () => {
    const user = userEvent.setup();
    const attachment = { id: "attachment-3", fileName: "draft.png", mimeType: "image/png", sizeBytes: 1024, kind: "image" as const, previewUrl: "https://preview.example.test/draft.png" };
    const onUploadFiles = vi.fn().mockResolvedValue([attachment]);
    const onRemoveAttachment = vi.fn().mockResolvedValue(undefined);
    const { container } = render(<AIChatBox messages={[]} onSendMessage={vi.fn()} onUploadFiles={onUploadFiles} onRemoveAttachment={onRemoveAttachment} />);
    const input = container.querySelector('input[type="file"]') as HTMLInputElement | null;
    if (!input) throw new Error("Attachment input is missing");

    await user.upload(input, new File(["image"], "draft.png", { type: "image/png" }));
    await user.click(screen.getByRole("button", { name: "Открыть предпросмотр: draft.png" }));
    expect(screen.getByRole("img", { name: "draft.png" }).getAttribute("src")).toBe("https://preview.example.test/draft.png");

    await user.keyboard("{Escape}");
    await user.click(screen.getByRole("button", { name: "Убрать вложение: draft.png" }));
    await waitFor(() => expect(onRemoveAttachment).toHaveBeenCalledWith(attachment));
    expect(screen.queryByText("draft.png")).toBeNull();
  });

  it("ignores legacy continuation suggestions and does not render quick-prompt chips", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const legacyAssistantMessage = {
      id: "assistant-duplicate-suggestions",
      role: "assistant" as const,
      content: "Ответ готов",
      suggestions: ["Уточните подробнее", "Уточните подробнее", "Уточните подробнее"],
    } as unknown as Message;

    render(<AIChatBox messages={[legacyAssistantMessage]} onSendMessage={vi.fn()} />);

    expect(screen.queryByRole("button", { name: "Уточните подробнее" })).toBeNull();
    expect(consoleError.mock.calls.flat().join(" ")).not.toMatch(/same key|duplicate key/i);
    consoleError.mockRestore();
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
