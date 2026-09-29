// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AIChatBox } from "./AIChatBox";

const turn = [{ id: "assistant-1", role: "assistant" as const, content: "Ответ" }];

afterEach(() => cleanup());

function renderBox(props: Partial<React.ComponentProps<typeof AIChatBox>> = {}) {
  const onExportMarkdown = vi.fn();
  const onExportPdf = vi.fn();
  render(<AIChatBox messages={turn} onSendMessage={vi.fn()} onExportMarkdown={onExportMarkdown} onExportPdf={onExportPdf} canExport language="ru" emptyStateMessage="Kairema" {...props} />);
  return { onExportMarkdown, onExportPdf };
}

describe("the compact chat export control", () => {
  it("is a working button, not an inert fragment", async () => {
    const { onExportMarkdown } = renderBox();
    const trigger = screen.getByRole("button", { name: "Экспорт" });
    await userEvent.click(trigger);
    // The panel is portaled to the body, so the row that contains the button cannot clip it.
    const menu = await screen.findByRole("menu", { name: "Экспорт" });
    expect(menu.closest(".kairema-panel-collapse")).toBeNull();
  });

  it("really starts the Markdown and PDF exports it already had", async () => {
    const { onExportMarkdown, onExportPdf } = renderBox();
    await userEvent.click(screen.getByRole("button", { name: "Экспорт" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: /Markdown/ }));
    expect(onExportMarkdown).toHaveBeenCalledTimes(1);
    expect(onExportPdf).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: "Экспорт" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: /PDF/ }));
    expect(onExportPdf).toHaveBeenCalledTimes(1);
  });

  it("explains itself instead of offering a dead option when there is nothing to export", async () => {
    const { onExportMarkdown } = renderBox({ canExport: false });
    await userEvent.click(screen.getByRole("button", { name: "Экспорт" }));
    expect((await screen.findByRole("menuitem", { name: /Markdown/ }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/уже сохранён/)).toBeTruthy();
    expect(onExportMarkdown).not.toHaveBeenCalled();
  });

  it("closes on Escape and on a click outside", async () => {
    renderBox();
    await userEvent.click(screen.getByRole("button", { name: "Экспорт" }));
    await screen.findByRole("menu", { name: "Экспорт" });
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("menu", { name: "Экспорт" })).toBeNull());

    await userEvent.click(screen.getByRole("button", { name: "Экспорт" }));
    await screen.findByRole("menu", { name: "Экспорт" });
    await userEvent.click(document.body);
    await waitFor(() => expect(screen.queryByRole("menu", { name: "Экспорт" })).toBeNull());
  });

  it("shows progress and cannot be pressed twice while an export runs", async () => {
    const { onExportMarkdown } = renderBox({ exportBusy: "markdown" });
    const trigger = screen.getByRole("button", { name: "Экспорт" }) as HTMLButtonElement;
    expect(trigger.disabled).toBe(true);
    await userEvent.click(trigger, { pointerEventsCheck: 0 });
    expect(onExportMarkdown).not.toHaveBeenCalled();
  });
});
