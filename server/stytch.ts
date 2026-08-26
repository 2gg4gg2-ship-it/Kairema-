import { createHash } from "node:crypto";
import { parse as parseCookieHeader } from "cookie";
import Stytch, { StytchError } from "stytch";
import type { Request, Response } from "express";
import { getSessionCookieOptions } from "./_core/cookies";

export const STYTCH_PROVIDER = "stytch";
export const STYTCH_SESSION_COOKIE = "__Host-kairema-stytch-session";
export const STYTCH_RESET_COOKIE = "__Host-kairema-stytch-reset";
export const STYTCH_LINK_INTENT_COOKIE = "__Host-kairema-stytch-link-intent";
export const STYTCH_SESSION_DURATION_MINUTES = 10_080; // provider-managed seven-day maximum
const STYTCH_SESSION_MAX_AGE_MS = STYTCH_SESSION_DURATION_MINUTES * 60_000;
const STYTCH_RESET_MAX_AGE_MS = 30 * 60_000;
const STYTCH_LINK_INTENT_MAX_AGE_MS = 10 * 60_000;

export class StytchProviderError extends Error {
  constructor(public readonly safeCode: "UNAVAILABLE" | "INVALID" | "EXPIRED") {
    super(safeCode);
  }
}

/**
 * Fixed internal categories for metadata-only delivery observability. These
 * labels are intentionally Kairema-owned abstractions: no Stytch request ID,
 * raw error type/message/details, email, link or token may be persisted.
 */
export type StytchDeliveryFailureCode =
  | "ADDRESS_INVALID"
  | "ADDRESS_INACTIVE"
  | "CALLBACK_URL_REJECTED"
  | "REQUEST_REJECTED"
  | "PROVIDER_UNAVAILABLE"
  | "UNKNOWN";

export function getSafeStytchDeliveryFailure(error: unknown): StytchDeliveryFailureCode {
  if (error instanceof StytchError) {
    // Map only documented delivery-relevant values into fixed local labels.
    if (error.error_type === "invalid_email") return "ADDRESS_INVALID";
    if (error.error_type === "inactive_email") return "ADDRESS_INACTIVE";
    if (error.error_type === "no_match_for_provided_magic_link_url") return "CALLBACK_URL_REJECTED";
    if (error.status_code === 408 || error.status_code >= 500) return "PROVIDER_UNAVAILABLE";
    if (error.status_code >= 400 && error.status_code < 500) return "REQUEST_REJECTED";
    return "UNKNOWN";
  }
  // Preserve the existing authentication contract: SDK RequestError and other
  // transport/client failures normalize to UNAVAILABLE rather than producing a
  // generic anti-enumeration delivery response.
  return toSafeStytchError(error).safeCode === "UNAVAILABLE"
    ? "PROVIDER_UNAVAILABLE"
    : "UNKNOWN";
}

function requiredEnv(name: "STYTCH_PROJECT_ID" | "STYTCH_SECRET" | "STYTCH_ENVIRONMENT") {
  const value = process.env[name]?.trim();
  if (!value) throw new StytchProviderError("UNAVAILABLE");
  return value;
}

/**
 * The secure form stores Stytch project environments as `test-*` or `live-*`.
 * The official SDK accepts base URLs, not project-scoped labels: passing
 * `test-foo` directly turns it into an invalid custom base URL.
 */
export function stytchSdkEnvironment(environment: string) {
  if (environment === "test" || environment.startsWith("test-")) return "https://test.stytch.com/";
  if (environment === "live" || environment.startsWith("live-")) return "https://api.stytch.com/";
  throw new StytchProviderError("UNAVAILABLE");
}

/** Server-only official SDK client. Credentials never reach the client bundle. */
export function getStytchClient() {
  return new Stytch.Client({
    project_id: requiredEnv("STYTCH_PROJECT_ID"),
    secret: requiredEnv("STYTCH_SECRET"),
    env: stytchSdkEnvironment(requiredEnv("STYTCH_ENVIRONMENT")),
  });
}

export function stytchCanonicalOpenId(providerSubject: string) {
  // `users.openId` has a 64-character limit. This opaque stable identifier is
  // never derived from email and does not replace the provider-subject mapping.
  const digest = createHash("sha256").update(providerSubject).digest("base64url").slice(0, 48);
  return `stytch_${digest}`;
}

/** A validated server-only origin; email callback targets never use request headers. */
export function getStytchCallbackUrl() {
  const rawBaseUrl = process.env.STYTCH_CALLBACK_BASE_URL?.trim();
  if (!rawBaseUrl) throw new StytchProviderError("UNAVAILABLE");
  let baseUrl: URL;
  try {
    baseUrl = new URL(rawBaseUrl);
  } catch {
    throw new StytchProviderError("UNAVAILABLE");
  }
  if (baseUrl.protocol !== "https:" || baseUrl.pathname !== "/" || baseUrl.search || baseUrl.hash) {
    throw new StytchProviderError("UNAVAILABLE");
  }
  return new URL("/api/stytch/callback", baseUrl).toString();
}

export function getVerifiedStytchEmail(user: { emails: readonly { email: string; verified: boolean }[] }) {
  return user.emails.find(email => email.verified)?.email ?? null;
}

export function setStytchSessionCookie(res: Response, req: Request, sessionToken: string) {
  res.cookie(STYTCH_SESSION_COOKIE, sessionToken, {
    ...getSessionCookieOptions(req),
    maxAge: STYTCH_SESSION_MAX_AGE_MS,
  });
}

export function clearStytchSessionCookie(res: Response, req: Request) {
  res.clearCookie(STYTCH_SESSION_COOKIE, {
    ...getSessionCookieOptions(req),
    maxAge: -1,
  });
}

/**
 * This holds only the opaque, one-time token issued by Stytch between the
 * provider redirect and reset completion. Kairema does not mint, persist, or
 * interpret reset tokens.
 */
export function setStytchResetCookie(res: Response, req: Request, resetToken: string) {
  res.cookie(STYTCH_RESET_COOKIE, resetToken, {
    ...getSessionCookieOptions(req),
    maxAge: STYTCH_RESET_MAX_AGE_MS,
  });
}

export function clearStytchResetCookie(res: Response, req: Request) {
  res.clearCookie(STYTCH_RESET_COOKIE, {
    ...getSessionCookieOptions(req),
    maxAge: -1,
  });
}

/** A short-lived opaque reference; canonical user binding remains server-side. */
export function setStytchLinkIntentCookie(res: Response, req: Request, reference: string) {
  res.cookie(STYTCH_LINK_INTENT_COOKIE, reference, {
    ...getSessionCookieOptions(req),
    maxAge: STYTCH_LINK_INTENT_MAX_AGE_MS,
  });
}

export function clearStytchLinkIntentCookie(res: Response, req: Request) {
  res.clearCookie(STYTCH_LINK_INTENT_COOKIE, {
    ...getSessionCookieOptions(req),
    maxAge: -1,
  });
}

export function getStytchSessionToken(req: Request) {
  return parseCookieHeader(req.headers.cookie ?? "")[STYTCH_SESSION_COOKIE];
}

export function getStytchResetToken(req: Request) {
  return parseCookieHeader(req.headers.cookie ?? "")[STYTCH_RESET_COOKIE];
}

export function getStytchLinkIntent(req: Request) {
  const reference = parseCookieHeader(req.headers.cookie ?? "")[STYTCH_LINK_INTENT_COOKIE];
  return reference && reference.length <= 128 ? reference : null;
}

export async function authenticateStytchRequest(req: Request) {
  const sessionToken = getStytchSessionToken(req);
  if (!sessionToken) return null;

  try {
    // A provider-issued opaque token is remote-verified by Stytch for every
    // server request. Kairema never mints or parses a local session token.
    const response = await getStytchClient().sessions.authenticate({ session_token: sessionToken });
    return { user: response.user, sessionToken };
  } catch (error) {
    throw toSafeStytchError(error);
  }
}

export async function revokeStytchSessionToken(sessionToken: string | undefined) {
  if (!sessionToken) return;
  try {
    await getStytchClient().sessions.revoke({ session_token: sessionToken });
  } catch {
    // Logout is best-effort at the provider. The browser cookie is always
    // cleared by the caller, and raw provider errors/tokens are never logged.
  }
}

export function toSafeStytchError(error: unknown): StytchProviderError {
  if (error instanceof StytchError) {
    if (error.status_code === 401 || error.status_code === 404) {
      return new StytchProviderError("INVALID");
    }
    if (error.status_code === 408 || error.status_code >= 500) {
      return new StytchProviderError("UNAVAILABLE");
    }
    return new StytchProviderError("INVALID");
  }
  return error instanceof StytchProviderError ? error : new StytchProviderError("UNAVAILABLE");
}
