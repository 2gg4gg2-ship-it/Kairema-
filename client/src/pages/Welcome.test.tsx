/* @vitest-environment jsdom */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

const fixtures = vi.hoisted(() => ({ startLogin: vi.fn() }));
vi.mock("@/const", () => ({ startLogin: fixtures.startLogin }));

import Welcome from "./Welcome";

describe("Welcome", () => {
  afterEach(() => fixtures.startLogin.mockReset());

  it("offers one visible phone-friendly entry and starts only the existing OAuth handler on click", async () => {
    const user = userEvent.setup();
    render(<Welcome />);

    const login = screen.getByRole("button", { name: "Войти для истории" });
    expect(login).not.toBeNull();
    await user.click(login);
    expect(fixtures.startLogin).toHaveBeenCalledTimes(1);
  });
});
