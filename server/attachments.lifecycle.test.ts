import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { chatAttachments } from "../drizzle/schema";

const dbSource = readFileSync(new URL("./db.ts", import.meta.url), "utf8");
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
});
