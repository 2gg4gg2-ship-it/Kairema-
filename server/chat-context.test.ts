import { describe, expect, it, vi } from "vitest";

vi.mock("./db", () => ({
  createMemoryFact: vi.fn(),
  getMemoryProfile: vi.fn().mockResolvedValue({ enabled: 0, autoExtract: 0, profile: "", summary: "" }),
  getOwnedChatAttachments: vi.fn().mockResolvedValue([]),
  getUserSettings: vi.fn().mockResolvedValue({ responseStyle: "default", responseLength: "balanced", quickReplies: 1, effort: "standard", thinking: 0 }),
  listMemoryFacts: vi.fn().mockResolvedValue([]),
}));

vi.mock("./web-search", () => ({
  WebSearchUnavailableError: class WebSearchUnavailableError extends Error {},
  searchWeb: vi.fn().mockRejectedValue(new (class WebSearchUnavailableError extends Error {})()),
}));

vi.mock("./attachments", () => ({
  getAttachmentPromptText: vi.fn().mockReturnValue(""),
  getOwnedAttachmentDownload: vi.fn(),
}));

import { buildChatContext } from "./chat-context";

describe("chat context web-search fallback", () => {
  it("keeps an ordinary text chat usable when optional web search is unavailable", async () => {
    await expect(buildChatContext(7, "11111111-1111-4111-8111-111111111111", { query: "Обычный вопрос", attachmentIds: [], webSearch: true }))
      .resolves.toMatchObject({ style: "default", responseLength: "balanced", quickReplies: true, effort: "standard", thinking: false });
  });
});
