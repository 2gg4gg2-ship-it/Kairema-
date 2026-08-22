import { describe, expect, it } from "vitest";
import { ownerClaimFingerprint } from "./owner-claim";

describe("owner claim diagnostic", () => {
  it("returns only a stable one-way comparison token", () => {
    const fingerprint = ownerClaimFingerprint("owner-open-id-example");

    expect(fingerprint).toMatch(/^sha256:[a-f0-9]{12}$/);
    expect(fingerprint).not.toContain("owner-open-id-example");
    expect(ownerClaimFingerprint("owner-open-id-example")).toBe(fingerprint);
    expect(ownerClaimFingerprint("")).toBe("not-configured");
  });
});
