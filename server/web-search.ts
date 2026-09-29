import { createHash } from "node:crypto";
import type { SearchResultState, WebEvidence, WebSource } from "./providers";
import { getWebSearchStatus as getSavedWebSearchStatus, recordSearchOutage, recordSearchQuality, type SearchOutageInput, upsertWebSearchStatus } from "./db";
import { buildValueTargetedQuery, extractValues, liveValueEntity, liveValueKinds, validateValue, valueSummaryLine, type LiveValueKind, type SearchTaskKind, type ValueStatus } from "./web-search-value";

export type SearchCascadeUsed = "you" | "serper" | "exa" | "tavily";
type SearchLayer = SearchCascadeUsed;
type LayerState = "ready" | "limited" | "unavailable" | "unknown";
export type SearchLayerStatus = { id: SearchLayer; state: LayerState; checkedAt: string; retryAt: string | null };
export type WebSearchStatus = {
  available: boolean;
  reason: string;
  checkedAt: string;
  youHttp: number | null;
  serperHttp: number | null;
  exaHttp: number | null;
  /** Kept as null-only compatibility field while consumers move to provider-neutral layers. */
  googleHttp: number | null;
  tavilyHttp: number | null;
  openrouterHttp: number | null;
  layers: SearchLayerStatus[];
};
/**
 * A live-value ask that reached sources: whether a source provably carries the value the user
 * asked for. `confirmed` is never inferred from a source merely existing — only the value layer
 * in `web-search-value.ts` can set it.
 */
export type LiveValueReport = { valueStatus: ValueStatus; liveValueKind: LiveValueKind };
export type SearchResult = {
  summary: string;
  sources: WebSource[];
  evidence: WebEvidence[];
  cascadeUsed: SearchCascadeUsed;
  state: "found";
  verificationStatus: "verified";
  liveValue?: LiveValueReport;
};
export type SearchOutcome = {
  summary: string;
  sources: WebSource[];
  evidence: WebEvidence[];
  cascadeUsed: SearchCascadeUsed | null;
  state: Exclude<SearchResultState, "found">;
  verificationStatus: "no_results" | "degraded" | "unavailable";
  liveValue?: LiveValueReport;
};
export type SearchWebOptions = {
  timeoutMs?: number;
  /** Current-data requests require a provider-supplied publication date before they may be called verified. */
  requireDatedSources?: boolean;
  /** Optional lower bound for publication dates; non-qualifying sources are never passed to the model or UI. */
  publishedAfter?: string;
  /** Runs immediately before each configured, non-cooling layer makes a real network request. */
  beforeAttempt?: (layer: SearchCascadeUsed) => Promise<void | ((outcome: SearchAttemptOutcome) => void | Promise<void>)>;
  /** Opt-in only after the caller establishes that the query has no user-private context. */
  publicCache?: boolean;
  /** The kind of question this search answers; only `LIVE_VALUE` enables the value gate and the second pass. */
  taskKind?: SearchTaskKind;
  /** Optional caller-built value-shaped second query; otherwise it is derived from the user request. */
  targetedQuery?: string | null;
  /** Hard ceiling of provider requests for this call, shared by both passes. */
  maxNetworkRequests?: number;
};

const YOU_ENDPOINT = "https://ydc-index.io/v1/search";
const SERPER_ENDPOINT = "https://google.serper.dev/search";
const EXA_ENDPOINT = "https://api.exa.ai/search";
const TAVILY_ENDPOINT = "https://api.tavily.com/search";
const STATUS_KEY = "google_grounding";
const QUERY_LIMIT = 8_000;
const SOURCE_LIMIT = 5;
const SNIPPET_LIMIT = 550;
const PREFERRED_GLOBAL_DOMAINS = [".gov", ".edu", ".int", ".org", "openai.com", "google.com", "microsoft.com", "who.int", "un.org", "europa.eu"];
const LAYERS: SearchLayer[] = ["you", "serper", "exa", "tavily"];
/** A second pass over the same layers is legitimate only for a live value, so the budget grows. */
const LIVE_VALUE_MAX_NETWORK_REQUESTS = 6;
/** A second pass is skipped when less than a quarter of the turn's time budget is left. */
const LIVE_VALUE_SECOND_PASS_TIME_SHARE = 0.25;
const LAYER_COOLDOWN_MS: Record<SearchLayer, number> = { you: 10 * 60_000, serper: 10 * 60_000, exa: 10 * 60_000, tavily: 10 * 60_000 };
const layerCooldowns: Partial<Record<SearchLayer, number>> = {};
export const WEB_SEARCH_PUBLIC_CACHE_TTL_MS = 90_000;
export const WEB_SEARCH_PUBLIC_CACHE_MAX_ENTRIES = 32;
type CachedPublicSearch = { expiresAt: number; outcome: SearchResult | SearchOutcome };
const publicSearchCache = new Map<string, CachedPublicSearch>();
const publicSearchInFlight = new Map<string, Promise<SearchResult | SearchOutcome>>();

/** Test seam only: isolates module-local cooldowns between deterministic mocked cases. */
export function resetWebSearchRuntimeForTests() {
  for (const layer of LAYERS) delete layerCooldowns[layer];
}

type WebGroundedRuntimeGauge = {
  startedAt: string;
  searchRequests: number;
  cacheHits: number;
  dedupJoins: number;
  networkLayerAttempts: number;
  outcomes: { found: number; empty: number; degraded: number; unavailable: number };
};
const webGroundedRuntimeGauge: WebGroundedRuntimeGauge = {
  startedAt: new Date().toISOString(),
  searchRequests: 0,
  cacheHits: 0,
  dedupJoins: 0,
  networkLayerAttempts: 0,
  outcomes: { found: 0, empty: 0, degraded: 0, unavailable: 0 },
};

function noteWebGroundedOutcome(outcome: SearchResult | SearchOutcome) {
  if (outcome.state === "found") webGroundedRuntimeGauge.outcomes.found += 1;
  else if (outcome.state === "empty") webGroundedRuntimeGauge.outcomes.empty += 1;
  else if (outcome.state === "degraded") webGroundedRuntimeGauge.outcomes.degraded += 1;
  else webGroundedRuntimeGauge.outcomes.unavailable += 1;
}

/** Aggregate process-local diagnostics only; neither inputs nor source/provider payloads are retained. */
export function getWebGroundedRuntimeGaugeSnapshot(): WebGroundedRuntimeGauge {
  return {
    ...webGroundedRuntimeGauge,
    outcomes: { ...webGroundedRuntimeGauge.outcomes },
  };
}
export function resetWebGroundedRuntimeGaugeForTests() {
  webGroundedRuntimeGauge.startedAt = new Date().toISOString();
  webGroundedRuntimeGauge.searchRequests = 0;
  webGroundedRuntimeGauge.cacheHits = 0;
  webGroundedRuntimeGauge.dedupJoins = 0;
  webGroundedRuntimeGauge.networkLayerAttempts = 0;
  webGroundedRuntimeGauge.outcomes = { found: 0, empty: 0, degraded: 0, unavailable: 0 };
}

/** Stable compatibility export: search failure stays an optional context and never throws this error to chat users. */
export class WebSearchUnavailableError extends Error { constructor(message: string) { super(message); this.name = "WebSearchUnavailableError"; } }
type SearchAttempt = {
  result: SearchResult | null;
  http: number | null;
  latencyMs: number;
  outcome: "success" | "empty" | "failed" | "timeout" | "skipped";
};
export type SearchAttemptOutcome = SearchAttempt["outcome"];
type StatusInput = Omit<WebSearchStatus, "layers">;

function noteLayerOutcome(layer: SearchLayer, http: number | null) {
  if (http === 429 || http === 503) layerCooldowns[layer] = Date.now() + LAYER_COOLDOWN_MS[layer];
  else if (http !== null && http < 400) delete layerCooldowns[layer];
}
function isCooling(layer: SearchLayer) { return (layerCooldowns[layer] ?? 0) > Date.now(); }
function layerStatus(layer: SearchLayer, http: number | null, checkedAt: string): SearchLayerStatus {
  const retry = layerCooldowns[layer];
  return { id: layer, state: retry && retry > Date.now() ? "limited" : http === 200 ? "ready" : http === null ? "unknown" : "unavailable", checkedAt, retryAt: retry && retry > Date.now() ? new Date(retry).toISOString() : null };
}
function expandStatus(input: StatusInput): WebSearchStatus {
  noteLayerOutcome("you", input.youHttp);
  noteLayerOutcome("serper", input.serperHttp);
  noteLayerOutcome("exa", input.exaHttp);
  noteLayerOutcome("tavily", input.tavilyHttp);
  return { ...input, layers: LAYERS.map((layer) => layerStatus(layer, input[`${layer}Http` as "youHttp" | "serperHttp" | "exaHttp" | "tavilyHttp"], input.checkedAt)) };
}
let lastStatus = expandStatus({ available: false, reason: "Проверка web-поиска ещё не выполнялась.", checkedAt: new Date().toISOString(), youHttp: null, serperHttp: null, exaHttp: null, googleHttp: null, tavilyHttp: null, openrouterHttp: null });

function statusFromHttp(http: number) {
  if (http === 429 || http === 503) return "Поиск временно ограничен: основной слой ожидает сброса квоты.";
  if (http === 401 || http === 403) return "Поиск временно недоступен: серверная авторизация основного слоя отклонена.";
  if (http === 404) return "Поиск временно недоступен: требуется обновление server-side конфигурации.";
  return "Поиск временно недоступен: основной слой не ответил.";
}
function normaliseSourceDate(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && timestamp <= Date.now() + 24 * 60 * 60_000 ? new Date(timestamp).toISOString() : null;
}
function webSource(title: unknown, url: unknown, retrievedAt = new Date().toISOString(), publishedAt?: unknown): WebSource | null {
  if (typeof url !== "string" || !/^https?:\/\//i.test(url)) return null;
  let domain: string | undefined;
  try { domain = new URL(url).hostname.replace(/^www\./i, ""); } catch { /* URL already validated */ }
  const sourceId = createHash("sha256").update(url).digest("hex").slice(0, 16);
  const sourceDate = normaliseSourceDate(publishedAt);
  return { title: typeof title === "string" && title.trim() ? title.trim().slice(0, 240) : domain ?? url, url, sourceId, retrievedAt, ...(sourceDate ? { publishedAt: sourceDate } : {}), ...(domain ? { domain } : {}) };
}
function sourcePriority(source: WebSource) { const domain = source.domain?.toLowerCase() ?? ""; return PREFERRED_GLOBAL_DOMAINS.some((preferred) => domain === preferred || domain.endsWith(preferred)) ? 0 : 1; }

/**
 * Words that carry no discriminating power between candidate sources: they appear
 * in almost every research request ("Какой сейчас курс доллара?") and would
 * otherwise give the same score to unrelated results.
 */
const QUERY_TERM_STOPLIST = new Set([
  "какая", "какой", "какие", "какое", "который", "которая", "которые", "которое", "сколько", "почему", "зачем", "что", "как", "где", "когда", "если",
  "сейчас", "сегодня", "вчера", "завтра", "теперь", "текущий", "текущая", "текущие", "последний", "последняя", "последние", "последнюю", "новый", "новая", "новые",
  "новость", "новости", "свежий", "свежая", "свежие", "актуальный", "актуальная", "актуальные", "для", "про", "это", "этот", "можно", "нужно", "найти", "проверь",
  "the", "and", "for", "with", "about", "what", "which", "current", "today", "now", "latest", "news", "live", "find", "search", "please",
]);
/** Shorter words match too much of an unrelated page to be evidence of relevance. */
const QUERY_TERM_MIN_LENGTH = 4;
/** Splits on anything that is not a letter or digit, without a Unicode property escape. */
const TERM_SPLIT_PATTERN = /[^0-9a-z\u00c0-\u024f\u0370-\u04ff]+/i;
function termTokens(value: string): string[] { return value.toLowerCase().split(TERM_SPLIT_PATTERN).filter(Boolean); }
/**
 * Meaningful query terms, reduced to a fixed-length prefix.
 *
 * The prefix is the whole of the "morphology": one deterministic truncation
 * matches every inflected form of the same word ("одессе" / "одессы" / "одесса",
 * "доллара" / "доллар") without a stemmer, an embedding or a language model.
 */
function queryTermStems(query: string): string[] {
  const stems = new Set<string>();
  for (const token of termTokens(query).map((part) => part.slice(0, 40))) {
    if (token.length < QUERY_TERM_MIN_LENGTH || QUERY_TERM_STOPLIST.has(token)) continue;
    stems.add(token.length > QUERY_TERM_MIN_LENGTH ? token.slice(0, token.length - 2) : token);
  }
  return Array.from(stems);
}
/** How many meaningful query terms the source carries in its title, url, domain or retrieved text. */
function sourceRelevanceScore(source: WebSource, text: unknown, stems: string[]): number {
  if (!stems.length) return 0;
  const tokens = termTokens(`${source.title} ${source.url} ${source.domain ?? ""} ${typeof text === "string" ? text : ""}`);
  return stems.filter((stem) => tokens.some((token) => token.startsWith(stem))).length;
}
/**
 * Deduplication, ranking and the existing source limit.
 *
 * `sourcePriority` stays the primary key, so a preferred domain can never be
 * displaced by a busier page. Relevance is the second key and the provider's own
 * result order is the deterministic tie-breaker. `title.localeCompare` used to be
 * that tie-breaker, which carried no relevance at all and had a systematic bias:
 * Latin titles sort before Cyrillic ones, so a Russian query whose provider pool
 * exceeded SOURCE_LIMIT (You.com returns news next to web results) lost exactly
 * its own relevant sources and kept unrelated news.
 */
function uniqueSources(entries: Array<{ source: WebSource; text?: unknown }>, query = ""): WebSource[] {
  const stems = queryTermStems(query);
  const seen = new Set<string>();
  const ranked = entries.flatMap((entry, index) => {
    const source = entry?.source;
    if (!source || seen.has(source.url)) return [];
    seen.add(source.url);
    return [{ source, index, score: sourceRelevanceScore(source, entry.text, stems) }];
  });
  return ranked
    .sort((a, b) => sourcePriority(a.source) - sourcePriority(b.source) || b.score - a.score || a.index - b.index)
    .slice(0, SOURCE_LIMIT)
    .map((item) => item.source);
}
/**
 * The provider query is the normalized user request and nothing else.
 *
 * This used to wrap the request in a server-side instruction ("Find current,
 * authoritative global information… Original user request: …"). A search index
 * matches those instruction words instead of the entity the user asked about, so
 * a live probe of the same provider returned 0/5 location-relevant results for
 * "Какая сейчас погода в Одессе?" through the wrapped query against 5/5 for the
 * bare request. Freshness guidance still reaches the model through the system
 * prompt, which is the only place it belongs, so no instruction is added here.
 *
 * Deterministic normalization only; input remains server-side and is never stored
 * or logged, and no user wording is ever removed.
 */
export function buildGlobalDiscoveryQuery(query: string) {
  return query
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, QUERY_LIMIT);
}
function evidenceFromEntries(entries: Array<{ source: WebSource; text: string }>, selected: WebSource[]): WebEvidence[] {
  return selected.flatMap((source) => {
    const entry = entries.find((candidate) => candidate.source.url === source.url);
    if (!entry) return [];
    return [{
      fact: (entry.text || source.title).slice(0, SNIPPET_LIMIT),
      sourceUrl: source.url,
      sourceTitle: source.title,
      sourceDomain: source.domain ?? null,
      ...(source.publishedAt ? { publishedAt: source.publishedAt } : {}),
      retrievedAt: source.retrievedAt ?? new Date().toISOString(),
      confidence: sourcePriority(source) === 0 ? "high" as const : "medium" as const,
      sourceId: source.sourceId ?? createHash("sha256").update(source.url).digest("hex").slice(0, 16),
    }];
  });
}
function sourceSummary(evidence: WebEvidence[]) {
  return evidence.map((entry) => `Подтверждённый фрагмент [${entry.sourceId}]\nИсточник: ${entry.sourceTitle}\nURL: ${entry.sourceUrl}\nПолучен: ${entry.retrievedAt}\nФакт: ${entry.fact}`).join("\n\n");
}
/**
 * You.com is the only layer whose date field is an offset-less timestamp, and
 * `page_age` is the only date its real response carries: there is no
 * `publishedAt` and no `date`. A date-time without an offset is parsed as
 * local time, which would shift the value by the server offset, so the offset
 * is pinned to UTC here — in this adapter only, leaving `normaliseSourceDate`
 * and every other layer untouched.
 */
function youPageAgeAsUtc(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return /(?:Z|[+-]\d{2}:?\d{2})$/i.test(trimmed) ? trimmed : `${trimmed}Z`;
}

/**
 * You.com carries the page body in `snippets`; `description` is only the page's
 * meta summary, which for a live-value page (a weather widget, a rate ticker)
 * names the topic without ever carrying the current value. Reading `description`
 * alone therefore produced verified evidence containing no value at all.
 *
 * Only strings are ever collected, so an unexpected shape degrades to "no extra
 * text" instead of leaking "[object Object]" into evidence, and the result is
 * normalised and bounded by the same SNIPPET_LIMIT the evidence stage already
 * enforces.
 */
const YOU_SNIPPET_TEXT_KEYS = ["text", "snippet", "content", "value", "passage"];
function youSnippetText(value: unknown): string {
  const fromEntry = (entry: unknown): string => {
    if (typeof entry === "string") return entry;
    if (!entry || typeof entry !== "object") return "";
    const record = entry as Record<string, unknown>;
    return YOU_SNIPPET_TEXT_KEYS.map((key) => record[key]).filter((part): part is string => typeof part === "string").join(" ");
  };
  if (Array.isArray(value)) return value.flatMap(fromEntry).join(" ");
  return fromEntry(value);
}

function youResult(payload: unknown, query = ""): Omit<SearchResult, "cascadeUsed" | "state" | "verificationStatus"> | null {
  const results = (payload as { results?: { web?: Array<{ title?: unknown; url?: unknown; description?: unknown; date?: unknown; publishedAt?: unknown; page_age?: unknown; snippets?: unknown }>; news?: Array<{ title?: unknown; url?: unknown; description?: unknown; date?: unknown; publishedAt?: unknown; page_age?: unknown; snippets?: unknown }> } })?.results;
  const entries = [...(results?.web ?? []), ...(results?.news ?? [])].flatMap((item) => {
    const source = webSource(item.title, item.url, undefined, item.publishedAt ?? item.date ?? youPageAgeAsUtc(item.page_age));
    // The description stays first so a result without snippets keeps its exact previous text.
    const parts = [typeof item.description === "string" ? item.description : "", youSnippetText(item.snippets)].filter((part) => part.trim());
    return source ? [{ source, text: parts.join(" ").replace(/\s+/g, " ").trim().slice(0, SNIPPET_LIMIT) }] : [];
  });
  const sources = uniqueSources(entries, query);
  const evidence = evidenceFromEntries(entries, sources);
  return sources.length ? { summary: sourceSummary(evidence), sources, evidence } : null;
}
function serperResult(payload: unknown, query = ""): Omit<SearchResult, "cascadeUsed" | "state" | "verificationStatus"> | null {
  const entries = ((payload as { organic?: Array<{ title?: unknown; link?: unknown; snippet?: unknown; date?: unknown; publishedAt?: unknown }> })?.organic ?? []).flatMap((item) => {
    const source = webSource(item.title, item.link, undefined, item.publishedAt ?? item.date);
    return source ? [{ source, text: typeof item.snippet === "string" ? item.snippet.replace(/\s+/g, " ").trim().slice(0, SNIPPET_LIMIT) : "" }] : [];
  });
  const sources = uniqueSources(entries, query);
  const evidence = evidenceFromEntries(entries, sources);
  return sources.length ? { summary: sourceSummary(evidence), sources, evidence } : null;
}
function exaResult(payload: unknown, query = ""): Omit<SearchResult, "cascadeUsed" | "state" | "verificationStatus"> | null {
  const entries = ((payload as { results?: Array<{ title?: unknown; url?: unknown; text?: unknown; highlights?: unknown; publishedDate?: unknown; publishedAt?: unknown }> })?.results ?? []).flatMap((item) => {
    const source = webSource(item.title, item.url, undefined, item.publishedAt ?? item.publishedDate);
    const highlight = Array.isArray(item.highlights) ? item.highlights.find((value): value is string => typeof value === "string") : null;
    const text = highlight ?? (typeof item.text === "string" ? item.text : "");
    return source ? [{ source, text: text.replace(/\s+/g, " ").trim().slice(0, SNIPPET_LIMIT) }] : [];
  });
  const sources = uniqueSources(entries, query);
  const evidence = evidenceFromEntries(entries, sources);
  return sources.length ? { summary: sourceSummary(evidence), sources, evidence } : null;
}
function tavilyResult(payload: unknown, query = ""): Omit<SearchResult, "cascadeUsed" | "state" | "verificationStatus"> | null {
  const entries = ((payload as { results?: Array<{ title?: unknown; url?: unknown; content?: unknown; published_date?: unknown; publishedAt?: unknown }> })?.results ?? []).flatMap((item) => {
    const source = webSource(item.title, item.url, undefined, item.publishedAt ?? item.published_date);
    return source ? [{ source, text: typeof item.content === "string" ? item.content.replace(/\s+/g, " ").trim().slice(0, SNIPPET_LIMIT) : "" }] : [];
  });
  const sources = uniqueSources(entries, query);
  const evidence = evidenceFromEntries(entries, sources);
  return sources.length ? { summary: sourceSummary(evidence), sources, evidence } : null;
}
function skippedAttempt(): SearchAttempt { return { result: null, http: null, latencyMs: 0, outcome: "skipped" }; }
function hasLayerCredentials(layer: SearchLayer) {
  return Boolean((layer === "you" ? process.env.YOU_API_KEY : layer === "serper" ? process.env.SERPER_API_KEY : layer === "exa" ? process.env.EXA_API_KEY : process.env.TAVILY_API_KEY)?.trim());
}
async function requestSearch(layer: SearchLayer, query: string, signal: AbortSignal): Promise<SearchAttempt> {
  const startedAt = Date.now();
  const apiKey = (layer === "you" ? process.env.YOU_API_KEY : layer === "serper" ? process.env.SERPER_API_KEY : layer === "exa" ? process.env.EXA_API_KEY : process.env.TAVILY_API_KEY)?.trim() ?? "";
  if (!apiKey) return skippedAttempt();
  try {
    const request: { url: string; headers: Record<string, string>; body: object; parse: (payload: unknown, query: string) => Omit<SearchResult, "cascadeUsed" | "state" | "verificationStatus"> | null } = layer === "you"
      ? { url: YOU_ENDPOINT, headers: { "Content-Type": "application/json", "X-API-Key": apiKey }, body: { query, count: SOURCE_LIMIT, safesearch: "moderate" }, parse: youResult }
      : layer === "serper"
        ? { url: SERPER_ENDPOINT, headers: { "Content-Type": "application/json", "X-API-KEY": apiKey }, body: { q: query, num: SOURCE_LIMIT }, parse: serperResult }
        : layer === "exa"
          ? { url: EXA_ENDPOINT, headers: { "Content-Type": "application/json", "x-api-key": apiKey }, body: { query, numResults: SOURCE_LIMIT, contents: { text: { maxCharacters: 2_000 } } }, parse: exaResult }
          : { url: TAVILY_ENDPOINT, headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` }, body: { query, max_results: SOURCE_LIMIT, search_depth: "basic" }, parse: tavilyResult };
    const response = await fetch(request.url, { method: "POST", headers: request.headers, body: JSON.stringify(request.body), signal });
    const parsed = request.parse(await response.json().catch(() => null), query);
    if (response.ok && parsed) return { http: response.status, latencyMs: Date.now() - startedAt, result: { ...parsed, cascadeUsed: layer, state: "found", verificationStatus: "verified" }, outcome: "success" };
    return { http: response.status, latencyMs: Date.now() - startedAt, result: null, outcome: response.ok ? "empty" : "failed" };
  } catch {
    return { result: null, http: null, latencyMs: Date.now() - startedAt, outcome: signal.aborted ? "timeout" : "failed" };
  }
}
async function saveStatus(input: StatusInput) {
  const status = expandStatus(input);
  lastStatus = status;
  await upsertWebSearchStatus({ key: STATUS_KEY, state: status.available ? "ready" : "unavailable", reason: status.reason, youHttp: status.youHttp, serperHttp: status.serperHttp, exaHttp: status.exaHttp, googleHttp: status.googleHttp, tavilyHttp: status.tavilyHttp, openrouterHttp: status.openrouterHttp, checkedAt: new Date(status.checkedAt) });
  return status;
}
export async function getWebSearchStatus(): Promise<WebSearchStatus> {
  const stored = await getSavedWebSearchStatus();
  return stored ? expandStatus({ available: stored.state === "ready", reason: stored.reason, checkedAt: stored.checkedAt.toISOString(), youHttp: stored.youHttp ?? null, serperHttp: stored.serperHttp ?? null, exaHttp: stored.exaHttp ?? null, googleHttp: stored.googleHttp ?? null, tavilyHttp: stored.tavilyHttp ?? null, openrouterHttp: stored.openrouterHttp ?? null }) : lastStatus;
}
function sourceDateRange(sources: WebSource[]) {
  const dates = sources.map((source) => source.publishedAt).filter((value): value is string => typeof value === "string").sort();
  return { sourceDateMin: dates[0] ?? null, sourceDateMax: dates.at(-1) ?? null };
}
function requiredPublishedAfter(options: SearchWebOptions) {
  if (!options.publishedAfter) return null;
  const timestamp = Date.parse(options.publishedAfter);
  return Number.isFinite(timestamp) ? timestamp : null;
}
function publicCacheKey(preparedQuery: string, options: SearchWebOptions) {
  // The task kind is part of the key: the same words answered as a live value carry a value
  // verdict, and an unproven verdict must never be served to a caller that demands proof.
  return createHash("sha256").update(JSON.stringify({ query: preparedQuery, requireDatedSources: Boolean(options.requireDatedSources), publishedAfter: options.publishedAfter ?? null, taskKind: options.taskKind ?? "GENERAL" })).digest("hex");
}
function clonePublicOutcome(outcome: SearchResult | SearchOutcome) { return structuredClone(outcome); }
function readPublicSearchCache(key: string) {
  const cached = publicSearchCache.get(key);
  if (!cached) return null;
  if (cached.expiresAt <= Date.now()) { publicSearchCache.delete(key); return null; }
  return clonePublicOutcome(cached.outcome);
}
function writePublicSearchCache(key: string, outcome: SearchResult | SearchOutcome) {
  // Caching temporary faults would mask recovery and provide no grounding value.
  if (outcome.state !== "found" && outcome.state !== "empty") return;
  // An unproven live value is a per-request verdict, not a fact about the query: the same
  // words a minute later may carry the value, so only a confirmed result is shareable.
  if (outcome.liveValue && outcome.liveValue.valueStatus !== "confirmed") return;
  while (publicSearchCache.size >= WEB_SEARCH_PUBLIC_CACHE_MAX_ENTRIES) {
    const oldest = publicSearchCache.keys().next().value;
    if (!oldest) break;
    publicSearchCache.delete(oldest);
  }
  publicSearchCache.set(key, { expiresAt: Date.now() + WEB_SEARCH_PUBLIC_CACHE_TTL_MS, outcome: clonePublicOutcome(outcome) });
}
/** Test-only lifecycle hooks. Production responses never expose cache records, keys or source bodies. */
export function resetPublicSearchCacheForTests() { publicSearchCache.clear(); publicSearchInFlight.clear(); }
export function publicSearchCacheStatsForTests() { return { entries: publicSearchCache.size, inFlight: publicSearchInFlight.size }; }
function qualifyingFreshResult(result: SearchResult, options: SearchWebOptions): SearchResult | null {
  if (!options.requireDatedSources) return result;
  const minimum = requiredPublishedAfter(options);
  const sources = result.sources.filter((source) => {
    if (!source.publishedAt) return false;
    const timestamp = Date.parse(source.publishedAt);
    return Number.isFinite(timestamp) && (minimum === null || timestamp >= minimum);
  });
  if (!sources.length) return null;
  const sourceUrls = new Set(sources.map((source) => source.url));
  const evidence = result.evidence.filter((entry) => sourceUrls.has(entry.sourceUrl));
  return { ...result, sources, evidence, summary: sourceSummary(evidence) };
}
/**
 * The value verdict for a live-value result.
 *
 * Every source is judged on its own snippet; the first one that proves the value wins and
 * becomes the machine-checked line. When no source proves it, the sources and evidence are
 * still delivered — the pages are real — but the value claim is withheld, and that is what
 * the model and the user are told.
 */
function withLiveValueReport(result: SearchResult, context: { kinds: readonly LiveValueKind[]; entity: string | null; now: Date }): SearchResult {
  let confirmedKind: LiveValueKind | null = null;
  let line: string | null = null;
  const evidence = result.evidence.map((entry) => {
    const text = entry.fact;
    const values = context.kinds.flatMap((kind) => extractValues(text, kind));
    const validation = validateValue({ values, kinds: context.kinds, text, entity: context.entity, now: context.now, sourceDate: entry.publishedAt ?? null, context: `${entry.sourceTitle} ${entry.sourceUrl}` });
    if (validation.status === "confirmed" && !confirmedKind) {
      confirmedKind = values.find((value) => validation.values.includes(value))?.kind ?? context.kinds[0] ?? "conditions";
      line = valueSummaryLine(validation, entry.sourceDomain ?? entry.sourceTitle);
    }
    return { ...entry, valueStatus: validation.status } as WebEvidence;
  });
  const valueStatus: ValueStatus = line ? "confirmed" : "unconfirmed";
  return {
    ...result,
    evidence,
    summary: line ? `${line}\n\n${result.summary}` : `${valueSummaryLine({ status: "unconfirmed", reason: "missing_kind", asOf: null, values: [] }, null)}\n\n${result.summary}`,
    liveValue: { valueStatus, liveValueKind: confirmedKind ?? context.kinds[0] ?? "conditions" },
  };
}

/** Requests and time are budgeted for the whole call, so a second pass cannot double the wait. */
type CascadeBudget = { remaining: number; deadlineAt: number; pass: 1 | 2 };
/** The live-value verdict is taken against one fixed "now" so both passes agree on what is current. */
type LiveValueContext = { kinds: readonly LiveValueKind[]; entity: string | null; now: Date };
type CascadeRun = { budget?: CascadeBudget; liveValue?: LiveValueContext };

function safeCascadeTelemetry(http: Record<SearchLayer, number | null>, selected: SearchCascadeUsed | null, sources: WebSource[] = []) { console.info("[Kairema search]", JSON.stringify({ event: "search.cascade", youHttp: http.you, serperHttp: http.serper, exaHttp: http.exa, tavilyHttp: http.tavily, selected, sourcesCount: sources.length, ...sourceDateRange(sources) })); }
function outageClass(http: number | null): SearchOutageInput["errorClass"] { if (http === 429) return "rate_limited"; if (http === 401 || http === 403) return "auth"; if (http === 404) return "not_found"; if (http === null) return "network_error"; if (http >= 400) return "http_error"; return "no_sources"; }
async function runCascade(query: string, options: SearchWebOptions, recordOutages: boolean, run?: CascadeRun): Promise<SearchResult | SearchOutcome> {
  const budget = run?.budget;
  const liveContext = run?.liveValue;
  const startedAt = Date.now();
  const checkedAt = new Date().toISOString();
  const previous = await getWebSearchStatus();
  const timeBudgetMs = budget ? budget.deadlineAt - Date.now() : options.timeoutMs ?? 25_000;
  const signal = AbortSignal.timeout(Math.max(100, Math.min(timeBudgetMs, 25_000)));
  const http: Record<SearchLayer, number | null> = { you: null, serper: null, exa: null, tavily: null };
  const outcomes: Array<SearchAttempt["outcome"] | "undated" | "stale"> = [];
  for (const layer of LAYERS) {
    if (signal.aborted || isCooling(layer) || !hasLayerCredentials(layer)) continue;
    if (budget && budget.remaining <= 0) break;
    const settleAttempt = await options.beforeAttempt?.(layer);
    let attempt: SearchAttempt = { result: null, http: null, latencyMs: 0, outcome: "failed" };
    try {
      webGroundedRuntimeGauge.networkLayerAttempts += 1;
      attempt = await requestSearch(layer, query, signal);
    } catch {
      attempt = { result: null, http: null, latencyMs: 0, outcome: signal.aborted ? "timeout" : "failed" };
    } finally {
      // Controller settlement never changes a search outcome or causes a second provider request.
      await Promise.resolve(settleAttempt?.(attempt.outcome)).catch(() => undefined);
      if (budget && attempt.outcome !== "skipped") budget.remaining -= 1;
    }
    http[layer] = attempt.http;
    const qualifiedResult = attempt.result ? qualifyingFreshResult(attempt.result, options) : null;
    const verifiedResult = qualifiedResult && liveContext ? withLiveValueReport(qualifiedResult, liveContext) : qualifiedResult;
    const hasAnyDatedSource = Boolean(attempt.result?.sources.some((source) => Boolean(source.publishedAt)));
    outcomes.push(attempt.result && options.requireDatedSources && !verifiedResult ? hasAnyDatedSource ? "stale" : "undated" : attempt.outcome);
    if (verifiedResult) {
      safeCascadeTelemetry(http, layer, verifiedResult.sources);
      await saveStatus({ available: true, reason: layer === "you" ? "Поиск доступен." : "Поиск доступен через резервный слой.", checkedAt, youHttp: http.you ?? previous.youHttp, serperHttp: http.serper ?? previous.serperHttp, exaHttp: http.exa ?? previous.exaHttp, googleHttp: previous.googleHttp, tavilyHttp: http.tavily ?? previous.tavilyHttp, openrouterHttp: previous.openrouterHttp });
      if (recordOutages) void recordSearchQuality({ outcome: "found", verification: "verified", verifiedSourceCount: verifiedResult.evidence.length, attemptedLayerCount: outcomes.filter((outcome) => outcome !== "skipped").length, staleBlocked: false, latencyMs: Date.now() - startedAt, taskKind: options.taskKind ?? "GENERAL", valueConfirmed: verifiedResult.liveValue?.valueStatus === "confirmed", targetedPass: budget?.pass === 2 }).catch(() => undefined);
      return verifiedResult;
    }
    if (recordOutages) void recordSearchOutage({ layer, errorClass: outageClass(attempt.http), latencyMs: attempt.latencyMs, fellBack: layer !== "tavily" && !signal.aborted });
  }
  safeCascadeTelemetry(http, null);
  const primaryHttp = http.you;
  const undatedFreshnessFailure = Boolean(options.requireDatedSources && outcomes.includes("undated"));
  const staleFreshnessFailure = Boolean(options.requireDatedSources && outcomes.includes("stale"));
  const reason = staleFreshnessFailure ? "Живой поиск не подтвердил свежесть: слои вернули только устаревшие относительно запроса источники." : undatedFreshnessFailure ? "Живой поиск не подтвердил свежесть: слои не вернули источники с проверяемой датой публикации." : signal.aborted && options.timeoutMs ? "Поиск временно недоступен: превышен ограниченный бюджет свежих источников." : isCooling("you") ? "Поиск временно ограничен: основной слой ожидает сброса квоты." : primaryHttp ? `${statusFromHttp(primaryHttp)} Резервные слои не вернули проверяемые источники.` : "Поиск временно недоступен: ни один слой не вернул проверяемые источники.";
  await saveStatus({ available: false, reason, checkedAt, youHttp: http.you ?? previous.youHttp, serperHttp: http.serper ?? previous.serperHttp, exaHttp: http.exa ?? previous.exaHttp, googleHttp: previous.googleHttp, tavilyHttp: http.tavily ?? previous.tavilyHttp, openrouterHttp: previous.openrouterHttp });
  const attempted = outcomes.filter((outcome) => outcome !== "skipped");
  const hasEmpty = attempted.includes("empty");
  const hasTemporaryFault = attempted.includes("timeout") || attempted.some((outcome) => outcome === "failed" && http.you === null);
  let state: SearchOutcome["state"] = "error";
  if (hasEmpty && attempted.every((outcome) => outcome === "empty")) {
    state = "empty";
  } else if (undatedFreshnessFailure || staleFreshnessFailure || hasEmpty || hasTemporaryFault) {
    state = "degraded";
  }
  if (recordOutages) void recordSearchQuality({ outcome: state, verification: state === "empty" ? "no_results" : state === "degraded" ? "degraded" : "unavailable", verifiedSourceCount: 0, attemptedLayerCount: attempted.length, staleBlocked: signal.aborted || undatedFreshnessFailure || staleFreshnessFailure, latencyMs: Date.now() - startedAt, taskKind: options.taskKind ?? "GENERAL", valueConfirmed: false, targetedPass: budget?.pass === 2 }).catch(() => undefined);
  return {
    summary: "",
    sources: [],
    evidence: [],
    cascadeUsed: null,
    state,
    verificationStatus: state === "empty" ? "no_results" : state === "degraded" ? "degraded" : "unavailable",
  };
}
/**
 * The live-value turn: the user's own question first, then one narrower value-shaped pass.
 *
 * The second pass exists because "verified" used to mean "a page came back", which is why a
 * weather question could be answered with pages that carried no temperature at all. Pass 1
 * stays byte-identical to every other search; pass 2 runs only when the value is still
 * unproven, only with a different query, only inside the shared request and time budget, and
 * its result never replaces a pass-1 result that already proved the value.
 */
async function runLiveValueSearch(preparedQuery: string, options: SearchWebOptions, recordOutages: boolean): Promise<SearchResult | SearchOutcome> {
  const now = new Date();
  const kinds = liveValueKinds(preparedQuery);
  const entity = liveValueEntity(preparedQuery);
  const liveValue: LiveValueContext = { kinds, entity, now };
  const timeoutMs = Math.max(100, Math.min(options.timeoutMs ?? 25_000, 25_000));
  const budget: CascadeBudget = { remaining: options.maxNetworkRequests ?? LIVE_VALUE_MAX_NETWORK_REQUESTS, deadlineAt: Date.now() + timeoutMs, pass: 1 };
  const first = await runCascade(preparedQuery, options, recordOutages, { budget, liveValue });
  if (first.state === "found" && first.liveValue?.valueStatus === "confirmed") return first;
  // No sources at all: the caller needs no value verdict, only the honest empty outcome.
  if (first.state !== "found") return first;
  const targeted = options.targetedQuery ?? buildValueTargetedQuery(preparedQuery, kinds, entity);
  if (!targeted || targeted === preparedQuery || budget.remaining <= 0) return first;
  if (budget.deadlineAt - Date.now() < timeoutMs * LIVE_VALUE_SECOND_PASS_TIME_SHARE) return first;
  budget.pass = 2;
  const second = await runCascade(targeted, options, recordOutages, { budget, liveValue });
  if (second.state === "found" && second.liveValue?.valueStatus === "confirmed") return second;
  if (second.state === "found" && first.state !== "found") return second;
  return first;
}

export async function probeWebSearchStatus(): Promise<WebSearchStatus> { await runCascade("Kairema health check", { timeoutMs: 25_000 }, false); return getWebSearchStatus(); }
/** Search remains optional context: every outcome is safe for the model and never blocks model generation. */
export async function searchWeb(query: string, options: SearchWebOptions = {}): Promise<SearchResult | SearchOutcome> {
  const preparedQuery = buildGlobalDiscoveryQuery(query);
  webGroundedRuntimeGauge.searchRequests += 1;
  const run = (recordOutages: boolean) => (options.taskKind === "LIVE_VALUE" ? runLiveValueSearch(preparedQuery, options, recordOutages) : runCascade(preparedQuery, options, recordOutages));
  if (!options.publicCache) {
    const outcome = await run(true);
    noteWebGroundedOutcome(outcome);
    return outcome;
  }
  const key = publicCacheKey(preparedQuery, options);
  const cached = readPublicSearchCache(key);
  if (cached) {
    webGroundedRuntimeGauge.cacheHits += 1;
    noteWebGroundedOutcome(cached);
    return cached;
  }
  const existing = publicSearchInFlight.get(key);
  if (existing) {
    webGroundedRuntimeGauge.dedupJoins += 1;
    const outcome = await existing.then(clonePublicOutcome);
    noteWebGroundedOutcome(outcome);
    return outcome;
  }
  const pending = run(true)
    .then((outcome) => { writePublicSearchCache(key, outcome); return outcome; })
    .finally(() => { publicSearchInFlight.delete(key); });
  publicSearchInFlight.set(key, pending);
  const outcome = await pending.then(clonePublicOutcome);
  noteWebGroundedOutcome(outcome);
  return outcome;
}
