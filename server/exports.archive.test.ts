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
});
