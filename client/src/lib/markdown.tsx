import { Streamdown } from "streamdown";
import { useEffect, useRef, useState } from "react";

type Language = "ru" | "en";

type SortMode = "asc" | "desc" | null;

/**
 * Streamdown hands every component a `node` prop holding the raw hast element. It is a parser
 * detail, not a DOM attribute, so spreading it through reaches the real `<table>` and React renders
 * `node="[object Object]"` into the document. The prop is destructured away here — naming it
 * `_node` keeps it out of the rest object — so only genuine table attributes reach the DOM.
 */
type GfmTableProps = Omit<React.ComponentPropsWithoutRef<"table">, "ref"> & { node?: unknown };

function InteractiveGfmTable({ children, language, node: _parserNode, ...props }: GfmTableProps & { language: Language }) {
  const tableRef = useRef<HTMLTableElement>(null);
  const [sortMode, setSortMode] = useState<SortMode>(null);
  const labels = language === "ru"
    ? { sort: "Сортировка таблицы по первому столбцу", asc: "По возрастанию", desc: "По убыванию", reset: "Сбросить сортировку" }
    : { sort: "Sort table by first column", asc: "Ascending", desc: "Descending", reset: "Reset sorting" };

  useEffect(() => {
    const tbody = tableRef.current?.querySelector("tbody");
    if (!tbody) return;
    const rows = Array.from(tbody.querySelectorAll<HTMLTableRowElement>(":scope > tr"));
    if (rows.length < 2) return;
    rows.forEach((row, index) => { if (row.dataset.kairemaOriginalIndex === undefined) row.dataset.kairemaOriginalIndex = String(index); });
    const collator = new Intl.Collator(language, { numeric: true, sensitivity: "base" });
    const ordered = [...rows].sort((left, right) => {
      if (!sortMode) return Number(left.dataset.kairemaOriginalIndex) - Number(right.dataset.kairemaOriginalIndex);
      const comparison = collator.compare(left.cells[0]?.textContent?.trim() ?? "", right.cells[0]?.textContent?.trim() ?? "");
      return sortMode === "asc" ? comparison : -comparison;
    });
    ordered.forEach((row) => tbody.appendChild(row));
  }, [language, sortMode]);

  return <div className="kairema-table-scroll" role="region" aria-label={language === "ru" ? "Таблица в ответе" : "Table in response"} tabIndex={0}>
    <div className="kairema-table-toolbar" role="toolbar" aria-label={labels.sort}>
      <span className="kairema-table-toolbar-label">{labels.sort}</span>
      <div className="kairema-table-sort-actions">
        <button type="button" className="kairema-table-sort" aria-pressed={sortMode === "asc"} onClick={() => setSortMode("asc")}>{language === "ru" ? "А–Я" : "A–Z"}</button>
        <button type="button" className="kairema-table-sort" aria-pressed={sortMode === "desc"} onClick={() => setSortMode("desc")}>{language === "ru" ? "Я–А" : "Z–A"}</button>
        <button type="button" className="kairema-table-sort" aria-pressed={sortMode === null} onClick={() => setSortMode(null)}>{labels.reset}</button>
      </div>
    </div>
    <table ref={tableRef} {...props}><caption className="sr-only">{language === "ru" ? "Таблица в ответе" : "Table in response"}</caption>{children}</table>
  </div>;
}

/**
 * Tags that must never be produced from model output.
 *
 * The list is about what a tag can *do*, not about how it is spelled: `script` executes, `style`
 * and `link` inject CSS from the network, `meta` can redirect the page, `base` rewrites every
 * relative URL, and `iframe`/`object`/`embed`/`form` frame or phish. `noscript` and `template` are
 * inert but are classic parser-confusion tricks and cost nothing to drop.
 *
 * `svg` is deliberately absent: Streamdown draws its own image-download button with a Lucide
 * `<svg>`, so nulling the tag would remove a working control. An `<svg>` cannot execute anything
 * on its own, and a `<script>` nested inside one is already removed by the `script` entry.
 *
 * `a` is deliberately absent too — links are a supported feature, and their `javascript:` scheme
 * is handled upstream by Streamdown's `rehype-harden` rather than here.
 */
const UNSAFE_RAW_TAGS = ["script", "style", "iframe", "object", "embed", "form", "link", "meta", "base", "noscript", "template"] as const;

/** Renders nothing, so the tag never reaches the document. */
function dropRawHtmlNode() {
  return null;
}

const droppedRawTags = Object.fromEntries(UNSAFE_RAW_TAGS.map((tag) => [tag, dropRawHtmlNode]));

/**
 * Safely renders streamed model output as GFM Markdown.
 *
 * `skipHtml` is passed, but on its own it does not neutralise raw HTML: Streamdown always runs
 * `rehype-raw`, which re-parses raw HTML back into real nodes before `skipHtml` can apply, and
 * `rehype-harden` does not remove `<script>`. `UNSAFE_RAW_TAGS` closes that gap by making those
 * tags render nothing.
 *
 * It is done through `components` rather than `rehypePlugins` on purpose. The `rehypePlugins` prop
 * *replaces* Streamdown's default plugin list (`{harden, raw, katex}`) instead of appending to it —
 * verified against the installed version — and the rehype packages are not resolvable from this
 * project under pnpm's strict layout, so rebuilding that list by hand would mean pinning duplicate
 * copies of `rehype-harden` and `rehype-katex` and re-deriving their options from a minified
 * bundle. Overriding `components` instead is additive: `rehype-harden` keeps blocking `javascript:`
 * URLs and KaTeX keeps rendering, and the only rendering it removes is the unsafe markup itself.
 *
 * Visual styling lives in `.kairema-gfm` in client/src/index.css, not in this component: Streamdown
 * ships its styles as Tailwind class names and exports no stylesheet of its own.
 */
export function InlineMarkdown({ text, language = "ru" }: { text: string; language?: Language }) {
  const tableCount = (text.match(/^\s*\|.+\|\s*\n\s*\|(?:\s*:?-+:?\s*\|)+\s*$/gm) ?? []).length;
  const tableLabel = language === "ru" ? "Таблица в ответе" : "Table in response";
  const tableAnnouncement = language === "ru"
    ? `В ответе ${tableCount === 1 ? "есть таблица" : `есть таблицы: ${tableCount}`}. Прокручивайте таблицу по горизонтали при необходимости.`
    : `${tableCount === 1 ? "A table is" : `${tableCount} tables are`} included in the response. Scroll horizontally if needed.`;

  return <>
    {tableCount > 0 && <span className="sr-only" role="status">{tableAnnouncement}</span>}
    <Streamdown
      className="kairema-gfm"
      controls={false}
      parseIncompleteMarkdown
      skipHtml
      components={{
        ...droppedRawTags,
        table: ({ children, ...props }: GfmTableProps) => <InteractiveGfmTable language={language} {...props}>{children}</InteractiveGfmTable>,
      }}
    >
      {text}
    </Streamdown>
  </>;
}
