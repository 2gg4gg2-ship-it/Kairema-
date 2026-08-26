import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./_core/trpc.ts", import.meta.url), "utf8");

describe("tRPC unexpected-error boundary", () => {
  it("converts unexpected internal errors to a stable client-safe message and removes stack data", () => {
    expect(source).toContain('errorFormatter({ shape, error })');
    expect(source).toContain('if (error.code !== "INTERNAL_SERVER_ERROR") return shape;');
    expect(source).toContain('message: "Внутренняя ошибка сервера. Повторите попытку позже."');
    expect(source).toContain('const { stack: _stack, ...safeData } = shape.data;');
  });

  it("preserves existing deliberate protected and owner error contracts", () => {
    expect(source).toContain('throw new TRPCError({ code: "UNAUTHORIZED", message: UNAUTHED_ERR_MSG })');
    expect(source).toContain('throw new TRPCError({ code: "FORBIDDEN", message: NOT_ADMIN_ERR_MSG })');
  });
});
