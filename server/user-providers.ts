import { beginCapacityGeneration, settleCapacityReservation, type CapacityActor, type CapacityGenerationLease } from "./capacity-controller";
import { KAIREMA_SYSTEM_PROMPT, dataFromSseBlock, openRouterStreamDelta, sanitizeAssistantContent, type ChatMessage, type ChatSettings, type ModelStatus, type Provider, type StatusCategory } from "./providers";
import { createRequestBudget } from "./providers";
import { UserProviderKeyConfigurationError, UserProviderKeyDecryptionError } from "./user-provider-secrets";

/**
 * A provider the user can attach their own key to.
 *
 * `available: true` means the server implements every operation this screen offers. A
 * provider that is not implemented yet is listed as `available: false` with no endpoints at
 * all, so the client cannot render a control that would pretend to work. The screen shows
 * such a provider as coming soon instead of inventing an API surface.
 */
export type UserProviderDescriptor =
  | {
      id: string;
      displayName: string;
      available: true;
      keyUrl: string;
      keyEndpoint: string;
      modelsEndpoint: string;
      chatEndpoint: string;
    }
  | { id: string; displayName: string; available: false; keyUrl?: string; note: string };

export const USER_PROVIDERS: readonly UserProviderDescriptor[] = [
  {
    id: "openrouter",
    displayName: "OpenRouter",
    available: true,
    keyUrl: "https://openrouter.ai/settings/keys",
    keyEndpoint: "https://openrouter.ai/api/v1/key",
    modelsEndpoint: "https://openrouter.ai/api/v1/models",
    chatEndpoint: "https://openrouter.ai/api/v1/chat/completions",
  },
  { id: "openai", displayName: "OpenAI", available: false, note: "Адаптер ещё не реализован на сервере." },
  { id: "anthropic", displayName: "Anthropic", available: false, note: "Адаптер ещё не реализован на сервере." },
  { id: "google", displayName: "Google", available: false, note: "Адаптер ещё не реализован на сервере." },
] as const;

export class UserProviderError extends Error {
  constructor(
    public readonly category: UserProviderErrorCategory,
    message: string,
    public readonly http: number | null = null,
  ) {
    super(message);
    this.name = "UserProviderError";
  }
}

export class UserProviderNotImplementedError extends Error {
  constructor(displayName: string) {
    super(`${displayName}: этот провайдер пока не поддерживается.`);
    this.name = "UserProviderNotImplementedError";
  }
}

export class UserProviderNotConfiguredError extends Error {
  constructor() {
    super("Режим «Мой API» не настроен. Выберите провайдера, модель и укажите API-ключ в Настройках → AI Providers.");
    this.name = "UserProviderNotConfiguredError";
  }
}

/** A guest row may never own a permanent credential, so My API is refused server-side. */
export class UserProviderGuestNotAllowedError extends Error {
  constructor() {
    super("Режим «Мой API» доступен только после входа в аккаунт: гостевые сессии не могут хранить API-ключи.");
    this.name = "UserProviderGuestNotAllowedError";
  }
}

export type UserProviderErrorCategory =
  | "AUTH"
  | "CREDITS"
  | "RATE_LIMIT"
  | "MODEL"
  | "PROVIDER_UNAVAILABLE"
  | "INVALID_REQUEST"
  | "UNKNOWN";

const USER_CATEGORY: UserProviderErrorCategory = "UNKNOWN";

/** Every user-facing text is a fixed literal. No upstream body, header or URL ever reaches it. */
function classifyUserProviderFailure(http: number | null, upstream: unknown): { category: UserProviderErrorCategory; message: string } {
  const body = JSON.stringify(upstream ?? "").toLowerCase();
  if (http === 401 || http === 403 || /invalid_api_key|invalid api key|incorrect api key|api_key_invalid|permission denied|unauthorized|authentication/.test(body)) {
    return { category: "AUTH", message: "Провайдер отклонил API-ключ. Проверьте ключ и его статус в аккаунте провайдера." };
  }
  if (http === 402 || /insufficient_quota|insufficient credits|credit balance|billing|quota exceeded|not enough balance/.test(body)) {
    return { category: "CREDITS", message: "На счёте провайдера недостаточно средств или квоты. Пополните баланс в аккаунте провайдера." };
  }
  if (http === 429) {
    return { category: "RATE_LIMIT", message: "Провайдер ограничил частоту запросов по вашему ключу. Повторите попытку позже." };
  }
  if (http === 404 || /no endpoints found|model_not_found|model not found|unknown model|not available/.test(body)) {
    return { category: "MODEL", message: "Провайдер не предлагает выбранную модель. Выберите другую модель из списка." };
  }
  // Any server-side upstream status is a provider availability problem, not a user mistake.
  if ((http !== null && http >= 500) || /overloaded|service unavailable|capacity|upstream error/.test(body)) {
    return { category: "PROVIDER_UNAVAILABLE", message: "Провайдер временно недоступен. Повторите попытку позже." };
  }
  if (http === 400 || http === 422) {
    return { category: "INVALID_REQUEST", message: "Провайдер отклонил запрос. Проверьте модель и попробуйте снова." };
  }
  return { category: USER_CATEGORY, message: "Провайдер вернул неожиданный ответ. Повторите попытку позже." };
}

const USER_PROVIDER_TIMEOUT_MS = 25_000;
const KEY_PROBE_TIMEOUT_MS = 12_000;
const CATALOG_TIMEOUT_MS = 15_000;
const MAX_CATALOG_MODELS = 400;

export function listUserProviders(): readonly UserProviderDescriptor[] {
  return USER_PROVIDERS;
}

/** Narrows a client-supplied provider id to a descriptor, rejecting anything unknown. */
export function readyUserProvider(providerId: string): Extract<UserProviderDescriptor, { available: true }> {
  const descriptor = USER_PROVIDERS.find((item) => item.id === providerId);
  if (!descriptor) throw new UserProviderError("INVALID_REQUEST", "Неизвестный провайдер. Выберите провайдера из списка.");
  if (!descriptor.available) throw new UserProviderNotImplementedError(descriptor.displayName);
  return descriptor;
}

function timeoutSignal(signal: AbortSignal | undefined, ms: number) {
  return signal ? AbortSignal.any([signal, AbortSignal.timeout(ms)]) : AbortSignal.timeout(ms);
}

function userProviderHeaders(apiKey: string): Record<string, string> {
  return {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    "HTTP-Referer": "https://kairema.manus.space",
    "X-Title": "Kairema",
  };
}

async function readUpstreamJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function providerNetworkError(error: unknown): UserProviderError {
  if (error instanceof DOMException && error.name === "TimeoutError") {
    return new UserProviderError("PROVIDER_UNAVAILABLE", "Превышено время ожидания ответа провайдера.", null);
  }
  return new UserProviderError("PROVIDER_UNAVAILABLE", "Сетевая ошибка при обращении к провайдеру.", null);
}

export type UserProviderKeyCheck =
  | { ok: true; label: string }
  | { ok: false; category: UserProviderErrorCategory; http: number | null; message: string };

/**
 * Auth/credit probe against the provider's documented key endpoint. It performs no
 * inference, so it never spends the caller's tokens or consumes a generation attempt, and
 * the only thing returned is a classification plus a fixed message.
 */
export async function verifyUserProviderKey(providerId: string, apiKey: string): Promise<UserProviderKeyCheck> {
  const descriptor = readyUserProvider(providerId);
  let response: Response;
  try {
    response = await fetch(descriptor.keyEndpoint, { method: "GET", headers: userProviderHeaders(apiKey), signal: timeoutSignal(undefined, KEY_PROBE_TIMEOUT_MS) });
  } catch (error) {
    const failure = providerNetworkError(error);
    return { ok: false, category: failure.category, http: null, message: failure.message };
  }
  if (!response.ok) {
    const failure = classifyUserProviderFailure(response.status, await readUpstreamJson(response));
    return { ok: false, category: failure.category, http: response.status, message: failure.message };
  }
  const body = (await readUpstreamJson(response)) as { label?: unknown } | null;
  const label = typeof body?.label === "string" ? body.label.slice(0, 80) : "";
  return { ok: true, label };
}

export type UserProviderModel = { id: string; name: string };

type CatalogEntry = { id?: unknown; name?: unknown; architecture?: { modality?: { input?: unknown } } };

/**
 * Reads the provider's live catalog. Nothing is hardcoded: the list a user picks from is
 * whatever the provider returns right now. Non-text models are dropped because the chat
 * screen only sends text, and the result is bounded so one response cannot flood the client.
 */
export async function listUserProviderModels(providerId: string, apiKey: string): Promise<UserProviderModel[]> {
  const descriptor = readyUserProvider(providerId);
  let response: Response;
  try {
    response = await fetch(descriptor.modelsEndpoint, { method: "GET", headers: userProviderHeaders(apiKey), signal: timeoutSignal(undefined, CATALOG_TIMEOUT_MS) });
  } catch (error) {
    throw providerNetworkError(error);
  }
  if (!response.ok) {
    const failure = classifyUserProviderFailure(response.status, await readUpstreamJson(response));
    throw new UserProviderError(failure.category, failure.message, response.status);
  }
  const body = (await readUpstreamJson(response)) as { data?: CatalogEntry[] } | null;
  const entries = Array.isArray(body?.data) ? body.data : [];
  const seen = new Set<string>();
  const models: UserProviderModel[] = [];
  for (const entry of entries) {
    if (typeof entry?.id !== "string" || typeof entry.name !== "string") continue;
    const modality = entry.architecture?.modality?.input;
    if (typeof modality === "string" && !modality.split(",").some((value) => value.trim() === "text")) continue;
    if (seen.has(entry.id)) continue;
    seen.add(entry.id);
    models.push({ id: entry.id, name: entry.name.slice(0, 120) });
    if (models.length >= MAX_CATALOG_MODELS) break;
  }
  return models;
}

type ApiChatMessage = { role: "system" | "user" | "assistant"; content: string | Array<{ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } }> };

/**
 * The same Kairema system prompt the platform roles use, with the user's own model named in
 * place of the role label. Role capability text is deliberately absent: the user selected a
 * raw model, so promising "Flash" or "Apex" behaviour would misrepresent what was chosen.
 */
function buildUserProviderMessages(modelLabel: string, history: ChatMessage[]): ApiChatMessage[] {
  const system = KAIREMA_SYSTEM_PROMPT.replace("{модель}", modelLabel);
  return [{ role: "system", content: system }, ...history.map((message) => ({ role: message.role, content: message.content }))];
}

export type UserProviderStreamResult = {
  content: string;
  modelUsed: string;
  provider: Provider;
  fallbackUsed: false;
  label: string;
  status: ModelStatus;
};

/**
 * Runs one user-selected model with the caller's own key.
 *
 * There is deliberately no chain here: no second candidate, no retry and no system
 * provider. A failure is reported to the caller as a classified error instead of being
 * absorbed, because silently answering from a different provider than the one the user
 * chose and paid for would misrepresent both the answer and the bill.
 *
 * Capacity is not bypassed. The request opens the same generation lease as the platform path
 * and spends the same bounded four-attempt budget, so BYOK can neither exceed the global
 * limit nor run unbudgeted. The reserved target is the real upstream provider, which is
 * where this generation actually lands.
 */
export async function chatWithUserProviderStream(options: {
  provider: string;
  model: string;
  modelLabel: string;
  apiKey: string;
  history: ChatMessage[];
  settings?: ChatSettings;
  roleId: "fast" | "smart" | "context" | "flagship";
  onDelta: (delta: string) => void;
  signal?: AbortSignal;
  actor?: CapacityActor;
}): Promise<UserProviderStreamResult> {
  const descriptor = readyUserProvider(options.provider);
  const capacityLease: CapacityGenerationLease | null = options.actor
    ? await beginCapacityGeneration(options.actor, options.roleId, options.settings ?? {})
    : null;
  const budget = createRequestBudget(capacityLease ?? undefined);
  let reservation: Awaited<ReturnType<CapacityGenerationLease["reserveAttempt"]>> | null = null;
  const startedAt = Date.now();
  const attemptIndex = 1;
  // The attempt budget is spent immediately before the single real fetch, mirroring the
  // platform path so a denied reservation can never reach a provider.
  budget.remaining -= 1;
  budget.used = 1;
  try {
    if (capacityLease) {
      reservation = await capacityLease.reserveAttempt({ provider: "openrouter" as Provider, modelId: options.model }, attemptIndex);
    }
    logByok("byok.invoke_start", { requestId: budget.requestId, attemptIndex, provider: descriptor.id, model: options.model, budgetRemaining: budget.remaining });
    let response: Response;
    try {
      response = await fetch(descriptor.chatEndpoint, {
        method: "POST",
        headers: { ...userProviderHeaders(options.apiKey), Accept: "text/event-stream" },
        body: JSON.stringify({ model: options.model, messages: buildUserProviderMessages(options.modelLabel, options.history), stream: true }),
        signal: timeoutSignal(options.signal, USER_PROVIDER_TIMEOUT_MS),
      });
    } catch (error) {
      if (reservation) await settleCapacityReservation(reservation, "settled").catch(() => undefined);
      if (options.signal?.aborted) throw error;
      throw providerNetworkError(error);
    }
    logByok("byok.invoke_response", { requestId: budget.requestId, provider: descriptor.id, model: options.model, httpStatus: response.status, latencyMs: Date.now() - startedAt });
    if (!response.ok) {
      const failure = classifyUserProviderFailure(response.status, await readUpstreamJson(response));
      logByok("byok.invoke_error", { requestId: budget.requestId, provider: descriptor.id, model: options.model, httpStatus: response.status, errorCategory: failure.category });
      throw new UserProviderError(failure.category, failure.message, response.status);
    }
    const reader = response.body?.getReader();
    if (!reader) throw new UserProviderError("UNKNOWN", "Провайдер не открыл поток ответа.", response.status);
    const decoder = new TextDecoder();
    const parts: string[] = [];
    let buffer = "";
    const consume = (block: string) => {
      const raw = dataFromSseBlock(block);
      if (!raw || raw === "[DONE]") return;
      try {
        const delta = sanitizeAssistantContent(openRouterStreamDelta(JSON.parse(raw)));
        if (delta) { parts.push(delta); options.onDelta(delta); }
      } catch {
        // Upstream keep-alive comments and non-delta frames are ignorable.
      }
    };
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const blocks = buffer.split(/\r?\n\r?\n/);
        buffer = blocks.pop() ?? "";
        for (const block of blocks) consume(block);
      }
      buffer += decoder.decode();
      if (buffer.trim()) consume(buffer);
    } finally {
      reader.releaseLock();
    }
    const content = sanitizeAssistantContent(parts.join(""));
    if (!content) throw new UserProviderError("UNKNOWN", "Провайдер вернул пустой ответ. Повторите попытку.", response.status);
    logByok("byok.invoke_succeeded", { requestId: budget.requestId, provider: descriptor.id, model: options.model, latencyMs: Date.now() - startedAt });
    return { content, modelUsed: options.modelLabel, provider: "openrouter", fallbackUsed: false, label: options.modelLabel, status: byokReadyStatus() };
  } finally {
    // After a fetch begins the provider may charge even an errored response, so the
    // reservation is settled conservatively; only a pre-fetch denial creates nothing.
    if (reservation) await settleCapacityReservation(reservation, "settled").catch(() => undefined);
    capacityLease?.release();
  }
}

function byokReadyStatus(): ModelStatus {
  const now = new Date().toISOString();
  return { state: "ready", badge: "Готов", category: null, http: 200, checkedAt: now, confirmed: "Ответ получен от провайдера, выбранного пользователем." };
}

/**
 * The only BYOK log line. It carries identifiers and verdicts only — never the key, a
 * header, a prompt, a response or any upstream payload.
 */
function logByok(event: string, fields: Record<string, string | number | boolean | null>) {
  console.info("[Kairema BYOK]", JSON.stringify({ event, ...fields }));
}

/** The single text an ordinary user sees for a failed My API request. */
export function publicUserProviderError(error: unknown): string {
  if (error instanceof UserProviderNotConfiguredError) return `Что произошло: «Мой API» не настроен | Что делать: откройте Настройки → AI Providers, выберите провайдера, модель и сохраните API-ключ.`;
  if (error instanceof UserProviderGuestNotAllowedError) return `Что произошло: «Мой API» недоступен для гостевой сессии | Что делать: войдите в аккаунт и настройте провайдера в Настройках → AI Providers.`;
  if (error instanceof UserProviderKeyDecryptionError) return `Что произошло: сохранённый API-ключ не удалось расшифровать | Что делать: сохраните ключ заново в Настройках → AI Providers.`;
  if (error instanceof UserProviderKeyConfigurationError) return `Что произошло: на сервере не настроено шифрование пользовательских API-ключей | Что делать: обратитесь к администратору сервиса.`;
  if (error instanceof UserProviderError) {
    const category: StatusCategory = error.category === "CREDITS" ? "QUOTA" : error.category as StatusCategory;
    const action = error.category === "RATE_LIMIT" || error.category === "CREDITS" ? "Повторите запрос позже." : error.category === "AUTH" || error.category === "MODEL" ? "Проверьте настройки в Настройках → AI Providers." : "Повторите попытку позже.";
    return `Что произошло: Провайдер ИИ ответил ошибкой (${category}) | Почему: ${error.message} | Что делать: ${action}`;
  }
  if (error instanceof Error) return `Что произошло: Провайдер ИИ ответил ошибкой | Что делать: Повторите попытку позже.`;
  return `Что произошло: Провайдер ИИ ответил ошибкой | Что делать: Повторите попытку позже.`;
}
