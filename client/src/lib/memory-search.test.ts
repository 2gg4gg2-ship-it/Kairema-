import { describe, expect, it } from "vitest";
import { memorySearchMatches } from "./memory-search";

describe("memorySearchMatches", () => {
  it("finds the required Russian inflection without rewriting stored memory", () => {
    expect(memorySearchMatches("размер луны", "Луна")).toBe(true);
    expect(memorySearchMatches("Приёмочный маркер cobalt-917", "Луна")).toBe(false);
  });

  it("keeps multi-token matching conjunctive and treats an empty query as all entries", () => {
    expect(memorySearchMatches("размер и диаметр Луны", "размер луна")).toBe(true);
    expect(memorySearchMatches("размер и диаметр Луны", "размер Марс")).toBe(false);
    expect(memorySearchMatches("размер и диаметр Луны", "  ")).toBe(true);
  });
});
