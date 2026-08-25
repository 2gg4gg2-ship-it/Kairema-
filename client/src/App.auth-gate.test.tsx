// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fixtures = vi.hoisted(() => ({
  auth: { user: null as { id: number } | null, loading: false },
}));

vi.mock("./_core/hooks/useAuth", () => ({
  useAuth: () => fixtures.auth,
}));
vi.mock("./pages/Welcome", () => ({ default: () => <div data-testid="auth-gate">auth gate</div> }));
vi.mock("./pages/Home", () => ({ default: () => <div data-testid="private-home">private home</div> }));
vi.mock("./pages/OwnerAnalytics", () => ({ default: () => <div data-testid="private-owner-analytics">private owner analytics</div> }));

import { OwnerAnalyticsRoute, RootRoute } from "./App";

describe("RootRoute first-launch auth gate", () => {
  afterEach(() => cleanup());

  beforeEach(() => {
    window.history.replaceState({}, "", "/");
    fixtures.auth = { user: null, loading: false };
  });

  it("keeps the private app behind the gate for a guest", () => {
    render(<RootRoute />);
    expect(screen.getByTestId("auth-gate")).not.toBeNull();
    expect(screen.queryByTestId("private-home")).toBeNull();
  });

  it("renders the private app only after a verified user is available", () => {
    fixtures.auth = { user: { id: 7 }, loading: false };
    render(<RootRoute />);
    expect(screen.getByTestId("private-home")).not.toBeNull();
    expect(screen.queryByTestId("auth-gate")).toBeNull();
  });

  it("returns to the auth gate when a private session is reset to guest state", () => {
    fixtures.auth = { user: { id: 7 }, loading: false };
    const view = render(<RootRoute />);
    expect(screen.getByTestId("private-home")).not.toBeNull();

    fixtures.auth = { user: null, loading: false };
    view.rerender(<RootRoute />);

    expect(screen.getByTestId("auth-gate")).not.toBeNull();
    expect(screen.queryByTestId("private-home")).toBeNull();
  });

  it("keeps a direct private owner route behind the same guest gate", () => {
    render(<OwnerAnalyticsRoute />);

    expect(screen.getByTestId("auth-gate")).not.toBeNull();
    expect(screen.queryByTestId("private-owner-analytics")).toBeNull();
  });

  it("renders the owner route shell only after a verified session is available", () => {
    fixtures.auth = { user: { id: 7 }, loading: false };
    render(<OwnerAnalyticsRoute />);

    expect(screen.getByTestId("private-owner-analytics")).not.toBeNull();
    expect(screen.queryByTestId("auth-gate")).toBeNull();
  });
});
