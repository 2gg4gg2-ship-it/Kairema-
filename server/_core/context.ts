import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import type { User } from "../../drizzle/schema";
import * as db from "../db";
import { authenticateStytchRequest, getVerifiedStytchEmail, STYTCH_PROVIDER, stytchCanonicalOpenId } from "../stytch";
import { sdk } from "./sdk";

export type TrpcContext = {
  req: CreateExpressContextOptions["req"];
  res: CreateExpressContextOptions["res"];
  user: User | null;
};

export async function createContext(
  opts: CreateExpressContextOptions
): Promise<TrpcContext> {
  let user: User | null = null;

  try {
    // Preserve existing Manus OAuth precedence when both verified cookies are
    // present. The Stytch path is a fallback, not a replacement for OAuth.
    user = await sdk.authenticateRequest(opts.req);
  } catch (error) {
    try {
      const stytch = await authenticateStytchRequest(opts.req);
      const verifiedEmail = stytch ? getVerifiedStytchEmail(stytch.user) : null;
      if (stytch && verifiedEmail) {
        user = await db.resolveOrCreateProviderUser({
          provider: STYTCH_PROVIDER,
          providerSubject: stytch.user.user_id,
          canonicalOpenId: stytchCanonicalOpenId(stytch.user.user_id),
          verifiedEmail,
          displayName: stytch.user.name?.first_name ?? null,
          loginMethod: "stytch-password",
        });
      }
    } catch {
      // Authentication remains optional for public procedures. Safe provider
      // failures are intentionally indistinguishable from guest state here.
      user = null;
    }
  }

  return {
    req: opts.req,
    res: opts.res,
    user,
  };
}
