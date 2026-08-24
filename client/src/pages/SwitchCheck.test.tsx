// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import SwitchCheck from "./SwitchCheck";

describe("SwitchCheck", () => {
  it("toggles only its local visual state", () => {
    render(<SwitchCheck />);

    const control = screen.getByRole("switch", { name: "Проверочное состояние" });
    expect(control.getAttribute("data-state")).toBe("unchecked");
    expect(screen.getByText("Проверочное состояние выключено.")).not.toBeNull();

    fireEvent.click(control);

    expect(control.getAttribute("data-state")).toBe("checked");
    expect(screen.getByText("Проверочное состояние включено.")).not.toBeNull();
    expect(screen.queryByText("История чата")).toBeNull();
  });
});
