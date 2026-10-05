/* @vitest-environment jsdom */

import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The bridge is tested against the real loopback client, not against a stub of it, because the
 * things that break in practice are the route names, the NDJSON frame shapes and the exit marker.
 * A mock of the whole client would pass with any of those wrong.
 */

const capacitor = vi.hoisted(() => ({ native: true, platform: "android" as string }));

vi.mock("@capacitor/core", () => ({
  Capacitor: {
    isNativePlatform: () => capacitor.native,
    getPlatform: () => capacitor.platform,
  },
}));

import {
  AiTerminalSession,
  AI_TERMINAL_LIMITS,
  AI_TERMINAL_TOOL,
  evaluateConfirmation,
  isAiTerminalAvailable,
} from "./ai-terminal-tool";

const SESSION_ID = "a".repeat(32);

/**
 * A loopback stub that behaves like the real routes: same paths, same JSON bodies, and a stream
 * that only produces output after the command is written, the way a shell does.
 */
function stubLoopback(options: { ready?: boolean; silentCommands?: Set<string> } = {}) {
  const calls: { path: string; body?: string }[] = [];
  const created: string[] = [];
  const killed: string[] = [];
  let live = 0;
  let queue: string[] = [];
  let waiting: (() => void) | null = null;
  const originalFetch = globalThis.fetch;

  const push = (line: string) => {
    queue.push(line);
    waiting?.();
  };

  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input);
    const method = init?.method ?? "GET";
    calls.push({ path, ...(typeof init?.body === "string" ? { body: init.body } : {}) });

    if (path.endsWith("/status")) {
      return jsonResponse({ sessions: String(live), max: "4", ready: String(options.ready ?? true) });
    }
    if (path.endsWith("/session") && method === "POST") {
      live += 1;
      created.push(SESSION_ID);
      return jsonResponse({ id: SESSION_ID, cwd: "/home/kairema" });
    }
    if (path.endsWith("/kill") && method === "POST") {
      live -= 1;
      killed.push(path.split("/").slice(-2)[0]!);
      return jsonResponse({ killed: "true" });
    }
    if (path.endsWith("/input") && method === "POST") {
      const { data } = JSON.parse(String(init?.body)) as { data: string };
      // The command line is the first line; the rest is the marker's own printf.
      const command = data.split("\n")[0]!;
      // The write is `<command>\nprintf '<fmt>' '<marker>' "$?"`, so the marker is the *second*
      // quoted group; taking the first would pick up the printf format string.
      const quoted = [...data.matchAll(/'([^']+)'/g)].map((match) => match[1]!);
      const marker = quoted[1] ?? "";
      if (!options.silentCommands?.has(command)) {
        // Reproduces the real protocol: command output first, the exit marker last.
        setTimeout(() => {
          push(JSON.stringify({ type: "stdout", data: `${command}\n` }));
          push(JSON.stringify({ type: "stdout", data: `${marker}:0\n` }));
        }, 0);
      }
      return jsonResponse({ written: String(data.length) });
    }
    if (path.endsWith("/stream")) {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          const encoder = new TextEncoder();
          const drain = () => {
            while (queue.length > 0) controller.enqueue(encoder.encode(`${queue.shift()}\n`));
            waiting = () => {
              try { drain(); } catch { /* closed */ }
            };
          };
          waiting = () => { try { drain(); } catch { /* closed */ } };
          drain();
        },
        cancel() { waiting = null; },
      });
      return new Response(body, { status: 200, headers: { "content-type": "application/x-ndjson" } });
    }
    return jsonResponse({ error: "not_found" }, 404);
  });

  return {
    calls,
    created,
    killed,
    liveSessions: () => live,
    restore: () => { globalThis.fetch = originalFetch; },
  };
}

function jsonResponse(body: Record<string, string>, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

beforeEach(() => {
  capacitor.native = true;
  capacitor.platform = "android";
});

describe("terminal tool availability", () => {
  it("is unavailable on web, so the tool is never offered to a model there", () => {
    capacitor.native = false;
    capacitor.platform = "web";
    expect(isAiTerminalAvailable()).toBe(false);
  });

  it("is available only on native android", () => {
    expect(isAiTerminalAvailable()).toBe(true);
    capacitor.platform = "ios";
    expect(isAiTerminalAvailable()).toBe(false);
  });

  it("declares a single tool with a required command argument", () => {
    expect(AI_TERMINAL_TOOL.function.name).toBe("terminal");
    expect(AI_TERMINAL_TOOL.function.parameters.required).toEqual(["command"]);
  });
});

describe("confirmation policy", () => {
  it("lets ordinary commands run without asking", () => {
    for (const command of ["ls -la", "cat file.txt", "npm test", "grep -rn foo src", "echo $(pwd)"]) {
      expect(evaluateConfirmation(command)).toEqual({ required: false });
    }
  });

  it("asks before destructive and system commands", () => {
    for (const command of [
      "rm -rf /home/kairema/work",
      "mkfs.ext4 /dev/block",
      "dd if=/dev/zero of=/dev/block/sda",
      "shutdown now",
      "apt install -y nginx",
      "chmod 777 /",
      ":(){ :|:& };:",
    ]) {
      expect(evaluateConfirmation(command).required).toBe(true);
    }
  });

  it("cannot be bypassed with shell syntax", () => {
    // Each of these starts with something harmless; a first-word check would pass all of them.
    for (const command of [
      "echo hi; rm -rf /home/kairema",
      "true && mkfs.ext4 /dev/block",
      "ls | dd if=/dev/zero of=/dev/sda",
      "echo $(shutdown now)",
      "cat notes.txt `rm -rf /tmp/x`",
    ]) {
      expect(evaluateConfirmation(command).required).toBe(true);
    }
  });
});

describe("AiTerminalSession", () => {
  it("drives the existing loopback routes rather than a second API", async () => {
    const loopback = stubLoopback();
    try {
      const session = new AiTerminalSession();
      const result = await session.run("ls -la");
      expect(result.ok).toBe(true);
      expect(loopback.created).toEqual([SESSION_ID]);
      expect(loopback.calls.map((call) => call.path)).toEqual([
        "/api/local/terminal/status",
        "/api/local/terminal/session",
        `/${"api/local/terminal"}/${SESSION_ID}/stream`,
        `/api/local/terminal/${SESSION_ID}/input`,
      ]);
      await session.close();
    } finally {
      loopback.restore();
    }
  });

  it("returns stdout and the exit code, and strips the exit marker from the output", async () => {
    const loopback = stubLoopback();
    try {
      const session = new AiTerminalSession();
      const result = await session.run("echo hello");
      expect(result.stdout).toBe("echo hello");
      expect(result.exitCode).toBe(0);
      expect(result.stderr).toBe("");
      expect(result.stdout).not.toContain("__kairema_ai_exit_");
      await session.close();
    } finally {
      loopback.restore();
    }
  });

  it("caps the output it hands to the model, and still finishes on its marker", async () => {
    const loopback = stubLoopback();
    try {
      // A ceiling small enough that the stubbed output overruns it, and a deadline short enough
      // that a regression here fails fast instead of sitting out the real one.
      const session = new AiTerminalSession({
        ...AI_TERMINAL_LIMITS, maxOutputChars: 20, commandTimeoutMs: 500,
      });
      const result = await session.run("echo " + "x".repeat(60));
      // The point of the scan window: overflowing the ceiling must not cost the exit code.
      expect(result.ok).toBe(true);
      expect(result.exitCode).toBe(0);
      expect(result.timedOut).toBe(false);
      expect(result.stdout.length).toBeLessThanOrEqual(20);
      expect(result.truncated).toBe(true);
      await session.close();
    } finally {
      loopback.restore();
    }
  });

  it("keeps the working directory between commands by reusing one session", async () => {
    const loopback = stubLoopback();
    try {
      const session = new AiTerminalSession();
      await session.run("cd /home/kairema/work");
      await session.run("ls");
      // One session for the whole task: a fresh shell per command would lose the cd entirely.
      expect(loopback.created).toHaveLength(1);
      expect(session.callCount).toBe(2);
      await session.close();
    } finally {
      loopback.restore();
    }
  });

  it("reports a timeout instead of waiting for a stream that never completes", async () => {
    vi.useFakeTimers();
    const loopback = stubLoopback({ silentCommands: new Set(["sleep 100"]) });
    try {
      const session = new AiTerminalSession();
      const pending = session.run("sleep 100");
      await vi.advanceTimersByTimeAsync(AI_TERMINAL_LIMITS.commandTimeoutMs + 10);
      const result = await pending;
      expect(result.timedOut).toBe(true);
      expect(result.ok).toBe(false);
      expect(result.exitCode).toBeNull();
      // A still-running shell is stopped, so the next command is not queued behind it.
      expect(loopback.killed).toEqual([SESSION_ID]);
      vi.useRealTimers();
    } finally {
      loopback.restore();
      vi.useRealTimers();
    }
  });

  it("caps the number of commands in one task", async () => {
    const loopback = stubLoopback();
    try {
      const session = new AiTerminalSession();
      const budget = AI_TERMINAL_LIMITS.maxCallsPerTask + 2;
      const results = [];
      for (let index = 0; index < budget; index += 1) results.push(await session.run(`echo ${index}`));
      const last = results.at(-1)!;
      expect(last.error).toBe("call_budget_exhausted");
      expect(last.ok).toBe(false);
      expect(session.callCount).toBe(AI_TERMINAL_LIMITS.maxCallsPerTask);
      await session.close();
    } finally {
      loopback.restore();
    }
  });

  it("returns a machine-readable error when the runtime is not installed", async () => {
    const loopback = stubLoopback({ ready: false });
    try {
      const session = new AiTerminalSession();
      const result = await session.run("ls");
      expect(result.ok).toBe(false);
      expect(result.error).toBe("runtime_unavailable");
      // No session was created, so nothing is left behind on the device.
      expect(loopback.created).toEqual([]);
      await session.close();
    } finally {
      loopback.restore();
    }
  });

  it("releases the session on close, and close is idempotent", async () => {
    const loopback = stubLoopback();
    try {
      const session = new AiTerminalSession();
      await session.run("echo hi");
      await session.close();
      await session.close();
      expect(loopback.killed).toEqual([SESSION_ID]);
      expect(loopback.liveSessions()).toBe(0);
      // A released session cannot be reused: a later command would otherwise reach a dead shell.
      expect((await session.run("echo again")).error).toBe("session_closed");
    } finally {
      loopback.restore();
    }
  });

  it("never leaks the loopback cookie or a secret into the result", async () => {
    const loopback = stubLoopback();
    try {
      const session = new AiTerminalSession();
      const result = await session.run("env");
      const serialised = JSON.stringify(result);
      expect(serialised).not.toContain("kairema_loopback");
      expect(Object.keys(result).sort()).toEqual([
        "command", "error", "exitCode", "ok", "stdout", "stderr", "timedOut", "confirmationRequired",
      ].filter((key) => key in result).sort());
      await session.close();
    } finally {
      loopback.restore();
    }
  });
});