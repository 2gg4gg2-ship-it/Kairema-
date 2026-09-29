import { createHash } from "node:crypto";

/**
 * Server-side entry point for the shared retry policy.
 *
 * The rules themselves live in `shared/upstream-retry.ts` so the browser-direct path can use the
 * identical policy. This module re-exports them and adds the one thing that genuinely cannot be
 * shared: `keyFingerprint` needs `node:crypto`, which the browser build does not have. Keeping the
 * decision logic in one place and only the hashing here is what stops the two paths from drifting
 * into disagreeing about whether the same failure is worth retrying.
 *
 * Every retry spends the caller's own attempt budget — there is no second, private budget here, so
 * a retried request cannot quietly double the number of upstream calls a user is billed for.
 */

export {
  backoffMs,
  decideRetry,
  parseRetryAfter,
  retryUpstream,
  MAX_ATTEMPTS_PER_PROVIDER,
  MAX_TOTAL_ATTEMPTS,
  RETRY_BASE_MS,
  RETRY_JITTER_MS,
  RETRY_MAX_BACKOFF_MS,
  type RetryDecision,
  type RetryRunResult,
  type UpstreamAttempt,
} from "@shared/upstream-retry";

/** Never logs the key: only a stable, non-reversible fingerprint, so support can tell two keys apart. */
export function keyFingerprint(apiKey: string): string {
  return `kf_${createHash("sha256").update(apiKey).digest("hex").slice(0, 12)}`;
}
