import { describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  createKnowledgeRun: vi.fn(),
  ensureKnowledgeSource: vi.fn(),
  finishKnowledgeRun: vi.fn(),
  listKnowledgeDocuments: vi.fn(),
  listKnowledgeRuns: vi.fn(),
  listKnowledgeSources: vi.fn(),
  recordKnowledgeDocument: vi.fn(),
  trimKnowledgeDocuments: vi.fn(),
  upsertKnowledgeSource: vi.fn(),
}));

vi.mock("./db", () => db);

import { parseOfficialFeed, refreshKnowledgeBase, retrieveRagContext } from "./knowledge";

describe("Kairema RAG", () => {
  it("извлекает из RSS только проверяемые HTTPS-поля без HTML", () => {
    const entries = parseOfficialFeed(`<?xml version="1.0"?><rss><channel><item><title><![CDATA[<b>Новый релиз</b>]]></title><link>https://openai.com/news/release</link><description><![CDATA[<p>Проверяемый <strong>фрагмент</strong>.</p>]]></description><pubDate>Tue, 19 Aug 2026 12:00:00 GMT</pubDate></item><item><title>Непригодный</title><link>javascript:alert(1)</link></item></channel></rss>`);
    expect(entries).toEqual([{ title: "Новый релиз", sourceUrl: "https://openai.com/news/release", excerpt: "Проверяемый фрагмент.", publishedAt: new Date("2026-08-19T12:00:00.000Z") }]);
  });

  it("возвращает только релевантные атрибутированные фрагменты и ограничивает контекст", async () => {
    db.listKnowledgeDocuments.mockResolvedValue([
      { sourceId: "openai-news", title: "Новый API для разработчиков", sourceUrl: "https://openai.com/news/api", excerpt: "Документация API обновлена для разработчиков.", publishedAt: new Date("2026-08-19T00:00:00.000Z") },
      { sourceId: "google-ai-blog", title: "Другой материал", sourceUrl: "https://blog.google/ai/other", excerpt: "Материал без совпадений.", publishedAt: new Date("2026-08-18T00:00:00.000Z") },
    ]);
    const result = await retrieveRagContext("Что нового в API для разработчиков?");
    expect(result?.sources).toEqual([{ title: "Новый API для разработчиков", url: "https://openai.com/news/api", publishedAt: "2026-08-19T00:00:00.000Z", sourceId: "openai-news" }]);
    expect(result?.context).toContain("Источник: https://openai.com/news/api");
    expect(result?.context.length).toBeLessThanOrEqual(3_500);
  });

  it("исключает документы старше 90 дней и применяет меньший бюджет роли Быстрый", async () => {
    const fresh = new Date(Date.now() - 2 * 24 * 60 * 60 * 1_000);
    const expired = new Date(Date.now() - 91 * 24 * 60 * 60 * 1_000);
    db.listKnowledgeDocuments.mockResolvedValue([
      { sourceId: "openai-news", title: "Свежий API", sourceUrl: "https://openai.com/news/fresh-api", excerpt: "Свежая документация API.", publishedAt: fresh },
      { sourceId: "openai-news", title: "Старый API", sourceUrl: "https://openai.com/news/expired-api", excerpt: "Устаревшая документация API.", publishedAt: expired },
    ]);
    const result = await retrieveRagContext("API документация", "fast");
    expect(result?.sources).toHaveLength(1);
    expect(result?.sources[0]?.url).toBe("https://openai.com/news/fresh-api");
    expect(result?.context.length).toBeLessThanOrEqual(1_400);
  });

  it("создаёт официальный источник до audit run при первом обновлении пустой базы", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(`<?xml version="1.0"?><rss><channel><item><title>OpenAI API</title><link>https://openai.com/news/api</link><description>Обновление API</description></item></channel></rss>`, { status: 200 }));
    db.ensureKnowledgeSource.mockResolvedValue(undefined);
    db.createKnowledgeRun.mockResolvedValue(undefined);
    db.recordKnowledgeDocument.mockResolvedValue("created");
    db.trimKnowledgeDocuments.mockResolvedValue(undefined);
    db.upsertKnowledgeSource.mockResolvedValue(undefined);
    db.finishKnowledgeRun.mockResolvedValue(undefined);

    await refreshKnowledgeBase("manual");

    expect(db.ensureKnowledgeSource).toHaveBeenNthCalledWith(1, { id: "openai-news", displayName: "OpenAI News", feedUrl: "https://openai.com/news/rss.xml" });
    expect(db.createKnowledgeRun.mock.invocationCallOrder[0]).toBeGreaterThan(db.ensureKnowledgeSource.mock.invocationCallOrder[0]);
    globalThis.fetch = originalFetch;
  });
});
