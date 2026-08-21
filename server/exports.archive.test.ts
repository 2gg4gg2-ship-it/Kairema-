import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { chatExports } from "../drizzle/schema";

const migration = readFileSync(new URL("../drizzle/migrations/0019_v6j_export_archive.sql", import.meta.url), "utf8");
const dbSource = readFileSync(new URL("./db.ts", import.meta.url), "utf8");
const routerSource = readFileSync(new URL("./routers.ts", import.meta.url), "utf8");

describe("export archive contract", () => {
  it("keeps archive state explicit, non-destructive and false for existing exports", () => {
    expect(chatExports.archived.name).toBe("archived");
    expect(migration).toContain("ADD COLUMN `archived` boolean NOT NULL DEFAULT false");
    expect(migration).not.toMatch(/DROP|DELETE|TRUNCATE/i);
  });

  it("filters and updates archive state only within the signed-in user's scope", () => {
    expect(dbSource).toContain('filter: "all" | "active" | "archived" = "all"');
    expect(dbSource).toContain("and(eq(chatExports.id, exportId), eq(chatExports.userId, userId))");
    expect(routerSource).toContain("archive: protectedProcedure");
    expect(routerSource).toContain("archiveChatExport(ctx.user.id, input.exportId, input.archived)");
  });

  it("searches private owner-scoped export text and filenames, returning a snippet without file storage data", () => {
    expect(dbSource).toContain("export async function searchChatExports(userId: number, query: string");
    expect(dbSource).toContain("eq(chatExports.userId, userId)");
    expect(dbSource).toContain("like(chatExports.fileName");
    expect(dbSource).toContain("like(chatExports.searchText");
    expect(dbSource).toContain("function exportSearchSnippet");
    expect(dbSource).toContain("isNull(chatExports.searchText)");
    expect(dbSource).toContain("function toChatExportListItem");
    expect(dbSource).toContain('Omit<ChatExport, "fileKey" | "searchText">');
    expect(dbSource).not.toContain("searchChatExports(userId: number, query: string, fileKey");
    expect(routerSource).toContain("search: protectedProcedure");
    expect(routerSource).toContain("searchChatExports(ctx.user.id, input.query, input.filter)");
    expect(routerSource).toContain("searchText: z.string().trim().min(1).max(2_500_000)");
  });

  it("limits batch archive requests, deduplicates ids and keeps the operation user-scoped", () => {
    expect(dbSource).toContain("Array.from(new Set(exportIds)).slice(0, 50)");
    expect(dbSource).toContain("inArray(chatExports.id, ids)");
    expect(dbSource).toContain("eq(chatExports.archived, !archived)");
    expect(routerSource).toContain("batchArchive: protectedProcedure");
    expect(routerSource).toContain("z.array(z.string().uuid()).min(1).max(50)");
    expect(routerSource).toContain("batchArchiveChatExports(ctx.user.id, input.exportIds, input.archived)");
  });
});
