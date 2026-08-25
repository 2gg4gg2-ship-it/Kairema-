import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { chatAttachments } from "../drizzle/schema";
import { toVisionImageDataUrl } from "./attachments";

const dbSource = readFileSync(new URL("./db.ts", import.meta.url), "utf8");
const attachmentSource = readFileSync(new URL("./attachments.ts", import.meta.url), "utf8");
const migration = readFileSync(new URL("../drizzle/0024_ancient_talos.sql", import.meta.url), "utf8");

describe("temporary chat attachment lifecycle", () => {
  it("adds an indexed expiration field without destructive schema operations", () => {
    expect(chatAttachments.expiresAt.name).toBe("expiresAt");
    expect(migration).toContain("ALTER TABLE `chat_attachments` ADD `expiresAt` timestamp NULL");
    expect(migration).toContain("CREATE INDEX `chat_attachments_expires_idx`");
    expect(migration).not.toMatch(/DROP|TRUNCATE/i);
  });

  it("sets a short retention period and blocks access to expired metadata", () => {
    expect(dbSource).toContain("const CHAT_ATTACHMENT_RETENTION_MS = 24 * 60 * 60 * 1000");
    expect(dbSource).toContain("expiresAt: new Date(Date.now() + CHAT_ATTACHMENT_RETENTION_MS)");
    expect(dbSource).toContain("gt(chatAttachments.expiresAt, now)");
    expect(dbSource).toContain("cleanupExpiredChatAttachments");
  });

  it("creates a request-only inline image payload without accepting documents", () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(toVisionImageDataUrl("image/png", png)).toMatch(/^data:image\/png;base64,/);
    expect(() => toVisionImageDataUrl("application/pdf", Buffer.from("%PDF-"))).toThrow("PNG, JPG и WEBP");
  });

  it("requires an owner-scoped attachment lookup before issuing any download URL", () => {
    const download = attachmentSource.match(/export async function getOwnedAttachmentDownload[\s\S]*?\n}\n/)?.[0] ?? "";
    expect(download).toContain("getOwnedChatAttachment(userId, attachmentId)");
    expect(download).toContain("Вложение не найдено или недоступно");
    expect(download.indexOf("getOwnedChatAttachment(userId, attachmentId)")).toBeLessThan(download.indexOf("storageGetSignedUrl(record.fileKey)"));
  });
});
