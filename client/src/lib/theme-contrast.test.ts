import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function relativeLuminance(hex: string) {
  const channels = hex.match(/[a-f\d]{2}/gi)!.map((value) => {
    const normalized = Number.parseInt(value, 16) / 255;
    return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!;
}

function contrast(first: string, second: string) {
  const [lighter, darker] = [relativeLuminance(first), relativeLuminance(second)].sort((a, b) => b - a);
  return (lighter + 0.05) / (darker + 0.05);
}

describe("Kairema theme contrast", () => {
  const css = readFileSync(resolve(process.cwd(), "client/src/index.css"), "utf8");

  it("keeps send, stop and disabled controls at or above 3:1 in both themes", () => {
    expect(css).toContain(".kairema-send:disabled");
    expect(css).toContain(".kairema-cancel");
    expect(contrast("#121212", "#ffffff")).toBeGreaterThanOrEqual(3);
    expect(contrast("#f4f4f1", "#121212")).toBeGreaterThanOrEqual(3);
    expect(contrast("#4e4e49", "#f0f0ed")).toBeGreaterThanOrEqual(3);
    expect(contrast("#c4c4bc", "#1a1a1a")).toBeGreaterThanOrEqual(3);
    expect(contrast("#3a0811", "#ffb6c0")).toBeGreaterThanOrEqual(3);
  });

  it("keeps export and file headings plus empty states at or above 4.5:1", () => {
    expect(css).toContain(".kairema-sidebar-section .kairema-empty");
    expect(contrast("#121212", "#ffffff")).toBeGreaterThanOrEqual(4.5);
    expect(contrast("#f4f4f1", "#131313")).toBeGreaterThanOrEqual(4.5);
  });

  it("uses dedicated readable bubble tokens in both themes", () => {
    expect(css).toContain("--k-bubble-user-bg");
    expect(css).toContain("--k-bubble-user-text");
    expect(css).toContain("--k-bubble-ai-bg");
    expect(css).toContain("--k-bubble-ai-text");
    expect(contrast("#1d263a", "#f8fafc")).toBeGreaterThanOrEqual(4.5);
    expect(contrast("#eef4ff", "#10213a")).toBeGreaterThanOrEqual(4.5);
    expect(contrast("#151922", "#f3f4f6")).toBeGreaterThanOrEqual(4.5);
    expect(contrast("#f7f8fa", "#18202b")).toBeGreaterThanOrEqual(4.5);
  });
});
