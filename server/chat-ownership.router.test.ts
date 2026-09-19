import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";

const chatDb = vi.hoisted(() => ({
  updateChatTitle: vi.fn(),
  listSessionAttachments: vi.fn(),
  listOwnedChatExports: vi.fn(),
  deleteOwnedChatExport: vi.fn(),
}));

vi.mock("./db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./db")>()),
  ...chatDb,
}));

const attachmentService = vi.hoisted(() => ({
  getOwnedAttachmentDownload: vi.fn(),
}));

vi.mock("./attachments", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./attachments")>()),
  ...attachmentService,
}));

const exportService = vi.hoisted(() => ({
  createPersistentChatExport: vi.fn(),
  getOwnedChatExportDownload: vi.fn(),
}));

vi.mock("./chat-exports", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./chat-exports")>()),
  ...exportService,
}));

import { appRouter } from "./routers";

const sessionId = "11111111-1111-4111-8111-111111111111";
const exportId = "22222222-2222-4222-8222-222222222222";

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

describe("chat router ownership", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns NOT_FOUND when an authenticated user tries to rename another user's chat", async () => {
    chatDb.updateChatTitle.mockResolvedValue(false);

    await expect(callerFor(42).chats.rename({ sessionId, title: "Чужой чат" }))
      .rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(chatDb.updateChatTitle).toHaveBeenCalledWith(42, sessionId, "Чужой чат");
  });

  it("returns success only after the owner-scoped title update succeeds", async () => {
    chatDb.updateChatTitle.mockResolvedValue(true);

    await expect(callerFor(42).chats.rename({ sessionId, title: "Мой чат" }))
      .resolves.toEqual({ success: true });
    expect(chatDb.updateChatTitle).toHaveBeenCalledWith(42, sessionId, "Мой чат");
  });
});

describe("attachment router ownership", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns NOT_FOUND when an authenticated user lists another user's chat attachments", async () => {
    chatDb.listSessionAttachments.mockRejectedValue(new Error("Чат не найден или недоступен."));

    await expect(callerFor(42).attachments.list({ sessionId }))
      .rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(chatDb.listSessionAttachments).toHaveBeenCalledWith(42, sessionId);
    expect(attachmentService.getOwnedAttachmentDownload).not.toHaveBeenCalled();
  });
});

describe("persistent export router ownership", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns NOT_FOUND without listing a foreign chat's exports", async () => {
    chatDb.listOwnedChatExports.mockRejectedValue(new Error("Чат не найден или недоступен."));

    await expect(callerFor(42).exports.list({ sessionId }))
      .rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(chatDb.listOwnedChatExports).toHaveBeenCalledWith(42, sessionId);
  });

  it("returns NOT_FOUND when creating an export for a foreign chat", async () => {
    exportService.createPersistentChatExport.mockRejectedValue(new Error("Чат не найден или недоступен."));

    await expect(callerFor(42).exports.create({ sessionId, format: "markdown" }))
      .rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(exportService.createPersistentChatExport).toHaveBeenCalledWith(42, { sessionId, format: "markdown" });
  });

  it("returns NOT_FOUND before returning a foreign export signed URL", async () => {
    exportService.getOwnedChatExportDownload.mockRejectedValue(new Error("Экспорт не найден или недоступен."));

    await expect(callerFor(42).exports.download({ exportId }))
      .rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(exportService.getOwnedChatExportDownload).toHaveBeenCalledWith(42, exportId);
  });

  it("returns NOT_FOUND when deleting a foreign export record", async () => {
    chatDb.deleteOwnedChatExport.mockResolvedValue(false);

    await expect(callerFor(42).exports.delete({ exportId }))
      .rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(chatDb.deleteOwnedChatExport).toHaveBeenCalledWith(42, exportId);
  });
});
