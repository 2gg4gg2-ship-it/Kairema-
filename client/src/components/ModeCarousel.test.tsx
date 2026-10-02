/* @vitest-environment jsdom */
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MessageSquare, Repeat, SquareTerminal } from "lucide-react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import ModeCarousel, { type ModeDescriptor } from "./ModeCarousel";

/**
 * The single compact mode switcher.
 *
 * <p>The contract that matters: only the current mode is exposed, exactly one control is rendered,
 * the arrows step one mode at a time and disable at the ends, and the control's width does not
 * depend on which mode is showing, so nothing around it reflows when the mode changes.
 */

const MODES: ModeDescriptor[] = [
  { id: "chat", label: "Чат", icon: <MessageSquare className="size-4" /> },
  { id: "terminal", label: "Терминал", icon: <SquareTerminal className="size-4" /> },
  { id: "myApi", label: "Мой API", icon: <Repeat className="size-4" /> },
];

const LABELS = {
  group: "Режим",
  previous: "Предыдущий режим",
  next: "Следующий режим",
  position: (index: number, total: number) => `Режим ${index + 1} из ${total}`,
};

function renderCarousel(value: string, onChange = vi.fn()) {
  render(<ModeCarousel modes={MODES} value={value} onChange={onChange} labels={LABELS} />);
  return { onChange };
}

/** The modes the carousel reports as current, in carousel order. */
function currentModes(): string[] {
  return Array.from(document.querySelectorAll(".kairema-mode-page"))
    .filter((page) => page.getAttribute("data-current") === "true")
    .map((page) => page.getAttribute("data-mode")!);
}

afterEach(() => {
  cleanup();
});

describe("ModeCarousel", () => {
  it("shows only the current mode", () => {
    renderCarousel("terminal");

    expect(currentModes()).toEqual(["terminal"]);
    // The current label is on screen; the other two are present but not current.
    expect(screen.getByTestId("mode-current").textContent).toContain("Терминал");
    expect(screen.queryByText("Мой API")).not.toBeNull(); // rendered as a page, but not selected
  });

  it("exposes exactly one control, not one button per mode", () => {
    renderCarousel("chat");

    expect(screen.getAllByRole("group")).toHaveLength(1);
    expect(screen.getAllByRole("button")).toHaveLength(2); // previous + next only
  });

  it("advances one mode at a time and reports the new mode", async () => {
    const onChange = vi.fn();
    // Controlled, so the host has to move the value on for the second step to be from Терминал.
    function Host() {
      const [value, setValue] = useState("chat");
      return (
        <ModeCarousel
          modes={MODES}
          value={value}
          onChange={(next) => {
            onChange(next);
            setValue(next);
          }}
          labels={LABELS}
        />
      );
    }
    render(<Host />);

    await userEvent.click(screen.getByTestId("mode-next"));
    expect(onChange).toHaveBeenNthCalledWith(1, "terminal");
    expect(currentModes()).toEqual(["terminal"]);

    await userEvent.click(screen.getByTestId("mode-next"));
    expect(onChange).toHaveBeenNthCalledWith(2, "myApi");
    expect(currentModes()).toEqual(["myApi"]);
  });

  it("steps back with the previous arrow", async () => {
    const { onChange } = renderCarousel("myApi");

    await userEvent.click(screen.getByTestId("mode-previous"));
    expect(onChange).toHaveBeenCalledWith("terminal");
  });

  it("disables the arrows at the ends instead of wrapping", () => {
    const { unmount } = render(<ModeCarousel modes={MODES} value="chat" onChange={vi.fn()} labels={LABELS} />);
    expect(screen.getByTestId("mode-previous")).toHaveProperty("disabled", true);
    expect(screen.getByTestId("mode-next")).toHaveProperty("disabled", false);
    unmount();

    render(<ModeCarousel modes={MODES} value="myApi" onChange={vi.fn()} labels={LABELS} />);
    expect(screen.getByTestId("mode-previous")).toHaveProperty("disabled", false);
    expect(screen.getByTestId("mode-next")).toHaveProperty("disabled", true);
  });

  it("marks every other page hidden from assistive tech", () => {
    const { container } = render(
      <ModeCarousel modes={MODES} value="chat" onChange={vi.fn()} labels={LABELS} />,
    );

    const pages = Array.from(container.querySelectorAll(".kairema-mode-page"));
    expect(pages.map((page) => page.getAttribute("aria-hidden"))).toEqual(["false", "true", "true"]);
  });

  it("sizes itself for the longest label, so paging cannot change its width", () => {
    const widths = ["chat", "terminal", "myApi"].map((value) => {
      const { container, unmount } = render(
        <ModeCarousel modes={MODES} value={value} onChange={vi.fn()} labels={LABELS} />,
      );
      const width = (container.querySelector(".kairema-mode-carousel-viewport") as HTMLElement).style.width;
      unmount();
      return width;
    });

    // All three modes yield the same width, so the row around the carousel cannot reflow.
    expect(new Set(widths).size).toBe(1);
    expect(widths[0]).toBeTruthy();
  });

  it("announces the position without adding visible chrome", () => {
    renderCarousel("myApi");

    const status = screen.getByRole("status");
    expect(status.textContent).toContain("Режим 3 из 3");
    expect(status.className).toContain("sr-only");
  });

  it("works with only two modes when the terminal is absent", async () => {
    const webModes = MODES.filter((mode) => mode.id !== "terminal");
    const onChange = vi.fn();
    render(<ModeCarousel modes={webModes} value="chat" onChange={onChange} labels={LABELS} />);

    expect(currentModes()).toEqual(["chat"]);
    await userEvent.click(screen.getByTestId("mode-next"));
    expect(onChange).toHaveBeenCalledWith("myApi");
  });
});