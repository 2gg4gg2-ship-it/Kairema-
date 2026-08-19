import type { Request, Response } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { authenticateRequest, refreshProviderHealth } = vi.hoisted(() => ({
  authenticateRequest: vi.fn(),
  refreshProviderHealth: vi.fn(),
}));

vi.mock("./_core/sdk", () => ({ sdk: { authenticateRequest } }));
vi.mock("./providers", () => ({ refreshProviderHealth }));

import { createProviderHealthScheduleHandler } from "./provider-health-schedule";

beforeEach(() => {
  vi.clearAllMocks();
});

function response() {
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn(),
  } as unknown as Response;
}

describe("provider health schedule", () => {
  it("runs the forced server-side recheck only for an authenticated cron identity", async () => {
    authenticateRequest.mockResolvedValue({ id: -1, isCron: true, taskUid: "task_health" });
    refreshProviderHealth.mockResolvedValue(undefined);
    const res = response();

    await createProviderHealthScheduleHandler()({} as Request, res, vi.fn());

    expect(refreshProviderHealth).toHaveBeenCalledWith({ force: true });
    expect(res.json).toHaveBeenCalledWith({ ok: true, refreshed: 3 });
  });

  it("rejects non-cron requests before a provider ping can run", async () => {
    authenticateRequest.mockResolvedValue({ id: 7, isCron: false });
    const res = response();

    await createProviderHealthScheduleHandler()({} as Request, res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ error: "cron-only" });
    expect(refreshProviderHealth).not.toHaveBeenCalled();
  });
});
