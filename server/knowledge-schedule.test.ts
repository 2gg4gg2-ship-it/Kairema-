import type { Request, Response } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { authenticateRequest, refreshKnowledgeBase } = vi.hoisted(() => ({
  authenticateRequest: vi.fn(),
  refreshKnowledgeBase: vi.fn(),
}));

vi.mock("./_core/sdk", () => ({ sdk: { authenticateRequest } }));
vi.mock("./knowledge", () => ({ refreshKnowledgeBase }));

import { createKnowledgeRefreshScheduleHandler } from "./knowledge-schedule";

beforeEach(() => vi.clearAllMocks());

function response() {
  return { status: vi.fn().mockReturnThis(), json: vi.fn() } as unknown as Response;
}

describe("knowledge refresh schedule", () => {
  it("runs the idempotent RAG refresh only for an authenticated cron identity", async () => {
    authenticateRequest.mockResolvedValue({ id: -1, isCron: true, taskUid: "task_knowledge" });
    refreshKnowledgeBase.mockResolvedValue([{ sourceId: "openai-news", state: "ready", fetchedCount: 2, indexedCount: 1, updatedCount: 0 }]);
    const res = response();

    await createKnowledgeRefreshScheduleHandler()({} as Request, res, vi.fn());

    expect(refreshKnowledgeBase).toHaveBeenCalledWith("scheduled");
    expect(res.json).toHaveBeenCalledWith({ ok: true, sources: [{ sourceId: "openai-news", state: "ready", fetchedCount: 2, indexedCount: 1, updatedCount: 0 }] });
  });

  it("rejects a non-cron request before RSS fetching starts", async () => {
    authenticateRequest.mockResolvedValue({ id: 7, isCron: false });
    const res = response();

    await createKnowledgeRefreshScheduleHandler()({} as Request, res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ error: "cron-only" });
    expect(refreshKnowledgeBase).not.toHaveBeenCalled();
  });
});
