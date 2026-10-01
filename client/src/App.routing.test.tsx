// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./_core/hooks/useAuth", () => ({
  useAuth: () => ({ user: null, loading: false }),
}));

const mutation = { mutateAsync: vi.fn(), isPending: false };
vi.mock("@/lib/trpc", () => ({
  trpc: {
    auth: {
      stytch: {
        register: { useMutation: () => mutation },
        login: { useMutation: () => mutation },
        verifyOtp: { useMutation: () => mutation },
        resendVerification: { useMutation: () => mutation },
        requestPasswordReset: { useMutation: () => mutation },
        completePasswordReset: { useMutation: () => mutation },
      },
    },
  },
}));

import App from "./App";

describe("gateway-safe welcome entry", () => {
  beforeEach(() => {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }),
    });
  });

  afterEach(() => {
    cleanup();
    window.history.replaceState({}, "", "/");
  });

  it("renders the data-free welcome screen from the canonical root query", () => {
    window.history.replaceState({}, "", "/?welcome=1");
    render(<App />);

    expect(screen.getByRole("button", { name: "Продолжить с Google" })).not.toBeNull();
    expect(screen.getByRole("heading", { name: "Добро пожаловать" })).not.toBeNull();
  });

});
