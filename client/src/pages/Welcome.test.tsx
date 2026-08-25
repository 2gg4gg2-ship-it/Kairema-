/* @vitest-environment jsdom */
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

const fixtures = vi.hoisted(() => ({ startLogin: vi.fn() }));
vi.mock("@/const", () => ({ startLogin: fixtures.startLogin }));

import Welcome from "./Welcome";

describe("Welcome", () => {
  afterEach(() => {
    cleanup();
    fixtures.startLogin.mockReset();
  });

  it("offers visible provider-managed entries and starts only the existing OAuth handler", async () => {
    const user = userEvent.setup();
    render(<Welcome />);

    const googleLogin = screen.getByRole("button", { name: "Продолжить с Google" });
    const secureLogin = screen.getByRole("button", { name: "Войти через защищённый аккаунт" });
    expect(screen.getByText("Добро пожаловать")).not.toBeNull();
    await user.click(googleLogin);
    await user.click(secureLogin);
    expect(fixtures.startLogin).toHaveBeenCalledTimes(2);
  });

  it("can explain the provider-managed security model without exposing a local password flow", async () => {
    const user = userEvent.setup();
    render(<Welcome />);
    await user.click(screen.getByRole("button", { name: "Почему здесь нет пароля?" }));
    expect(screen.getByText(/не хранит локальные пароли/i)).not.toBeNull();
  });

  it("opens and closes accessible legal disclosures without navigating to missing routes", async () => {
    const user = userEvent.setup();
    render(<Welcome />);

    await user.click(screen.getByRole("button", { name: "Условия использования" }));
    expect(screen.getByLabelText("Условия использования")).not.toBeNull();
    await user.click(screen.getByRole("button", { name: "Закрыть" }));
    expect(screen.queryByLabelText("Условия использования")).toBeNull();

    await user.click(screen.getByRole("button", { name: "Политику конфиденциальности" }));
    expect(screen.getByLabelText("Политика конфиденциальности")).not.toBeNull();
  });
});
