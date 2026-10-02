import { MessageSquare, SquareTerminal } from "lucide-react";
import Terminal from "@/pages/Terminal";

/**
 * The terminal as a switchable surface of the chat page.
 *
 * <p>This wraps the existing <Terminal> from `5371af9` rather than reimplementing it: the same
 * component, the same `terminal-client.ts` calls, and the same loopback routes under
 * `/api/local/terminal`. Nothing here talks to `TerminalRuntime`, proot or Alpine directly, and the
 * native side is untouched.
 *
 * <p>The header carries the other half of the Chat/Terminal switch, because the forward segment lives
 * in the chat's own mode bar (next to «Чат») and is unmounted together with it. That keeps exactly one
 * control per surface instead of two competing ones, and means returning to the chat is one tap from
 * wherever the user is.
 *
 * <p>Going back to Chat is a state change inside this page: no navigation, no reload, and the chat's
 * scrollback and draft are exactly as they were left.
 */

export interface TerminalSurfaceLabels {
  chat: string;
  terminal: string;
  surface: string;
}

export default function TerminalSurface({
  labels,
  onBackToChat,
}: {
  labels: TerminalSurfaceLabels;
  onBackToChat: () => void;
}) {
  return (
    <div className="kairema-terminal-surface" data-testid="terminal-surface">
      <div className="kairema-mode-switch kairema-mode-switch-surface" role="group" aria-label={labels.surface}>
        <button
          type="button"
          className="kairema-mode-option"
          aria-pressed={false}
          data-testid="terminal-surface-chat"
          onClick={onBackToChat}
        >
          <MessageSquare className="size-4" />
          <span>{labels.chat}</span>
        </button>
        <button
          type="button"
          className="kairema-mode-option"
          aria-pressed
          data-testid="terminal-surface-terminal"
        >
          <SquareTerminal className="size-4" />
          <span>{labels.terminal}</span>
        </button>
      </div>

      {/*
        Mounted only while the terminal surface is selected, so entering Chat tears the shell down and
        releases its session, matching what leaving the /terminal route already did. The user starts a
        fresh session with «New session»; output is never carried across surfaces.
      */}
      <Terminal />
    </div>
  );
}
