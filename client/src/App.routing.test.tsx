// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import App from "./App";

describe("gateway-safe welcome entry", () => {
  beforeEach(() => {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }),
    });
  });

  afterEach(() => window.history.replaceState({}, "", "/"));

  it("renders the data-free welcome screen from the canonical root query", () => {
    window.history.replaceState({}, "", "/?welcome=1");
    render(<App />);

    expect(screen.getByRole("button", { name: "Войти для истории" })).not.toBeNull();
    expect(screen.getByText("Войдите, чтобы начать")).not.toBeNull();
  });

  it("renders the local switch check before Home without loading a user surface", () => {
    window.history.replaceState({}, "", "/?switch-check=1");
    render(<App />);

    expect(screen.getByRole("heading", { name: "Switch без пользовательских данных" })).not.toBeNull();
    expect(screen.getByRole("switch", { name: "Проверочное состояние" })).not.toBeNull();
    expect(screen.queryByPlaceholderText("Напишите сообщение…")).toBeNull();
  });
});
