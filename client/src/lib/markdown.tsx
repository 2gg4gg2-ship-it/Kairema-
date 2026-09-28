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
 * Safely renders streamed model output as GFM Markdown. Raw HTML is skipped,
 * so model output is never interpreted as executable or trusted markup.
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
        table: ({ children, ...props }: GfmTableProps) => <InteractiveGfmTable language={language} {...props}>{children}</InteractiveGfmTable>,
      }}
    >
      {text}
    </Streamdown>
  </>;
}
