import { createHash } from "node:crypto";

/**
 * A comparison token for a single authenticated caller. It is deliberately
 * one-way and short: it supports diagnosing a mismatched OAuth claim without
 * exposing an openId in the UI, API response, logs, or tests.
 */
export function ownerClaimFingerprint(claim: string) {
  if (!claim) return "not-configured";
  return `sha256:${createHash("sha256").update(claim).digest("hex").slice(0, 12)}`;
}
