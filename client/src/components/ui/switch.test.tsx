/* @vitest-environment jsdom */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { Switch } from "./switch";

describe("Switch", () => {
  it("keeps explicit root and thumb hooks while checked state lives on the root", async () => {
    const user = userEvent.setup();
    render(<Switch aria-label="Память" />);

    const control = screen.getByRole("switch", { name: "Память" });
    const thumb = control.querySelector('[data-slot="switch-thumb"]');
    expect(control.className).toContain("kairema-switch-root");
    expect(thumb?.className).toContain("kairema-switch-thumb");
    expect(control.getAttribute("data-state")).toBe("unchecked");

    await user.click(control);
    expect(control.getAttribute("data-state")).toBe("checked");
  });
});
