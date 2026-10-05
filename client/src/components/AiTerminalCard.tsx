/**
 * The execution card: one compact block per AI-initiated command.
 *
 * <p>Deliberately small. A model running five commands should not push the conversation down the
 * screen, so a step shows its command, its state and one line of output, and keeps the rest behind a
 * disclosure. The full output is already in the model's hands; the card exists so the user can see
 * what ran on their device without having to read it twice.
 *
 * <p>Every value rendered here came from the command itself. There is no secret in this component
 * and nothing is fetched from the network, which is what lets it be plain presentational markup.
 */

import { useState } from "react";
import { ChevronDown, ChevronRight, SquareTerminal } from "lucide-react";
import type { TerminalExecutionStep } from "@/lib/ai-terminal-agent";

const STATUS_LABEL: Record<TerminalExecutionStep["status"], string> = {
  running: "выполняется",
  success: "готово",
  error: "ошибка",
  confirmation: "нужно подтверждение",
};

export default function AiTerminalCard({ steps }: { steps: TerminalExecutionStep[] }) {
  if (steps.length === 0) return null;
  return (
    <div className="kairema-ai-terminal" data-testid="ai-terminal-card">
      <div className="kairema-ai-terminal-head">
        <SquareTerminal className="kairema-ai-terminal-icon" aria-hidden="true" />
        <span className="kairema-ai-terminal-title">Команды на устройстве</span>
        <span className="kairema-ai-terminal-count">{steps.length}</span>
      </div>
      {steps.map((step) => (
        <AiTerminalStep key={step.id} step={step} />
      ))}
    </div>
  );
}

function AiTerminalStep({ step }: { step: TerminalExecutionStep }) {
  const [expanded, setExpanded] = useState(false);
  // Only a step with something beyond the preview is worth a disclosure control.
  const hasMore = Boolean(step.preview) && step.status !== "running";

  return (
    <div className="kairema-ai-terminal-step" data-status={step.status} data-testid="ai-terminal-step">
      <div className="kairema-ai-terminal-row">
        {hasMore ? (
          <button
            type="button"
            className="kairema-ai-terminal-toggle"
            onClick={() => setExpanded((value) => !value)}
            aria-expanded={expanded}
            aria-label={expanded ? "Скрыть вывод" : "Показать вывод"}
          >
            {expanded ? <ChevronDown aria-hidden="true" /> : <ChevronRight aria-hidden="true" />}
          </button>
        ) : (
          <span className="kairema-ai-terminal-toggle-spacer" aria-hidden="true" />
        )}
        <code className="kairema-ai-terminal-command">{step.command}</code>
        <span className="kairema-ai-terminal-status" data-status={step.status}>
          {STATUS_LABEL[step.status]}
          {step.timedOut ? " · таймаут" : ""}
          {step.status === "success" && step.exitCode !== null && step.exitCode !== 0 ? ` · код ${step.exitCode}` : ""}
        </span>
      </div>
      {expanded && step.preview ? (
        <pre className="kairema-ai-terminal-output">{step.preview}</pre>
      ) : null}
    </div>
  );
}