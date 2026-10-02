import Terminal from "@/pages/Terminal";

/**
 * The terminal surface: the shipped terminal, plus the mode carousel above it.
 *
 * <p>This wraps the existing <Terminal> from `5371af9` rather than reimplementing it: the same
 * component, the same `terminal-client.ts` calls, and the same loopback routes under
 * `/api/local/terminal`. Nothing here talks to `TerminalRuntime`, proot or Alpine directly, and the
 * native side is untouched.
 *
 * <p>The carousel is passed in rather than rendered here. The chat surface renders the same element
 * in the same position, and only one of the two surfaces is ever mounted, so the control appears to
 * stay put as the modes page rather than jumping between two different switchers.
 */

export default function TerminalSurface({ modeRow }: { modeRow: React.ReactNode }) {
  return (
    <div className="kairema-terminal-surface" data-testid="terminal-surface">
      <div className="kairema-terminal-mode-row">{modeRow}</div>
      <Terminal />
    </div>
  );
}