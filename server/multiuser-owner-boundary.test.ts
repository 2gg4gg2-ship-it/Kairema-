import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = (file: string) => readFileSync(new URL(`./_core/${file}`, import.meta.url), "utf8");

describe("multi-user owner and admin boundary", () => {
  it("derives protected access from the server context user", () => {
    const trpc = source("trpc.ts");
    expect(trpc).toContain("if (!ctx.user)");
    expect(trpc).toContain("export const protectedProcedure = t.procedure.use(requireUser)");
  });

  it("keeps admin-only actions behind a server-side admin role gate", () => {
    const trpc = source("trpc.ts");
    const systemRouter = source("systemRouter.ts");
    expect(trpc).toContain("ctx.user.role !== 'admin'");
    expect(systemRouter).toContain("notifyOwner: adminProcedure");
  });

  it("keeps owner mapping sourced from server environment rather than the client bundle", () => {
    const env = source("env.ts");
    expect(env).toContain("ownerEmail: process.env.OWNER_EMAIL ?? \"\"");
    expect(env).toContain("ownerOpenId: process.env.OWNER_OPEN_ID ?? \"\"");
  });

  it("decides owner access from the configured owner email and fails closed without it", () => {
    const ownerAccess = readFileSync(new URL(`./owner-access.ts`, import.meta.url), "utf8");
    // The email claim is mandatory: an unset OWNER_EMAIL must resolve to "no owner" rather than
    // falling back to the legacy openId and authorising somebody else.
    expect(ownerAccess).toContain("if (!ownerEmail) return false;");
    expect(ownerAccess).toContain("normalizeEmail(candidate.email) !== ownerEmail");
    // The legacy openId may only narrow the match, never widen it.
    expect(ownerAccess).toContain("if (ownerOpenId && candidate.openId !== ownerOpenId) return false;");
  });

  it("routes every owner procedure through the single server-side owner gate", () => {
    const routers = readFileSync(new URL(`./routers.ts`, import.meta.url), "utf8");
    expect(routers).toContain("if (!isOwnerAccount(ctx.user ?? undefined))");
    // No owner procedure may fall back to comparing the raw openId configuration itself.
    expect(routers).not.toContain("ENV.ownerOpenId");
  });
});
