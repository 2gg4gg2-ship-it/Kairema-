import { beforeEach, describe, expect, it, vi } from "vitest";

const { authenticateRequest, listDueMemoryExtractionJobReferences, processMemoryExtractionJob } = vi.hoisted(() => ({
  authenticateRequest: vi.fn(),
  listDueMemoryExtractionJobReferences: vi.fn(),
  processMemoryExtractionJob: vi.fn(),
}));

vi.mock("./_core/sdk", () => ({ sdk: { authenticateRequest } }));
vi.mock("./db", () => ({ listDueMemoryExtractionJobReferences }));
vi.mock("./chat-context", () => ({ processMemoryExtractionJob }));

import { createMemoryExtractionScheduleHandler, MEMORY_EXTRACTION_SWEEP_BATCH, registerMemoryExtractionScheduleRoute } from "./memory-extraction-schedule";

function response() {
  return { status: vi.fn().mockReturnThis(), json: vi.fn() } as unknown as Response;
}

beforeEach(() => vi.clearAllMocks());

describe("memory extraction schedule", () => {
  it("runs only an authenticated bounded text-free batch", async () => {
    authenticateRequest.mockResolvedValue({ id: -1, isCron: true, taskUid: "task_memory" });
    listDueMemoryExtractionJobReferences.mockResolvedValue([{ userId: 7, assistantMessageId: 101 }, { userId: 8, assistantMessageId: 202 }]);
    const res = response();

    await createMemoryExtractionScheduleHandler()({} as Request, res, vi.fn());

    expect(listDueMemoryExtractionJobReferences).toHaveBeenCalledWith(MEMORY_EXTRACTION_SWEEP_BATCH);
    expect(processMemoryExtractionJob).toHaveBeenNthCalledWith(1, 7, 101);
    expect(processMemoryExtractionJob).toHaveBeenNthCalledWith(2, 8, 202);
    expect(res.json).toHaveBeenCalledWith({ ok: true, scanned: 2 });
  });

  it("rejects non-cron callers before any queue access", async () => {
    authenticateRequest.mockResolvedValue({ id: 7, isCron: false });
    const res = response();

    await createMemoryExtractionScheduleHandler()({} as Request, res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ error: "cron-only" });
    expect(listDueMemoryExtractionJobReferences).not.toHaveBeenCalled();
  });

  it("registers exactly one documented project-level callback path", () => {
    const post = vi.fn();
    registerMemoryExtractionScheduleRoute({ post });
    expect(post).toHaveBeenCalledTimes(1);
    expect(post.mock.calls[0]?.[0]).toBe("/api/scheduled/memory-extraction");
  });
});
