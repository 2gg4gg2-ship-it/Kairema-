// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AIChatBox } from "./AIChatBox";

describe("AIChatBox v5.6", () => {
  it("reflects the saved web-search preference and reports an explicit user change", () => {
    const onWebSearchChange = vi.fn();
    render(<AIChatBox messages={[]} onSendMessage={vi.fn()} webSearchAvailable initialWebSearch onWebSearchChange={onWebSearchChange} emptyStateMessage="Kairema" />);
    const toggle = screen.getByLabelText("Искать в интернете");
    expect(toggle.classList.contains("kairema-search-toggle-active")).toBe(true);
    fireEvent.click(toggle);
    expect(onWebSearchChange).toHaveBeenCalledWith(false);
  });

  it("exposes copy for a user message independently from assistant actions", () => {
    const onCopyUser = vi.fn();
    render(<AIChatBox messages={[{ id: "user-1", role: "user", content: "Проверочный текст" }]} onSendMessage={vi.fn()} onCopyUser={onCopyUser} emptyStateMessage="Kairema" />);
    fireEvent.click(screen.getByRole("button", { name: "Копировать" }));
    expect(onCopyUser).toHaveBeenCalledWith(expect.objectContaining({ id: "user-1", role: "user", content: "Проверочный текст" }));
  });

  it("shows transparent web and RAG source labels without inventing a missing publication date", () => {
    render(<AIChatBox messages={[{ id: "assistant-1", role: "assistant", content: "Ответ", sources: [{ title: "Свежий материал", url: "https://example.com/web" }, { title: "Официальный RSS", url: "https://example.com/rss", kind: "rag", publishedAt: "2026-08-19T00:00:00.000Z" }] }]} onSendMessage={vi.fn()} emptyStateMessage="Kairema" />);
    expect(screen.getByText(/Веб · Свежий материал · дата не указана/)).toBeTruthy();
    expect(screen.getByText(/RAG · Официальный RSS · 19\.08\.2026/)).toBeTruthy();
  });
});
