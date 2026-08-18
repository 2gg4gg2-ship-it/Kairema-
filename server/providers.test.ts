import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PROVIDER_REGISTRY, buildGoogleContents, buildUpstreamMessages, classifyProviderFailure, extractGeminiText, providerRequestUrl, toPublicProviderView } from "./providers";

describe("Kairema provider registry", () => {
  it("contains exactly six permanently declared providers", () => {
    expect(PROVIDER_REGISTRY.map((provider) => provider.id)).toEqual(["deepseek", "gemma", "gemini", "openai", "kimi", "grok"]);
    expect(PROVIDER_REGISTRY).toHaveLength(6);
    expect(PROVIDER_REGISTRY.find((provider) => provider.id === "grok")?.model).toBe("grok-4.6");
    expect(PROVIDER_REGISTRY.find((provider) => provider.id === "kimi")?.model).toBe("kimi-k2.6");
  });

  it("keeps all provider credentials server-side and binds every registry entry to its own endpoint convention", () => {
    expect(PROVIDER_REGISTRY.map(({ id, env, kind }) => ({ id, env, kind }))).toEqual([
      { id: "deepseek", env: "DEEPSEEK_API_KEY", kind: "openai" },
      { id: "gemma", env: "GEMINI_API_KEY", kind: "google" },
      { id: "gemini", env: "GEMINI_API_KEY", kind: "google" },
      { id: "openai", env: "OPENAI_API_KEY", kind: "openai" },
      { id: "kimi", env: "KIMI_API_KEY", kind: "openai" },
      { id: "grok", env: "GROK_API_KEY", kind: "openai" },
    ]);
    expect(PROVIDER_REGISTRY.every((provider) => provider.baseUrl.startsWith("https://"))).toBe(true);
  });

  it("builds the documented catalog and completion endpoints for each provider", () => {
    const expectedCatalog = [
      "https://api.deepseek.com/models",
      "https://generativelanguage.googleapis.com/v1beta/models",
      "https://generativelanguage.googleapis.com/v1beta/models",
      "https://api.openai.com/v1/models",
      "https://api.moonshot.ai/v1/models",
      "https://api.x.ai/v1/models",
    ];
    const expectedChat = [
      "https://api.deepseek.com/chat/completions",
      "https://generativelanguage.googleapis.com/v1beta/models/gemma-4-31b-it:generateContent",
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent",
      "https://api.openai.com/v1/chat/completions",
      "https://api.moonshot.ai/v1/chat/completions",
      "https://api.x.ai/v1/chat/completions",
    ];
    expect(PROVIDER_REGISTRY.map((provider) => providerRequestUrl(provider, "catalog"))).toEqual(expectedCatalog);
    expect(PROVIDER_REGISTRY.map((provider) => providerRequestUrl(provider, "chat"))).toEqual(expectedChat);
  });

  it("excludes credentials and endpoint details from public provider data and never logs them", () => {
    const preview = toPublicProviderView(PROVIDER_REGISTRY[0], {
      kind: "ready",
      badge: "Готов",
      category: null,
      checkedAt: "2026-08-18T00:00:00.000Z",
    });
    expect(Object.keys(preview).sort()).toEqual(["id", "label", "model", "status"]);
    expect(JSON.stringify(preview)).not.toMatch(/API_KEY|Authorization|x-goog-api-key/i);
    const source = readFileSync(new URL("./providers.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/console\.(log|warn|error)\s*\(/);
  });

  it("injects the Kairema identity into every upstream request", () => {
    const messages = [{ role: "user" as const, content: "Тест" }];
    for (const provider of PROVIDER_REGISTRY) {
      const payload = provider.kind === "google"
        ? buildGoogleContents(provider, messages)
        : buildUpstreamMessages(provider, messages);
      const text = JSON.stringify(payload);
      expect(text).toContain("Ты Kairema, AI-ассистент.");
      expect(text).toContain(provider.label);
      expect(text).toContain("Тест");
    }
  });

  it("classifies quota, auth, rate-limit and temporary failures without exposing upstream details", () => {
    expect(classifyProviderFailure(402, { error: { message: "Insufficient Balance" } })).toBe("QUOTA");
    expect(classifyProviderFailure(401, { error: { code: "invalid_api_key" } })).toBe("AUTH");
    expect(classifyProviderFailure(429, { error: { message: "retry in 10 seconds" } })).toBe("RATE_LIMIT");
    expect(classifyProviderFailure(503, { error: { message: "high demand" } })).toBe("PROVIDER_UNAVAILABLE");
  });

  it("removes Google AI Studio thought parts and returns only the final answer", () => {
    expect(extractGeminiText({
      candidates: [{ content: { parts: [{ text: "internal reasoning", thought: true }, { text: "Финальный ответ" }] } }],
    })).toBe("Финальный ответ");
  });
});
