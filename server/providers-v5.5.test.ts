import { describe, expect, it } from "vitest";
import { MAX_ATTEMPTS, MODEL_ROLES, PUBLIC_DASHBOARD_PROVIDERS, ROLE_IDS, sanitizeAssistantContent } from "./providers";

describe("v5.5 server-side role safety", () => {
  it("keeps exactly four public role cards and a maximum of four real upstream attempts", () => {
    expect(ROLE_IDS).toEqual(["fast", "smart", "context", "flagship"]);
    expect(MODEL_ROLES).toHaveLength(4);
    expect(MODEL_ROLES.every((role) => role.chain.slice(0, MAX_ATTEMPTS).length === 4)).toBe(true);
    expect(MODEL_ROLES.find((role) => role.key === "context")?.chain[4]?.provider).toBe("dots");
  });

  it("uses Google candidates only behind web-research policy and keeps OrcaRouter in server-side chains", () => {
    for (const role of MODEL_ROLES) {
      const googleCandidate = role.chain.find((candidate) => candidate.provider === "google");
      expect(googleCandidate?.requiresWebResearch).toBe(true);
      expect(googleCandidate?.vision).toBe(true);
      expect(googleCandidate?.modelId).toBe("gemini-flash-lite-latest");
      expect(role.chain.some((candidate) => candidate.provider === "orcarouter")).toBe(true);
      expect(role.chain.some((candidate) => candidate.provider === "sambanova" || candidate.provider === "cerebras")).toBe(false);
    }
  });

  it("removes URL lists and markdown links from assistant text server-side", () => {
    const content = sanitizeAssistantContent("Проверенный вывод.\n\nИсточники:\n- https://example.com/very/long/path\n[Документ](https://example.org/doc)");
    expect(content).toBe("Проверенный вывод.");
    expect(content).not.toMatch(/https?:\/\//i);
  });

  it("exposes OrcaRouter and the three primary public providers in the dashboard allowlist", () => {
    expect(PUBLIC_DASHBOARD_PROVIDERS).toEqual(["openrouter", "orcarouter", "google", "groq"]);
    expect(PUBLIC_DASHBOARD_PROVIDERS).not.toContain("sambanova");
    expect(PUBLIC_DASHBOARD_PROVIDERS).not.toContain("cerebras");
    expect(PUBLIC_DASHBOARD_PROVIDERS).not.toContain("mistral");
  });
});
