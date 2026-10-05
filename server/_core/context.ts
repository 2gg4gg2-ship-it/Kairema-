import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import type { Request } from "express";
import type { User } from "../../drizzle/schema";
import { StytchError } from "stytch";
import * as db from "../db";
import { authenticateStytchRequest, getVerifiedStytchEmail, STYTCH_PROVIDER, stytchCanonicalOpenId } from "../stytch";
import { sdk } from "./sdk";

export type TrpcContext = {
  req: CreateExpressContextOptions["req"];
  res: CreateExpressContextOptions["res"];
  user: User | null;
  isGuest: boolean;
};

/**
 * The single identity resolver for every inbound request (tRPC and raw routes).
 *
 * Priority is permanent-first. `sdk.authenticateRequest` returns a guest row
 * without throwing whenever a guest cookie is present, so the Stytch fallback
 * used to be skipped entirely and the guest shadowed the canonical user:
 * `auth.me` reported `email: null`, and every protected procedure
 * (settings.get/update, auth.beginLink) rejected the caller as a guest.
 *
 * A permanent Manus/OAuth user is still returned before any Stytch round-trip,
 * and guest/anonymous access is unchanged when no verified Stytch session
 * exists. `resolveOrCreateProviderUser` still returns the existing canonical
 * user for a known provider subject, so no second user row is created.
 */

let resolveSequence = 0;

/**
 * Per-request correlation id for the identity-resolution timeline.
 *
 * Diagnostic only. It exists because every branch of `resolveRequestUser` swallows its
 * errors into "not authenticated", so a request that stalls here produces no output at
 * all and cannot be attributed to a step. The id carries no secret, so it survives
 * redaction and is easy to spot in a Render log tail. See `stytch.ts` for the separate
 * id written around the provider call, and for how the two are matched up.
 */
function newResolveCorrId(): string {
  resolveSequence += 1;
  return `r${resolveSequence.toString(16)}`;
}

/** Milliseconds since `startedAtMs`, never negative and never a wall-clock reading. */
function elapsedMs(startedAtMs: number): number {
  return Math.max(0, Date.now() - startedAtMs);
}

export async function resolveRequestUser(opts: { req: Request }): Promise<User | null> {
  const corr = newResolveCorrId();
  const startedAtMs = Date.now();
  // Only the id, the phase name and elapsed time are recorded. No cookie value, no header,
  // no request or response body and no identifier derived from either ever reaches this log.
  const diag = (phase: string, fields: Record<string, string | number | boolean>) => {
    const parts = [`[auth-resolve]`, `corr=${corr}`, `phase=${phase}`, `elapsedMs=${elapsedMs(startedAtMs)}`];
    for (const [key, value] of Object.entries(fields)) parts.push(`${key}=${String(value)}`);
    console.log(parts.join("; "));
  };

  let baseUser: User | null = null;

  diag("resolve_start", {});
  try {
    // Preserve existing Manus OAuth precedence when both verified cookies are
    // present. The Stytch path is a fallback, not a replacement for OAuth.
    baseUser = await sdk.authenticateRequest(opts.req);
    diag("sdk_authenticate_returned", {
      userPresent: Boolean(baseUser),
      isGuest: baseUser?.isGuest === 1,
    });
  } catch {
    baseUser = null;
    diag("sdk_authenticate_failed", { userPresent: false });
  }

  // A guest cookie is not final authentication. When Manus already produced a
  // permanent user, keep it and skip the provider round-trip entirely.
  if (baseUser && baseUser.isGuest !== 1) {
    diag("resolve_done", { userPresent: true, isGuest: false, via: "sdk_permanent" });
    return baseUser;
  }

  try {
    const stytch = await authenticateStytchRequest(opts.req);
    diag("stytch_authenticate_returned", { stytchSessionPresent: Boolean(stytch) });
    const verifiedEmail = stytch ? getVerifiedStytchEmail(stytch.user) : null;
    if (stytch && verifiedEmail) {
      const stytchUser = await db.resolveOrCreateProviderUser({
        provider: STYTCH_PROVIDER,
        providerSubject: stytch.user.user_id,
        canonicalOpenId: stytchCanonicalOpenId(stytch.user.user_id),
        verifiedEmail,
        displayName: stytch.user.name?.first_name ?? null,
        loginMethod: "stytch-password",
      });
      if (stytchUser) {
        diag("resolve_done", { userPresent: true, isGuest: false, via: "stytch" });
        return stytchUser;
      }
    }
  } catch (error: unknown) {
    // Authentication remains optional for public procedures. Safe provider
    // failures are intentionally indistinguishable from guest state here, and the
    // catch below changes nothing about that: it observes, it never rethrows.
    //
    // Only the provider's own error_type and status_code are recorded. `error.message`
    // is deliberately excluded: a provider message can quote the submitted token, so
    // the class and status are the only fields known to be free of request data.
    diag("stytch_path_failed", {
      errorClass: error instanceof Error ? error.constructor.name : typeof error,
      ...(error instanceof StytchError ? { errorType: error.error_type, statusCode: error.status_code } : {}),
    });
  }

  diag("resolve_done", { userPresent: Boolean(baseUser), isGuest: baseUser?.isGuest === 1, via: "unauthenticated" });
  return baseUser;
}

export async function createContext(
  opts: CreateExpressContextOptions
): Promise<TrpcContext> {
  const user = await resolveRequestUser(opts);

  const isGuest = user?.isGuest === 1;

  return {
    req: opts.req,
    res: opts.res,
    user,
    isGuest,
  };
}
