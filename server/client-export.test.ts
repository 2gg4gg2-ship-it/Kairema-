import { afterEach, describe, expect, it, vi } from "vitest";
import { downloadChatMarkdown, downloadChatPdf } from "../client/src/lib/chat-export";

const input = {
  title: "План: август",
  exportedAt: new Date("2026-08-19T07:00:00.000Z"),
  messages: [
    { role: "user" as const, content: "Составь план" },
    { role: "assistant" as const, content: "1. Проверить экспорт", providerLabel: "Kairema", model: "openrouter/free" },
  ],
};

describe("browser chat exports", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("creates a Markdown Blob with the selected chat content and triggers a download", async () => {
    const click = vi.fn();
    const link = { href: "", download: "", click, remove: vi.fn() };
    const createObjectURL = vi.fn(() => "blob:kairema-markdown");
    vi.stubGlobal("document", { createElement: vi.fn(() => link), body: { appendChild: vi.fn() } });
    vi.stubGlobal("window", { setTimeout: (callback: () => void) => { callback(); return 1; } });
    vi.stubGlobal("URL", { createObjectURL, revokeObjectURL: vi.fn() });

    downloadChatMarkdown(input);

    expect(link.download).toBe("План август.md");
    expect(click).toHaveBeenCalledOnce();
    const blob = createObjectURL.mock.calls[0]![0] as Blob;
    expect(blob.type).toContain("text/markdown");
    await expect(blob.text()).resolves.toContain("Составь план");
    await expect(blob.text()).resolves.toContain("1. Проверить экспорт");
  });

  it("generates a Russian PDF document containing the selected chat and saves it", async () => {
    const state = { savedAs: "", written: [] as string[] };
    class FakePdf {
      internal = { pageSize: { getWidth: () => 210, getHeight: () => 297 } };
      addFileToVFS() {}
      addFont() {}
      setFont() {}
      setProperties() {}
      setFontSize() {}
      setTextColor() {}
      splitTextToSize(value: string) { return [value]; }
      addPage() {}
      text(value: string) { state.written.push(value); }
      save(filename: string) { state.savedAs = filename; }
    }
    vi.doMock("jspdf", () => ({ jsPDF: FakePdf }));
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(new Uint8Array([1, 2, 3]), { status: 200 })));

    await downloadChatPdf(input);

    expect(state.savedAs).toBe("План август.pdf");
    expect(state.written.join("\n")).toContain("Составь план");
    expect(state.written.join("\n")).toContain("1. Проверить экспорт");
  });
});
