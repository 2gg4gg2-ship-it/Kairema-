import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { userProviderConfigs, userSettings } from "../drizzle/schema";

const root = path.resolve(import.meta.dirname, "..");
const migration = readFileSync(path.join(root, "drizzle/0046_user_provider_configs.sql"), "utf8");
const journal = JSON.parse(readFileSync(path.join(root, "drizzle/meta/_journal.json"), "utf8")) as { entries: Array<{ idx: number; tag: string }> };

/** Column names drizzle would emit for a table, used to compare schema against SQL. */
function columnNames() {
  return Object.values(userProviderConfigs[Symbol.for("drizzle:Columns") as unknown as keyof typeof userProviderConfigs] ?? {});
}

describe("migration 0046 registration", () => {
  it("is registered in the drizzle journal directly after 0045", () => {
    const entry = journal.entries.at(-1);
    expect(entry?.tag).toBe("0046_user_provider_configs");
    expect(entry?.idx).toBe(46);
    expect(journal.entries.at(-2)?.tag).toBe("0045_ask_clarifying_questions");
  });

  it("does not modify any earlier migration", () => {
    const previous = journal.entries.at(-2)!;
    expect(previous.idx).toBe(45);
    expect(journal.entries.filter((entry) => entry.idx <= 45)).toHaveLength(46);
  });
});

describe("migration 0046 sql", () => {
  it("creates the table with a cascade foreign key to users", () => {
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS `user_provider_configs`");
    expect(migration).toMatch(/FOREIGN KEY \(`userId`\) REFERENCES `users`\(`id`\) ON DELETE cascade/);
  });

  it("enforces one row per user and provider", () => {
    expect(migration).toContain("UNIQUE INDEX `user_provider_configs_user_provider_unique` (`userId`,`provider`)");
  });

  it("declares the same columns as the drizzle schema", () => {
    for (const column of ["`id`", "`userId`", "`provider`", "`activeModel`", "`encryptedApiKey`", "`keyHint`", "`createdAt`", "`updatedAt`"]) {
      expect(migration).toContain(column);
    }
    expect(Object.keys(userProviderConfigs).length).toBeGreaterThan(0);
    expect(columnNames().length).toBeGreaterThan(0);
  });

  it("keeps the secret column NOT NULL so a row can never exist without a key", () => {
    expect(migration).toMatch(/`encryptedApiKey` text NOT NULL/);
    expect(migration).toMatch(/`activeModel` varchar\(191\) NOT NULL/);
  });

  it("adds the active provider pointer to user settings", () => {
    expect(migration).toContain("ALTER TABLE `user_settings` ADD COLUMN `myApiProvider` varchar(32)");
    expect("myApiProvider" in userSettings).toBe(true);
  });

  it("contains no destructive statement", () => {
    // ON DELETE cascade is the intended referential action, so only a leading keyword counts.
    expect(migration).not.toMatch(/^\s*DROP\b/im);
    expect(migration).not.toMatch(/^\s*TRUNCATE\b/im);
    expect(migration).not.toMatch(/^\s*DELETE\b/im);
    expect(migration).not.toMatch(/ALTER TABLE .* DROP\b/i);
    expect(migration).toContain("ON DELETE cascade");
  });
});
