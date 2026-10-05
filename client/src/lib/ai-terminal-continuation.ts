/**
 * Running one server-requested terminal command on the device and reporting it back.
 *
 * <p>This is the client half of the round trip, and it is deliberately thin. Every limit, every
 * safety decision and the whole session lifecycle already live in {@link ./ai-terminal-tool}; this
 * module only decides *whether* to run a call, hands the command over, and shapes the executor's
 * result into the payload the server accepts. Re-implementing any of that here would create a
 * second, subtly different set of rules for the same sandbox.
 *
 * <p>Three refusals happen before anything is executed, because each of them would otherwise be a way
 * to make the device do work the server never authorised:
 *
 * <ul>
 *   <li>not an Android build — a browser has no terminal behind the loopback;
 *   <li>no continuation token — the server cannot be resumed without one, so running the command
 *       would produce output that could never be returned;
 *   <li>a tool other than {@link TERMINAL_TOOL_NAME}, or one the server flagged as unsupported —
 *       the client picks nothing here, it only echoes back what was signed.
 * </ul>
 */

import { AiTerminalSession, isAiTerminalAvailable, type TerminalToolResult } from "./ai-terminal-tool";
import { TERMINAL_TOOL_NAME } from "@shared/terminal-tool";
import type { StreamToolCall } from "./chat-stream";

/**
 * Longest command line this device will accept.
 *
 * <p>The server already bounds the signed arguments, so this repeats a limit that is checked there.
 * It is repeated deliberately: the signature is what makes a call trustworthy, and "trusted" should
 * not mean "taken on faith about its size" — a device that runs whatever it is handed should have its
 * own idea of what a command line can be.
 */
const MAX_COMMAND_CHARS = 8_000;

export type TerminalRunOutcome =
  /** The command ran; `command` is echoed back so the execution card can label it. */
  | { kind: "result"; command: string; result: TerminalToolResult }
  /** Nothing was executed and nothing will be sent back; the turn ends without an answer. */
  | { kind: "refused"; reason: string };

/**
 * Reduces an executor result to the fields the server validates.
 *
 * <p>Only what the tool already produced is included. The session id, the loopback cookie and the
 * host filesystem paths are not here because nothing in this path ever had them to begin with.
 */
export function toResultPayload(result: TerminalToolResult): Record<string, unknown> {
  return {
    ok: result.ok,
    stdout: result.stdout,
    stderr: result.stderr,
    exitCode: result.exitCode,
    timedOut: result.timedOut,
    truncated: result.truncated === true,
    confirmationRequired: result.confirmationRequired,
    ...(result.error ? { error: result.error } : {}),
  };
}

/**
 * Runs one requested command, or refuses without touching the device.
 *
 * <p>A destructive command is not a refusal: the executor's own confirmation policy handles it and
 * returns `confirmation_required`, which is reported to the model as an ordinary result so it can
 * react rather than stall.
 */
export async function runServerRequestedCommand(
  call: StreamToolCall,
  session: AiTerminalSession,
): Promise<TerminalRunOutcome> {
  if (!isAiTerminalAvailable()) return { kind: "refused", reason: "terminal_unavailable" };
  if (call.unsupported) return { kind: "refused", reason: "unsupported_tool" };
  if (call.name !== TERMINAL_TOOL_NAME) return { kind: "refused", reason: "unknown_tool" };
  if (!call.continuation) return { kind: "refused", reason: "missing_continuation" };

  let command: string;
  try {
    const parsed = JSON.parse(call.arguments) as { command?: unknown };
    if (typeof parsed.command !== "string") return { kind: "refused", reason: "malformed_arguments" };
    command = parsed.command;
  } catch {
    return { kind: "refused", reason: "malformed_arguments" };
  }
  // A blank command is a model that emitted a call with nothing in it, and an oversized one is
  // either a mistake or something the device was never meant to hold. Neither is worth a shell.
  if (!command.trim()) return { kind: "refused", reason: "empty_command" };
  if (command.length > MAX_COMMAND_CHARS) return { kind: "refused", reason: "command_too_long" };

  return { kind: "result", command, result: await session.run(command) };
}