import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import type { Request } from "express";
import type { User } from "../../drizzle/schema";
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
export async function resolveRequestUser(opts: { req: Request }): Promise<User | null> {
  let baseUser: User | null = null;

  try {
    // Preserve existing Manus OAuth precedence when both verified cookies are
    // present. The Stytch path is a fallback, not a replacement for OAuth.
    baseUser = await sdk.authenticateRequest(opts.req);
  } catch {
    baseUser = null;
  }

  // A guest cookie is not final authentication. When Manus already produced a
  // permanent user, keep it and skip the provider round-trip entirely.
  if (baseUser && baseUser.isGuest !== 1) return baseUser;

  try {
    const stytch = await authenticateStytchRequest(opts.req);
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
      if (stytchUser) return stytchUser;
    }
  } catch {
    // Authentication remains optional for public procedures. Safe provider
    // failures are intentionally indistinguishable from guest state here.
  }

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
