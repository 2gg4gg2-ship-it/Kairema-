import type { WebSource } from "./providers";
import { getWebSearchStatus as getSavedWebSearchStatus, recordSearchOutage, type SearchOutageInput, upsertWebSearchStatus } from "./db";

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
export type SearchResult = { summary: string; sources: WebSource[]; cascadeUsed: SearchCascadeUsed };
export type SearchWebOptions = { timeoutMs?: number };

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
type SearchAttempt = { result: SearchResult | null; http: number | null; latencyMs: number };
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
function webSource(title: unknown, url: unknown): WebSource | null {
  if (typeof url !== "string" || !/^https?:\/\//i.test(url)) return null;
  let domain: string | undefined;
  try { domain = new URL(url).hostname.replace(/^www\./i, ""); } catch { /* URL already validated */ }
  return { title: typeof title === "string" && title.trim() ? title.trim().slice(0, 240) : domain ?? url, url, ...(domain ? { domain } : {}) };
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
function sourceSummary(entries: Array<{ source: WebSource; text: string }>) {
  return entries.map(({ source, text }) => `Источник: ${source.title}\nURL: ${source.url}${text ? `\nФрагмент: ${text}` : ""}`).join("\n\n");
}
function youResult(payload: unknown): Omit<SearchResult, "cascadeUsed"> | null {
  const results = (payload as { results?: { web?: Array<{ title?: unknown; url?: unknown; description?: unknown }>; news?: Array<{ title?: unknown; url?: unknown; description?: unknown }> } })?.results;
  const entries = [...(results?.web ?? []), ...(results?.news ?? [])].flatMap((item) => {
    const source = webSource(item.title, item.url);
    return source ? [{ source, text: typeof item.description === "string" ? item.description.replace(/\s+/g, " ").trim().slice(0, SNIPPET_LIMIT) : "" }] : [];
  });
  const sources = uniqueSources(entries.map((entry) => entry.source));
  return sources.length ? { summary: sourceSummary(entries.filter((entry) => sources.some((source) => source.url === entry.source.url))), sources } : null;
}
function serperResult(payload: unknown): Omit<SearchResult, "cascadeUsed"> | null {
  const entries = ((payload as { organic?: Array<{ title?: unknown; link?: unknown; snippet?: unknown }> })?.organic ?? []).flatMap((item) => {
    const source = webSource(item.title, item.link);
    return source ? [{ source, text: typeof item.snippet === "string" ? item.snippet.replace(/\s+/g, " ").trim().slice(0, SNIPPET_LIMIT) : "" }] : [];
  });
  const sources = uniqueSources(entries.map((entry) => entry.source));
  return sources.length ? { summary: sourceSummary(entries.filter((entry) => sources.some((source) => source.url === entry.source.url))), sources } : null;
}
function exaResult(payload: unknown): Omit<SearchResult, "cascadeUsed"> | null {
  const entries = ((payload as { results?: Array<{ title?: unknown; url?: unknown; text?: unknown; highlights?: unknown }> })?.results ?? []).flatMap((item) => {
    const source = webSource(item.title, item.url);
    const highlight = Array.isArray(item.highlights) ? item.highlights.find((value): value is string => typeof value === "string") : null;
    const text = highlight ?? (typeof item.text === "string" ? item.text : "");
    return source ? [{ source, text: text.replace(/\s+/g, " ").trim().slice(0, SNIPPET_LIMIT) }] : [];
  });
  const sources = uniqueSources(entries.map((entry) => entry.source));
  return sources.length ? { summary: sourceSummary(entries.filter((entry) => sources.some((source) => source.url === entry.source.url))), sources } : null;
}
function skippedAttempt(): SearchAttempt { return { result: null, http: null, latencyMs: 0 }; }
async function requestSearch(layer: SearchLayer, query: string, signal: AbortSignal): Promise<SearchAttempt> {
  const startedAt = Date.now();
  const apiKey = (layer === "you" ? process.env.YOU_API_KEY : layer === "serper" ? process.env.SERPER_API_KEY : process.env.EXA_API_KEY)?.trim() ?? "";
  if (!apiKey) return skippedAttempt();
  try {
    const request: { url: string; headers: Record<string, string>; body: object; parse: (payload: unknown) => Omit<SearchResult, "cascadeUsed"> | null } = layer === "you"
      ? { url: YOU_ENDPOINT, headers: { "Content-Type": "application/json", "X-API-Key": apiKey }, body: { query, count: SOURCE_LIMIT, safesearch: "moderate" }, parse: youResult }
      : layer === "serper"
        ? { url: SERPER_ENDPOINT, headers: { "Content-Type": "application/json", "X-API-KEY": apiKey }, body: { q: query, num: SOURCE_LIMIT }, parse: serperResult }
        : { url: EXA_ENDPOINT, headers: { "Content-Type": "application/json", "x-api-key": apiKey }, body: { query, numResults: SOURCE_LIMIT, contents: { text: { maxCharacters: 2_000 } } }, parse: exaResult };
    const response = await fetch(request.url, { method: "POST", headers: request.headers, body: JSON.stringify(request.body), signal });
    const parsed = request.parse(await response.json().catch(() => null));
    return { http: response.status, latencyMs: Date.now() - startedAt, result: response.ok && parsed ? { ...parsed, cascadeUsed: layer } : null };
  } catch { return { http: null, latencyMs: Date.now() - startedAt, result: null }; }
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
function safeCascadeTelemetry(http: Record<SearchLayer, number | null>, selected: SearchCascadeUsed | null) { console.info("[Kairema search]", JSON.stringify({ event: "search.cascade", youHttp: http.you, serperHttp: http.serper, exaHttp: http.exa, selected })); }
function outageClass(http: number | null): SearchOutageInput["errorClass"] { if (http === 429) return "rate_limited"; if (http === 401 || http === 403) return "auth"; if (http === 404) return "not_found"; if (http === null) return "network_error"; if (http >= 400) return "http_error"; return "no_sources"; }
async function runCascade(query: string, options: SearchWebOptions, recordOutages: boolean): Promise<SearchResult | null> {
  const checkedAt = new Date().toISOString();
  const previous = await getWebSearchStatus();
  const signal = AbortSignal.timeout(Math.max(100, Math.min(options.timeoutMs ?? 25_000, 25_000)));
  const http: Record<SearchLayer, number | null> = { you: null, serper: null, exa: null };
  for (const layer of LAYERS) {
    if (signal.aborted || isCooling(layer)) continue;
    const attempt = await requestSearch(layer, query, signal);
    http[layer] = attempt.http;
    if (attempt.result) {
      safeCascadeTelemetry(http, layer);
      await saveStatus({ available: true, reason: layer === "you" ? "Поиск доступен." : "Поиск доступен через резервный слой.", checkedAt, youHttp: http.you ?? previous.youHttp, serperHttp: http.serper ?? previous.serperHttp, exaHttp: http.exa ?? previous.exaHttp, googleHttp: previous.googleHttp, tavilyHttp: previous.tavilyHttp, openrouterHttp: previous.openrouterHttp });
      return attempt.result;
    }
    if (recordOutages) void recordSearchOutage({ layer, errorClass: outageClass(attempt.http), latencyMs: attempt.latencyMs, fellBack: layer !== "exa" && !signal.aborted });
  }
  safeCascadeTelemetry(http, null);
  const primaryHttp = http.you;
  const reason = signal.aborted && options.timeoutMs ? "Поиск временно недоступен: превышен ограниченный бюджет свежих источников." : isCooling("you") ? "Поиск временно ограничен: основной слой ожидает сброса квоты." : primaryHttp ? `${statusFromHttp(primaryHttp)} Резервные слои не вернули проверяемые источники.` : "Поиск временно недоступен: ни один слой не вернул проверяемые источники.";
  await saveStatus({ available: false, reason, checkedAt, youHttp: http.you ?? previous.youHttp, serperHttp: http.serper ?? previous.serperHttp, exaHttp: http.exa ?? previous.exaHttp, googleHttp: previous.googleHttp, tavilyHttp: previous.tavilyHttp, openrouterHttp: previous.openrouterHttp });
  return null;
}
export async function probeWebSearchStatus(): Promise<WebSearchStatus> { await runCascade("Kairema health check", { timeoutMs: 25_000 }, false); return getWebSearchStatus(); }
/** Search is optional context: null means source retrieval failed but model generation may continue. */
export async function searchWeb(query: string, options: SearchWebOptions = {}): Promise<SearchResult | null> { return runCascade(buildGlobalDiscoveryQuery(query), options, true); }
