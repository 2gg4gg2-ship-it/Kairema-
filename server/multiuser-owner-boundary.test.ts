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
    expect(env).toContain("ownerOpenId: process.env.OWNER_OPEN_ID ?? \"\"");
  });
});
