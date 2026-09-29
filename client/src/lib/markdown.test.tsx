/* @vitest-environment jsdom */
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { InlineMarkdown } from "./markdown";

afterEach(cleanup);

function renderMarkdown(text: string, language: "ru" | "en" = "ru") {
  const { container } = render(<InlineMarkdown text={text} language={language} />);
  return container;
}

const css = readFileSync(path.resolve(import.meta.dirname, "..", "index.css"), "utf8");

describe("InlineMarkdown — structure", () => {
  it("renders a full heading hierarchy and keeps every level distinct", () => {
    const container = renderMarkdown("# One\n\n## Two\n\n### Three\n\n#### Four");
    const levels = ["h1", "h2", "h3", "h4"].map((tag) => container.querySelector(tag)?.textContent);

    expect(levels).toEqual(["One", "Two", "Three", "Four"]);
  });

  it("renders bold, italic, bold-italic and strikethrough", () => {
    const container = renderMarkdown("**bold** *italic* ***both*** ~~gone~~");
    const body = container.querySelector(".kairema-gfm")?.textContent ?? "";

    expect(body).toContain("bold");
    expect(container.querySelector("em")).not.toBeNull();
    expect(container.querySelector("del")?.textContent).toBe("gone");
    // Streamdown emits `strong` as a span, not a <strong> element; both must be found.
    expect(container.querySelector("[data-streamdown='strong']")).not.toBeNull();
  });

  it("renders paragraphs, lists, nested lists and blockquotes", () => {
    const container = renderMarkdown("- one\n  - nested\n\n1. first\n\n> quoted");

    expect(container.querySelectorAll("ul")).toHaveLength(2);
    expect(container.querySelector("ol")).not.toBeNull();
    expect(container.querySelector("blockquote")?.textContent).toContain("quoted");
  });

  it("renders task list items as real checkboxes", () => {
    const container = renderMarkdown("- [ ] open\n- [x] done");
    const boxes = container.querySelectorAll<HTMLInputElement>("input[type='checkbox']");

    expect(boxes).toHaveLength(2);
    expect(boxes[0]?.checked).toBe(false);
    expect(boxes[1]?.checked).toBe(true);
    // Answers are display-only, so the control must not be an active form control.
    expect(boxes[0]?.disabled).toBe(true);
    expect(container.querySelectorAll(".task-list-item")).toHaveLength(2);
  });

  it("renders a horizontal rule and a safe external link", () => {
    const container = renderMarkdown("---");
    expect(container.querySelector("hr")).not.toBeNull();
  });

  it("marks links as external and safe", () => {
    const container = renderMarkdown("[docs](https://example.com)");

    const link = container.querySelector("a");
    expect(link?.getAttribute("href")).toContain("example.com");
    expect(link?.getAttribute("target")).toBe("_blank");
    expect(link?.getAttribute("rel")).toContain("noopener");
  });

  it("keeps the language fence label on a fenced code block", () => {
    const container = renderMarkdown("```ts\nconst answer = true;\n```");
    const header = container.querySelector("[data-code-block-header='true']");

    expect(container.querySelector("[data-code-block-container='true']")).not.toBeNull();
    expect(header?.getAttribute("data-language")).toBe("ts");
  });
});

describe("InlineMarkdown — tables", () => {
  const table = [
    "| Модель | Цена | Скорость |",
    "|---|---:|---:|",
    "| Model A | Free | Fast |",
    "| Model B | $1 | Medium |",
  ].join("\n");

  it("keeps per-column GFM alignment instead of flattening it", () => {
    const container = renderMarkdown(table);
    const headers = container.querySelectorAll("th");

    expect(headers).toHaveLength(3);
    // Left is the default and is not given an inline style; right-aligned columns are.
    expect(headers[0]?.style.textAlign).toBe("");
    expect(headers[1]?.style.textAlign).toBe("right");
    expect(headers[2]?.style.textAlign).toBe("right");
  });

  it("centres a column declared with :---:", () => {
    const container = renderMarkdown("| A | B |\n|:-:|--:|\n| 1 | 2 |");

    expect(container.querySelector("th")?.style.textAlign).toBe("center");
  });

  it("wraps every table in a horizontally scrollable, focusable region", () => {
    const container = renderMarkdown(table);
    const scroller = container.querySelector(".kairema-table-scroll") as HTMLElement | null;

    expect(scroller).not.toBeNull();
    expect(scroller?.getAttribute("role")).toBe("region");
    // Keyboard reachability is what lets a keyboard user scroll the table.
    expect(scroller?.getAttribute("tabindex")).toBe("0");
  });

  it("announces the table to assistive tech", () => {
    const container = renderMarkdown(table);

    expect(container.querySelector("[role='status']")?.textContent).toContain("таблица");
    expect(container.querySelector("caption")?.textContent).toBe("Таблица в ответе");
  });

  it("renders long cell content intact rather than truncating it", () => {
    const long = "Очень длинное описание модели, которое не должно обрезаться при отрисовке таблицы";
    const container = renderMarkdown(`| A |\n|---|\n| ${long} |`);

    expect(container.querySelector("td")?.textContent).toBe(long);
  });

  it("renders several tables independently", () => {
    const container = renderMarkdown(`${table}\n\n${table}`);

    expect(container.querySelectorAll("table")).toHaveLength(2);
    expect(container.querySelector("[role='status']")?.textContent).toContain("таблицы: 2");
  });

  it("does not mistake an ordinary pipe-heavy line for a table", () => {
    const container = renderMarkdown("a | b");

    expect(container.querySelector("table")).toBeNull();
    expect(container.querySelector("[role='status']")).toBeNull();
  });

  it("sorts and restores rows without losing the original order", () => {
    const container = renderMarkdown("| Name |\n|---|\n| Яблоко |\n| Арбуз |\n| Груша |");
    const firstColumn = () =>
      Array.from(container.querySelectorAll<HTMLTableRowElement>("tbody tr")).map((row) => row.cells[0]?.textContent);

    expect(firstColumn()).toEqual(["Яблоко", "Арбуз", "Груша"]);

    const [asc, desc, reset] = Array.from(container.querySelectorAll(".kairema-table-sort")) as HTMLButtonElement[];
    fireEvent.click(asc!);
    expect(firstColumn()).toEqual(["Арбуз", "Груша", "Яблоко"]);

    fireEvent.click(desc!);
    expect(firstColumn()).toEqual(["Яблоко", "Груша", "Арбуз"]);

    fireEvent.click(reset!);
    expect(firstColumn()).toEqual(["Яблоко", "Арбуз", "Груша"]);
  });

  it("reflects the active sort in aria-pressed", () => {
    const container = renderMarkdown("| Name |\n|---|\n| A |\n| B |");
    const [asc, , reset] = Array.from(container.querySelectorAll(".kairema-table-sort")) as HTMLButtonElement[];

    expect(reset!.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(asc!);
    expect(asc!.getAttribute("aria-pressed")).toBe("true");
    expect(reset!.getAttribute("aria-pressed")).toBe("false");
  });
});

describe("InlineMarkdown — streaming and safety", () => {
  it("renders a fully-streamed answer identically to the final text", () => {
    const final = "## Итог\n\n- пункт один\n- пункт два\n\n**Готово**";
    const streamed = "## Итог\n\n- пункт оди";

    // A streamed prefix must not throw and must not lose the structure it already has.
    const partial = renderMarkdown(streamed);
    expect(partial.querySelector("h2")?.textContent).toBe("Итог");
    expect(partial.querySelectorAll("li")).toHaveLength(1);

    const complete = renderMarkdown(final);
    expect(complete.querySelector("h2")?.textContent).toBe("Итог");
    expect(complete.querySelectorAll("li")).toHaveLength(2);
  });

  it("preserves whitespace inside code fences verbatim", async () => {
    const code = "line one\n  indented\n\nline two";
    const container = renderMarkdown("```\n" + code + "\n```");
    // Shiki resolves the highlight asynchronously, so the body is empty on first paint.
    await waitFor(() => {
      expect(container.querySelector("[data-code-block-container='true']")?.textContent).toContain("  indented");
    });
    expect(container.querySelector("[data-code-block-container='true']")?.textContent).toContain("line two");
  });

  it("fills both Shiki theme bodies, so CSS must show exactly one", async () => {
    const container = renderMarkdown("```ts\nconst a = 1;\n```");
    await waitFor(() => {
      expect(container.querySelectorAll("[data-code-block='true'] pre").length).toBe(2);
    });

    // Streamdown renders the code twice — once for the light Shiki theme and once for the dark —
    // and hides the inactive one with `dark:hidden` / `hidden dark:block`. Those utilities are not
    // generated, so without the explicit `:nth-of-type` rules in index.css an answer would show
    // its code block twice, stacked.
    const bodies = Array.from(container.querySelectorAll("[data-code-block='true']"));
    expect(bodies).toHaveLength(2);
    expect(css).toMatch(/\[data-code-block="true"\]:nth-of-type\(2\)\s*\{\s*display:none/);
  });

  it("strips event handler attributes from model output", () => {
    const container = renderMarkdown('<img src="x" onerror="alert(1)">');
    const image = container.querySelector("img");

    expect(image).not.toBeNull();
    expect(image?.getAttribute("onerror")).toBeFalsy();
  });

  // NOTE: raw `<script>` in model output is NOT neutralised. Streamdown runs `rehype-raw`, which
  // parses raw HTML into real nodes and therefore defeats the `skipHtml` prop the component passes;
  // `rehype-harden` does not remove script elements. This is pre-existing and is called out in
  // markdown.tsx rather than asserted here, so the gap stays visible instead of being locked in by
  // a passing test. See the note above InteractiveGfmTable.
  it("neutralises a javascript: link", () => {
    const container = renderMarkdown("[click](javascript:alert(1))");
    const href = container.querySelector("a")?.getAttribute("href") ?? "";

    expect(href).not.toContain("javascript:");
  });
});

describe("markdown styling invariants", () => {
  // Streamdown ships styling as Tailwind class names and no stylesheet. Tailwind v4 only generates
  // utilities for classes it finds in scanned source, and this project has no `@source` covering
  // node_modules — so the built CSS must not be expected to contain any of them. These assertions
  // fail loudly if someone later adds a `@source` and believes the utility classes are styling the
  // output, because then the tokens below and the utilities would both be fighting over the same
  // elements.
  it("does not rely on Streamdown's ungenerated Tailwind utilities", () => {
    expect(css).not.toMatch(/@source[^;]*streamdown/);
  });

  it("defines the UI and code font stacks without a dead family name", () => {
    expect(css).toMatch(/--k-font-sans:/);
    expect(css).toMatch(/--k-font-mono:/);
    // `Inter` was listed first but never loaded (no @font-face, no CDN), so it always fell through.
    expect(css).not.toMatch(/font-family:\s*Inter/);
  });

  it("sizes all four heading levels", () => {
    for (const level of ["h1", "h2", "h3", "h4"]) {
      expect(css).toMatch(new RegExp(`\\.kairema-gfm ${level}\\s*\\{`));
    }
  });

  it("scopes markdown typography rules to the renderer container", () => {
    // A selector list that *begins* with a bare `h1 {}` would restyle headings across the whole
    // app. Matching only at the start of a selector avoids flagging `.kairema-welcome h1 {}`,
    // which is legitimately scoped to the welcome screen.
    expect(css).not.toMatch(/(^|[},])\s*h1\s*\{/);
    expect(css).toMatch(/\.kairema-gfm h1\s*\{/);
  });

  it("colours tables with theme tokens instead of hardcoded dark literals", () => {
    const tableRules = css.slice(css.indexOf(".kairema-table-scroll thead th"));
    const headerRule = tableRules.slice(0, tableRules.indexOf("}"));

    expect(headerRule).toMatch(/var\(--k-panel-2\)/);
    expect(headerRule).not.toMatch(/#[0-9a-f]{3,6}/i);
  });

  it("keeps the table scroller as the containment mechanism", () => {
    const rule = css.slice(css.indexOf(".kairema-table-scroll {"));
    const scrollRule = rule.slice(0, rule.indexOf("}"));

    expect(scrollRule).toMatch(/overflow-x:auto/);
    expect(scrollRule).toMatch(/max-width:100%/);
    expect(css).toMatch(/table\s*\{[^}]*width:max-content/);
  });

  it("never hides horizontal overflow on the page", () => {
    // Clipping the page would mask the symptom and also clip the table scroller.
    expect(css).not.toMatch(/body[^{]*\{[^}]*overflow-x\s*:\s*hidden/);
  });

  it("does not force cell alignment, which would override GFM column alignment", () => {
    const scroller = css.slice(css.indexOf(".kairema-table-scroll th,"));
    const cellRule = scroller.slice(0, scroller.indexOf("}"));

    expect(cellRule).not.toMatch(/text-align/);
  });
});
