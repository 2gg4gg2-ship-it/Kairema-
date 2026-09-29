/**
 * One My API turn, across every provider the user connected, from the page.
 *
 * The point of this module is that the execution mode is *decided once, by the capability
 * registry*, and that a direct turn and a server turn spend the same attempt budget. Two things
 * go wrong without it:
 *
 * - A provider's key is read from the in-memory store and attached to that provider's own request,
 *   or not at all. A direct key never travels to the Kairema server, not even to be "just
 *   checked", because the moment it does, it is no longer a direct key.
 * - A direct failure is handed to the next provider rather than being retried forever, and the
 *   handover tells the server which providers were already tried so the same failure is not
 *   reproduced on the far side.
 *
 * There is no polling and no background loop. When nothing is available the turn ends, the caller
 * is told why, and the user restores the flow by an action they take themselves.
 */

import { MAX_ATTEMPTS_PER_PROVIDER, MAX_TOTAL_ATTEMPTS, retryUpstream, type RetryRunResult } from "@shared/upstream-retry";
import { resolveExecution } from "@shared/provider-capabilities";
import { classifyProviderFailure, KAIREMA_RATE_LIMIT, type ProviderFailure } from "@shared/provider-failures";
import { runDirectChat, DirectProviderError } from "./direct-provider";
import { getDirectKey } from "./direct-key-store";
import { consumeChatStream, type StreamDonePayload } from "./chat-stream";
import { runtimeAuthHeaders } from "./runtime-auth";

/** One connected provider, exactly as the user configured it. Nothing is shared between entries. */
export type TurnCandidate = {
  provider: string;
  displayName: string;
  model: string;
  /** Present only for a provider served by the server from its encrypted store. */
  hasStoredCredential: boolean;
};

export type DirectTurnRequest = {
  sessionId: string;
  content: string;
  modelId: string;
  settings: Record<string, unknown>;
  attachmentIds?: string[];
  clientMessageId: string;
  /** The provider the user has selected, first in the chain. */
  primary: TurnCandidate;
  /** The user's other connected providers, in their saved order. Never a Kairema provider. */
  others: readonly TurnCandidate[];
  /** Set when the user has asked for provider calls to run from the page. */
  preferDirect: boolean;
  onDelta: (delta: string) => void;
  signal?: AbortSignal;
  /** Called when the chain moves on, so the UI can say so without a blocking overlay. */
  onProviderSwitch?: (info: { from: TurnCandidate; to: TurnCandidate }) => void;
  sleep?: (ms: number) => Promise<void>;
  fetchImpl?: typeof fetch;
};

export type DirectTurnResult = {
  content: string;
  model: string;
  label: string;
  providerId: string;
  execution: "direct" | "server";
  attempts: number;
};

/**
 * Orders the user's connected providers into a chain, with the one they selected first.
 *
 * The order is a correctness property, not a convenience: a chain that could answer from a
 * provider the user did not pick would be billing them for a model they did not choose. The
 * provider that is not first here is the fallback, so every entry after the first is one the user
 * connected themselves and would accept as a substitute.
 */
export function buildCandidateChain(
  configs: ReadonlyArray<{ provider: string; displayName?: string | null; activeModel: string | null }>,
  activeProvider: string | null,
): TurnCandidate[] {
  if (!activeProvider) return [];
  const unique: TurnCandidate[] = [];
  for (const config of configs) {
    if (!config || !config.activeModel) continue;
    // One entry per provider: a duplicate row would spend the shared budget twice on the same
    // upstream and could report a fallback that is not one.
    if (unique.some((entry) => entry.provider === config.provider)) continue;
    unique.push({ provider: config.provider, displayName: config.displayName || config.provider, model: config.activeModel, hasStoredCredential: true });
  }
  const selectedIndex = unique.findIndex((candidate) => candidate.provider === activeProvider);
  if (selectedIndex <= 0) return unique;
  return [unique[selectedIndex]!, ...unique.slice(0, selectedIndex), ...unique.slice(selectedIndex + 1)];
}

export class ProviderUnavailableError extends Error {
  constructor(public readonly failure: ProviderFailure, public readonly hasFallback: boolean) {
    super(failure.message);
    this.name = "ProviderUnavailableError";
  }
}

function failureOf(error: unknown): ProviderFailure {
  if (error instanceof DirectProviderError) return error.failure;
  if (error instanceof Error) return classifyProviderFailure({ http: null, body: error.message });
  return classifyProviderFailure({ http: null, body: "unknown" });
}

/** The request body a server-side turn needs. It never carries a key. */
function serverBody(request: DirectTurnRequest, skipProviders: string[]) {
  return JSON.stringify({
    sessionId: request.sessionId,
    modelId: request.modelId,
    content: request.content,
    myApi: true,
    clientMessageId: request.clientMessageId,
    settings: request.settings,
    attachmentIds: request.attachmentIds,
    skipProviders,
  });
}

/**
 * Runs one turn, moving down the user's own providers until one answers.
 *
 * The budget is shared and finite: four upstream calls for the whole turn and never more than two
 * for any one provider. Every retry is charged to it, so "retry then fall back" cannot become
 * "four attempts here and four there". A Kairema provider is never in the candidate list, so a
 * failed BYOK turn surfaces as a failure instead of being answered by the platform on the user's
 * behalf.
 */
export async function runMyApiTurn(request: DirectTurnRequest): Promise<DirectTurnResult> {
  const doFetch = request.fetchImpl ?? fetch;
  const chain: TurnCandidate[] = [request.primary, ...request.others];
  const tried: string[] = [];
  let attemptsSpent = 0;
  let lastFailure: ProviderFailure = classifyProviderFailure({ http: null, body: "no provider available" });

  for (const [index, candidate] of Array.from(chain.entries())) {
    const isLast = index === chain.length - 1;
    const { mode } = resolveExecution(candidate.provider, { preferDirect: request.preferDirect });
    // A direct candidate needs its key in this tab's memory. Without one it cannot be tried here;
    // if the server holds its credential the same provider is still reachable through it.
    const directKey = mode === "direct" ? getDirectKey(candidate.provider) : null;
    if (mode === "direct" && !directKey) {
      lastFailure = classifyProviderFailure({ http: 401, body: "no direct key in memory" });
      tried.push(candidate.provider);
      continue;
    }
    if (mode === "server" && !candidate.hasStoredCredential) {
      lastFailure = classifyProviderFailure({ http: 401, body: "no stored credential" });
      tried.push(candidate.provider);
      continue;
    }

    const remaining = MAX_TOTAL_ATTEMPTS - attemptsSpent;
    if (remaining <= 0) break;
    // Two attempts for this provider, or whatever is left of the shared budget, whichever is less.
    const budgetForCandidate = Math.min(MAX_ATTEMPTS_PER_PROVIDER, remaining);
    if (index > 0) request.onProviderSwitch?.({ from: chain[index - 1]!, to: candidate });

    const history: { role: "user" | "assistant"; content: string }[] = [{ role: "user", content: request.content }];
    const outcome: RetryRunResult<DirectTurnResult> = await retryUpstream<DirectTurnResult>({
      maxAttempts: budgetForCandidate,
      attemptsUsed: 0,
      ...(request.sleep ? { sleep: request.sleep } : {}),
      ...(request.signal ? { signal: request.signal } : {}),
      run: async () => {
        attemptsSpent += 1;
        try {
          if (mode === "direct") {
            const result = await runDirectChat({
              providerId: candidate.provider,
              model: candidate.model,
              messages: history,
              onDelta: request.onDelta,
              ...(request.signal ? { signal: request.signal } : {}),
              ...(doFetch !== fetch ? { fetchImpl: doFetch } : {}),
            });
            return { ok: true as const, value: { content: result.content, model: result.model, label: candidate.displayName, providerId: candidate.provider, execution: "direct" as const, attempts: attemptsSpent } };
          }
          const response = await doFetch("/api/chat/stream", {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json", Accept: "text/event-stream", ...runtimeAuthHeaders() },
            body: serverBody(request, tried),
            ...(request.signal ? { signal: request.signal } : {}),
          });
          if (!response.ok || !response.body) {
            const detail = await response.text().catch(() => "");
            throw new DirectProviderError(kairemaRateLimitedResponse(response, detail));
          }
          let done: StreamDonePayload = {};
          await consumeChatStream(response, { onDelta: request.onDelta, onDone: (payload) => { done = payload; } });
          return { ok: true as const, value: { content: typeof done.content === "string" ? done.content : "", model: typeof done.modelUsed === "string" ? done.modelUsed : candidate.model, label: candidate.displayName, providerId: candidate.provider, execution: "server" as const, attempts: attemptsSpent } };
        } catch (error) {
          const failure = failureOf(error);
          tried.push(candidate.provider);
          return {
            ok: false as const,
            status: failure.http,
            error,
            // The provider's own window, when it named one. This is the only place a direct
            // failure can supply it, and dropping it would retry inside a limit still shut.
            retryAfterMs: failure.retryAfterMs ?? null,
            // The same shared classification decides both "retry" and "move on", so the two can
            // never disagree: a rejected key is not retried here and is not offered elsewhere.
            retryable: failure.retryable,
            fallbackEligible: failure.retryable,
          };
        }
      },
    });

    if (outcome.value) return outcome.value;
    lastFailure = failureOf(outcome.error);
    // A configuration failure — a rejected key, an unknown model — would be rejected identically
    // by the user's other providers, so the turn ends here instead of being retried against them.
    // This applies to every position in the chain, not only the last: handing a rejected key to
    // the next provider spends that provider's attempts to arrive at the same answer.
    if (!outcome.fallbackEligible) break;
    void isLast;
  }

  throw new ProviderUnavailableError(lastFailure, chain.some((candidate) => !tried.includes(candidate.provider)));
}

/**
 * Kairema's own My API budget is a different thing from an upstream 429, and conflating them tells
 * a user whose provider is throttling them to wait out a limit they never reached.
 */
function kairemaRateLimitedResponse(response: Response, detail: string): ProviderFailure {
  if (response.status === 429) {
    let flagged = false;
    try { flagged = Boolean((JSON.parse(detail) as { myApiRateLimited?: boolean }).myApiRateLimited); } catch { flagged = false; }
    if (flagged) return classifyProviderFailure({ http: 429, body: detail, kairemaRateLimited: true });
  }
  return classifyProviderFailure({ http: response.status, body: detail });
}

export { KAIREMA_RATE_LIMIT };
