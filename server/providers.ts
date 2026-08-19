export const MODEL_IDS = [
  "google/gemma-4-26b-a4b-it:free",
  "cohere/north-mini-code:free",
  "dots-studio/dots-3-note-preview:free",
  "openai/gpt-oss-20b:free",
  "openrouter/free",
] as const;

export type ModelId = (typeof MODEL_IDS)[number];
export type ModelKey = "ultra" | "code" | "long_context" | "express" | "auto_router";
export type ModelConfig = { key: ModelKey; modelId: ModelId; label: string; role: string };
export type StatusCategory = "AUTH" | "QUOTA" | "RATE_LIMIT" | "PROVIDER_UNAVAILABLE" | "ENDPOINT" | "MODEL" | "NETWORK" | "TIMEOUT" | "PARSE" | "CONFIG" | "UNKNOWN";
export type ModelStatus = { state: "ready" | "loading" | "error" | "unavailable" | "not_configured"; badge: string; category: StatusCategory | null; http: number | null; checkedAt: string; confirmed: string };
export type ModelView = ModelConfig & { status: ModelStatus };
export type ChatMessage = { role: "user" | "assistant"; content: string };
export type ChatSettings = { style?: "default" | "professional" | "friendly" | "concise" | "steps" };
export type ChatResult = { content: string; modelUsed: string; label: string; status: ModelStatus };

/** Static by design: these five cards are never built from environment variables or API responses. */
export const MODEL_CONFIG: readonly ModelConfig[] = [
  { key: "ultra", modelId: "google/gemma-4-26b-a4b-it:free", label: "Kairema Ultra (Gemma 4)", role: "Основной универсальный чат для сложных текстов, логики и общения." },
  { key: "code", modelId: "cohere/north-mini-code:free", label: "Kairema Code (North)", role: "Специализированный ИИ для генерации, разбора, рефакторинга и отладки кода." },
  { key: "long_context", modelId: "dots-studio/dots-3-note-preview:free", label: "Kairema Long-Context (Dots3)", role: "Анализ сверхбольших текстов, контекстных документов и тяжёлых файлов." },
  { key: "express", modelId: "openai/gpt-oss-20b:free", label: "Kairema Express (GPT-OSS)", role: "Молниеносные лаконичные ответы на простые повседневные вопросы без воды." },
  { key: "auto_router", modelId: "openrouter/free", label: "Kairema Auto-Router", role: "Автоматический выбор стабильной и свободной бесплатной модели на стороне OpenRouter." },
] as const;

const OPENROUTER_BASE = "https://openrouter.ai/api/v1";
const HEALTH_TTL_MS = 60_000;
let healthCache: { checkedAt: number; statuses: Map<ModelId, ModelStatus> } | null = null;
const now = () => new Date().toISOString();
const configured = () => Boolean(process.env.OPENROUTER_API_KEY?.trim());

export const KAIREMA_SYSTEM_PROMPT = `Ты Kairema, AI-ассистент. Не притворяйся человеком. Не указывай пол; если грамматически нужен род, используй мужской. Не начинай каждый ответ шаблонным приветствием. Отвечай по-русски, если пользователь не попросил иначе. На простой вопрос отвечай просто, на сложный — подробно и структурированно. На вопрос «кто ты» отвечай кратко: «Я Kairema, AI-ассистент. Сейчас работаю на {модель}». Не выдумывай факты и прямо признавай нехватку информации.`;

export function statusLabel(category: StatusCategory | null, state: ModelStatus["state"]) {
  if (state === "ready") return "Готов";
  if (state === "loading") return "Проверка…";
  if (state === "not_configured") return "Не настроено";
  if (state === "unavailable") return "Временно недоступен";
  if (category === "QUOTA") return "Нет квоты (биллинг)";
  if (category === "RATE_LIMIT") return "Лимит запросов — восстановится";
  if (category === "AUTH") return "Ключ отклонён";
  if (category === "PROVIDER_UNAVAILABLE") return "Временно недоступен";
  if (category === "ENDPOINT" || category === "MODEL") return "Неверная конфигурация провайдера";
  return `Ошибка: ${category ?? "UNKNOWN"}`;
}

export function classifyOpenRouterFailure(http: number | null, upstream: unknown): { category: StatusCategory; confirmed: string; state: ModelStatus["state"] } {
  const body = JSON.stringify(upstream ?? {}).toLowerCase();
  if (http === 401 || http === 403 || /invalid_api_key|api_key_invalid|invalid api key|incorrect api key/.test(body)) return { category: "AUTH", confirmed: "Ключ отклонён OpenRouter.", state: "error" };
  if (http === 429) return { category: "RATE_LIMIT", confirmed: "Подтверждено ограничение частоты запросов.", state: "error" };
  if (http === 402 || /insufficient_quota|credits|no balance|insufficient balance|quota/.test(body)) return { category: "QUOTA", confirmed: "Подтверждена нехватка квоты или биллинга.", state: "error" };
  if (http === 503 && /load|capacity|overload|unavailable|busy/.test(body)) return { category: "PROVIDER_UNAVAILABLE", confirmed: "Провайдер временно недоступен из-за нагрузки.", state: "unavailable" };
  if (http === 400 || http === 404) return { category: /model/.test(body) ? "MODEL" : "ENDPOINT", confirmed: "Провайдер отклонил модель или endpoint.", state: "error" };
  return { category: "UNKNOWN", confirmed: "Причина пока не установлена.", state: "error" };
}

export function stripReasoningBlocks(value: string) {
  return value.replace(/<think(?:\s[^>]*)?>[\s\S]*?<\/think>/gi, "").replace(/<reasoning(?:\s[^>]*)?>[\s\S]*?<\/reasoning>/gi, "").replace(/<thought(?:\s[^>]*)?>[\s\S]*?<\/thought>/gi, "").trim();
}

export function modelById(modelId: string): ModelConfig | undefined { return MODEL_CONFIG.find((model) => model.modelId === modelId); }
export function toPublicModelView(config: ModelConfig, status: ModelStatus): ModelView { return { key: config.key, modelId: config.modelId, label: config.label, role: config.role, status }; }
export function selectAutoModel(views: readonly ModelView[]): ModelConfig | undefined {
  const firstReady = views.find((view) => view.key !== "auto_router" && view.status.state === "ready");
  return firstReady ? modelById(firstReady.modelId) : undefined;
}

function statusFromFailure(http: number | null, upstream: unknown): ModelStatus {
  const failure = classifyOpenRouterFailure(http, upstream);
  return { state: failure.state, badge: statusLabel(failure.category, failure.state), category: failure.category, http, checkedAt: now(), confirmed: failure.confirmed };
}
function readyStatus(): ModelStatus { return { state: "ready", badge: "Готов", category: null, http: 200, checkedAt: now(), confirmed: "Модель ответила на краткий тест через OpenRouter." }; }
function notConfiguredStatus(): ModelStatus { return { state: "not_configured", badge: "Не настроено", category: "CONFIG", http: null, checkedAt: now(), confirmed: "OPENROUTER_API_KEY не задан в секретах проекта." }; }

export class OpenRouterError extends Error {
  constructor(public readonly status: ModelStatus) { super(status.confirmed); this.name = "OpenRouterError"; }
}

async function fetchJson(path: string, init: RequestInit) {
  const key = process.env.OPENROUTER_API_KEY?.trim();
  if (!key) throw new OpenRouterError(notConfiguredStatus());
  let response: Response;
  try {
    response = await fetch(`${OPENROUTER_BASE}${path}`, { ...init, headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "HTTP-Referer": "https://kairema.manus.space", "X-Title": "Kairema", ...init.headers }, signal: AbortSignal.timeout(25_000) });
  } catch (error) {
    const category: StatusCategory = error instanceof DOMException && error.name === "TimeoutError" ? "TIMEOUT" : "NETWORK";
    throw new OpenRouterError({ state: "error", badge: statusLabel(category, "error"), category, http: null, checkedAt: now(), confirmed: category === "TIMEOUT" ? "Превышено время ожидания OpenRouter." : "Сетевая ошибка при обращении к OpenRouter." });
  }
  let data: unknown = null;
  try { data = await response.json(); } catch { data = { message: "Не удалось разобрать ответ OpenRouter." }; }
  if (!response.ok) throw new OpenRouterError(statusFromFailure(response.status, data));
  return { response, data };
}

async function fetchSse(path: string, body: unknown, signal?: AbortSignal) {
  const key = process.env.OPENROUTER_API_KEY?.trim();
  if (!key) throw new OpenRouterError(notConfiguredStatus());
  let response: Response;
  try {
    response = await fetch(`${OPENROUTER_BASE}${path}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "Accept": "text/event-stream", "HTTP-Referer": "https://kairema.manus.space", "X-Title": "Kairema" },
      body: JSON.stringify(body),
      signal: signal ?? AbortSignal.timeout(90_000),
    });
  } catch (error) {
    const category: StatusCategory = error instanceof DOMException && error.name === "TimeoutError" ? "TIMEOUT" : "NETWORK";
    throw new OpenRouterError({ state: "error", badge: statusLabel(category, "error"), category, http: null, checkedAt: now(), confirmed: category === "TIMEOUT" ? "Превышено время ожидания потокового ответа OpenRouter." : "Сетевая ошибка при обращении к OpenRouter." });
  }
  if (!response.ok) {
    let data: unknown = null;
    try { data = await response.json(); } catch { data = { message: "Не удалось разобрать ошибку OpenRouter." }; }
    throw new OpenRouterError(statusFromFailure(response.status, data));
  }
  if (!response.body) throw new OpenRouterError({ state: "error", badge: statusLabel("PARSE", "error"), category: "PARSE", http: response.status, checkedAt: now(), confirmed: "OpenRouter не открыл поток ответа." });
  return response;
}

export function dataFromSseBlock(block: string) {
  return block
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart())
    .join("\n");
}

export function openRouterStreamDelta(payload: unknown) {
  const content = (payload as { choices?: Array<{ delta?: { content?: unknown } }> })?.choices?.[0]?.delta?.content;
  return typeof content === "string" ? content : "";
}

export function createReasoningStreamFilter() {
  let pending = "";
  let hiddenTag: string | null = null;
  return (chunk: string, final = false) => {
    pending += chunk;
    let output = "";
    while (pending) {
      if (hiddenTag) {
        const close = pending.match(new RegExp(`</${hiddenTag}\\s*>`, "i"));
        if (close?.index !== undefined) {
          pending = pending.slice(close.index + close[0].length);
          hiddenTag = null;
          continue;
        }
        if (final) pending = "";
        else {
          const lastTagStart = pending.lastIndexOf("<");
          pending = lastTagStart >= 0 ? pending.slice(lastTagStart) : "";
        }
        break;
      }

      const opening = pending.match(/<(think|reasoning|thought)(?:\s[^>]*)?>/i);
      if (opening?.index !== undefined) {
        output += pending.slice(0, opening.index);
        pending = pending.slice(opening.index + opening[0].length);
        hiddenTag = opening[1]!.toLowerCase();
        continue;
      }
      if (final) {
        output += pending;
        pending = "";
      } else {
        const lastTagStart = pending.lastIndexOf("<");
        if (lastTagStart >= 0 && pending.length - lastTagStart < 24) {
          output += pending.slice(0, lastTagStart);
          pending = pending.slice(lastTagStart);
        } else {
          output += pending;
          pending = "";
        }
      }
      break;
    }
    return output;
  };
}

export function statusFromChatPayload(payload: unknown): ModelStatus {
  const raw = (payload as { choices?: Array<{ message?: { content?: unknown } }> })?.choices?.[0]?.message?.content;
  if (typeof raw !== "string" || !stripReasoningBlocks(raw)) return { state: "error", badge: statusLabel("PARSE", "error"), category: "PARSE", http: 200, checkedAt: now(), confirmed: "OpenRouter вернул ответ без финального текста во время проверки модели." };
  return readyStatus();
}

async function checkModelHealth(model: ModelConfig): Promise<ModelStatus> {
  try {
    const { data } = await fetchJson("/chat/completions", { method: "POST", body: JSON.stringify({ model: model.modelId, stream: false, messages: [{ role: "user", content: "Ответь ровно одним словом: Готово" }] }) });
    return statusFromChatPayload(data);
  } catch (error) {
    return error instanceof OpenRouterError ? error.status : statusFromFailure(null, error);
  }
}

async function freshStatuses() {
  if (!configured()) return new Map(MODEL_IDS.map((id) => [id, notConfiguredStatus()]));
  try {
    const { data } = await fetchJson("/models", { method: "GET" });
    const available = new Set(((data as { data?: Array<{ id?: string }> }).data ?? []).map((item) => item.id));
    const checked: Array<readonly [ModelId, ModelStatus]> = [];
    for (let index = 0; index < MODEL_CONFIG.length; index += 1) {
      const model = MODEL_CONFIG[index]!;
      if (!available.has(model.modelId)) {
        checked.push([model.modelId, { state: "error", badge: statusLabel("MODEL", "error"), category: "MODEL", http: 200, checkedAt: now(), confirmed: "ID модели не найден в живом каталоге OpenRouter." }]);
      } else {
        checked.push([model.modelId, await checkModelHealth(model)]);
      }
      if (index < MODEL_CONFIG.length - 1) await pause(1_100);
    }
    return new Map<ModelId, ModelStatus>(checked);
  } catch (error) {
    const status = error instanceof OpenRouterError ? error.status : statusFromFailure(null, error);
    return new Map(MODEL_IDS.map((id) => [id, status]));
  }
}

export async function getModelViews() {
  if (!healthCache || Date.now() - healthCache.checkedAt > HEALTH_TTL_MS) healthCache = { checkedAt: Date.now(), statuses: await freshStatuses() };
  return MODEL_CONFIG.map((model) => toPublicModelView(model, healthCache?.statuses.get(model.modelId) ?? notConfiguredStatus()));
}

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const shouldRetry = (status: ModelStatus) => status.category === "RATE_LIMIT" || status.category === "PROVIDER_UNAVAILABLE" || status.category === "NETWORK" || status.category === "TIMEOUT";
function promptFor(model: ModelConfig, settings?: ChatSettings) {
  const style = settings?.style === "concise" ? "Отвечай особенно кратко." : settings?.style === "steps" ? "Разбивай решение на понятные шаги." : settings?.style === "professional" ? "Сохраняй профессиональный, ясный тон." : settings?.style === "friendly" ? "Сохраняй доброжелательный естественный тон." : "";
  return `${KAIREMA_SYSTEM_PROMPT.replace("{модель}", model.label)} ${style}`.trim();
}
export function buildOpenRouterMessages(model: ModelConfig, history: ChatMessage[], settings?: ChatSettings) { return [{ role: "system" as const, content: promptFor(model, settings) }, ...history.map((message) => ({ role: message.role, content: message.content }))]; }

export async function chatWithOpenRouter(modelId: string, history: ChatMessage[], settings?: ChatSettings): Promise<ChatResult> {
  const requestedModel = modelById(modelId);
  if (!requestedModel) throw new OpenRouterError({ state: "error", badge: statusLabel("MODEL", "error"), category: "MODEL", http: null, checkedAt: now(), confirmed: "Выбрана модель вне статического реестра Kairema." });
  const model = requestedModel.key === "auto_router" ? (selectAutoModel(await getModelViews()) ?? requestedModel) : requestedModel;
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const { data } = await fetchJson("/chat/completions", { method: "POST", body: JSON.stringify({ model: model.modelId, messages: buildOpenRouterMessages(model, history, settings), stream: false }) });
      const payload = data as { choices?: Array<{ message?: { content?: string } }>; model?: string };
      const raw = payload.choices?.[0]?.message?.content;
      const content = typeof raw === "string" ? stripReasoningBlocks(raw) : "";
      if (!content) throw new OpenRouterError({ state: "error", badge: statusLabel("PARSE", "error"), category: "PARSE", http: 200, checkedAt: now(), confirmed: "После удаления reasoning-блоков не осталось финального ответа." });
      return { content, modelUsed: payload.model ?? model.modelId, label: model.label, status: readyStatus() };
    } catch (error) {
      lastError = error;
      if (!(error instanceof OpenRouterError) || !shouldRetry(error.status) || attempt === 1) break;
      await pause(350 * (attempt + 1));
    }
  }
  throw lastError instanceof OpenRouterError ? lastError : new OpenRouterError(statusFromFailure(null, lastError));
}

export async function chatWithOpenRouterStream(modelId: string, history: ChatMessage[], settings: ChatSettings | undefined, onDelta: (delta: string) => void, signal?: AbortSignal): Promise<ChatResult> {
  const requestedModel = modelById(modelId);
  if (!requestedModel) throw new OpenRouterError({ state: "error", badge: statusLabel("MODEL", "error"), category: "MODEL", http: null, checkedAt: now(), confirmed: "Выбрана модель вне статического реестра Kairema." });
  const model = requestedModel.key === "auto_router" ? (selectAutoModel(await getModelViews()) ?? requestedModel) : requestedModel;
  const response = await fetchSse("/chat/completions", { model: model.modelId, messages: buildOpenRouterMessages(model, history, settings), stream: true }, signal);
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  const filter = createReasoningStreamFilter();
  const pieces: string[] = [];
  let buffer = "";
  let modelUsed: string = model.modelId;

  const emit = (raw: string) => {
    const visible = filter(raw);
    if (visible) {
      pieces.push(visible);
      onDelta(visible);
    }
  };
  const consume = (block: string) => {
    const data = dataFromSseBlock(block);
    if (!data || data === "[DONE]") return;
    try {
      const payload = JSON.parse(data) as { model?: unknown };
      if (typeof payload.model === "string") modelUsed = payload.model;
      emit(openRouterStreamDelta(payload));
    } catch {
      // Keep the connection alive if an upstream comment or malformed event is encountered.
    }
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const blocks = buffer.split(/\r?\n\r?\n/);
      buffer = blocks.pop() ?? "";
      blocks.forEach(consume);
    }
    buffer += decoder.decode();
    if (buffer.trim()) consume(buffer);
    const tail = filter("", true);
    if (tail) {
      pieces.push(tail);
      onDelta(tail);
    }
  } finally {
    reader.releaseLock();
  }

  const content = stripReasoningBlocks(pieces.join(""));
  if (!content) throw new OpenRouterError({ state: "error", badge: statusLabel("PARSE", "error"), category: "PARSE", http: 200, checkedAt: now(), confirmed: "После удаления reasoning-блоков не осталось финального ответа." });
  return { content, modelUsed, label: model.label, status: readyStatus() };
}

export function publicChatError(modelId: string, error: unknown) {
  const status = error instanceof OpenRouterError ? error.status : statusFromFailure(null, error);
  const action = status.category === "AUTH" ? "Проверьте защищённое поле OPENROUTER_API_KEY." : status.category === "QUOTA" ? "Проверьте баланс или лимиты OpenRouter." : status.category === "RATE_LIMIT" ? "Подождите и повторите запрос." : status.category === "MODEL" ? "Выберите другую карточку из статического реестра." : "Повторите попытку позже.";
  return `Провайдер: OpenRouter | Что произошло: ${status.badge} | Почему (подтверждено): ${status.confirmed} | Что делать: ${action}`;
}
