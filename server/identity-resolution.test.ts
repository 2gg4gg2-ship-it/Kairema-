import { EventEmitter } from "node:events";
import type { Request, Response } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Regression cover for the guest-shadows-Stytch defect: `sdk.authenticateRequest`
 * returns a guest row without throwing whenever a guest cookie is present, so the
 * Stytch fallback was skipped and the canonical email user stayed invisible to
 * `auth.me`, to every `protectedProcedure` (settings.get/update, auth.beginLink)
 * and to the raw upload/stream paths.
 */

const authenticateRequest = vi.hoisted(() => vi.fn());
const authenticateStytchRequest = vi.hoisted(() => vi.fn());
const getStytchClient = vi.hoisted(() => vi.fn());
const resolveOrCreateProviderUser = vi.hoisted(() => vi.fn());
const clearGuestCookie = vi.hoisted(() => vi.fn());
const getOrCreateGuestUser = vi.hoisted(() => vi.fn());
const consumeChatStreamRequestQuota = vi.hoisted(() => vi.fn());
const getOwnedChatSession = vi.hoisted(() => vi.fn());
const appendChatMessage = vi.hoisted(() => vi.fn());
const listSessionTranscriptWindow = vi.hoisted(() => vi.fn());
const buildChatContext = vi.hoisted(() => vi.fn());

vi.mock("./_core/sdk", () => ({ sdk: { authenticateRequest } }));

vi.mock("./stytch", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./stytch")>()),
  authenticateStytchRequest,
  getStytchClient,
}));

vi.mock("./db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./db")>()),
  resolveOrCreateProviderUser,
  consumeChatStreamRequestQuota,
  getOwnedChatSession,
  appendChatMessage,
  listSessionTranscriptWindow,
}));

vi.mock("./_core/guest-session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./_core/guest-session")>()),
  clearGuestCookie,
  getOrCreateGuestUser,
}));

import { appRouter } from "./routers";
import { createChatStreamHandler } from "./chat-stream";
import { createContext, resolveRequestUser } from "./_core/context";
import { registerStytchAuthRoutes } from "./stytch-auth";

const GUEST_USER = { id: 900, openId: "guest_legacy", email: null, isGuest: 1, role: "user" } as never;
const MANUS_USER = { id: 7, openId: "oauth_user", email: "oauth@example.com", isGuest: 0, role: "user" } as never;
const STYTCH_USER = { id: 42, openId: "stytch_canonical", email: "owner@example.com", loginMethod: "stytch-password", isGuest: 0, role: "user" } as never;
const VERIFIED_STYTCH = { user: { user_id: "stytch-user-test-1", emails: [{ email: "owner@example.com", verified: true }], name: { first_name: "Owner" } } };

const request = (cookie = "") => ({ protocol: "https", headers: { host: "kairema.example", cookie } }) as unknown as Request;

function responseStub() {
  const calls = { cookies: [] as string[], cleared: [] as string[], redirects: [] as string[] };
  const res = {
    cookie: (name: string) => calls.cookies.push(name),
    clearCookie: (name: string) => calls.cleared.push(name),
    redirect: (_code: number, location: string) => calls.redirects.push(location),
  };
  return { calls, res: res as unknown as Response };
}

beforeEach(() => {
  authenticateRequest.mockReset();
  authenticateStytchRequest.mockReset().mockResolvedValue(null);
  getStytchClient.mockReset();
  resolveOrCreateProviderUser.mockReset().mockResolvedValue(STYTCH_USER);
  clearGuestCookie.mockReset();
  getOrCreateGuestUser.mockReset().mockResolvedValue(null);
  consumeChatStreamRequestQuota.mockReset().mockResolvedValue({ allowed: true, retryAfterSeconds: 0 });
  getOwnedChatSession.mockReset().mockResolvedValue({ id: "550e8400-e29b-41d4-a716-446655440000", title: "Новый разговор" });
  appendChatMessage.mockReset().mockImplementation(async (_u, _s, role) => ({ id: role === "user" ? 1 : 2, created: true }));
  listSessionTranscriptWindow.mockReset().mockResolvedValue({ messages: [], budget: { maxContentChars: 1, maxCandidateMessages: 1, maxPriorTurns: 1 }, candidateCount: 0, selectedContentChars: 0, selectedPriorTurns: 0, truncated: false });
  buildChatContext.mockReset().mockResolvedValue({ style: "default", responseLength: "balanced", effort: "standard", thinking: false, toolAccess: true });
});

describe("SCENARIO A: guest cookie + valid Stytch session resolves the permanent canonical user", () => {
  it("does not let the guest row shadow the canonical Stytch user", async () => {
    authenticateRequest.mockResolvedValue(GUEST_USER);
    authenticateStytchRequest.mockResolvedValue(VERIFIED_STYTCH);

    const user = await resolveRequestUser({ req: request("kairema-guest=guest_legacy") });

    expect(user).toEqual(STYTCH_USER);
    expect(user?.id).toBe(42);
    expect(user?.isGuest).toBe(0);
    expect(user?.email).toBe("owner@example.com");
    // The guest cookie must not cause a second canonical user to be created.
    expect(resolveOrCreateProviderUser).toHaveBeenCalledTimes(1);
  });

  it("marks the context as non-guest so protectedProcedure is reachable and auth.me exposes email", async () => {
    authenticateRequest.mockResolvedValue(GUEST_USER);
    authenticateStytchRequest.mockResolvedValue(VERIFIED_STYTCH);

    const ctx = await createContext({ req: request("kairema-guest=guest_legacy"), res: {} as never });
    const me = await appRouter.createCaller(ctx).auth.me();

    expect(ctx.isGuest).toBe(false);
    expect(me?.id).toBe(42);
    expect(me?.email).toBe("owner@example.com");
  });

  it("does not create a new user when a permanent Manus user already exists alongside the guest cookie", async () => {
    authenticateRequest.mockResolvedValue(MANUS_USER);
    authenticateStytchRequest.mockResolvedValue(VERIFIED_STYTCH);

    const user = await resolveRequestUser({ req: request("kairema-guest=guest_legacy; manus_session=abc") });

    expect(user).toEqual(MANUS_USER);
    expect(resolveOrCreateProviderUser).not.toHaveBeenCalled();
  });
});

describe("SCENARIO B: permanent Manus/OAuth user returns before any Stytch resolution", () => {
  it("returns the Manus user and never calls the Stytch provider", async () => {
    authenticateRequest.mockResolvedValue(MANUS_USER);

    const user = await resolveRequestUser({ req: request("manus_session=abc") });

    expect(user).toEqual(MANUS_USER);
    expect(user?.isGuest).toBe(0);
    expect(authenticateStytchRequest).not.toHaveBeenCalled();
  });

  it("keeps Manus OAuth precedence even when a verified Stytch cookie is present", async () => {
    authenticateRequest.mockResolvedValue(MANUS_USER);
    authenticateStytchRequest.mockResolvedValue(VERIFIED_STYTCH);

    const user = await resolveRequestUser({ req: request("manus_session=abc; __Host-kairema-stytch-session=token") });

    expect(user).toEqual(MANUS_USER);
    expect(authenticateStytchRequest).not.toHaveBeenCalled();
  });
});

describe("SCENARIO C: guest without a valid Stytch session stays a guest", () => {
  it("returns the guest user and never calls resolveOrCreateProviderUser", async () => {
    authenticateRequest.mockResolvedValue(GUEST_USER);
    authenticateStytchRequest.mockResolvedValue(null);

    const user = await resolveRequestUser({ req: request("kairema-guest=guest_legacy") });

    expect(user).toEqual(GUEST_USER);
    expect(resolveOrCreateProviderUser).not.toHaveBeenCalled();
  });

  it("still reports isGuest so protectedProcedure keeps rejecting guests", async () => {
    authenticateRequest.mockResolvedValue(GUEST_USER);
    const ctx = await createContext({ req: request("kairema-guest=guest_legacy"), res: {} as never });

    expect(ctx.isGuest).toBe(true);
    expect(ctx.user?.email).toBeNull();
  });

  it("falls back to the guest when the Stytch session has no verified email", async () => {
    authenticateRequest.mockResolvedValue(GUEST_USER);
    authenticateStytchRequest.mockResolvedValue({ user: { user_id: "unverified", emails: [{ email: "pending@example.com", verified: false }] } });

    const user = await resolveRequestUser({ req: request("kairema-guest=guest_legacy") });

    expect(user).toEqual(GUEST_USER);
    expect(resolveOrCreateProviderUser).not.toHaveBeenCalled();
  });

  it("falls back to the guest when the Stytch provider is unavailable", async () => {
    authenticateRequest.mockResolvedValue(GUEST_USER);
    authenticateStytchRequest.mockRejectedValue(new Error("provider unavailable"));

    const user = await resolveRequestUser({ req: request("kairema-guest=guest_legacy") });

    expect(user).toEqual(GUEST_USER);
  });

  it("keeps anonymous access unauthenticated when no cookie at all is present", async () => {
    authenticateRequest.mockRejectedValue(new Error("Invalid session cookie"));
    authenticateStytchRequest.mockResolvedValue(null);

    expect(await resolveRequestUser({ req: request() })).toBeNull();
  });
});

describe("SCENARIO D: a successful Stytch login clears the stale guest cookie", () => {
  it("clears the guest cookie on the verified-login callback", async () => {
    getStytchClient.mockReturnValue({
      magicLinks: { authenticate: vi.fn().mockResolvedValue({ user: VERIFIED_STYTCH.user, session_token: "provider-session-token" }) },
      sessions: { revoke: vi.fn(), authenticate: vi.fn() },
    });

    const { res, calls } = responseStub();
    const app = { get: vi.fn() } as never;
    registerStytchAuthRoutes(app);
    const handler = (app.get as ReturnType<typeof vi.fn>).mock.calls[0][1];

    await handler({ protocol: "https", headers: { host: "kairema.example", cookie: "kairema-guest=guest_legacy" }, query: { token: "magic-token" } }, res, vi.fn());

    expect(calls.redirects).toEqual(["/?auth=verified"]);
    expect(clearGuestCookie).toHaveBeenCalledTimes(1);
    // The Stytch session cookie is still issued; only the guest cookie is dropped.
    expect(calls.cookies).toContain("__Host-kairema-stytch-session");
  });
});

describe("SCENARIO E: tRPC identity and the raw chat path use the same userId", () => {
  it("passes the same canonical id to buildChatContext and auth.me for one session", async () => {
    authenticateRequest.mockResolvedValue(GUEST_USER);
    authenticateStytchRequest.mockResolvedValue(VERIFIED_STYTCH);
    getOrCreateGuestUser.mockResolvedValue({ id: 900, isNew: false });

    const cookie = "kairema-guest=guest_legacy";
    const ctx = await createContext({ req: request(cookie), res: {} as never });
    const me = await appRouter.createCaller(ctx).auth.me();

    const seen: number[] = [];
    buildChatContext.mockImplementation(async (userId: number) => {
      seen.push(userId);
      return { style: "default", responseLength: "balanced", effort: "standard", thinking: true, toolAccess: true };
    });

    const handler = createChatStreamHandler({
      appendChatMessage,
      updateChatTitle: vi.fn(),
      listSessionTranscriptWindow,
      buildChatContext,
      chatWithRoleStream: vi.fn(async () => ({ content: "ok", modelUsed: "m", provider: "groq", label: "M" })),
      enqueueMemoryExtractionJob: vi.fn(),
      processMemoryExtractionJob: vi.fn(),
      auditChatStream: vi.fn(),
    });
    const streamRes = Object.assign(new EventEmitter(), {
      status: vi.fn().mockReturnThis(), set: vi.fn().mockReturnThis(), flushHeaders: vi.fn(), write: vi.fn(), end: vi.fn(), json: vi.fn(),
    }) as unknown as Response;

    await handler({ ...request(cookie), body: { sessionId: "550e8400-e29b-41d4-a716-446655440000", modelId: "fast", content: "Привет" } } as Request, streamRes, vi.fn());

    expect(me?.id).toBe(42);
    expect(seen).toEqual([42]);
    // Guest creation must not be reached while a verified Stytch session exists.
    expect(getOrCreateGuestUser).not.toHaveBeenCalled();
  });
});
