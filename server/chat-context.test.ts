import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./db", () => ({
  createMemoryFact: vi.fn(),
  getMemoryProfile: vi.fn().mockResolvedValue({ enabled: 0, autoExtract: 0, profile: "", summary: "" }),
  getOwnedChatAttachments: vi.fn().mockResolvedValue([]),
  getUserSettings: vi.fn().mockResolvedValue({ responseStyle: "default", responseLength: "balanced", quickReplies: 1, effort: "standard", thinking: 0 }),
  listMemoryFacts: vi.fn().mockResolvedValue([]),
  listRelevantMemoryFacts: vi.fn().mockResolvedValue([]),
}));

vi.mock("./web-search", () => {
  class WebSearchUnavailableError extends Error {}
  return {
    WebSearchUnavailableError,
    searchWeb: vi.fn().mockResolvedValue({ summary: "Свежие проверяемые данные.", sources: [{ title: "Официальный источник", url: "https://example.com", domain: "example.com" }] }),
  };
});

vi.mock("./attachments", () => ({
  getAttachmentPromptText: vi.fn().mockReturnValue(""),
  getOwnedAttachmentDownload: vi.fn(),
}));

vi.mock("./knowledge", () => ({
  retrieveRagContext: vi.fn().mockResolvedValue({ context: "Проверяемый RAG-контекст.", sources: [{ title: "Официальный RSS", url: "https://openai.com/news/release", publishedAt: "2026-08-19T00:00:00.000Z", sourceId: "openai-news" }] }),
}));

import { buildChatContext, FLASH_WEB_RESEARCH_BUDGET_MS, WEB_RESEARCH_ROLE_POLICY } from "./chat-context";
import { getMemoryProfile, listRelevantMemoryFacts } from "./db";
import { WebSearchUnavailableError, searchWeb } from "./web-search";

const input = { query: "Что нового?", attachmentIds: [] };

afterEach(() => {
  vi.mocked(getMemoryProfile).mockResolvedValue({ enabled: 0, autoExtract: 0, profile: "", summary: "" });
  vi.mocked(listRelevantMemoryFacts).mockResolvedValue([]);
  vi.mocked(searchWeb).mockResolvedValue({ summary: "Свежие проверяемые данные.", sources: [{ title: "Официальный источник", url: "https://example.com", domain: "example.com" }] });
});

describe("chat context mandatory web search", () => {
  it("retains the server-side policy for exactly four public roles", () => {
    expect([...WEB_RESEARCH_ROLE_POLICY]).toEqual(["fast", "smart", "context", "flagship"]);
  });

  it("always injects verified fresh web research for a public role", async () => {
    await expect(buildChatContext(7, "11111111-1111-4111-8111-111111111111", { ...input, role: "fast" }))
      .resolves.toMatchObject({ webResearch: "Свежие проверяемые данные.", webSources: [{ title: "Официальный источник", url: "https://example.com" }] });
    expect(searchWeb).toHaveBeenCalledTimes(1);
    expect(searchWeb).toHaveBeenCalledWith(expect.any(String), { timeoutMs: FLASH_WEB_RESEARCH_BUDGET_MS });
  });

  it("does not constrain non-Flash roles to the Flash freshness budget", async () => {
    await buildChatContext(7, "11111111-1111-4111-8111-111111111111", { ...input, role: "smart" });
    expect(searchWeb).toHaveBeenCalledWith(expect.any(String), undefined);
  });

  it("rejects instead of silently generating without fresh sources", async () => {
    vi.mocked(searchWeb).mockRejectedValueOnce(new WebSearchUnavailableError("Поиск не вернул проверяемые свежие источники."));
    await expect(buildChatContext(7, "11111111-1111-4111-8111-111111111111", { ...input, role: "smart" }))
      .rejects.toThrow("Поиск не вернул проверяемые свежие источники.");
  });

  it("keeps attributable RAG as an additional context rather than a search substitute", async () => {
    await expect(buildChatContext(7, "11111111-1111-4111-8111-111111111111", { ...input, role: "context" }))
      .resolves.toMatchObject({ webResearch: "Свежие проверяемые данные.", ragResearch: "Проверяемый RAG-контекст.", ragSources: [{ title: "Официальный RSS", url: "https://openai.com/news/release", publishedAt: "2026-08-19T00:00:00.000Z" }] });
  });

  it("injects only a bounded personal-memory context when the owner enabled memory", async () => {
    vi.mocked(getMemoryProfile).mockResolvedValueOnce({ enabled: 1, autoExtract: 1, profile: "Профиль владельца", summary: "Краткая сводка" });
    vi.mocked(listRelevantMemoryFacts).mockResolvedValueOnce(Array.from({ length: 24 }, (_, index) => ({ fact: `Факт ${index + 1}: ${"x".repeat(120)}` })));

    const context = await buildChatContext(7, "11111111-1111-4111-8111-111111111111", { query: "Продолжи", role: "flagship" });

    expect(context.memoryContext).toContain("Профиль владельца");
    expect(context.memoryContext).toContain("Факт 15");
    expect(context.memoryContext).not.toContain("Факт 16");
    expect(context.memoryContext?.length).toBeLessThanOrEqual(2_000);
  });

  it("omits personal memory after the owner disables it", async () => {
    vi.mocked(getMemoryProfile).mockResolvedValueOnce({ enabled: 0, autoExtract: 0, profile: "Не должно попасть в контекст", summary: "" });
    vi.mocked(listRelevantMemoryFacts).mockResolvedValueOnce([{ fact: "Не должен попасть в контекст" }]);

    await expect(buildChatContext(7, "11111111-1111-4111-8111-111111111111", { query: "Новый чат", role: "flagship" }))
      .resolves.not.toHaveProperty("memoryContext");
  });
});
