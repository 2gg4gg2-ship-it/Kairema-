import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";

const memoryDb = vi.hoisted(() => ({
  getMemorySettings: vi.fn(),
  getMemoryProfile: vi.fn(),
  listMemoryEntries: vi.fn(),
  upsertMemoryEntry: vi.fn(),
  deleteMemoryEntry: vi.fn(),
}));

vi.mock("./db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./db")>()),
  ...memoryDb,
}));

import { appRouter } from "./routers";

function callerFor(userId = 42) {
  return appRouter.createCaller({
    user: {
      id: userId,
      openId: `user-${userId}`,
      email: "user@example.com",
      name: "User",
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

describe("memory router ownership", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    memoryDb.getMemorySettings.mockResolvedValue({ userId: 42, enabled: 1, autoExtract: 1 });
    memoryDb.getMemoryProfile.mockResolvedValue({ userId: 42, profile: "", summary: "" });
    memoryDb.listMemoryEntries.mockResolvedValue([]);
    memoryDb.upsertMemoryEntry.mockResolvedValue({ id: "11111111-1111-4111-8111-111111111111", userId: 42, category: "fact", value: "Предпочитает русский язык" });
    memoryDb.deleteMemoryEntry.mockResolvedValue(false);
  });

  it("derives all memory reads and writes from the authenticated caller, ignoring a forged client userId", async () => {
    await callerFor(42).memory.get();
    await callerFor(42).memory.addFact({ fact: "Предпочитает русский язык", userId: 999 } as never);

    expect(memoryDb.getMemorySettings).toHaveBeenCalledWith(42);
    expect(memoryDb.getMemoryProfile).toHaveBeenCalledWith(42);
    expect(memoryDb.listMemoryEntries).toHaveBeenNthCalledWith(1, 42, "fact");
    expect(memoryDb.listMemoryEntries).toHaveBeenNthCalledWith(2, 42, "dialog_topic");
    expect(memoryDb.upsertMemoryEntry).toHaveBeenCalledWith(42, "fact", "Предпочитает русский язык", { source: "manual" });
    expect(memoryDb.upsertMemoryEntry).not.toHaveBeenCalledWith(999, expect.anything(), expect.anything(), expect.anything());
  });

  it("returns NOT_FOUND when the authenticated user tries to delete another user's entry", async () => {
    await expect(callerFor(42).memory.deleteEntry({ entryId: "22222222-2222-4222-8222-222222222222" }))
      .rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(memoryDb.deleteMemoryEntry).toHaveBeenCalledWith(42, "22222222-2222-4222-8222-222222222222");
  });
});
