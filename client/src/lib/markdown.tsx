import { Fragment, type ReactNode } from "react";

/**
 * Lightweight Markdown rendering for AI messages. It deliberately renders text
 * as React nodes, never through raw HTML, so model output cannot inject markup.
 */
export function InlineMarkdown({ text }: { text: string }) {
  const pieces = text.split(/(`[^`\n]+`|\*\*[^*\n]+\*\*)/g);
  const nodes: ReactNode[] = [];

  pieces.forEach((piece, index) => {
    if (!piece) return;
    if (piece.startsWith("`") && piece.endsWith("`")) {
      nodes.push(<code key={index} className="rounded bg-slate-950/80 px-1.5 py-0.5 font-mono text-[0.86em] text-violet-200">{piece.slice(1, -1)}</code>);
      return;
    }
    if (piece.startsWith("**") && piece.endsWith("**")) {
      nodes.push(<strong key={index} className="font-semibold text-slate-100">{piece.slice(2, -2)}</strong>);
      return;
    }
    nodes.push(<Fragment key={index}>{piece}</Fragment>);
  });

  return <>{nodes}</>;
}
