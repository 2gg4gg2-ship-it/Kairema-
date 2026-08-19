import { afterEach, describe, expect, it, vi } from "vitest";
import { getWebSearchStatus, searchWeb, WebSearchUnavailableError } from "./web-search";

const originalKey = process.env.GEMINI_API_KEY;

afterEach(() => {
  process.env.GEMINI_API_KEY = originalKey;
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
    expect(getWebSearchStatus().available).toBe(true);
  });

  it("reports quota exhaustion as unavailable instead of inventing sources", async () => {
    process.env.GEMINI_API_KEY = "test-key";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { status: "RESOURCE_EXHAUSTED", message: "quota exceeded" } }), { status: 429 })));

    await expect(searchWeb("Проверь факт")).rejects.toBeInstanceOf(WebSearchUnavailableError);
    expect(getWebSearchStatus()).toMatchObject({ available: false, reason: "Поиск временно недоступен: квота Google." });
  });
});
