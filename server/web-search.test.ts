import { afterEach, describe, expect, it, vi } from "vitest";

const { recordSearchOutage } = vi.hoisted(() => ({ recordSearchOutage: vi.fn().mockResolvedValue(undefined) }));
vi.mock("./db", async (importOriginal) => ({ ...(await importOriginal<typeof import("./db")>()), recordSearchOutage }));

import { buildGlobalDiscoveryQuery, getWebSearchStatus, probeWebSearchStatus, searchWeb, WebSearchUnavailableError } from "./web-search";

const originalKey = process.env.GEMINI_API_KEY;
const originalOpenRouterKey = process.env.OPENROUTER_API_KEY;
const originalTavilyKey = process.env.TAVILY_API_KEY;

afterEach(() => {
  process.env.GEMINI_API_KEY = originalKey;
  process.env.OPENROUTER_API_KEY = originalOpenRouterKey;
  process.env.TAVILY_API_KEY = originalTavilyKey;
  vi.unstubAllGlobals();
  vi.useRealTimers();
  recordSearchOutage.mockClear();
});

describe("Google Search grounding", () => {
  it("retains the original request while explicitly broadening discovery to authoritative global sources", () => {
    const query = buildGlobalDiscoveryQuery("Проверь международный стандарт");
    expect(query).toContain("Проверь международный стандарт");
    expect(query).toMatch(/authoritative global information/i);
    expect(query).toMatch(/English-language source discovery/i);
  });

  it("ranks official global domains above otherwise valid commercial sources without inventing links", async () => {
    process.env.GEMINI_API_KEY = "test-key";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ text: "Проверенный краткий ответ." }] }, groundingMetadata: { groundingChunks: [
        { web: { title: "Коммерческий материал", uri: "https://example.com/source" } },
        { web: { title: "Официальный материал", uri: "https://agency.gov/source" } },
      ] } }],
    }), { status: 200 })));

    await expect(searchWeb("Проверь актуальный стандарт")).resolves.toMatchObject({
      sources: [
        { title: "Официальный материал", url: "https://agency.gov/source" },
        { title: "Коммерческий материал", url: "https://example.com/source" },
      ],
    });
  });

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
      sources: [{ title: "Официальный источник", url: "https://example.com/source", domain: "example.com" }],
      cascadeUsed: "google",
    });
    expect((await getWebSearchStatus()).available).toBe(true);
  }, 10_000);

  it("uses Tavily after a non-quota Google failure and preserves only real Tavily URLs", async () => {
    process.env.GEMINI_API_KEY = "test-google";
    process.env.TAVILY_API_KEY = "test-tavily";
    process.env.OPENROUTER_API_KEY = "";
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { status: "UNAVAILABLE" } }), { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ results: [
        { title: "Проверяемый материал", url: "https://example.com/tavily", content: "Краткий подтверждаемый фрагмент." },
        { title: "Дубликат", url: "https://example.com/tavily", content: "Не должен дублироваться." },
      ] }), { status: 200 })));

    await expect(searchWeb("Проверь актуальный факт")).resolves.toMatchObject({
      sources: [{ title: "Проверяемый материал", url: "https://example.com/tavily" }],
      cascadeUsed: "tavily",
    });
    await expect(getWebSearchStatus()).resolves.toMatchObject({ available: true, googleHttp: 503, reason: "Поиск доступен через резервный слой." });
    await vi.waitFor(() => expect(recordSearchOutage).toHaveBeenCalledWith(expect.objectContaining({
      layer: "google",
      errorClass: "http_error",
      fellBack: true,
      latencyMs: expect.any(Number),
    })));
    const [outage] = recordSearchOutage.mock.calls[0] ?? [];
    expect(outage).not.toHaveProperty("url");
    expect(outage).not.toHaveProperty("query");
    expect(outage).not.toHaveProperty("model");
  });

  it("uses OpenRouter online once after Google fails and Tavily cannot return sources", async () => {
    process.env.GEMINI_API_KEY = "test-google";
    process.env.TAVILY_API_KEY = "test-tavily";
    process.env.OPENROUTER_API_KEY = "test-openrouter";
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { status: "UNAVAILABLE" } }), { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ results: [] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        choices: [{ message: { content: "Актуальный ответ OpenRouter." } }],
        citations: ["https://example.com/verified", "https://example.com/verified"],
      }), { status: 200 })));

    await expect(searchWeb("Проверь актуальный факт")).resolves.toEqual({
      summary: "Актуальный ответ OpenRouter.",
      sources: [{ title: "https://example.com/verified", url: "https://example.com/verified", domain: "example.com" }],
      cascadeUsed: "openrouter",
    });
    await expect(getWebSearchStatus()).resolves.toMatchObject({ available: true, googleHttp: 503, openrouterHttp: 200 });
  });

  it("returns a nullable soft fallback honestly when all external search layers lack sources", async () => {
    process.env.GEMINI_API_KEY = "test-key";
    process.env.TAVILY_API_KEY = "";
    process.env.OPENROUTER_API_KEY = "";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { status: "RESOURCE_EXHAUSTED", message: "quota exceeded" } }), { status: 429 })));

    await expect(searchWeb("Проверь факт")).resolves.toBeNull();
    const status = await getWebSearchStatus();
    expect(status).toMatchObject({ available: false, reason: "Поиск временно ограничен: основной слой ожидает сброса квоты. Резервные слои не вернули проверяемые источники." });
    expect(status.layers).toContainEqual(expect.objectContaining({ id: "google", state: "limited", retryAt: expect.any(String) }));
  });

  it("persists one final availability result from Google grounding and diagnostic OpenRouter online", async () => {
    process.env.GEMINI_API_KEY = "test-google";
    process.env.OPENROUTER_API_KEY = "test-openrouter";
    process.env.TAVILY_API_KEY = "";
    vi.useFakeTimers();
    vi.setSystemTime(new Date(Date.now() + 16 * 60_000));
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        candidates: [{ content: { parts: [{ text: "Проверено." }] }, groundingMetadata: { groundingChunks: [{ web: { title: "Источник", uri: "https://example.com" } }] } }],
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }], citations: ["https://example.com/online"] }), { status: 200 })));

    await expect(probeWebSearchStatus()).resolves.toMatchObject({
      available: true,
      reason: "Поиск доступен.",
      googleHttp: 200,
      openrouterHttp: 200,
    });
  });
});
