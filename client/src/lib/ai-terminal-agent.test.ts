/**
 * The agent loop, tested end to end against a stubbed provider and a stubbed loopback.
 *
 * <p>The loop is where the interesting failures live — a tool call that never comes back, a command
 * that fails and has to be survivable, a session that must survive between rounds — so these drive
 * the real {@link runTerminalToolLoop} rather than asserting on its parts.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const capacitor = vi.hoisted(() => ({ native: true, platform: "android" as string }));
const directKey = vi.hoisted(() => ({ value: "sk-direct-test" as string | null }));

vi.mock("@capacitor/core", () => ({
  Capacitor: {
    isNativePlatform: () => capacitor.native,
    getPlatform: () => capacitor.platform,
  },
}));

vi.mock("./direct-key-store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./direct-key-store")>()),
  directKeyFor: () => directKey.value,
  getDirectKey: () => directKey.value,
}));

import { runTerminalToolLoop, terminalToolReady } from "./ai-terminal-agent";

const SESSION_ID = "b".repeat(32);

/** A provider that answers with whatever the test queues, one round at a time. */
function stubProvider(rounds: { content?: string; toolCalls?: { name: string; args: Record<string, unknown> }[] }[]) {
  const requests: { body: Record<string, unknown> }[] = [];
  let index = 0;
  const impl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    requests.push(body);
    const round = rounds[Math.min(index++, rounds.length - 1)]!;
    const message: Record<string, unknown> = { role: "assistant", content: round.content ?? "" };
    if (round.toolCalls) {
      message.tool_calls = round.toolCalls.map((call, at) => ({
        id: `call_${at}`,
        type: "function",
        function: { name: call.name, arguments: JSON.stringify(call.args) },
      }));
    }
    return new Response(JSON.stringify({ choices: [{ message }] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
  return { impl, requests, setFetch: () => { globalThis.fetch = impl; } };
}

/**
 * One fetch for the loop: absolute URLs go to the provider, relative ones to the loopback stub.
 * The production code reaches the loopback through the global `fetch` inside terminal-client, so the
 * routing has to happen on the same function object the loop will actually call.
 */
function routeFetch(
  loopback: { restore: () => void },
  provider: { impl: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> },
): typeof fetch {
  const loopbackFetch = globalThis.fetch;
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input).startsWith("https://")) return provider.impl(input, init);
    return loopbackFetch(input, init);
  }) as typeof fetch;
}

function stubLoopback(exitCodes: Record<string, number> = {}) {
  const writes: string[] = [];
  const killed: string[] = [];
  // The loop reaches the loopback through the global `fetch` inside terminal-client, not through the
  // fetchImpl it is given for the provider, so this is the only place a session count can be read.
  let created = 0;
  let queue: string[] = [];
  let waiting: (() => void) | null = null;
  const push = (line: string) => { queue.push(line); waiting?.(); };
  const encoder = new TextEncoder();
  const original = globalThis.fetch;

  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input);
    const method = init?.method ?? "GET";
    if (path.endsWith("/status")) return new Response(JSON.stringify({ sessions: "0", max: "4", ready: "true" }), { headers: { "content-type": "application/json" } });
    if (path.endsWith("/session") && method === "POST") { created += 1; return new Response(JSON.stringify({ id: SESSION_ID, cwd: "/home/kairema" }), { headers: { "content-type": "application/json" } }); }
    if (path.endsWith("/kill") && method === "POST") { killed.push(path.split("/").slice(-2)[0]!); return new Response(JSON.stringify({ killed: "true" }), { headers: { "content-type": "application/json" } }); }
    if (path.endsWith("/input") && method === "POST") {
      const { data } = JSON.parse(String(init?.body)) as { data: string };
      writes.push(data);
      const command = data.split("\n")[0]!;
      const quoted = [...data.matchAll(/'([^']+)'/g)].map((match) => match[1]!);
      const marker = quoted[1] ?? "";
      const code = exitCodes[command] ?? 0;
      setTimeout(() => {
        push(JSON.stringify({ type: "stdout", data: `${command}\n` }));
        if (code !== 0) push(JSON.stringify({ type: "stderr", data: `error: ${command}\n` }));
        push(JSON.stringify({ type: "stdout", data: `${marker}:${code}\n` }));
      }, 0);
      return new Response(JSON.stringify({ written: String(data.length) }), { headers: { "content-type": "application/json" } });
    }
    if (path.endsWith("/stream")) {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          const drain = () => {
            while (queue.length > 0) controller.enqueue(encoder.encode(`${queue.shift()}\n`));
            waiting = () => { try { drain(); } catch { /* closed */ } };
          };
          drain();
        },
        cancel() { waiting = null; },
      });
      return new Response(body, { status: 200, headers: { "content-type": "application/x-ndjson" } });
    }
    return new Response(JSON.stringify({ error: "not_found" }), { status: 404 });
  });

  return { writes, killed, sessionsCreated: () => created, restore: () => { globalThis.fetch = original; } };
}

beforeEach(() => {
  capacitor.native = true;
  capacitor.platform = "android";
  directKey.value = "sk-direct-test";
});

describe("terminal tool readiness", () => {
  it("is not offered on web", () => {
    capacitor.native = false;
    capacitor.platform = "web";
    expect(terminalToolReady("openrouter")).toBe(false);
  });

  it("is not offered without a key in this tab", () => {
    directKey.value = null;
    expect(terminalToolReady("openrouter")).toBe(false);
  });

  it("is offered for a direct-capable provider on android", () => {
    expect(terminalToolReady("openrouter")).toBe(true);
  });

  it("is not offered for a provider the registry will not call from the page", () => {
    expect(terminalToolReady("anthropic")).toBe(false);
  });
});

describe("runTerminalToolLoop", () => {
  it("refuses to start on web instead of advertising a tool that cannot run", async () => {
    capacitor.native = false;
    capacitor.platform = "web";
    await expect(runTerminalToolLoop({
      providerId: "openrouter", model: "m", content: "hi", systemPrompt: "s",
      onDelta: () => undefined, fetchImpl: vi.fn() as unknown as typeof fetch,
    })).rejects.toThrow(/Android/);
  });

  it("runs a command and hands the result back to the model, then returns the answer", async () => {
    const provider = stubProvider([
      { toolCalls: [{ name: "terminal", args: { command: "ls" } }] },
      { content: "There is one file." },
    ]);
    const loopback = stubLoopback();
    try {
      const deltas: string[] = [];
      const result = await runTerminalToolLoop({
        providerId: "openrouter", model: "m", content: "list files", systemPrompt: "s",
        onDelta: (delta) => deltas.push(delta),
        fetchImpl: routeFetch(loopback, provider),
      });

      expect(result.content).toBe("There is one file.");
      expect(deltas.join("")).toBe("There is one file.");
      expect(provider.requests).toHaveLength(2);
      // The second round must contain the tool result, or the model never saw the output.
      const second = provider.requests[1]!.messages as { role: string; content?: string }[];
      const toolMessage = second.find((message) => message.role === "tool");
      expect(toolMessage).toBeTruthy();
      expect(toolMessage?.content).toContain('"exitCode":0');
      expect(toolMessage?.content).not.toContain("__kairema_ai_exit_");
      expect(loopback.writes[0]).toContain("ls");
      expect(loopback.killed).toEqual([SESSION_ID]);
    } finally {
      loopback.restore();
    }
  });

  it("lets the model continue after a failing command instead of failing the turn", async () => {
    const provider = stubProvider([
      { toolCalls: [{ name: "terminal", args: { command: "false" } }] },
      { toolCalls: [{ name: "terminal", args: { command: "true" } }] },
      { content: "Recovered." },
    ]);
    const loopback = stubLoopback({ false: 1, true: 0 });
    try {
      const result = await runTerminalToolLoop({
        providerId: "openrouter", model: "m", content: "try", systemPrompt: "s",
        onDelta: () => undefined, fetchImpl: routeFetch(loopback, provider),
      });

      expect(result.content).toBe("Recovered.");
      const second = provider.requests[1]!.messages as { role: string; content?: string }[];
      const toolMessage = second.find((message) => message.role === "tool");
      expect(toolMessage?.content).toContain('"exitCode":1');
      expect(toolMessage?.content).toContain("error: false");
      expect(loopback.killed).toEqual([SESSION_ID]);
    } finally {
      loopback.restore();
    }
  });

  it("does not run a command that requires confirmation, and cleans up", async () => {
    const provider = stubProvider([
      { toolCalls: [{ name: "terminal", args: { command: "rm -rf /home/kairema" } }] },
      { content: "I need your approval for that." },
    ]);
    const loopback = stubLoopback();
    try {
      const result = await runTerminalToolLoop({
        providerId: "openrouter", model: "m", content: "clean up", systemPrompt: "s",
        onDelta: () => undefined, fetchImpl: routeFetch(loopback, provider),
      });

      expect(result.content).toBe("I need your approval for that.");
      // Nothing was ever written to the shell.
      expect(loopback.writes).toEqual([]);
      const second = provider.requests[1]!.messages as { role: string; content?: string }[];
      expect(second.find((message) => message.role === "tool")?.content).toContain('"confirmationRequired":true');
      expect(result.steps[0]?.status).toBe("confirmation");
    } finally {
      loopback.restore();
    }
  });

  it("answers an unknown tool rather than leaving the model waiting", async () => {
    const provider = stubProvider([
      { toolCalls: [{ name: "delete_everything", args: {} }] },
      { content: "I cannot do that." },
    ]);
    const loopback = stubLoopback();
    try {
      const result = await runTerminalToolLoop({
        providerId: "openrouter", model: "m", content: "delete", systemPrompt: "s",
        onDelta: () => undefined, fetchImpl: routeFetch(loopback, provider),
      });

      expect(result.content).toBe("I cannot do that.");
      const second = provider.requests[1]!.messages as { role: string; content?: string }[];
      expect(second.find((message) => message.role === "tool")?.content).toContain("unknown_tool");
    } finally {
      loopback.restore();
    }
  });

  it("reuses one session across rounds so the working directory survives", async () => {
    const provider = stubProvider([
      { toolCalls: [{ name: "terminal", args: { command: "cd /home/kairema/test" } }] },
      { toolCalls: [{ name: "terminal", args: { command: "ls" } }] },
      { content: "Done." },
    ]);
    const loopback = stubLoopback();
    try {
      const result = await runTerminalToolLoop({
        providerId: "openrouter", model: "m", content: "set up", systemPrompt: "s",
        onDelta: () => undefined, fetchImpl: routeFetch(loopback, provider),
      });

      expect(result.content).toBe("Done.");
      expect(loopback.sessionsCreated()).toBe(1);
      expect(loopback.writes).toHaveLength(2);
    } finally {
      loopback.restore();
    }
  });

  it("releases the session even when the provider fails", async () => {
    const loopback = stubLoopback();
    try {
      // The loop reaches the loopback through the global `fetch`, so only absolute provider URLs are
      // made to fail here.
      const loopbackFetch = globalThis.fetch;
      const routed = (async (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input).startsWith("https://")) throw new Error("network down");
        return loopbackFetch(input, init);
      }) as typeof fetch;

      await expect(runTerminalToolLoop({
        providerId: "openrouter", model: "m", content: "hi", systemPrompt: "s",
        onDelta: () => undefined, fetchImpl: routed,
      })).rejects.toBeTruthy();
      // No session was created, so nothing to release and no shell left on the device.
      expect(loopback.killed).toEqual([]);
    } finally {
      loopback.restore();
    }
  });
});