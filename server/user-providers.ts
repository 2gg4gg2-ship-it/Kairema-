import { beginCapacityGeneration, settleCapacityReservation, type CapacityActor, type CapacityGenerationLease } from "./capacity-controller";
import { KAIREMA_SYSTEM_PROMPT, createReasoningStreamFilter, dataFromSseBlock, openRouterStreamDelta, sanitizeAssistantContent, userPreferenceRules, type ChatMessage, type ChatSettings, type ModelStatus, type Provider, type StatusCategory } from "./providers";
import { createRequestBudget } from "./providers";
import { keyFingerprint, parseRetryAfter, retryUpstream } from "./upstream-retry";
import { classifyProviderFailure, type ProviderFailure } from "@shared/provider-failures";
import { UserProviderKeyConfigurationError, UserProviderKeyDecryptionError } from "./user-provider-secrets";
import { MAX_PROVIDER_NAME_LENGTH, UserProviderEndpointError, buildUserProviderChatEndpoint, buildUserProviderModelsEndpoint, normalizeUserProviderDisplayName } from "./user-provider-endpoints";

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
  // Anthropic is completed by the server, like every other provider here. Its API *can* answer a
  // direct browser call when the caller opts in with `anthropic-dangerous-direct-browser-access`,
  // but that opt-in is per-organization and CORS is frequently disabled, so it is not a capability
  // this product can promise. See `shared/provider-capabilities.ts` for what is actually verified.
  {
    id: "anthropic",
    displayName: "Anthropic",
    available: true,
    keyUrl: "https://console.anthropic.com/settings/keys",
    keyEndpoint: "https://api.anthropic.com/v1/models",
    modelsEndpoint: "https://api.anthropic.com/v1/models",
    chatEndpoint: "https://api.anthropic.com/v1/messages",
  },
  { id: "openai", displayName: "OpenAI", available: false, note: "Адаптер ещё не реализован на сервере." },
  { id: "google", displayName: "Google", available: false, note: "Адаптер ещё не реализован на сервере." },
] as const;

/** Providers the server can serve a completion for. Everything else is unimplemented or unknown. */
export function isSupportedUserProvider(provider: string): boolean {
  return USER_PROVIDERS.some((entry) => entry.id === provider && entry.available);
}

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

/** The user's own provider is addressed by a row id, never by a name the UI can choose freely. */
export const CUSTOM_PROVIDER_PREFIX = "custom-";

/** Generates a storage-safe id for a new user-defined provider. */
export function newCustomUserProviderId(): string {
  return `${CUSTOM_PROVIDER_PREFIX}${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`;
}

export function isCustomUserProviderId(providerId: string): boolean {
  return providerId.startsWith(CUSTOM_PROVIDER_PREFIX);
}

/**
 * Everything the HTTP layer needs to talk to one provider, already validated.
 *
 * A built-in descriptor contributes code-owned endpoints; a custom provider contributes the ones
 * its owner saved, which passed the endpoint layer at save time. Callers cannot hand an
 * unvalidated URL in here, so no request is ever issued to a value that skipped the SSRF gate.
 */
export type UserProviderTarget = {
  id: string;
  displayName: string;
  isCustom: boolean;
  /** Where the user obtains a key, shown as a link; absent for a custom provider. */
  keyUrl: string | null;
  /** A cheap auth/credit probe that performs no inference. Null means "probe the catalog". */
  keyProbeEndpoint: string | null;
  modelsEndpoint: string;
  chatEndpoint: string;
};

/** Wraps a built-in descriptor in the shape the HTTP layer consumes. */
export function builtInUserProviderTarget(descriptor: Extract<UserProviderDescriptor, { available: true }>): UserProviderTarget {
  return {
    id: descriptor.id,
    displayName: descriptor.displayName,
    isCustom: false,
    keyUrl: descriptor.keyUrl,
    keyProbeEndpoint: descriptor.keyEndpoint,
    modelsEndpoint: descriptor.modelsEndpoint,
    chatEndpoint: descriptor.chatEndpoint,
  };
}

/**
 * Builds the target for a provider the user defined, validating the URL at this moment.
 *
 * A custom provider is treated as an OpenAI-compatible API: the chat route is derived from the
 * base URL and the catalog from its `/models` sibling, unless an explicit catalog URL was given.
 */
export function customUserProviderTarget(input: { id: string; displayName: string; baseUrl: string; modelsEndpoint?: string | null }): UserProviderTarget {
  const displayName = normalizeUserProviderDisplayName(input.displayName);
  if (displayName.length > MAX_PROVIDER_NAME_LENGTH) throw new UserProviderEndpointError(`Название провайдера не должно превышать ${MAX_PROVIDER_NAME_LENGTH} символов.`);
  const chatEndpoint = buildUserProviderChatEndpoint(input.baseUrl);
  const modelsEndpoint = buildUserProviderModelsEndpoint(input.baseUrl, input.modelsEndpoint);
  return { id: input.id, displayName, isCustom: true, keyUrl: null, keyProbeEndpoint: null, modelsEndpoint: modelsEndpoint.toString(), chatEndpoint: chatEndpoint.toString() };
}

/** Accepts either a built-in id or an already-validated target. */
export type UserProviderSelector = string | UserProviderTarget;

function toTarget(selector: UserProviderSelector): UserProviderTarget {
  if (typeof selector !== "string") return selector;
  return builtInUserProviderTarget(readyUserProvider(selector));
}

export class UserProviderNotConfiguredError extends Error {
  constructor() {
    super("Режим «Мой API» не настроен. Выберите провайдера, модель и укажите API-ключ в Настройках → AI Providers.");
    this.name = "UserProviderNotConfiguredError";
  }
}

/**
 * Every provider the client asked to skip is unavailable, so this server has nothing left to try.
 *
 * Raised when a browser-direct turn failed and handed over with the provider it already tried
 * marked as skipped, and no other connected provider remains. It is deliberately its own error
 * rather than a generic failure so the client can enter the unavailable state instead of showing
 * a message about a provider the user never selected.
 */
export class UserProviderSkipRequestedError extends Error {
  constructor() {
    super("Все подключённые провайдеры уже были попробованы для этого запроса.");
    this.name = "UserProviderSkipRequestedError";
  }
}

/** A guest row may never own a permanent credential, so My API is refused server-side. */export class UserProviderGuestNotAllowedError extends Error {
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

/**
 * Every user-facing text is a fixed literal. No upstream body, header or URL ever reaches it.
 *
 * The user-facing wording stays local, because these strings are what users already see. The
 * *decision* — what kind of failure this is, and whether spending another attempt could change it
 * — is delegated to the shared classifier, so the browser-direct path and this one cannot drift
 * apart on what a 429 or a 503 means.
 */
function classifyUserProviderFailure(http: number | null, upstream: unknown): { category: UserProviderErrorCategory; message: string; shared: ProviderFailure } {
  const shared = classifyProviderFailure({ http, body: upstream });
  const body = JSON.stringify(upstream ?? "").toLowerCase();
  if (http === 401 || http === 403 || /invalid_api_key|invalid api key|incorrect api key|api_key_invalid|permission denied|unauthorized|authentication/.test(body)) {
    return { shared, category: "AUTH", message: "Провайдер отклонил API-ключ. Проверьте ключ и его статус в аккаунте провайдера." };
  }
  if (http === 402 || /insufficient_quota|insufficient credits|credit balance|billing|quota exceeded|not enough balance/.test(body)) {
    return { shared, category: "CREDITS", message: "На счёте провайдера недостаточно средств или квоты. Пополните баланс в аккаунте провайдера." };
  }
  if (http === 429) {
    // This is the provider refusing the request, not Kairema's own per-user budget being spent.
    // The two are told apart in the wording on purpose: a user whose own key is being throttled
    // must not be told to wait out a Kairema limit that was never reached.
    return { shared, category: "RATE_LIMIT", message: "Ваш провайдер ограничил частоту запросов по вашему API-ключу. Это ограничение на стороне провайдера, лимит Kairema не исчерпан. Повторите попытку позже или смените модель." };
  }
  if (http === 404 || /no endpoints found|model_not_found|model not found|unknown model|not available/.test(body)) {
    return { shared, category: "MODEL", message: "Провайдер не предлагает выбранную модель. Выберите другую модель из списка." };
  }
  // Any server-side upstream status is a provider availability problem, not a user mistake.
  if ((http !== null && http >= 500) || /overloaded|service unavailable|capacity|upstream error/.test(body)) {
    return { shared, category: "PROVIDER_UNAVAILABLE", message: "Провайдер временно недоступен. Повторите попытку позже." };
  }
  if (http === 400 || http === 422) {
    return { shared, category: "INVALID_REQUEST", message: "Провайдер отклонил запрос. Проверьте модель и попробуйте снова." };
  }
  return { shared, category: USER_CATEGORY, message: "Провайдер вернул неожиданный ответ. Повторите попытку позже." };
}

const USER_PROVIDER_TIMEOUT_MS = 25_000;

/**
 * The rate-limit headers a provider returns, read for diagnostics only.
 *
 * These are safe to record: they describe the provider's accounting of the request, not the request
 * itself. The key never appears here — callers log a SHA-256 fingerprint instead — and neither the
 * prompt nor the model's answer is ever part of a diagnostic record.
 */
export function upstreamRateLimitDiagnostics(response: Response): Record<string, string | number | null> {
  const read = (name: string) => {
    try { return response.headers?.get(name) ?? null; } catch { return null; }
  };
  return {
    rateLimitLimit: read("x-ratelimit-limit"),
    rateLimitRemaining: read("x-ratelimit-remaining"),
    rateLimitReset: read("x-ratelimit-reset"),
    retryAfter: read("retry-after"),
    cfRay: read("cf-ray"),
  };
}
const KEY_PROBE_TIMEOUT_MS = 12_000;
const CATALOG_TIMEOUT_MS = 15_000;
/**
 * A bound against a pathological response, not a ranking: OpenRouter's live catalog holds 458
 * usable chat models today, and a 400 cap silently hid 58 of them (including openai/o1 and
 * deepseek/deepseek-r1) simply because they came late in the provider's own order. The cap is
 * applied after the capability filter, so raising it costs nothing but defence.
 */
const MAX_CATALOG_MODELS = 1_000;

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
 * Auth/credit probe against the provider's own key route. It performs no inference, so it never
 * spends the caller's tokens or consumes a generation attempt, and the only thing returned is a
 * classification plus a fixed message.
 *
 * A custom provider has no dedicated key route, so the catalog request doubles as the probe: it
 * is still a read-only call that reveals whether the key is accepted, and it costs nothing.
 */
export async function verifyUserProviderKey(selector: UserProviderSelector, apiKey: string): Promise<UserProviderKeyCheck> {
  const target = toTarget(selector);
  const probe = target.keyProbeEndpoint ?? target.modelsEndpoint;
  let response: Response;
  try {
    response = await fetch(probe, { method: "GET", headers: userProviderHeaders(apiKey), signal: timeoutSignal(undefined, KEY_PROBE_TIMEOUT_MS) });
  } catch (error) {
    const failure = providerNetworkError(error);
    return { ok: false, category: failure.category, http: null, message: failure.message };
  }
  if (!response.ok) {
    const failure = classifyUserProviderFailure(response.status, await readUpstreamJson(response));
    return { ok: false, category: failure.category, http: response.status, message: failure.message };
  }
  // OpenRouter answers the key route as { data: { label } }, while an OpenAI-compatible catalog
  // carries no name at all. Both are read so a user who named their key sees it, and neither
  // shape can turn a failed probe into a success: the status check above already passed.
  const body = (await readUpstreamJson(response)) as { label?: unknown; data?: { label?: unknown } } | null;
  const label = typeof body?.data?.label === "string" ? body.data.label : typeof body?.label === "string" ? body.label : "";
  const safeLabel = label.slice(0, 80);
  return { ok: true, label: safeLabel };
}

export type UserProviderModel = {
  /** The provider's real model id. It is never rewritten: this is what a request must send. */
  id: string;
  /** The display name exactly as the provider reported it. */
  name: string;
  /** The same name without its author prefix and free marker, for the model picker. */
  displayName: string;
  /** True when the catalog prices input and output at zero, or the id is the official :free variant. */
  isFree: boolean;
  /** True when the catalog says the model accepts images. */
  acceptsImage: boolean;
  contextLength: number | null;
};

/**
 * The catalog fields this normalizer reads. They are the ones OpenRouter's live `/models`
 * response actually carries today: `architecture.input_modalities` / `output_modalities`
 * arrays, the compact `architecture.modality` string, numeric-string `pricing`, and
 * `context_length`. A generic OpenAI-compatible catalog may carry none of them.
 */
type CatalogEntry = {
  id?: unknown;
  name?: unknown;
  context_length?: unknown;
  architecture?: { modality?: unknown; input_modalities?: unknown; output_modalities?: unknown };
  pricing?: { prompt?: unknown; completion?: unknown };
};

function modalityList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string").map((item) => item.trim().toLowerCase()).filter(Boolean);
}

/**
 * The modalities a catalog entry declares, or null when it declares none.
 * OpenRouter writes them as `input_modalities` / `output_modalities` and repeats them compactly
 * as a "text+image->embeddings" string; both are accepted. A catalog that says nothing at all
 * returns null, because then nothing is known about the model and nothing can be ruled out.
 */
function catalogModalities(entry: CatalogEntry): { inputs: string[]; outputs: string[] } | null {
  const inputs = modalityList(entry.architecture?.input_modalities);
  const outputs = modalityList(entry.architecture?.output_modalities);
  if (inputs.length || outputs.length) return { inputs, outputs };
  if (typeof entry.architecture?.modality === "string") {
    const [left, right] = entry.architecture.modality.split("->");
    if (!left && !right) return null;
    return { inputs: modalityList(left?.split("+")), outputs: modalityList(right?.split("+")) };
  }
  return null;
}

/**
 * Whether a Kairema turn can use this model. A turn sends text messages and needs text back, so
 * the model has to accept text and produce text. This is what keeps embedding, rerank, TTS and
 * other specialized endpoints out of the chat picker, and it is decided from the catalog's own
 * capability metadata rather than from anything in the model's name.
 */
function isChatCapableModel(entry: CatalogEntry): boolean {
  const modalities = catalogModalities(entry);
  if (!modalities) return true;
  return modalities.inputs.includes("text") && modalities.outputs.includes("text");
}

function catalogPrice(entry: CatalogEntry, field: "prompt" | "completion"): number | null {
  const value = entry.pricing?.[field];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

/**
 * Free means free by the catalog's own numbers: input and output both priced at zero. A
 * provider that reports no pricing falls back to the official `:free` variant id, which is the
 * only free marker OpenRouter itself uses in an id.
 */
function isFreeCatalogModel(entry: CatalogEntry, id: string): boolean {
  const prompt = catalogPrice(entry, "prompt");
  const completion = catalogPrice(entry, "completion");
  if (prompt !== null && completion !== null) return prompt === 0 && completion === 0;
  return /:free$/i.test(id);
}

/**
 * The picker shows a model by its own name, without the author prefix and without the free
 * marker: OpenRouter names a model "Author: Model (free)", the author is chosen separately in
 * the provider picker, and free models already have their own section. The provider's raw name
 * and the id both stay available as fallbacks.
 */
function catalogDisplayName(name: string, id: string): string {
  const withoutFreeMarker = name.replace(/\s*\(free\)\s*$/i, "").trim();
  const withoutAuthor = withoutFreeMarker.replace(/^[^:]{1,60}:\s*/, "").trim();
  return (withoutAuthor || withoutFreeMarker || id).slice(0, 120);
}

/**
 * Reads the provider's live catalog. Nothing is hardcoded: the list a user picks from is
 * whatever the provider returns right now, and every decision below comes from that response.
 * Models a Kairema chat turn cannot use are dropped from their own declared modalities, and the
 * result is bounded so one response cannot flood the client. The cap is applied after the
 * filter, so a catalog full of specialized entries can never push the usable ones out.
 */
export async function listUserProviderModels(selector: UserProviderSelector, apiKey: string): Promise<UserProviderModel[]> {
  const target = toTarget(selector);
  let response: Response;
  try {
    response = await fetch(target.modelsEndpoint, { method: "GET", headers: userProviderHeaders(apiKey), signal: timeoutSignal(undefined, CATALOG_TIMEOUT_MS) });
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
    if (typeof entry?.id !== "string" || !entry.id.trim()) continue;
    if (seen.has(entry.id)) continue;
    if (!isChatCapableModel(entry)) continue;
    seen.add(entry.id);
    // An OpenAI-compatible catalog entry may carry no display name, so the id stands in for it.
    const name = typeof entry.name === "string" && entry.name.trim() ? entry.name : entry.id;
    const modalities = catalogModalities(entry);
    const contextLength = typeof entry.context_length === "number" && entry.context_length > 0 ? entry.context_length : null;
    models.push({
      id: entry.id,
      name: name.slice(0, 120),
      displayName: catalogDisplayName(name, entry.id),
      isFree: isFreeCatalogModel(entry, entry.id),
      acceptsImage: modalities?.inputs.includes("image") ?? false,
      contextLength,
    });
    if (models.length >= MAX_CATALOG_MODELS) break;
  }
  return models;
}

type ApiChatMessage = { role: "system" | "user" | "assistant"; content: string | Array<{ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } }> };

/**
 * The same Kairema system prompt the platform roles use, with the user's own model named in
 * place of the role label. Role capability text is deliberately absent: the user selected a
 * raw model, so promising "Flash" or "Apex" behaviour would misrepresent what was chosen.
 *
 * The user's own interface settings are not role-specific, so they are applied exactly as they
 * are on the platform path. Without this a user who asked for a detailed, professional answer
 * got a bare prompt instead and the model looked like it had ignored the request. Nothing is
 * added about the model being user-provided: it is simply told who it is and how to answer.
 */
function buildUserProviderMessages(modelLabel: string, history: ChatMessage[], settings?: ChatSettings): ApiChatMessage[] {
  const system = `${KAIREMA_SYSTEM_PROMPT.replace("{модель}", modelLabel)} ${userPreferenceRules(settings)}`.trim();
  return [{ role: "system", content: system }, ...history.map((message) => ({ role: message.role, content: message.content }))];
}

/**
 * Applies the assistant sanitizer to one streaming delta without eating the whitespace that
 * separates it from its neighbours.
 *
 * `sanitizeAssistantContent` trims its input because it is also used on a finished answer, where
 * leading and trailing whitespace are noise. On a delta they are not noise at all: they are the
 * spaces between two words, and dropping them is what made a user's own model look broken. The
 * chunk's own leading and trailing whitespace is therefore lifted off, the remainder is sanitized,
 * and the whitespace is put back unchanged. A chunk that the provider sent as "Hello" then
 * "world" still reads "Helloworld", because that is what the provider actually sent.
 */
export function sanitizeStreamDelta(delta: string): string {
  if (!delta) return "";
  const leading = /^[\s\uFEFF]*/.exec(delta)?.[0] ?? "";
  const trailing = leading.length === delta.length ? "" : (/[\s\uFEFF]*$/.exec(delta)?.[0] ?? "");
  const inner = delta.slice(leading.length, delta.length - trailing.length);
  if (!inner) return delta;
  return `${leading}${sanitizeAssistantContent(inner)}${trailing}`;
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
  provider: UserProviderSelector;
  model: string;
  modelLabel: string;
  apiKey: string;
  history: ChatMessage[];
  settings?: ChatSettings;
  roleId: "fast" | "smart" | "context" | "flagship";
  onDelta: (delta: string) => void;
  signal?: AbortSignal;
  actor?: CapacityActor;
  /**
   * The user's own other providers, tried in order once this one has been rate-limited to death.
   *
   * Every entry is one the user connected themselves. There is deliberately no way to name a
   * Kairema provider here: a BYOK turn that fails must surface the failure, never quietly answer
   * from a provider the user did not choose and is not paying for.
   */
  fallbacks?: readonly { provider: string; model: string; apiKey: string; modelLabel?: string }[];
  /** Injection point for tests; production uses the real clock and the real sleeper. */
  retry?: { sleep?: (ms: number) => Promise<void>; now?: () => number };
}): Promise<UserProviderStreamResult> {
  const target = toTarget(options.provider);
  const primaryProviderId = target.id;
  const capacityLease: CapacityGenerationLease | null = options.actor
    ? await beginCapacityGeneration(options.actor, options.roleId, options.settings ?? {})
    : null;
  const budget = createRequestBudget(capacityLease ?? undefined);
  let reservation: Awaited<ReturnType<CapacityGenerationLease["reserveAttempt"]>> | null = null;
  const startedAt = Date.now();
  // The whole request — the first try, every retry, and every move to a fallback provider — spends
  // this one budget. There is no per-provider budget on top of it.
  const MAX_ATTEMPTS = budget.remaining + budget.used;

  /**
   * How many attempts one provider may spend before the chain moves on.
   *
   * Two is the point where a retry still has a chance (the first failure may be a blip) but a
   * third attempt is not worth the latency: a provider that has throttled the key twice in a row
   * will throttle the third call too. Whatever is left of the shared budget is handed to the next
   * provider the user connected, so the total is still bounded by MAX_ATTEMPTS — this caps how
   * long any single provider can hold the request, it never adds attempts to the request.
   */
  const MAX_ATTEMPTS_PER_PROVIDER = 2;

  /**
   * One real upstream call. Reports the status and the provider's own retry hint so the shared
   * retry policy can decide, without this function deciding anything about retrying itself.
   */
  const invokeOnce = async (candidate: { target: UserProviderTarget; provider: string; model: string; apiKey: string; modelLabel?: string }, attempt: number) => {
    if (capacityLease) {
      reservation = await capacityLease.reserveAttempt({ provider: "openrouter" as Provider, modelId: candidate.model }, attempt);
    }
    budget.used += 1;
    logByok("byok.invoke_start", { requestId: budget.requestId, attempt, provider: candidate.provider, model: candidate.model, keyFingerprint: keyFingerprint(candidate.apiKey), budgetRemaining: MAX_ATTEMPTS - budget.used });
    let response: Response;
    try {
      response = await fetch(candidate.target.chatEndpoint, {
        method: "POST",
        headers: { ...userProviderHeaders(candidate.apiKey), Accept: "text/event-stream" },
        body: JSON.stringify({ model: candidate.model, messages: buildUserProviderMessages(candidate.modelLabel ?? options.modelLabel, options.history, options.settings), stream: true }),
        signal: timeoutSignal(options.signal, USER_PROVIDER_TIMEOUT_MS),
      });
    } catch (error) {
      if (reservation) await settleCapacityReservation(reservation, "settled").catch(() => undefined);
      if (options.signal?.aborted) throw error;
      throw providerNetworkError(error);
    }
    logByok("byok.invoke_response", {
      requestId: budget.requestId, provider: candidate.provider, model: candidate.model, keyFingerprint: keyFingerprint(candidate.apiKey),
      httpStatus: response.status, latencyMs: Date.now() - startedAt, ...upstreamRateLimitDiagnostics(response),
    });
    if (!response.ok) {
      const retryAfterMs = parseRetryAfter(response.headers?.get("retry-after"), options.retry?.now?.() ?? Date.now());
      const failure = classifyUserProviderFailure(response.status, await readUpstreamJson(response));
      logByok("byok.invoke_error", {
        requestId: budget.requestId, provider: candidate.provider, model: candidate.model, keyFingerprint: keyFingerprint(candidate.apiKey),
        httpStatus: response.status, errorCategory: failure.category, retryAttempt: attempt - 1, ...upstreamRateLimitDiagnostics(response),
      });
      // The shared verdict travels with the error so the retry loop and the fallback decision both
      // read one classification instead of re-deciding from the status on their own.
      return {
        ok: false as const,
        status: response.status,
        error: new UserProviderError(failure.category, failure.message, response.status),
        retryAfterMs,
        retryable: failure.shared.retryable,
        // A busy or throttled provider is worth leaving; a rejected key is not, because the next
        // provider the user connected would reject it for the same reason.
        fallbackEligible: failure.shared.retryable,
      };
    }
    return { ok: true as const, value: response };
  };

  // Primary first, then the user's own other providers. A provider that is throttled gives up its
  // remaining budget to the next one rather than to a provider the user did not connect. Every
  // entry is one the user connected themselves, so the chain walks their own accounts and stops at
  // the last one rather than reaching for a Kairema provider.
  const candidates: Array<{ target: UserProviderTarget; provider: string; model: string; apiKey: string; modelLabel?: string }> = [
    { target, provider: primaryProviderId, model: options.model, apiKey: options.apiKey, modelLabel: options.modelLabel },
    ...(options.fallbacks ?? []).map((entry) => ({ target: toTarget(entry.provider), provider: entry.provider as string, model: entry.model, apiKey: entry.apiKey, modelLabel: entry.modelLabel })),
  ];

  let response: Response;
  let lastError: unknown;
  try {
    for (const candidate of candidates) {
      // Per-provider cap, and never more than what is left of the one shared budget. This is what
      // makes the chain reachable: a provider that is throttled gives up its remaining budget to
      // the next one rather than to a provider the user did not connect, so the total across every
      // provider is still bounded by MAX_ATTEMPTS and no retry can push the request past it.
      const providerAttemptCap = Math.min(MAX_ATTEMPTS_PER_PROVIDER, MAX_ATTEMPTS - budget.used);
      if (providerAttemptCap <= 0) break;
      const outcome = await retryUpstream<{ response: Response }>({
        maxAttempts: providerAttemptCap,
        // Counts this provider's own attempts, not the request's. The request-wide total is
        // budget.used, which providerAttemptCap has already been clipped against, so a candidate
        // late in the chain gets a smaller cap rather than a loop that starts already spent.
        attemptsUsed: 0,
        run: async () => {
          const result = await invokeOnce(candidate, budget.used + 1);
          return result.ok ? { ok: true as const, value: { response: result.value } } : result;
        },
        sleep: options.retry?.sleep,
        signal: options.signal,
        onRetry: (info) => logByok("byok.invoke_retry", {
          requestId: budget.requestId, provider: candidate.provider, model: candidate.model, keyFingerprint: keyFingerprint(candidate.apiKey),
          httpStatus: info.status, retryAttempt: info.attempt, delayMs: info.delayMs,
        }),
      });
      if (outcome.value !== undefined) { response = outcome.value.response; lastError = undefined; break; }
      lastError = outcome.error;
      // Only a failure another provider might not share moves on: a throttled key, a busy
      // provider, a dropped connection. An invalid key or an unknown model is the user's own
      // configuration, and the next provider they connected would reject it for the same reason.
      if (!outcome.fallbackEligible) break;
      if (budget.used >= MAX_ATTEMPTS) break;
    }
    if (lastError) throw lastError;
    if (!response!) throw new UserProviderError("UNKNOWN", "Провайдер не вернул ответ. Повторите попытку позже.", null);
    const decoder = new TextDecoder();
    const parts: string[] = [];
    let buffer = "";
    // Sanitizing a delta on its own used to trim it, so a chunk like " world" was published as
    // "world" and the answer arrived as "Helloworldhowareyou?": the model is not at fault, the
    // space was never sent. The sanitizer still runs — it is what strips source links and citation
    // markers — but only over the chunk's inner text, so the exact whitespace the provider sent
    // around it is preserved and reproduced verbatim. Nothing is ever inserted between chunks.
    const reasoningFilter = createReasoningStreamFilter();
    const emit = (raw: string, final = false) => {
      const visible = sanitizeStreamDelta(reasoningFilter(raw, final));
      if (visible) { parts.push(visible); options.onDelta(visible); }
    };
    const consume = (block: string) => {
      const raw = dataFromSseBlock(block);
      if (!raw || raw === "[DONE]") return;
      try {
        emit(openRouterStreamDelta(JSON.parse(raw)));
      } catch {
        // Upstream keep-alive comments and non-delta frames are ignorable.
      }
    };
    // One reader over the response body: SSE is consumed frame by frame, a single JSON document is
    // consumed whole. Both go through the same emitter, so a non-stream answer keeps the same
    // filtering, sanitizing and attribution a streamed one gets.
    const consumeEventStream = async (whole?: string) => {
      if (whole !== undefined) {
        // A body that arrived already buffered is a single document, not a stream of frames.
        const raw = whole.trim();
        if (!raw || raw === "[DONE]") return;
        try { emit(openRouterStreamDelta(JSON.parse(raw))); } catch { /* not a JSON answer */ }
        return;
      }
      const reader = response.body?.getReader();
      if (!reader) return;
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
        // Flushes whatever the line filter is still holding, so a tail without a trailing newline
        // is delivered instead of silently dropped.
        if (buffer.trim()) consume(buffer);
      } finally {
        reader.releaseLock();
      }
    };
    // A provider that ignores "stream": true answers with one JSON document, and a document that
    // happens to be pretty-printed spans several lines: feeding it to the frame reader split it
    // mid-object and every line failed to parse, producing "the provider returned an empty answer"
    // for a reply the user had already paid for. The content type tells the two cases apart, and
    // the body is only read as a whole when it is not an event stream.
    const contentType = typeof response.headers?.get === "function" ? (response.headers.get("content-type") ?? "") : "";
    try {
      if (contentType.toLowerCase().includes("text/event-stream")) {
        await consumeEventStream();
      } else {
        const before = parts.length;
        const whole = typeof response.text === "function" ? await response.text() : "";
        try {
          await consumeEventStream(whole);
        } catch {
          // Not JSON at all.
        }
        // A body that yielded no text and was not consumed as a document is a stream after all:
        // the content type was missing or wrong. Reading it as frames is the last resort, not a
        // second interpretation of a body that was already understood.
        if (parts.length === before) await consumeEventStream();
      }
      emit("", true);
    } finally {
      // The filter holds back a possible partial tag; the final flush is what releases it, and it
      // is safe to repeat because the filter is empty once flushed.
      emit("", true);
    }
    const content = sanitizeAssistantContent(parts.join(""));
    if (!content) throw new UserProviderError("UNKNOWN", "Провайдер вернул пустой ответ. Повторите попытку.", response.status);
    logByok("byok.invoke_succeeded", { requestId: budget.requestId, provider: target.id, model: options.model, latencyMs: Date.now() - startedAt });
    // A user-defined provider is shown under the name its owner gave it instead of the built-in
    // one, so the answer is attributed to the provider the user actually configured.
    const answerLabel = target.isCustom ? `${target.displayName} · ${options.modelLabel}` : options.modelLabel;
    return { content, modelUsed: options.modelLabel, provider: "openrouter", fallbackUsed: false, label: answerLabel, status: byokReadyStatus() };
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
  if (error instanceof UserProviderSkipRequestedError) return `Что произошло: подключённые провайдеры временно недоступны | Что делать: выберите другого провайдера или модель в «Мой API» и повторите попытку.`;
  if (error instanceof UserProviderError) {
    const category: StatusCategory = error.category === "CREDITS" ? "QUOTA" : error.category as StatusCategory;
    // A provider 429 names the provider as the party that is throttling, and says plainly that
    // Kairema's own budget is not involved, so it is never mistaken for the My API quota message.
    const action = error.category === "RATE_LIMIT"
      ? "Это лимит на стороне провайдера. Повторите позже или выберите другую модель."
      : error.category === "CREDITS" ? "Пополните баланс у провайдера." : error.category === "AUTH" || error.category === "MODEL" ? "Проверьте настройки в Настройках → AI Providers." : "Повторите попытку позже.";
    const what = error.category === "RATE_LIMIT" ? "Провайдер ограничил частоту запросов по вашему ключу" : `Провайдер ИИ ответил ошибкой (${category})`;
    return `Что произошло: ${what} | Почему: ${error.message} | Что делать: ${action}`;
  }
  if (error instanceof Error) return `Что произошло: Провайдер ИИ ответил ошибкой | Что делать: Повторите попытку позже.`;
  return `Что произошло: Провайдер ИИ ответил ошибкой | Что делать: Повторите попытку позже.`;
}
