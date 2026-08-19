import { afterEach, describe, expect, it, vi } from "vitest";
import { getWebSearchStatus, probeWebSearchStatus, searchWeb, WebSearchUnavailableError } from "./web-search";

const originalKey = process.env.GEMINI_API_KEY;
const originalOpenRouterKey = process.env.OPENROUTER_API_KEY;

afterEach(() => {
  process.env.GEMINI_API_KEY = originalKey;
  process.env.OPENROUTER_API_KEY = originalOpenRouterKey;
  vi.unstubAllGlobals();
});

describe("Google Search grounding", () => {
  it("returns only verifiable grounded sources from a successful server-side response", async () => {
    process.env.GEMINI_API_KEY = "test-key";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ text: "Проверенный краткий ответ." }] }, groundingMetadata: { groundingChunks: [
        { web: { title: "Официальный источник", uri: "https://example.com/source" } },
        { web: { title: "Дубликат", uri: "https://example.com/source" } },
      ] } }],
    }), { status: 200 })));

    await expect(searchWeb("Проверь факт")).resolves.toEqual({
      summary: "Проверенный краткий ответ.",
      sources: [{ title: "Официальный источник", url: "https://example.com/source" }],
    });
    expect((await getWebSearchStatus()).available).toBe(true);
  });

  it("reports quota exhaustion as unavailable instead of inventing sources", async () => {
    process.env.GEMINI_API_KEY = "test-key";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { status: "RESOURCE_EXHAUSTED", message: "quota exceeded" } }), { status: 429 })));

    await expect(searchWeb("Проверь факт")).rejects.toBeInstanceOf(WebSearchUnavailableError);
    await expect(getWebSearchStatus()).resolves.toMatchObject({ available: false, reason: "Поиск временно недоступен: квота Google." });
  });

  it("persists one final availability result from Google grounding and diagnostic OpenRouter online", async () => {
    process.env.GEMINI_API_KEY = "test-google";
    process.env.OPENROUTER_API_KEY = "test-openrouter";
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        candidates: [{ content: { parts: [{ text: "Проверено." }] }, groundingMetadata: { groundingChunks: [{ web: { title: "Источник", uri: "https://example.com" } }] } }],
      }), { status: 200 })));

    await expect(probeWebSearchStatus()).resolves.toMatchObject({
      available: true,
      reason: "Google Search grounding доступен.",
      googleHttp: 200,
      openrouterHttp: 200,
    });
  });
});
