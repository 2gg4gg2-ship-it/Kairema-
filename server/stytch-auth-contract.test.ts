import { beforeEach, describe, expect, it, vi } from "vitest";
import { StytchError } from "stytch";
import type { TrpcContext } from "./_core/context";

const { stytchClient, resolveOrCreateProviderUser } = vi.hoisted(() => ({
  stytchClient: {
    passwords: { authenticate: vi.fn() },
    otps: { email: { send: vi.fn() }, authenticate: vi.fn() },
    sessions: { authenticate: vi.fn(), revoke: vi.fn() },
    magicLinks: { email: { loginOrCreate: vi.fn() } },
  },
  resolveOrCreateProviderUser: vi.fn(),
}));

vi.mock("./db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./db")>()),
  resolveOrCreateProviderUser,
}));

vi.mock("./stytch", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./stytch")>();
  return {
    ...actual,
    getStytchClient: () => stytchClient,
    // `authenticateStytchRequest` reaches the provider client through its own module scope, which a
    // module mock cannot intercept, so it is stood in for here by the same client the router tests
    // use. Everything that decides the outcome stays real: the cookie lookup, the provider call and
    // the mapping of a provider rejection onto a safe error.
    authenticateStytchRequest: vi.fn(async (req: { headers: { cookie?: string } }) => {
      const sessionToken = actual.getStytchSessionToken(req as never);
      if (!sessionToken) return null;
      try {
        const response = await stytchClient.sessions.authenticate({ session_token: sessionToken });
        return { user: response.user, sessionToken };
      } catch (error) {
        throw actual.toSafeStytchError(error);
      }
    }),
  };
});

const { appRouter } = await import("./routers");
const { createContext } = await import("./_core/context");
const {
  STYTCH_OTP_EMAIL_ID_COOKIE,
  STYTCH_PASSWORD_SESSION_COOKIE,
  STYTCH_SESSION_COOKIE,
} = await import("./stytch");
const { COOKIE_NAME } = await import("../shared/const");

const EMAIL = "owner@example.test";
const PASSWORD = "correct horse battery";
const CODE = "123456";

type CookieCall = { name: string; value: string; options: Record<string, unknown> };

function createHarness(cookieHeader = "") {
  const setCookie: CookieCall[] = [];
  const clearedCookies: CookieCall[] = [];
  const req = { protocol: "https", headers: { cookie: cookieHeader } } as unknown as TrpcContext["req"];
  const res = {
    cookie: (name: string, value: string, options: Record<string, unknown>) => {
      setCookie.push({ name, value, options });
    },
    clearCookie: (name: string, options: Record<string, unknown>) => {
      clearedCookies.push({ name, value: "", options });
    },
  } as unknown as TrpcContext["res"];
  const ctx: TrpcContext = { user: null, isGuest: false, req, res };
  return { ctx, setCookie, clearedCookies, req, res };
}

function stytchError(statusCode: number, errorType: string) {
  return new StytchError({
    status_code: statusCode,
    request_id: "request-id-test",
    error_type: errorType,
    error_message: "provider message",
    error_url: "https://stytch.com/docs/errors",
    error_details: undefined,
  });
}

function canonicalUser() {
  return {
    id: 7,
    openId: "stytch:user-test",
    email: EMAIL,
    name: "Owner",
    loginMethod: "stytch-password",
    role: "user",
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
    isGuest: 0,
  };
}

let logged: string[] = [];

beforeEach(() => {
  logged = [];
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    logged.push(args.map(String).join(" "));
  });
  vi.clearAllMocks();
  stytchClient.passwords.authenticate.mockResolvedValue({ session_token: "password-session-test", user: { user_id: "user-test" } });
  stytchClient.otps.email.send.mockResolvedValue({ email_id: "email-id-test" });
  stytchClient.otps.authenticate.mockResolvedValue({
    session_token: "final-session-test",
    user: { user_id: "user-test", emails: [{ email: EMAIL, verified: true }], name: { first_name: "Owner" } },
  });
  stytchClient.sessions.revoke.mockResolvedValue(undefined);
  stytchClient.sessions.authenticate.mockResolvedValue({
    user: { user_id: "user-test", emails: [{ email: EMAIL, verified: true }] },
  });
  resolveOrCreateProviderUser.mockResolvedValue(canonicalUser());
});

describe("auth.stytch.login contract", () => {
  it("answers OTP_REQUIRED and hands over exactly the two intermediate cookies", async () => {
    const { ctx, setCookie } = createHarness();
    const caller = appRouter.createCaller(ctx);

    const result = await caller.auth.stytch.login({ email: EMAIL, password: PASSWORD });

    expect(result).toEqual({ state: "OTP_REQUIRED" });
    expect(setCookie.map((call) => call.name)).toEqual([STYTCH_OTP_EMAIL_ID_COOKIE, STYTCH_PASSWORD_SESSION_COOKIE]);
    // The session cookie belongs to the completed sign-in, not to a half-finished one.
    expect(setCookie.map((call) => call.name)).not.toContain(STYTCH_SESSION_COOKIE);
    expect(setCookie[0].options).toMatchObject({ httpOnly: true, path: "/", sameSite: "none", secure: true });
    expect(stytchClient.otps.email.send).toHaveBeenCalledWith(expect.objectContaining({ email: EMAIL, expiration_minutes: 10 }));
  });

  it("keeps a refused password an error and sets no cookie at all", async () => {
    stytchClient.passwords.authenticate.mockRejectedValue(stytchError(401, "authentication_failed"));
    const { ctx, setCookie } = createHarness();

    await expect(appRouter.createCaller(ctx).auth.stytch.login({ email: EMAIL, password: "wrong password" }))
      .rejects.toMatchObject({ code: "UNAUTHORIZED" });

    expect(setCookie).toEqual([]);
    // The password check is the stage that failed, which is the one thing a 401 cannot say on its own.
    expect(logged.join("\n")).toContain("login.passwords.authenticate");
  });

  it("reports a code that could not be sent against the sending stage, not the password", async () => {
    stytchClient.otps.email.send.mockRejectedValue(stytchError(429, "too_many_attempts"));
    const { ctx, setCookie } = createHarness();

    await expect(appRouter.createCaller(ctx).auth.stytch.login({ email: EMAIL, password: PASSWORD }))
      .rejects.toMatchObject({ code: "UNAUTHORIZED" });

    expect(setCookie).toEqual([]);
    expect(logged.join("\n")).toContain("login.otps.email.send");
  });

  it("separates a provider outage from a rejected credential", async () => {
    stytchClient.passwords.authenticate.mockRejectedValue(stytchError(503, "internal_server_error"));
    const { ctx } = createHarness();

    await expect(appRouter.createCaller(ctx).auth.stytch.login({ email: EMAIL, password: PASSWORD }))
      .rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
  });

  it("never writes the credential it was given into the log", async () => {
    stytchClient.passwords.authenticate.mockRejectedValue(stytchError(401, "authentication_failed"));
    const { ctx } = createHarness();

    await expect(appRouter.createCaller(ctx).auth.stytch.login({ email: EMAIL, password: PASSWORD })).rejects.toBeTruthy();

    const joined = logged.join("\n");
    expect(joined).toMatch(/emailPresent=true/);
    expect(joined).toMatch(/passwordPresent=true/);
    expect(joined).toMatch(/inputBytes=\d+/);
    expect(joined).not.toContain(EMAIL);
    expect(joined).not.toContain(PASSWORD);
  });
});

describe("auth.stytch.verifyOtp contract", () => {
  const intermediateCookies = `${STYTCH_OTP_EMAIL_ID_COOKIE}=email-id-test; ${STYTCH_PASSWORD_SESSION_COOKIE}=password-session-test`;

  it("answers SIGNED_IN, sets the session cookie and retires the intermediate cookies", async () => {
    const { ctx, setCookie, clearedCookies } = createHarness(intermediateCookies);

    const result = await appRouter.createCaller(ctx).auth.stytch.verifyOtp({ code: CODE });

    expect(result).toEqual({ state: "SIGNED_IN" });
    expect(setCookie.map((call) => call.name)).toEqual([STYTCH_SESSION_COOKIE]);
    expect(setCookie[0].options).toMatchObject({ httpOnly: true, path: "/", sameSite: "none", secure: true });
    expect(clearedCookies.map((call) => call.name)).toEqual(expect.arrayContaining([COOKIE_NAME, STYTCH_OTP_EMAIL_ID_COOKIE, STYTCH_PASSWORD_SESSION_COOKIE]));
    expect(stytchClient.otps.authenticate).toHaveBeenCalledWith(expect.objectContaining({ code: CODE, method_id: "email-id-test" }));
  });

  it("refuses to guess when the intermediate cookies never arrived", async () => {
    const { ctx, setCookie } = createHarness();

    await expect(appRouter.createCaller(ctx).auth.stytch.verifyOtp({ code: CODE }))
      .rejects.toMatchObject({ code: "BAD_REQUEST" });

    expect(setCookie).toEqual([]);
    expect(stytchClient.otps.authenticate).not.toHaveBeenCalled();
  });

  it("never issues a session when the code is refused", async () => {
    stytchClient.otps.authenticate.mockRejectedValue(stytchError(401, "unable_to_auth_magic_link"));
    const { ctx, setCookie } = createHarness(intermediateCookies);

    await expect(appRouter.createCaller(ctx).auth.stytch.verifyOtp({ code: "000000" }))
      .rejects.toMatchObject({ code: "UNAUTHORIZED" });

    expect(setCookie).toEqual([]);
  });

  it("keeps the OTP session after a refused code so the correct code can still be submitted", async () => {
    // The exact Android sequence: a typo burns the code, the user retypes it correctly.
    // Retiring the intermediate cookies on the first refusal made every later submit fail
    // BAD_REQUEST before reaching the provider, so the button looked dead for good.
    // The default `beforeEach` already resolves `otps.authenticate` with a verified user, so only
    // the first attempt needs to be overridden to refuse the code.
    stytchClient.otps.authenticate.mockRejectedValueOnce(stytchError(401, "unable_to_auth_magic_link"));
    const { ctx, setCookie, clearedCookies } = createHarness(intermediateCookies);

    await expect(appRouter.createCaller(ctx).auth.stytch.verifyOtp({ code: "000000" }))
      .rejects.toMatchObject({ code: "UNAUTHORIZED" });

    // A refused code is recoverable, so neither intermediate cookie may be retired.
    const clearedAfterRefusal = clearedCookies.map((call) => call.name);
    expect(clearedAfterRefusal).not.toContain(STYTCH_OTP_EMAIL_ID_COOKIE);
    expect(clearedAfterRefusal).not.toContain(STYTCH_PASSWORD_SESSION_COOKIE);
    expect(setCookie).toEqual([]);

    const result = await appRouter.createCaller(ctx).auth.stytch.verifyOtp({ code: CODE });

    expect(result).toEqual({ state: "SIGNED_IN" });
    expect(stytchClient.otps.authenticate).toHaveBeenCalledTimes(2);
    expect(stytchClient.otps.authenticate).toHaveBeenLastCalledWith(
      expect.objectContaining({ code: CODE, method_id: "email-id-test" }),
    );
    // The session is issued only on the successful attempt, and the spent intermediates are
    // retired only then.
    expect(setCookie.map((call) => call.name)).toEqual([STYTCH_SESSION_COOKIE]);
    expect(clearedCookies.map((call) => call.name)).toEqual(
      expect.arrayContaining([COOKIE_NAME, STYTCH_OTP_EMAIL_ID_COOKIE, STYTCH_PASSWORD_SESSION_COOKIE]),
    );
  });

  it("never issues a session for an address that is not verified", async () => {
    stytchClient.otps.authenticate.mockResolvedValue({
      session_token: "final-session-test",
      user: { user_id: "user-test", emails: [{ email: EMAIL, verified: false }] },
    });
    const { ctx, setCookie } = createHarness(intermediateCookies);

    await expect(appRouter.createCaller(ctx).auth.stytch.verifyOtp({ code: CODE }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });

    expect(setCookie).toEqual([]);
  });
});

describe("auth.me after a completed sign-in", () => {
  it("resolves the user from the session cookie the sign-in left behind", async () => {
    const { req, res } = createHarness(`${STYTCH_SESSION_COOKIE}=final-session-test`);
    const ctx = await createContext({ req, res } as never);

    expect(stytchClient.sessions.authenticate).toHaveBeenCalledWith({ session_token: "final-session-test" });
    expect(ctx.user).toMatchObject({ id: 7, email: EMAIL, loginMethod: "stytch-password" });
    expect(ctx.isGuest).toBe(false);
    await expect(appRouter.createCaller(ctx).auth.me()).resolves.toMatchObject({ id: 7, email: EMAIL });
  });

  it("resolves no user when no session cookie is presented", async () => {
    const { req, res } = createHarness();
    const ctx = await createContext({ req, res } as never);

    expect(stytchClient.sessions.authenticate).not.toHaveBeenCalled();
    expect(ctx.user).toBeNull();
    await expect(appRouter.createCaller(ctx).auth.me()).resolves.toBeNull();
  });

  it("degrades to no user when the provider session no longer resolves", async () => {
    stytchClient.sessions.authenticate.mockRejectedValue(stytchError(401, "unable_to_auth_session"));
    const { req, res } = createHarness(`${STYTCH_SESSION_COOKIE}=stale-session-test`);

    const ctx = await createContext({ req, res } as never);
    await expect(appRouter.createCaller(ctx).auth.me()).resolves.toBeNull();
  });
});
