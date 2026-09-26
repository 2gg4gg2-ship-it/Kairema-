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

import { buildGlobalDiscoveryQuery, getWebGroundedRuntimeGaugeSnapshot, getWebSearchStatus, probeWebSearchStatus, publicSearchCacheStatsForTests, resetPublicSearchCacheForTests, resetWebGroundedRuntimeGaugeForTests, resetWebSearchRuntimeForTests, searchWeb } from "./web-search";

const originalKeys = { you: process.env.YOU_API_KEY, serper: process.env.SERPER_API_KEY, exa: process.env.EXA_API_KEY };

afterEach(() => {
  process.env.YOU_API_KEY = originalKeys.you;
  process.env.SERPER_API_KEY = originalKeys.serper;
  process.env.EXA_API_KEY = originalKeys.exa;
  process.env.TAVILY_API_KEY = "";
  vi.unstubAllGlobals();
  vi.useRealTimers();
  recordSearchOutage.mockClear();
  recordSearchQuality.mockClear();
  upsertWebSearchStatus.mockClear();
  savedStatus.mockResolvedValue(null);
  resetPublicSearchCacheForTests();
  resetWebGroundedRuntimeGaugeForTests();
  resetWebSearchRuntimeForTests();
});

describe("v6-K SearchProvider", () => {
  it("passes the provider the normalized user request and no server-side instruction", () => {
    const query = buildGlobalDiscoveryQuery("Проверь международный стандарт");
    expect(query).toBe("Проверь международный стандарт");
    // A search index matches instruction words instead of the requested entity, which
    // is what made location-relevant results disappear, so none may be added here.
    expect(query).not.toMatch(/authoritative global information/i);
    expect(query).not.toMatch(/Original user request/i);
    expect(query).not.toMatch(/English-language source discovery/i);
    expect(query).not.toMatch(/Собери только релевантные/i);
  });

  it("never removes user wording that resembles the retired server-side instruction", () => {
    // The collection instruction is no longer added anywhere, so nothing has to be cut
    // back out. Guessing "ours vs the user's" would silently drop what the user typed.
    const legacy = "Собери только релевантные актуальные факты и источники для запроса пользователя: Какая сейчас погода в Одессе?";
    expect(buildGlobalDiscoveryQuery(legacy)).toBe(legacy);
    expect(buildGlobalDiscoveryQuery("собери только релевантные актуальные факты и источники для запроса пользователя")).toBe("собери только релевантные актуальные факты и источники для запроса пользователя");
    // A freshness-bound request must reach the provider undistorted as well.
    expect(buildGlobalDiscoveryQuery("Какой последний Claude вышел?")).toBe("Какой последний Claude вышел?");
  });

  it("keeps the existing normalization and the query length limit", () => {
    expect(buildGlobalDiscoveryQuery("  Какая\r\nсейчас\tпогода в Одессе?  ")).toBe("Какая сейчас погода в Одессе?");
    expect(buildGlobalDiscoveryQuery("я".repeat(9_000)).length).toBe(8_000);
  });

  it("sends the provider exactly the user query over a real request body", async () => {
    process.env.YOU_API_KEY = "test-you";
    process.env.SERPER_API_KEY = "";
    process.env.EXA_API_KEY = "";
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ results: { web: [
      { title: "Погода в Одессе", url: "https://example.com/odesa", description: "Прогноз на сегодня" },
    ] } }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await searchWeb("Какая сейчас погода в Одессе?", { requireDatedSources: false });

    const init = fetchMock.mock.calls[0]?.[1] as { body: string };
    const sent = JSON.parse(init.body) as { query: string };
    expect(sent.query).toBe("Какая сейчас погода в Одессе?");
    expect(sent.query).toMatch(/погода в Одессе/i);
    expect(sent.query).not.toMatch(/authoritative global information/i);
    expect(sent.query).not.toMatch(/Original user request/i);
    expect(sent.query).not.toMatch(/Собери только релевантные/i);
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

  it("falls through a stale dated result and returns only an in-window verified source", async () => {
    process.env.YOU_API_KEY = "test-you";
    process.env.SERPER_API_KEY = "test-serper";
    process.env.EXA_API_KEY = "";
    const staleDate = new Date(Date.now() - 10 * 24 * 60 * 60_000).toISOString();
    const freshDate = new Date(Date.now() - 2 * 60 * 60_000).toISOString();
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ results: { web: [{ title: "Старый материал", url: "https://example.com/stale", description: "Архив", publishedAt: staleDate }] } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ organic: [{ title: "Свежий материал", link: "https://example.com/fresh", snippet: "Новая публикация", date: freshDate }] }), { status: 200 })));

    await expect(searchWeb("Последние новости", { requireDatedSources: true, publishedAfter: new Date(Date.now() - 3 * 24 * 60 * 60_000).toISOString() })).resolves.toMatchObject({
      state: "found", cascadeUsed: "serper", sources: [{ url: "https://example.com/fresh", publishedAt: freshDate }],
    });
  });

  it("falls through an undated result and returns only an in-window verified source", async () => {
    process.env.YOU_API_KEY = "test-you";
    process.env.SERPER_API_KEY = "test-serper";
    process.env.EXA_API_KEY = "";
    const freshDate = new Date(Date.now() - 2 * 60 * 60_000).toISOString();
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ results: { web: [{ title: "Без даты", url: "https://example.com/undated", description: "Дата публикации не передана" }] } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ organic: [{ title: "Свежий материал", link: "https://example.com/fresh", snippet: "Новая публикация", date: freshDate }] }), { status: 200 })));

    // An undated primary result must not end the cascade: the next layer may still
    // return a dated source that satisfies the requested window.
    await expect(searchWeb("Последние новости", { requireDatedSources: true, publishedAfter: new Date(Date.now() - 3 * 24 * 60 * 60_000).toISOString() })).resolves.toMatchObject({
      state: "found", cascadeUsed: "serper", sources: [{ url: "https://example.com/fresh", publishedAt: freshDate }],
    });
  });

  it("returns an honest degraded outcome when all dated sources are older than the requested window", async () => {
    process.env.YOU_API_KEY = "test-you";
    process.env.SERPER_API_KEY = "";
    process.env.EXA_API_KEY = "";
    const staleDate = new Date(Date.now() - 10 * 24 * 60 * 60_000).toISOString();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ results: { web: [{ title: "Старый материал", url: "https://example.com/stale", description: "Архив", publishedAt: staleDate }] } }), { status: 200 })));

    await expect(searchWeb("Последние новости", { requireDatedSources: true, publishedAfter: new Date(Date.now() - 3 * 24 * 60 * 60_000).toISOString() })).resolves.toMatchObject({
      state: "degraded", verificationStatus: "degraded", cascadeUsed: null, sources: [], evidence: [],
    });
    expect(recordSearchQuality).toHaveBeenCalledWith(expect.objectContaining({ outcome: "degraded", staleBlocked: true }));
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

  it("uses Tavily only as the fourth bounded fallback after You.com, Serper and Exa fail", async () => {
    process.env.YOU_API_KEY = "test-you";
    process.env.SERPER_API_KEY = "test-serper";
    process.env.EXA_API_KEY = "test-exa";
    process.env.TAVILY_API_KEY = "test-tavily";
    vi.useFakeTimers();
    vi.setSystemTime(new Date(Date.now() + 16 * 60_000));
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: "busy" }), { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: "busy" }), { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: "busy" }), { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ results: [{ title: "Проверяемый Tavily-источник", url: "https://example.org/tavily", content: "Проверяемый фрагмент" }] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(searchWeb("Проверь резервный поиск")).resolves.toMatchObject({ cascadeUsed: "tavily", sources: [{ url: "https://example.org/tavily" }] });
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect((await getWebSearchStatus()).layers).toContainEqual(expect.objectContaining({ id: "tavily", state: "ready" }));
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
    process.env.TAVILY_API_KEY = "test-tavily";
    vi.useFakeTimers();
    vi.setSystemTime(new Date(Date.now() + 16 * 60_000));
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ results: { web: [] } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ organic: [] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ results: [] }), { status: 200 }))
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

  it("uses a bounded public cache only when explicitly requested and returns cloned normalized outcomes", async () => {
    process.env.YOU_API_KEY = "test-you";
    process.env.SERPER_API_KEY = "";
    process.env.EXA_API_KEY = "";
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ results: { web: [{ title: "Публичный источник", url: "https://example.com/public", description: "Проверяемый факт", publishedAt: "2026-08-22T00:00:00.000Z" }] } }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const first = await searchWeb("Какая последняя версия браузера?", { publicCache: true, requireDatedSources: true, publishedAfter: "2026-01-01T00:00:00.000Z" });
    const second = await searchWeb("Какая последняя версия браузера?", { publicCache: true, requireDatedSources: true, publishedAfter: "2026-01-01T00:00:00.000Z" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(second).toEqual(first);
    expect(second).not.toBe(first);
    expect(publicSearchCacheStatsForTests()).toEqual({ entries: 1, inFlight: 0 });
  });

  it("deduplicates concurrent public discovery without changing the one-cascade maximum", async () => {
    process.env.YOU_API_KEY = "test-you";
    process.env.SERPER_API_KEY = "";
    process.env.EXA_API_KEY = "";
    let resolveFetch: ((value: Response) => void) | undefined;
    const fetchMock = vi.fn().mockImplementation(() => new Promise<Response>((resolve) => { resolveFetch = resolve; }));
    vi.stubGlobal("fetch", fetchMock);

    const first = searchWeb("Какие текущие новости?", { publicCache: true, requireDatedSources: true, publishedAfter: "2026-01-01T00:00:00.000Z" });
    const second = searchWeb("Какие текущие новости?", { publicCache: true, requireDatedSources: true, publishedAfter: "2026-01-01T00:00:00.000Z" });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    resolveFetch?.(new Response(JSON.stringify({ results: { web: [{ title: "Текущий источник", url: "https://example.com/current", description: "Краткий факт", publishedAt: "2026-08-22T00:00:00.000Z" }] } }), { status: 200 }));

    await expect(Promise.all([first, second])).resolves.toEqual([
      expect.objectContaining({ state: "found", cascadeUsed: "you" }),
      expect.objectContaining({ state: "found", cascadeUsed: "you" }),
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("reserves and settles exactly one search ticket for each configured real cascade layer", async () => {
    process.env.YOU_API_KEY = "test-you";
    process.env.SERPER_API_KEY = "test-serper";
    process.env.EXA_API_KEY = "";
    vi.useFakeTimers();
    vi.setSystemTime(new Date(Date.now() + 16 * 60_000));
    const settled: string[] = [];
    const beforeAttempt = vi.fn().mockImplementation(async () => async (outcome: string) => { settled.push(outcome); });
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: "busy" }), { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ organic: [{ title: "Проверяемый источник", link: "https://example.com/fallback", snippet: "Проверяемый факт", date: "2026-08-22T00:00:00.000Z" }] }), { status: 200 })));

    await expect(searchWeb("Какие последние новости?", { requireDatedSources: true, publishedAfter: "2026-01-01T00:00:00.000Z", beforeAttempt })).resolves.toMatchObject({ state: "found", cascadeUsed: "serper" });
    expect(beforeAttempt).toHaveBeenNthCalledWith(1, "you");
    expect(beforeAttempt).toHaveBeenNthCalledWith(2, "serper");
    expect(beforeAttempt).toHaveBeenCalledTimes(2);
    expect(settled).toEqual(["failed", "success"]);
  });

  it("exposes only aggregate cache, dedup, attempt and outcome counters for owner observability", async () => {
    process.env.YOU_API_KEY = "test-you";
    process.env.SERPER_API_KEY = "";
    process.env.EXA_API_KEY = "";
    vi.useFakeTimers();
    vi.setSystemTime(new Date(Date.now() + 16 * 60_000));
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ results: { web: [{ title: "Публичный источник", url: "https://example.com/telemetry", description: "Проверяемый факт", publishedAt: "2026-08-22T00:00:00.000Z" }] } }), { status: 200 })));

    await searchWeb("Какая текущая версия браузера?", { publicCache: true, requireDatedSources: true, publishedAfter: "2026-01-01T00:00:00.000Z" });
    await searchWeb("Какая текущая версия браузера?", { publicCache: true, requireDatedSources: true, publishedAfter: "2026-01-01T00:00:00.000Z" });

    expect(getWebGroundedRuntimeGaugeSnapshot()).toEqual(expect.objectContaining({
      searchRequests: 2,
      cacheHits: 1,
      dedupJoins: 0,
      networkLayerAttempts: 1,
      outcomes: { found: 2, empty: 0, degraded: 0, unavailable: 0 },
    }));
    expect(JSON.stringify(getWebGroundedRuntimeGaugeSnapshot())).not.toContain("browser");
    expect(JSON.stringify(getWebGroundedRuntimeGaugeSnapshot())).not.toContain("example.com");
  });

  it("keeps undated sources for a source-seeking request and still rejects them for a freshness-bound one", async () => {
    process.env.YOU_API_KEY = "test-you";
    process.env.SERPER_API_KEY = "";
    process.env.EXA_API_KEY = "";
    const undatedPayload = () => new Response(JSON.stringify({ results: { web: [
      { title: "Официальная страница", url: "https://agency.gov/about", description: "Справочные сведения" },
      { title: "Справочная статья", url: "https://en.wikipedia.org/wiki/Topic", description: "Описание" },
    ] } }), { status: 200 });

    // PREFERRED: an undated evergreen page must not be discarded just for lacking a date.
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(undatedPayload()));
    const preferred = await searchWeb("Поищи информацию о марс", { publicCache: false, requireDatedSources: false });
    expect(preferred).toMatchObject({ state: "found", verificationStatus: "verified", cascadeUsed: "you" });
    expect(preferred).toHaveProperty("sources");
    expect((preferred as { sources: unknown[] }).sources).toHaveLength(2);

    // REQUIRED: the existing freshness requirement must still reject undated results.
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(undatedPayload()));
    const required = await searchWeb("Какая последняя версия браузера?", { publicCache: false, requireDatedSources: true, publishedAfter: "2026-01-01T00:00:00.000Z" });
    expect(required).toMatchObject({ state: "degraded", verificationStatus: "degraded", sources: [] });
  });

  it("reads the real You.com page_age field as the publication date for a freshness-bound request", async () => {
    process.env.YOU_API_KEY = "test-you";
    process.env.SERPER_API_KEY = "";
    process.env.EXA_API_KEY = "";
    process.env.TAVILY_API_KEY = "";
    // The real You.com response carries page_age and no publishedAt and no date.
    const pageAge = new Date(Date.now() - 60 * 60_000);
    const pageAgeWithoutOffset = pageAge.toISOString().slice(0, 19);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      results: { web: [{
        title: "Публикация о релизе",
        url: "https://example.com/release",
        description: "Свежий подтверждённый факт",
        thumbnail_url: "https://example.com/t.png",
        original_thumbnail_url: "https://example.com/o.png",
        page_age: pageAgeWithoutOffset,
        favicon_url: "https://example.com/f.ico",
        snippets: ["Свежий подтверждённый факт"],
      }] },
      metadata: { query: "q", search_uuid: "u", latency: 1 },
    }), { status: 200 })));

    const result = await searchWeb("Какой последний Клауд вышел?", {
      publicCache: false,
      requireDatedSources: true,
      publishedAfter: new Date(Date.now() - 48 * 60 * 60_000).toISOString(),
    });

    expect(result).toMatchObject({ state: "found", verificationStatus: "verified", cascadeUsed: "you" });
    expect(result.sources).toHaveLength(1);
    // The offset-less page_age is pinned to UTC, not to the process time zone.
    expect(result.sources[0].publishedAt).toBe(`${pageAgeWithoutOffset}.000Z`);
  });

  describe("You.com snippets carry the live value the meta description omits", () => {
    const stubYouLayer = (web: unknown[]) => {
      process.env.YOU_API_KEY = "test-you";
      process.env.SERPER_API_KEY = "";
      process.env.EXA_API_KEY = "";
      process.env.TAVILY_API_KEY = "";
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
        results: { web },
        metadata: { query: "q", search_uuid: "u", latency: 1 },
      }), { status: 200 })));
    };

    it("keeps the description and adds the current value carried only in snippets", async () => {
      // The real live response: the description names the topic, while the current
      // reading exists only in the page-body snippets.
      stubYouLayer([{
        title: "SINOPTIK: Погода в Одессе",
        url: "https://sinoptik.ua/ru/pohoda/odesa",
        description: "Погода в Одессе на неделю. Прогноз погоды Одесса, Украина.",
        page_age: "2024-12-31T22:00:00",
        snippets: ["Одесса: 13:00 · +19°C · Восход 06:47 Закат 18:48", "Мелкий дождь, который пошел в середине дня, закончится еще до наступления вечера."],
      }]);

      const result = await searchWeb("Какая сейчас погода в Одессе?", { publicCache: false, requireDatedSources: false });

      expect(result).toMatchObject({ state: "found", verificationStatus: "verified", cascadeUsed: "you" });
      expect(result.evidence).toHaveLength(1);
      const [entry] = result.evidence;
      expect(entry.fact).toContain("Погода в Одессе на неделю");
      expect(entry.fact).toContain("+19°C");
      expect(entry.fact).toContain("Мелкий дождь");
      // The value must also reach the model through the existing summary pipeline.
      expect(result.summary).toContain("+19°C");
      expect(result.summary).toContain("Мелкий дождь");
      // Unrelated page metadata stays untouched by the value extraction.
      expect(result.sources[0]).toMatchObject({ title: "SINOPTIK: Погода в Одессе", url: "https://sinoptik.ua/ru/pohoda/odesa", publishedAt: "2024-12-31T22:00:00.000Z" });
    });

    it("keeps the exact description-based text when a result carries no snippets", async () => {
      stubYouLayer([{ title: "Погода METEOFOR", url: "https://meteofor.com/weather-odesa-4982/", description: "Weather in Odesa today, accurate weather forecast for today." }]);

      const result = await searchWeb("Какая сейчас погода в Одессе?", { publicCache: false, requireDatedSources: false });

      expect(result.evidence[0].fact).toBe("Weather in Odesa today, accurate weather forecast for today.");
    });

    it("falls back to the description for an empty, missing or unusable snippets shape", async () => {
      const cases: unknown[] = [[], null, 42, { unexpected: { nested: true } }, [{ unexpected: "shape" }], [null, 7, ""]];
      for (const snippets of cases) {
        resetPublicSearchCacheForTests();
        stubYouLayer([{ title: "Погода", url: "https://meteopost.com/city/18697/", description: "Прогноз погоды по городам", snippets }]);

        const result = await searchWeb("Какая сейчас погода в Одессе?", { publicCache: false, requireDatedSources: false });

        expect(result.state).toBe("found");
        expect(result.evidence[0].fact).toBe("Прогноз погоды по городам");
      }
    });

    it("never stringifies an unexpected snippets shape into the evidence", async () => {
      stubYouLayer([{ title: "Курс доллара", url: "https://ru.investing.com/currencies/usd-rub", description: "Котировки USD RUB", snippets: { value: { nested: ["1"] }, other: 5 } }]);

      const result = await searchWeb("Какой сейчас курс доллара?", { publicCache: false, requireDatedSources: false });

      expect(result.evidence[0].fact).toBe("Котировки USD RUB");
      expect(result.summary).not.toContain("[object Object]");
    });

    it("joins multiple snippets in order and still respects the existing evidence limit", async () => {
      const long = "я".repeat(400);
      stubYouLayer([{ title: "Погода", url: "https://www.meteoprog.com/weather/Odesa/", description: "Odesa Weather", snippets: [long, `Второй фрагмент ${long}`] }]);

      const result = await searchWeb("Какая сейчас погода в Одессе?", { publicCache: false, requireDatedSources: false });

      const fact = result.evidence[0].fact;
      expect(fact.startsWith("Odesa Weather")).toBe(true);
      expect(fact).toContain("Второй фрагмент");
      expect(fact.length).toBeLessThanOrEqual(550);
    });
  });

  describe("source selection keeps obviously relevant results out of a larger provider pool", () => {
    const stubYouLayer = (web: unknown[], news: unknown[] = []) => {
      process.env.YOU_API_KEY = "test-you";
      process.env.SERPER_API_KEY = "";
      process.env.EXA_API_KEY = "";
      process.env.TAVILY_API_KEY = "";
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
        results: { web, news },
        metadata: { query: "q", search_uuid: "u", latency: 1 },
      }), { status: 200 })));
    };
    const urls = (result: { sources: Array<{ url: string }> }) => result.sources.map((source) => source.url);

    it("keeps the financial sources of a currency query instead of unrelated Latin-titled news", async () => {
      // The real shape: You.com answers a Russian request with five web results plus
      // five news results, so the pool is twice SOURCE_LIMIT. The numeric rate lives
      // in a snippet of a Cyrillic financial page.
      stubYouLayer([
        { title: "Официальные курсы валют на заданную ...", url: "https://www.cbr.ru/currency_base/daily/", description: "Официальные курсы валют на заданную дату", page_age: "2026-09-26T04:42:38" },
        { title: "Курс доллара к рублю, котировки USD RUB ...", url: "https://ru.investing.com/currencies/usd-rub", description: "Котировки USD RUB", snippets: ["Текущий курс USD/RUB составляет 84,0420, после закрытия на 84,9955."] },
        { title: "Курс доллара на 25.09.2026 в Украине - ...", url: "https://minfin.com.ua/currency/usd/", description: "Актуальний курс валют в Україні: долар, євро" },
      ], [
        { title: "DSA stands for Delusional Socialists of America", url: "https://www.galvnews.com/opinion/dsa", description: "Delusional means believing something that is not true." },
        { title: "Putin's new MAGA immigration formula", url: "https://www.newsweek.com/maga", description: "A brutal new plan for fixing a labor shortage." },
        { title: "Rafael Nadal Docuseries 'Rafa'", url: "https://www.yahoo.com/entertainment/rafa", description: "A four-part portrait of a sports icon." },
        { title: "Sundance Prizewinner Blerta Basholli on Kosovar War Drama", url: "https://variety.com/film/dua", description: "The film premiered at Cannes." },
        { title: "Ando wants to take on Slack", url: "https://tech.yahoo.com/ai/ando", description: "A team messaging app." },
      ]);

      const result = await searchWeb("Какой сейчас курс доллара?", { publicCache: false, requireDatedSources: false });

      expect(result.state).toBe("found");
      // The three financial pages carry the request terms and come first; the two
      // remaining slots go to the earliest unrelated results, not to alphabetically
      // first Latin titles that would have displaced every Cyrillic financial page.
      expect(urls(result).slice(0, 3)).toEqual([
        "https://ru.investing.com/currencies/usd-rub",
        "https://minfin.com.ua/currency/usd/",
        "https://www.cbr.ru/currency_base/daily/",
      ]);
      expect(urls(result)).not.toContain("https://variety.com/film/dua");
      expect(urls(result)).not.toContain("https://tech.yahoo.com/ai/ando");
      expect(urls(result)).not.toContain("https://www.yahoo.com/entertainment/rafa");
      // The current value itself is what the model must be able to answer from.
      expect(result.evidence[0].fact).toContain("84,0420");
    });

    it("keeps the on-topic sources of a news query instead of unrelated world news", async () => {
      stubYouLayer([
        { title: "Одесса - последние новости сегодня ...", url: "https://ria.ru/location_Odessa/", description: "Лента новостей Одессы" },
        { title: "Новости Одессы сегодня — последние ...", url: "https://lenta.ru/tags/geo/odessa/", description: "Новости Одессы" },
        { title: "Новости Одессы — последние Одес...", url: "https://www.ukr.net/ru/news/odesa.html", description: "Все новости Одессы" },
        { title: "Новости Одесса | Одеса – Telegram", url: "https://t.me/s/our_odessa", description: "Канал Одессы" },
        { title: "Последние новости и события Одессы ...", url: "https://russian.rt.com/tag/odessa", description: "События Одессы" },
      ], [
        { title: "AfD Party's Landslide Win in Eastern Germany", url: "https://www.usnews.com/news/afd", description: "Country's firewall against the far right." },
        { title: "AfD party's landslide win in eastern Germany", url: "https://www.kiro7.com/news/afd", description: "Firewall against the far right." },
        { title: "Ando wants to take on Slack", url: "https://tech.yahoo.com/ai/ando", description: "A team messaging app." },
        { title: "Word of the Day: Goad", url: "https://www.newsbytesapp.com/goad", description: "A vocabulary word." },
        { title: "Rafael Nadal Docuseries 'Rafa'", url: "https://www.yahoo.com/entertainment/rafa", description: "A four-part portrait." },
      ]);

      const result = await searchWeb("последние новости об Одессе сегодня", { publicCache: false, requireDatedSources: false });

      expect(result.state).toBe("found");
      expect(urls(result)).toEqual([
        "https://ria.ru/location_Odessa/",
        "https://lenta.ru/tags/geo/odessa/",
        "https://www.ukr.net/ru/news/odesa.html",
        "https://t.me/s/our_odessa",
        "https://russian.rt.com/tag/odessa",
      ]);
    });

    it("keeps the weather value in evidence and the whole on-topic pool", async () => {
      stubYouLayer([
        { title: "SINOPTIK: Погода в Одессе (Украина): ...", url: "https://sinoptik.ua/ru/pohoda/odesa", description: "Погода в Одессе на неделю.", snippets: ["Одесса: 13:00 · +19°C · Восход 06:47", "Мелкий дождь, который пошел в середине дня."] },
        { title: "METEOFOR: Weather in Odesa today ...", url: "https://meteofor.com/weather-odesa-4982/", description: "Weather forecast for Odesa for today." },
        { title: "Одесса, Одесская, Украина Почасовой ...", url: "https://www.accuweather.com/ru/ua/odesa/325343/hourly", description: "Hourly weather forecast in Одесса." },
      ], [
        { title: "AfD Party's Landslide Win in Eastern Germany", url: "https://www.usnews.com/news/afd", description: "Country's firewall against the far right." },
        { title: "Ando wants to take on Slack", url: "https://tech.yahoo.com/ai/ando", description: "A team messaging app." },
        { title: "Rafael Nadal Docuseries 'Rafa'", url: "https://www.yahoo.com/entertainment/rafa", description: "A four-part portrait." },
      ]);

      const result = await searchWeb("Какая сейчас погода в Одессе?", { publicCache: false, requireDatedSources: false });

      expect(result.state).toBe("found");
      // Every on-topic weather page survives, ordered by how much of the request it
      // carries; the unrelated news only fills what SOURCE_LIMIT still allows.
      expect(urls(result).slice(0, 3)).toEqual([
        "https://sinoptik.ua/ru/pohoda/odesa",
        "https://www.accuweather.com/ru/ua/odesa/325343/hourly",
        "https://meteofor.com/weather-odesa-4982/",
      ]);
      expect(urls(result)).toHaveLength(5);
      expect(result.evidence[0].fact).toContain("+19°C");
      expect(result.evidence[0].fact).toContain("Мелкий дождь");
    });

    it("keeps a preferred domain first no matter how many query terms a page carries", async () => {
      stubYouLayer([
        { title: "Материал с максимумом совпадений про доллар и курс", url: "https://example.com/noisy", description: "Доллар, курс, доллар, курс, доллар" },
        { title: "Короткий материал", url: "https://agency.gov/rate", description: "Данные" },
      ]);

      const result = await searchWeb("Какой сейчас курс доллара?", { publicCache: false, requireDatedSources: false });

      // sourcePriority is the primary key and relevance can never displace it.
      expect(result.sources[0]).toMatchObject({ url: "https://agency.gov/rate", domain: "agency.gov" });
      expect(result.evidence[0].confidence).toBe("high");
    });

    it("breaks a relevance tie with the provider's own order, not an alphabetical title order", async () => {
      // Identical relevance, titles deliberately ordered the other way round.
      stubYouLayer([
        { title: "Zebra — курс доллара", url: "https://a.example.com/1", description: "Курс доллара" },
        { title: "Alpha — курс доллара", url: "https://b.example.com/2", description: "Курс доллара" },
        { title: "Mike — курс доллара", url: "https://c.example.com/3", description: "Курс доллара" },
      ]);

      const result = await searchWeb("Какой сейчас курс доллара?", { publicCache: false, requireDatedSources: false });

      expect(urls(result)).toEqual(["https://a.example.com/1", "https://b.example.com/2", "https://c.example.com/3"]);
    });

    it("still returns exactly SOURCE_LIMIT sources when more results are relevant than fit", async () => {
      const many = Array.from({ length: 8 }, (_, index) => ({ title: `Курс доллара ${index}`, url: `https://example.com/rate-${index}`, description: "Курс доллара на сегодня" }));
      stubYouLayer(many);

      const result = await searchWeb("Какой сейчас курс доллара?", { publicCache: false, requireDatedSources: false });

      expect(result.sources).toHaveLength(5);
      expect(result.evidence).toHaveLength(5);
      expect(urls(result)).toEqual(many.slice(0, 5).map((item) => item.url));
    });

    it("survives missing, empty and unexpected entry text while ranking", async () => {
      stubYouLayer([
        { title: "Курс доллара к рублю", url: "https://example.com/ok" },
        { title: null, url: "https://example.com/no-title", description: "Курс доллара" },
        { title: "Пусто", url: "https://example.com/empty", description: "", snippets: [] },
        { title: "Мусор", url: "https://example.com/junk", description: 42, snippets: { unexpected: true } },
        { title: "Курс доллара ЦБ", url: "https://example.com/last", description: "Курс доллара" },
      ]);

      const result = await searchWeb("Какой сейчас курс доллара?", { publicCache: false, requireDatedSources: false });

      expect(result.state).toBe("found");
      expect(result.sources.map((source) => source.url)).not.toContain("https://example.com/missing");
      // Every usable result is still ranked by relevance and returned in a stable order.
      expect(urls(result)).toEqual([
        "https://example.com/ok",
        "https://example.com/no-title",
        "https://example.com/last",
        "https://example.com/empty",
        "https://example.com/junk",
      ]);
      expect(result.evidence.every((entry) => typeof entry.fact === "string" && !entry.fact.includes("[object Object]"))).toBe(true);
    });
  });

  describe("a live value is only reported when a source proves it", () => {
    const stubYouLayer = (web: unknown[]) => {
      process.env.YOU_API_KEY = "test-you";
      process.env.SERPER_API_KEY = "";
      process.env.EXA_API_KEY = "";
      process.env.TAVILY_API_KEY = "";
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ results: { web }, metadata: { query: "q", search_uuid: "u", latency: 1 } }), { status: 200 })));
    };
    const sentQueries = (fetchMock: ReturnType<typeof vi.fn>) => fetchMock.mock.calls.map(([, init]) => (JSON.parse(String((init as { body: string }).body)) as { query: string }).query);

    it("confirms the value and puts the machine-checked line first", async () => {
      stubYouLayer([{ title: "Погода в Одессе", url: "https://example.com/weather/odesa", description: "Погода в Одессе на неделю.", snippets: ["Одесса: сейчас +19 °C, мелкий дождь."] }]);

      const result = await searchWeb("Какая сейчас погода в Одессе?", { publicCache: false, requireDatedSources: false, taskKind: "LIVE_VALUE" });

      expect(result).toMatchObject({ state: "found", liveValue: { valueStatus: "confirmed", liveValueKind: "temperature" } });
      expect(result.summary.startsWith("ИСКОМОЕ ЗНАЧЕНИЕ: ")).toBe(true);
      expect(result.summary).toContain("температура +19");
      expect(result.evidence[0].valueStatus).toBe("confirmed");
    });

    it("keeps the sources but withholds the value when no source carries it", async () => {
      stubYouLayer([{ title: "Погода в Одессе", url: "https://example.com/weather/odesa", description: "Прогноз погоды по городам на неделю." }]);

      const result = await searchWeb("Какая сейчас погода в Одессе?", { publicCache: false, requireDatedSources: false, taskKind: "LIVE_VALUE" });

      expect(result).toMatchObject({ state: "found", liveValue: { valueStatus: "unconfirmed" } });
      expect(result.sources).toHaveLength(1);
      expect(result.summary.startsWith("ИСКОМОЕ ЗНАЧЕНИЕ НЕ ПОДТВЕРЖДЕНО")).toBe(true);
      expect(result.summary).toContain("Прогноз погоды по городам");
    });

    it("never presents a value labelled for a later hour as the current one", async () => {
      // The real d024b11 shape: a current-looking reading carrying an hour label with no
      // zone. Without a zone "13:00" cannot be shown to be in the past, so it is not "now".
      stubYouLayer([{ title: "SINOPTIK: Погода в Одессе", url: "https://example.com/pohoda/odesa", description: "Погода в Одессе на неделю.", snippets: ["Одесса: 13:00 · +19°C · Восход 06:47"] }]);

      const result = await searchWeb("Какая сейчас погода в Одессе?", { publicCache: false, requireDatedSources: false, taskKind: "LIVE_VALUE" });

      expect(result).toMatchObject({ state: "found", liveValue: { valueStatus: "unconfirmed" } });
      expect(result.summary).not.toMatch(/^ИСКОМОЕ ЗНАЧЕНИЕ: /);
    });

    it("sends the untouched user request first and one narrower question only when the value is unproven", async () => {
      const fetchMock = vi.fn()
        .mockResolvedValueOnce(new Response(JSON.stringify({ results: { web: [{ title: "Погода в Одессе", url: "https://example.com/weather/odesa", description: "Прогноз погоды по городам." }] } }), { status: 200 }))
        .mockResolvedValueOnce(new Response(JSON.stringify({ results: { web: [{ title: "Odesa weather now", url: "https://example.com/weather/now", description: "Odesa.", snippets: ["Odesa: currently +19 °C, light rain."] }] } }), { status: 200 }));
      vi.stubGlobal("fetch", fetchMock);

      const result = await searchWeb("Какая сейчас погода в Одессе?", { publicCache: false, requireDatedSources: false, taskKind: "LIVE_VALUE" });

      expect(sentQueries(fetchMock)).toEqual(["Какая сейчас погода в Одессе?", "current weather Одессе temperature precipitation"]);
      expect(result).toMatchObject({ state: "found", cascadeUsed: "you", liveValue: { valueStatus: "confirmed" } });
    });

    it("never asks the same question twice when the first pass already proved the value", async () => {
      const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ results: { web: [{ title: "Погода в Одессе", url: "https://example.com/weather/odesa", description: "Погода.", snippets: ["Одесса: сейчас +19 °C."] }] } }), { status: 200 }));
      vi.stubGlobal("fetch", fetchMock);

      const result = await searchWeb("Какая сейчас погода в Одессе?", { publicCache: false, requireDatedSources: false, taskKind: "LIVE_VALUE" });

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(result).toMatchObject({ liveValue: { valueStatus: "confirmed" } });
    });

    it("respects the request budget and skips the second pass when it is exhausted", async () => {
      const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ results: { web: [{ title: "Погода в Одессе", url: "https://example.com/weather/odesa", description: "Прогноз погоды." }] } }), { status: 200 }));
      vi.stubGlobal("fetch", fetchMock);

      const result = await searchWeb("Какая сейчас погода в Одессе?", { publicCache: false, requireDatedSources: false, taskKind: "LIVE_VALUE", maxNetworkRequests: 1 });

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(result).toMatchObject({ state: "found", liveValue: { valueStatus: "unconfirmed" } });
    });

    it("skips the second pass when no narrower question can be built from the user's own words", async () => {
      const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ results: { web: [{ title: "Погода", url: "https://example.com/weather", description: "Прогноз погоды." }] } }), { status: 200 }));
      vi.stubGlobal("fetch", fetchMock);

      await searchWeb("Какая сейчас погода?", { publicCache: false, requireDatedSources: false, taskKind: "LIVE_VALUE" });

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(sentQueries(fetchMock)).toEqual(["Какая сейчас погода?"]);
    });

    it("leaves an ordinary question exactly as it was: one pass, no verdict, no value line", async () => {
      const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ results: { web: [{ title: "Погода в Одессе", url: "https://example.com/weather/odesa", description: "Прогноз погоды.", snippets: ["Одесса: сейчас +19 °C."] }] } }), { status: 200 }));
      vi.stubGlobal("fetch", fetchMock);

      const result = await searchWeb("Проверь стандарт", { publicCache: false, requireDatedSources: false, taskKind: "GENERAL" });

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(result).not.toHaveProperty("liveValue");
      expect(result.summary.startsWith("ИСКОМОЕ ЗНАЧЕНИЕ")).toBe(false);
      expect(result.evidence[0]).not.toHaveProperty("valueStatus");
    });

    it("records the task kind and the value verdict in anonymous quality telemetry", async () => {
      stubYouLayer([{ title: "Погода в Одессе", url: "https://example.com/weather/odesa", description: "Погода.", snippets: ["Одесса: сейчас +19 °C."] }]);

      await searchWeb("Какая сейчас погода в Одессе?", { publicCache: false, requireDatedSources: false, taskKind: "LIVE_VALUE" });

      expect(recordSearchQuality).toHaveBeenCalledTimes(1);
      expect(recordSearchQuality.mock.calls[0]?.[0]).toMatchObject({ outcome: "found", taskKind: "LIVE_VALUE", valueConfirmed: true, targetedPass: false });
      const serialized = JSON.stringify(recordSearchQuality.mock.calls[0]?.[0]);
      expect(serialized).not.toContain("Одессе");
      expect(serialized).not.toContain("https://");
    });

    it("does not share an unproven value with the next identical request, but shares a proven one", async () => {
      // A Response body can be read once, so every request needs a fresh one.
      const unproven = vi.fn().mockImplementation(async () => new Response(JSON.stringify({ results: { web: [{ title: "Погода в Одессе", url: "https://example.com/weather/odesa", description: "Прогноз погоды." }] } }), { status: 200 }));
      vi.stubGlobal("fetch", unproven);

      const firstUnproven = await searchWeb("Какая сейчас погода в Одессе?", { publicCache: true, requireDatedSources: false, taskKind: "LIVE_VALUE" });
      const secondUnproven = await searchWeb("Какая сейчас погода в Одессе?", { publicCache: true, requireDatedSources: false, taskKind: "LIVE_VALUE" });
      expect(firstUnproven).toMatchObject({ liveValue: { valueStatus: "unconfirmed" } });
      expect(secondUnproven).toMatchObject({ liveValue: { valueStatus: "unconfirmed" } });
      // Four requests: each unproven call runs its own two passes instead of reading a
      // shared verdict that a later request could contradict.
      expect(unproven).toHaveBeenCalledTimes(4);

      resetPublicSearchCacheForTests();
      unproven.mockImplementation(async () => new Response(JSON.stringify({ results: { web: [{ title: "Погода в Одессе", url: "https://example.com/weather/odesa", description: "Погода.", snippets: ["Одесса: сейчас +19 °C."] }] } }), { status: 200 }));
      const firstProven = await searchWeb("Какая сейчас погода в Одессе?", { publicCache: true, requireDatedSources: false, taskKind: "LIVE_VALUE" });
      const secondProven = await searchWeb("Какая сейчас погода в Одессе?", { publicCache: true, requireDatedSources: false, taskKind: "LIVE_VALUE" });
      expect(firstProven).toMatchObject({ liveValue: { valueStatus: "confirmed" } });
      expect(secondProven).toMatchObject({ liveValue: { valueStatus: "confirmed" } });
      // Five: the first proven call confirms in one pass and the second is served from cache.
      expect(unproven).toHaveBeenCalledTimes(5);
    });
  });
});
