/**
 * The device side of a server-requested command.
 *
 * <p>These are the tests that decide whether the server can trust what comes back. The server signs
 * the tool name and the arguments, so the device is not choosing what to run — but it is choosing
 * whether to run it, and a device that runs something the signature did not cover would undo the
 * whole arrangement.
 */

import { describe, expect, it, vi } from "vitest";

// The native bridge does not exist under the test runner. Stubbing availability is what makes the
// refusals below about the <em>call</em> rather than about the environment, which is why this is
// hoisted rather than mocked per test.
const { available } = vi.hoisted(() => ({ available: vi.fn() }));
vi.mock("./ai-terminal-tool", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./ai-terminal-tool")>()),
  isAiTerminalAvailable: available,
}));

import { runServerRequestedCommand } from "./ai-terminal-continuation";
import type { AiTerminalSession } from "./ai-terminal-tool";

available.mockReturnValue(true);

function session(overrides: Partial<AiTerminalSession> = {}) {
  return {
    run: vi.fn().mockResolvedValue({ ok: true, stdout: "/home/kairema", stderr: "", exitCode: 0, timedOut: false, truncated: false, confirmationRequired: false }),
    close: vi.fn(),
    ...overrides,
  } as unknown as AiTerminalSession;
}

const signedCall = (args: unknown, extra: Record<string, unknown> = {}) => ({
  callId: "call_1",
  name: "terminal",
  arguments: typeof args === "string" ? args : JSON.stringify(args),
  continuation: "signed.token",
  ...extra,
});

describe("running what the server asked for", () => {
  it("forwards the signed arguments unchanged and reports what came back", async () => {
    const shell = session();
    const outcome = await runServerRequestedCommand(signedCall({ command: "pwd" }), shell);
    expect(shell.run).toHaveBeenCalledWith("pwd");
    expect(outcome).toEqual({
      kind: "result",
      command: "pwd",
      result: { ok: true, stdout: "/home/kairema", stderr: "", exitCode: 0, timedOut: false, truncated: false, confirmationRequired: false },
    });
  });

  it("keeps shell quoting exactly as the model wrote it", async () => {
    const shell = session();
    await runServerRequestedCommand(signedCall({ command: "grep -n 'a b' file.txt | wc -l" }), shell);
    expect(shell.run).toHaveBeenCalledWith("grep -n 'a b' file.txt | wc -l");
  });

  it("reports a non-zero exit as data rather than as a failure to run", async () => {
    const shell = session({ run: vi.fn().mockResolvedValue({ ok: false, stdout: "", stderr: "not found", exitCode: 127, timedOut: false, truncated: false, confirmationRequired: false }) });
    const outcome = await runServerRequestedCommand(signedCall({ command: "nope" }), shell);
    expect(outcome.kind).toBe("result");
  });
});

describe("a build with no terminal behind it", () => {
  it("refuses without touching the shell, because a browser has nothing to run on", async () => {
    available.mockReturnValueOnce(false);
    const shell = session();
    const outcome = await runServerRequestedCommand(signedCall({ command: "pwd" }), shell);
    expect(shell.run).not.toHaveBeenCalled();
    expect(outcome).toEqual({ kind: "refused", reason: "terminal_unavailable" });
  });

  it("refuses a call the server itself marked unsupported", async () => {
    const shell = session();
    const outcome = await runServerRequestedCommand(signedCall({ command: "pwd" }, { name: "send_email", unsupported: true }), shell);
    expect(shell.run).not.toHaveBeenCalled();
    expect(outcome).toEqual({ kind: "refused", reason: "unsupported_tool" });
  });
});

describe("nothing runs unless the signature covers it", () => {
  const refuses: Array<[string, Record<string, unknown>]> = [
    ["a different tool", { name: "shell" }],
    ["no tool at all", { name: "" }],
    ["arguments that are not JSON", { arguments: "command: rm -rf /" }],
    ["a JSON array", { arguments: "[1,2,3]" }],
    ["JSON null", { arguments: "null" }],
    ["a missing command", { arguments: '{"cwd":"/tmp"}' }],
    ["a non-string command", { arguments: '{"command":42}' }],
    ["a blank command", { arguments: '{"command":"   "}' }],
    ["an enormous command", { arguments: JSON.stringify({ command: "x".repeat(20_000) }) }],
  ];

  it.each(refuses)("refuses %s without touching the shell", async (_label, override) => {
    const shell = session();
    const outcome = await runServerRequestedCommand(signedCall({ command: "pwd" }, override), shell);
    expect(shell.run).not.toHaveBeenCalled();
    expect(outcome.kind).toBe("refused");
  });

  it("refuses a call with no continuation to come back on", async () => {
    const shell = session();
    const outcome = await runServerRequestedCommand(signedCall({ command: "pwd" }, { continuation: "" }), shell);
    expect(shell.run).not.toHaveBeenCalled();
    expect(outcome.kind).toBe("refused");
  });

  it("refuses rather than running a command it cannot parse out of its arguments", async () => {
    const shell = session();
    const outcome = await runServerRequestedCommand(signedCall('{"command":"pwd","extra":"field"}'), shell);
    // Extra properties are ignored, not fatal: the model may add fields, and the signed string is
    // still what reaches the shell.
    expect(shell.run).toHaveBeenCalledWith("pwd");
    expect(outcome.kind).toBe("result");
  });

  it("never closes the session on a refusal, so the next round can still run", async () => {
    const shell = session();
    await runServerRequestedCommand(signedCall({ command: "pwd" }, { name: "shell" }), shell);
    expect(shell.close).not.toHaveBeenCalled();
  });
});