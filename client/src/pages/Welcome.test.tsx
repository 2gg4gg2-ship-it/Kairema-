// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const fixtures = vi.hoisted(() => ({
  startLogin: vi.fn(),
  register: vi.fn(),
  login: vi.fn(),
  verifyOtp: vi.fn(),
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
      verifyOtp: { useMutation: () => ({ mutateAsync: fixtures.verifyOtp, isPending: false }) },
      resendVerification: { useMutation: () => ({ mutateAsync: fixtures.resend, isPending: false }) },
      requestPasswordReset: { useMutation: () => ({ mutateAsync: fixtures.resetStart, isPending: false }) },
      completePasswordReset: { useMutation: () => ({ mutateAsync: fixtures.resetComplete, isPending: false }) },
    } },
  },
}));

import Welcome from "./Welcome";

let navigate: ReturnType<typeof vi.fn>;
let currentSearch = "";

/**
 * A completed sign-in hands control back to the router with a navigation, so "the user got into the
 * app" is asserted by watching that call rather than by a rendered route.
 */
function installRouter() {
  navigate = vi.fn();
  currentSearch = "";
  delete (window as unknown as { location?: unknown }).location;
  (window as unknown as { location: unknown }).location = {
    assign: navigate,
    get search() {
      return currentSearch;
    },
  };
}

function resetDefaults() {
  fixtures.startLogin.mockReset();
  fixtures.register.mockReset().mockResolvedValue({ state: "VERIFICATION_REQUIRED" });
  fixtures.login.mockReset().mockResolvedValue({ state: "OTP_REQUIRED" });
  fixtures.verifyOtp.mockReset().mockResolvedValue({ state: "SIGNED_IN" });
  fixtures.resend.mockReset().mockResolvedValue({ state: "DELIVERY_REQUESTED" });
  fixtures.resetStart.mockReset().mockResolvedValue({ state: "DELIVERY_REQUESTED" });
  fixtures.resetComplete.mockReset().mockResolvedValue({ state: "SIGNED_IN" });
}

function inputsLabelled(label: string) {
  return screen.getAllByLabelText(label).filter((node): node is HTMLInputElement => node.tagName === "INPUT");
}

function expectPinned(field: HTMLInputElement) {
  expect(field.getAttribute("autocapitalize")).toBe("none");
  expect(field.getAttribute("autocorrect")).toBe("off");
  expect(field.getAttribute("spellcheck")).toBe("false");
}

async function openLoginForm(user: ReturnType<typeof userEvent.setup>) {
  render(<Welcome />);
  await user.click(screen.getByRole("button", { name: "Продолжить с Google" }));
  await user.click(screen.getByRole("button", { name: "Войти по email и паролю" }));
}

async function fillCredentials(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText("Email"), "owner@example.test");
  await user.type(screen.getByLabelText("Пароль"), "correct horse battery");
  await user.click(screen.getByRole("button", { name: "Войти" }));
}

beforeAll(() => {
  // The code field measures its own caret slot. jsdom has no observer, and without a stub the
  // component throws on mount, which would hide the very view these tests are about.
  vi.stubGlobal("ResizeObserver", class {
    observe() {}
    unobserve() {}
    disconnect() {}
  });
  // The code field also asks what is under the caret, on a timer, after the test has moved on.
  // jsdom has no hit testing, and the failure would surface as an unhandled error against whichever
  // test happened to be running.
  document.elementFromPoint = () => null;
});

beforeEach(() => {
  installRouter();
  resetDefaults();
});

afterEach(() => {
  cleanup();
  resetDefaults();
});

describe("Welcome", () => {
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
    await openLoginForm(user);
    // The point of the assertion below is that registering never falls back to OAuth, so the
    // provider entry that opened the form is cleared first.
    fixtures.startLogin.mockReset();
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
    await openLoginForm(user);
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
    expect(screen.getByLabelText("Условия использования")).not.toBeNull();
    await user.click(screen.getByRole("button", { name: "Закрыть" }));
    expect(screen.queryByLabelText("Условия использования")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Политику конфиденциальности" }));
    expect(screen.getByLabelText("Политика конфиденциальности")).not.toBeNull();
  });
});

describe("Welcome sign-in contract", () => {
  it("asks for the code when the provider answers OTP_REQUIRED", async () => {
    const user = userEvent.setup();
    await openLoginForm(user);
    await fillCredentials(user);

    await waitFor(() => expect(fixtures.login).toHaveBeenCalledWith({ email: "owner@example.test", password: "correct horse battery" }));
    expect(await screen.findByRole("heading", { name: "Подтвердите email" })).not.toBeNull();
    expect(screen.getByText(/Мы отправили 6-значный код/i)).not.toBeNull();
    expect(navigate).not.toHaveBeenCalled();
  });

  it("enters the app when the provider answers SIGNED_IN instead of a code", async () => {
    fixtures.login.mockResolvedValue({ state: "SIGNED_IN" });
    const user = userEvent.setup();
    await openLoginForm(user);
    await fillCredentials(user);

    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/"));
    expect(screen.queryByText(/Не удалось подтвердить email или пароль/i)).toBeNull();
  });

  it("explains the email confirmation when the provider answers VERIFICATION_REQUIRED", async () => {
    fixtures.login.mockResolvedValue({ state: "VERIFICATION_REQUIRED" });
    const user = userEvent.setup();
    await openLoginForm(user);
    await fillCredentials(user);

    expect(await screen.findByText(/Подтвердите email по ссылке/i)).not.toBeNull();
    expect(navigate).not.toHaveBeenCalled();
  });

  it("never treats an unrecognised answer as a session", async () => {
    fixtures.login.mockResolvedValue({ state: "SOMETHING_NEW" });
    const user = userEvent.setup();
    await openLoginForm(user);
    await fillCredentials(user);

    expect(await screen.findByText(/Не удалось подтвердить email или пароль/i)).not.toBeNull();
    expect(navigate).not.toHaveBeenCalled();
  });

  it("keeps a rejected password on the form and never claims a code was sent", async () => {
    fixtures.login.mockRejectedValue(new Error("UNAUTHORIZED"));
    const user = userEvent.setup();
    await openLoginForm(user);
    await fillCredentials(user);

    expect(await screen.findByText(/Не удалось подтвердить email или пароль/i)).not.toBeNull();
    expect(screen.getByRole("heading", { name: "Войти по email" })).not.toBeNull();
    expect(navigate).not.toHaveBeenCalled();
  });

  it("enters the app after the code is verified", async () => {
    const user = userEvent.setup();
    await openLoginForm(user);
    await fillCredentials(user);
    await screen.findByRole("heading", { name: "Подтвердите email" });

    await user.type(screen.getByRole("textbox"), "123456");
    await user.click(screen.getByRole("button", { name: "Подтвердить код" }));

    await waitFor(() => expect(fixtures.verifyOtp).toHaveBeenCalledWith({ code: "123456" }));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/"));
  });

  it("asks for another code when verification is refused", async () => {
    fixtures.verifyOtp.mockRejectedValue(new Error("UNAUTHORIZED"));
    const user = userEvent.setup();
    await openLoginForm(user);
    await fillCredentials(user);
    await screen.findByRole("heading", { name: "Подтвердите email" });

    await user.type(screen.getByRole("textbox"), "000000");
    await user.click(screen.getByRole("button", { name: "Подтвердить код" }));

    expect(await screen.findByText(/Неверный код/i)).not.toBeNull();
    expect(navigate).not.toHaveBeenCalled();
  });

  it("refuses to let the keyboard rewrite a credential before it is sent", async () => {
    const user = userEvent.setup();
    await openLoginForm(user);

    // A soft keyboard that capitalises or autocorrects changes the password bytes the provider
    // receives, which is indistinguishable from a wrong password once it has been hashed.
    expectPinned(screen.getByLabelText("Email") as HTMLInputElement);
    expectPinned(screen.getByLabelText("Пароль") as HTMLInputElement);
  });

  it("pins the reset fields too", () => {
    currentSearch = "?reset=1";
    render(<Welcome />);

    for (const label of ["Новый пароль", "Повторите новый пароль"]) {
      // The section is labelled by its heading too, so only the inputs are of interest here.
      for (const field of inputsLabelled(label)) expectPinned(field);
    }
  });
});
