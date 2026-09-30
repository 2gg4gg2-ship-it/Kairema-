import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { ROLE_IDS } from "./providers";

const root = path.resolve(import.meta.dirname, "..");
const migration = readFileSync(path.join(root, "drizzle/0050_per_role_chat_rate_windows.sql"), "utf8");
const journal = JSON.parse(readFileSync(path.join(root, "drizzle/meta/_journal.json"), "utf8")) as { entries: Array<{ idx: number; tag: string }> };
const schemaSource = readFileSync(path.join(root, "drizzle/schema.ts"), "utf8");

/** The migration body with comments stripped, which is what MySQL actually receives. */
function sqlBody() {
  return migration.replace(/--[^\n]*/g, "").trim();
}

describe("migration 0050 registration", () => {
  it("is the next index after 0049 and reuses no index", () => {
    const entry = journal.entries.find((item) => item.tag === "0050_per_role_chat_rate_windows");
    expect(entry?.tag).toBe("0050_per_role_chat_rate_windows");
    expect(entry?.idx).toBe(50);
    expect(journal.entries.find((item) => item.tag === "0049_user_profile_details")!.idx).toBe(49);
    expect(journal.entries.filter((item) => item.idx === 50)).toHaveLength(1);
  });

  it("does not modify any earlier migration", () => {
    expect(journal.entries.find((item) => item.idx === 49)?.tag).toBe("0049_user_profile_details");
    expect(journal.entries.filter((entry) => entry.idx <= 49)).toHaveLength(50);
  });
});

describe("migration 0050 sql", () => {
  it("is a single statement", () => {
    // This migrator hands the file to the driver as one statement, so stacked ALTER TABLEs were
    // rejected by MySQL with ER_PARSE_ERROR in 0049 and stopped a staging deploy.
    const body = sqlBody();
    expect(body.match(/;/g)).toHaveLength(1);
    expect(body.match(/ALTER TABLE/gi)).toHaveLength(1);
  });

  it("adds the role column and moves the primary key onto user and role in that one statement", () => {
    const body = sqlBody();
    expect(body).toMatch(/ADD COLUMN `roleId` varchar\(24\) NOT NULL/i);
    expect(body).toMatch(/DROP PRIMARY KEY/);
    expect(body).toMatch(/ADD PRIMARY KEY \(`userId`, ?`roleId`\)/);
  });

  it("is additive and non-destructive", () => {
    const body = sqlBody();
    expect(body).not.toMatch(/\bDROP\s+TABLE\b/i);
    expect(body).not.toMatch(/\bTRUNCATE\b/i);
    expect(body).not.toMatch(/\bDELETE\b/i);
    // Dropping the old single-column key is required to install the composite one; no column or
    // table is removed, so existing counters and all user data survive.
    expect(body).not.toMatch(/DROP COLUMN/i);
    expect(body).not.toMatch(/DROP TABLE/i);
  });

  it("leaves the My API (BYOK) budget table untouched", () => {
    // BYOK runs on the caller's own key and keeps its own budget; mixing it into the role split
    // would let BYOK usage spend a Kairema role's allowance.
    expect(sqlBody()).not.toContain("my_api_rate_windows");
    expect(sqlBody()).not.toContain("myApiRateWindows");
  });
});

describe("chat stream rate window schema", () => {
  it("keys the ordinary chat quota by user and role together", () => {
    expect(schemaSource).toContain('mysqlTable("chat_stream_rate_windows"');
    expect(schemaSource).toContain("primaryKey({ columns: [table.userId, table.roleId] })");
  });

  it("keeps the My API quota on its own single-column user key", () => {
    expect(schemaSource).toContain('mysqlTable("my_api_rate_windows"');
    expect(schemaSource).toContain("roleId: varchar(\"roleId\", { length: 24 }).notNull()");
  });

  it("names the four public role slugs the quota accepts", () => {
    expect([...ROLE_IDS].sort()).toEqual(["context", "fast", "flagship", "smart"]);
  });
});
