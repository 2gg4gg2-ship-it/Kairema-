import { afterEach, describe, expect, it, vi } from "vitest";

const { recordSearchOutage, recordSearchQuality, savedStatus, upsertWebSearchStatus } = vi.hoisted(() => ({
  recordSearchOutage: vi.fn().mockResolvedValue(undefined),
  recordSearchQuality: vi.fn().mockResolvedValue(undefined),
  savedStatus: vi.fn().mockResolvedValue(null),
  upsertWebSearchStatus: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("./db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./db")>()),
  getWebSearchStatus: savedStatus,
  recordSearchOutage,
  recordSearchQuality,
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
  recordSearchQuality.mockClear();
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
      { title: "Официальный материал", url: "https://agency.gov/source", description: "Проверяемый фрагмент", publishedAt: "2026-08-20T00:00:00.000Z" },
      { title: "Дубликат", url: "https://agency.gov/source", description: "Не должен повториться" },
    ] } }), { status: 200 })));

    const result = await searchWeb("Проверь актуальный стандарт");
    expect(result).toMatchObject({
      state: "found",
      verificationStatus: "verified",
      cascadeUsed: "you",
      sources: [
        { title: "Официальный материал", url: "https://agency.gov/source", domain: "agency.gov", sourceId: expect.stringMatching(/^[a-f0-9]{16}$/), publishedAt: "2026-08-20T00:00:00.000Z", retrievedAt: expect.any(String) },
        { title: "Коммерческий материал", url: "https://example.com/source", domain: "example.com", sourceId: expect.stringMatching(/^[a-f0-9]{16}$/), retrievedAt: expect.any(String) },
      ],
      evidence: expect.arrayContaining([
        expect.objectContaining({ fact: "Проверяемый фрагмент", sourceUrl: "https://agency.gov/source", sourceTitle: "Официальный материал", sourceDomain: "agency.gov", publishedAt: "2026-08-20T00:00:00.000Z", retrievedAt: expect.any(String), confidence: "high", sourceId: expect.stringMatching(/^[a-f0-9]{16}$/) }),
        expect.objectContaining({ fact: "Вторичный фрагмент", sourceUrl: "https://example.com/source", sourceTitle: "Коммерческий материал", sourceDomain: "example.com", retrievedAt: expect.any(String), confidence: "medium", sourceId: expect.stringMatching(/^[a-f0-9]{16}$/) }),
      ]),
    });
    expect(result.evidence).toHaveLength(result.sources.length);
    expect(new Set(result.evidence.map((entry) => entry.sourceId))).toEqual(new Set(result.sources.map((source) => source.sourceId)));
    expect((await getWebSearchStatus()).available).toBe(true);
    expect(upsertWebSearchStatus).toHaveBeenCalledWith(expect.objectContaining({ youHttp: 200, state: "ready" }));
    expect(recordSearchQuality).toHaveBeenCalledTimes(1);
    const [metric] = recordSearchQuality.mock.calls[0] ?? [];
    expect(metric).toMatchObject({ outcome: "found", verification: "verified", verifiedSourceCount: 2, staleBlocked: false, latencyMs: expect.any(Number) });
    expect(metric).not.toHaveProperty("query");
    expect(metric).not.toHaveProperty("url");
    expect(metric).not.toHaveProperty("userId");
    expect(metric).not.toHaveProperty("provider");
    expect(metric).not.toHaveProperty("model");
  });

  it("normalises provider publication dates without treating invalid or future values as freshness evidence", async () => {
    process.env.YOU_API_KEY = "test-you";
    process.env.SERPER_API_KEY = "";
    process.env.EXA_API_KEY = "";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ results: { web: [
      { title: "Valid date", url: "https://example.com/valid", description: "ok", date: "2026-08-01" },
      { title: "Bad date", url: "https://example.com/bad", description: "ok", date: "not-a-date" },
      { title: "Future date", url: "https://example.com/future", description: "ok", date: "2999-01-01" },
    ] } }), { status: 200 })));

    const result = await searchWeb("Проверь дату источника");
    expect(result).toMatchObject({ state: "found", sources: expect.arrayContaining([expect.objectContaining({ url: "https://example.com/valid", publishedAt: "2026-08-01T00:00:00.000Z" })]) });
    expect(result.sources.find((source) => source.url === "https://example.com/bad")).not.toHaveProperty("publishedAt");
    expect(result.sources.find((source) => source.url === "https://example.com/future")).not.toHaveProperty("publishedAt");
  });

  it("does not verify a current-data query when the only live result has no provider publication date", async () => {
    process.env.YOU_API_KEY = "test-you";
    process.env.SERPER_API_KEY = "";
    process.env.EXA_API_KEY = "";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ results: { web: [
      { title: "Undated live result", url: "https://example.com/undated", description: "No publication date supplied" },
    ] } }), { status: 200 })));

    await expect(searchWeb("Последние новости ИИ", { requireDatedSources: true })).resolves.toMatchObject({
      state: "degraded",
      verificationStatus: "degraded",
      cascadeUsed: null,
      sources: [],
      evidence: [],
    });
    expect(recordSearchQuality).toHaveBeenCalledWith(expect.objectContaining({ outcome: "degraded", verification: "degraded", staleBlocked: true }));
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

  it("returns an error outcome and cooldown state honestly when the primary layer is rate limited", async () => {
    process.env.YOU_API_KEY = "test-you";
    process.env.SERPER_API_KEY = "";
    process.env.EXA_API_KEY = "";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "quota" }), { status: 429 })));

    await expect(searchWeb("Проверь факт")).resolves.toMatchObject({ state: "error", verificationStatus: "unavailable", sources: [] });
    const status = await getWebSearchStatus();
    expect(status).toMatchObject({ available: false, reason: expect.stringMatching(/ограничен/i) });
    expect(status.layers).toContainEqual(expect.objectContaining({ id: "you", state: "limited", retryAt: expect.any(String) }));
  });

  it("marks a completed cascade with no sources as empty rather than a technical provider failure", async () => {
    process.env.YOU_API_KEY = "test-you";
    process.env.SERPER_API_KEY = "test-serper";
    process.env.EXA_API_KEY = "test-exa";
    vi.useFakeTimers();
    vi.setSystemTime(new Date(Date.now() + 16 * 60_000));
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ results: { web: [] } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ organic: [] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ results: [] }), { status: 200 })));

    await expect(searchWeb("Найди неизвестный термин")).resolves.toMatchObject({ state: "empty", verificationStatus: "no_results", sources: [], evidence: [] });
  });

  it("marks a mixed empty-and-failed cascade as degraded rather than pretending no information exists", async () => {
    process.env.YOU_API_KEY = "test-you";
    process.env.SERPER_API_KEY = "test-serper";
    process.env.EXA_API_KEY = "";
    vi.useFakeTimers();
    vi.setSystemTime(new Date(Date.now() + 16 * 60_000));
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ results: { web: [] } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: "busy" }), { status: 503 })));

    await expect(searchWeb("Проверь спорный факт")).resolves.toMatchObject({ state: "degraded", verificationStatus: "degraded", sources: [] });
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
