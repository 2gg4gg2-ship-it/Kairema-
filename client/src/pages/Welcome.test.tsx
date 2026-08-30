// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

const fixtures = vi.hoisted(() => ({
  startLogin: vi.fn(),
  register: vi.fn(),
  login: vi.fn(),
  resend: vi.fn(),
  resetStart: vi.fn(),
  resetComplete: vi.fn(),
}));
vi.mock("@/const", () => ({ startLogin: fixtures.startLogin }));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    auth: { stytch: {
      register: { useMutation: () => ({ mutateAsync: fixtures.register, isPending: false }) },
      login: { useMutation: () => ({ mutateAsync: fixtures.login, isPending: false }) },
      resendVerification: { useMutation: () => ({ mutateAsync: fixtures.resend, isPending: false }) },
      requestPasswordReset: { useMutation: () => ({ mutateAsync: fixtures.resetStart, isPending: false }) },
      completePasswordReset: { useMutation: () => ({ mutateAsync: fixtures.resetComplete, isPending: false }) },
    } },
  },
}));

import Welcome from "./Welcome";

describe("Welcome", () => {
  afterEach(() => {
    cleanup();
    fixtures.startLogin.mockReset();
    fixtures.register.mockReset().mockResolvedValue({ state: "VERIFICATION_REQUIRED" });
    fixtures.login.mockReset().mockResolvedValue({ state: "VERIFICATION_REQUIRED" });
    fixtures.resend.mockReset().mockResolvedValue({ state: "DELIVERY_REQUESTED" });
    fixtures.resetStart.mockReset().mockResolvedValue({ state: "DELIVERY_REQUESTED" });
    fixtures.resetComplete.mockReset().mockResolvedValue({ state: "SIGNED_IN" });
    window.history.replaceState({}, "", "/");
  });

  it("keeps the existing OAuth handler while opening an independent provider-managed email flow", async () => {
    const user = userEvent.setup();
    render(<Welcome />);
    await user.click(screen.getByRole("button", { name: "Продолжить с Google" }));
    await user.click(screen.getByRole("button", { name: "Войти по email и паролю" }));
    expect(fixtures.startLogin).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("heading", { name: "Войти по email" })).not.toBeNull();
    expect(screen.getByLabelText("Email")).not.toBeNull();
    expect(screen.getByLabelText("Пароль")).not.toBeNull();
  });

  it("submits registration only to the provider-backed contract and moves to verification", async () => {
    const user = userEvent.setup();
    render(<Welcome />);
    await user.click(screen.getByRole("button", { name: "Войти по email и паролю" }));
    await user.click(screen.getByRole("button", { name: "Создать аккаунт" }));
    await user.type(screen.getByLabelText("Email"), "member@example.test");
    await user.type(screen.getByLabelText("Пароль"), "secure passphrase");
    await user.type(screen.getByLabelText("Повторите пароль"), "secure passphrase");
    await user.click(screen.getByRole("button", { name: "Создать и подтвердить email" }));
    await waitFor(() => expect(fixtures.register).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("heading", { name: "Подтвердите email" })).not.toBeNull();
    expect(fixtures.startLogin).not.toHaveBeenCalled();
  });

  it("uses a generic recovery request path without rendering token or provider error details", async () => {
    const user = userEvent.setup();
    render(<Welcome />);
    await user.click(screen.getByRole("button", { name: "Войти по email и паролю" }));
    await user.click(screen.getByRole("button", { name: "Забыли пароль?" }));
    await user.type(screen.getByLabelText("Email для восстановления"), "member@example.test");
    await user.click(screen.getByRole("button", { name: "Отправить ссылку" }));
    await waitFor(() => expect(fixtures.resetStart).toHaveBeenCalledTimes(1));
    expect(screen.getByText(/Если этот адрес доступен для восстановления/i)).not.toBeNull();
    expect(screen.queryByText(/token|request_id|api key/i)).toBeNull();
  });

  it("explains that passwords and session artifacts stay provider-managed", async () => {
    const user = userEvent.setup();
    render(<Welcome />);
    await user.click(screen.getByRole("button", { name: "Как защищён email-вход?" }));
    expect(screen.getByText(/не хранит локальные password hashes, JWT или reset-токены/i)).not.toBeNull();
  });

  it("opens and closes accessible legal disclosures without navigating to missing routes", async () => {
    const user = userEvent.setup();
    render(<Welcome />);
    await user.click(screen.getByRole("button", { name: "Условия использования" }));
    expect(screen.getByRole("region", { name: "Условия использования" })).not.toBeNull();
    await user.click(screen.getByRole("button", { name: "Закрыть" }));
    expect(screen.queryByRole("region", { name: "Условия использования" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Политику конфиденциальности" }));
    expect(screen.getByRole("region", { name: "Политика конфиденциальности" })).not.toBeNull();
  });

  it("shows login button loading state while login is in flight", async () => {
    const user = userEvent.setup();
    let resolveLogin: (value: { state: string }) => void = () => {};
    fixtures.login.mockReset().mockReturnValue(new Promise((resolve) => { resolveLogin = resolve; }));
    render(<Welcome />);
    await user.click(screen.getByRole("button", { name: "Войти по email и паролю" }));
    await user.type(screen.getByLabelText("Email"), "member@example.test");
    await user.type(screen.getByLabelText("Пароль"), "secure passphrase");
    await user.click(screen.getByRole("button", { name: "Войти" }));
    expect(screen.getByRole("button", { name: "Вход..." })).not.toBeNull();
    resolveLogin({ state: "VERIFICATION_REQUIRED" });
    await waitFor(() => expect(screen.getByRole("heading", { name: "Подтвердите email" })).not.toBeNull());
  });

  it("shows 401 notice when login fails with unauthorized", async () => {
    const user = userEvent.setup();
    fixtures.login.mockReset().mockRejectedValueOnce({ data: { httpStatus: 401 } });
    render(<Welcome />);
    await user.click(screen.getByRole("button", { name: "Войти по email и паролю" }));
    await user.type(screen.getByLabelText("Email"), "member@example.test");
    await user.type(screen.getByLabelText("Пароль"), "secure passphrase");
    await user.click(screen.getByRole("button", { name: "Войти" }));
    await waitFor(() => expect(screen.getByText(/Неверный email или пароль \(staging diagnostic: HTTP 401\)/i)).not.toBeNull());
  });

  it("shows 500 notice when login fails with server error", async () => {
    const user = userEvent.setup();
    fixtures.login.mockReset().mockRejectedValueOnce({ data: { httpStatus: 500 } });
    render(<Welcome />);
    await user.click(screen.getByRole("button", { name: "Войти по email и паролю" }));
    await user.type(screen.getByLabelText("Email"), "member@example.test");
    await user.type(screen.getByLabelText("Пароль"), "secure passphrase");
    await user.click(screen.getByRole("button", { name: "Войти" }));
    await waitFor(() => expect(screen.getByText(/Ошибка сервера \(staging diagnostic: HTTP 500\)/i)).not.toBeNull());
  });

  it("shows client error notice when login fails without httpStatus", async () => {
    const user = userEvent.setup();
    fixtures.login.mockReset().mockRejectedValueOnce({});
    render(<Welcome />);
    await user.click(screen.getByRole("button", { name: "Войти по email и паролю" }));
    await user.type(screen.getByLabelText("Email"), "member@example.test");
    await user.type(screen.getByLabelText("Пароль"), "secure passphrase");
    await user.click(screen.getByRole("button", { name: "Войти" }));
    await waitFor(() => expect(screen.getByText(/Сеть или клиент временно недоступны/i)).not.toBeNull());
  });

  it("clears loading state on successful SIGNED_IN login without showing an error", async () => {
    const user = userEvent.setup();
    fixtures.login.mockReset().mockResolvedValueOnce({ state: "SIGNED_IN" });
    render(<Welcome />);
    await user.click(screen.getByRole("button", { name: "Войти по email и паролю" }));
    await user.type(screen.getByLabelText("Email"), "member@example.test");
    await user.type(screen.getByLabelText("Пароль"), "secure passphrase");
    await user.click(screen.getByRole("button", { name: "Войти" }));
    await waitFor(() => expect(fixtures.login).toHaveBeenCalledTimes(1));
    expect(screen.queryByText(/Неверный email или пароль/i)).toBeNull();
    expect(screen.queryByText(/Ошибка сервера/i)).toBeNull();
  });

  it("never leaves the UI silent after a failed login mutation", async () => {
    const user = userEvent.setup();
    fixtures.login.mockReset().mockRejectedValueOnce(new Error("network"));
    render(<Welcome />);
    await user.click(screen.getByRole("button", { name: "Войти по email и паролю" }));
    await user.type(screen.getByLabelText("Email"), "member@example.test");
    await user.type(screen.getByLabelText("Пароль"), "secure passphrase");
    await user.click(screen.getByRole("button", { name: "Войти" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Войти" })).not.toBeNull());
    expect(screen.getByText(/Сеть или клиент временно недоступны/i)).not.toBeNull();
  });
});
