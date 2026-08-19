// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AIChatBox } from "./AIChatBox";

describe("AIChatBox fresh-information hint", () => {
  it("suggests web search for current-data wording without toggling it automatically", () => {
    render(<AIChatBox messages={[]} onSendMessage={vi.fn()} webSearchAvailable emptyStateMessage="Kairema" />);
    fireEvent.change(screen.getByPlaceholderText("Напишите сообщение…"), { target: { value: "Какие сегодня новости?" } });
    expect(screen.getByText("Запрос может зависеть от актуальных данных. При необходимости включите поиск в интернете.")).toBeTruthy();
    expect(screen.getByLabelText("Искать в интернете").classList.contains("kairema-search-toggle-active")).toBe(false);
  });
});
