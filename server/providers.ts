export const ROLE_IDS = ["fast", "smart", "context", "flagship", "code"] as const;
/** Compatibility alias: clients select a role, not a raw model. */
export const MODEL_IDS = ROLE_IDS;
export type RoleId = (typeof ROLE_IDS)[number];
export type ModelId = RoleId;
export type ModelKey = RoleId;
export type Provider = "openrouter" | "google" | "groq";
export type StatusCategory = "AUTH" | "QUOTA" | "RATE_LIMIT" | "PROVIDER_UNAVAILABLE" | "ENDPOINT" | "MODEL" | "NETWORK" | "TIMEOUT" | "PARSE" | "CONFIG" | "UNKNOWN";
export type ModelStatus = { state: "ready" | "fallback" | "loading" | "error" | "unavailable" | "not_configured"; badge: string; category: StatusCategory | null; http: number | null; checkedAt: string; confirmed: string };
export type ChatMessage = { role: "user" | "assistant"; content: string };
export type ChatSettings = { style?: "default" | "professional" | "friendly" | "concise" | "steps" };
export type ChainAttempt = { provider: Provider; modelId: string; status: "ready" | "skipped" | "failed"; category?: StatusCategory; http?: number | null };
export type ChatResult = { content: string; modelUsed: string; provider: Provider; fallbackUsed: boolean; chainTried: ChainAttempt[]; label: string; status: ModelStatus };

type Candidate = { provider: Provider; modelId: string; displayName: string };
export type ModelConfig = { key: RoleId; modelId: RoleId; label: string; role: string; chain: readonly Candidate[] };
export type ModelView = Pick<ModelConfig, "key" | "modelId" | "label" | "role"> & { status: ModelStatus };

/** Exactly five visible roles; chains and exact models stay server-side. */
export const MODEL_ROLES: readonly ModelConfig[] = [
  { key: "fast", modelId: "fast", label: "Kairema Быстрый", role: "Короткие повседневные ответы без ожидания.", chain: [
    { provider: "groq", modelId: "openai/gpt-oss-20b", displayName: "GPT-OSS 20B" },
    { provider: "openrouter", modelId: "openai/gpt-oss-20b:free", displayName: "GPT-OSS 20B Free" },
    { provider: "openrouter", modelId: "nvidia/nemotron-3-super-120b-a12b:free", displayName: "Nemotron 3 Super" },
    { provider: "google", modelId: "gemini-2.5-flash", displayName: "Gemini 2.5 Flash" },
  ] },
  { key: "smart", modelId: "smart", label: "Kairema Смекалистый", role: "Логика, рассуждения и сложные задачи среднего объёма.", chain: [
    { provider: "google", modelId: "gemini-2.5-flash", displayName: "Gemini 2.5 Flash" },
    { provider: "openrouter", modelId: "google/gemma-4-26b-a4b-it:free", displayName: "Gemma 4 26B" },
    { provider: "openrouter", modelId: "nvidia/nemotron-3-super-120b-a12b:free", displayName: "Nemotron 3 Super" },
    { provider: "groq", modelId: "openai/gpt-oss-120b", displayName: "GPT-OSS 120B" },
  ] },
  { key: "context", modelId: "context", label: "Kairema Контекст", role: "Длинные документы, большие фрагменты текста и связный контекст.", chain: [
    { provider: "openrouter", modelId: "dots-studio/dots-3-note-preview:free", displayName: "Dots3 Note" },
    { provider: "google", modelId: "gemini-3.7-flash", displayName: "Gemini 3.7 Flash" },
    { provider: "openrouter", modelId: "google/gemma-4-31b-it:free", displayName: "Gemma 4 31B" },
  ] },
  { key: "flagship", modelId: "flagship", label: "Kairema Флагман", role: "Самые требовательные задачи, глубокий анализ и комплексные ответы.", chain: [
    { provider: "openrouter", modelId: "nvidia/nemotron-3-ultra-550b-a55b:free", displayName: "Nemotron 3 Ultra" },
    { provider: "openrouter", modelId: "google/gemma-4-31b-it:free", displayName: "Gemma 4 31B" },
    { provider: "google", modelId: "gemini-3.7-flash", displayName: "Gemini 3.7 Flash" },
    { provider: "groq", modelId: "openai/gpt-oss-120b", displayName: "GPT-OSS 120B" },
  ] },
  { key: "code", modelId: "code", label: "Kairema Код", role: "Генерация, рефакторинг, разбор и отладка программного кода.", chain: [
    { provider: "openrouter", modelId: "cohere/north-mini-code:free", displayName: "North Mini Code" },
    { provider: "groq", modelId: "qwen/qwen3.6-27b", displayName: "Qwen 3.6 27B" },
    { provider: "openrouter", modelId: "openai/gpt-oss-20b:free", displayName: "GPT-OSS 20B Free" },
  ] },
] as const;
export const MODEL_CONFIG = MODEL_ROLES;

const ENDPOINTS: Record<Provider, string> = {
  openrouter: "https://openrouter.ai/api/v1/chat/completions",
  google: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
  groq: "https://api.groq.com/openai/v1/chat/completions",
};
const MAX_ATTEMPTS = 4;
/** Every provider attempt has the same bounded latency budget, including SSE. */
export const ATTEMPT_TIMEOUT_MS = 25_000;
const HEALTH_TTL_MS = 60_000;
const blockedProviders = new Map<Provider, string>();
let healthCache: { checkedAt: number; values: Map<RoleId, ModelStatus> } | null = null;
const now = () => new Date().toISOString();
const currentDay = () => now().slice(0, 10);

export const KAIREMA_SYSTEM_PROMPT = `Ты Kairema, AI-ассистент. Не притворяйся человеком. Не указывай пол; если грамматически нужен род, используй мужской. Не начинай каждый ответ шаблонным приветствием. Отвечай по-русски, если пользователь не попросил иначе. На простой вопрос отвечай просто, на сложный — подробно и структурированно. На вопрос «кто ты» отвечай кратко: «Я Kairema, AI-ассистент. Сейчас работаю на {модель}». Не выдумывай факты и прямо признавай нехватку информации.`;

function secretFor(provider: Provider) {
  return process.env[provider === "openrouter" ? "OPENROUTER_API_KEY" : provider === "google" ? "GEMINI_API_KEY" : "GROQ_API_KEY"]?.trim();
}
function configured(provider: Provider) { return Boolean(secretFor(provider)); }
function disabled(provider: Provider) { return blockedProviders.get(provider) === currentDay(); }
function disabledToday(provider: Provider) { blockedProviders.set(provider, currentDay()); }

export function statusLabel(category: StatusCategory | null, state: ModelStatus["state"]) {
  if (state === "ready") return "Готов";
  if (state === "fallback") return "Резерв активен";
  if (state === "loading") return "Проверка…";
  if (state === "not_configured" || category === "AUTH") return "Не настроено";
  return "Недоступно";
}
export function classifyOpenRouterFailure(http: number | null, upstream: unknown): { category: StatusCategory; confirmed: string; state: ModelStatus["state"] } {
  const body = JSON.stringify(upstream ?? {}).toLowerCase();
  if (http === 401 || http === 403 || /invalid_api_key|api_key_invalid|invalid api key|incorrect api key/.test(body)) return { category: "AUTH", confirmed: "Провайдер отклонил серверную авторизацию.", state: "error" };
  if (http === 429 && /quota|credit|balance|budget|exhaust/.test(body)) return { category: "QUOTA", confirmed: "Подтверждена нехватка квоты или бюджета провайдера.", state: "error" };
  if (http === 429) return { category: "RATE_LIMIT", confirmed: "Подтверждено ограничение частоты запросов.", state: "error" };
  if (http === 503 || /load|capacity|overload|unavailable|busy/.test(body)) return { category: "PROVIDER_UNAVAILABLE", confirmed: "Провайдер временно недоступен из-за нагрузки.", state: "unavailable" };
  if (http === 400 || http === 404) return { category: /model/.test(body) ? "MODEL" : "ENDPOINT", confirmed: "Провайдер отклонил модель или endpoint.", state: "error" };
  return { category: "UNKNOWN", confirmed: "Причина пока не установлена.", state: "error" };
}
export function stripReasoningBlocks(value: string) { return value.replace(/<think(?:\s[^>]*)?>[\s\S]*?<\/think>/gi, "").replace(/<reasoning(?:\s[^>]*)?>[\s\S]*?<\/reasoning>/gi, "").replace(/<thought(?:\s[^>]*)?>[\s\S]*?<\/thought>/gi, "").trim(); }

function failure(http: number | null, body: unknown): ModelStatus {
  const item = classifyOpenRouterFailure(http, body);
  return { state: item.state, badge: statusLabel(item.category, item.state), category: item.category, http, checkedAt: now(), confirmed: item.confirmed };
}
function ready(message = "Основная модель роли ответила на краткий тест."): ModelStatus { return { state: "ready", badge: "Готов", category: null, http: 200, checkedAt: now(), confirmed: message }; }
function backup(message: string): ModelStatus { return { state: "fallback", badge: "Резерв активен", category: null, http: 200, checkedAt: now(), confirmed: message }; }
function unconfigured(): ModelStatus { return { state: "not_configured", badge: "Не настроено", category: "CONFIG", http: null, checkedAt: now(), confirmed: "Для этой роли нет настроенного доступного провайдера." }; }
function network(error: unknown): ModelStatus { const category: StatusCategory = error instanceof DOMException && error.name === "TimeoutError" ? "TIMEOUT" : "NETWORK"; return { state: "error", badge: statusLabel(category, "error"), category, http: null, checkedAt: now(), confirmed: category === "TIMEOUT" ? "Превышено время ожидания ответа провайдера." : "Сетевая ошибка при обращении к провайдеру." }; }

export class OpenRouterError extends Error { constructor(public readonly status: ModelStatus) { super(status.confirmed); this.name = "OpenRouterError"; } }
function prompt(role: ModelConfig, settings?: ChatSettings) {
  const style = settings?.style === "concise" ? "Отвечай особенно кратко." : settings?.style === "steps" ? "Разбивай решение на понятные шаги." : settings?.style === "professional" ? "Сохраняй профессиональный, ясный тон." : settings?.style === "friendly" ? "Сохраняй доброжелательный естественный тон." : "";
  return `${KAIREMA_SYSTEM_PROMPT.replace("{модель}", role.label)} ${style}`.trim();
}
export function buildOpenRouterMessages(role: ModelConfig, history: ChatMessage[], settings?: ChatSettings) { return [{ role: "system" as const, content: prompt(role, settings) }, ...history]; }
function timeoutSignal(signal: AbortSignal | undefined, ms: number) { return signal ? AbortSignal.any([signal, AbortSignal.timeout(ms)]) : AbortSignal.timeout(ms); }
async function invoke(candidate: Candidate, role: ModelConfig, history: ChatMessage[], settings: ChatSettings | undefined, stream: boolean, signal?: AbortSignal) {
  const key = secretFor(candidate.provider);
  if (!key || disabled(candidate.provider)) throw new OpenRouterError(unconfigured());
  const headers: Record<string, string> = { Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
  if (stream) headers.Accept = "text/event-stream";
  if (candidate.provider === "openrouter") { headers["HTTP-Referer"] = "https://kairema.manus.space"; headers["X-Title"] = "Kairema"; }
  let response: Response;
  try { response = await fetch(ENDPOINTS[candidate.provider], { method: "POST", headers, body: JSON.stringify({ model: candidate.modelId, messages: buildOpenRouterMessages(role, history, settings), stream }), signal: timeoutSignal(signal, ATTEMPT_TIMEOUT_MS) }); }
  catch (error) { if (signal?.aborted) throw error; throw new OpenRouterError(network(error)); }
  if (!response.ok) {
    let body: unknown = null; try { body = await response.json(); } catch { body = { message: await response.text().catch(() => "") }; }
    const status = failure(response.status, body); if (status.category === "AUTH") disabledToday(candidate.provider); throw new OpenRouterError(status);
  }
  return response;
}
function retryable(status: ModelStatus) { return ["RATE_LIMIT", "QUOTA", "PROVIDER_UNAVAILABLE", "NETWORK", "TIMEOUT", "AUTH", "MODEL", "ENDPOINT"].includes(status.category ?? ""); }
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
function attempt(candidate: Candidate, status: ChainAttempt["status"], error?: ModelStatus): ChainAttempt { return { provider: candidate.provider, modelId: candidate.modelId, status, ...(error ? { category: error.category ?? undefined, http: error.http } : {}) }; }

export function roleById(roleId: string): ModelConfig | undefined { return MODEL_ROLES.find((item) => item.key === roleId); }
export function modelById(modelId: string): ModelConfig | undefined { return roleById(modelId); }
export function toPublicModelView(config: ModelConfig, status: ModelStatus): ModelView { return { key: config.key, modelId: config.modelId, label: config.label, role: config.role, status }; }
export function selectAutoModel(views: readonly ModelView[]): ModelConfig | undefined { const view = views.find((item) => item.status.state === "ready" || item.status.state === "fallback"); return view ? roleById(view.key) : undefined; }

async function roleHealth(role: ModelConfig) {
  let last: ModelStatus | null = null; let hasCandidate = false;
  const candidates = role.chain.slice(0, MAX_ATTEMPTS);
  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index]!;
    if (!configured(candidate.provider) || disabled(candidate.provider)) continue;
    hasCandidate = true;
    try {
      const response = await invoke(candidate, role, [{ role: "user", content: "Ответь ровно одним словом: Готово" }], undefined, false);
      const data = await response.json() as { choices?: Array<{ message?: { content?: unknown } }> };
      if (!stripReasoningBlocks(String(data.choices?.[0]?.message?.content ?? ""))) throw new OpenRouterError(failure(200, { message: "empty response" }));
      return index === 0 ? ready() : backup(`Основная модель недоступна; отвечает резерв ${candidate.displayName}.`);
    } catch (error) { last = error instanceof OpenRouterError ? error.status : network(error); if (last.category === "RATE_LIMIT") await pause(250); if (!retryable(last)) break; }
  }
  return hasCandidate ? (last ?? { ...unconfigured(), state: "unavailable", badge: "Недоступно" }) : unconfigured();
}
export async function getModelViews() {
  if (!healthCache || Date.now() - healthCache.checkedAt > HEALTH_TTL_MS) {
    const values = new Map<RoleId, ModelStatus>();
    for (const role of MODEL_ROLES) { values.set(role.key, await roleHealth(role)); await pause(350); }
    healthCache = { checkedAt: Date.now(), values };
  }
  return MODEL_ROLES.map((role) => toPublicModelView(role, healthCache!.values.get(role.key) ?? unconfigured()));
}

export function dataFromSseBlock(block: string) { return block.split(/\r?\n/).filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trimStart()).join("\n"); }
export function openRouterStreamDelta(payload: unknown) { const content = (payload as { choices?: Array<{ delta?: { content?: unknown } }> })?.choices?.[0]?.delta?.content; return typeof content === "string" ? content : ""; }
export function createReasoningStreamFilter() {
  let pending = ""; let hidden: string | null = null;
  return (chunk: string, final = false) => {
    pending += chunk; let output = "";
    while (pending) {
      if (hidden) { const close = pending.match(new RegExp(`</${hidden}\\s*>`, "i")); if (close?.index !== undefined) { pending = pending.slice(close.index + close[0].length); hidden = null; continue; } if (final) pending = ""; else { const tail = pending.lastIndexOf("<"); pending = tail >= 0 ? pending.slice(tail) : ""; } break; }
      const opening = pending.match(/<(think|reasoning|thought)(?:\s[^>]*)?>/i);
      if (opening?.index !== undefined) { output += pending.slice(0, opening.index); pending = pending.slice(opening.index + opening[0].length); hidden = opening[1]!.toLowerCase(); continue; }
      if (final) { output += pending; pending = ""; } else { const tail = pending.lastIndexOf("<"); if (tail >= 0 && pending.length - tail < 24) { output += pending.slice(0, tail); pending = pending.slice(tail); } else { output += pending; pending = ""; } } break;
    }
    return output;
  };
}
export function statusFromChatPayload(payload: unknown): ModelStatus { const raw = (payload as { choices?: Array<{ message?: { content?: unknown } }> })?.choices?.[0]?.message?.content; return stripReasoningBlocks(typeof raw === "string" ? raw : "") ? ready() : failure(200, { message: "empty response" }); }

function contentFrom(data: unknown) {
  const raw = (data as { choices?: Array<{ message?: { content?: unknown } }> })?.choices?.[0]?.message?.content;
  const content = stripReasoningBlocks(typeof raw === "string" ? raw : "");
  if (!content) throw new OpenRouterError({ state: "error", badge: "Недоступно", category: "PARSE", http: 200, checkedAt: now(), confirmed: "После удаления reasoning-блоков не осталось финального ответа." });
  return content;
}
export async function chatWithRole(roleId: string, history: ChatMessage[], settings?: ChatSettings): Promise<ChatResult> {
  const role = roleById(roleId); if (!role) throw new OpenRouterError({ state: "error", badge: "Недоступно", category: "MODEL", http: null, checkedAt: now(), confirmed: "Выбрана неизвестная роль Kairema." });
  const chainTried: ChainAttempt[] = []; let last: OpenRouterError | null = null;
  const candidates = role.chain.slice(0, MAX_ATTEMPTS);
  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index]!;
    if (!configured(candidate.provider) || disabled(candidate.provider)) { chainTried.push(attempt(candidate, "skipped")); continue; }
    try { const response = await invoke(candidate, role, history, settings, false); const content = contentFrom(await response.json()); chainTried.push(attempt(candidate, "ready")); return { content, modelUsed: candidate.displayName, provider: candidate.provider, fallbackUsed: index > 0, chainTried, label: role.label, status: index > 0 ? backup(`Ответил резерв ${candidate.displayName}.`) : ready() }; }
    catch (error) { const status = error instanceof OpenRouterError ? error.status : network(error); last = error instanceof OpenRouterError ? error : new OpenRouterError(status); chainTried.push(attempt(candidate, "failed", status)); if (status.category === "RATE_LIMIT") await pause(300); if (!retryable(status)) break; }
  }
  throw last ?? new OpenRouterError(unconfigured());
}
export async function chatWithRoleStream(roleId: string, history: ChatMessage[], settings: ChatSettings | undefined, onDelta: (delta: string) => void, signal?: AbortSignal): Promise<ChatResult> {
  const role = roleById(roleId); if (!role) throw new OpenRouterError({ state: "error", badge: "Недоступно", category: "MODEL", http: null, checkedAt: now(), confirmed: "Выбрана неизвестная роль Kairema." });
  const chainTried: ChainAttempt[] = []; let last: OpenRouterError | null = null;
  const candidates = role.chain.slice(0, MAX_ATTEMPTS);
  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index]!;
    if (!configured(candidate.provider) || disabled(candidate.provider)) { chainTried.push(attempt(candidate, "skipped")); continue; }
    let visibleDeltaDelivered = false;
    try {
      const response = await invoke(candidate, role, history, settings, true, signal); const reader = response.body?.getReader(); if (!reader) throw new OpenRouterError({ state: "error", badge: "Недоступно", category: "PARSE", http: 200, checkedAt: now(), confirmed: "Провайдер не открыл поток ответа." });
      const decoder = new TextDecoder(); const filter = createReasoningStreamFilter(); const parts: string[] = []; let buffer = "";
      const consume = (block: string) => { const raw = dataFromSseBlock(block); if (!raw || raw === "[DONE]") return; try { const visible = filter(openRouterStreamDelta(JSON.parse(raw))); if (visible) { visibleDeltaDelivered = true; parts.push(visible); onDelta(visible); } } catch { /* upstream comments are ignorable */ } };
      try { while (true) { const { done, value } = await reader.read(); if (done) break; buffer += decoder.decode(value, { stream: true }); const blocks = buffer.split(/\r?\n\r?\n/); buffer = blocks.pop() ?? ""; blocks.forEach(consume); } buffer += decoder.decode(); if (buffer.trim()) consume(buffer); const tail = filter("", true); if (tail) { parts.push(tail); onDelta(tail); } } finally { reader.releaseLock(); }
      const content = stripReasoningBlocks(parts.join("")); if (!content) throw new OpenRouterError({ state: "error", badge: "Недоступно", category: "PARSE", http: 200, checkedAt: now(), confirmed: "После удаления reasoning-блоков не осталось финального ответа." });
      chainTried.push(attempt(candidate, "ready")); return { content, modelUsed: candidate.displayName, provider: candidate.provider, fallbackUsed: index > 0, chainTried, label: role.label, status: index > 0 ? backup(`Ответил резерв ${candidate.displayName}.`) : ready() };
    } catch (error) { if (signal?.aborted || visibleDeltaDelivered) throw error; const status = error instanceof OpenRouterError ? error.status : network(error); last = error instanceof OpenRouterError ? error : new OpenRouterError(status); chainTried.push(attempt(candidate, "failed", status)); if (status.category === "RATE_LIMIT") await pause(300); if (!retryable(status)) break; }
  }
  throw last ?? new OpenRouterError(unconfigured());
}
export const chatWithOpenRouter = chatWithRole;
export const chatWithOpenRouterStream = chatWithRoleStream;
export function publicChatError(_roleId: string, error: unknown) { const status = error instanceof OpenRouterError ? error.status : network(error); const action = status.category === "RATE_LIMIT" || status.category === "QUOTA" ? "Роль перейдёт к резерву; повторите запрос позже." : "Повторите попытку позже."; return `Что произошло: ${status.badge} | Почему: ${status.confirmed} | Что делать: ${action}`; }
