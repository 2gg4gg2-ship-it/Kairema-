import { createHash } from "node:crypto";
import type { SearchResultState, WebEvidence, WebSource } from "./providers";
import { getWebSearchStatus as getSavedWebSearchStatus, recordSearchOutage, recordSearchQuality, type SearchOutageInput, upsertWebSearchStatus } from "./db";

export type SearchCascadeUsed = "you" | "serper" | "exa";
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
  /** Kept as null-only compatibility fields while v6-K consumers move to provider-neutral layers. */
  googleHttp: number | null;
  tavilyHttp: number | null;
  openrouterHttp: number | null;
  layers: SearchLayerStatus[];
};
export type SearchResult = {
  summary: string;
  sources: WebSource[];
  evidence: WebEvidence[];
  cascadeUsed: SearchCascadeUsed;
  state: "found";
  verificationStatus: "verified";
};
export type SearchOutcome = {
  summary: string;
  sources: WebSource[];
  evidence: WebEvidence[];
  cascadeUsed: SearchCascadeUsed | null;
  state: Exclude<SearchResultState, "found">;
  verificationStatus: "no_results" | "degraded" | "unavailable";
};
export type SearchWebOptions = {
  timeoutMs?: number;
  /** Current-data requests require a provider-supplied publication date before they may be called verified. */
  requireDatedSources?: boolean;
};

const YOU_ENDPOINT = "https://ydc-index.io/v1/search";
const SERPER_ENDPOINT = "https://google.serper.dev/search";
const EXA_ENDPOINT = "https://api.exa.ai/search";
const STATUS_KEY = "google_grounding";
const QUERY_LIMIT = 8_000;
const SOURCE_LIMIT = 5;
const SNIPPET_LIMIT = 550;
const PREFERRED_GLOBAL_DOMAINS = [".gov", ".edu", ".int", ".org", "openai.com", "google.com", "microsoft.com", "who.int", "un.org", "europa.eu"];
const LAYERS: SearchLayer[] = ["you", "serper", "exa"];
const LAYER_COOLDOWN_MS: Record<SearchLayer, number> = { you: 10 * 60_000, serper: 10 * 60_000, exa: 10 * 60_000 };
const layerCooldowns: Partial<Record<SearchLayer, number>> = {};

/** Stable compatibility export: search failure stays an optional context and never throws this error to chat users. */
export class WebSearchUnavailableError extends Error { constructor(message: string) { super(message); this.name = "WebSearchUnavailableError"; } }
type SearchAttempt = {
  result: SearchResult | null;
  http: number | null;
  latencyMs: number;
  outcome: "success" | "empty" | "failed" | "timeout" | "skipped";
};
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
  return { ...input, layers: LAYERS.map((layer) => layerStatus(layer, input[`${layer}Http` as "youHttp" | "serperHttp" | "exaHttp"], input.checkedAt)) };
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
function uniqueSources(items: Array<WebSource | null>): WebSource[] {
  const seen = new Set<string>();
  return items.flatMap((item) => !item || seen.has(item.url) ? [] : (seen.add(item.url), [item]))
    .sort((a, b) => sourcePriority(a) - sourcePriority(b) || a.title.localeCompare(b.title)).slice(0, SOURCE_LIMIT);
}
/** Deterministic rewrite only; input remains server-side and is never stored or logged. */
export function buildGlobalDiscoveryQuery(query: string) {
  const normalized = query.replace(/[\u0000-\u001F\u007F]/g, " ").replace(/\s+/g, " ").trim().slice(0, QUERY_LIMIT);
  return `Find current, authoritative global information. Prefer official primary sources and English-language source discovery when useful. Original user request: ${normalized}`;
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
function youResult(payload: unknown): Omit<SearchResult, "cascadeUsed" | "state" | "verificationStatus"> | null {
  const results = (payload as { results?: { web?: Array<{ title?: unknown; url?: unknown; description?: unknown; date?: unknown; publishedAt?: unknown }>; news?: Array<{ title?: unknown; url?: unknown; description?: unknown; date?: unknown; publishedAt?: unknown }> } })?.results;
  const entries = [...(results?.web ?? []), ...(results?.news ?? [])].flatMap((item) => {
    const source = webSource(item.title, item.url, undefined, item.publishedAt ?? item.date);
    return source ? [{ source, text: typeof item.description === "string" ? item.description.replace(/\s+/g, " ").trim().slice(0, SNIPPET_LIMIT) : "" }] : [];
  });
  const sources = uniqueSources(entries.map((entry) => entry.source));
  const evidence = evidenceFromEntries(entries, sources);
  return sources.length ? { summary: sourceSummary(evidence), sources, evidence } : null;
}
function serperResult(payload: unknown): Omit<SearchResult, "cascadeUsed" | "state" | "verificationStatus"> | null {
  const entries = ((payload as { organic?: Array<{ title?: unknown; link?: unknown; snippet?: unknown; date?: unknown; publishedAt?: unknown }> })?.organic ?? []).flatMap((item) => {
    const source = webSource(item.title, item.link, undefined, item.publishedAt ?? item.date);
    return source ? [{ source, text: typeof item.snippet === "string" ? item.snippet.replace(/\s+/g, " ").trim().slice(0, SNIPPET_LIMIT) : "" }] : [];
  });
  const sources = uniqueSources(entries.map((entry) => entry.source));
  const evidence = evidenceFromEntries(entries, sources);
  return sources.length ? { summary: sourceSummary(evidence), sources, evidence } : null;
}
function exaResult(payload: unknown): Omit<SearchResult, "cascadeUsed" | "state" | "verificationStatus"> | null {
  const entries = ((payload as { results?: Array<{ title?: unknown; url?: unknown; text?: unknown; highlights?: unknown; publishedDate?: unknown; publishedAt?: unknown }> })?.results ?? []).flatMap((item) => {
    const source = webSource(item.title, item.url, undefined, item.publishedAt ?? item.publishedDate);
    const highlight = Array.isArray(item.highlights) ? item.highlights.find((value): value is string => typeof value === "string") : null;
    const text = highlight ?? (typeof item.text === "string" ? item.text : "");
    return source ? [{ source, text: text.replace(/\s+/g, " ").trim().slice(0, SNIPPET_LIMIT) }] : [];
  });
  const sources = uniqueSources(entries.map((entry) => entry.source));
  const evidence = evidenceFromEntries(entries, sources);
  return sources.length ? { summary: sourceSummary(evidence), sources, evidence } : null;
}
function skippedAttempt(): SearchAttempt { return { result: null, http: null, latencyMs: 0, outcome: "skipped" }; }
async function requestSearch(layer: SearchLayer, query: string, signal: AbortSignal): Promise<SearchAttempt> {
  const startedAt = Date.now();
  const apiKey = (layer === "you" ? process.env.YOU_API_KEY : layer === "serper" ? process.env.SERPER_API_KEY : process.env.EXA_API_KEY)?.trim() ?? "";
  if (!apiKey) return skippedAttempt();
  try {
    const request: { url: string; headers: Record<string, string>; body: object; parse: (payload: unknown) => Omit<SearchResult, "cascadeUsed" | "state" | "verificationStatus"> | null } = layer === "you"
      ? { url: YOU_ENDPOINT, headers: { "Content-Type": "application/json", "X-API-Key": apiKey }, body: { query, count: SOURCE_LIMIT, safesearch: "moderate" }, parse: youResult }
      : layer === "serper"
        ? { url: SERPER_ENDPOINT, headers: { "Content-Type": "application/json", "X-API-KEY": apiKey }, body: { q: query, num: SOURCE_LIMIT }, parse: serperResult }
        : { url: EXA_ENDPOINT, headers: { "Content-Type": "application/json", "x-api-key": apiKey }, body: { query, numResults: SOURCE_LIMIT, contents: { text: { maxCharacters: 2_000 } } }, parse: exaResult };
    const response = await fetch(request.url, { method: "POST", headers: request.headers, body: JSON.stringify(request.body), signal });
    const parsed = request.parse(await response.json().catch(() => null));
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
function hasDatedSource(result: SearchResult) {
  return result.sources.some((source) => Boolean(source.publishedAt));
}
function safeCascadeTelemetry(http: Record<SearchLayer, number | null>, selected: SearchCascadeUsed | null, sources: WebSource[] = []) { console.info("[Kairema search]", JSON.stringify({ event: "search.cascade", youHttp: http.you, serperHttp: http.serper, exaHttp: http.exa, selected, sourcesCount: sources.length, ...sourceDateRange(sources) })); }
function outageClass(http: number | null): SearchOutageInput["errorClass"] { if (http === 429) return "rate_limited"; if (http === 401 || http === 403) return "auth"; if (http === 404) return "not_found"; if (http === null) return "network_error"; if (http >= 400) return "http_error"; return "no_sources"; }
async function runCascade(query: string, options: SearchWebOptions, recordOutages: boolean): Promise<SearchResult | SearchOutcome> {
  const startedAt = Date.now();
  const checkedAt = new Date().toISOString();
  const previous = await getWebSearchStatus();
  const signal = AbortSignal.timeout(Math.max(100, Math.min(options.timeoutMs ?? 25_000, 25_000)));
  const http: Record<SearchLayer, number | null> = { you: null, serper: null, exa: null };
  const outcomes: Array<SearchAttempt["outcome"] | "undated"> = [];
  for (const layer of LAYERS) {
    if (signal.aborted || isCooling(layer)) continue;
    const attempt = await requestSearch(layer, query, signal);
    http[layer] = attempt.http;
    const datedResultRequired = Boolean(options.requireDatedSources);
    const datedResultAvailable = Boolean(attempt.result && hasDatedSource(attempt.result));
    outcomes.push(attempt.result && datedResultRequired && !datedResultAvailable ? "undated" : attempt.outcome);
    if (attempt.result && (!datedResultRequired || datedResultAvailable)) {
      safeCascadeTelemetry(http, layer, attempt.result.sources);
      await saveStatus({ available: true, reason: layer === "you" ? "Поиск доступен." : "Поиск доступен через резервный слой.", checkedAt, youHttp: http.you ?? previous.youHttp, serperHttp: http.serper ?? previous.serperHttp, exaHttp: http.exa ?? previous.exaHttp, googleHttp: previous.googleHttp, tavilyHttp: previous.tavilyHttp, openrouterHttp: previous.openrouterHttp });
      if (recordOutages) void recordSearchQuality({ outcome: "found", verification: "verified", verifiedSourceCount: attempt.result.evidence.length, attemptedLayerCount: outcomes.filter((outcome) => outcome !== "skipped").length, staleBlocked: false, latencyMs: Date.now() - startedAt }).catch(() => undefined);
      return attempt.result;
    }
    if (recordOutages) void recordSearchOutage({ layer, errorClass: outageClass(attempt.http), latencyMs: attempt.latencyMs, fellBack: layer !== "exa" && !signal.aborted });
  }
  safeCascadeTelemetry(http, null);
  const primaryHttp = http.you;
  const undatedFreshnessFailure = Boolean(options.requireDatedSources && outcomes.includes("undated"));
  const reason = undatedFreshnessFailure ? "Живой поиск не подтвердил свежесть: слои не вернули источники с проверяемой датой публикации." : signal.aborted && options.timeoutMs ? "Поиск временно недоступен: превышен ограниченный бюджет свежих источников." : isCooling("you") ? "Поиск временно ограничен: основной слой ожидает сброса квоты." : primaryHttp ? `${statusFromHttp(primaryHttp)} Резервные слои не вернули проверяемые источники.` : "Поиск временно недоступен: ни один слой не вернул проверяемые источники.";
  await saveStatus({ available: false, reason, checkedAt, youHttp: http.you ?? previous.youHttp, serperHttp: http.serper ?? previous.serperHttp, exaHttp: http.exa ?? previous.exaHttp, googleHttp: previous.googleHttp, tavilyHttp: previous.tavilyHttp, openrouterHttp: previous.openrouterHttp });
  const attempted = outcomes.filter((outcome) => outcome !== "skipped");
  const hasEmpty = attempted.includes("empty");
  const hasTemporaryFault = attempted.includes("timeout") || attempted.some((outcome) => outcome === "failed" && http.you === null);
  let state: SearchOutcome["state"] = "error";
  if (hasEmpty && attempted.every((outcome) => outcome === "empty")) {
    state = "empty";
  } else if (undatedFreshnessFailure || hasEmpty || hasTemporaryFault) {
    state = "degraded";
  }
  if (recordOutages) void recordSearchQuality({ outcome: state, verification: state === "empty" ? "no_results" : state === "degraded" ? "degraded" : "unavailable", verifiedSourceCount: 0, attemptedLayerCount: attempted.length, staleBlocked: signal.aborted || undatedFreshnessFailure, latencyMs: Date.now() - startedAt }).catch(() => undefined);
  return {
    summary: "",
    sources: [],
    evidence: [],
    cascadeUsed: null,
    state,
    verificationStatus: state === "empty" ? "no_results" : state === "degraded" ? "degraded" : "unavailable",
  };
}
export async function probeWebSearchStatus(): Promise<WebSearchStatus> { await runCascade("Kairema health check", { timeoutMs: 25_000 }, false); return getWebSearchStatus(); }
/** Search remains optional context: every outcome is safe for the model and never blocks model generation. */
export async function searchWeb(query: string, options: SearchWebOptions = {}): Promise<SearchResult | SearchOutcome> { return runCascade(buildGlobalDiscoveryQuery(query), options, true); }
