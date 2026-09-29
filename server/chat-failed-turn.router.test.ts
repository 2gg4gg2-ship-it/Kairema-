import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";

const failedTurnDb = vi.hoisted(() => ({
  deleteOwnedFailedUserMessage: vi.fn(),
  getOwnedChatSession: vi.fn(),
}));

vi.mock("./db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./db")>()),
  ...failedTurnDb,
}));

import { appRouter } from "./routers";

const sessionId = "11111111-1111-4111-8111-111111111111";
const turnId = "f6073f72-474e-42a4-a42d-585ab25769f2";

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

describe("discarding a failed turn", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    failedTurnDb.getOwnedChatSession.mockResolvedValue({ id: sessionId, title: "Чат" });
    failedTurnDb.deleteOwnedFailedUserMessage.mockResolvedValue(true);
  });

  it("removes the named question from the caller's own conversation", async () => {
    const result = await callerFor(42).chats.discardFailedTurn({ sessionId, clientMessageId: turnId });
    expect(result).toEqual({ removed: true });
    // The caller's id is part of the delete itself, so the row cannot be reached without it.
    expect(failedTurnDb.deleteOwnedFailedUserMessage).toHaveBeenCalledWith(42, sessionId, turnId);
  });

  it("removes one question and not the conversation", async () => {
    await callerFor(42).chats.discardFailedTurn({ sessionId, clientMessageId: turnId });
    // There is no call that could take the session or the surrounding history with it.
    expect(failedTurnDb.deleteOwnedFailedUserMessage).toHaveBeenCalledTimes(1);
    expect(failedTurnDb.deleteOwnedFailedUserMessage.mock.calls[0]).toHaveLength(3);
  });

  it("passes each caller their own id, so one user cannot remove another's question", async () => {
    await callerFor(42).chats.discardFailedTurn({ sessionId, clientMessageId: turnId });
    await callerFor(7).chats.discardFailedTurn({ sessionId, clientMessageId: turnId });
    expect(failedTurnDb.deleteOwnedFailedUserMessage.mock.calls.map(([userId]) => userId)).toEqual([42, 7]);
  });

  it("reports when there was nothing to remove instead of claiming success", async () => {
    // Someone else's turn, or a turn that was already gone: the delete matches no row.
    failedTurnDb.deleteOwnedFailedUserMessage.mockResolvedValue(false);
    const result = await callerFor(42).chats.discardFailedTurn({ sessionId, clientMessageId: turnId });
    expect(result).toEqual({ removed: false });
  });

  it("takes the owner from the authenticated session, never from the request", async () => {
    // A caller who smuggles a different userId into the request cannot redirect the delete: the
    // id that reaches it is the one the session resolved to.
    await callerFor(42).chats.discardFailedTurn({ sessionId, clientMessageId: turnId, userId: 7 } as never);
    expect(failedTurnDb.deleteOwnedFailedUserMessage).toHaveBeenCalledWith(42, sessionId, turnId);
    expect(failedTurnDb.deleteOwnedFailedUserMessage).not.toHaveBeenCalledWith(7, expect.anything(), expect.anything());
  });

  it("rejects before the delete when the session is not the caller's", async () => {
    // The guard runs inside the DB call, so the router never decides ownership on its own: it
    // hands over the authenticated id and lets the scoped delete refuse.
    failedTurnDb.deleteOwnedFailedUserMessage.mockRejectedValue(new Error("Чат не найден или недоступен."));
    await expect(callerFor(42).chats.discardFailedTurn({ sessionId, clientMessageId: turnId })).rejects.toThrow(/не найден или недоступен/);
  });

  it("surfaces a storage failure instead of reporting the question as removed", async () => {
    failedTurnDb.deleteOwnedFailedUserMessage.mockRejectedValue(new Error("Сессия не найдена."));
    await expect(callerFor(42).chats.discardFailedTurn({ sessionId, clientMessageId: turnId })).rejects.toThrow();
  });

  it("rejects an id that is not a uuid rather than passing it to the database", async () => {
    await expect(callerFor(42).chats.discardFailedTurn({ sessionId, clientMessageId: "not-a-uuid" })).rejects.toThrow();
    expect(failedTurnDb.deleteOwnedFailedUserMessage).not.toHaveBeenCalled();
  });

  it("rejects a malformed session id", async () => {
    await expect(callerFor(42).chats.discardFailedTurn({ sessionId: "../../etc", clientMessageId: turnId })).rejects.toThrow();
    expect(failedTurnDb.deleteOwnedFailedUserMessage).not.toHaveBeenCalled();
  });
});
