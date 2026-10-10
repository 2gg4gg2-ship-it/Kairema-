/**
 * Client for the on-device terminal API.
 *
 * Every request is same-origin and relative: the app is served from the loopback origin
 * (`http://127.0.0.1:<port>`), so the `kairema_loopback` cookie is presented automatically and no
 * credential is ever handled here. The session id in a path is a lookup key, not a token, and is
 * never treated as authorisation.
 *
 * Nothing here interprets a path: the caller can only pass a session id this module obtained from
 * `createTerminalSession`. Android paths cannot reach the native side through this client.
 */

/** One line of the NDJSON stream. */
export type TerminalFrame =
  | { type: "stdout"; data: string }
  | { type: "stderr"; data: string }
  | { type: "exit"; code: number }
  | { type: "keepalive" }
  | { type: "error"; data: string };

export const TERMINAL_BASE = "/api/local/terminal";

/** Maximum single stdin write, matching the native limit. */
export const MAX_INPUT_BYTES = 64 * 1024;

export class TerminalApiError extends Error {
  readonly status: number;
  readonly token: string;

  constructor(status: number, token: string) {
    super(`terminal request failed: ${token}`);
    this.name = "TerminalApiError";
    this.status = status;
    this.token = token;
  }
}

/**
 * Splits a byte stream into NDJSON lines.
 *
 * <p>Kept as a standalone, pure object so the reassembly of a line split across chunk boundaries can
 * be tested directly, which is the part most likely to break: a WebView stream delivers arbitrary
 * byte boundaries, and a JSON line routinely arrives in pieces.
 *
 * <p>A trailing fragment is held until the rest of it arrives, so no frame is ever parsed from half
 * a line and no line is dropped.
 */
export function createNdjsonDecoder(): {
  push: (chunk: string) => string[];
  flush: () => string[];
} {
  let pending = "";
  return {
    push(chunk: string): string[] {
      pending += chunk;
      const lines: string[] = [];
      let newlineAt = pending.indexOf("\n");
      while (newlineAt >= 0) {
        const line = pending.slice(0, newlineAt);
        pending = pending.slice(newlineAt + 1);
        if (line.length > 0) lines.push(line);
        newlineAt = pending.indexOf("\n");
      }
      return lines;
    },
    // Anything still buffered is a final line the server did not terminate. Emitting it here means
    // a truncated stream is reported rather than silently discarded.
    flush(): string[] {
      if (pending.length === 0) return [];
      const line = pending;
      pending = "";
      return [line];
    },
  };
}

function parseFrame(line: string): TerminalFrame | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    // A line that is not JSON is not terminal output and must not be rendered as such.
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const record = parsed as Record<string, unknown>;
  const type = record.type;
  if (type === "keepalive") return { type: "keepalive" };
  if (type === "exit") {
    const code = record.code;
    return { type: "exit", code: typeof code === "number" ? code : -1 };
  }
  if (type === "stdout" || type === "stderr") {
    const data = record.data;
    if (typeof data !== "string") return null;
    return { type, data };
  }
  if (type === "error") {
    return { type: "error", data: typeof record.data === "string" ? record.data : "unknown" };
  }
  return null;
}

async function readErrorToken(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: unknown };
    if (typeof body.error === "string") return body.error;
  } catch {
    // A non-JSON error body carries no token; the status is still reported.
  }
  return "request_failed";
}

async function post(path: string, body?: unknown): Promise<Record<string, string>> {
  const response = await fetch(path, {
    method: "POST",
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    throw new TerminalApiError(response.status, await readErrorToken(response));
  }
  return (await response.json()) as Record<string, string>;
}

export interface CreatedSession {
  id: string;
  cwd: string;
}

/** Creates a terminal session. Throws TerminalApiError with `session_limit` or `runtime_unavailable`. */
export async function createTerminalSession(): Promise<CreatedSession> {
  const body = await post(`${TERMINAL_BASE}/session`);
  const id = body.id;
  if (typeof id !== "string" || !/^[0-9a-f]{32}$/.test(id)) {
    // A session id that is not the expected shape is never used: it would be sent back in a path.
    throw new TerminalApiError(500, "malformed_session_id");
  }
  return { id, cwd: typeof body.cwd === "string" ? body.cwd : "/" };
}

/**
 * Writes to the shell's stdin.
 *
 * <p>The string is sent verbatim, so a trailing "\n" is what submits a line. The native side does
 * not append a newline, because a caller may want to send a bare control character.
 */
export async function sendTerminalInput(id: string, data: string): Promise<void> {
  if (new TextEncoder().encode(data).length > MAX_INPUT_BYTES) {
    throw new TerminalApiError(413, "input_too_large");
  }
  await post(`${TERMINAL_BASE}/${id}/input`, { data });
}

/** Stops a session. Resolves even if the session had already exited. */
export async function killTerminalSession(id: string): Promise<void> {
  try {
    await post(`${TERMINAL_BASE}/${id}/kill`);
  } catch (error) {
    // An unknown session is already stopped from the caller's point of view.
    if (error instanceof TerminalApiError && error.status === 404) return;
    throw error;
  }
}

export interface TerminalStatus {
  sessions: number;
  max: number;
  ready: boolean;
}

export async function terminalStatus(): Promise<TerminalStatus> {
  const response = await fetch(`${TERMINAL_BASE}/status`);
  if (!response.ok) {
    throw new TerminalApiError(response.status, await readErrorToken(response));
  }
  const body = (await response.json()) as Record<string, string>;
  return {
    sessions: Number(body.sessions ?? 0),
    max: Number(body.max ?? 0),
    ready: body.ready === "true",
  };
}

export interface StreamHandlers {
  onFrame: (frame: TerminalFrame) => void;
  onClosed?: () => void;
  onError?: (token: string) => void;
}

export interface StreamHandle {
  /** Ends the read without killing the shell. The session stays alive. */
  close: () => void;
}

/**
 * Streams a session's output until it exits.
 *
 * <p>Uses a streaming fetch and decodes incrementally, so frames appear as the shell produces them
 * rather than after the process ends. An aborted stream leaves the session running: the UI decides
 * whether to kill it.
 */
export function streamTerminal(id: string, handlers: StreamHandlers): StreamHandle {
  const controller = new AbortController();
  const decoder = createNdjsonDecoder();
  const textDecoder = new TextDecoder();

  void (async () => {
    try {
      const response = await fetch(`${TERMINAL_BASE}/${id}/stream`, {
        signal: controller.signal,
      });
      if (!response.ok) {
        handlers.onError?.(await readErrorToken(response));
        handlers.onClosed?.();
        return;
      }
      if (!response.body) {
        handlers.onError?.("no_stream");
        handlers.onClosed?.();
        return;
      }
      const reader = response.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        // stream:true keeps a multi-byte character split across chunks intact.
        for (const line of decoder.push(textDecoder.decode(value, { stream: true }))) {
          const frame = parseFrame(line);
          if (frame) handlers.onFrame(frame);
        }
      }
      for (const line of decoder.flush()) {
        const frame = parseFrame(line);
        if (frame) handlers.onFrame(frame);
      }
      handlers.onClosed?.();
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        // Deliberate close: not an error condition.
        return;
      }
      handlers.onError?.("stream_failed");
      handlers.onClosed?.();
    }
  })();

  return { close: () => controller.abort() };
}
