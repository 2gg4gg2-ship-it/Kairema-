// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AIChatBox } from "./AIChatBox";

describe("AIChatBox v5.6", () => {
  it("forwards an attachment request without exposing a web-search preference", () => {
    const onSendMessage = vi.fn();
    render(<AIChatBox messages={[]} onSendMessage={onSendMessage} emptyStateMessage="Kairema" />);
    fireEvent.change(screen.getByPlaceholderText("Напишите сообщение…"), { target: { value: "Какие сегодня новости?" } });
    fireEvent.click(screen.getByRole("button", { name: "Отправить сообщение" }));
    expect(onSendMessage).toHaveBeenCalledWith("Какие сегодня новости?", expect.objectContaining({
      attachmentIds: [],
      clientMessageId: expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i),
    }));
    expect(screen.queryByLabelText("Искать в интернете")).toBeNull();
  });

  it("exposes copy for a user message independently from assistant actions", () => {
    const onCopyUser = vi.fn();
    render(<AIChatBox messages={[{ id: "user-1", role: "user", content: "Проверочный текст" }]} onSendMessage={vi.fn()} onCopyUser={onCopyUser} emptyStateMessage="Kairema" />);
    fireEvent.click(screen.getByRole("button", { name: "Копировать" }));
    expect(onCopyUser).toHaveBeenCalledWith(expect.objectContaining({ id: "user-1", role: "user", content: "Проверочный текст" }));
  });

  it("shows transparent source title, domain and publication date only after an explicit expansion", () => {
    render(<AIChatBox messages={[{ id: "assistant-1", role: "assistant", content: "Ответ", sources: [{ title: "Свежий материал", url: "https://example.com/web" }, { title: "Официальный RSS", url: "https://example.com/rss", kind: "rag", publishedAt: "2026-08-19T00:00:00.000Z" }] }]} onSendMessage={vi.fn()} emptyStateMessage="Kairema" />);
    expect(screen.getByRole("button", { name: "Источники (2)" }).getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(screen.getByRole("button", { name: "Источники (2)" }));
    expect(screen.getByRole("link", { name: /Свежий материал/ }).getAttribute("href")).toBe("https://example.com/web");
    expect(screen.getByRole("link", { name: /Официальный RSS/ }).getAttribute("href")).toBe("https://example.com/rss");
    expect(screen.getByText(/example\.com · 19\.08\.2026/)).toBeTruthy();
  });

  it("does not render quick prompts in an empty conversation", () => {
    render(<AIChatBox messages={[]} onSendMessage={vi.fn()} emptyStateMessage="Kairema" />);
    expect(screen.queryByRole("button", { name: /составь план|объясни|краткий план/i })).toBeNull();
  });
});
