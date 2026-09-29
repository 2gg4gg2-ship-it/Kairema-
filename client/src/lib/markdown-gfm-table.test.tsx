/* @vitest-environment jsdom */
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { InlineMarkdown } from "./markdown";
import { chatWithUserProviderStream } from "../../../server/user-providers";

const MODEL = "vendor/model-t";
const KEY = "sk-or-v1-table-secret-2222";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/**
 * A GFM table as a provider actually sends it: the header, the delimiter row that makes it a table
 * at all, and body rows that carry the data.
 */
const WIDE_TABLE = [
  "| Модель | Провайдер | Контекст | Скорость | Цена за 1M токенов |",
  "| --- | --- | --- | --- | --- |",
  "| Alpha | OpenRouter | 128 000 | 92 tok/s | $3.00 |",
  "| Beta | Together | 32 768 | 140 tok/s | $0.55 |",
  "| Gamma | Cerebras | 131 072 | 310 tok/s | $0.90 |",
].join("\n");

describe("a GFM table in an answer", () => {
  it("renders a real table element with a header row and body cells", () => {
    render(<InlineMarkdown text={WIDE_TABLE} />);
    const table = screen.getByRole("table");
    expect(within(table).getByRole("columnheader", { name: /Модель/ })).toBeTruthy();
    expect(within(table).getAllByRole("row")).toHaveLength(4);
    expect(within(table).getByText("Gamma")).toBeTruthy();
  });

  it("does not leak the parser's node object into the DOM", () => {
    const { container } = render(<InlineMarkdown text={WIDE_TABLE} />);
    const table = container.querySelector("table")!;
    // React would have serialised the hast element as "[object Object]" on the attribute.
    expect(table.getAttribute("node")).toBeNull();
    expect(container.innerHTML).not.toContain("[object Object]");
    expect(table.outerHTML).not.toContain("node=");
  });

  it("keeps real table attributes and reaches no foreign ones", () => {
    const { container } = render(<InlineMarkdown text={WIDE_TABLE} />);
    const table = container.querySelector("table")!;
    // The accessible name is this component's own, not a parser artefact.
    expect(table.closest(".kairema-table-scroll")).toBeTruthy();
    for (const attribute of Array.from(table.attributes)) {
      expect(attribute.name).not.toBe("node");
      expect(attribute.value).not.toContain("[object");
    }
  });

  it("wraps a wide table in a horizontally scrollable region", () => {
    render(<InlineMarkdown text={WIDE_TABLE} />);
    const region = screen.getByRole("region", { name: "Таблица в ответе" });
    const table = within(region).getByRole("table");
    // The table keeps its own full width; the wrapper is what scrolls, so a narrow screen shows
    // the columns side by side instead of clipping them.
    expect(table).toBeTruthy();
    expect(region.className).toContain("kairema-table-scroll");
  });

  it("announces the table for a screen reader", () => {
    render(<InlineMarkdown text={WIDE_TABLE} />);
    expect(screen.getByRole("status").textContent).toContain("есть таблица");
  });

  it("renders markdown that arrives before and after the table", () => {
    render(<InlineMarkdown text={`Сравнение:\n\n${WIDE_TABLE}\n\nИтог: вторая дешевле.`} />);
    expect(screen.getByText(/Сравнение/)).toBeTruthy();
    expect(screen.getByText(/вторая дешевле/)).toBeTruthy();
    expect(screen.getByRole("table")).toBeTruthy();
  });

  it("keeps the table readable after the answer is re-sorted", async () => {
    const { container } = render(<InlineMarkdown text={WIDE_TABLE} />);
    const desc = screen.getByRole("button", { name: "Я–А" });
    desc.click();
    await Promise.resolve();
    const firstCell = container.querySelector("tbody tr td")!.textContent;
    expect(firstCell).toBe("Gamma");
  });
});

describe("a table delivered by a user provider", () => {
  const askWithBody = async (chunks: string[], whole?: string) => {
    const deltas: string[] = [];
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
        controller.close();
      },
    });
    const response = whole === undefined
      ? { ok: true, status: 200, body, headers: new Headers({ "content-type": "text/event-stream" }) }
      : { ok: true, status: 200, body: null, headers: new Headers({ "content-type": "application/json" }), text: async () => whole };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response as unknown as Response));
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    const result = await chatWithUserProviderStream({
      provider: "openrouter", model: MODEL, modelLabel: "Модель", apiKey: KEY,
      history: [{ role: "user", content: "Покажи таблицу" }], roleId: "fast",
      onDelta: (delta) => deltas.push(delta),
    });
    return { content: result.content, deltas: deltas.join("") };
  };

  const frame = (text: string) => `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`;

  it("renders a table that arrived as a streamed answer", async () => {
    const { content } = await askWithBody([frame("| A | B |\n| --- | --- |\n"), frame("| 1 | 2 |"), "data: [DONE]\n\n"]);
    render(<InlineMarkdown text={content} />);
    expect(screen.getByRole("table")).toBeTruthy();
    expect(screen.getByText("1")).toBeTruthy();
  });

  it("survives a chunk boundary that falls in the middle of a row", async () => {
    // The delimiter row is what makes the block a table; a split across it is the case that used
    // to render as plain text.
    const whole = WIDE_TABLE;
    const half = Math.floor(whole.length / 2);
    const { content, deltas } = await askWithBody([frame(whole.slice(0, half)), frame(whole.slice(half)), "data: [DONE]\n\n"]);
    expect(deltas).toBe(whole);
    render(<InlineMarkdown text={content} />);
    expect(within(screen.getByRole("table")).getAllByRole("row")).toHaveLength(4);
  });

  it("renders a table that arrived as array content parts", async () => {
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: [{ type: "text", text: WIDE_TABLE }] } }] })}\n\n`));
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      },
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, body, headers: new Headers({ "content-type": "text/event-stream" }) } as unknown as Response));
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    const result = await chatWithUserProviderStream({
      provider: "openrouter", model: MODEL, modelLabel: "Модель", apiKey: KEY,
      history: [{ role: "user", content: "Покажи таблицу" }], roleId: "fast", onDelta: () => undefined,
    });
    render(<InlineMarkdown text={result.content} />);
    expect(screen.getByRole("table")).toBeTruthy();
  });

  it("renders a table that arrived as a non-stream JSON answer", async () => {
    const { content } = await askWithBody([], JSON.stringify({ choices: [{ message: { content: WIDE_TABLE } }] }));
    render(<InlineMarkdown text={content} />);
    expect(within(screen.getByRole("table")).getAllByRole("row")).toHaveLength(4);
  });

  it("renders a table that is still being streamed without losing the rows received so far", async () => {
    const { deltas } = await askWithBody([frame("| A | B |\n| --- | --- |\n"), frame("| 1 | 2 |\n| 3 | 4 |")]);
    render(<InlineMarkdown text={deltas} />);
    const table = screen.getByRole("table");
    expect(within(table).getAllByRole("row").length).toBeGreaterThanOrEqual(2);
  });
});
