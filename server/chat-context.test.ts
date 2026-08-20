import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./db", () => ({
  createMemoryFact: vi.fn(),
  getMemoryProfile: vi.fn().mockResolvedValue({ enabled: 0, autoExtract: 0, profile: "", summary: "" }),
  getOwnedChatAttachments: vi.fn().mockResolvedValue([]),
  getUserSettings: vi.fn().mockResolvedValue({ responseStyle: "default", responseLength: "balanced", quickReplies: 1, effort: "standard", thinking: 0 }),
  listMemoryFacts: vi.fn().mockResolvedValue([]),
  listRelevantMemoryFacts: vi.fn().mockResolvedValue([]),
}));

vi.mock("./web-search", () => ({
  WebSearchUnavailableError: class WebSearchUnavailableError extends Error {},
  searchWeb: vi.fn().mockRejectedValue(new (class WebSearchUnavailableError extends Error {})()),
}));

vi.mock("./attachments", () => ({
  getAttachmentPromptText: vi.fn().mockReturnValue(""),
  getOwnedAttachmentDownload: vi.fn(),
}));

vi.mock("./knowledge", () => ({
  retrieveRagContext: vi.fn().mockResolvedValue({ context: "Проверяемый RAG-контекст.", sources: [{ title: "Официальный RSS", url: "https://openai.com/news/release", publishedAt: "2026-08-19T00:00:00.000Z", sourceId: "openai-news" }] }),
}));

import { buildChatContext, WEB_RESEARCH_ROLE_POLICY } from "./chat-context";
import { getMemoryProfile, listRelevantMemoryFacts } from "./db";

afterEach(() => {
  vi.mocked(getMemoryProfile).mockResolvedValue({ enabled: 0, autoExtract: 0, profile: "", summary: "" });
  vi.mocked(listRelevantMemoryFacts).mockResolvedValue([]);
});

describe("chat context web-search fallback", () => {
  it("limits live search to the server-side policy for the four public roles", () => {
    expect([...WEB_RESEARCH_ROLE_POLICY]).toEqual(["fast", "smart", "context", "flagship"]);
  });

  it("keeps an ordinary text chat usable when optional web search is unavailable", async () => {
    await expect(buildChatContext(7, "11111111-1111-4111-8111-111111111111", { query: "Обычный вопрос", attachmentIds: [], webSearch: true }))
      .resolves.toMatchObject({ style: "default", responseLength: "balanced", quickReplies: true, effort: "standard", thinking: false });
  });

  it("injects attributable RAG context even when web search is disabled", async () => {
    await expect(buildChatContext(7, "11111111-1111-4111-8111-111111111111", { query: "Что нового?", attachmentIds: [], webSearch: false }))
      .resolves.toMatchObject({ ragResearch: "Проверяемый RAG-контекст.", ragSources: [{ title: "Официальный RSS", url: "https://openai.com/news/release", publishedAt: "2026-08-19T00:00:00.000Z" }] });
  });

  it("injects only a bounded personal-memory context when the owner enabled memory", async () => {
    vi.mocked(getMemoryProfile).mockResolvedValueOnce({ enabled: 1, autoExtract: 1, profile: "Профиль владельца", summary: "Краткая сводка" });
    vi.mocked(listRelevantMemoryFacts).mockResolvedValueOnce(Array.from({ length: 24 }, (_, index) => ({ fact: `Факт ${index + 1}: ${"x".repeat(120)}` })));

    const context = await buildChatContext(7, "11111111-1111-4111-8111-111111111111", { query: "Продолжи", webSearch: false });

    expect(context.memoryContext).toContain("Профиль владельца");
    expect(context.memoryContext).toContain("Факт 15");
    expect(context.memoryContext).not.toContain("Факт 16");
    expect(context.memoryContext?.length).toBeLessThanOrEqual(2_000);
  });

  it("omits personal memory after the owner disables it", async () => {
    vi.mocked(getMemoryProfile).mockResolvedValueOnce({ enabled: 0, autoExtract: 0, profile: "Не должно попасть в контекст", summary: "" });
    vi.mocked(listRelevantMemoryFacts).mockResolvedValueOnce([{ fact: "Не должен попасть в контекст" }]);

    await expect(buildChatContext(7, "11111111-1111-4111-8111-111111111111", { query: "Новый чат", webSearch: false }))
      .resolves.not.toHaveProperty("memoryContext");
  });
});
