/**
 * One retry policy for every upstream request: the platform path, the server-side BYOK path and
 * the browser-direct path.
 *
 * It lives in `shared/` rather than in `server/` because the browser-direct path needs the same
 * decisions and cannot import a server module. A second copy of these rules in the client is how a
 * direct call ends up retrying a rejected key four times while the server path correctly refuses
 * to — the two paths then disagree about what the user sees for the identical failure.
 *
 * It exists because the paths were answering the same situation differently: a provider answering 429
 * is a rate limit on the caller's own key, and the only correct response is to wait out the window
 * the provider named and try again. Retrying without honouring `Retry-After` turns a provider's
 * own limit into a self-inflicted one, because the retry arrives while the window is still shut.
 *
 * Every retry spends the caller's own attempt budget — there is no second, private budget here, so
 * a retried request cannot quietly double the number of upstream calls a user is billed for.
 */

export type UpstreamAttempt = { attempt: number; status: number | null; retryAfterMs: number | null };

/** The first backoff, doubled each time, plus jitter so retries from many users do not align. */
export const RETRY_BASE_MS = 500;
export const RETRY_MAX_BACKOFF_MS = 4_000;
export const RETRY_JITTER_MS = 250;

/**
 * The shared ceiling on upstream calls for one user turn.
 *
 * Four is the whole budget for the turn, not a per-provider allowance: a chain of four providers
 * gets one attempt each, and a chain of one provider gets at most two (see PER_PROVIDER below).
 */
export const MAX_TOTAL_ATTEMPTS = 4;

/**
 * How many attempts one provider may spend before the chain moves on.
 *
 * Two is the point where a retry still has a chance (the first failure may be a blip) but a third
 * is not worth the latency: a provider that has throttled the key twice running will throttle the
 * third call too. Whatever is left of the shared budget goes to the next provider the user
 * connected, so the total stays bounded by MAX_TOTAL_ATTEMPTS — this caps how long any single
 * provider can hold a turn, it never adds attempts to it.
 */
export const MAX_ATTEMPTS_PER_PROVIDER = 2;

/** `Retry-After` is either a delay in seconds or an HTTP date; both mean "not before this". */
export function parseRetryAfter(header: string | null | undefined, nowMs: number = Date.now()): number | null {
  if (!header) return null;
  const raw = header.trim();
  if (!raw) return null;
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(60_000, Math.round(seconds * 1_000));
  const asDate = Date.parse(raw);
  if (Number.isNaN(asDate)) return null;
  return Math.max(0, Math.min(60_000, asDate - nowMs));
}

/** Exponential backoff from RETRY_BASE_MS, capped, with jitter that never makes the wait shorter. */
export function backoffMs(retryIndex: number, jitter: (max: number) => number = Math.random): number {
  const exponential = Math.min(RETRY_MAX_BACKOFF_MS, RETRY_BASE_MS * 2 ** retryIndex);
  return exponential + Math.round(jitter(RETRY_JITTER_MS));
}

export type RetryDecision = { retry: boolean; delayMs: number; reason: "rate_limited" | "transient" | "not_retryable" | "budget_exhausted" };

/**
 * Decides whether one more attempt is allowed, and how long to wait first.
 *
 * The caller passes the shared classification rather than a raw status, so "is this worth
 * repeating" is decided in exactly one place. A 429, a transient 5xx and a dropped connection are
 * all worth another attempt; an invalid key, an unknown model and a malformed request are not,
 * because they fail identically every time and repeating them only spends the caller's money and
 * budget to arrive at the same answer.
 *
 * `status` alone still works, so the platform path keeps its existing behaviour: a bare 429 with no
 * classification is treated as retryable exactly as before.
 */
export function decideRetry(input: { status: number | null; retryAfterMs: number | null; attemptsUsed: number; maxAttempts: number; retryIndex: number; retryable?: boolean }): RetryDecision {
  // An explicit classification wins over the status: it already accounts for a 403 that is really
  // a CORS refusal, or a 429 that is really a spent daily quota.
  const retryable = input.retryable ?? input.status === 429;
  if (!retryable) return { retry: false, delayMs: 0, reason: "not_retryable" };
  if (input.attemptsUsed >= input.maxAttempts) return { retry: false, delayMs: 0, reason: "budget_exhausted" };
  return {
    retry: true,
    delayMs: input.retryAfterMs ?? backoffMs(input.retryIndex),
    reason: input.status === 429 ? "rate_limited" : "transient",
  };
}

export type RetryRunResult<T> = {
  value?: T;
  error?: unknown;
  attempts: UpstreamAttempt[];
  /** True when the provider answered 429, i.e. this caller's key is being throttled. */
  rateLimited: boolean;
  /**
   * True when the failure is one that another of the caller's own providers might not share: a
   * throttled key, a busy provider, a dropped connection. False for a bad key or an unknown model,
   * where a second provider would reject the request identically. The BYOK chain uses this to
   * decide whether to move on rather than surfacing the failure.
   */
  fallbackEligible: boolean;
};

/**
 * Runs `attempt` until it succeeds, the provider stops answering, or the shared budget runs out.
 *
 * The attempt callback receives the 1-based attempt number and must report the HTTP status it saw
 * plus the shared classification, so this loop can tell a rate limit from a permanent rejection
 * without re-reading the body.
 */
export async function retryUpstream<T>(options: {
  /** The caller's shared budget. Every attempt, including every retry, is charged to it here. */
  maxAttempts: number;
  attemptsUsed?: number;
  run: (attempt: number) => Promise<
    | { ok: true; value: T }
    | { ok: false; status: number | null; error: unknown; retryAfterMs?: number | null; retryable?: boolean; fallbackEligible?: boolean }
  >;
  sleep?: (ms: number) => Promise<void>;
  onRetry?: (info: UpstreamAttempt & { delayMs: number }) => void;
  signal?: AbortSignal;
  /** Injected in tests; production uses the real clock. */
  now?: () => number;
}): Promise<RetryRunResult<T>> {
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const attempts: UpstreamAttempt[] = [];
  let used = options.attemptsUsed ?? 0;
  let retryIndex = 0;
  let lastError: unknown;
  let sawFallbackEligible = false;

  while (used < options.maxAttempts) {
    if (options.signal?.aborted) break;
    used += 1;
    const attemptNumber = used;
    const outcome = await options.run(attemptNumber);
    if (outcome.ok) {
      attempts.push({ attempt: attemptNumber, status: 200, retryAfterMs: null });
      return { value: outcome.value, attempts, rateLimited: false, fallbackEligible: false };
    }
    lastError = outcome.error;
    const retryAfterMs = outcome.retryAfterMs ?? null;
    attempts.push({ attempt: attemptNumber, status: outcome.status, retryAfterMs });
    // A 429 that ended because the budget ran out is still a rate limit: that is what tells the
    // caller to wait and try again, rather than to go looking for a bad key or a bad model.
    const rateLimited = outcome.status === 429;
    if (outcome.fallbackEligible ?? rateLimited) sawFallbackEligible = true;

    const decision = decideRetry({
      status: outcome.status,
      retryAfterMs,
      attemptsUsed: used,
      maxAttempts: options.maxAttempts,
      retryIndex,
      ...(outcome.retryable === undefined ? {} : { retryable: outcome.retryable }),
    });
    if (!decision.retry) {
      return { error: lastError, attempts, rateLimited, fallbackEligible: sawFallbackEligible };
    }
    options.onRetry?.({ attempt: attemptNumber, status: outcome.status, retryAfterMs, delayMs: decision.delayMs });
    if (decision.delayMs > 0) await sleep(decision.delayMs);
    retryIndex += 1;
  }
  return {
    error: lastError,
    attempts,
    rateLimited: attempts.some((attempt) => attempt.status === 429),
    fallbackEligible: sawFallbackEligible,
  };
}
