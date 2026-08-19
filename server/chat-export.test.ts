import { describe, expect, it } from "vitest";
import { buildChatMarkdown, exportFileStem } from "../shared/chat-export";

describe("chat history export", () => {
  it("formats only supplied messages into a readable Markdown document", () => {
    const markdown = buildChatMarkdown({
      title: "План / на завтра",
      exportedAt: new Date("2026-08-19T10:30:00.000Z"),
      messages: [
        { role: "user", content: "Составь план", createdAt: new Date("2026-08-19T10:00:00.000Z") },
        { role: "assistant", content: "1. Начать с приоритетов", providerLabel: "Kairema Ultra", model: "google/gemma-4-26b-a4b-it:free" },
      ],
    });
    expect(markdown).toContain("# План / на завтра");
    expect(markdown).toContain("## 1. Вы");
    expect(markdown).toContain("## 2. Kairema Ultra");
    expect(markdown).toContain("google/gemma-4-26b-a4b-it:free");
  });

  it("creates a safe download filename without filesystem-reserved characters", () => {
    expect(exportFileStem("Чат: план/на*день?")).toBe("Чат план на день");
    expect(exportFileStem("   ")).toBe("разговор-kairema");
  });
});
