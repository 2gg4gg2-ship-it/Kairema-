import { describe, expect, it } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

function guestContext(): TrpcContext {
  return {
    user: null,
    req: {} as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };
}

describe("auth-first-launch protected backend boundary", () => {
  it("rejects a guest before a protected provider procedure can return private data", async () => {
    const caller = appRouter.createCaller(guestContext());

    await expect(caller.providers.dashboard()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });

  it("keeps the public identity endpoint compatible for the existing OAuth flow", async () => {
    const caller = appRouter.createCaller(guestContext());

    await expect(caller.auth.me()).resolves.toBeNull();
  });
});
