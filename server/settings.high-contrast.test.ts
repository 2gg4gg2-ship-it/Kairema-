import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { userSettings } from "../drizzle/schema";

const project = "/home/ubuntu/kairema";

describe("high-contrast settings contract", () => {
  it("keeps the persisted column and its safe default", () => {
    expect(userSettings.highContrast.name).toBe("highContrast");
    expect(readFileSync(`${project}/drizzle/migrations/0020_v6j_high_contrast.sql`, "utf8"))
      .toContain("ADD COLUMN `highContrast` int NOT NULL DEFAULT 0");
  });

  it("accepts high contrast only through the server-side settings allowlist", () => {
    const router = readFileSync(`${project}/server/routers.ts`, "utf8");
    const db = readFileSync(`${project}/server/db.ts`, "utf8");
    expect(router).toContain("highContrast: z.boolean().optional()");
    expect(router).toContain("highContrast: highContrast ? 1 : 0");
    expect(db).toContain('"highContrast"');
  });

  it("applies the setting through one root class and exposes only safe diagnostics", () => {
    const context = readFileSync(`${project}/client/src/contexts/ThemeContext.tsx`, "utf8");
    const home = readFileSync(`${project}/client/src/pages/Home.tsx`, "utf8");
    const css = readFileSync(`${project}/client/src/index.css`, "utf8");
    expect(context).toContain('classList.toggle("high-contrast", highContrast)');
    expect(home).toContain("Проверить настройки");
    expect(home).not.toContain("Сортировка экспортов");
    expect(css).toContain(".high-contrast {");
  });
});
