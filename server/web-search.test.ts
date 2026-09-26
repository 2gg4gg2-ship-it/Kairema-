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
});
