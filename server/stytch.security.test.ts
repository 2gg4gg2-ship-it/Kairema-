import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { Request, Response } from "express";
import { describe, expect, it } from "vitest";
import {
  STYTCH_LINK_INTENT_COOKIE,
  STYTCH_RESET_COOKIE,
  STYTCH_SESSION_COOKIE,
  clearStytchLinkIntentCookie,
  setStytchLinkIntentCookie,
  setStytchResetCookie,
  setStytchSessionCookie,
} from "./stytch";

type CookieCall = { name: string; value: string; options: Record<string, unknown> };

function cookieResponse() {
  const calls: CookieCall[] = [];
  const clears: CookieCall[] = [];
  return {
    calls,
    clears,
    res: {
      cookie: (name: string, value: string, options: Record<string, unknown>) => calls.push({ name, value, options }),
      clearCookie: (name: string, options: Record<string, unknown>) => clears.push({ name, value: "", options }),
    } as unknown as Response,
  };
}

const request = { protocol: "https", headers: { host: "kairema.example" } } as unknown as Request;

describe("Stytch server-auth security boundaries", () => {
  it("holds only opaque provider tokens in distinct HttpOnly cookies", () => {
    const { calls, clears, res } = cookieResponse();

    setStytchSessionCookie(res, request, "provider-session-token");
    setStytchResetCookie(res, request, "provider-reset-token");
    setStytchLinkIntentCookie(res, request, "opaque-link-intent-reference");
    clearStytchLinkIntentCookie(res, request);

    expect(calls.map((call) => call.name)).toEqual([STYTCH_SESSION_COOKIE, STYTCH_RESET_COOKIE, STYTCH_LINK_INTENT_COOKIE]);
    expect(calls[0]).toMatchObject({ value: "provider-session-token", options: { httpOnly: true, secure: true, sameSite: "none", path: "/" } });
    expect(calls[1]).toMatchObject({ value: "provider-reset-token", options: { httpOnly: true, secure: true, sameSite: "none", path: "/" } });
    expect(calls[2]).toMatchObject({ value: "opaque-link-intent-reference", options: { httpOnly: true, secure: true, sameSite: "none", path: "/" } });
    expect(clears).toEqual([expect.objectContaining({ name: STYTCH_LINK_INTENT_COOKIE, options: expect.objectContaining({ maxAge: -1 }) })]);
  });

  it("preserves Manus OAuth precedence and uses only remote-verified Stytch fallback", async () => {
    const source = await readFile(resolve(process.cwd(), "server/_core/context.ts"), "utf8");
    const manusCall = source.indexOf("sdk.authenticateRequest(opts.req)");
    const stytchCall = source.indexOf("authenticateStytchRequest(opts.req)");

    expect(manusCall).toBeGreaterThan(-1);
    expect(stytchCall).toBeGreaterThan(manusCall);
    expect(source).toContain("providerSubject: stytch.user.user_id");
    expect(source).not.toContain("req.body.userId");
    expect(source).not.toContain("req.headers['x-user-id']");
  });

  it("requires protected explicit linking and prohibits email-based linking", async () => {
    const [routerSource, dbSource, callbackSource] = await Promise.all([
      readFile(resolve(process.cwd(), "server/routers.ts"), "utf8"),
      readFile(resolve(process.cwd(), "server/db.ts"), "utf8"),
      readFile(resolve(process.cwd(), "server/stytch-auth.ts"), "utf8"),
    ]);
    const linkHelper = dbSource.slice(dbSource.indexOf("export async function linkProviderIdentityToUser"), dbSource.indexOf("export async function resolveOrCreateProviderUser"));

    expect(routerSource).toContain("beginLink: protectedProcedure.input(stytchEmailSchema)");
    expect(routerSource).not.toContain("beginLink: publicProcedure");
    expect(linkHelper).toContain("providerSubject: string");
    expect(linkHelper).not.toContain("email:");
    expect(callbackSource).toContain("const linkingUser = linkIntent ? await resolveExistingVerifiedRequester(req)");
    expect(callbackSource).toContain("userId: linkingUser.id");
    expect(callbackSource).not.toContain("getUserByEmail");
  });

  it("rejects a linking callback after an initiating-user session switch", async () => {
    const [routerSource, dbSource, callbackSource] = await Promise.all([
      readFile(resolve(process.cwd(), "server/routers.ts"), "utf8"),
      readFile(resolve(process.cwd(), "server/db.ts"), "utf8"),
      readFile(resolve(process.cwd(), "server/stytch-auth.ts"), "utf8"),
    ]);

    expect(routerSource).toContain("createStytchLinkIntent(ctx.user.id)");
    expect(routerSource).toContain("setStytchLinkIntentCookie(ctx.res, ctx.req, linkIntent)");
    expect(callbackSource).toContain("consumeStytchLinkIntent(linkIntent, linkingUser.id)");
    expect(dbSource).toContain("eq(stytchLinkIntents.userId, userId)");
    expect(dbSource).toContain("gt(stytchLinkIntents.expiresAt, new Date())");
  });
});
