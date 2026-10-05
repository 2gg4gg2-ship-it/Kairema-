/**
 * The agent loop: a model, the on-device terminal, and the turns between them.
 *
 * <p>This is a loop in the page, not on the server, and that placement is the whole design. The
 * terminal only exists at `127.0.0.1` inside the app process, so a server-driven tool call could not
 * reach it however the transport were arranged. Running the loop here keeps three things on the
 * device that must not leave it: the command text, its output, and the user's provider key.
 *
 * <p>The loop is deliberately small and finite. A model may call the terminal up to
 * {@link AI_TERMINAL_LIMITS.maxRounds} times and the terminal up to
 * {@link AI_TERMINAL_LIMITS.maxCallsPerTask} times; either ceiling ends the loop and the model
 * answers with whatever it has. A loop with no ceiling is a way for one turn to hold a phone awake
 * indefinitely, and that is the failure mode this design exists to avoid.
 *
 * <p>A failed command is not a failed turn. Stderr and the exit code go back to the model as an
 * ordinary tool result, and the model decides whether to retry, try something else, or explain. Only
 * a refusal to start the loop at all — no direct provider, no terminal, no key — throws.
 */

import { classifyProviderFailure } from "@shared/provider-failures";
import { resolveExecution } from "@shared/provider-capabilities";
import { DirectProviderError, directChatEndpoint, directHeaders } from "./direct-provider";
import { directKeyFor } from "./direct-key-store";
import {
  AI_TERMINAL_LIMITS,
  AI_TERMINAL_TOOL,
  AiTerminalSession,
  evaluateConfirmation,
  isAiTerminalAvailable,
  type TerminalToolResult,
} from "./ai-terminal-tool";

/** A tool call as a model requests it. */
type RequestedToolCall = { id: string; name: string; arguments: string };

/**
 * One message in the loop's private conversation.
 *
 * <p>Tool results ride as `tool` messages, which is why this is a separate type from the
 * `user | assistant` union the direct chat path uses: that union has nowhere to put them.
 */
type LoopMessage =
  | { role: "system" | "user" | "assistant"; content: string }
  | { role: "tool"; tool_call_id: string; name: string; content: string }
  | { role: "assistant"; content: string | null; tool_calls: RequestedToolCall[] };

/** What the UI shows while a command runs, and afterwards. */
export type TerminalExecutionStep = {
  id: string;
  command: string;
  status: "running" | "success" | "error" | "confirmation";
  /** Short preview; the full output stays in the tool result and is revealed on demand. */
  preview: string;
  exitCode: number | null;
  timedOut: boolean;
};

export type ToolLoopRequest = {
  providerId: string;
  model: string;
  /** The user's question, as one user message. */
  content: string;
  /** System instructions for this turn. */
  systemPrompt: string;
  onDelta: (delta: string) => void;
  /** Called as each command starts and settles, so the chat can render an execution card. */
  onExecution?: (step: TerminalExecutionStep) => void;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
};

export type ToolLoopResult = {
  content: string;
  steps: TerminalExecutionStep[];
};

export class TerminalToolUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TerminalToolUnavailableError";
  }
}

/**
 * What the model is told about the sandbox before its first command.
 *
 * <p>Kept here rather than in the chat settings because it describes the tool, not the user's
 * preferences: the model has to know the working directory persists and that a non-zero exit is
 * information rather than an instruction to stop, or it will either lose its place or loop on a
 * failing command.
 */
export function aiTerminalSystemPrompt(providerLabel: string): string {
  return [
    `Ты работаешь в приложении Kairema на Android (провайдер: ${providerLabel}).`,
    "У тебя есть инструмент run_shell_command — он выполняет команду в Linux-песочнице (Alpine) на устройстве пользователя.",
    "Текущая рабочая директория сохраняется между вызовами, поэтому cd в одной команде влияет на следующую.",
    "Инструмент возвращает stdout, stderr и exit code. Ненулевой exit code — это результат, а не ошибка: прочитай stderr и реши сам, что делать дальше.",
    "Работай короткими командами и проверяй результат. Не повторяй одну и ту же команду без изменений.",
  ].join(" ");
}

/**
 * Whether this turn may run the terminal loop.
 *
 * <p>Three conditions, all required: an Android build (nothing is behind the loopback on web), a
 * provider the capability registry allows to be called from the page, and that provider's key
 * actually in this tab's memory. Callers use this to decide whether to advertise the tool at all, so
 * a model is never offered something that cannot run.
 */
export function terminalToolReady(providerId: string): boolean {
  if (!isAiTerminalAvailable()) return false;
  if (resolveExecution(providerId, { preferDirect: true }).mode !== "direct") return false;
  return Boolean(directKeyFor(providerId));
}

/** Serialises a tool result for the model. Only the fields the tool defines are included. */
function toolResultContent(result: TerminalToolResult): string {
  return JSON.stringify({
    ok: result.ok,
    command: result.command,
    stdout: result.stdout,
    stderr: result.stderr,
    exitCode: result.exitCode,
    timedOut: result.timedOut,
    confirmationRequired: result.confirmationRequired,
    ...(result.error ? { error: result.error } : {}),
    ...(result.truncated ? { truncated: true } : {}),
  });
}

/**
 * Runs one completion round and returns either text or tool calls.
 *
 * <p>Not streamed: a tool call is a structured object in the body, and streaming it would mean
 * reassembling fragments that some providers emit and others do not. Only the final answering round
 * streams, which is where the user is actually watching.
 */
async function completionRound(input: {
  providerId: string;
  model: string;
  messages: LoopMessage[];
  tools: unknown[] | null;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
}): Promise<{ content: string; toolCalls: RequestedToolCall[] }> {
  const doFetch = input.fetchImpl ?? fetch;
  const endpoint = directChatEndpoint(input.providerId);
  const key = directKeyFor(input.providerId);
  if (!key) throw new DirectProviderError(classifyProviderFailure({ http: 401, body: "no direct key in memory" }));

  const body: Record<string, unknown> = { model: input.model, messages: input.messages, stream: false };
  if (input.tools) body.tools = input.tools;

  let response: Response;
  try {
    response = await doFetch(endpoint, {
      method: "POST",
      headers: directHeaders(input.providerId, key, false),
      body: JSON.stringify(body),
      ...(input.signal ? { signal: input.signal } : {}),
    });
  } catch (error) {
    const cors = /failed to fetch|networkerror|load failed/i.test(error instanceof Error ? error.message : String(error));
    throw new DirectProviderError(classifyProviderFailure({ http: null, body: String(error), cors }));
  }
  if (!response.ok) {
    throw new DirectProviderError(classifyProviderFailure({ http: response.status, body: response.statusText }));
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new DirectProviderError(classifyProviderFailure({ http: response.status, body: "unparseable body" }));
  }

  const message = (payload as { choices?: { message?: Record<string, unknown> }[] })?.choices?.[0]?.message;
  const content = typeof message?.content === "string" ? message.content : "";
  const rawCalls = Array.isArray(message?.tool_calls) ? message.tool_calls : [];
  const toolCalls: RequestedToolCall[] = rawCalls.flatMap((entry) => {
    const call = entry as { id?: unknown; function?: { name?: unknown; arguments?: unknown } };
    const name = call?.function?.name;
    if (typeof name !== "string") return [];
    return [{
      id: typeof call.id === "string" ? call.id : name,
      name,
      arguments: typeof call.function?.arguments === "string" ? call.function.arguments : "{}",
    }];
  });
  return { content, toolCalls };
}

/** Reads the `command` argument, tolerating a malformed arguments payload. */
function commandArgument(raw: string): string {
  try {
    const parsed = JSON.parse(raw) as { command?: unknown };
    return typeof parsed.command === "string" ? parsed.command : "";
  } catch {
    return "";
  }
}

function previewOf(result: TerminalToolResult): string {
  const first = (result.stdout || result.stderr).trim().split("\n").find((line) => line.trim().length > 0);
  return first ? first.slice(0, 120) : "";
}

/**
 * Runs the loop to a final answer.
 *
 * <p>The session is opened only once the model has actually asked for a command, and released in a
 * `finally` so a rejected confirmation, a provider failure or an abort all leave the device as they
 * were. Deltas are passed through only from the final answering round, so the transcript does not
 * accumulate the model's intermediate "let me look at that" turns.
 */
export async function runTerminalToolLoop(request: ToolLoopRequest): Promise<ToolLoopResult> {
  if (!isAiTerminalAvailable()) {
    throw new TerminalToolUnavailableError("Терминал доступен только в приложении на Android.");
  }
  if (!terminalToolReady(request.providerId)) {
    throw new TerminalToolUnavailableError("Провайдер не поддерживает запуск с устройства.");
  }

  const messages: LoopMessage[] = [
    { role: "system", content: request.systemPrompt },
    { role: "user", content: request.content },
  ];
  const session = new AiTerminalSession();
  const steps: TerminalExecutionStep[] = [];

  try {
    for (let round = 0; round < AI_TERMINAL_LIMITS.maxRounds; round += 1) {
      const lastRound = round === AI_TERMINAL_LIMITS.maxRounds - 1;
      const outcome = await completionRound({
        providerId: request.providerId,
        model: request.model,
        messages,
        // Tools are withheld on the final round so the turn ends with an answer instead of one more
        // command request the loop would refuse to honour.
        tools: lastRound ? null : [AI_TERMINAL_TOOL],
        ...(request.signal ? { signal: request.signal } : {}),
        ...(request.fetchImpl ? { fetchImpl: request.fetchImpl } : {}),
      });

      if (outcome.toolCalls.length === 0) {
        if (outcome.content) request.onDelta(outcome.content);
        return { content: outcome.content, steps };
      }

      messages.push({ role: "assistant", content: outcome.content || null, tool_calls: outcome.toolCalls });

      for (const call of outcome.toolCalls) {
        const result = await executeToolCall(session, call, steps, request);
        messages.push({ role: "tool", tool_call_id: call.id, name: call.name, content: toolResultContent(result) });
        if (request.signal?.aborted) break;
      }
      if (request.signal?.aborted) break;
    }

    // The budget is spent. One final call with no tools turns "ran out of rounds" into an answer the
    // user can read instead of a silent stop.
    const final = await completionRound({
      providerId: request.providerId,
      model: request.model,
      messages,
      tools: null,
      ...(request.signal ? { signal: request.signal } : {}),
      ...(request.fetchImpl ? { fetchImpl: request.fetchImpl } : {}),
    });
    const content = final.content
      || "Достигнут лимит запуска команд. Ниже — результаты выполненных команд.";
    request.onDelta(content);
    return { content, steps };
  } finally {
    await session.close();
  }
}

/**
 * Runs one requested call and reports it to the UI.
 *
 * <p>A confirmation is checked here, before the session is touched, so a refused command costs
 * nothing and leaves no trace on the device. The result is returned rather than thrown even when it
 * failed: the model is expected to read it and continue, and an exception here would abandon the
 * whole turn over one bad command.
 */
async function executeToolCall(
  session: AiTerminalSession,
  call: RequestedToolCall,
  steps: TerminalExecutionStep[],
  request: ToolLoopRequest,
): Promise<TerminalToolResult> {
  if (call.name !== AI_TERMINAL_TOOL.function.name) {
    // An unknown tool is answered rather than ignored: silence would let the model wait for a result
    // that is never coming.
    return {
      ok: false, command: "", stdout: "", stderr: "", exitCode: null,
      timedOut: false, confirmationRequired: false, error: "unknown_tool",
    };
  }

  const command = commandArgument(call.arguments);
  const decision = evaluateConfirmation(command);
  const step: TerminalExecutionStep = {
    id: call.id,
    command,
    status: "running",
    preview: "",
    exitCode: null,
    timedOut: false,
  };

  if (decision.required) {
    step.status = "confirmation";
    steps.push(step);
    request.onExecution?.(step);
    return {
      ok: false,
      command,
      stdout: "",
      stderr: "",
      exitCode: null,
      timedOut: false,
      confirmationRequired: true,
      error: `confirmation_required:${decision.reason}`,
    };
  }

  steps.push(step);
  request.onExecution?.(step);

  let result: TerminalToolResult;
  try {
    result = await session.run(command);
  } catch (error) {
    // The session reports failures as results, so reaching here means the bridge itself broke.
    result = {
      ok: false, command, stdout: "", stderr: "", exitCode: null,
      timedOut: false, confirmationRequired: false,
      error: error instanceof Error ? "tool_failed" : "tool_failed",
    };
  }

  step.status = result.ok ? "success" : "error";
  step.preview = previewOf(result);
  step.exitCode = result.exitCode;
  step.timedOut = result.timedOut;
  request.onExecution?.(step);
  return result;
}