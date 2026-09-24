import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Request, Response } from "express";
import { GUEST_COOKIE_NAME } from "@shared/const";

vi.mock("./db", () => ({
  __esModule: true,
  getUserByOpenId: vi.fn(),
  getUserById: vi.fn(),
  updateUserActivity: vi.fn(),
  upsertUser: vi.fn(),
  getDb: () => null,
}));

vi.mock("./storage", () => ({
  storageDelete: vi.fn(),
  storageCopy: vi.fn(),
}));

vi.mock("../drizzle/schema", () => ({
  __esModule: true,
  users: { id: "users.id", isGuest: "users.isGuest", expiresAt: "users.expiresAt", openId: "users.openId", createdAt: "users.createdAt" },
  chatAttachments: { userId: "chatAttachments.userId", fileKey: "chatAttachments.fileKey" },
  chatExports: { userId: "chatExports.userId", fileKey: "chatExports.fileKey" },
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn(),
  lt: vi.fn(),
  and: vi.fn(),
  inArray: vi.fn(),
}));

vi.mock("./cookies", () => ({
  getSessionCookieOptions: vi.fn(() => ({ httpOnly: true, secure: true, sameSite: "none" as const, path: "/" })),
}));

import { validateGuestToken, validateGuestSession, getOrCreateGuestUser } from "./_core/guest-session";
import * as db from "./db";

function makeGuestUser(id: number, openId: string, overrides: Partial<{ expiresAt: Date | null; createdAt: Date; isGuest: number }> = {}) {
  return {
    id,
    openId,
    isGuest: 1,
    email: null,
    name: null,
    loginMethod: null,
    expiresAt: overrides.expiresAt ?? new Date(Date.now() + 3600000),
    createdAt: overrides.createdAt ?? new Date(),
    ...overrides,
  };
}

function makeReq(token?: string): Request {
  return {
    headers: token ? { cookie: `${GUEST_COOKIE_NAME}=${token}` } : {},
  } as unknown as Request;
}

function makeRes(): Response {
  return { cookie: vi.fn(), clearCookie: vi.fn() } as unknown as Response;
}

const ONE_HOUR = 60 * 60 * 1000;
const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;

describe("validateGuestToken — prefix guard (SF5)", () => {
  beforeEach(() => {
    (db.getUserByOpenId as ReturnType<typeof vi.fn>).mockReset();
  });

  it("rejects empty token before DB lookup", async () => {
    const result = await validateGuestToken("");
    expect(result).toBeNull();
    expect(db.getUserByOpenId).not.toHaveBeenCalled();
  });

  it("rejects null-like token before DB lookup", async () => {
    const result = await validateGuestToken(null as any);
    expect(result).toBeNull();
    expect(db.getUserByOpenId).not.toHaveBeenCalled();
  });

  it("rejects non-guest openId (e.g. permanent user) before DB lookup", async () => {
    const result = await validateGuestToken("oauth_user_123");
    expect(result).toBeNull();
    expect(db.getUserByOpenId).not.toHaveBeenCalled();
  });

  it("rejects perm_ prefix token before DB lookup", async () => {
    const result = await validateGuestToken("perm_abc-123");
    expect(result).toBeNull();
    expect(db.getUserByOpenId).not.toHaveBeenCalled();
  });

  it("accepts valid guest token and returns user info", async () => {
    const guest = makeGuestUser(42, "guest_valid-uuid");
    (db.getUserByOpenId as ReturnType<typeof vi.fn>).mockResolvedValueOnce(guest);

    const result = await validateGuestToken("guest_valid-uuid");
    expect(result).toEqual({ userId: 42, openId: "guest_valid-uuid" });
    expect(db.getUserByOpenId).toHaveBeenCalledTimes(1);
  });

  it("rejects guest token for permanent user (isGuest === 0)", async () => {
    const permanentUser = { ...makeGuestUser(99, "guest_permanent"), isGuest: 0 };
    (db.getUserByOpenId as ReturnType<typeof vi.fn>).mockResolvedValueOnce(permanentUser);

    const result = await validateGuestToken("guest_permanent");
    expect(result).toBeNull();
  });

  it("rejects guest token for non-existent user", async () => {
    (db.getUserByOpenId as ReturnType<typeof vi.fn>).mockResolvedValueOnce(undefined);

    const result = await validateGuestToken("guest_nonexistent");
    expect(result).toBeNull();
  });

  it("rejects expired guest (expiresAt in past)", async () => {
    const user = makeGuestUser(42, "guest_expired", { expiresAt: new Date(Date.now() - ONE_HOUR) });
    (db.getUserByOpenId as ReturnType<typeof vi.fn>).mockResolvedValueOnce(user);

    const result = await validateGuestToken("guest_expired");
    expect(result).toBeNull();
  });

  it("rejects guest beyond absolute 7-day lifetime even if expiresAt is valid", async () => {
    const sevenDaysAgo = new Date(Date.now() - SEVEN_DAYS - 1000);
    const user = makeGuestUser(42, "guest_7day", {
      createdAt: sevenDaysAgo,
      expiresAt: new Date(Date.now() + ONE_HOUR), // sliding TTL still valid
    });
    (db.getUserByOpenId as ReturnType<typeof vi.fn>).mockResolvedValueOnce(user);

    const result = await validateGuestToken("guest_7day");
    expect(result).toBeNull();
  });

  it("accepts guest within absolute 7-day lifetime", async () => {
    const sixDaysAgo = new Date(Date.now() - 6 * 24 * ONE_HOUR - 1);
    const user = makeGuestUser(42, "guest_6day", {
      createdAt: sixDaysAgo,
      expiresAt: new Date(Date.now() + ONE_HOUR),
    });
    (db.getUserByOpenId as ReturnType<typeof vi.fn>).mockResolvedValueOnce(user);

    const result = await validateGuestToken("guest_6day");
    expect(result).toEqual({ userId: 42, openId: "guest_6day" });
  });
});

describe("validateGuestSession — cookie refresh (SF5)", () => {
  beforeEach(() => {
    (db.getUserByOpenId as ReturnType<typeof vi.fn>).mockReset();
  });

  it("refreshes the guest cookie when validation succeeds", async () => {
    const guest = makeGuestUser(42, "guest_cookie-test");
    (db.getUserByOpenId as ReturnType<typeof vi.fn>).mockResolvedValueOnce(guest);

    const req = makeReq("guest_cookie-test");
    const res = makeRes();

    await validateGuestSession(req, res);

    expect(res.cookie).toHaveBeenCalledTimes(1);
    expect(res.cookie).toHaveBeenCalledWith(
      GUEST_COOKIE_NAME,
      "guest_cookie-test",
      expect.objectContaining({ path: "/" })
    );
  });

  it("does NOT refresh cookie when validation fails (expired guest)", async () => {
    const user = makeGuestUser(42, "guest_expired-cs", { expiresAt: new Date(Date.now() - ONE_HOUR) });
    (db.getUserByOpenId as ReturnType<typeof vi.fn>).mockResolvedValueOnce(user);

    const req = makeReq("guest_expired-cs");
    const res = makeRes();

    const result = await validateGuestSession(req, res);
    expect(result).toBeNull();
    expect(res.cookie).not.toHaveBeenCalled();
  });

  it("does NOT refresh cookie when no token in cookie", async () => {
    const req = makeReq();
    const res = makeRes();

    const result = await validateGuestSession(req, res);
    expect(result).toBeNull();
    expect(res.cookie).not.toHaveBeenCalled();
  });

  it("does NOT call updateUserActivity — activity extension stays in SDK path", async () => {
    const guest = makeGuestUser(42, "guest_no-update");
    (db.getUserByOpenId as ReturnType<typeof vi.fn>).mockResolvedValueOnce(guest);

    const req = makeReq("guest_no-update");
    const res = makeRes();

    await validateGuestSession(req, res);

    expect(db.updateUserActivity).not.toHaveBeenCalled();
  });
});

describe("Activity update call count — no duplicate (SF5)", () => {
  beforeEach(() => {
    (db.getUserByOpenId as ReturnType<typeof vi.fn>).mockReset();
    (db.upsertUser as ReturnType<typeof vi.fn>).mockReset();
    (db.updateUserActivity as ReturnType<typeof vi.fn>).mockReset();
  });

  it("getOrCreateGuestUser calls updateUserActivity exactly once for active guest", async () => {
    const guest = makeGuestUser(42, "guest_active-once");
    (db.getUserByOpenId as ReturnType<typeof vi.fn>).mockResolvedValueOnce(guest);
    (db.upsertUser as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

    const res = makeRes();
    const req = makeReq("guest_active-once");

    await getOrCreateGuestUser(req, res);

    expect(db.updateUserActivity).toHaveBeenCalledTimes(1);
    expect(db.updateUserActivity).toHaveBeenCalledWith(42);
  });

  it("getOrCreateGuestUser does NOT call updateUserActivity for expired guest", async () => {
    const user = makeGuestUser(42, "guest_expired-once", { expiresAt: new Date(Date.now() - ONE_HOUR) });
    (db.getUserByOpenId as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(user)
      .mockResolvedValueOnce(makeGuestUser(99, "guest_new-once"));
    (db.upsertUser as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

    const res = makeRes();
    const req = makeReq("guest_expired-once");

    await getOrCreateGuestUser(req, res);

    expect(db.updateUserActivity).not.toHaveBeenCalled();
  });
});
