import { describe, expect, it } from "vitest";
import { isOwnedChatExport } from "./db";

describe("export history ownership", () => {
  it("allows only the export owner to manage a record", () => {
    expect(isOwnedChatExport(12, { userId: 12 })).toBe(true);
    expect(isOwnedChatExport(12, { userId: 13 })).toBe(false);
    expect(isOwnedChatExport(12, undefined)).toBe(false);
  });
});

