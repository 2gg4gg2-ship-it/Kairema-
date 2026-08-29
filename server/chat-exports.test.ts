import { beforeEach, describe, expect, it, vi } from "vitest";

const exportDb = vi.hoisted(() => ({
  createChatExport: vi.fn(),
  getOwnedChatExport: vi.fn(),
  getOwnedChatSession: vi.fn(),
  listSessionMessages: vi.fn(),
}));

const storage = vi.hoisted(() => ({
  storageGetSignedUrl: vi.fn(),
  storagePut: vi.fn(),
}));

vi.mock("./db", () => exportDb);
vi.mock("./storage-s3", () => storage);

import { createPersistentChatExport, getOwnedChatExportDownload } from "./chat-exports";

const userId = 42;
const sessionId = "11111111-1111-4111-8111-111111111111";
const exportId = "22222222-2222-4222-8222-222222222222";

describe("persistent chat export service", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects a foreign session before reading messages or writing an artifact", async () => {
    exportDb.getOwnedChatSession.mockResolvedValue(undefined);

    await expect(createPersistentChatExport(userId, { sessionId, format: "markdown" }))
      .rejects.toThrow("Чат не найден или недоступен.");
    expect(exportDb.getOwnedChatSession).toHaveBeenCalledWith(userId, sessionId);
    expect(exportDb.listSessionMessages).not.toHaveBeenCalled();
    expect(storage.storagePut).not.toHaveBeenCalled();
    expect(exportDb.createChatExport).not.toHaveBeenCalled();
  });

  it("writes a Markdown artifact only under the verified owner's export prefix", async () => {
    exportDb.getOwnedChatSession.mockResolvedValue({ id: sessionId, title: "Мой чат" });
    exportDb.listSessionMessages.mockResolvedValue([{ role: "user", content: "Привет", createdAt: new Date() }]);
    storage.storagePut.mockResolvedValue({ key: "exports/42/object.md", url: "https://storage.invalid/object.md" });
    exportDb.createChatExport.mockResolvedValue({ id: exportId, userId, sessionId, fileName: "Мой чат.md" });

    await expect(createPersistentChatExport(userId, { sessionId, format: "markdown" })).resolves.toMatchObject({ id: exportId, userId, sessionId });
    expect(storage.storagePut).toHaveBeenCalledWith(expect.stringMatching(new RegExp(`^exports/${userId}/${sessionId}/[0-9a-f-]+\\.md$`)), expect.any(Buffer), "text/markdown; charset=utf-8");
    expect(exportDb.createChatExport).toHaveBeenCalledWith(userId, expect.objectContaining({ sessionId, format: "markdown", fileKey: "exports/42/object.md" }));
  });

  it("rejects a foreign export before requesting a signed URL", async () => {
    exportDb.getOwnedChatExport.mockResolvedValue(undefined);

    await expect(getOwnedChatExportDownload(userId, exportId))
      .rejects.toThrow("Экспорт не найден или недоступен.");
    expect(exportDb.getOwnedChatExport).toHaveBeenCalledWith(userId, exportId);
    expect(storage.storageGetSignedUrl).not.toHaveBeenCalled();
  });

  it("requests a signed URL only for the owner-scoped export record", async () => {
    exportDb.getOwnedChatExport.mockResolvedValue({ id: exportId, userId, fileKey: "exports/42/object.md" });
    storage.storageGetSignedUrl.mockResolvedValue("https://storage.invalid/signed");

    await expect(getOwnedChatExportDownload(userId, exportId)).resolves.toMatchObject({ url: "https://storage.invalid/signed", export: { id: exportId } });
    expect(storage.storageGetSignedUrl).toHaveBeenCalledWith("exports/42/object.md");
  });
});
