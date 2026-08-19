import type { WebSource } from "./providers";
import { getWebSearchStatus as getSavedWebSearchStatus, upsertWebSearchStatus } from "./db";

export type WebSearchStatus = {
  available: boolean;
  reason: string;
  checkedAt: string;
  googleHttp: number | null;
  openrouterHttp: number | null;
};

const GOOGLE_SEARCH_MODEL = "gemini-3.6-flash";
const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GOOGLE_SEARCH_MODEL}:generateContent`;
const OPENROUTER_ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";
const STATUS_KEY = "google_grounding";
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

function sourceList(payload: unknown): WebSource[] {
  const raw = (payload as { candidates?: Array<{ groundingMetadata?: { groundingChunks?: Array<{ web?: { title?: unknown; uri?: unknown } }> } }> })?.candidates?.[0]?.groundingMetadata?.groundingChunks ?? [];
  const seen = new Set<string>();
  return raw.flatMap((item) => {
    const url = typeof item.web?.uri === "string" ? item.web.uri : "";
    const title = typeof item.web?.title === "string" ? item.web.title : url;
    if (!/^https?:\/\//i.test(url) || seen.has(url)) return [];
    seen.add(url);
    return [{ title, url }];
  });
}

function answerText(payload: unknown) {
  const parts = (payload as { candidates?: Array<{ content?: { parts?: Array<{ text?: unknown }> } }> })?.candidates?.[0]?.content?.parts ?? [];
  return parts.map((part) => typeof part.text === "string" ? part.text : "").join("\n").trim();
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
      body: JSON.stringify({
        model: "openrouter/free:online",
        messages: [{ role: "user", content: "ping" }],
        max_tokens: 1,
      }),
      signal: AbortSignal.timeout(12_000),
    });
    return response.status;
  } catch {
    return null;
  }
}

function openRouterSources(payload: unknown): WebSource[] {
  const citations = (payload as { citations?: unknown })?.citations;
  if (!Array.isArray(citations)) return [];
  const seen = new Set<string>();
  return citations.flatMap((value) => {
    const url = typeof value === "string" ? value : "";
    if (!/^https?:\/\//i.test(url) || seen.has(url)) return [];
    seen.add(url);
    return [{ title: url, url }];
  });
}

function openRouterAnswer(payload: unknown) {
  const content = (payload as { choices?: Array<{ message?: { content?: unknown } }> })?.choices?.[0]?.message?.content;
  return typeof content === "string" ? content.trim() : "";
}

async function searchOpenRouterOnline(query: string): Promise<{ summary: string; sources: WebSource[] } | null> {
  const key = process.env.OPENROUTER_API_KEY?.trim();
  if (!key) return null;
  try {
    const response = await fetch(OPENROUTER_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model: "openrouter/free:online", messages: [{ role: "user", content: query.slice(0, 8_000) }], max_tokens: 1_200 }),
      signal: AbortSignal.timeout(25_000),
    });
    let payload: unknown = null;
    try { payload = await response.json(); } catch { /* no usable sources */ }
    const summary = openRouterAnswer(payload);
    const sources = openRouterSources(payload);
    return response.ok && summary && sources.length ? { summary, sources } : null;
  } catch {
    return null;
  }
}

/** Saves one final status; it never returns an indeterminate spinner state to the client. */
export async function probeWebSearchStatus(): Promise<WebSearchStatus> {
  const key = process.env.GEMINI_API_KEY?.trim();
  const checkedAt = new Date().toISOString();
  const openrouterHttp = await probeOpenRouterOnline();
  if (!key) {
    return saveStatus({ available: false, reason: "Поиск недоступен: server-side ключ Google не настроен.", checkedAt, googleHttp: null, openrouterHttp });
  }

  try {
    const response = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: "Проверь Google Search grounding. Верни один проверяемый источник." }] }],
        tools: [{ google_search: {} }],
        generationConfig: { temperature: 0, maxOutputTokens: 128 },
      }),
      signal: AbortSignal.timeout(25_000),
    });
    let payload: unknown = null;
    try { payload = await response.json(); } catch { /* classified below */ }
    if (!response.ok) {
      return saveStatus({ available: false, reason: statusFromHttp(response.status, payload), checkedAt, googleHttp: response.status, openrouterHttp });
    }
    const hasSources = sourceList(payload).length > 0;
    return saveStatus({
      available: hasSources,
      reason: hasSources ? "Google Search grounding доступен." : "Поиск временно недоступен: Google не вернул проверяемые источники.",
      checkedAt,
      googleHttp: response.status,
      openrouterHttp,
    });
  } catch {
    return saveStatus({ available: false, reason: "Поиск временно недоступен: не удалось связаться с Google.", checkedAt, googleHttp: null, openrouterHttp });
  }
}

/** The raw user query goes only to Google on the server and is never interpolated as instructions. */
export async function searchWeb(query: string): Promise<{ summary: string; sources: WebSource[] }> {
  const key = process.env.GEMINI_API_KEY?.trim();
  const previous = await getWebSearchStatus();
  const checkedAt = new Date().toISOString();
  if (!key) {
    const status = await saveStatus({ available: false, reason: "Поиск недоступен: server-side ключ Google не настроен.", checkedAt, googleHttp: null, openrouterHttp: previous.openrouterHttp });
    throw new WebSearchUnavailableError(status.reason);
  }

  let response: Response;
  try {
    response = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: query.slice(0, 8_000) }] }],
        tools: [{ google_search: {} }],
        generationConfig: { temperature: 0.2, maxOutputTokens: 1_200 },
      }),
      signal: AbortSignal.timeout(25_000),
    });
  } catch {
    const status = await saveStatus({ available: false, reason: "Поиск временно недоступен: не удалось связаться с Google.", checkedAt, googleHttp: null, openrouterHttp: previous.openrouterHttp });
    throw new WebSearchUnavailableError(status.reason);
  }

  let payload: unknown = null;
  try { payload = await response.json(); } catch { /* response is classified below */ }
  if (!response.ok) {
    if (response.status === 429) {
      const fallback = await searchOpenRouterOnline(query);
      if (fallback) {
        await saveStatus({ available: true, reason: "Google недоступен по квоте; используется OpenRouter online с проверяемыми источниками.", checkedAt, googleHttp: response.status, openrouterHttp: 200 });
        return fallback;
      }
      const status = await saveStatus({ available: false, reason: "Поиск временно недоступен: квота Google; OpenRouter online не вернул проверяемые источники.", checkedAt, googleHttp: response.status, openrouterHttp: previous.openrouterHttp });
      throw new WebSearchUnavailableError(status.reason);
    }
    const status = await saveStatus({ available: false, reason: statusFromHttp(response.status, payload), checkedAt, googleHttp: response.status, openrouterHttp: previous.openrouterHttp });
    throw new WebSearchUnavailableError(status.reason);
  }

  const sources = sourceList(payload);
  const summary = answerText(payload);
  if (!summary || !sources.length) {
    const status = await saveStatus({ available: false, reason: "Поиск временно недоступен: Google не вернул проверяемые источники.", checkedAt, googleHttp: response.status, openrouterHttp: previous.openrouterHttp });
    throw new WebSearchUnavailableError(status.reason);
  }

  await saveStatus({ available: true, reason: "Google Search grounding доступен.", checkedAt, googleHttp: response.status, openrouterHttp: previous.openrouterHttp });
  return { summary, sources };
}
