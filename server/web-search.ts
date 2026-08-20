import type { WebSource } from "./providers";
import { getWebSearchStatus as getSavedWebSearchStatus, upsertWebSearchStatus } from "./db";

export type WebSearchStatus = {
  available: boolean;
  reason: string;
  checkedAt: string;
  googleHttp: number | null;
  openrouterHttp: number | null;
};

type SearchResult = { summary: string; sources: WebSource[] };
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

let lastStatus: WebSearchStatus = {
  available: false,
  reason: "Проверка web-поиска ещё не выполнялась.",
  checkedAt: new Date().toISOString(),
  googleHttp: null,
  openrouterHttp: null,
};

export class WebSearchUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WebSearchUnavailableError";
  }
}

function statusFromHttp(http: number, payload: unknown) {
  const body = JSON.stringify(payload ?? "").toLowerCase();
  if (http === 429 || /resource_exhausted|quota/.test(body)) return "Поиск временно недоступен: квота Google.";
  if (http === 401 || http === 403) return "Поиск временно недоступен: серверная авторизация Google отклонена.";
  if (http === 404) return "Поиск временно недоступен: server-side модель Google требует обновления.";
  return "Поиск временно недоступен: Google Search grounding не ответил.";
}

function webSource(title: unknown, url: unknown): WebSource | null {
  if (typeof url !== "string" || !/^https?:\/\//i.test(url)) return null;
  let domain: string | undefined;
  try { domain = new URL(url).hostname.replace(/^www\./i, ""); } catch { /* URL is already guarded above */ }
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

function tavilyResult(payload: unknown): SearchResult | null {
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
  if (!Array.isArray(citations)) return [];
  return uniqueSources(citations.map((value) => webSource(value, value)));
}

function openRouterAnswer(payload: unknown) {
  const content = (payload as { choices?: Array<{ message?: { content?: unknown } }> })?.choices?.[0]?.message?.content;
  return typeof content === "string" ? content.trim() : "";
}

async function saveStatus(status: WebSearchStatus): Promise<WebSearchStatus> {
  lastStatus = status;
  await upsertWebSearchStatus({
    key: STATUS_KEY,
    state: status.available ? "ready" : "unavailable",
    reason: status.reason,
    googleHttp: status.googleHttp,
    openrouterHttp: status.openrouterHttp,
    checkedAt: new Date(status.checkedAt),
  });
  return status;
}

export async function getWebSearchStatus(): Promise<WebSearchStatus> {
  const stored = await getSavedWebSearchStatus();
  if (!stored) return lastStatus;
  return {
    available: stored.state === "ready",
    reason: stored.reason,
    checkedAt: stored.checkedAt.toISOString(),
    googleHttp: stored.googleHttp ?? null,
    openrouterHttp: stored.openrouterHttp ?? null,
  };
}

async function probeOpenRouterOnline(): Promise<number | null> {
  const key = process.env.OPENROUTER_API_KEY?.trim();
  if (!key) return null;
  try {
    const response = await fetch(OPENROUTER_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model: "openrouter/free:online", messages: [{ role: "user", content: "ping" }], max_tokens: 1 }),
      signal: AbortSignal.timeout(12_000),
    });
    return response.status;
  } catch { return null; }
}

async function searchTavily(query: string, signal?: AbortSignal): Promise<SearchResult | null> {
  const key = process.env.TAVILY_API_KEY?.trim();
  if (!key) return null;
  try {
    const response = await fetch(TAVILY_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({ query: query.slice(0, QUERY_LIMIT), search_depth: "basic", max_results: SOURCE_LIMIT, include_answer: false, include_raw_content: false }),
      signal: signal ?? AbortSignal.timeout(20_000),
    });
    if (!response.ok) return null;
    return tavilyResult(await response.json().catch(() => null));
  } catch { return null; }
}

async function searchOpenRouterOnline(query: string, signal?: AbortSignal): Promise<SearchResult | null> {
  const key = process.env.OPENROUTER_API_KEY?.trim();
  if (!key) return null;
  try {
    const response = await fetch(OPENROUTER_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model: "openrouter/free:online", messages: [{ role: "user", content: query.slice(0, QUERY_LIMIT) }], max_tokens: 1_200 }),
      signal: signal ?? AbortSignal.timeout(25_000),
    });
    const payload = await response.json().catch(() => null);
    const summary = openRouterAnswer(payload);
    const sources = openRouterSources(payload);
    return response.ok && summary && sources.length ? { summary, sources } : null;
  } catch { return null; }
}

async function fallbackAfterGoogleQuota(query: string, checkedAt: string, googleHttp: number | null, openrouterHttp: number | null, signal?: AbortSignal): Promise<SearchResult | null> {
  const tavily = await searchTavily(query, signal);
  if (tavily) {
    await saveStatus({ available: true, reason: "Google недоступен по квоте; используется Tavily с проверяемыми источниками.", checkedAt, googleHttp, openrouterHttp });
    return tavily;
  }
  const openrouter = await searchOpenRouterOnline(query, signal);
  if (openrouter) {
    await saveStatus({ available: true, reason: "Google недоступен по квоте; Tavily не вернул проверяемые источники, используется OpenRouter online.", checkedAt, googleHttp, openrouterHttp: 200 });
    return openrouter;
  }
  return null;
}

/** Saves one final status; no indeterminate state is exposed to the client. */
export async function probeWebSearchStatus(): Promise<WebSearchStatus> {
  const key = process.env.GEMINI_API_KEY?.trim();
  const checkedAt = new Date().toISOString();
  const openrouterHttp = await probeOpenRouterOnline();
  if (!key) return saveStatus({ available: false, reason: "Поиск недоступен: server-side ключ Google не настроен.", checkedAt, googleHttp: null, openrouterHttp });
  try {
    const response = await fetch(GOOGLE_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: "Проверь Google Search grounding. Верни один проверяемый источник." }] }], tools: [{ google_search: {} }], generationConfig: { temperature: 0, maxOutputTokens: 128 } }),
      signal: AbortSignal.timeout(25_000),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      if (response.status === 429 && await searchTavily("Kairema health check")) return saveStatus({ available: true, reason: "Google недоступен по квоте; Tavily с проверяемыми источниками доступен.", checkedAt, googleHttp: response.status, openrouterHttp });
      return saveStatus({ available: false, reason: statusFromHttp(response.status, payload), checkedAt, googleHttp: response.status, openrouterHttp });
    }
    const hasSources = googleSources(payload).length > 0;
    return saveStatus({ available: hasSources, reason: hasSources ? "Google Search grounding доступен." : "Поиск временно недоступен: Google не вернул проверяемые источники.", checkedAt, googleHttp: response.status, openrouterHttp });
  } catch {
    return saveStatus({ available: false, reason: "Поиск временно недоступен: не удалось связаться с Google.", checkedAt, googleHttp: null, openrouterHttp });
  }
}

/** Raw user text stays server-side and is passed to search providers as data, never as a system instruction. */
export async function searchWeb(query: string, options: SearchWebOptions = {}): Promise<SearchResult> {
  const key = process.env.GEMINI_API_KEY?.trim();
  const previous = await getWebSearchStatus();
  const checkedAt = new Date().toISOString();
  const timeoutMs = Math.max(100, Math.min(options.timeoutMs ?? 25_000, 25_000));
  const searchSignal = AbortSignal.timeout(timeoutMs);
  if (!key) {
    const status = await saveStatus({ available: false, reason: "Поиск недоступен: server-side ключ Google не настроен.", checkedAt, googleHttp: null, openrouterHttp: previous.openrouterHttp });
    throw new WebSearchUnavailableError(status.reason);
  }
  const globalQuery = buildGlobalDiscoveryQuery(query);
  let response: Response;
  try {
    response = await fetch(GOOGLE_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: globalQuery }] }], tools: [{ google_search: {} }], generationConfig: { temperature: 0.2, maxOutputTokens: 1_200 } }),
      signal: searchSignal,
    });
  } catch {
    const reason = options.timeoutMs && searchSignal.aborted
      ? "Поиск временно недоступен: для Flash превышен бюджет свежих источников 1,5 с. Ответ без источников не будет сгенерирован."
      : "Поиск временно недоступен: не удалось связаться с Google.";
    const status = await saveStatus({ available: false, reason, checkedAt, googleHttp: null, openrouterHttp: previous.openrouterHttp });
    throw new WebSearchUnavailableError(status.reason);
  }
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    if (response.status === 429) {
      const fallback = await fallbackAfterGoogleQuota(globalQuery, checkedAt, response.status, previous.openrouterHttp, searchSignal);
      if (fallback) return fallback;
      const status = await saveStatus({ available: false, reason: "Поиск временно недоступен: квота Google; Tavily и OpenRouter online не вернули проверяемые источники. RAG может использоваться отдельно, если релевантен.", checkedAt, googleHttp: response.status, openrouterHttp: previous.openrouterHttp });
      throw new WebSearchUnavailableError(status.reason);
    }
    const status = await saveStatus({ available: false, reason: statusFromHttp(response.status, payload), checkedAt, googleHttp: response.status, openrouterHttp: previous.openrouterHttp });
    throw new WebSearchUnavailableError(status.reason);
  }
  const sources = googleSources(payload);
  const summary = googleAnswer(payload);
  if (!summary || !sources.length) {
    const status = await saveStatus({ available: false, reason: "Поиск временно недоступен: Google не вернул проверяемые источники.", checkedAt, googleHttp: response.status, openrouterHttp: previous.openrouterHttp });
    throw new WebSearchUnavailableError(status.reason);
  }
  await saveStatus({ available: true, reason: "Google Search grounding доступен.", checkedAt, googleHttp: response.status, openrouterHttp: previous.openrouterHttp });
  return { summary, sources };
}
