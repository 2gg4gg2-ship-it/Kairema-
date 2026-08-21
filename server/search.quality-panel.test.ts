import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";

const { getSearchQualityPanel } = vi.hoisted(() => ({
  getSearchQualityPanel: vi.fn(),
}));

vi.mock("./_core/env", () => ({ ENV: { ownerOpenId: "owner-open-id" } }));
vi.mock("./db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./db")>()),
  getSearchQualityPanel,
}));

import { appRouter } from "./routers";

function callerFor(openId: string) {
  return appRouter.createCaller({
    user: {
      id: 1,
      openId,
      email: "user@example.com",
      name: "User",
      loginMethod: "manus",
      role: "user",
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    },
    req: {} as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  });
}

describe("search.qualityPanel", () => {
  beforeEach(() => {
    getSearchQualityPanel.mockReset();
    getSearchQualityPanel.mockResolvedValue({
      last24h: { sampleCount: 2, counts: { found: 1, empty: 1, degraded: 0, error: 0 }, verifiedSourceCount: 1, zeroSourceCount: 1, staleBlockedCount: 0, foundRate: 0.5, verificationPassRate: 0.5 },
      last7d: { sampleCount: 4, counts: { found: 2, empty: 1, degraded: 1, error: 0 }, verifiedSourceCount: 2, zeroSourceCount: 2, staleBlockedCount: 1, foundRate: 0.5, verificationPassRate: 0.5 },
    });
  });

  it("rejects a non-owner before reading aggregates", async () => {
    await expect(callerFor("another-user").search.qualityPanel()).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(getSearchQualityPanel).not.toHaveBeenCalled();
  });

  it("returns only the aggregate quality DTO to the configured owner", async () => {
    const result = await callerFor("owner-open-id").search.qualityPanel();
    expect(result).toMatchObject({ last7d: { sampleCount: 4, counts: { found: 2, empty: 1, degraded: 1, error: 0 } } });
    expect(JSON.stringify(result)).not.toMatch(/https?:\/\/|query|userId|provider|model/i);
  });
});
