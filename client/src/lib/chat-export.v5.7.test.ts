import { beforeEach, describe, expect, it, vi } from "vitest";

const pdfConstructor = vi.fn();
vi.mock("jspdf", () => ({
  jsPDF: class {
    internal = { pageSize: { getWidth: () => 210, getHeight: () => 297 } };
    constructor() { pdfConstructor(); }
    addFileToVFS() {}
    addFont() {}
    setFont() {}
    setProperties() {}
    setFontSize() {}
    setTextColor() {}
    splitTextToSize(value: string) { return [value]; }
    text() {}
    addPage() {}
    output() { return new Blob(["pdf"]); }
  },
}));

const input = { title: "Тест", messages: [{ role: "user" as const, content: "Проверка" }], exportedAt: new Date("2026-08-19T00:00:00.000Z") };

describe("v5.7 lazy PDF export", () => {
  beforeEach(() => {
    pdfConstructor.mockReset();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, arrayBuffer: async () => new ArrayBuffer(2) }));
  });

  it("does not load the PDF renderer for a Markdown export", async () => {
    const { prepareChatMarkdown } = await import("./chat-export");
    const file = await prepareChatMarkdown(input);
    expect(file.fileName).toContain(".md");
    expect(pdfConstructor).not.toHaveBeenCalled();
  });

  it("loads the isolated renderer only when a PDF is requested", async () => {
    const { prepareChatPdf } = await import("./chat-export");
    const file = await prepareChatPdf(input);
    expect(file.contentType).toBe("application/pdf");
    expect(pdfConstructor).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
