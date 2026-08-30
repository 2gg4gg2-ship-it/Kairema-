import { describe, expect, it } from "vitest";
import { createSourceSafeStreamFilter, MAX_ATTEMPTS, MODEL_ROLES, PUBLIC_DASHBOARD_PROVIDERS, ROLE_IDS, sanitizeAssistantContent } from "./providers";

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
      expect(role.chain.some((candidate) => candidate.provider === "sambanova" || candidate.provider === "cerebras")).toBe(false);
    }
    expect(MODEL_ROLES.some((role) => role.chain.some((candidate) => candidate.provider === "orcarouter"))).toBe(true);
  });

  it("removes URL lists and markdown links from assistant text server-side", () => {
    const content = sanitizeAssistantContent("Проверенный вывод.\n\nИсточники:\n- https://example.com/very/long/path\n[Документ](https://example.org/doc)");
    expect(content).toBe("Проверенный вывод.");
    expect(content).not.toMatch(/https?:\/\//i);
  });

  it("removes technical citation identifiers from complete and fragmented streamed assistant text", () => {
    const lineBufferedFilter = createSourceSafeStreamFilter();
    expect(lineBufferedFilter("Подтверждённый факт [source-001]\n")).toBe("");
    expect(lineBufferedFilter("", true)).toBe("Подтверждённый факт");
    const bracketFilter = createSourceSafeStreamFilter();
    expect(bracketFilter("Другой факт 【turn0search7†L3-L7】\n")).toBe("");
    expect(bracketFilter("", true)).toBe("Другой факт");
    const fragmentedFilter = createSourceSafeStreamFilter();
    expect(fragmentedFilter("Фрагмент ⟦citation: web-42⟧ готов", true)).toBe("Фрагмент готов");
    expect(sanitizeAssistantContent("Подтверждённый вывод \\[a3b2c1d0e9f8a7b6, c4d3e2f1a0b9c8d7\\].")).toBe("Подтверждённый вывод.");
    expect(sanitizeAssistantContent("Подтверждённый вывод \\\\[a3b2c1d0e9f8a7b6, c4d3e2f1a0b9c8d7\\\\].")).toBe("Подтверждённый вывод.");
    const escapedIdsFilter = createSourceSafeStreamFilter();
    expect(escapedIdsFilter("Поток \\[a3b2c1d0e9f8a7b6, c4d3e2f1a0b9c8d7\\].", true)).toBe("Поток.");
    expect(sanitizeAssistantContent("Обычный массив [1, 2] не является ссылкой.")).toBe("Обычный массив [1, 2] не является ссылкой.");
    expect(sanitizeAssistantContent("Утверждение подтверждено [1].")).toBe("Утверждение подтверждено.");
  });

  it("exposes OrcaRouter and the three primary public providers in the dashboard allowlist", () => {
    expect(PUBLIC_DASHBOARD_PROVIDERS).toEqual(["openrouter", "orcarouter", "google", "groq"]);
    expect(PUBLIC_DASHBOARD_PROVIDERS).not.toContain("sambanova");
    expect(PUBLIC_DASHBOARD_PROVIDERS).not.toContain("cerebras");
    expect(PUBLIC_DASHBOARD_PROVIDERS).not.toContain("mistral");
  });
});
