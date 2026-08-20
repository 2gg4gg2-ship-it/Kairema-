import type { WebSource } from "./providers";
import { getWebSearchStatus as getSavedWebSearchStatus, recordSearchOutage, type SearchOutageInput, upsertWebSearchStatus } from "./db";

export type WebSearchStatus = {
  available: boolean;
  reason: string;
  checkedAt: string;
  googleHttp: number | null;
  openrouterHttp: number | null;
};

export type SearchCascadeUsed = "google" | "tavily" | "openrouter";
export type SearchResult = { summary: string; sources: WebSource[]; cascadeUsed: SearchCascadeUsed };
export type SearchWebOptions = { timeoutMs?: number };

const GOOGLE_SEARCH_MODEL = "gemini-3.6-flash";
const GOOGLE_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GOOGLE_SEARCH_MODEL}:generateContent`;
const TAVILY_ENDPOINT = "https://api.tavily.com/search";
const OPENROUTER_ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";
const STATUS_KEY = "google_grounding";
const QUERY_LIMIT = 8_000;
const SOURCE_LIMIT = 5;
const SNIPPET_LIMIT = 550;
const PREFERRED_GLOBAL_DOMAINS = [".gov", ".edu", ".int", ".org", "openai.com", "google.com", "microsoft.com", "who.int", "un.org", "europa.eu"];

let lastStatus: WebSearchStatus = { available: false, reason: "Проверка web-поиска ещё не выполнялась.", checkedAt: new Date().toISOString(), googleHttp: null, openrouterHttp: null };

export class WebSearchUnavailableError extends Error {
  constructor(message: string) { super(message); this.name = "WebSearchUnavailableError"; }
}

type SearchAttempt = { result: SearchResult | null; http: number | null; latencyMs: number };

function statusFromHttp(http: number, payload: unknown) {
  const body = JSON.stringify(payload ?? "").toLowerCase();
  if (http === 429 || /resource_exhausted|quota/.test(body)) return "Поиск временно недоступен: квота основного поискового сервиса.";
  if (http === 401 || http === 403) return "Поиск временно недоступен: серверная авторизация основного поискового сервиса отклонена.";
  if (http === 404) return "Поиск временно недоступен: требуется обновление server-side конфигурации поиска.";
  return "Поиск временно недоступен: основной поисковый сервис не ответил.";
}

function webSource(title: unknown, url: unknown): WebSource | null {
  if (typeof url !== "string" || !/^https?:\/\//i.test(url)) return null;
  let domain: string | undefined;
  try { domain = new URL(url).hostname.replace(/^www\./i, ""); } catch { /* URL was guarded above */ }
  return { title: typeof title === "string" && title.trim() ? title.trim().slice(0, 240) : domain ?? url, url, ...(domain ? { domain } : {}) };
}

function sourcePriority(source: WebSource) {
  const domain = source.domain?.toLowerCase() ?? "";
  return PREFERRED_GLOBAL_DOMAINS.some((preferred) => domain === preferred || domain.endsWith(preferred)) ? 0 : 1;
}

function uniqueSources(items: Array<WebSource | null>): WebSource[] {
  const seen = new Set<string>();
  return items.flatMap((item) => !item || seen.has(item.url) ? [] : (seen.add(item.url), [item])).sort((a, b) => sourcePriority(a) - sourcePriority(b) || a.title.localeCompare(b.title)).slice(0, SOURCE_LIMIT);
}

/** Keeps the original request as data while explicitly broadening discovery to authoritative English-language global sources. */
export function buildGlobalDiscoveryQuery(query: string) {
  return `Find current, authoritative global information. Prefer official international primary sources and English-language source discovery when useful. Original user request: ${query.slice(0, QUERY_LIMIT)}`;
}

function googleSources(payload: unknown): WebSource[] {
  const raw = (payload as { candidates?: Array<{ groundingMetadata?: { groundingChunks?: Array<{ web?: { title?: unknown; uri?: unknown } }> } }> })?.candidates?.[0]?.groundingMetadata?.groundingChunks ?? [];
  return uniqueSources(raw.map((item) => webSource(item.web?.title, item.web?.uri)));
}

function googleAnswer(payload: unknown) {
  const parts = (payload as { candidates?: Array<{ content?: { parts?: Array<{ text?: unknown }> } }> })?.candidates?.[0]?.content?.parts ?? [];
  return parts.map((part) => typeof part.text === "string" ? part.text : "").join("\n").trim();
}

function tavilyResult(payload: unknown): Omit<SearchResult, "cascadeUsed"> | null {
  const results = (payload as { results?: Array<{ title?: unknown; url?: unknown; content?: unknown }> })?.results ?? [];
  const entries = results.flatMap((item) => {
    const source = webSource(item.title, item.url);
    if (!source) return [];
    const text = typeof item.content === "string" ? item.content.replace(/\s+/g, " ").trim().slice(0, SNIPPET_LIMIT) : "";
    return [{ source, text }];
  }).slice(0, SOURCE_LIMIT);
  const sources = uniqueSources(entries.map((entry) => entry.source));
  if (!sources.length) return null;
  const summary = entries.map(({ source, text }) => `Источник: ${source.title}\nURL: ${source.url}${text ? `\nФрагмент: ${text}` : ""}`).join("\n\n");
  return { summary, sources };
}

function openRouterSources(payload: unknown): WebSource[] {
  const citations = (payload as { citations?: unknown })?.citations;
  return Array.isArray(citations) ? uniqueSources(citations.map((value) => webSource(value, value))) : [];
}

function openRouterAnswer(payload: unknown) {
  const content = (payload as { choices?: Array<{ message?: { content?: unknown } }> })?.choices?.[0]?.message?.content;
  return typeof content === "string" ? content.trim() : "";
}

async function saveStatus(status: WebSearchStatus): Promise<WebSearchStatus> {
  lastStatus = status;
  await upsertWebSearchStatus({ key: STATUS_KEY, state: status.available ? "ready" : "unavailable", reason: status.reason, googleHttp: status.googleHttp, openrouterHttp: status.openrouterHttp, checkedAt: new Date(status.checkedAt) });
  return status;
}

export async function getWebSearchStatus(): Promise<WebSearchStatus> {
  const stored = await getSavedWebSearchStatus();
  return stored ? { available: stored.state === "ready", reason: stored.reason, checkedAt: stored.checkedAt.toISOString(), googleHttp: stored.googleHttp ?? null, openrouterHttp: stored.openrouterHttp ?? null } : lastStatus;
}

function safeCascadeTelemetry(http: { google: number | null; tavily: number | null; openrouter: number | null }, selected: SearchCascadeUsed | null) {
  console.info("[Kairema search]", JSON.stringify({ event: "search.cascade", googleHttp: http.google, tavilyHttp: http.tavily, openrouterHttp: http.openrouter, selected }));
}

function outageClass(http: number | null): SearchOutageInput["errorClass"] {
  if (http === 429) return "rate_limited";
  if (http === 401 || http === 403) return "auth";
  if (http === 404) return "not_found";
  if (http === null) return "network_error";
  if (http >= 400) return "http_error";
  return "no_sources";
}

async function searchGoogle(query: string, key: string, signal: AbortSignal): Promise<SearchAttempt> {
  const startedAt = Date.now();
  try {
    const response = await fetch(GOOGLE_ENDPOINT, { method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": key }, body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: query }] }], tools: [{ google_search: {} }], generationConfig: { temperature: 0.2, maxOutputTokens: 1_200 } }), signal });
    const payload = await response.json().catch(() => null);
    const summary = googleAnswer(payload); const sources = googleSources(payload);
    return { http: response.status, latencyMs: Date.now() - startedAt, result: response.ok && summary && sources.length ? { summary, sources, cascadeUsed: "google" } : null };
  } catch { return { http: null, latencyMs: Date.now() - startedAt, result: null }; }
}

async function searchTavily(query: string, signal: AbortSignal): Promise<SearchAttempt> {
  const key = process.env.TAVILY_API_KEY?.trim();
  if (!key) return { http: null, latencyMs: 0, result: null };
  const startedAt = Date.now();
  try {
    const response = await fetch(TAVILY_ENDPOINT, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` }, body: JSON.stringify({ query: query.slice(0, QUERY_LIMIT), search_depth: "basic", max_results: SOURCE_LIMIT, include_answer: false, include_raw_content: false }), signal });
    const parsed = tavilyResult(await response.json().catch(() => null));
    return { http: response.status, latencyMs: Date.now() - startedAt, result: response.ok && parsed ? { ...parsed, cascadeUsed: "tavily" } : null };
  } catch { return { http: null, latencyMs: Date.now() - startedAt, result: null }; }
}

async function searchOpenRouterOnline(query: string, signal: AbortSignal): Promise<SearchAttempt> {
  const key = process.env.OPENROUTER_API_KEY?.trim();
  if (!key) return { http: null, latencyMs: 0, result: null };
  const startedAt = Date.now();
  try {
    const response = await fetch(OPENROUTER_ENDPOINT, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` }, body: JSON.stringify({ model: "openrouter/free:online", messages: [{ role: "user", content: query.slice(0, QUERY_LIMIT) }], max_tokens: 1_200 }), signal });
    const payload = await response.json().catch(() => null); const summary = openRouterAnswer(payload); const sources = openRouterSources(payload);
    return { http: response.status, latencyMs: Date.now() - startedAt, result: response.ok && summary && sources.length ? { summary, sources, cascadeUsed: "openrouter" } : null };
  } catch { return { http: null, latencyMs: Date.now() - startedAt, result: null }; }
}

async function probeOpenRouterOnline(): Promise<number | null> {
  const attempt = await searchOpenRouterOnline("Kairema health check", AbortSignal.timeout(12_000));
  return attempt.http;
}

/** Saves one final status; no indeterminate state is exposed to the client. */
export async function probeWebSearchStatus(): Promise<WebSearchStatus> {
  const key = process.env.GEMINI_API_KEY?.trim(); const checkedAt = new Date().toISOString();
  const openrouterHttp = await probeOpenRouterOnline();
  if (!key) return saveStatus({ available: false, reason: "Поиск недоступен: server-side ключ основного поискового сервиса не настроен.", checkedAt, googleHttp: null, openrouterHttp });
  const google = await searchGoogle("Проверь свежий поиск и верни проверяемый источник.", key, AbortSignal.timeout(25_000));
  if (google.result) return saveStatus({ available: true, reason: "Поиск доступен.", checkedAt, googleHttp: google.http, openrouterHttp });
  const tavily = await searchTavily("Kairema health check", AbortSignal.timeout(25_000));
  if (tavily.result) return saveStatus({ available: true, reason: "Поиск доступен через резервный сервис.", checkedAt, googleHttp: google.http, openrouterHttp });
  const online = await searchOpenRouterOnline("Kairema health check", AbortSignal.timeout(25_000));
  return saveStatus({ available: Boolean(online.result), reason: online.result ? "Поиск доступен через резервный сервис." : google.http ? statusFromHttp(google.http, null) : "Поиск временно недоступен: не удалось связаться с поисковыми сервисами.", checkedAt, googleHttp: google.http, openrouterHttp: online.http ?? openrouterHttp });
}

/** Raw user text stays server-side and is passed to search providers as data, never as a system instruction. */
export async function searchWeb(query: string, options: SearchWebOptions = {}): Promise<SearchResult> {
  const checkedAt = new Date().toISOString();
  const key = process.env.GEMINI_API_KEY?.trim();
  const previous = await getWebSearchStatus();
  const timeoutMs = Math.max(100, Math.min(options.timeoutMs ?? 25_000, 25_000));
  const signal = AbortSignal.timeout(timeoutMs);
  const globalQuery = buildGlobalDiscoveryQuery(query);
  const http = { google: null as number | null, tavily: null as number | null, openrouter: null as number | null };

  if (key) {
    const google = await searchGoogle(globalQuery, key, signal); http.google = google.http;
    if (google.result) {
      safeCascadeTelemetry(http, google.result.cascadeUsed);
      await saveStatus({ available: true, reason: "Поиск доступен.", checkedAt, googleHttp: http.google, openrouterHttp: previous.openrouterHttp });
      return google.result;
    }
    void recordSearchOutage({ layer: "google", errorClass: outageClass(google.http), latencyMs: google.latencyMs, fellBack: !signal.aborted });
  }
  if (!signal.aborted) {
    const tavily = await searchTavily(globalQuery, signal); http.tavily = tavily.http;
    if (tavily.result) {
      safeCascadeTelemetry(http, tavily.result.cascadeUsed);
      await saveStatus({ available: true, reason: "Поиск доступен через резервный сервис.", checkedAt, googleHttp: http.google, openrouterHttp: previous.openrouterHttp });
      return tavily.result;
    }
    void recordSearchOutage({ layer: "tavily", errorClass: outageClass(tavily.http), latencyMs: tavily.latencyMs, fellBack: !signal.aborted });
  }
  if (!signal.aborted) {
    const online = await searchOpenRouterOnline(globalQuery, signal); http.openrouter = online.http;
    if (online.result) {
      safeCascadeTelemetry(http, online.result.cascadeUsed);
      await saveStatus({ available: true, reason: "Поиск доступен через резервный сервис.", checkedAt, googleHttp: http.google, openrouterHttp: http.openrouter });
      return online.result;
    }
    void recordSearchOutage({ layer: "openrouter", errorClass: outageClass(online.http), latencyMs: online.latencyMs, fellBack: false });
  }
  safeCascadeTelemetry(http, null);
  const reason = signal.aborted && options.timeoutMs
    ? "Поиск временно недоступен: превышен ограниченный бюджет свежих источников."
    : key && http.google ? `${statusFromHttp(http.google, null)} Резервные сервисы не вернули проверяемые источники.`
      : "Поиск временно недоступен: ни один поисковый сервис не вернул проверяемые источники.";
  await saveStatus({ available: false, reason, checkedAt, googleHttp: http.google, openrouterHttp: http.openrouter ?? previous.openrouterHttp });
  throw new WebSearchUnavailableError(reason);
}
