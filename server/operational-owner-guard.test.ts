import { describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";

const operations = vi.hoisted(() => ({
  probeWebSearchStatus: vi.fn(),
  refreshKnowledgeBase: vi.fn(),
}));

vi.mock("./web-search", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./web-search")>()),
  probeWebSearchStatus: operations.probeWebSearchStatus,
}));

vi.mock("./knowledge", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./knowledge")>()),
  refreshKnowledgeBase: operations.refreshKnowledgeBase,
}));

import { appRouter } from "./routers";

function nonOwnerCaller() {
  return appRouter.createCaller({
    user: {
      id: 912,
      openId: "synthetic-non-owner",
      email: "synthetic-non-owner@example.invalid",
      name: "Synthetic non-owner",
      loginMethod: "manus",
      role: "user",
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
      isGuest: 0,
    },
    req: { headers: {} } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  });
}

describe("operational mutation owner guard", () => {
  it("rejects a non-owner before an external web-search probe can start", async () => {
    await expect(nonOwnerCaller().webSearch.probe()).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(operations.probeWebSearchStatus).not.toHaveBeenCalled();
  });

  it("rejects a non-owner before an RSS refresh can start", async () => {
    await expect(nonOwnerCaller().knowledge.refresh()).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(operations.refreshKnowledgeBase).not.toHaveBeenCalled();
  });
});
