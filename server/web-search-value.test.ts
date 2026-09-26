import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  buildValueTargetedQuery,
  classifySearchTaskKind,
  extractValues,
  LIVE_VALUE_UNCONFIRMED_LINE,
  liveValueEntity,
  liveValueKinds,
  validateValue,
  valueSummaryLine,
  type ExtractedValue,
  type ValueReason,
  type ValueStatus,
} from "./web-search-value";

type FixtureEntry = { title: string; url: string; publishedAt: string | null; text: unknown };
type FixtureCase = {
  name: string;
  query: string;
  now: string;
  httpStatus?: number;
  entries: FixtureEntry[];
  expected: { status: ValueStatus; reason: ValueReason; asOf: string | null; value?: string };
};
type FixtureFile = { cases: FixtureCase[] };

const fixtureDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "__fixtures__", "search");
const fixtureCases: FixtureCase[] = readdirSync(fixtureDir)
  .filter((file) => file.endsWith(".json"))
  .sort()
  .flatMap((file) => (JSON.parse(readFileSync(path.join(fixtureDir, file), "utf8")) as FixtureFile).cases);

/**
 * The same decision the pipeline makes per source, kept here as a pure replay of recorded
 * provider payloads. The first source that proves the value wins, exactly as the two-pass
 * search treats its passes.
 */
function evaluate(testCase: FixtureCase) {
  const kinds = liveValueKinds(testCase.query);
  const entity = liveValueEntity(testCase.query);
  const now = new Date(testCase.now);
  let unconfirmed: { reason: ValueReason; asOf: string | null } = { reason: "missing_kind", asOf: null };
  for (const entry of testCase.entries) {
    const text = typeof entry.text === "string" ? entry.text : "";
    const values: ExtractedValue[] = kinds.flatMap((kind) => extractValues(text, kind));
    const validation = validateValue({ values, kinds, text, entity, now, sourceDate: entry.publishedAt, context: `${entry.title ?? ""} ${entry.url ?? ""}` });
    if (validation.status === "confirmed") return validation;
    if (unconfirmed.reason === "missing_kind" && validation.reason !== "missing_kind") unconfirmed = { reason: validation.reason, asOf: validation.asOf };
  }
  return { status: "unconfirmed" as const, ...unconfirmed, values: [] as ExtractedValue[] };
}

describe("live-value quality harness", () => {
  it("has a non-trivial corpus of recorded payloads", () => {
    expect(fixtureCases.length).toBeGreaterThanOrEqual(20);
    expect(new Set(fixtureCases.map((testCase) => testCase.name)).size).toBe(fixtureCases.length);
  });

  for (const testCase of fixtureCases) {
    it(`${testCase.name}: ${testCase.expected.status} (${testCase.expected.reason})`, () => {
      const validation = evaluate(testCase);
      expect(validation.status).toBe(testCase.expected.status);
      expect(validation.reason).toBe(testCase.expected.reason);
      expect(validation.asOf).toBe(testCase.expected.asOf);
      if (testCase.expected.value !== undefined) {
        expect(validation.values.map((value) => value.value)).toContain(testCase.expected.value);
      }
    });
  }

  it("never confirms a value for a corpus case that carries none", () => {
    // The hard gate: every unconfirmed fixture must stay unconfirmed, and every confirmed
    // fixture must carry a value whose extracted text is real, not a rendered object.
    const falseConfirmations = fixtureCases.filter((testCase) => testCase.expected.status === "unconfirmed").filter((testCase) => evaluate(testCase).status === "confirmed");
    expect(falseConfirmations.map((testCase) => testCase.name)).toEqual([]);
  });

  it("renders a value line that never leaks an object or an empty value", () => {
    const lines = fixtureCases.map((testCase) => valueSummaryLine(evaluate(testCase), "example.com"));
    for (const line of lines) {
      expect(line).not.toMatch(/\[object Object\]/);
      expect(line).not.toMatch(/undefined|NaN|\(\s*,/);
      expect(line.length).toBeLessThanOrEqual(240);
    }
    expect(lines.filter((line) => line === LIVE_VALUE_UNCONFIRMED_LINE).length).toBeGreaterThan(0);
    expect(lines.some((line) => line.startsWith("ИСКОМОЕ ЗНАЧЕНИЕ: "))).toBe(true);
  });

  it("keeps the confirmation rate per kind above the floor of the recorded corpus", () => {
    // The corpus is deliberately negative-heavy — most real provider payloads do not carry
    // a provable value — so this floor only proves the extractor still fires at all. The
    // dangerous direction is the opposite one and is gated separately: zero false
    // confirmations across every unconfirmed case.
    const expectations: Array<[string, number]> = [["temperature", 0.25], ["clock", 0.2], ["rate", 0.4]];
    for (const [kind, floor] of expectations) {
      const cases = fixtureCases.filter((testCase) => liveValueKinds(testCase.query).includes(kind as never));
      const confirmed = cases.filter((testCase) => evaluate(testCase).status === "confirmed").length;
      expect(cases.length).toBeGreaterThan(0);
      expect(confirmed).toBeGreaterThan(0);
      expect(confirmed / cases.length).toBeGreaterThanOrEqual(floor);
    }
  });
});

describe("task kind classification", () => {
  it("separates a live value from a publication-dated request", () => {
    expect(classifySearchTaskKind("Какая сейчас погода в Одессе?")).toBe("LIVE_VALUE");
    expect(classifySearchTaskKind("Который сейчас час в Одессе?")).toBe("LIVE_VALUE");
    expect(classifySearchTaskKind("Какой сейчас курс доллара к гривне?")).toBe("LIVE_VALUE");
    expect(classifySearchTaskKind("Какой последний Claude вышел?")).toBe("RECENT");
    expect(classifySearchTaskKind("Какой сейчас последний релиз Claude?")).toBe("RECENT");
    expect(classifySearchTaskKind("Какая текущая версия браузера?")).toBe("RECENT");
    expect(classifySearchTaskKind("Сколько стоит подписка?")).toBe("GENERAL");
    expect(classifySearchTaskKind("Что такое Марс?")).toBe("GENERAL");
    expect(classifySearchTaskKind("   ")).toBe("NONE");
  });

  it("resolves the live kinds and the entity from the user's own words", () => {
    expect(liveValueKinds("Какая сейчас погода в Одессе?")).toEqual(["temperature", "conditions"]);
    expect(liveValueKinds("Который сейчас час в Одессе?")).toEqual(["clock"]);
    expect(liveValueKinds("Какой сейчас курс доллара к гривне?")).toEqual(["rate"]);
    expect(liveValueKinds("Что такое Марс?")).toEqual([]);
    expect(liveValueEntity("Какая сейчас погода в Одессе?")).toBe("Одессе");
    expect(liveValueEntity("Какой сейчас курс доллара к гривне?")).toBeNull();
    expect(liveValueEntity("Какая сейчас погода в мире?")).toBeNull();
  });
});

describe("value-shaped targeted query", () => {
  it("keeps the entity, adds no instruction and differs from the user query", () => {
    const query = "Какая сейчас погода в Одессе?";
    const targeted = buildValueTargetedQuery(query, liveValueKinds(query), liveValueEntity(query));
    expect(targeted).toBe("current weather Одессе temperature precipitation");
    expect(targeted).toContain("Одессе");
    expect(targeted).not.toBe(query);
    expect(targeted).not.toMatch(/найди|ищи|собери|original user request|authoritative/i);
    expect(buildValueTargetedQuery("Который сейчас час в Одессе?", ["clock"], "Одессе")).toBe("current time in Одессе");
  });

  it("is skipped rather than guessed when a part cannot be resolved", () => {
    // No entity, no kinds, and a currency pair that the query never named: a second
    // formulation would be an invention, so no request is made at all.
    expect(buildValueTargetedQuery("Какая сейчас погода?", liveValueKinds("Какая сейчас погода?"), null)).toBeNull();
    expect(buildValueTargetedQuery("Что такое Марс?", liveValueKinds("Что такое Марс?"), "Марс")).toBeNull();
    expect(buildValueTargetedQuery("Какой сейчас курс доллара?", ["rate"], null)).toBeNull();
    expect(buildValueTargetedQuery("Какой сейчас курс доллара?", ["rate"], "США")).toBeNull();
    expect(buildValueTargetedQuery("Какой сейчас курс доллара к гривне?", ["rate"], "Украина")).toBe("current exchange rate USD UAH");
  });

  it("builds a rate question from the named currency pair even with no place named", () => {
    // A rate is not about a place: the pair in the user's own words is enough, so the
    // second pass no longer depends on a preposition the question happens to contain.
    const givna = "Какой сейчас курс доллара к гривне?";
    expect(buildValueTargetedQuery(givna, liveValueKinds(givna), liveValueEntity(givna))).toBe("current exchange rate USD UAH");
    const euro = "Какой сейчас курс EUR/USD?";
    expect(buildValueTargetedQuery(euro, liveValueKinds(euro), liveValueEntity(euro))).toBe("current exchange rate USD EUR");
  });

  it("still needs a place for weather and clock, and a pair for an ambiguous rate", () => {
    expect(buildValueTargetedQuery("Какая сейчас погода?", ["temperature", "conditions"], null)).toBeNull();
    expect(buildValueTargetedQuery("Который сейчас час?", ["clock"], null)).toBeNull();
    // One currency is not a rate, and a bare topic word is not a pair: no second pass.
    expect(buildValueTargetedQuery("Какой сейчас курс доллара?", ["rate"], null)).toBeNull();
    expect(buildValueTargetedQuery("Какой сейчас курс?", ["rate"], null)).toBeNull();
  });
});

describe("entity attribution", () => {
  const validate = (text: string, entity: string | null, publishedAt: string | null = null) =>
    validateValue({
      values: extractValues(text, "temperature"),
      kinds: ["temperature"],
      text,
      entity,
      now: new Date("2026-09-26T09:34:00.000Z"),
      sourceDate: publishedAt,
      context: text,
    });

  it("matches the requested place across scripts and inflections", () => {
    // The narrower pass asks in English, so an "Odesa" page must still answer "Одессе",
    // while a page about another city must not.
    expect(validate("Odesa: currently +19 °C.", "Одессе").status).toBe("confirmed");
    expect(validate("Одесса: +19 °C, сейчас.", "Одессе").status).toBe("confirmed");
    expect(validate("Odesa, Ukraine: +19 °C, currently.", "Одессе").status).toBe("confirmed");
    expect(validate("Kyiv: currently +12 °C.", "Одессе").status).toBe("unconfirmed");
    expect(validate("Odesa: currently +12 °C.", null).status).toBe("confirmed");
  });
});

describe("value extraction", () => {
  it("requires a unit for a temperature and a two-part clock reading", () => {
    expect(extractValues("40 20 0 -20 -40", "temperature")).toEqual([]);
    expect(extractValues("температура +19 °C", "temperature").map((value) => value.value)).toEqual(["+19"]);
    expect(extractValues("18 градусов тепла", "temperature").map((value) => value.value)).toEqual(["18"]);
    expect(extractValues("Обновлено 2026-09-26 12:40", "clock")).toEqual([]);
    expect(extractValues("Время 12:40", "clock").map((value) => value.value)).toEqual(["12:40"]);
    expect(extractValues("Курс 41,2530", "rate")).toEqual([]);
    expect(extractValues("USD/UAH 41,2530", "rate").map((value) => value.value)).toEqual(["41,2530"]);
  });

  it("never returns a value for a non-string snippet", () => {
    for (const kind of ["temperature", "conditions", "clock", "rate"] as const) {
      expect(extractValues(undefined as never, kind)).toEqual([]);
      expect(extractValues({ text: "+19 °C" } as never, kind)).toEqual([]);
    }
  });

  it("rejects a temperature outside the plausible range", () => {
    expect(extractValues("на градуснике 300 °C", "temperature")).toEqual([]);
  });
});
