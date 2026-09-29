/**
 * One error vocabulary for every provider call, browser-direct and server-side alike.
 *
 * The distinction that matters most here is between *we* refused the request and *the provider*
 * refused it. Kairema's own per-user My API budget is a Kairema decision; an HTTP 429 from the
 * upstream is the provider's. Conflating them tells a user whose key is being throttled to wait
 * out a limit they never reached, and — worse — records an upstream throttle as if Kairema's quota
 * had been spent, so the user's own budget is drained by someone else's rate limiter.
 */

/** Kairema's own per-user My API budget (15 requests / 60s) refused the turn. */
export const KAIREMA_RATE_LIMIT = "KAIREMA_RATE_LIMIT";
/** The upstream provider answered 429. Nothing to do with Kairema's budget. */
export const PROVIDER_RATE_LIMIT = "PROVIDER_RATE_LIMIT";
export const PROVIDER_UNAVAILABLE = "PROVIDER_UNAVAILABLE";
export const AUTH = "AUTH";
export const MODEL = "MODEL";
export const NETWORK = "NETWORK";
/** A browser-direct call was refused by CORS or by provider policy. Never retried blindly. */
export const CORS = "CORS";
export const EMPTY_RESPONSE = "EMPTY_RESPONSE";
export const UNKNOWN = "UNKNOWN";

export type ProviderFailureKind =
  | typeof KAIREMA_RATE_LIMIT
  | typeof PROVIDER_RATE_LIMIT
  | typeof PROVIDER_UNAVAILABLE
  | typeof AUTH
  | typeof MODEL
  | typeof NETWORK
  | typeof CORS
  | typeof EMPTY_RESPONSE
  | typeof UNKNOWN;

export type ProviderFailure = {
  kind: ProviderFailureKind;
  /** Safe to show a user. Never contains a key, a header, or a raw upstream body. */
  message: string;
  http: number | null;
  /**
   * Whether spending another attempt from the shared budget could plausibly change the outcome.
   * Separate from the kind because the two answer different questions: a 403 that is really a CORS
   * refusal is not retryable, and a 503 from an overloaded provider is.
   */
  retryable: boolean;
  /**
   * The window the provider asked us to wait out, in milliseconds, or null when it named none.
   *
   * Carried on the failure rather than read again by the caller so the direct path and the server
   * path obey the same window: a retry sent before a provider's own limit resets turns that
   * provider's rate limit into one we inflicted on ourselves.
   */
  retryAfterMs?: number | null;
};

const MESSAGES: Record<ProviderFailureKind, string> = {
  [KAIREMA_RATE_LIMIT]: "Лимит My API Kairema исчерпан. Дождитесь окна и повторите.",
  [PROVIDER_RATE_LIMIT]: "Провайдер ограничил частоту запросов по вашему ключу. Это ограничение на стороне провайдера, лимит Kairema не исчерпан.",
  [PROVIDER_UNAVAILABLE]: "Провайдер временно недоступен. Повторите попытку позже.",
  [AUTH]: "Провайдер отклонил API-ключ. Проверьте ключ и его статус в аккаунте провайдера.",
  [MODEL]: "Провайдер не предлагает выбранную модель. Выберите другую модель из списка.",
  [NETWORK]: "Не удалось связаться с провайдером. Проверьте соединение и повторите.",
  [CORS]: "Браузер не может обратиться к этому провайдеру напрямую. Используйте подключение через сервер.",
  [EMPTY_RESPONSE]: "Провайдер вернул пустой ответ. Повторите попытку.",
  [UNKNOWN]: "Провайдер вернул неожиданный ответ. Повторите попытку позже.",
};

/** 5xx that are worth another attempt: the provider is busy, not refusing on principle. */
function isTransientServerStatus(http: number) {
  return http === 408 || http === 425 || http === 429 || (http >= 500 && http <= 599);
}

function failure(kind: ProviderFailureKind, http: number | null, retryable?: boolean): ProviderFailure {
  return { kind, message: MESSAGES[kind], http, retryable: retryable ?? defaultRetryable(kind) };
}

function defaultRetryable(kind: ProviderFailureKind) {
  return kind === PROVIDER_RATE_LIMIT || kind === PROVIDER_UNAVAILABLE || kind === NETWORK;
}

const AUTH_BODY = /invalid_api_key|invalid api key|incorrect api key|api_key_invalid|permission denied|unauthorized|authentication|invalid x-api-key/i;
const CREDITS_BODY = /insufficient_quota|insufficient credits|credit balance|billing|quota exceeded|not enough balance|payment required/i;
const MODEL_BODY = /no endpoints found|model_not_found|model not found|unknown model|not available|does not exist or you do not have access/i;
const BUSY_BODY = /overloaded|service unavailable|capacity|upstream error|rate limit|too many requests/i;
const CORS_BODY = /cors|access-control-allow-origin|blocked by cors|failed to fetch|networkerror when attempting to fetch resource/i;
/**
 * A limit that resets on a daily (or longer) clock is not a rate limit and must not be retried.
 *
 * Providers describe this in the body of a 429, which is the same status a short window uses, so
 * the status alone cannot tell them apart. Retrying through a daily limit burns every attempt in
 * the budget and still fails, and the user is told to wait a minute for a limit that lasts a day.
 */
const DAILY_QUOTA_BODY = /daily limit|daily quota|per day|quota exceeded for (today|this day)|exceeded your current quota|monthly limit|requests per day|upgrade your plan/i;

export type ClassifyInput = {
  /** HTTP status, or null when the request never produced one (fetch threw, or CORS blocked it). */
  http: number | null;
  /** Parsed upstream body, when one was readable. Never logged. */
  body?: unknown;
  /** Set when the caller knows the failure came from the browser's CORS layer. */
  cors?: boolean;
  /** Set when the caller already knows Kairema's own budget refused the turn. */
  kairemaRateLimited?: boolean;
  /** The parsed `Retry-After` delay, when the response carried one. */
  retryAfterMs?: number | null;
};

/**
 * Maps one upstream outcome onto the shared vocabulary.
 *
 * The order matters and encodes the precedence a user experiences: a 401 that also happens to
 * contain the word "quota" is an auth failure, not a credits failure, and a 429 that mentions
 * credits is a rate limit. Only the status and a small set of known phrases are read; the body is
 * never echoed back to the user.
 */
export function classifyProviderFailure(input: ClassifyInput): ProviderFailure {
  const withWindow = (result: ProviderFailure): ProviderFailure => ({ ...result, retryAfterMs: input.retryAfterMs ?? null });
  if (input.kairemaRateLimited) return withWindow(failure(KAIREMA_RATE_LIMIT, input.http, false));
  if (input.cors) return withWindow(failure(CORS, input.http, false));

  const http = input.http;
  const body = typeof input.body === "string" ? input.body : JSON.stringify(input.body ?? "");

  // A 4xx that is not one of the recognised meanings is permanent by default: repeating a
  // malformed request or an unknown model produces the identical rejection and spends real budget.
  if (http !== null && http >= 400 && http < 500) {
    // 408 and 425 are the two 4xx statuses that mean "try again", not "you did it wrong". They are
    // checked before the permanent cases below, which would otherwise swallow them.
    if (http === 408 || http === 425) return withWindow(failure(PROVIDER_UNAVAILABLE, http, true));
    if (http === 429) {
      // A daily or monthly ceiling arrives as a 429 too, and is not worth another attempt.
      if (DAILY_QUOTA_BODY.test(body)) return withWindow({ kind: UNKNOWN, message: MESSAGES[UNKNOWN], http, retryable: false });
      return withWindow(failure(PROVIDER_RATE_LIMIT, http, true));
    }
    if (http === 401 || http === 403) {
      if (CORS_BODY.test(body)) return withWindow(failure(CORS, http, false));
      return withWindow(failure(AUTH, http, false));
    }
    if (http === 402 || CREDITS_BODY.test(body)) {
      return withWindow({ kind: AUTH, message: "На счёте провайдера недостаточно средств или квоты. Пополните баланс.", http, retryable: false });
    }
    if (http === 404 || MODEL_BODY.test(body)) return withWindow(failure(MODEL, http, false));
    if (AUTH_BODY.test(body)) return withWindow(failure(AUTH, http, false));
    if (BUSY_BODY.test(body) && /rate limit|too many requests/i.test(body)) {
      // A gateway that answers 400 while describing its own throttling is still a rate limit.
      return withWindow(failure(PROVIDER_RATE_LIMIT, http, true));
    }
    return withWindow(failure(UNKNOWN, http, false));
  }

  if (http !== null && isTransientServerStatus(http)) {
    return withWindow(failure(http === 429 ? PROVIDER_RATE_LIMIT : PROVIDER_UNAVAILABLE, http, true));
  }
  if (http !== null && http >= 200 && http < 400) {
    // The call succeeded at the transport level; an empty body is decided by the caller.
    return withWindow(failure(EMPTY_RESPONSE, http, false));
  }
  if (http === null) {
    // No status at all means the request never completed: a dropped connection, a DNS failure,
    // or a CORS rejection that the browser reported as an opaque network error.
    if (CORS_BODY.test(body)) return withWindow(failure(CORS, null, false));
    return withWindow(failure(NETWORK, null, true));
  }
  return withWindow(failure(UNKNOWN, http, false));
}

/**
 * Whether another attempt is worth spending.
 *
 * The single decision point for retry, so a caller cannot accidentally retry a bad key by
 * classifying it differently in two places.
 */
export function isRetryableFailure(value: ProviderFailure): boolean {
  return value.retryable;
}
