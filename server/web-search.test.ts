import { afterEach, describe, expect, it, vi } from "vitest";

const { recordSearchOutage, savedStatus, upsertWebSearchStatus } = vi.hoisted(() => ({
  recordSearchOutage: vi.fn().mockResolvedValue(undefined),
  savedStatus: vi.fn().mockResolvedValue(null),
  upsertWebSearchStatus: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("./db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./db")>()),
  getWebSearchStatus: savedStatus,
  recordSearchOutage,
  upsertWebSearchStatus,
}));

import { buildGlobalDiscoveryQuery, getWebSearchStatus, probeWebSearchStatus, searchWeb } from "./web-search";

const originalKeys = { you: process.env.YOU_API_KEY, serper: process.env.SERPER_API_KEY, exa: process.env.EXA_API_KEY };

afterEach(() => {
  process.env.YOU_API_KEY = originalKeys.you;
  process.env.SERPER_API_KEY = originalKeys.serper;
  process.env.EXA_API_KEY = originalKeys.exa;
  vi.unstubAllGlobals();
  vi.useRealTimers();
  recordSearchOutage.mockClear();
  upsertWebSearchStatus.mockClear();
  savedStatus.mockResolvedValue(null);
});

describe("v6-K SearchProvider", () => {
  it("retains the original request while explicitly broadening discovery to authoritative global sources", () => {
    const query = buildGlobalDiscoveryQuery("Проверь международный стандарт");
    expect(query).toContain("Проверь международный стандарт");
    expect(query).toMatch(/authoritative global information/i);
    expect(query).toMatch(/English-language source discovery/i);
  });

  it("uses You.com first, ranks official domains, and returns only deduplicated verifiable sources", async () => {
    process.env.YOU_API_KEY = "test-you";
    process.env.SERPER_API_KEY = "";
    process.env.EXA_API_KEY = "";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ results: { web: [
      { title: "Коммерческий материал", url: "https://example.com/source", description: "Вторичный фрагмент" },
      { title: "Официальный материал", url: "https://agency.gov/source", description: "Проверяемый фрагмент" },
      { title: "Дубликат", url: "https://agency.gov/source", description: "Не должен повториться" },
    ] } }), { status: 200 })));

    await expect(searchWeb("Проверь актуальный стандарт")).resolves.toMatchObject({
      cascadeUsed: "you",
      sources: [
        { title: "Официальный материал", url: "https://agency.gov/source", domain: "agency.gov" },
        { title: "Коммерческий материал", url: "https://example.com/source", domain: "example.com" },
      ],
    });
    expect((await getWebSearchStatus()).available).toBe(true);
    expect(upsertWebSearchStatus).toHaveBeenCalledWith(expect.objectContaining({ youHttp: 200, state: "ready" }));
  });

  it("uses Serper only after a You.com failure and records metadata-only failover", async () => {
    process.env.YOU_API_KEY = "test-you";
    process.env.SERPER_API_KEY = "test-serper";
    process.env.EXA_API_KEY = "";
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: "unavailable" }), { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ organic: [{ title: "Проверяемый материал", link: "https://example.com/serper", snippet: "Краткий фрагмент" }] }), { status: 200 })));

    await expect(searchWeb("Проверь актуальный факт")).resolves.toMatchObject({ cascadeUsed: "serper", sources: [{ url: "https://example.com/serper" }] });
    await vi.waitFor(() => expect(recordSearchOutage).toHaveBeenCalledWith(expect.objectContaining({ layer: "you", errorClass: "http_error", fellBack: true, latencyMs: expect.any(Number) })));
    const [outage] = recordSearchOutage.mock.calls[0] ?? [];
    expect(outage).not.toHaveProperty("url");
    expect(outage).not.toHaveProperty("query");
    expect(outage).not.toHaveProperty("model");
  });

  it("uses Exa only after You.com and Serper return no verifiable sources", async () => {
    process.env.YOU_API_KEY = "test-you";
    process.env.SERPER_API_KEY = "test-serper";
    process.env.EXA_API_KEY = "test-exa";
    vi.useFakeTimers();
    vi.setSystemTime(new Date(Date.now() + 16 * 60_000));
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ results: { web: [] } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ organic: [] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ results: [{ title: "Источник Exa", url: "https://example.org/exa", highlights: ["Проверяемый фрагмент"] }] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(searchWeb("Проверь текущий факт")).resolves.toMatchObject({ cascadeUsed: "exa", sources: [{ url: "https://example.org/exa" }] });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("returns nullable soft fallback and cooldown state honestly when the primary layer is rate limited", async () => {
    process.env.YOU_API_KEY = "test-you";
    process.env.SERPER_API_KEY = "";
    process.env.EXA_API_KEY = "";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "quota" }), { status: 429 })));

    await expect(searchWeb("Проверь факт")).resolves.toBeNull();
    const status = await getWebSearchStatus();
    expect(status).toMatchObject({ available: false, reason: expect.stringMatching(/ограничен/i) });
    expect(status.layers).toContainEqual(expect.objectContaining({ id: "you", state: "limited", retryAt: expect.any(String) }));
  });

  it("performs one bounded health probe through the active provider-neutral cascade", async () => {
    process.env.YOU_API_KEY = "test-you";
    process.env.SERPER_API_KEY = "";
    process.env.EXA_API_KEY = "";
    vi.useFakeTimers();
    vi.setSystemTime(new Date(Date.now() + 16 * 60_000));
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ results: { web: [{ title: "Источник", url: "https://example.com/health", description: "ok" }] } }), { status: 200 })));

    await expect(probeWebSearchStatus()).resolves.toMatchObject({ available: true, reason: "Поиск доступен.", youHttp: 200 });
  });
});
