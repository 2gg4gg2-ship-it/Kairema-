import type { WebSource } from "./providers";

export type WebSearchStatus = { available: boolean; reason: string; checkedAt: string };

const GOOGLE_SEARCH_MODEL = "gemini-3.6-flash";
const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GOOGLE_SEARCH_MODEL}:generateContent`;
let lastStatus: WebSearchStatus = {
  available: false,
  reason: "Поиск временно недоступен: ожидается server-side проверка Google.",
  checkedAt: new Date().toISOString(),
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

export function getWebSearchStatus() { return lastStatus; }

/** The raw user query goes only to Google on the server and is never interpolated as instructions. */
export async function searchWeb(query: string): Promise<{ summary: string; sources: WebSource[] }> {
  const key = process.env.GEMINI_API_KEY?.trim();
  if (!key) {
    lastStatus = { available: false, reason: "Поиск недоступен: server-side ключ Google не настроен.", checkedAt: new Date().toISOString() };
    throw new WebSearchUnavailableError(lastStatus.reason);
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
    lastStatus = { available: false, reason: "Поиск временно недоступен: не удалось связаться с Google.", checkedAt: new Date().toISOString() };
    throw new WebSearchUnavailableError(lastStatus.reason);
  }

  let payload: unknown = null;
  try { payload = await response.json(); } catch { /* response is classified below */ }
  if (!response.ok) {
    lastStatus = { available: false, reason: statusFromHttp(response.status, payload), checkedAt: new Date().toISOString() };
    throw new WebSearchUnavailableError(lastStatus.reason);
  }

  const sources = sourceList(payload);
  const summary = answerText(payload);
  if (!summary || !sources.length) {
    lastStatus = { available: false, reason: "Поиск временно недоступен: Google не вернул проверяемые источники.", checkedAt: new Date().toISOString() };
    throw new WebSearchUnavailableError(lastStatus.reason);
  }

  lastStatus = { available: true, reason: "Google Search grounding доступен.", checkedAt: new Date().toISOString() };
  return { summary, sources };
}
