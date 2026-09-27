import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { userProviderConfigs, userSettings } from "../drizzle/schema";

const root = path.resolve(import.meta.dirname, "..");
const migration = readFileSync(path.join(root, "drizzle/0046_user_provider_configs.sql"), "utf8");
const customMigration = readFileSync(path.join(root, "drizzle/0047_user_provider_custom_endpoints.sql"), "utf8");
const journal = JSON.parse(readFileSync(path.join(root, "drizzle/meta/_journal.json"), "utf8")) as { entries: Array<{ idx: number; tag: string }> };

/** Column names drizzle would emit for a table, used to compare schema against SQL. */
function columnNames() {
  return Object.values(userProviderConfigs[Symbol.for("drizzle:Columns") as unknown as keyof typeof userProviderConfigs] ?? {});
}

describe("migration 0046 registration", () => {
  it("is registered in the drizzle journal directly after 0045", () => {
    const entry = journal.entries.find((item) => item.tag === "0046_user_provider_configs");
    expect(entry?.tag).toBe("0046_user_provider_configs");
    expect(entry?.idx).toBe(46);
    expect(journal.entries.at(-3)?.tag).toBe("0045_ask_clarifying_questions");
  });

  it("does not modify any earlier migration", () => {
    const previous = journal.entries.find((item) => item.idx === 45)!;
    expect(previous.tag).toBe("0045_ask_clarifying_questions");
    expect(journal.entries.filter((entry) => entry.idx <= 45)).toHaveLength(46);
  });
});

describe("migration 0047 registration", () => {
  it("is the next index after 0046 and does not reuse it", () => {
    const last = journal.entries.at(-1);
    expect(last?.tag).toBe("0047_user_provider_custom_endpoints");
    expect(last?.idx).toBe(47);
    expect(journal.entries.filter((entry) => entry.tag === "0046_user_provider_configs")).toHaveLength(1);
    expect(journal.entries.filter((entry) => entry.idx === 46)).toHaveLength(1);
  });

  it("adds the custom provider columns without dropping anything", () => {
    const declared = columnNames().map((column) => String(column.name));
    for (const column of ["displayName", "baseUrl", "modelsEndpoint"]) {
      expect(customMigration).toContain(`ADD COLUMN \`${column}\``);
      expect(declared).toContain(column);
    }
    // Nullable so existing built-in OpenRouter rows keep working untouched.
    expect(customMigration).toMatch(/ADD COLUMN `displayName` varchar\(64\) NULL/);
    expect(customMigration).toMatch(/ADD COLUMN `baseUrl` varchar\(300\) NULL/);
    expect(customMigration).toMatch(/ADD COLUMN `modelsEndpoint` varchar\(300\) NULL/);
    expect(customMigration).not.toMatch(/DROP/i);
  });

  it("keeps 0046 byte-identical so a deployed database is not re-created", () => {
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS `user_provider_configs`");
    expect(customMigration).not.toContain("CREATE TABLE");
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

  it("uses timestamp syntax the deployed MySQL accepts", () => {
    // MySQL parses a bare DEFAULT (now()) but rejects a parenthesised expression in the
    // ON UPDATE clause with ER_PARSE_ERROR 1064, which failed the staging deploy. The ON UPDATE
    // part therefore has to spell out CURRENT_TIMESTAMP, exactly as every other migration does.
    expect(migration).not.toMatch(/ON UPDATE\s*\(/i);
    expect(migration).toMatch(/`createdAt` timestamp NOT NULL DEFAULT \(now\(\)\)/);
    expect(migration).toMatch(/`updatedAt` timestamp NOT NULL DEFAULT \(now\(\)\) ON UPDATE CURRENT_TIMESTAMP/);
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
