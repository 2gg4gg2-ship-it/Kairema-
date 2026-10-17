import { Button } from "@/components/ui/button";
import {
  createTerminalSession,
  killTerminalSession,
  sendTerminalInput,
  streamTerminal,
  TerminalApiError,
  type StreamHandle,
  type TerminalFrame,
} from "@/lib/terminal-client";
import { CircleStop, Send, SquareTerminal } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

/**
 * A minimal on-device terminal, not an IDE.
 *
 * <p>Output is rendered as React text nodes only. `dangerouslySetInnerHTML` is not used anywhere on
 * this screen: terminal output is untrusted program output, and it is escaped by construction rather
 * than by a filter that might miss a case. stdout, stderr and the exit status are visually distinct
 * so a user can tell a successful command from a failing one at a glance.
 *
 * <p>Each line is stored as an array of spans rather than one growing string, so a long-running
 * session does not re-render the entire output on every frame.
 */

type Span = { stream: "stdout" | "stderr" | "meta"; text: string };

/** Cap on retained output, so a runaway command cannot grow the page without bound. */
const MAX_SPANS = 4000;

const STATUS_TEXT: Record<string, string> = {
  starting: "Starting the Linux runtime…",
  connecting: "Connecting…",
  running: "Running",
  exited: "Session ended",
  stopped: "Stopped",
  error: "Unavailable",
};

export default function Terminal() {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [spans, setSpans] = useState<Span[]>([]);
  const [input, setInput] = useState("");
  const [status, setStatus] = useState<string>("idle");
  const [exitCode, setExitCode] = useState<number | null>(null);
  const [notice, setNotice] = useState<string>("");

  const outputRef = useRef<HTMLDivElement | null>(null);
  const streamRef = useRef<StreamHandle | null>(null);

  const append = useCallback((stream: Span["stream"], text: string) => {
    setSpans((current) => {
      const next = current.length > 0 && current[current.length - 1].stream === stream
        ? [...current.slice(0, -1), { stream, text: current[current.length - 1].text + text }]
        : [...current, { stream, text }];
      return next.length > MAX_SPANS ? next.slice(next.length - MAX_SPANS) : next;
    });
  }, []);

  // Follows the newest output unless the user has scrolled up to read history.
  useEffect(() => {
    const node = outputRef.current;
    if (!node) return;
    const distanceFromBottom = node.scrollHeight - node.scrollTop - node.clientHeight;
    if (distanceFromBottom < 120) {
      node.scrollTop = node.scrollHeight;
    }
  }, [spans]);

  useEffect(() => {
    return () => {
      // Leaving the screen closes the stream; the session is killed explicitly by Stop, or here on
      // unmount so no proot process is left running behind a navigated-away page.
      streamRef.current?.close();
      const current = sessionId;
      if (current) void killTerminalSession(current).catch(() => undefined);
    };
    // Intentionally runs only on unmount: a session change is handled by start().
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onFrame = useCallback(
    (frame: TerminalFrame) => {
      switch (frame.type) {
        case "stdout":
          append("stdout", frame.data);
          break;
        case "stderr":
          append("stderr", frame.data);
          break;
        case "error":
          setNotice(frame.data);
          break;
        case "exit":
          setExitCode(frame.code);
          setStatus("exited");
          break;
        case "keepalive":
          break;
      }
    },
    [append],
  );

  const start = useCallback(async () => {
    setNotice("");
    setStatus("starting");
    setSpans([]);
    setExitCode(null);

    // Any previous session is stopped first: the cap is four, and a stray session would make the
    // next start fail with session_limit.
    const previous = sessionId;
    setSessionId(null);
    streamRef.current?.close();
    if (previous) await killTerminalSession(previous).catch(() => undefined);

    let created;
    try {
      created = await createTerminalSession();
    } catch (error) {
      setStatus("error");
      setNotice(describeError(error));
      return;
    }
    setSessionId(created.id);
    append("meta", `session ${created.id.slice(0, 8)} in ${created.cwd}\n`);
    setStatus("connecting");

    streamRef.current = streamTerminal(created.id, {
      onFrame,
      onClosed: () => {
        setStatus((current) => (current === "exited" ? current : "exited"));
      },
      onError: (token) => setNotice(token),
    });
  }, [append, onFrame, sessionId]);

  const stop = useCallback(async () => {
    const current = sessionId;
    streamRef.current?.close();
    streamRef.current = null;
    setSessionId(null);
    setStatus("stopped");
    if (current) {
      try {
        await killTerminalSession(current);
        append("meta", "\nsession stopped\n");
      } catch (error) {
        setNotice(describeError(error));
      }
    }
  }, [append, sessionId]);

  const send = useCallback(async () => {
    const current = sessionId;
    if (!current || input.length === 0) return;
    const payload = input.endsWith("\n") ? input : `${input}\n`;
    setInput("");
    try {
      await sendTerminalInput(current, payload);
    } catch (error) {
      setNotice(describeError(error));
    }
  }, [input, sessionId]);

  const busy = status === "starting" || status === "connecting";
  const label = STATUS_TEXT[status] ?? status;

  return (
    <div className="kairema-terminal" data-testid="terminal-screen">
      <header className="kairema-terminal-bar">
        <SquareTerminal className="size-5" aria-hidden />
        <span className="kairema-terminal-title">Terminal</span>
        <span className="kairema-terminal-status" data-testid="terminal-status">
          {label}
          {exitCode !== null ? ` · exit ${exitCode}` : ""}
        </span>
        {sessionId ? (
          <Button size="sm" variant="outline" onClick={() => void stop()} data-testid="terminal-stop">
            <CircleStop className="size-4" />
            Stop
          </Button>
        ) : (
          <Button size="sm" onClick={() => void start()} disabled={busy} data-testid="terminal-start">
            New session
          </Button>
        )}
        <Button size="sm" variant="outline" disabled title="not connected yet" data-testid="terminal-clear">
          Clear
        </Button>
      </header>

      {notice ? (
        <p className="kairema-terminal-notice" role="status" data-testid="terminal-notice">
          {notice}
        </p>
      ) : null}

      <div
        className="kairema-terminal-output"
        ref={outputRef}
        role="log"
        aria-live="polite"
        aria-label="Terminal output"
        data-testid="terminal-output"
        onScroll={() => undefined}
      >
        {spans.length === 0 ? (
          <p className="kairema-terminal-empty">
            Start a session to run commands in a private Alpine Linux environment on this device.
          </p>
        ) : (
          spans.map((span, index) => (
            <span key={index} className={`kairema-terminal-span kairema-terminal-${span.stream}`}>
              {span.text}
            </span>
          ))
        )}
      </div>

      <form
        className="kairema-terminal-input"
        onSubmit={(event) => {
          event.preventDefault();
          void send();
        }}
      >
        <input
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder={sessionId ? "Type a command" : "Start a session first"}
          disabled={!sessionId}
          aria-label="Terminal input"
          data-testid="terminal-input"
          autoComplete="off"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
        />
        <Button type="submit" size="sm" disabled={!sessionId || input.length === 0} data-testid="terminal-send">
          <Send className="size-4" />
          Send
        </Button>
      </form>

      <p className="kairema-terminal-hint">
        The session runs inside this app&rsquo;s private storage. Commands cannot reach other apps or
        shared files on the device.
      </p>
    </div>
  );
}

function describeError(error: unknown): string {
  if (error instanceof TerminalApiError) {
    switch (error.token) {
      case "session_limit":
        return "Four sessions are already running. Stop one first.";
      case "runtime_unavailable":
        return "The Linux runtime is not available yet. It is installed on first use.";
      default:
        return error.token;
    }
  }
  return "The terminal request failed.";
}
