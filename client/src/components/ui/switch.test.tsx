/* @vitest-environment jsdom */
import { readFileSync } from "node:fs";

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

  it("keeps checked-state thumb travel and reduced-motion fallback in the stylesheet", () => {
    const css = readFileSync(`${process.cwd()}/client/src/index.css`, "utf8");

    expect(css).toContain(".kairema-switch-thumb { transform: translateX(0)");
    expect(css).toContain(
      '.kairema-switch-root[data-state="checked"] .kairema-switch-thumb { transform: translateX(1.25rem)'
    );
    expect(css).toContain("transition-duration: 0ms");
  });
});
