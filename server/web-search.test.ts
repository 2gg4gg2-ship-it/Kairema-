import { afterEach, describe, expect, it, vi } from "vitest";
import { getWebSearchStatus, probeWebSearchStatus, searchWeb, WebSearchUnavailableError } from "./web-search";

const originalKey = process.env.GEMINI_API_KEY;
const originalOpenRouterKey = process.env.OPENROUTER_API_KEY;
const originalTavilyKey = process.env.TAVILY_API_KEY;

afterEach(() => {
  process.env.GEMINI_API_KEY = originalKey;
  process.env.OPENROUTER_API_KEY = originalOpenRouterKey;
  process.env.TAVILY_API_KEY = originalTavilyKey;
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
  }, 10_000);

  it("uses Tavily after Google 429 and preserves only real Tavily URLs", async () => {
    process.env.GEMINI_API_KEY = "test-google";
    process.env.TAVILY_API_KEY = "test-tavily";
    process.env.OPENROUTER_API_KEY = "";
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { status: "RESOURCE_EXHAUSTED" } }), { status: 429 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ results: [
        { title: "Проверяемый материал", url: "https://example.com/tavily", content: "Краткий подтверждаемый фрагмент." },
        { title: "Дубликат", url: "https://example.com/tavily", content: "Не должен дублироваться." },
      ] }), { status: 200 })));

    await expect(searchWeb("Проверь актуальный факт")).resolves.toMatchObject({
      sources: [{ title: "Проверяемый материал", url: "https://example.com/tavily" }],
    });
    await expect(getWebSearchStatus()).resolves.toMatchObject({ available: true, googleHttp: 429, reason: "Google недоступен по квоте; используется Tavily с проверяемыми источниками." });
  });

  it("uses OpenRouter online only after Google 429 when Tavily cannot return sources", async () => {
    process.env.GEMINI_API_KEY = "test-google";
    process.env.TAVILY_API_KEY = "test-tavily";
    process.env.OPENROUTER_API_KEY = "test-openrouter";
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { status: "RESOURCE_EXHAUSTED" } }), { status: 429 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ results: [] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        choices: [{ message: { content: "Актуальный ответ OpenRouter." } }],
        citations: ["https://example.com/verified", "https://example.com/verified"],
      }), { status: 200 })));

    await expect(searchWeb("Проверь актуальный факт")).resolves.toEqual({
      summary: "Актуальный ответ OpenRouter.",
      sources: [{ title: "https://example.com/verified", url: "https://example.com/verified" }],
    });
    await expect(getWebSearchStatus()).resolves.toMatchObject({ available: true, googleHttp: 429, openrouterHttp: 200 });
  });

  it("reports unavailable honestly when all external search fallbacks lack sources", async () => {
    process.env.GEMINI_API_KEY = "test-key";
    process.env.TAVILY_API_KEY = "";
    process.env.OPENROUTER_API_KEY = "";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { status: "RESOURCE_EXHAUSTED", message: "quota exceeded" } }), { status: 429 })));

    await expect(searchWeb("Проверь факт")).rejects.toBeInstanceOf(WebSearchUnavailableError);
    await expect(getWebSearchStatus()).resolves.toMatchObject({ available: false, reason: "Поиск временно недоступен: квота Google; Tavily и OpenRouter online не вернули проверяемые источники. RAG может использоваться отдельно, если релевантен." });
  });

  it("persists one final availability result from Google grounding and diagnostic OpenRouter online", async () => {
    process.env.GEMINI_API_KEY = "test-google";
    process.env.OPENROUTER_API_KEY = "test-openrouter";
    process.env.TAVILY_API_KEY = "";
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
