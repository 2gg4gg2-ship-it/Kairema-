import { createHash } from "node:crypto";

import { ENV } from "./_core/env";

/**
 * The one place that decides whether an authenticated account is the Kairema owner.
 *
 * Every owner route, every owner procedure and the automatic `admin` role assignment go through
 * `isOwnerAccount`. There is deliberately no second, independent way to become owner: a caller must
 * satisfy *all* of the configured claims at once, so a stale or misconfigured `OWNER_OPEN_ID` can
 * never hand the owner role to somebody else.
 *
 * Authorization is decided entirely from server-side configuration and the authenticated database
 * row. Nothing here reads a request parameter, a cookie, a client flag or anything the browser
 * supplied, and the configured owner email is never returned to a client.
 */

/** The identity claims a caller presents, all sourced from the server-side session/DB row. */
export type OwnerCandidate = {
  openId: string;
  /**
   * Optional on purpose: a row that never carried an email (an older account, or a guest) simply
   * fails to match, which is the fail-closed outcome. Making it optional also lets callers pass
   * narrower user types straight through without casting.
   */
  email?: string | null;
};

/** Case- and whitespace-insensitive form used for every email comparison. */
function normalizeEmail(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

/**
 * Whether `candidate` is the single configured owner.
 *
 * Fails closed at every step:
 * - no configured `OWNER_EMAIL` means nobody is the owner, so a deployment that forgot to set it
 *   has no owner rather than an open one;
 * - an unauthenticated or guest row carries no matching email, so it cannot qualify;
 * - when `OWNER_OPEN_ID` is also set, the openId must match *too*. If the two variables describe
 *   different accounts, no single caller can satisfy both, so the deployment resolves to no owner
 *   instead of silently preferring one of the two.
 */
export function isOwnerAccount(candidate: OwnerCandidate | null | undefined): boolean {
  if (!candidate) return false;

  // The email claim is authoritative and mandatory: it alone never authorises, and without it
  // there is no owner at all. This guard is checked before the comparison on purpose — an account
  // whose own email is empty would otherwise normalise to the same value as an unset configuration.
  const ownerEmail = normalizeEmail(ENV.ownerEmail);
  if (!ownerEmail) return false;
  if (normalizeEmail(candidate.email) !== ownerEmail) return false;

  // Backward compatibility only: `OWNER_OPEN_ID` may still be set, but it can no longer introduce a
  // different owner. It narrows the match to the same account instead of widening it.
  const ownerOpenId = (ENV.ownerOpenId ?? "").trim();
  if (ownerOpenId && candidate.openId !== ownerOpenId) return false;

  return true;
}

/**
 * A one-way, short fingerprint of a claim, for the diagnostic that helps an operator tell
 * "not configured" apart from "configured but this is a different account". It never exposes an
 * email or an openId: it is a truncated SHA-256.
 */
export function ownerClaimFingerprint(value: string | null | undefined): string {
  const normalized = (value ?? "").trim();
  if (!normalized) return "not-configured";
  return `sha256:${createHash("sha256").update(normalized.toLowerCase()).digest("hex").slice(0, 12)}`;
}

/** Whether an owner identity is configured at all, without disclosing it. */
export function isOwnerConfigured(): boolean {
  return normalizeEmail(ENV.ownerEmail).length > 0;
}
