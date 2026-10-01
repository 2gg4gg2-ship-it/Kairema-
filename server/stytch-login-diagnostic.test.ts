import { beforeEach, describe, expect, it, vi } from "vitest";
import { StytchError } from "stytch";
import type { TrpcContext } from "./_core/context";

const { stytchClient } = vi.hoisted(() => ({
  stytchClient: {
    passwords: { authenticate: vi.fn() },
    otps: { email: { send: vi.fn() } },
  },
}));

vi.mock("./stytch", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./stytch")>();
  return { ...actual, getStytchClient: () => stytchClient };
});

const { appRouter } = await import("./routers");
const { STYTCH_OTP_EMAIL_ID_COOKIE, STYTCH_PASSWORD_SESSION_COOKIE } = await import("./stytch");

const EMAIL = "owner@example.com";
const PASSWORD = "correct-horse-battery";

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

function createContext(): { ctx: TrpcContext; setCookie: ReturnType<typeof vi.fn> } {
  const setCookie = vi.fn();
  const ctx: TrpcContext = {
    user: null,
    isGuest: false,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { cookie: setCookie, clearCookie: vi.fn() } as unknown as TrpcContext["res"],
  };
  return { ctx, setCookie };
}

let logged: string[] = [];

beforeEach(() => {
  logged = [];
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    logged.push(args.map(String).join(" "));
  });
  stytchClient.passwords.authenticate.mockReset();
  stytchClient.otps.email.send.mockReset();
});

describe("auth.stytch.login diagnostics", () => {
  it("names the password check as the failing stage and never writes the credentials", async () => {
    stytchClient.passwords.authenticate.mockRejectedValue(stytchError(401, "authentication_failed"));
    const { ctx } = createContext();

    await expect(appRouter.createCaller(ctx).auth.stytch.login({ email: EMAIL, password: PASSWORD }))
      .rejects.toMatchObject({ code: "UNAUTHORIZED" });

    const joined = logged.join("\n");
    expect(joined).toContain("login.passwords.authenticate");
    expect(joined).toContain("emailPresent=true");
    expect(joined).toContain("passwordPresent=true");
    expect(joined).toMatch(/inputBytes=\d+/);
    expect(joined).not.toContain(EMAIL);
    expect(joined).not.toContain(PASSWORD);
  });

  it("names the code delivery as the failing stage when the password was accepted", async () => {
    stytchClient.passwords.authenticate.mockResolvedValue({ session_token: "session-token-test" });
    stytchClient.otps.email.send.mockRejectedValue(stytchError(429, "too_many_attempts"));
    const { ctx } = createContext();

    // A provider rate limit is reported to the client exactly like a wrong password, which is why the
    // stage label is the only thing that tells the two apart.
    await expect(appRouter.createCaller(ctx).auth.stytch.login({ email: EMAIL, password: PASSWORD }))
      .rejects.toMatchObject({ code: "UNAUTHORIZED" });

    expect(logged.join("\n")).toContain("login.otps.email.send");
  });

  it("still sets both provider cookies on the success path", async () => {
    stytchClient.passwords.authenticate.mockResolvedValue({ session_token: "session-token-test" });
    stytchClient.otps.email.send.mockResolvedValue({ email_id: "email-id-test" });
    const { ctx, setCookie } = createContext();

    const result = await appRouter.createCaller(ctx).auth.stytch.login({ email: EMAIL, password: PASSWORD });

    expect(result).toEqual({ state: "OTP_REQUIRED" });
    expect(setCookie.mock.calls.map((call) => call[0])).toEqual([
      STYTCH_OTP_EMAIL_ID_COOKIE,
      STYTCH_PASSWORD_SESSION_COOKIE,
    ]);
  });
});
