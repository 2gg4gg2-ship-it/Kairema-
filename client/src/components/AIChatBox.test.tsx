/* @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React, { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { consumeChatStream } from "@/lib/chat-stream";
import { AIChatBox, formatAttachmentSize, redactLegacyAssistantReferences, type Message } from "./AIChatBox";

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

  it("keeps copy and cancel controls while removing the regenerate action", async () => {
    const user = userEvent.setup();
    const reply: Message = { id: "assistant-1", role: "assistant", content: "Текст ответа", providerLabel: "Kairema Быстрый", model: "test-model", status: "полный ответ" };
    const onCopyAssistant = vi.fn();
    const onCancelStream = vi.fn();
    const { rerender } = render(<AIChatBox messages={[reply]} onSendMessage={vi.fn()} onCopyAssistant={onCopyAssistant} onCancelStream={onCancelStream} />);

    await user.click(screen.getByRole("button", { name: "Копировать" }));

    expect(onCopyAssistant).toHaveBeenCalledWith(reply);
    expect(screen.queryByRole("button", { name: "Ещё вариант" })).toBeNull();

    rerender(<AIChatBox messages={[reply]} onSendMessage={vi.fn()} isLoading onCopyAssistant={onCopyAssistant} onCancelStream={onCancelStream} />);
    await user.click(screen.getByRole("button", { name: "Отменить генерацию" }));
    expect(onCancelStream).toHaveBeenCalledOnce();
  });

  it("empties the composer as soon as the send is accepted, before the stream finishes", async () => {
    const user = userEvent.setup();
    let resolveSend: ((value: boolean) => void) | undefined;
    const onSendMessage = vi.fn(() => new Promise<boolean>((resolve) => { resolveSend = resolve; }));
    render(<AIChatBox messages={[]} onSendMessage={onSendMessage} />);

    const composer = screen.getByPlaceholderText("Напишите сообщение…") as HTMLTextAreaElement;
    await user.type(composer, "Привет");
    await user.keyboard("{Enter}");

    await waitFor(() => expect(onSendMessage).toHaveBeenCalledOnce());
    expect(composer.value).toBe("");

    await user.type(composer, "Следующий вопрос");
    expect(composer.value).toBe("Следующий вопрос");
    resolveSend?.(true);
    await waitFor(() => expect(composer.value).toBe("Следующий вопрос"));
  });

  it("keeps the typed text when the send is rejected before it starts", async () => {
    const user = userEvent.setup();
    const onSendMessage = vi.fn(async () => false);
    render(<AIChatBox messages={[]} onSendMessage={onSendMessage} />);

    const composer = screen.getByPlaceholderText("Напишите сообщение…") as HTMLTextAreaElement;
    await user.type(composer, "Привет");
    await user.keyboard("{Enter}");

    await waitFor(() => expect(onSendMessage).toHaveBeenCalledOnce());
    await waitFor(() => expect(composer.value).toBe("Привет"));
  });

  it("keeps text selection active after a repeated long-press and copies only the selected fragment", async () => {
    const reply: Message = { id: "assistant-select", role: "assistant", content: "Выделяемый фрагмент ответа", providerLabel: "Kairema", model: "safe", status: "полный ответ" };
    const writeText = vi.fn().mockResolvedValue(undefined);
    const originalClipboard = navigator.clipboard;
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    render(<AIChatBox messages={[reply]} onSendMessage={vi.fn()} />);
    const bubble = screen.getByText("Выделяемый фрагмент ответа").closest(".kairema-message");
    if (!bubble) throw new Error("Message bubble is missing");
    expect(screen.queryByRole("menuitem", { name: "Выбрать текст" })).toBeNull();
    fireEvent.contextMenu(bubble);
    await waitFor(() => expect(screen.getByRole("menuitem", { name: "Выбрать текст" })).toBeTruthy());
    fireEvent.click(screen.getByRole("menuitem", { name: "Выбрать текст" }));
    await waitFor(() => expect(screen.getByRole("menuitem", { name: "Копировать выбранное" })).toBeTruthy());
    expect(bubble.classList.contains("kairema-message-selection-mode")).toBe(true);
    const textNode = bubble.querySelector("p")?.firstChild;
    if (!textNode) throw new Error("Message text node is missing");
    const range = document.createRange();
    range.setStart(textNode, 0);
    range.setEnd(textNode, "Выделяемый".length);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    fireEvent.mouseUp(bubble);
    fireEvent.contextMenu(bubble);
    expect(bubble.classList.contains("kairema-message-selection-mode")).toBe(true);
    fireEvent.click(screen.getByRole("menuitem", { name: "Копировать выбранное" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("Выделяемый"));
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: originalClipboard });
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

  it("shows the live-value verdict without ever rendering the value itself", () => {
    const base = { id: "assistant-live-value", role: "assistant" as const, content: "Ответ о погоде", searchStatus: { state: "found" as const, verificationStatus: "verified" as const, sourcesCount: 1 } };
    const { unmount } = render(<AIChatBox messages={[{ ...base, searchStatus: { ...base.searchStatus, liveValue: { kind: "temperature" as const, status: "confirmed" as const } } }]} onSendMessage={vi.fn()} />);
    expect(screen.getByText("Значение подтверждено источниками")).toBeTruthy();
    unmount();

    render(<AIChatBox messages={[{ ...base, searchStatus: { ...base.searchStatus, liveValue: { kind: "temperature" as const, status: "unconfirmed" as const } } }]} onSendMessage={vi.fn()} />);
    expect(screen.getByText("Значение не подтверждено")).toBeTruthy();
  });

  it("renders only verified public source evidence beneath a verified fresh reply", () => {
    render(<AIChatBox messages={[{
      id: "assistant-source-evidence",
      role: "assistant",
      content: "Проверенный ответ",
      searchStatus: { state: "found", verificationStatus: "verified", sourcesCount: 1, sourceDateMin: "2026-08-23T00:00:00.000Z", sourceDateMax: "2026-08-23T00:00:00.000Z" },
      sources: [{ title: "Официальная публикация", url: "https://example.com/official", publishedAt: "2026-08-23T00:00:00.000Z" }],
    }]} onSendMessage={vi.fn()} />);

    expect(screen.getByRole("link", { name: "Официальная публикация" }).getAttribute("href")).toBe("https://example.com/official");
    expect(screen.getByText("23.08.2026")).toBeTruthy();
  });

  it("renders V1 structured grounding with only actual public citations", () => {
    render(<AIChatBox messages={[{
      id: "assistant-v1-grounding",
      role: "assistant",
      content: "Ответ с внешним контекстом",
      webGrounding: {
        intent: "REQUIRED",
        state: "verified",
        sourcesCount: 1,
        citations: [{ title: "Первичный источник", url: "https://example.com/primary", publishedAt: "2026-08-24T00:00:00.000Z" }],
      },
    }]} onSendMessage={vi.fn()} />);

    expect(screen.getByRole("status").textContent).toContain("Контекст из веб-источников");
    expect(screen.getByRole("link", { name: "Первичный источник" }).getAttribute("href")).toBe("https://example.com/primary");
    expect(screen.queryByText(/Serper|Tavily|You\.com|Controller/i)).toBeNull();
  });

  it("renders an explicit honest unavailable badge when fresh sources have no verified dates", () => {
    render(<AIChatBox messages={[{
      id: "assistant-freshness-blocked",
      role: "assistant",
      content: "Я не подтверждаю актуальность без датированных источников.",
      searchStatus: { state: "degraded", verificationStatus: "degraded", freshnessBlocked: true, sourcesCount: 0 },
    }]} onSendMessage={vi.fn()} />);

    expect(screen.getByRole("status").textContent).toContain("Живой поиск недоступен: нет проверяемых свежих источников");
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("redacts technical citation markers from legacy assistant replay and copied content", async () => {
    const user = userEvent.setup();
    const onCopyAssistant = vi.fn();
    const legacyContent = "Полезная часть. Массив значений [1, 2] остаётся видимым.\\n[Source: legacy-reference]\\n【†opaque-reference】\\n\\[a3b2c1d0e9f8a7b6, c4d3e2f1a0b9c8d7\\]";
    const reply: Message = { id: "legacy-assistant", role: "assistant", content: legacyContent, providerLabel: "Kairema Context", model: "safe-model", status: "полный ответ" };
    render(<AIChatBox messages={[reply]} onSendMessage={vi.fn()} onCopyAssistant={onCopyAssistant} />);

    expect(redactLegacyAssistantReferences(legacyContent)).toContain("Полезная часть.");
    expect(redactLegacyAssistantReferences(legacyContent)).toContain("[1, 2]");
    expect(redactLegacyAssistantReferences("Проверка \\\\[a3b2c1d0e9f8a7b6, c4d3e2f1a0b9c8d7\\\\]")).toBe("Проверка");
    expect(document.body.textContent).not.toContain("legacy-reference");
    expect(document.body.textContent).not.toContain("opaque-reference");
    expect(document.body.textContent).not.toContain("a3b2c1d0e9f8a7b6");

    await user.click(screen.getByRole("button", { name: "Копировать" }));
    expect(onCopyAssistant).toHaveBeenCalledWith(expect.objectContaining({ content: expect.not.stringContaining("opaque-reference") }));
    expect(onCopyAssistant).toHaveBeenCalledWith(expect.objectContaining({ content: expect.not.stringContaining("a3b2c1d0e9f8a7b6") }));
    expect(onCopyAssistant).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining("[1, 2]") }));
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

    const sentImageCard = screen.getByRole("button", { name: "Открыть предпросмотр: sample.webp" });
    expect(sentImageCard.querySelector(".kairema-message-image")).toBeTruthy();
    await user.click(sentImageCard);
    const imagePreview = screen.getByRole("img", { name: "sample.webp" });
    expect(imagePreview.getAttribute("src")).toBe("https://preview.example.test/sample.webp");
    expect(screen.getByRole("dialog").textContent).toContain("sample.webp");

    await user.keyboard("{Escape}");
    const documentCard = screen.getByRole("button", { name: "Открыть предпросмотр: notes.pdf" });
    expect(documentCard.textContent).not.toContain("https://");
    await user.click(documentCard);
    const documentPreview = screen.getByTitle("notes.pdf");
    expect(documentPreview.getAttribute("src")).toBe("https://preview.example.test/notes.pdf");
    expect(documentPreview.getAttribute("sandbox")).toBe("allow-downloads allow-same-origin");
    expect(screen.getByRole("dialog").textContent).toContain("notes.pdf");
  });

  it("renders a privacy-safe formatted size for a sent document card", () => {
    render(<AIChatBox messages={[{
      id: "user-document-size",
      role: "user",
      content: "",
      attachments: [{ id: "attachment-size", fileName: "neutral-audit.pdf", mimeType: "application/pdf", sizeBytes: 1536, kind: "document" }],
    }]} onSendMessage={vi.fn()} />);

    expect(formatAttachmentSize(1536)).toBe("1.5 KB");
    expect(screen.getByRole("button", { name: "Открыть предпросмотр: neutral-audit.pdf" }).textContent).toContain("neutral-audit.pdf · 1.5 KB");
    expect(screen.queryByText(/https?:\/\//)).toBeNull();
  });

  it("keeps the temporary preview URL in the composer and deletes the temporary attachment on X", async () => {
    const user = userEvent.setup();
    const attachment = { id: "attachment-3", fileName: "draft.png", mimeType: "image/png", sizeBytes: 1024, kind: "image" as const, previewUrl: "https://preview.example.test/draft.png" };
    const onUploadFiles = vi.fn().mockResolvedValue({ attachments: [attachment], sessionId: "new-composer" });
    const onRemoveAttachment = vi.fn().mockResolvedValue(undefined);
    const { container } = render(<AIChatBox messages={[]} onSendMessage={vi.fn()} onUploadFiles={onUploadFiles} onRemoveAttachment={onRemoveAttachment} />);
    const input = container.querySelector('input[type="file"]') as HTMLInputElement | null;
    if (!input) throw new Error("Attachment input is missing");

    await user.upload(input, new File(["image"], "draft.png", { type: "image/png" }));
    expect(screen.getByRole("button", { name: "Убрать вложение: draft.png" }).classList.contains("kairema-attachment-remove")).toBe(true);
    expect(screen.getByRole("button", { name: "Открыть предпросмотр: draft.png" }).querySelector(".kairema-attachment-preview")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Открыть предпросмотр: draft.png" }));
    expect(screen.getByRole("img", { name: "draft.png" }).getAttribute("src")).toBe("https://preview.example.test/draft.png");

    await user.keyboard("{Escape}");
    await user.click(screen.getByRole("button", { name: "Убрать вложение: draft.png" }));
    await waitFor(() => expect(onRemoveAttachment).toHaveBeenCalledWith(attachment));
    expect(screen.queryByText("draft.png")).toBeNull();
  });

  it("closes the photo/file menu when the host bumps the navigation signal", async () => {
    const user = userEvent.setup();
    const { container, rerender } = render(<AIChatBox messages={[]} onSendMessage={vi.fn()} onUploadFiles={vi.fn()} navigationCloseSignal={0} />);
    const menu = container.querySelector("details.kairema-attachment-menu") as HTMLDetailsElement | null;
    const trigger = menu?.querySelector("summary") as HTMLElement | null;
    if (!menu || !trigger) throw new Error("Attachment menu is missing");

    await user.click(trigger);
    expect(menu.open).toBe(true);
    expect(screen.getByRole("button", { name: "Выбрать фото" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Выбрать файл" })).toBeTruthy();

    rerender(<AIChatBox messages={[]} onSendMessage={vi.fn()} onUploadFiles={vi.fn()} navigationCloseSignal={1} />);
    await waitFor(() => expect(menu.open).toBe(false));

    // The menu still opens and closes normally between navigation events.
    await user.click(trigger);
    expect(menu.open).toBe(true);
    await user.click(trigger);
    await waitFor(() => expect(menu.open).toBe(false));
  });

  it("gives the hidden native attachment input an explicit accessible name", () => {
    render(<AIChatBox messages={[]} onSendMessage={vi.fn()} onUploadFiles={vi.fn()} />);

    const nativeInput = screen.getByLabelText("Выбрать файл для вложения");
    expect(nativeInput).toBeInstanceOf(HTMLInputElement);
    expect((nativeInput as HTMLInputElement).type).toBe("file");
    expect(nativeInput.getAttribute("accept")).toBe("image/png,image/jpeg,image/webp,application/pdf,text/plain,text/markdown,.md");
  });

  it("shows an image-only local preview immediately while upload is still pending and removes it without a server delete", async () => {
    const user = userEvent.setup();
    const createObjectURL = vi.fn(() => "blob:local-preview");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", { ...URL, createObjectURL, revokeObjectURL });
    const onRemoveAttachment = vi.fn();
    const onUploadFiles = vi.fn(() => new Promise<never>(() => undefined));
    const { container } = render(<AIChatBox messages={[]} onSendMessage={vi.fn()} onUploadFiles={onUploadFiles} onRemoveAttachment={onRemoveAttachment} />);
    const input = container.querySelector('input[type="file"]') as HTMLInputElement | null;
    if (!input) throw new Error("Attachment input is missing");

    await user.upload(input, new File(["image"], "local-preview.png", { type: "image/png" }));
    await waitFor(() => expect(screen.getByTestId("local-attachment-preview")).toBeTruthy());
    await user.click(screen.getByRole("button", { name: "Открыть предпросмотр: local-preview.png" }));
    expect(screen.getByRole("img", { name: "local-preview.png" }).getAttribute("src")).toBe("blob:local-preview");

    await user.keyboard("{Escape}");
    await user.click(screen.getByRole("button", { name: "Убрать вложение: local-preview.png" }));
    expect(screen.queryByTestId("local-attachment-preview")).toBeNull();
    expect(onRemoveAttachment).not.toHaveBeenCalled();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:local-preview");
    vi.unstubAllGlobals();
  });

  it("keeps a recoverable local preview after an upload error and retries the same file", async () => {
    const user = userEvent.setup();
    const createObjectURL = vi.fn(() => "blob:recoverable-preview");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", { ...URL, createObjectURL, revokeObjectURL });
    const attachment = { id: "attachment-recovered", fileName: "recoverable.png", mimeType: "image/png", sizeBytes: 1024, kind: "image" as const, previewUrl: "https://preview.example.test/recoverable.png" };
    const onUploadFiles = vi.fn().mockRejectedValueOnce(new Error("temporary-upload-error")).mockResolvedValueOnce({ attachments: [attachment], sessionId: "new-composer" });
    const { container } = render(<AIChatBox messages={[]} onSendMessage={vi.fn()} onUploadFiles={onUploadFiles} />);
    const input = container.querySelector('input[type="file"]') as HTMLInputElement | null;
    if (!input) throw new Error("Attachment input is missing");

    await user.upload(input, new File(["image"], "recoverable.png", { type: "image/png" }));
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("Не удалось загрузить вложение"));
    expect(screen.getByTestId("local-attachment-preview")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Повторить загрузку: recoverable.png" }));
    await waitFor(() => expect(onUploadFiles).toHaveBeenCalledTimes(2));
    expect(onUploadFiles).toHaveBeenLastCalledWith([expect.objectContaining({ name: "recoverable.png", type: "image/png" })]);
    await waitFor(() => expect(screen.getByRole("button", { name: "Открыть предпросмотр: recoverable.png" })).toBeTruthy());
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:recoverable-preview");
    vi.unstubAllGlobals();
  });

  it("does not move a completed temporary upload into a composer after the user changes chat", async () => {
    const user = userEvent.setup();
    const attachment = { id: "attachment-race", fileName: "old-chat.png", mimeType: "image/png", sizeBytes: 1024, kind: "image" as const, previewUrl: "https://preview.example.test/old-chat.png" };
    let resolveUpload: ((value: { attachments: typeof attachment[]; sessionId: string }) => void) | undefined;
    const onUploadFiles = vi.fn(() => new Promise<{ attachments: typeof attachment[]; sessionId: string }>((resolve) => { resolveUpload = resolve; }));
    const { container, rerender } = render(<AIChatBox messages={[]} onSendMessage={vi.fn()} onUploadFiles={onUploadFiles} composerSessionId="chat-a" />);
    const input = container.querySelector('input[type="file"]') as HTMLInputElement | null;
    if (!input) throw new Error("Attachment input is missing");

    await user.upload(input, new File(["image"], "old-chat.png", { type: "image/png" }));
    await waitFor(() => expect(onUploadFiles).toHaveBeenCalledOnce());
    rerender(<AIChatBox messages={[]} onSendMessage={vi.fn()} onUploadFiles={onUploadFiles} composerSessionId="chat-b" />);
    resolveUpload?.({ attachments: [attachment], sessionId: "chat-a" });

    await waitFor(() => expect(screen.queryByText("old-chat.png")).toBeNull());
  });

  it("keeps an upload preview when new composer upload creates its own chat session", async () => {
    const user = userEvent.setup();
    const attachment = { id: "attachment-created-chat", fileName: "created-chat.png", mimeType: "image/png", sizeBytes: 1024, kind: "image" as const, previewUrl: "https://preview.example.test/created-chat.png" };
    let resolveUpload: ((value: { attachments: typeof attachment[]; sessionId: string }) => void) | undefined;
    const onUploadFiles = vi.fn(() => new Promise<{ attachments: typeof attachment[]; sessionId: string }>((resolve) => { resolveUpload = resolve; }));
    const { container, rerender } = render(<AIChatBox messages={[]} onSendMessage={vi.fn()} onUploadFiles={onUploadFiles} composerSessionId="new-composer" />);
    const input = container.querySelector('input[type="file"]') as HTMLInputElement | null;
    if (!input) throw new Error("Attachment input is missing");

    await user.upload(input, new File(["image"], "created-chat.png", { type: "image/png" }));
    await waitFor(() => expect(onUploadFiles).toHaveBeenCalledOnce());
    rerender(<AIChatBox messages={[]} onSendMessage={vi.fn()} onUploadFiles={onUploadFiles} composerSessionId="chat-created-by-upload" />);
    resolveUpload?.({ attachments: [attachment], sessionId: "chat-created-by-upload" });

    await waitFor(() => expect(screen.getByRole("button", { name: "Открыть предпросмотр: created-chat.png" })).toBeTruthy());
    expect(screen.queryByText("created-chat.png")).toBeNull();
  });

  it("keeps a new-composer upload that settles before React rerenders with the created session", async () => {
    const user = userEvent.setup();
    const attachment = { id: "attachment-created-before-rerender", fileName: "created-before-rerender.png", mimeType: "image/png", sizeBytes: 1024, kind: "image" as const, previewUrl: "https://preview.example.test/created-before-rerender.png" };
    let resolveUpload: ((value: { attachments: typeof attachment[]; sessionId: string }) => void) | undefined;
    const onUploadFiles = vi.fn(() => new Promise<{ attachments: typeof attachment[]; sessionId: string }>((resolve) => { resolveUpload = resolve; }));
    const { container } = render(<AIChatBox messages={[]} onSendMessage={vi.fn()} onUploadFiles={onUploadFiles} composerSessionId="new-composer" />);
    const input = container.querySelector('input[type="file"]') as HTMLInputElement | null;
    if (!input) throw new Error("Attachment input is missing");

    await user.upload(input, new File(["image"], "created-before-rerender.png", { type: "image/png" }));
    await waitFor(() => expect(onUploadFiles).toHaveBeenCalledOnce());
    resolveUpload?.({ attachments: [attachment], sessionId: "chat-created-before-rerender" });

    await waitFor(() => expect(screen.getByRole("button", { name: "Открыть предпросмотр: created-before-rerender.png" })).toBeTruthy());
    expect(screen.queryByText("created-before-rerender.png")).toBeNull();
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
