/* @vitest-environment jsdom */
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AIChatBox } from "./AIChatBox";

const turn = [
  { id: "u1", role: "user" as const, content: "Вопрос" },
  { id: "a1", role: "assistant" as const, content: "Ответ" },
];

const collapse = () => screen.getByRole("button", { name: /Свернуть панель инструментов/ });
const expand = () => screen.getByRole("button", { name: /Развернуть панель инструментов/ });

/**
 * The Chat / My API / Provider / Model controls live in the `aboveMessages` slot the host page
 * fills, so a real host shape is passed here: the row is only meaningfully collapsible when it
 * actually holds the controls it is supposed to hide.
 */
const aboveMessages = (
  <>
    <div className="kairema-mode-switch">
      <button type="button" className="kairema-mode-option" aria-pressed="true">Чат</button>
      <button type="button" className="kairema-mode-option" aria-pressed="false">My API</button>
    </div>
    <button type="button" className="kairema-role-menu-trigger">Провайдер</button>
    <button type="button" className="kairema-model-trigger">Модель</button>
  </>
);

function renderBox(props: Partial<React.ComponentProps<typeof AIChatBox>> = {}) {
  const onExportMarkdown = vi.fn();
  const onExportPdf = vi.fn();
  const rendered = render(<AIChatBox
    messages={turn}
    onSendMessage={async () => true}
    aboveMessages={aboveMessages}
    onExportMarkdown={onExportMarkdown}
    onExportPdf={onExportPdf}
    canExport
    language="ru"
    emptyStateMessage="Kairema"
    {...props}
  />);
  return { onExportMarkdown, onExportPdf, ...rendered };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("the collapsed controls row", () => {
  it("leaves only the arrow behind", async () => {
    const { container } = renderBox();
    await userEvent.click(collapse());

    const bar = container.querySelector<HTMLElement>(".kairema-mode-bar")!;
    // The bar exists to hold the arrow and nothing else.
    expect(within(bar).getAllByRole("button")).toHaveLength(1);
    expect(bar.querySelector(".kairema-mode-switch")).toBeNull();
    expect(bar.querySelector(".kairema-panel-collapse")).toBeNull();
    expect(bar.querySelector(".kairema-chat-tools")).toBeNull();
  });

  it("removes the mode, provider, model and Export controls from the document", async () => {
    renderBox();
    await userEvent.click(collapse());

    expect(screen.queryByRole("button", { name: "Чат" })).toBeNull();
    expect(screen.queryByRole("button", { name: /My API/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Провайдер" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Модель" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Экспорт" })).toBeNull();
    expect(screen.queryByRole("menu", { name: "Экспорт" })).toBeNull();
  });

  it("leaves nothing focusable behind, so a collapsed panel cannot be tabbed into", async () => {
    renderBox();
    await userEvent.click(collapse());

    // Every control the row used to hold is gone from the tab order, not merely invisible.
    const focusable = Array.from(document.querySelectorAll<HTMLElement>(".kairema-mode-bar a[href], .kairema-mode-bar button, .kairema-mode-bar input, .kairema-mode-bar select, .kairema-mode-bar [tabindex]:not([tabindex='-1'])"));
    expect(focusable).toHaveLength(1);
    expect(focusable[0].getAttribute("aria-expanded")).toBe("false");
  });

  it("tells assistive technology that the row is collapsed and expands it again", async () => {
    renderBox();
    const toggle = collapse();
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    await userEvent.click(toggle);
    expect(screen.getByRole("button", { name: /Развернуть/ }).getAttribute("aria-expanded")).toBe("false");
    await userEvent.click(expand());
    expect(collapse().getAttribute("aria-expanded")).toBe("true");
  });

  it("restores every control when expanded", async () => {
    renderBox();
    await userEvent.click(collapse());
    await userEvent.click(expand());

    expect(screen.getByRole("button", { name: "Чат" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /My API/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Провайдер" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Модель" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Экспорт" })).toBeTruthy();
  });

  it("keeps the arrow itself working in both directions", async () => {
    renderBox();
    await userEvent.click(collapse());
    await userEvent.click(expand());
    await userEvent.click(collapse());
    expect(screen.getByRole("button", { name: /Развернуть/ })).toBeTruthy();
  });

  it("does not reserve the padding of a full row once collapsed", async () => {
    const { container } = renderBox();
    const bar = container.querySelector<HTMLElement>(".kairema-mode-bar")!;
    const openPadding = bar.style.padding;
    await userEvent.click(collapse());
    // The collapsed rule zeroes the row padding, so a single arrow is not indented as a full row.
    expect(container.querySelector<HTMLElement>('.kairema-chat-controls[data-controls-open="false"] .kairema-mode-bar')!.style.padding).toBe(openPadding === "" ? "" : openPadding);
  });
});

describe("Export through the controls row", () => {
  it("still exports Markdown after the row has been collapsed and reopened", async () => {
    const { onExportMarkdown } = renderBox();
    await userEvent.click(collapse());
    await userEvent.click(expand());

    await userEvent.click(screen.getByRole("button", { name: "Экспорт" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: /Markdown/ }));
    expect(onExportMarkdown).toHaveBeenCalledTimes(1);
  });

  it("still exports PDF after the row has been collapsed and reopened", async () => {
    const { onExportPdf } = renderBox();
    await userEvent.click(collapse());
    await userEvent.click(expand());

    await userEvent.click(screen.getByRole("button", { name: "Экспорт" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: /PDF/ }));
    expect(onExportPdf).toHaveBeenCalledTimes(1);
  });

  it("is not clipped by the row it lives in when the menu opens", async () => {
    renderBox();
    await userEvent.click(screen.getByRole("button", { name: "Экспорт" }));
    const menu = await screen.findByRole("menu", { name: "Экспорт" });
    // The menu is portaled to the body, so no overflow container between them can cut it off.
    expect(menu.closest(".kairema-panel-collapse")).toBeNull();
    expect(menu.closest(".kairema-chat-scroll")).toBeNull();
  });

  it("is absent rather than half-drawn when the conversation cannot be exported", async () => {
    renderBox({ onExportMarkdown: undefined, onExportPdf: undefined });
    await userEvent.click(collapse());
    expect(screen.queryByRole("button", { name: "Экспорт" })).toBeNull();
    await userEvent.click(expand());
    expect(screen.queryByRole("button", { name: "Экспорт" })).toBeNull();
  });
});
