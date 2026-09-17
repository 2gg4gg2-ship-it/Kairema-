import type { Express, Request, Response } from "express";
import { COOKIE_NAME } from "../shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { consumeStytchLinkIntent, getUserByProviderIdentity, linkProviderIdentityToUser, resolveOrCreateProviderUser } from "./db";
import { sdk } from "./_core/sdk";
import {
  STYTCH_PROVIDER,
  STYTCH_SESSION_DURATION_MINUTES,
  authenticateStytchRequest,
  clearStytchLinkIntentCookie,
  clearStytchSessionCookie,
  getStytchClient,
  getVerifiedStytchEmail,
  getStytchLinkIntent,
  revokeStytchSessionToken,
  setStytchResetCookie,
  setStytchSessionCookie,
  stytchCanonicalOpenId,
} from "./stytch";

async function resolveExistingVerifiedRequester(req: Request) {
  try {
    return await sdk.authenticateRequest(req);
  } catch {
    const stytch = await authenticateStytchRequest(req);
    return stytch ? getUserByProviderIdentity(STYTCH_PROVIDER, stytch.user.user_id) : undefined;
  }
}

function redirectLinkFailure(res: Response, req: Request) {
  clearStytchLinkIntentCookie(res, req);
  clearStytchSessionCookie(res, req);
  res.redirect(303, "/?auth=link-failed");
}

/** Complete a magic link fully on the server, then create a verified Kairema context. */
export function registerStytchAuthRoutes(app: Express) {
  app.get("/api/stytch/callback", async (req, res) => {
    const token = firstQueryValue(req.query.token);
    const tokenType = firstQueryValue(req.query.stytch_token_type);
    const linkIntent = getStytchLinkIntent(req);
    const linkingUser = linkIntent ? await resolveExistingVerifiedRequester(req).catch(() => undefined) : undefined;
    if (!token) {
      linkIntent ? redirectLinkFailure(res, req) : res.redirect(303, "/?auth=failed");
      return;
    }

    if (tokenType === "reset_password") {
      if (linkIntent) {
        redirectLinkFailure(res, req);
        return;
      }
      // This is the provider-issued one-time reset token. Keep it out of the
      // client JS context and finish it only through auth.completePasswordReset.
      setStytchResetCookie(res, req, token);
      res.redirect(303, "/?reset=1");
      return;
    }

    try {
      const result = await getStytchClient().magicLinks.authenticate({
        token,
        session_duration_minutes: STYTCH_SESSION_DURATION_MINUTES,
      });
      const verifiedEmail = getVerifiedStytchEmail(result.user);
      if (!verifiedEmail) {
        await revokeStytchSessionToken(result.session_token);
        linkIntent ? redirectLinkFailure(res, req) : (clearStytchSessionCookie(res, req), res.redirect(303, "/?auth=verification-required"));
        return;
      }

      if (linkIntent) {
        if (!linkingUser || !(await consumeStytchLinkIntent(linkIntent, linkingUser.id))) {
          await revokeStytchSessionToken(result.session_token);
          redirectLinkFailure(res, req);
          return;
        }
        await linkProviderIdentityToUser({
          provider: STYTCH_PROVIDER,
          providerSubject: result.user.user_id,
          userId: linkingUser.id,
        });
        // Both the initiating session and provider-email proof succeeded. The
        // provider session remains opaque and must still be re-verified later.
        setStytchSessionCookie(res, req, result.session_token);
        clearStytchLinkIntentCookie(res, req);
        res.redirect(303, "/?auth=linked");
        return;
      }

      try {
        await resolveOrCreateProviderUser({
          provider: STYTCH_PROVIDER,
          providerSubject: result.user.user_id,
          canonicalOpenId: stytchCanonicalOpenId(result.user.user_id),
          verifiedEmail,
          displayName: result.user.name?.first_name ?? null,
          loginMethod: "stytch-password",
        });
        console.log("[CANONICAL_USER_OK]");
      } catch (error) {
        console.log(`[CANONICAL_USER_ERROR] stage=resolve_provider error_name=${error?.constructor?.name ?? "Error"}`);
        throw error;
      }
      setStytchSessionCookie(res, req, result.session_token);
      // Choosing a verified provider session is an explicit account switch.
      // Existing Manus OAuth remains supported but is not left ambiguous.
      clearManusSessionCookie(res, req);
      res.redirect(303, "/?auth=verified");
    } catch {
      linkIntent ? redirectLinkFailure(res, req) : (clearStytchSessionCookie(res, req), res.redirect(303, "/?auth=failed"));
    }
  });
}

function firstQueryValue(value: unknown) {
  return typeof value === "string" && value.length > 0 && value.length <= 8_192 ? value : null;
}

function clearManusSessionCookie(res: Response, req: Request) {
  res.clearCookie(COOKIE_NAME, { ...getSessionCookieOptions(req), maxAge: -1 });
}
