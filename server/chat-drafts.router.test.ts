import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";

const draftDb = vi.hoisted(() => ({
  getOwnedChatDraft: vi.fn(),
  saveOwnedChatDraft: vi.fn(),
  clearOwnedChatDraft: vi.fn(),
}));

vi.mock("./db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./db")>()),
  ...draftDb,
}));

import { appRouter } from "./routers";

const ownChatId = "11111111-1111-4111-8111-111111111111";
const otherChatId = "22222222-2222-4222-8222-222222222222";

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

function guestCaller() {
  return appRouter.createCaller({ user: null, req: { headers: {} } as TrpcContext["req"], res: {} as TrpcContext["res"] });
}

describe("chat draft ownership boundary", () => {
  beforeEach(() => vi.clearAllMocks());

  it("derives draft reads from the verified server user and chat ID", async () => {
    draftDb.getOwnedChatDraft.mockResolvedValue({ content: "Мой черновик", updatedAt: new Date() });

    await expect(callerFor(42).chats.draft({ sessionId: ownChatId })).resolves.toMatchObject({ content: "Мой черновик" });
    expect(draftDb.getOwnedChatDraft).toHaveBeenCalledWith(42, ownChatId);
  });

  it("does not expose a foreign chat draft", async () => {
    draftDb.getOwnedChatDraft.mockRejectedValue(new Error("Чат не найден или недоступен."));

    await expect(callerFor(42).chats.draft({ sessionId: otherChatId })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(draftDb.getOwnedChatDraft).toHaveBeenCalledWith(42, otherChatId);
  });

  it("keeps save and clear scoped to the same verified user and chat", async () => {
    draftDb.saveOwnedChatDraft.mockResolvedValue({ content: "Черновик", updatedAt: new Date() });
    draftDb.clearOwnedChatDraft.mockResolvedValue({ success: true });

    await expect(callerFor(42).chats.saveDraft({ sessionId: ownChatId, content: "Черновик" })).resolves.toMatchObject({ content: "Черновик" });
    await expect(callerFor(42).chats.clearDraft({ sessionId: ownChatId })).resolves.toMatchObject({ success: true });
    expect(draftDb.saveOwnedChatDraft).toHaveBeenCalledWith(42, ownChatId, "Черновик");
    expect(draftDb.clearOwnedChatDraft).toHaveBeenCalledWith(42, ownChatId);
  });

  it("rejects guests before a draft helper is called", async () => {
    await expect(guestCaller().chats.draft({ sessionId: ownChatId })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(draftDb.getOwnedChatDraft).not.toHaveBeenCalled();
  });
});
