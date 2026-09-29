import { createHash } from "node:crypto";

/**
 * One retry policy for every upstream request, shared by the platform path and by BYOK.
 *
 * It exists because the two were answering the same situation differently: a provider answering 429
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
const RETRY_JITTER_MS = 250;

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

export type RetryDecision = { retry: boolean; delayMs: number; reason: "rate_limited" | "not_retryable" | "budget_exhausted" };

/**
 * Decides whether one more attempt is allowed, and how long to wait first.
 *
 * A rate-limited attempt is the only one that is worth repeating: an invalid key or an unknown
 * model will fail identically every time, so repeating it only spends the caller's money and
 * budget to arrive at the same answer.
 */
export function decideRetry(input: { status: number | null; retryAfterMs: number | null; attemptsUsed: number; maxAttempts: number; retryIndex: number }): RetryDecision {
  if (input.status !== 429) return { retry: false, delayMs: 0, reason: "not_retryable" };
  if (input.attemptsUsed >= input.maxAttempts) return { retry: false, delayMs: 0, reason: "budget_exhausted" };
  return { retry: true, delayMs: input.retryAfterMs ?? backoffMs(input.retryIndex), reason: "rate_limited" };
}

export type RetryRunResult<T> = { value?: T; error?: unknown; attempts: UpstreamAttempt[]; rateLimited: boolean };

/**
 * Runs `attempt` until it succeeds, the provider stops answering 429, or the shared budget runs out.
 *
 * The attempt callback receives the 1-based attempt number and must report the HTTP status it saw,
 * so this loop can tell a rate limit apart from any other failure without re-reading the body.
 */
export async function retryUpstream<T>(options: {
  /** The caller's shared budget. Every attempt, including every retry, is charged to it here. */
  maxAttempts: number;
  attemptsUsed?: number;
  run: (attempt: number) => Promise<{ ok: true; value: T } | { ok: false; status: number | null; error: unknown; retryAfterMs?: number | null }>;
  sleep?: (ms: number) => Promise<void>;
  onRetry?: (info: UpstreamAttempt & { delayMs: number }) => void;
  signal?: AbortSignal;
  /** Injected in tests; production uses the real clock. */
  now?: () => number;
}): Promise<RetryRunResult<T>> {
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const now = options.now ?? (() => Date.now());
  void now;
  const attempts: UpstreamAttempt[] = [];
  let used = options.attemptsUsed ?? 0;
  let retryIndex = 0;
  let lastError: unknown;

  while (used < options.maxAttempts) {
    if (options.signal?.aborted) break;
    used += 1;
    const attemptNumber = used;
    const outcome = await options.run(attemptNumber);
    if (outcome.ok) {
      attempts.push({ attempt: attemptNumber, status: 200, retryAfterMs: null });
      return { value: outcome.value, attempts, rateLimited: false };
    }
    lastError = outcome.error;
    const retryAfterMs = outcome.retryAfterMs ?? null;
    attempts.push({ attempt: attemptNumber, status: outcome.status, retryAfterMs });

    const decision = decideRetry({ status: outcome.status, retryAfterMs, attemptsUsed: used, maxAttempts: options.maxAttempts, retryIndex });
    if (!decision.retry) {
      // A 429 that ended because the budget ran out is still a rate limit: that is what tells the
      // caller to wait and try again, rather than to go looking for a bad key or a bad model.
      return { error: lastError, attempts, rateLimited: outcome.status === 429 };
    }
    options.onRetry?.({ attempt: attemptNumber, status: outcome.status, retryAfterMs, delayMs: decision.delayMs });
    if (decision.delayMs > 0) await sleep(decision.delayMs);
    retryIndex += 1;
  }
  return { error: lastError, attempts, rateLimited: attempts.some((attempt) => attempt.status === 429) };
}

/** Never logs the key: only a stable, non-reversible fingerprint, so support can tell two keys apart. */
export function keyFingerprint(apiKey: string): string {
  return `kf_${createHash("sha256").update(apiKey).digest("hex").slice(0, 12)}`;
}
