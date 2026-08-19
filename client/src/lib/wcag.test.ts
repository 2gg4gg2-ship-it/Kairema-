import { describe, expect, it } from "vitest";
import { contrastRatio } from "./wcag";

describe("Kairema v5.2 WCAG AA tokens", () => {
  const pairs = [
    ["light primary", "#121212", "#f7f7f5"],
    ["light muted", "#4e4e49", "#f7f7f5"],
    ["light user bubble", "#ffffff", "#181818"],
    ["dark primary", "#f4f4f1", "#0c0c0c"],
    ["dark muted", "#c4c4bc", "#0c0c0c"],
    ["dark user bubble", "#f4f4f1", "#242422"],
  ] as const;

  it.each(pairs)("keeps %s at WCAG AA normal-text contrast", (_name, foreground, background) => {
    expect(contrastRatio(foreground, background)).toBeGreaterThanOrEqual(4.5);
  });
});
