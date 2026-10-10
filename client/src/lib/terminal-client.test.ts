import { describe, expect, it } from "vitest";
import {
  createNdjsonDecoder,
  MAX_INPUT_BYTES,
  TerminalApiError,
  TERMINAL_BASE,
  createTerminalSession,
  killTerminalSession,
  sendTerminalInput,
  terminalStatus,
  type TerminalFrame,
} from "./terminal-client";

/**
 * NDJSON reassembly is the part of the client most likely to break: a WebView stream delivers
 * arbitrary byte boundaries, so a JSON line routinely arrives in pieces. These tests pin the
 * reassembly, and the request shapes, without a real socket.
 */

function decodeAll(chunks: string[]): string[] {
  const decoder = createNdjsonDecoder();
  const lines: string[] = [];
  for (const chunk of chunks) lines.push(...decoder.push(chunk));
  lines.push(...decoder.flush());
  return lines;
}

describe("createNdjsonDecoder", () => {
  it("reassembles a line split across many chunks", () => {
    const lines = decodeAll(['{"type":"std', 'out","da', 'ta":"hel', 'lo\\n"}']);
    expect(lines).toEqual(['{"type":"stdout","data":"hello\\n"}']);
  });

  it("emits nothing until a newline arrives", () => {
    const decoder = createNdjsonDecoder();
    expect(decoder.push('{"type":"stdout","data":"par')).toEqual([]);
    expect(decoder.push('tial"}')).toEqual([]);
    expect(decoder.push("\n")).toEqual(['{"type":"stdout","data":"partial"}']);
  });

  it("emits several lines from one chunk and keeps the remainder", () => {
    const decoder = createNdjsonDecoder();
    expect(decoder.push('{"a":1}\n{"b":2}\n{"c":3}')).toEqual(['{"a":1}', '{"b":2}']);
    expect(decoder.push("\n")).toEqual(['{"c":3}']);
  });

  it("handles a chunk boundary that falls exactly on the newline", () => {
    expect(decodeAll(['{"a":1}', "\n", '{"b":2}\n'])).toEqual(['{"a":1}', '{"b":2}']);
  });

  it("handles CRLF line endings", () => {
    // The carriage return stays inside the line, which JSON.parse tolerates as trailing whitespace.
    expect(decodeAll(['{"a":1}\r\n'])).toEqual(['{"a":1}\r']);
  });

  it("ignores empty lines rather than emitting a blank frame", () => {
    expect(decodeAll(["\n\n", '{"a":1}\n', "\n"])).toEqual(['{"a":1}']);
  });

  it("emits an unterminated final line on flush instead of dropping it", () => {
    const decoder = createNdjsonDecoder();
    expect(decoder.push('{"type":"exit","code":0}')).toEqual([]);
    expect(decoder.flush()).toEqual(['{"type":"exit","code":0}']);
    // Flushing twice must not repeat it.
    expect(decoder.flush()).toEqual([]);
  });

  it("does not resurface a completed line on flush", () => {
    const decoder = createNdjsonDecoder();
    decoder.push('{"a":1}\n');
    expect(decoder.flush()).toEqual([]);
  });

  it("reassembles a realistic interleaved stdout, stderr and exit stream", () => {
    const wire = [
      '{"type":"stdout","data":"/home/kairema\\n"}',
      '{"type":"stdout","data":"hello\\n"}',
      '{"type":"stderr","data":"sh: nope: not found\\n"}',
      '{"type":"keepalive"}',
      '{"type":"exit","code":127}',
      "",
    ].join("\n");
    // Chopped at 7-byte boundaries, which is the pathological case for a line-oriented format.
    const chunks: string[] = [];
    for (let i = 0; i < wire.length; i += 7) chunks.push(wire.slice(i, i + 7));

    const decoder = createNdjsonDecoder();
    const parsed: TerminalFrame[] = [];
    for (const chunk of chunks) {
      for (const line of decoder.push(chunk)) {
        parsed.push(JSON.parse(line) as TerminalFrame);
      }
    }
    for (const line of decoder.flush()) parsed.push(JSON.parse(line) as TerminalFrame);

    expect(parsed).toEqual([
      { type: "stdout", data: "/home/kairema\n" },
      { type: "stdout", data: "hello\n" },
      { type: "stderr", data: "sh: nope: not found\n" },
      { type: "keepalive" },
      { type: "exit", code: 127 },
    ]);
  });
});

describe("terminal routes", () => {
  it("sends every request to the local terminal prefix, never to a backend path", () => {
    // The base must stay under /api/local/ so the loopback proxy allowlist is untouched and the
    // backend never sees a terminal request.
    expect(TERMINAL_BASE).toBe("/api/local/terminal");
    expect(TERMINAL_BASE.startsWith("/api/")).toBe(true);
    expect(TERMINAL_BASE.startsWith("/api/trpc")).toBe(false);
    expect(TERMINAL_BASE).toContain("/local/");
  });

  it("rejects a session id that is not the expected shape instead of using it in a path", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ id: "../../etc/passwd", cwd: "/" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })) as typeof fetch;
    try {
      await expect(createTerminalSession()).rejects.toBeInstanceOf(TerminalApiError);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("surfaces the native error token so the UI can explain a full session list", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ error: "session_limit" }), {
        status: 429,
        headers: { "Content-Type": "application/json" },
      })) as typeof fetch;
    try {
      await expect(createTerminalSession()).rejects.toMatchObject({
        status: 429,
        token: "session_limit",
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("treats killing an unknown session as already stopped", async () => {
    const originalFetch = globalThis.fetch;
    let called = 0;
    globalThis.fetch = (async () => {
      called++;
      return new Response(JSON.stringify({ error: "no_such_session" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;
    try {
      await expect(killTerminalSession("0123456789abcdef0123456789abcdef")).resolves.toBeUndefined();
      expect(called).toBe(1);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("refuses oversized input before it reaches the network", async () => {
    const originalFetch = globalThis.fetch;
    let called = 0;
    globalThis.fetch = (async () => {
      called++;
      return new Response("{}", { status: 200 });
    }) as typeof fetch;
    try {
      await expect(sendTerminalSessionTooLarge()).rejects.toMatchObject({ token: "input_too_large" });
      expect(called).toBe(0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("reads the status payload into numbers", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ sessions: "2", max: "4", ready: "true" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })) as typeof fetch;
    try {
      expect(await terminalStatus()).toEqual({ sessions: 2, max: 4, ready: true });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

async function sendTerminalSessionTooLarge(): Promise<void> {
  return sendTerminalInput("0123456789abcdef0123456789abcdef", "x".repeat(MAX_INPUT_BYTES + 1));
}
