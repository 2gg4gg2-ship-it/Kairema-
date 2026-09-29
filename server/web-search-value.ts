/**
 * Deterministic live-value layer.
 *
 * A live answer ("сейчас +19 °C", "сейчас 12:40") is read out of page content, so no
 * amount of source ranking can prove it: today any undated page is accepted as a
 * verified answer (`requireDatedSources: false`) even when it carries no value at all,
 * which is how a timezone page that only says "UTC+3" answered "который сейчас час".
 *
 * This module is the gate that closes that hole. It is deliberately pure — no network,
 * no database and no `Date.now()`: the current moment is always passed in as an
 * argument, which is what makes the quality harness in `web-search-value.test.ts`
 * able to judge a recorded provider payload offline and deterministically.
 *
 * Nothing here calls a model, rewrites a query heuristically or invents a value. A
 * missed match degrades to the honest "value not confirmed" state; it can never
 * produce a wrong value.
 */

export type SearchTaskKind = "GENERAL" | "RECENT" | "LIVE_VALUE" | "NONE";
export type LiveValueKind = "temperature" | "conditions" | "clock" | "rate";
export type ValueStatus = "confirmed" | "unconfirmed";
export type ValueReason =
  | "confirmed_now_marker"
  | "confirmed_zone_label"
  | "confirmed_bound_label"
  | "confirmed_current_conditions"
  | "confirmed_recent_page"
  | "future_label"
  | "future_statement"
  | "unknown_zone_label"
  | "page_timestamp_only"
  | "other_entity"
  | "undated_page"
  | "stale_page"
  | "missing_kind"
  | "no_kind"
  | "no_value";

export type ExtractedValue = { kind: LiveValueKind; raw: string; value: string; unit?: string; label?: string; /** The label sits in the value's own clause and close to the value, so it is that value's own time. */ labelBound?: true; offsetMinutes?: number };

export type ValueValidation = { status: ValueStatus; reason: ValueReason; asOf: string | null; values: ExtractedValue[] };

/** A page whose own age is at most this old may stand in for an explicit "now" label. */
const RECENT_PAGE_WINDOW_MS = 90 * 60_000;
/** Never report a value labelled more than this far ahead of the verified local time. */
const FUTURE_LABEL_TOLERANCE_HOURS = 12;
/** The value line is one machine-checked line for the model, never a paragraph. */
const VALUE_LINE_LIMIT = 240;
const ENTITY_MAX_LENGTH = 40;
const SOURCE_LABEL_LIMIT = 60;
const TARGETED_QUERY_LIMIT = 90;
const TEMPERATURE_RANGE = { min: -90, max: 60 };

/**
 * Query patterns moved here from `chat-context.ts` so the task-kind classifier and the
 * freshness policy can never drift apart: "today" and "recent" must mean one thing in both.
 */
export const TODAY_QUERY_PATTERN = /(?:сегодня|сейчас|\bnow\b|\btoday\b)/i;
export const PUBLICATION_DATED_PATTERN = /(?:последн|релиз|новост|верси|обновлен|анонс)/i;
export const RECENT_QUERY_PATTERN = /(?:последн|новост|свеж|актуальн|текущ|обновлен|нов(?:ый|ая|ые|ое)|релиз|\bcurrent\b|\blatest\b|\brecent\b|\bnew\b|\bnews\b|\bupdate\b|\brelease\b)/i;
/** Topics whose answer is a live value read from page content, not a fact dated by its own publication. */
const LIVE_VALUE_TOPIC_PATTERN = /(?:врем[яеи]|час[аеу]?|погод|прогноз|курс|котировк)/i;
/**
 * "час" as a standalone word only. Without the leading boundary "сейчас" matches it at the
 * end of the word, which classified a pure weather question as also asking for the time.
 */
const CLOCK_TOPIC_PATTERN = /(?:^|[^0-9A-Za-zА-Яа-яЁё])(?:врем[яеи]|час[аеу]?)/i;
const WEATHER_TOPIC_PATTERN = /(?:погод|прогноз)/i;
const RATE_TOPIC_PATTERN = /(?:курс|котировк)/i;

const CURRENCY_TOKENS: ReadonlyArray<readonly [RegExp, string]> = [
  [/(?:доллар|доллара|долларов|доллары|\busd\b|\$)/i, "USD"],
  [/(?:евро|\beur\b|€)/i, "EUR"],
  [/(?:гривн|гривни|гривен|гривень|\buah\b)/i, "UAH"],
  [/(?:рубл|рубля|рублей|рубль|\brub\b|₽)/i, "RUB"],
];

/** A page that says "now" in words needs no date arithmetic to be a current observation. */
const NOW_MARKER_PATTERN = /(?:сейчас|текущ\w*|на\s+данный\s+момент|в\s+данный\s+момент|в\s+этот\s+момент|\bnow\b|\bcurrent(?:ly)?\b|\bright\s+now\b)/i;
const ZONE_PATTERN = /(?:UTC|GMT|МСК|MSK)\s*([+-])\s*(\d{1,2})(?::?(\d{2}))?/i;
const HOUR_LABEL_PATTERN = /(?<![\d:])([01]?\d|2[0-3]):([0-5]\d)(?![\d:])/g;
/** The same shape without the global flag, so a single label can be read with its groups. */
const HOUR_LABEL_FIRST_PATTERN = /(?<![\d:])([01]?\d|2[0-3]):([0-5]\d)(?![\d:])/;
/** `\b` is ASCII-only, so it never fires next to a Cyrillic letter: explicit boundaries. */
const RELATIVE_DAY_PATTERN = /(?:^|[^0-9A-Za-zА-Яа-яЁё])(сегодня|вчера|позавчера|today|yesterday)/i;
const DAY_MONTH_PATTERN = /(?:^|\s)(?:на\s+|от\s+)?(\d{1,2})[.\s](\d{1,2})(?![\d:])/;
/**
 * Times that belong to something else on the page and are therefore never an observation
 * time of a value: "Восход 06:47 Закат 18:48" is real data about the sun, not about the
 * temperature printed next to it. Treating the first `HH:MM` of a whole weather snippet as
 * the value's own time is what used to send a genuine current reading to
 * `unknown_zone_label`.
 */
const NON_OBSERVATION_TIME_PATTERN = /(?:восход\w*|закат\w*|заход\w*|лунн\w*\s+восход|sunrise|sunset|moonrise|moonset|sun\s*rise|sun\s*set)/i;
/** A page's own stamp dates the page, never the reading inside it. */
const PAGE_TIMESTAMP_PATTERN = /(?:обновлен\w*|обновлени\w*|опубликован\w*|публикац\w*|\bupdated\b|\bpublished\b|last\s+update)/i;
/**
 * A statement about a moment that is not the present one. A bare "прогноз погоды" is
 * deliberately absent: a forecast page that prints the current reading is exactly the page
 * this layer has to accept, and only an explicit future day or an aggregate rejects.
 */
const FUTURE_STATEMENT_PATTERN = /(?:завтра|послезавтра|\btomorrow\b|по\s+прогноз\w*|ожидается|к\s+вечеру|ночью\s+будет|прогноз\w*\s+на\s+(?:завтра|послезавтра)|максимальн\w*|минимальн\w*|\bmaximum\b|\bminimum\b|\bhigh\s+of\b|\blow\s+of\b)/i;
/** A sentence boundary: nothing on the other side of one is this value's own time. */
const CLAUSE_BOUNDARY_PATTERN = /[.;!?]/;
/** How far from the value a time may sit and still read as that value's own time. */
const LABEL_PROXIMITY_CHARS = 40;
/** How much text before a time decides what that time is about. */
const TIME_QUALIFIER_CHARS = 24;
const TEMPERATURE_PATTERN = /(?<![\d.,])([+-]?\d{1,2}(?:[.,]\d)?)(?![\d])\s*(?:°\s?[CС]|℃|(?<![0-9A-Za-zА-Яа-яЁё])градус(?:а|ов|ам)?(?![0-9A-Za-zА-Яа-яЁё])|(?<![0-9A-Za-zА-Яа-яЁё])[CС](?![0-9A-Za-zА-Яа-яЁё]))/gi;
const RATE_VALUE_PATTERN = /(\d{1,3}(?:[.,]\d{2,4}))/g;
const RATE_CONTEXT_PATTERN = /(?:USD|EUR|UAH|RUB|[\$€₽]|доллар|евро|гривн|рубл)/i;
const ENTITY_CAPTURE_PATTERN = /(?:\s|^)(?:в|во|у|для|на)\s+([A-Za-zА-Яа-яЁё][A-Za-zА-Яа-яЁё]{2,30}(?:[\s-][A-Za-zА-Яа-яЁё]{2,30}){0,2})/i;
const ENTITY_STOPWORDS = new Set([
  "интернете", "мире", "городе", "стране", "области", "краине", "украине", "россии", "сети", "миллионе", "миллиарде", "проценте", "процентах", "месте", "центре",
]);
/** Letters and digits of the Latin, Cyrillic and Greek ranges only, so no Unicode property escape is needed. */
const NON_ALPHANUMERIC = /[^0-9a-z\u00c0-\u024f\u0370-\u04ff]+/gi;

const CONDITION_LEXICON: ReadonlyArray<readonly [RegExp, string]> = [
  [/(?:ливень|ливневый|гроза|грозовой|молния|молни[яи])/i, "гроза"],
  [/(?:мелкий дождь|дожд[ьи]|дождит|дождливый|дождя)/i, "дождь"],
  [/(?:снегопад|снег|снежный)/i, "снег"],
  [/(?:туман|дымка|мгла)/i, "туман"],
  [/(?:ясно|ясная|ясное|солнечно|безоблачно)/i, "ясно"],
  [/(?:облачн|пасмурно|переменная облачность)/i, "облачно"],
  [/(?:ветрено|порывистый ветер|сильный ветер|ветер)/i, "ветер"],
  [/\brainy?\b|\bshowers?\b/i, "rain"],
  [/\bsnow\b|\bsnowfall\b/i, "snow"],
  [/\bstorm\b|\bthunderstorm\b/i, "storm"],
  [/\bfog\b|\bmist\b/i, "fog"],
  [/\bwindy\b/i, "wind"],
  [/\bclear\b|\bsunny\b/i, "clear"],
  [/\bcloudy\b|\bovercast\b/i, "cloudy"],
];

/** Control characters become spaces, so one query shape is seen by every classifier. */
function normalizeQuery(query: string) {
  return Array.from(typeof query === "string" ? query : "")
    .map((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code <= 0x1f || code === 0x7f ? " " : character;
    })
    .join("")
    .replace(/\s+/g, " ")
    .trim();
}

/** A single token, never an object and never empty: the model must never see "[object Object]". */
function textValue(raw: unknown, limit = 24): string {
  if (typeof raw !== "string") return "";
  return raw.replace(/\s+/g, " ").trim().slice(0, limit);
}

/**
 * The three first-class search task kinds.
 *
 * `LIVE_VALUE` is exactly the classification that used to live in `isLiveValueQuery`:
 * a current-moment ask about a clock, a forecast or a rate that is not publication-dated.
 * `RECENT` is everything bounded by publication time, including an explicit "latest" ask
 * that also says "now" ("сейчас последний релиз"). `GENERAL` is any other lookup that
 * carries no current or recency framing. No new vocabulary is introduced: every pattern is
 * the one already used by the grounding and freshness classifiers.
 */
export function classifySearchTaskKind(query: string): SearchTaskKind {
  const normalized = normalizeQuery(query);
  if (!normalized) return "NONE";
  if (TODAY_QUERY_PATTERN.test(normalized) && LIVE_VALUE_TOPIC_PATTERN.test(normalized) && !PUBLICATION_DATED_PATTERN.test(normalized)) return "LIVE_VALUE";
  if (PUBLICATION_DATED_PATTERN.test(normalized) || RECENT_QUERY_PATTERN.test(normalized) || TODAY_QUERY_PATTERN.test(normalized)) return "RECENT";
  return "GENERAL";
}

/** The live-value topics a query actually asks about; an empty list means there is nothing to extract. */
export function liveValueKinds(query: string): LiveValueKind[] {
  const normalized = normalizeQuery(query);
  const kinds: LiveValueKind[] = [];
  if (WEATHER_TOPIC_PATTERN.test(normalized)) kinds.push("temperature", "conditions");
  if (CLOCK_TOPIC_PATTERN.test(normalized)) kinds.push("clock");
  if (RATE_TOPIC_PATTERN.test(normalized)) kinds.push("rate");
  return kinds;
}

/** The place a live value is about, or `null` when the query names none. */
export function liveValueEntity(query: string): string | null {
  const captured = normalizeQuery(query).match(ENTITY_CAPTURE_PATTERN)?.[1] ?? "";
  const entity = captured.replace(/[\s-]+/g, " ").replace(/[.,!?;:]+$/, "").trim().slice(0, ENTITY_MAX_LENGTH);
  if (!entity || ENTITY_STOPWORDS.has(entity.toLowerCase())) return null;
  return entity;
}

function resolvedCurrencyPair(query: string): string | null {
  const found: string[] = [];
  for (const [pattern, code] of CURRENCY_TOKENS) {
    if (pattern.test(query) && !found.includes(code)) found.push(code);
  }
  return found.length >= 2 ? `${found[0]} ${found[1]}` : null;
}

/**
 * A value-shaped second formulation, built only for `LIVE_VALUE` and only when every part
 * of it is resolvable from the user's own words.
 *
 * The first pass always carries the untouched user request: an instruction wrapper makes a
 * search index match the instruction instead of the entity, which is what once hid every
 * location-relevant weather result. This is not a wrapper and not a paraphrase — it is a
 * different, narrower indexable question that keeps whatever the answer is about, the place
 * for weather and clock and the currency pair for a rate, and `null` is returned whenever a
 * part cannot be resolved so nothing is ever guessed.
 */
export function buildValueTargetedQuery(query: string, kinds: readonly LiveValueKind[], entity: string | null): string | null {
  if (!kinds.length) return null;
  const pair = resolvedCurrencyPair(normalizeQuery(query));
  // A weather or a clock reading is a statement about a place, so the place stays required
  // for them. A rate is not: the pair inside the user's own words already names everything a
  // narrower question needs, so "курс доллара к гривне?" earns a second pass even though no
  // place is named. The pair must still be deterministic — one currency is not a rate.
  const targeted = entity && (kinds.includes("temperature") || kinds.includes("conditions"))
    ? `current weather ${entity} temperature precipitation`
    : entity && kinds.includes("clock")
      ? `current time in ${entity}`
      : kinds.includes("rate") && pair
        ? `current exchange rate ${pair}`
        : null;
  if (!targeted) return null;
  const bounded = targeted.slice(0, TARGETED_QUERY_LIMIT).replace(/\s+/g, " ").trim();
  return bounded && bounded !== normalizeQuery(query) ? bounded : null;
}

function zoneOffsetMinutes(text: string): number | undefined {
  const match = text.match(ZONE_PATTERN);
  if (!match) return undefined;
  const hours = Number(match[2] ?? 0);
  const minutes = Number(match[3] ?? 0);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return undefined;
  const magnitude = Math.min(14, Math.abs(hours)) * 60 + Math.min(59, Math.abs(minutes));
  return (match[1] === "-" ? -1 : 1) * magnitude;
}

function hourLabel(text: string): string | null {
  const match = text.match(HOUR_LABEL_FIRST_PATTERN);
  return match?.[1] && match[2] ? `${match[1].padStart(2, "0")}:${match[2]}` : null;
}

/** "сегодня" / "на 26.09" — a day-level label, which is weaker than an hour and never proves "now". */
function dayLabel(text: string): string | null {
  const relative = text.match(RELATIVE_DAY_PATTERN);
  if (relative?.[1]) return relative[1].toLowerCase();
  const dated = text.match(DAY_MONTH_PATTERN);
  if (!dated?.[1] || !dated[2]) return null;
  return `${dated[1].padStart(2, "0")}.${dated[2].padStart(2, "0")}`;
}

function labelFor(text: string): string | null {
  return hourLabel(text) ?? dayLabel(text);
}

/** A date-time is not a clock reading: "13:00 26.09" and "2026-09-26 13:00" are excluded. */
function isDateTime(text: string, index: number): boolean {
  return /(?:^|[^0-9])20[0-9]{2}(?:$|[^0-9])/.test(text.slice(Math.max(0, index - 12), index + 18));
}

/** What a `HH:MM` in a snippet is about, decided by the words right before it. */
type TimeRole = "value" | "page" | "other";
function timeRole(text: string, index: number): TimeRole {
  const before = text.slice(Math.max(0, index - TIME_QUALIFIER_CHARS), index);
  if (NON_OBSERVATION_TIME_PATTERN.test(before)) return "other";
  if (PAGE_TIMESTAMP_PATTERN.test(before)) return "page";
  return "value";
}

/**
 * The nearest `HH:MM` that is genuinely this value's own time: close to it, in the same
 * sentence, and not a sunrise, a sunset or a page stamp. "13:00 · +19°C" binds, and so does
 * "+19°C в 13:00", while "… · Восход 06:47 Закат 18:48" binds nothing.
 */
function boundHourLabel(text: string, start: number, end: number): string | null {
  const from = Math.max(0, start - LABEL_PROXIMITY_CHARS);
  const to = Math.min(text.length, end + LABEL_PROXIMITY_CHARS);
  let best: { label: string; distance: number } | null = null;
  for (const match of Array.from(text.slice(from, to).matchAll(HOUR_LABEL_PATTERN))) {
    const index = from + (match.index ?? 0);
    if (isDateTime(text, index)) continue;
    if (timeRole(text, index) !== "value") continue;
    // Nothing on the far side of a sentence boundary is this value's time.
    const between = text.slice(Math.min(index, start), Math.max(from + (match.index ?? 0) + match[0].length, end));
    if (CLAUSE_BOUNDARY_PATTERN.test(between)) continue;
    const label = `${match[1]!.padStart(2, "0")}:${match[2]}`;
    const distance = index < start ? start - index : index >= end ? index - end + 1 : 0;
    if (!best || distance < best.distance) best = { label, distance };
  }
  return best?.label ?? null;
}

/**
 * The first `HH:MM` that claims to describe the data itself ("Данные на 13:00", "at 13:00").
 * Such a time stays a real temporal claim — it is exactly what proves a value is *not*
 * current — but it is never borrowed from an unrelated part of the page.
 */
function describedHourLabel(text: string): string | null {
  for (const match of Array.from(text.matchAll(HOUR_LABEL_PATTERN))) {
    const index = match.index ?? 0;
    if (isDateTime(text, index)) continue;
    if (timeRole(text, index) !== "value") continue;
    return `${match[1]!.padStart(2, "0")}:${match[2]}`;
  }
  return null;
}

/**
 * The temporal label of one weather value, and whether it is that value's own time.
 *
 * The ladder is bound → described → day-level, so a value next to its own hour keeps that
 * hour, a value whose hour is stated elsewhere on the page still gets that claim, and an
 * unrelated time (sunrise, sunset, page stamp) is never borrowed. Only the first step sets
 * `labelBound`, and only it may confirm without a zone.
 */
function weatherLabel(text: string, start: number, end: number, offsetMinutes: number | undefined) {
  const bound = boundHourLabel(text, start, end);
  const label = bound ?? describedHourLabel(text) ?? dayLabel(text);
  return {
    ...(label ? { label } : {}),
    ...(bound ? { labelBound: true as const } : {}),
    ...(offsetMinutes === undefined ? {} : { offsetMinutes }),
  };
}

/**
 * All values of one kind in a snippet.
 *
 * The extractors are deliberately narrow. A temperature must carry a degree unit, which is
 * what rejects widget noise such as "40 20 0 -20 -40"; a clock must be a two-part `HH:MM`
 * that is not part of a date; a rate must sit next to a currency the query itself named.
 * Every failure mode of a narrow extractor is a missing value, i.e. an honest
 * "not confirmed" — never a fabricated one.
 */
export function extractValues(text: string, kind: LiveValueKind): ExtractedValue[] {
  if (typeof text !== "string" || !text) return [];
  const label = labelFor(text);
  const offsetMinutes = zoneOffsetMinutes(text);
  const shared = { ...(label ? { label } : {}), ...(offsetMinutes === undefined ? {} : { offsetMinutes }) };
  if (kind === "temperature") {
    const values: ExtractedValue[] = [];
    for (const match of Array.from(text.matchAll(TEMPERATURE_PATTERN))) {
      const parsed = Number((match[1] ?? "").replace(",", "."));
      if (!Number.isFinite(parsed) || parsed < TEMPERATURE_RANGE.min || parsed > TEMPERATURE_RANGE.max) continue;
      const value = textValue(match[1]);
      if (!value) continue;
      values.push({ kind, raw: textValue(match[0]), value, unit: "°C", ...weatherLabel(text, match.index ?? 0, (match.index ?? 0) + match[0].length, offsetMinutes) });
    }
    return values;
  }
  if (kind === "conditions") {
    for (const [pattern, canonical] of CONDITION_LEXICON) {
      const hit = text.match(pattern);
      if (!hit) continue;
      const index = hit.index ?? 0;
      return [{ kind, raw: textValue(hit[0]), value: canonical, ...weatherLabel(text, index, index + hit[0].length, offsetMinutes) }];
    }
    return [];
  }
  if (kind === "clock") {
    const values: ExtractedValue[] = [];
    for (const match of Array.from(text.matchAll(HOUR_LABEL_PATTERN))) {
      const index = match.index ?? 0;
      // A date-time is not a clock reading: "13:00 26.09" and "2026-09-26 13:00" are excluded.
      const window = text.slice(Math.max(0, index - 12), index + match[0].length + 12);
      if (/(?:^|[^0-9])20[0-9]{2}(?:$|[^0-9])/.test(window)) continue;
      values.push({ kind, raw: textValue(match[0]), value: `${match[1]!.padStart(2, "0")}:${match[2]}`, ...shared });
    }
    return values;
  }
  const values: ExtractedValue[] = [];
  if (!RATE_CONTEXT_PATTERN.test(text)) return values;
  for (const match of Array.from(text.matchAll(RATE_VALUE_PATTERN))) {
    const value = textValue(match[1]);
    if (!value) continue;
    values.push({ kind, raw: textValue(match[0]), value, ...shared });
  }
  return values;
}

function sourceAgeMs(sourceDate: string | null | undefined, now: Date): number | null {
  if (!sourceDate) return null;
  const parsed = Date.parse(sourceDate);
  if (!Number.isFinite(parsed)) return null;
  const age = now.getTime() - parsed;
  return age < 0 ? null : age;
}

/**
 * Whether an extracted value may be reported as a current observation.
 *
 * The ladder is deliberately conservative and fails closed:
 *  1. the snippet says "now" in words — no arithmetic needed;
 *  2. the snippet names a zone and a concrete hour, and that hour is not in the future of
 *     the verified local time (this is what rejects "+19 °C, 13:00" observed at 12:34);
 *  3. the snippet carries no hour label and the page's own date proves it is fresh;
 *  4. anything else stays unconfirmed. An hour label with an unknown zone is case 4 on
 *     purpose: without a zone "13:00" cannot be shown to be in the past, so it is kept as
 *     `asOf` and reported as a value for that time, never as the value "now".
 */
function attributeValue(value: ExtractedValue, input: { text: string; now: Date; sourceDate: string | null | undefined }): ValueReason {
  if (NOW_MARKER_PATTERN.test(input.text)) return "confirmed_now_marker";
  const ageMs = sourceAgeMs(input.sourceDate, input.now);
  const zoneVerdict = (label: string): ValueReason => {
    if (value.offsetMinutes === undefined) return "unknown_zone_label";
    const labelHour = Number(label.slice(0, 2));
    const zonedNow = new Date(input.now.getTime() + value.offsetMinutes * 60_000);
    const aheadHours = labelHour - zonedNow.getUTCHours();
    if (aheadHours > 0 && aheadHours <= FUTURE_LABEL_TOLERANCE_HOURS) return "future_label";
    return "confirmed_zone_label";
  };
  /**
   * Weather is decided by the time that belongs to the value, not by the first time on the
   * page. A reading that carries its own hour in its own sentence is that reading's
   * observation time, so a sunrise, a sunset or a page stamp can neither block it nor be
   * reported as it. With no attributable time at all, a temperature with its unit, the right
   * place, no stated future day and no page timestamp is the current condition the page is
   * describing, and is reported as such — while an explicitly old page is still refused.
   */
  if (value.kind === "temperature" || value.kind === "conditions") {
    const own = value.label && value.labelBound && /^[0-9]{1,2}:[0-9]{2}$/.test(value.label) ? value.label : null;
    // A reading that carries its own hour is that reading's observation time, and a page
    // crawled yesterday still prints today's hour: the crawl date must not veto it.
    if (own) return value.offsetMinutes === undefined ? "confirmed_bound_label" : zoneVerdict(own);
    const described = describedHourLabel(input.text);
    if (described) return zoneVerdict(described);
    if (dayLabel(input.text)) return "unknown_zone_label";
    if (PAGE_TIMESTAMP_PATTERN.test(input.text)) return "page_timestamp_only";
    if (FUTURE_STATEMENT_PATTERN.test(input.text)) return "future_statement";
    if (ageMs === null) return "confirmed_current_conditions";
  }
  const label = value.label ?? labelFor(input.text);
  if (label && /^[0-9]{1,2}:[0-9]{2}$/.test(label)) return zoneVerdict(label);
  if (label) return "unknown_zone_label";
  if (ageMs === null) return "undated_page";
  return ageMs <= RECENT_PAGE_WINDOW_MS ? "confirmed_recent_page" : "stale_page";
}

/**
 * A value only counts for the entity that was asked about.
 *
 * A timezone is deliberately not accepted as a substitute: "Время в Берлине: 12:40
 * (UTC+2)" carries a perfectly well-formed reading and would still be a false answer to
 * "который сейчас час в Одессе". The entity is looked up in the snippet together with the
 * page title and URL, so a page that is plainly about the requested place still confirms
 * even when the snippet itself never repeats the name.
 *
 * The narrower pass asks its question in English, so results about "Odesa" must still match
 * "Одессе": both sides are transliterated to Latin before the comparison. This only widens
 * the match for the same place — a page about another city still carries no transliteration
 * of the requested one.
 */
const CYRILLIC_TRANSLITERATION: Record<string, string> = { а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z", и: "i", й: "y", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "h", ц: "ts", ч: "ch", ш: "sh", щ: "sch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya" };

function entityComparable(value: string) {
  return value
    .toLowerCase()
    .split("")
    .map((character) => CYRILLIC_TRANSLITERATION[character] ?? character)
    .join("")
    .replace(NON_ALPHANUMERIC, "");
}

function entityMentioned(context: string, entity: string | null): boolean {
  if (!entity) return true;
  // A four-character stem is the whole of the morphology here, exactly as in source
  // ranking: "Одесса" / "Одессе" / "Odesa" all share "odes" without a stemmer or a model.
  const stem = entityComparable(entity).slice(0, 4);
  if (stem.length < 3) return true;
  return entityComparable(context).includes(stem);
}

/**
 * The gate. A value is `confirmed` only when a required kind yielded a value that belongs to
 * the requested entity and is temporally attributable; otherwise the result keeps its
 * sources and evidence but the value claim itself stays withheld.
 */
export function validateValue(input: {
  values: ExtractedValue[];
  kinds: readonly LiveValueKind[];
  text: string;
  entity: string | null;
  now: Date;
  sourceDate?: string | null;
  /** Page title and URL, which prove what a snippet that never names the entity is about. */
  context?: string;
}): ValueValidation {
  const text = typeof input.text === "string" ? input.text : "";
  if (!input.kinds.length) return { status: "unconfirmed", reason: "no_kind", asOf: null, values: input.values };
  const context = `${typeof input.context === "string" ? input.context : ""} ${text}`;
  if (!entityMentioned(context, input.entity)) return { status: "unconfirmed", reason: "other_entity", asOf: null, values: [] };
  const relevant = input.values.filter((value) => input.kinds.includes(value.kind));
  if (!relevant.length) return { status: "unconfirmed", reason: "missing_kind", asOf: null, values: [] };
  let status: ValueStatus = "unconfirmed";
  let reason: ValueReason = "unknown_zone_label";
  let asOf: string | null = null;
  for (const value of relevant) {
    const outcome = attributeValue(value, { text, now: input.now, sourceDate: input.sourceDate });
    if (outcome.startsWith("confirmed_")) {
      return { status: "confirmed", reason: outcome, asOf: value.label ?? null, values: relevant.slice(0, 4) };
    }
    if (asOf === null) asOf = value.label ?? null;
    if (reason === "unknown_zone_label") reason = outcome;
  }
  return { status, reason, asOf, values: [] };
}

function formatValue(value: ExtractedValue): string {
  if (value.kind === "temperature") return `температура ${value.value}${value.unit ?? "°C"}`;
  if (value.kind === "conditions") return `погода: ${value.value}`;
  if (value.kind === "clock") return `время ${value.value}`;
  return `курс ${value.value}`;
}

export const LIVE_VALUE_UNCONFIRMED_LINE = "ИСКОМОЕ ЗНАЧЕНИЕ НЕ ПОДТВЕРЖДЕНО: найдены релевантные источники, но найденное значение нельзя надёжно привязать к текущему моменту.";
/**
 * The honest sentence the user hears when sources arrived but the value did not: the failure
 * is a missing value, not an unavailable search, and the two must not be conflated.
 */
export const LIVE_VALUE_UNCONFIRMED_PROMPT = "Точное текущее значение не найдено: проверенные источники есть, но ни один не подтверждает значение «сейчас», поэтому называть его я не буду.";

/**
 * The one machine-checked line the model reads first inside the verified-data block.
 *
 * It is deliberately either a value with its source and the time that value belongs to, or
 * an explicit refusal. The model is never left to decide whether a page answers the
 * question, and it is never handed a value that would have to be presented as "now"
 * without proof.
 */
export function valueSummaryLine(validation: ValueValidation, sourceLabel?: string | null): string {
  if (validation.status !== "confirmed" || !validation.values.length) return LIVE_VALUE_UNCONFIRMED_LINE;
  const values = validation.values.map(formatValue).join(", ");
  const source = textValue(sourceLabel, SOURCE_LABEL_LIMIT) || "проверенный источник";
  const asOf = validation.asOf ? `на ${textValue(validation.asOf)}` : "по времени публикации источника";
  return `ИСКОМОЕ ЗНАЧЕНИЕ: ${values} (${source}, ${asOf})`.slice(0, VALUE_LINE_LIMIT);
}
