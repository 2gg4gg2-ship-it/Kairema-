import { Streamdown } from "streamdown";

type Language = "ru" | "en";

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
        table: ({ children, ...props }) => <div className="kairema-table-scroll" role="region" aria-label={tableLabel} tabIndex={0}><table {...props}><caption className="sr-only">{tableLabel}</caption>{children}</table></div>,
      }}
    >
      {text}
    </Streamdown>
  </>;
}
