import { describe, expect, it, vi } from "vitest";
import { TRPCError } from "@trpc/server";

vi.mock("./_core/guest-session", () => ({
  validateGuestSession: vi.fn(),
  clearGuestCookie: vi.fn(),
  promoteGuest: vi.fn(),
}));

vi.mock("./db", () => ({
  getUserById: vi.fn(),
  getUserByOpenId: vi.fn(),
  upsertUser: vi.fn(),
  updateUserActivity: vi.fn(),
}));

vi.mock("@shared/const", () => ({
  UNAUTHED_ERR_MSG: "Please login (10001)",
  NOT_ADMIN_ERR_MSG: "You do not have required permission (10002)",
  GUEST_COOKIE_NAME: "kairema-guest",
  GUEST_TTL_MS: 3600000,
}));

import { router, protectedProcedure } from "./_core/trpc";

const testRouter = router({
  test: protectedProcedure.query(() => "ok"),
});

async function flushPromises(n = 5) {
  for (let i = 0; i < n; i++) {
    await new Promise(resolve => setImmediate(resolve));
  }
}

function makeCtx(user: { id: number; openId: string; isGuest: number; role?: string } | null) {
  return {
    user,
    isGuest: user?.isGuest === 1 ? true : false,
    req: {} as any,
    res: {} as any,
  } as any;
}

describe("SF1: protectedProcedure rejects guests", () => {
  it("permanent user (isGuest=0) passes protectedProcedure", async () => {
    const caller = testRouter.createCaller(makeCtx({ id: 1, openId: "perm_abc", isGuest: 0 }));
    const result = await caller.test();
    expect(result).toBe("ok");
  });

  it("OAuth permanent user (isGuest=0) passes protectedProcedure", async () => {
    const caller = testRouter.createCaller(makeCtx({ id: 2, openId: "oauth_user_123", isGuest: 0, role: "admin" }));
    const result = await caller.test();
    expect(result).toBe("ok");
  });

  it("guest (isGuest=1) is rejected by protectedProcedure", async () => {
    const caller = testRouter.createCaller(makeCtx({ id: 3, openId: "guest_xyz", isGuest: 1 }));
    await expect(caller.test()).rejects.toThrow(TRPCError);
    try {
      await caller.test();
    } catch (e) {
      expect((e as TRPCError).code).toBe("UNAUTHORIZED");
    }
  });

  it("null user is rejected by protectedProcedure", async () => {
    const caller = testRouter.createCaller(makeCtx(null));
    await expect(caller.test()).rejects.toThrow(TRPCError);
  });

  it("rejected guest gets UNAUTHED_ERR_MSG (10001)", async () => {
    const caller = testRouter.createCaller(makeCtx({ id: 3, openId: "guest_xyz", isGuest: 1 }));
    try {
      await caller.test();
      fail("Should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(TRPCError);
      expect((e as TRPCError).code).toBe("UNAUTHORIZED");
      expect((e as TRPCError).message).toBe("Please login (10001)");
    }
  });
});
