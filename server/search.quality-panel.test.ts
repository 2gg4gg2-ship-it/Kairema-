import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";

const { getSearchQualityChart, getSearchQualityPanel } = vi.hoisted(() => ({
  getSearchQualityChart: vi.fn(),
  getSearchQualityPanel: vi.fn(),
}));

vi.mock("./_core/env", () => ({ ENV: { ownerOpenId: "owner-open-id" } }));
vi.mock("./db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./db")>()),
  getSearchQualityChart,
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
    getSearchQualityChart.mockReset();
    getSearchQualityChart.mockResolvedValue({
      daily: [{ date: "2026-08-15", requests: 3, success: 2, failures_by_layer: { layer_1: 1, layer_2: 0, layer_3: 0 }, p50: 110, p95: 210 }, { date: "2026-08-21", requests: 4, success: 3, failures_by_layer: { layer_1: 1, layer_2: 1, layer_3: 0 }, p50: 130, p95: 260 }],
      hourlyLayers: [{ hour: "09", layer1: 2, layer2: 1, layer3: 0 }, { hour: "10", layer1: 1, layer2: 0, layer3: 1 }],
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

  it("rejects a non-owner before reading live chart aggregates", async () => {
    await expect(callerFor("another-user").search.qualityChart()).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(getSearchQualityChart).not.toHaveBeenCalled();
  });

  it("returns anonymized seven-day and 24-hour chart series only to the owner", async () => {
    const result = await callerFor("owner-open-id").search.qualityChart();
    expect(result.daily[0]).toEqual({ date: "2026-08-15", requests: 3, success: 2, failures_by_layer: { layer_1: 1, layer_2: 0, layer_3: 0 }, p50: 110, p95: 210 });
    expect(result.hourlyLayers[0]).toMatchObject({ hour: "09", layer1: 2, layer2: 1, layer3: 0 });
    expect(JSON.stringify(result)).not.toMatch(/https?:\/\/|query|userId|message|memory|chatId|attachment|provider|model|source/i);
  });
});
