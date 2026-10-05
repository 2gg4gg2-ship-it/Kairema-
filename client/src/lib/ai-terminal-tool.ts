/**
 * The on-device terminal, exposed to a model as one tool.
 *
 * <p>This module is the whole of the AI-to-terminal bridge. It deliberately does not talk to the
 * native side directly: every call goes through {@link ./terminal-client}, which is the same client
 * the interactive Terminal screen uses, over the same loopback routes, with the same cookie. There
 * is no second runtime and no second API, so there is nothing here that could behave differently
 * from the shell a user is typing into by hand.
 *
 * <p>Three properties are load-bearing and are the reason this is a module rather than a function:
 *
 * <ul>
 *   <li><b>Session ownership.</b> Commands run in a session this module creates and destroys, never
 *       in the one the Terminal screen is showing. A model that ran `cd` or left a process running
 *       must not disturb the shell a person is using, and a person must not be able to disturb a
 *       model mid-command.
 *   <li><b>A shell that persists.</b> The session is reused across the commands of one AI task, so
 *       `cd /home/kairema/work` in one call is still the working directory for the next. Each
 *       command is not run in a fresh subshell, because that would silently break every multi-step
 *       instruction a model writes.
 *   <li><b>Bounded everything.</b> One command has a deadline, output has a ceiling, and a task has
 *       a call budget. Without all three, one runaway command holds a model turn open forever.
 * </ul>
 *
 * <p>Nothing here reaches the network. Terminal output never goes to the Kairema server; it goes
 * back into the model conversation, which the page already owns.
 */

import { Capacitor } from "@capacitor/core";
import {
  createTerminalSession,
  killTerminalSession,
  sendTerminalInput,
  streamTerminal,
  TerminalApiError,
  terminalStatus,
} from "./terminal-client";

/**
 * Ceilings for one AI task.
 *
 * <p>Small values on purpose. The tool exists so a model can inspect and build in a sandboxed guest;
 * it is not a build farm, and a turn that runs dozens of commands has already gone wrong.
 */
export const AI_TERMINAL_LIMITS = {
  /** Wall-clock ceiling for a single command. */
  commandTimeoutMs: 20_000,
  /** Longest single stdin write accepted for a command. */
  commandBytes: 8_000,
  /** Output kept per stream, applied to stdout and stderr separately. */
  maxOutputChars: 8_000,
  /** Terminal calls allowed across one AI task, confirmation refusals included. */
  maxCallsPerTask: 12,
  /** Rounds of model↔tool before the loop stops and answers with what it has. */
  maxRounds: 8,
} as const;

/**
 * Whether the terminal tool may be offered to a model on this build.
 *
 * <p>False on web, and the tool is then never registered at all: there is nothing behind
 * `/api/local/terminal` in a browser, so offering it would only produce a failed call the model
 * would try to explain. Checked here as well as at the call site so the two cannot drift apart.
 */
export function isAiTerminalAvailable(): boolean {
  try {
    return Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android";
  } catch {
    // A host without Capacitor at all (tests, SSR) has no terminal.
    return false;
  }
}

/** What a model receives back. Every field is safe to hand to a provider. */
export type TerminalToolResult = {
  ok: boolean;
  command: string;
  stdout: string;
  stderr: string;
  /** null when the shell did not report one (timeout, killed session, runtime refused). */
  exitCode: number | null;
  timedOut: boolean;
  confirmationRequired: boolean;
  /**
   * Set when the command was refused rather than run. A fixed token from a closed set, never a
   * message that could carry command text back out through an error path.
   */
  error?: string;
  /** True when output hit the ceiling and was cut. */
  truncated?: boolean;
};

/**
 * Commands that are destructive enough to be worth a confirmation.
 *
 * <p>This is intentionally not a Linux blacklist and is not trying to be one; any such list is
 * incomplete by construction. It covers the handful of commands that destroy the guest or the
 * device's view of it, and it is deliberately a single table so extending it is a one-line change
 * rather than a new subsystem.
 *
 * <p>The match is a whole-command scan rather than a first-word check, precisely because a
 * first-word check is trivially bypassed: `true && rm -rf /home` and `echo hi; rm -rf /home` both
 * start with something harmless. Splitting on shell separators and checking every segment, plus
 * checking the raw text, means the separators themselves cannot be used to hide a match.
 */
const CONFIRM_PATTERNS: ReadonlyArray<{ reason: string; pattern: RegExp }> = [
  { reason: "rm", pattern: /(^|[\s;&|(`$])rm\s+(-[a-zA-Z]*\s+)*-{0,2}[a-zA-Z]*[rf][a-zA-Z]*/ },
  { reason: "filesystem_write_to_device", pattern: /(^|[\s;&|(])mkfs|mkswap|(^|[\s;&|(])dd\s+[^|;&]*of=\/dev\// },
  { reason: "device_or_power", pattern: /(^|[\s;&|(])(shutdown|reboot|halt|poweroff|init\s+0|init\s+6)\b/ },
  { reason: "fork_bomb", pattern: /:\(\)\s*\{.*\}\s*;\s*:/ },
  { reason: "mass_permission_change", pattern: /(^|[\s;&|(])chmod\s+(-[a-zA-Z]+\s+)*(777|\+rwx)\s+\/|chown\s+-R\s/ },
  { reason: "recursive_delete_outside_tmp", pattern: /(^|[\s;&|(])rm\s+(-[a-zA-Z]*\s+)*-[a-zA-Z]*r[a-zA-Z]*\s+\/(etc|bin|sbin|usr|var|lib|boot|home)/ },
  { reason: "package_manager_global", pattern: /(^|[\s;&|(])(apt|apt-get|yum|dnf|apk|pacman)\s/ },
  { reason: "mount_or_namespace", pattern: /(^|[\s;&|(])(mount|umount|unshare|nsenter)\s/ },
];

/** Segments a shell would treat as separate commands, used only for scanning. */
const SHELL_SEPARATORS = /[;&|()`\n]/;

export type ConfirmationDecision =
  | { required: false }
  | { required: true; reason: string };

/**
 * Decides whether a command needs the user's confirmation.
 *
 * <p>Exported and pure so the policy is testable on its own, and so a caller can show the user the
 * exact command and reason before deciding. It inspects every shell-separated segment as well as the
 * raw string, so neither `&&`, `;`, a subshell nor a command substitution hides a match.
 */
export function evaluateConfirmation(command: string): ConfirmationDecision {
  const segments = command.split(SHELL_SEPARATORS).filter((segment) => segment.trim().length > 0);
  for (const candidate of [command, ...segments]) {
    for (const { reason, pattern } of CONFIRM_PATTERNS) {
      if (pattern.test(candidate)) return { required: true, reason };
    }
  }
  return { required: false };
}

/**
 * A marker echoed after the command so its exit status can be read back.
 *
 * <p>A shell session is long-lived and interactive, so the shell never exits and there is no exit
 * frame to wait for. Writing the status to stdout behind a random marker is the only way to know a
 * command has finished: without it every call would have to guess and either truncate real output or
 * wait forever. The random suffix means command output cannot forge one, and an echoed copy would
 * be stripped by the token itself.
 */
function exitMarker(): string {
  const random = Math.random().toString(36).slice(2, 10);
  return `__kairema_ai_exit_${random}__`;
}

const EXIT_PATTERN = (marker: string) => new RegExp(`\\n?${marker}:(\\d+)\\n?`);

/**
 * How much raw stdout the exit marker is searched in.
 *
 * <p>The marker is written after the command finishes, so it is always at the tail. Keeping a
 * rolling window of raw output to search is what lets a command whose output exceeds
 * {@link AI_TERMINAL_LIMITS.maxOutputChars} still finish on its marker instead of waiting out the
 * deadline: the kept output is capped, but the search is not, and the two are separate buffers.
 */
const MARKER_SCAN_TAIL_CHARS = 512;

/**
 * One AI-owned shell, reused for every command in the task.
 *
 * <p>Created lazily so a task that only needed to read something does not pay for a session, and
 * always released — including on a failed command or a rejected confirmation — so a task can never
 * leave a guest shell behind. {@link close} is idempotent and safe to call from a cleanup path.
 */
export class AiTerminalSession {
  private id: string | null = null;
  private calls = 0;
  private closed = false;

  constructor(private readonly limits = AI_TERMINAL_LIMITS) {}

  /** How many calls this session has spent, against the per-task budget. */
  get callCount(): number {
    return this.calls;
  }

  /** Whether a session exists on the device. Exposed for tests. */
  get sessionId(): string | null {
    return this.id;
  }

  private async ensureSession(): Promise<string> {
    if (this.closed) throw new Error("terminal session already released");
    if (this.id) return this.id;
    // The runtime is installed lazily on first use. Asking first turns "not ready yet" into a
    // readable answer instead of a 503 the model has to interpret.
    const status = await terminalStatus();
    if (!status.ready) throw new TerminalApiError(503, "runtime_unavailable");
    const created = await createTerminalSession();
    this.id = created.id;
    return created.id;
  }

  /**
   * Runs one command and waits for it to finish.
   *
   * <p>A non-zero exit is a normal result, not an error: the model is expected to read stderr and
   * decide what to do, so it is reported rather than thrown. Only the things that prevented the
   * command from running at all — no runtime, no session, no budget, a closed session — come back as
   * `ok:false`.
   */
  async run(command: string): Promise<TerminalToolResult> {
    const fail = (error: string): TerminalToolResult => ({
      ok: false, command, stdout: "", stderr: "", exitCode: null,
      timedOut: false, confirmationRequired: false, error,
    });

    if (this.closed) return fail("session_closed");
    if (this.calls >= this.limits.maxCallsPerTask) return fail("call_budget_exhausted");

    const trimmed = command.replace(/\s+$/, "");
    if (trimmed.length === 0) return fail("empty_command");
    if (new TextEncoder().encode(trimmed).length > this.limits.commandBytes) return fail("command_too_large");

    let id: string;
    try {
      id = await this.ensureSession();
    } catch (error) {
      // A stable token, never the platform message: a runtime failure can otherwise describe the
      // app's private directory layout.
      const token = error instanceof TerminalApiError ? error.token : "runtime_unavailable";
      return fail(token);
    }

    this.calls += 1;
    const marker = exitMarker();
    return await this.execute(id, trimmed, marker);
  }

  /**
   * Writes the command, then reads the stream until the exit marker or the deadline.
   *
   * <p>The read is bounded twice over: a timer for a command that never returns, and the marker for
   * one that does. Relying on the timer alone would add the timeout to every command's cost;
   * relying on the marker alone would hang forever on a command that never finishes.
   */
  private execute(id: string, command: string, marker: string): Promise<TerminalToolResult> {
    const limits = this.limits;
    return new Promise<TerminalToolResult>((resolve) => {
      let stdout = "";
      let stderr = "";
      let scanTail = "";
      let truncated = false;
      let settled = false;
      let handle: { close: () => void } | null = null;

      const finish = (result: TerminalToolResult) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        handle?.close();
        resolve({
          ...result,
          stdout: cap(result.stdout, limits.maxOutputChars),
          stderr: cap(result.stderr, limits.maxOutputChars),
          ...(truncated ? { truncated: true } : {}),
        });
      };

      const timer = setTimeout(() => {
        // The shell is still busy with the command, so the session is stopped rather than reused:
        // a later command would otherwise queue behind a process that may never exit.
        void killTerminalSession(id).catch(() => undefined);
        finish({
          ok: false, command, stdout: cap(stdout, limits.maxOutputChars),
          stderr: cap(stderr, limits.maxOutputChars), exitCode: null,
          timedOut: true, confirmationRequired: false, error: "command_timeout",
        });
      }, limits.commandTimeoutMs);

      const append = (target: "stdout" | "stderr", data: string) => {
        if (target === "stdout") {
          // The scan window keeps receiving data after the kept output is full, so the marker is
          // still found; only what is handed to the model stops growing.
          scanTail = (scanTail + data).slice(-MARKER_SCAN_TAIL_CHARS);
          if (stdout.length >= limits.maxOutputChars) { truncated = true; return; }
          stdout += data;
          if (stdout.length > limits.maxOutputChars) truncated = true;
        } else {
          if (stderr.length >= limits.maxOutputChars) { truncated = true; return; }
          stderr += data;
          if (stderr.length > limits.maxOutputChars) truncated = true;
        }
      };

      handle = streamTerminal(id, {
        onFrame: (frame) => {
          if (frame.type === "stdout") {
            append("stdout", frame.data);
            // Searched in the scan window rather than in the kept output, because the marker can
            // arrive after the kept output has been cut off at the ceiling.
            const match = EXIT_PATTERN(marker).exec(scanTail);
            if (!match) return;
            // The marker line is bookkeeping, not output: leaving it in would let a model mistake
            // it for something the command printed. It is stripped only where it is actually
            // present, so a cut-off output keeps its own trailing bytes untouched.
            const cleaned = stdout.includes(marker) ? stdout.replace(EXIT_PATTERN(marker), "") : stdout;
            finish({
              ok: true, command, stdout: cleaned, stderr,
              exitCode: Number(match[1]), timedOut: false, confirmationRequired: false,
            });
            return;
          }
          if (frame.type === "stderr") { append("stderr", frame.data); return; }
          if (frame.type === "error") {
            finish({
              ok: false, command, stdout, stderr, exitCode: null,
              timedOut: false, confirmationRequired: false, error: frame.data,
            });
            return;
          }
          if (frame.type === "exit") {
            // The shell itself ended. Output collected so far is still reported, because it is
            // often the reason it ended.
            finish({
              ok: false, command, stdout, stderr, exitCode: frame.code,
              timedOut: false, confirmationRequired: false, error: "session_exited",
            });
          }
        },
        onError: (token) => finish({
          ok: false, command, stdout, stderr, exitCode: null,
          timedOut: false, confirmationRequired: false, error: token,
        }),
      });

      // The command and the marker are one write, so the shell can never run the marker without the
      // command it reports on.
      void sendTerminalInput(id, `${command}\nprintf '%s:%s\\n' '${marker}' "$?"\n`)
        .catch((error) => {
          finish({
            ok: false, command, stdout, stderr, exitCode: null,
            timedOut: false, confirmationRequired: false,
            error: error instanceof TerminalApiError ? error.token : "input_failed",
          });
        });
    });
  }

  /**
   * Releases the shell.
   *
   * <p>Best effort and idempotent. A session that outlived its task would hold a proot process and a
   * slot of {@code MAX_SESSIONS} until the app was killed, and the next AI task could be refused for
   * want of one.
   */
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    const id = this.id;
    this.id = null;
    if (id) await killTerminalSession(id).catch(() => undefined);
  }
}

/** Truncates to a ceiling, marking the cut so it is never mistaken for the whole output. */
function cap(value: string, max: number): string {
  return value.length <= max ? value : value.slice(0, max);
}

/** The single tool definition handed to a model. */
export const AI_TERMINAL_TOOL = {
  type: "function" as const,
  function: {
    name: "terminal",
    description:
      "Run one command in the Linux Terminal built into this Android app (Alpine, running on the " +
      "user's device, not on any server). Use it for shell work: inspecting or editing files, " +
      "running scripts, installing and building. " +
      "The working directory persists between calls, so `cd` in one call applies to the next. " +
      "Returns stdout, stderr and the exit code; a non-zero exit is normal and is not an error to " +
      "retry blindly. Output is truncated at a fixed size, so read what you need rather than " +
      "dumping a large file. Commands that destroy the system or install packages require the " +
      "user's confirmation and return confirmation_required instead of running.",
    parameters: {
      type: "object",
      properties: {
        command: {
          type: "string",
          description: "The command line to run in the app's Linux Terminal.",
        },
      },
      required: ["command"],
    },
  },
};