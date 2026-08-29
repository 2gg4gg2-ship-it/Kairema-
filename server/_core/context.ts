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
    // Stytch verification failed, fall back to Manus OAuth
  }

  if (!user) {
    try {
      user = await sdk.authenticateRequest(opts.req);
    } catch {
      user = null;
    }
  }

  return {
    req: opts.req,
    res: opts.res,
    user,
  };
}
