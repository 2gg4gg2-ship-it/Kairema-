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

  it("shows neither the source count nor the date range in the chat", () => {
    render(<AIChatBox messages={[{ id: "assistant-1", role: "assistant", content: "Ответ", searchStatus: { state: "found", sourcesCount: 2, sourceDateMin: "2026-08-19T00:00:00.000Z", sourceDateMax: "2026-08-23T00:00:00.000Z" } }]} onSendMessage={vi.fn()} emptyStateMessage="Kairema" />);
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.queryByText(/Источники проверены/)).toBeNull();
    expect(screen.queryByText(/Даты источников/)).toBeNull();
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.queryByText(/example\.com|Свежий материал|Официальный RSS/)).toBeNull();
  });

  it("does not render quick prompts in an empty conversation", () => {
    render(<AIChatBox messages={[]} onSendMessage={vi.fn()} emptyStateMessage="Kairema" />);
    expect(screen.queryByRole("button", { name: /составь план|объясни|краткий план/i })).toBeNull();
  });
});
