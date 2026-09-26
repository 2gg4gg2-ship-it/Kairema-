/* @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React, { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { consumeChatStream } from "@/lib/chat-stream";
import { AIChatBox, formatAttachmentSize, redactLegacyAssistantReferences, type Message } from "./AIChatBox";

const encoder = new TextEncoder();
let releaseFinalStream: (() => void) | null = null;

// jsdom has no pointer capture, which the bottom sheet's swipe handling calls on pointerdown.
if (typeof Element !== "undefined") {
  Element.prototype.setPointerCapture ??= () => {};
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.hasPointerCapture ??= () => false;
}

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
      { id: assistantId, role: "assistant", content: "", providerLabel: "Kairema", model: "openrouter/free" },
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
        { id: "saved-assistant", role: "assistant", content: result.content ?? "", providerLabel: result.label, model: result.modelUsed, modelLabel: result.label },
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
    const reply: Message = { id: "assistant-1", role: "assistant", content: "Текст ответа", providerLabel: "Kairema Быстрый", model: "test-model" };
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
    const reply: Message = { id: "assistant-select", role: "assistant", content: "Выделяемый фрагмент ответа", providerLabel: "Kairema", model: "safe" };
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

  it("keeps the web-search status, the date range and the live-value verdict out of the reply", () => {
    const reply: Message = {
      id: "assistant-search",
      role: "assistant",
      content: "Проверенный ответ",
      model: "hidden-server-model",
      searchStatus: { state: "found", verificationStatus: "verified", sourcesCount: 2, sourceDateMin: "2025-01-01T00:00:00.000Z", sourceDateMax: "2026-09-26T00:00:00.000Z", liveValue: { kind: "temperature", status: "confirmed" } },
    };
    render(<AIChatBox messages={[reply]} onSendMessage={vi.fn()} />);

    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.queryByText(/Источники проверены/)).toBeNull();
    expect(screen.queryByText(/Контекст из веб-источников/)).toBeNull();
    expect(screen.queryByText(/Даты источников/)).toBeNull();
    expect(screen.queryByText(/Значение подтверждено источниками/)).toBeNull();
    expect(screen.queryByText(/Tavily|Google|OpenRouter/i)).toBeNull();
    expect(screen.queryByText(/https?:\/\//i)).toBeNull();
  });

  it("shows the factual model name and never a role label", () => {
    const base = { id: "assistant-model", role: "assistant" as const, content: "Ответ о погоде" };
    const { unmount } = render(<AIChatBox messages={[{ ...base, modelLabel: "Llama 3.1 8B Instant", model: "llama-3.1-8b-instant", providerLabel: "Kairema Flash" }]} onSendMessage={vi.fn()} />);
    expect(screen.getByText("Llama 3.1 8B Instant")).toBeTruthy();
    expect(screen.queryByText(/Kairema (Flash|Think|Context|Apex)/)).toBeNull();
    expect(screen.queryByText(/llama-3\.1-8b-instant/)).toBeNull();
    unmount();

    // A replayed message without a factual model name shows no model line at all.
    render(<AIChatBox messages={[{ ...base, model: "fast" }]} onSendMessage={vi.fn()} />);
    expect(screen.queryByText("fast")).toBeNull();
    expect(screen.queryByText(/Kairema (Flash|Think|Context|Apex)/)).toBeNull();
  });

  it("renders only verified public source evidence beneath a verified fresh reply", async () => {
    const user = userEvent.setup();
    const { container } = render(<AIChatBox messages={[{
      id: "assistant-source-evidence",
      role: "assistant",
      content: "Проверенный ответ",
      searchStatus: { state: "found", verificationStatus: "verified", sourcesCount: 1, sourceDateMin: "2026-08-23T00:00:00.000Z", sourceDateMax: "2026-08-23T00:00:00.000Z" },
      sources: [{ title: "Официальная публикация", url: "https://example.com/official", publishedAt: "2026-08-23T00:00:00.000Z" }],
    }]} onSendMessage={vi.fn()} />);

    await user.click(container.querySelector(".kairema-sources-chip") as HTMLElement);

    expect(screen.getByRole("link", { name: "Официальная публикация" }).getAttribute("href")).toBe("https://example.com/official");
    expect(document.querySelector(".kairema-source-meta-line")?.textContent).toBe("example.com · 23.08.2026");
  });

  it("renders V1 structured grounding as a source list without a grounding status line", async () => {
    const user = userEvent.setup();
    const { container } = render(<AIChatBox messages={[{
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

    expect(screen.queryByRole("status")).toBeNull();
    await user.click(container.querySelector(".kairema-sources-chip") as HTMLElement);
    expect(screen.getByRole("link", { name: "Первичный источник" }).getAttribute("href")).toBe("https://example.com/primary");
    expect(screen.queryByText(/Serper|Tavily|You\.com|Controller/i)).toBeNull();
  });

  it("renders no freshness badge and no links when fresh sources have no verified dates", () => {
    render(<AIChatBox messages={[{
      id: "assistant-freshness-blocked",
      role: "assistant",
      content: "Я не подтверждаю актуальность без датированных источников.",
      searchStatus: { state: "degraded", verificationStatus: "degraded", freshnessBlocked: true, sourcesCount: 0 },
    }]} onSendMessage={vi.fn()} />);

    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.queryByText(/Живой поиск недоступен/)).toBeNull();
    expect(screen.queryByRole("link")).toBeNull();
  });

  describe("verified source block", () => {
    const fiveSources = [
      { title: "SINOPTIK: Погода в Одессе (Украина)", url: "https://sinoptik.ua/ru/pohoda/odesa", publishedAt: "2026-09-26T09:00:00.000Z" },
      { title: "Погода в Одессе — Прогноз погоды", url: "https://www.meteofor.com/weather-odesa-4982/", publishedAt: "2026-09-25T09:00:00.000Z" },
      { title: "Погода в Одессе на сегодня", url: "https://meteopost.com/city/18697/" },
      { title: "Одесса, Украина", url: "https://www.meteopro.com/weather/Odesa/" },
      { title: "Погода METEOFOR", url: "https://meteofor.com/weather-odesa-4982/forecast", publishedAt: "2026-09-26T09:30:00.000Z" },
    ];
    const message = (overrides: Partial<Message> = {}): Message => ({
      id: "assistant-source-block",
      role: "assistant",
      content: "Проверенный ответ модели",
      searchStatus: { state: "found", verificationStatus: "verified", sourcesCount: 5, sourceDateMin: "2025-01-01T00:00:00.000Z", sourceDateMax: "2026-09-26T00:00:00.000Z" },
      sources: fiveSources,
      ...overrides,
    });

    it("keeps the inline chip as the only entry point and prints no status under the answer", () => {
      const { container } = render(<AIChatBox messages={[message()]} onSendMessage={vi.fn()} />);

      // The status line, the date range and the action-row sources pill are gone from the chat.
      expect(screen.queryByRole("status")).toBeNull();
      expect(container.querySelectorAll(".kairema-sources-pill")).toHaveLength(0);
      // The chip stays, and the cards themselves are not in the chat until the sheet is opened.
      expect(container.querySelectorAll(".kairema-sources-chip")).toHaveLength(1);
      expect(document.querySelectorAll(".kairema-source-card")).toHaveLength(0);
      expect(screen.getByText("Проверенный ответ модели")).toBeTruthy();
    });

    it("keeps Copy in the action row when a reply has sources", () => {
      const { container } = render(<AIChatBox messages={[message()]} onSendMessage={vi.fn()} />);

      const actions = container.querySelector(".kairema-message-actions");
      expect(actions).not.toBeNull();
      expect(actions?.querySelectorAll("button")).toHaveLength(1);
      expect(actions?.textContent).toContain("Копировать");
    });

    it("opens one bottom sheet from the chip and lists every source as a card", async () => {
      const user = userEvent.setup();
      const { container } = render(<AIChatBox messages={[message()]} onSendMessage={vi.fn()} />);

      await user.click(container.querySelector(".kairema-sources-chip") as HTMLElement);

      const sheet = document.querySelector(".kairema-sources-sheet");
      expect(sheet).not.toBeNull();
      expect(sheet?.textContent).toContain("Проверенные источники");
      expect(sheet?.textContent).toContain("5 источников");
      expect(document.querySelectorAll(".kairema-source-card")).toHaveLength(5);
      expect(screen.getByRole("link", { name: "SINOPTIK: Погода в Одессе (Украина)" }).getAttribute("href")).toBe("https://sinoptik.ua/ru/pohoda/odesa");
      expect(screen.getByText("https://meteopost.com/city/18697/")).toBeTruthy();
    });

    it("no longer opens a second entry point from the action row", () => {
      const { container } = render(<AIChatBox messages={[message()]} onSendMessage={vi.fn()} />);

      expect(container.querySelectorAll(".kairema-sources-pill")).toHaveLength(0);
      expect(document.querySelectorAll(".kairema-source-card")).toHaveLength(0);
    });

    it("closes on the close button and leaves the answer untouched", async () => {
      const user = userEvent.setup();
      const { container } = render(<AIChatBox messages={[message()]} onSendMessage={vi.fn()} />);

      await user.click(container.querySelector(".kairema-sources-chip") as HTMLElement);
      await user.click(screen.getByRole("button", { name: "Закрыть список источников" }));

      expect(document.querySelectorAll(".kairema-source-card")).toHaveLength(0);
      expect(screen.getByText("Проверенный ответ модели")).toBeTruthy();
    });

    it("closes on the Android back gesture instead of leaving the page", async () => {
      const user = userEvent.setup();
      const { container } = render(<AIChatBox messages={[message()]} onSendMessage={vi.fn()} />);

      await user.click(container.querySelector(".kairema-sources-chip") as HTMLElement);
      expect(document.querySelectorAll(".kairema-source-card")).toHaveLength(5);
      // The sheet pushed its own history entry, so the browser back is ours to consume.
      expect(window.history.state).toMatchObject({ kairemaSourcesSheet: true });

      window.dispatchEvent(new PopStateEvent("popstate"));

      await waitFor(() => expect(document.querySelectorAll(".kairema-source-card")).toHaveLength(0));
      expect(screen.getByText("Проверенный ответ модели")).toBeTruthy();
    });

    it("renders one list, one link per card and no nested link inside a card", async () => {
      const user = userEvent.setup();
      const { container } = render(<AIChatBox messages={[message()]} onSendMessage={vi.fn()} />);
      await user.click(container.querySelector(".kairema-sources-chip") as HTMLElement);

      // The old markup rendered one bare list item per source outside any block.
      expect(container.querySelector(".kairema-source-evidence")).toBeNull();
      expect(document.querySelectorAll("ul")).toHaveLength(1);
      expect(document.querySelectorAll(".kairema-source-list > .kairema-source-item")).toHaveLength(5);
      // Each card is exactly one link, so a tap anywhere on the card opens the source.
      expect(container.querySelectorAll(".kairema-source-card a")).toHaveLength(0);
    });

    it("keeps a long title and a long URL inside their own card without breaking the layout", async () => {
      const user = userEvent.setup();
      const longTitle = "Погода в Одессе на сегодня, прогноз по часам, ветер, влажность, давление, ощущается как и подробный прогноз на неделю";
      const longUrl = "https://example.com/a/very/long/path/to/a/weather/page/segmented/deeply/nested?utm_source=news&utm_campaign=weather&utm_content=card";
      const { container } = render(<AIChatBox messages={[message({ sources: [{ title: longTitle, url: longUrl, publishedAt: "2026-09-26T09:00:00.000Z" }] })]} onSendMessage={vi.fn()} />);
      await user.click(container.querySelector(".kairema-sources-chip") as HTMLElement);

      const link = screen.getByRole("link", { name: longTitle });
      expect(link.getAttribute("href")).toBe(longUrl);
      // Truncation and wrapping are CSS-only, so the DOM keeps one card with both strings
      // inside it and the long values are never pushed into a sibling row.
      const card = document.querySelector(".kairema-source-card");
      expect(card?.querySelector(".kairema-source-title")?.textContent).toBe(longTitle);
      expect(card?.querySelector(".kairema-source-url")?.textContent).toBe(longUrl);
      expect(card?.querySelector(".kairema-source-meta-line")?.textContent).toContain("26.09.2026");
    });

    it("keeps a card with no date and still shows the open affordance", async () => {
      const user = userEvent.setup();
      const { container } = render(<AIChatBox messages={[message({ sources: [{ title: "Без даты", url: "https://example.com/nodate" }] })]} onSendMessage={vi.fn()} />);
      await user.click(container.querySelector(".kairema-sources-chip") as HTMLElement);

      // With no date the host stands alone, and the external-link affordance is still there.
      expect(document.querySelector(".kairema-source-meta-line")?.textContent).toBe("example.com");
      expect(document.querySelector(".kairema-source-open")).not.toBeNull();
      expect(screen.getByRole("link", { name: "Без даты" }).getAttribute("href")).toBe("https://example.com/nodate");
    });

    it("keeps no grounding status line and still opens the citations from the chip", async () => {
      const user = userEvent.setup();
      const { container } = render(<AIChatBox messages={[{
        id: "assistant-grounding-block",
        role: "assistant",
        content: "Ответ с внешним контекстом",
        webGrounding: { intent: "REQUIRED", state: "verified", sourcesCount: 1, citations: [{ title: "Первичный источник", url: "https://example.com/primary", publishedAt: "2026-08-24T00:00:00.000Z" }] },
      }]} onSendMessage={vi.fn()} />);

      expect(screen.queryByRole("status")).toBeNull();
      expect(document.querySelectorAll(".kairema-source-card")).toHaveLength(0);
      await user.click(container.querySelector(".kairema-sources-chip") as HTMLElement);
      expect(document.querySelectorAll(".kairema-source-card")).toHaveLength(1);
    });

    it("offers no entry point and renders nothing extra when there is nothing to open", () => {
      const { container } = render(<AIChatBox messages={[message({ sources: [], searchStatus: { state: "found", verificationStatus: "verified", sourcesCount: 0 } })]} onSendMessage={vi.fn()} />);

      expect(container.querySelectorAll(".kairema-sources-chip")).toHaveLength(0);
      expect(container.querySelectorAll(".kairema-sources-pill")).toHaveLength(0);
      expect(document.querySelectorAll(".kairema-source-card")).toHaveLength(0);
      expect(screen.queryByRole("status")).toBeNull();
    });
  });

  it("redacts technical citation markers from legacy assistant replay and copied content", async () => {
    const user = userEvent.setup();
    const onCopyAssistant = vi.fn();
    const legacyContent = "Полезная часть. Массив значений [1, 2] остаётся видимым.\\n[Source: legacy-reference]\\n【†opaque-reference】\\n\\[a3b2c1d0e9f8a7b6, c4d3e2f1a0b9c8d7\\]";
    const reply: Message = { id: "legacy-assistant", role: "assistant", content: legacyContent, providerLabel: "Kairema Context", model: "safe-model" };
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
    // The factual model name from the stream is shown; the typing/complete status text is not.
    expect(screen.getByText("Kairema Auto-Router")).toBeTruthy();
    expect(screen.queryByText(/полный ответ/)).toBeNull();
    expect(screen.queryByText("печатает")).toBeNull();
    expect(screen.queryByText("openrouter/free")).toBeNull();
  });
});
