export const PROVIDER_IDS = ["deepseek", "gemma", "gemini", "openai", "kimi", "grok"] as const;

export type ProviderId = (typeof PROVIDER_IDS)[number];
export type ProviderMessage = { role: "user" | "assistant"; content: string };
type StatusKind = "ready" | "quota" | "unavailable" | "auth" | "not_configured";
type ErrorCategory = "AUTH" | "QUOTA" | "RATE_LIMIT" | "ENDPOINT" | "MODEL" | "NETWORK" | "TIMEOUT" | "PROVIDER_UNAVAILABLE" | "PARSE" | "UNKNOWN";

export type ProviderDefinition = {
  id: ProviderId;
  label: string;
  model: string;
  env: "DEEPSEEK_API_KEY" | "GEMINI_API_KEY" | "OPENAI_API_KEY" | "KIMI_API_KEY" | "GROK_API_KEY";
  baseUrl: string;
  kind: "openai" | "google";
};

export const PROVIDER_REGISTRY: readonly ProviderDefinition[] = [
  { id: "deepseek", label: "DeepSeek", model: "deepseek-v4-flash", env: "DEEPSEEK_API_KEY", baseUrl: "https://api.deepseek.com", kind: "openai" },
  { id: "gemma", label: "Gemma 4 31B", model: "gemma-4-31b-it", env: "GEMINI_API_KEY", baseUrl: "https://generativelanguage.googleapis.com/v1beta", kind: "google" },
  { id: "gemini", label: "Gemini", model: "gemini-3.6-flash", env: "GEMINI_API_KEY", baseUrl: "https://generativelanguage.googleapis.com/v1beta", kind: "google" },
  { id: "openai", label: "ChatGPT / OpenAI", model: "gpt-4o-mini", env: "OPENAI_API_KEY", baseUrl: "https://api.openai.com/v1", kind: "openai" },
  { id: "kimi", label: "Kimi", model: "kimi-k2.6", env: "KIMI_API_KEY", baseUrl: "https://api.moonshot.ai/v1", kind: "openai" },
  { id: "grok", label: "Grok", model: "grok-4.6", env: "GROK_API_KEY", baseUrl: "https://api.x.ai/v1", kind: "openai" },
] as const;

const KAIREMA_SYSTEM_PROMPT = [
  "Ты Kairema, AI-ассистент. Не притворяйся человеком.",
  "Отвечай по-русски, если пользователь не просит другой язык.",
  "Тон дружелюбный, спокойный и точный; простые вопросы объясняй кратко, сложные — структурированно.",
  "Не используй шаблонные приветствия и не начинай с «Чем могу помочь?».",
  "Если спрашивают, кто ты или на какой модели работаешь, отвечай: «Я Kairema, AI-ассистент. Сейчас работаю на {модель}.».",
  "Не выдумывай факты и прямо обозначай, когда информации недостаточно.",
].join(" ");

const STATUS_TEXT: Record<StatusKind, "Готов" | "Нет квоты" | "Временно недоступен" | "Ключ отклонён" | "Не настроено"> = {
  ready: "Готов",
  quota: "Нет квоты",
  unavailable: "Временно недоступен",
  auth: "Ключ отклонён",
  not_configured: "Не настроено",
};

export type ProviderHealth = {
  kind: StatusKind;
  badge: (typeof STATUS_TEXT)[StatusKind];
  category: ErrorCategory | null;
  checkedAt: string;
};

export type ProviderView = Omit<ProviderDefinition, "env" | "baseUrl" | "kind"> & { status: ProviderHealth };

const healthCache = new Map<ProviderId, ProviderHealth>();
let lastRegistryProbeAt = 0;
const HEALTH_CACHE_MS = 60_000;
const REQUEST_TIMEOUT_MS = 28_000;

class ProviderRequestError extends Error {
  constructor(
    public readonly category: ErrorCategory,
    public readonly httpStatus: number,
  ) {
    super(category);
  }
}

function getProvider(id: ProviderId) {
  const provider = PROVIDER_REGISTRY.find((entry) => entry.id === id);
  if (!provider) throw new ProviderRequestError("UNKNOWN", 0);
  return provider;
}

function apiKeyFor(provider: ProviderDefinition) {
  return process.env[provider.env]?.trim() ?? "";
}

export function providerRequestUrl(provider: ProviderDefinition, operation: "catalog" | "chat") {
  if (operation === "catalog") return `${provider.baseUrl}/models`;
  return provider.kind === "google"
    ? `${provider.baseUrl}/models/${provider.model}:generateContent`
    : `${provider.baseUrl}/chat/completions`;
}

export function toPublicProviderView(provider: ProviderDefinition, status: ProviderHealth): ProviderView {
  return { id: provider.id, label: provider.label, model: provider.model, status };
}

function nowHealth(kind: StatusKind, category: ErrorCategory | null): ProviderHealth {
  return { kind, badge: STATUS_TEXT[kind], category, checkedAt: new Date().toISOString() };
}

function setHealth(id: ProviderId, kind: StatusKind, category: ErrorCategory | null) {
  const health = nowHealth(kind, category);
  healthCache.set(id, health);
  return health;
}

function lowerText(value: unknown) {
  return JSON.stringify(value ?? "").toLowerCase();
}

export function classifyProviderFailure(httpStatus: number, body: unknown): ErrorCategory {
  const text = lowerText(body);
  const quotaTerms = ["insufficient_quota", "exceeded_current_quota", "no credits", "no credits or licenses", "insufficient balance", "billing", "credits", "balance"];
  if (httpStatus === 402 || quotaTerms.some((term) => text.includes(term))) return "QUOTA";
  if (httpStatus === 401 || text.includes("api_key_invalid") || text.includes("incorrect api key") || text.includes("invalid api key")) return "AUTH";
  if (httpStatus === 403) return quotaTerms.some((term) => text.includes(term)) ? "QUOTA" : "AUTH";
  if (httpStatus === 429) return "RATE_LIMIT";
  if (httpStatus === 503 || text.includes("high demand") || text.includes("temporarily unavailable")) return "PROVIDER_UNAVAILABLE";
  if (httpStatus === 404) return "MODEL";
  if (httpStatus === 400) return "ENDPOINT";
  if (httpStatus === 408 || httpStatus === 504) return "TIMEOUT";
  if (httpStatus >= 500) return "PROVIDER_UNAVAILABLE";
  return "UNKNOWN";
}

function statusFromCategory(category: ErrorCategory): StatusKind {
  if (category === "AUTH") return "auth";
  if (category === "QUOTA") return "quota";
  return "unavailable";
}

function toProviderError(error: unknown) {
  if (error instanceof ProviderRequestError) return error;
  if (error instanceof Error && error.name === "AbortError") return new ProviderRequestError("TIMEOUT", 408);
  return new ProviderRequestError("NETWORK", 0);
}

const wait = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function requestJson(url: string, init: RequestInit): Promise<{ status: number; data: unknown }> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(url, { ...init, signal: controller.signal });
      const raw = await response.text();
      let data: unknown = {};
      try {
        data = raw ? JSON.parse(raw) : {};
      } catch {
        data = { message: raw.slice(0, 500) };
      }
      if (response.ok || (attempt === 1 || (response.status !== 429 && response.status !== 503))) {
        if (!response.ok) throw new ProviderRequestError(classifyProviderFailure(response.status, data), response.status);
        return { status: response.status, data };
      }
    } catch (error) {
      const normalized = toProviderError(error);
      const retryable = normalized.category === "RATE_LIMIT" || normalized.category === "PROVIDER_UNAVAILABLE" || normalized.category === "TIMEOUT";
      if (attempt === 1 || !retryable) throw normalized;
    } finally {
      clearTimeout(timer);
    }
    await wait(700);
  }
  throw new ProviderRequestError("UNKNOWN", 0);
}

function assertModelInCatalog(provider: ProviderDefinition, catalog: unknown) {
  const records = (catalog as { data?: Array<{ id?: string }>; models?: Array<{ name?: string }> }).data
    ?? (catalog as { models?: Array<{ name?: string }> }).models
    ?? [];
  const expectedNames = new Set([provider.model, `models/${provider.model}`]);
  const matched = records.some((record) => {
    const candidate = record as { id?: string; name?: string };
    const name = candidate.id ?? candidate.name;
    return expectedNames.has(name ?? "");
  });
  if (!matched) throw new ProviderRequestError("MODEL", 404);
}

export function buildUpstreamMessages(provider: ProviderDefinition, messages: ProviderMessage[]) {
  return [
    { role: "system", content: KAIREMA_SYSTEM_PROMPT.replace("{модель}", provider.label) },
    ...messages.map((message) => ({ role: message.role, content: message.content })),
  ];
}

function stripHiddenReasoning(content: string) {
  return content
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/<thought>[\s\S]*?<\/thought>/gi, "")
    .trim();
}

export function extractGeminiText(payload: unknown) {
  const parts = (payload as { candidates?: Array<{ content?: { parts?: Array<{ text?: string; thought?: boolean }> } }> }).candidates?.[0]?.content?.parts ?? [];
  const text = parts
    .filter((part) => part.thought !== true)
    .map((part) => part.text ?? "")
    .join("\n");
  const cleaned = stripHiddenReasoning(text);
  if (!cleaned) throw new ProviderRequestError("PARSE", 200);
  return cleaned;
}

async function sendOpenAiStyle(provider: ProviderDefinition, messages: ProviderMessage[], maxTokens = 1_024) {
  const key = apiKeyFor(provider);
  const { data } = await requestJson(providerRequestUrl(provider, "chat"), {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: provider.model, messages: buildUpstreamMessages(provider, messages), max_tokens: maxTokens, stream: false }),
  });
  const content = (data as { choices?: Array<{ message?: { content?: string } }> }).choices?.[0]?.message?.content;
  const cleaned = stripHiddenReasoning(content ?? "");
  if (!cleaned) throw new ProviderRequestError("PARSE", 200);
  return cleaned;
}

export function buildGoogleContents(provider: ProviderDefinition, messages: ProviderMessage[]) {
  return [
    { role: "user", parts: [{ text: KAIREMA_SYSTEM_PROMPT.replace("{модель}", provider.label) }] },
    ...messages.map((message) => ({ role: message.role === "assistant" ? "model" : "user", parts: [{ text: message.content }] })),
  ];
}

async function generateGoogleContent(provider: ProviderDefinition, messages: ProviderMessage[], maxTokens = 1_024) {
  const key = apiKeyFor(provider);
  const contents = buildGoogleContents(provider, messages);
  return requestJson(providerRequestUrl(provider, "chat"), {
    method: "POST",
    headers: { "x-goog-api-key": key, "Content-Type": "application/json" },
    body: JSON.stringify({ contents, generationConfig: { maxOutputTokens: maxTokens, temperature: 0.7 } }),
  });
}

async function checkProvider(provider: ProviderDefinition): Promise<ProviderHealth> {
  if (!apiKeyFor(provider)) return setHealth(provider.id, "not_configured", null);
  try {
    const catalog = await requestJson(providerRequestUrl(provider, "catalog"), {
      headers: provider.kind === "google" ? { "x-goog-api-key": apiKeyFor(provider) } : { Authorization: `Bearer ${apiKeyFor(provider)}` },
    });
    assertModelInCatalog(provider, catalog.data);
    if (provider.kind === "google") {
      await generateGoogleContent(provider, [{ role: "user", content: "Ответь одним словом: готово" }], 192);
    } else {
      await sendOpenAiStyle(provider, [{ role: "user", content: "Ответь одним словом: готово" }], 16);
    }
    return setHealth(provider.id, "ready", null);
  } catch (error) {
    const normalized = toProviderError(error);
    return setHealth(provider.id, statusFromCategory(normalized.category), normalized.category);
  }
}

export async function getProviderViews(force = false): Promise<ProviderView[]> {
  const stale = Date.now() - lastRegistryProbeAt > HEALTH_CACHE_MS;
  if (force || stale || PROVIDER_REGISTRY.some((provider) => !healthCache.has(provider.id))) {
    await Promise.all(PROVIDER_REGISTRY.map((provider) => checkProvider(provider)));
    lastRegistryProbeAt = Date.now();
  }
  return PROVIDER_REGISTRY.map((provider) => toPublicProviderView(
    provider,
    healthCache.get(provider.id) ?? nowHealth("not_configured", null),
  ));
}

function publicProviderError(provider: ProviderDefinition, error: ProviderRequestError) {
  const current = healthCache.get(provider.id) ?? setHealth(provider.id, statusFromCategory(error.category), error.category);
  if (current.kind === "not_configured") return `${provider.label} | Ключ не настроен | Серверный секрет отсутствует | Добавьте ключ в защищённые настройки.`;
  if (current.kind === "quota") return `${provider.label} | Нет квоты | Провайдер подтвердил отсутствие доступного баланса | Пополните баланс или выберите другую модель.`;
  if (current.kind === "auth") return `${provider.label} | Ключ отклонён | Провайдер не принял ключ | Проверьте ключ в защищённых настройках.`;
  return `${provider.label} | Временно недоступен | Причина пока не установлена | Повторите попытку позже или выберите другую модель.`;
}

export async function chatWithProvider(providerInput: ProviderId | "auto", messages: ProviderMessage[]) {
  const views = await getProviderViews();
  const selectedId: ProviderId | undefined = providerInput === "auto"
    ? views.find((provider) => provider.status.kind === "ready")?.id
    : providerInput;
  if (!selectedId) throw new ProviderRequestError("PROVIDER_UNAVAILABLE", 503);
  const provider = getProvider(selectedId);
  const current = healthCache.get(selectedId);
  if (current?.kind !== "ready") {
    const category = current?.category ?? "UNKNOWN";
    throw new ProviderRequestError(category, 503);
  }
  try {
    const content = provider.kind === "google"
      ? extractGeminiText((await generateGoogleContent(provider, messages)).data)
      : await sendOpenAiStyle(provider, messages);
    setHealth(provider.id, "ready", null);
    return { content, providerId: provider.id, providerLabel: provider.label, model: provider.model, status: STATUS_TEXT.ready };
  } catch (error) {
    const normalized = toProviderError(error);
    setHealth(provider.id, statusFromCategory(normalized.category), normalized.category);
    throw new ProviderRequestError(normalized.category, normalized.httpStatus);
  }
}

export function getPublicProviderError(providerInput: ProviderId | "auto", error: unknown) {
  const target = providerInput === "auto"
    ? PROVIDER_REGISTRY.find((provider) => healthCache.get(provider.id)?.kind === "ready") ?? PROVIDER_REGISTRY[0]
    : getProvider(providerInput);
  return publicProviderError(target, toProviderError(error));
}
