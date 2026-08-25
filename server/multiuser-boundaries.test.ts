import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { requireOwnedSession } from "./db";

const source = (file: string) => readFileSync(new URL(`./${file}`, import.meta.url), "utf8");

describe("multi-user server boundaries", () => {
  it("rejects a cross-user chat session before messages or exports can be read", () => {
    expect(() => requireOwnedSession(101, { id: "chat-b", userId: 202 })).toThrow("Чат не найден или недоступен.");
  });

  it("keeps attachment upload, download and vision paths bound to the authenticated server user", () => {
    const uploadRoute = source("attachment-upload.ts");
    const attachmentService = source("attachments.ts");
    expect(uploadRoute).toContain("sdk.authenticateRequest(req)");
    expect(uploadRoute).toContain("uploadOwnedChatAttachmentBytes(user.id");
    expect(attachmentService).toContain("attachments/${userId}/${input.sessionId}/");
    expect(attachmentService).toContain("getOwnedChatAttachment(userId, attachmentId)");
  });

  it("retrieves chat attachments and personal memory only with the server-derived user scope", () => {
    const context = source("chat-context.ts");
    expect(context).toContain("getOwnedChatAttachments(userId, sessionId");
    expect(context).toContain("getOwnedAttachmentVisionDataUrl(userId, attachment.id)");
    expect(context).toContain("getMemorySettings(userId)");
    expect(context).toContain("getMemoryProfile(userId)");
    expect(context).toContain("listMemoryEntries(userId");
  });
});
