import { describe, expect, it } from "vitest";
import { MODEL_ROLES, ROLE_IDS } from "./providers";

describe("v5.5 server-side role safety", () => {
  it("keeps exactly four public role cards and a maximum of four hidden attempts each", () => {
    expect(ROLE_IDS).toEqual(["fast", "smart", "context", "flagship"]);
    expect(MODEL_ROLES).toHaveLength(4);
    expect(MODEL_ROLES.every((role) => role.chain.length === 4)).toBe(true);
  });

  it("uses Google candidates only behind web-research policy and keeps optional reserves server-side", () => {
    for (const role of MODEL_ROLES) {
      const googleCandidate = role.chain.find((candidate) => candidate.provider === "google");
      expect(googleCandidate?.requiresWebResearch).toBe(true);
      expect(role.chain.some((candidate) => candidate.provider === "sambanova" || candidate.provider === "cerebras")).toBe(true);
    }
  });
});
