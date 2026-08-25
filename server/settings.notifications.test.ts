import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { userSettings } from "../drizzle/schema";

const project = "/home/ubuntu/kairema";

describe("notification preference contract", () => {
  it("keeps a user-scoped persisted consent column with a safe opt-out default", () => {
    expect(userSettings.emailNotifications.name).toBe("emailNotifications");
    expect(readFileSync(`${project}/drizzle/0030_confused_starbolt.sql`, "utf8"))
      .toContain("ADD `emailNotifications` int DEFAULT 0 NOT NULL");
  });

  it("accepts notification consent only through the protected settings allowlist", () => {
    const router = readFileSync(`${project}/server/routers.ts`, "utf8");
    const db = readFileSync(`${project}/server/db.ts`, "utf8");
    expect(router).toContain("emailNotifications: z.boolean().optional()");
    expect(router).toContain("emailNotifications: emailNotifications ? 1 : 0");
    expect(db).toContain('"emailNotifications"');
  });

  it("derives settings reads and patches from the authenticated context instead of client user input", () => {
    const router = readFileSync(`${project}/server/routers.ts`, "utf8");
    expect(router).toContain("getUserSettings(ctx.user.id)");
    expect(router).toContain("updateUserSettings(ctx.user.id, {");
    expect(router).not.toMatch(/settings:\s*router\([\s\S]{0,900}userId:\s*z\./);
  });

  it("exposes a preference control without implementing email delivery or storing client secrets", () => {
    const home = readFileSync(`${project}/client/src/pages/Home.tsx`, "utf8");
    expect(home).toContain("Email-уведомления");
    expect(home).toContain("отправка пока не подключена");
    expect(home).not.toMatch(/sendMail|nodemailer|RESEND_API_KEY|SMTP_/);
  });
});
