import type { Express, Request, RequestHandler, Response } from "express";
import { z } from "zod";
import { appendChatMessage, consumeChatStreamRequestQuota, consumeMyApiRequestQuota, deleteOwnedSessionUserMessage, listUserProviderConfigs, enqueueMemoryExtractionJob, getActiveUserProviderBinding, getOwnedChatSession, getOwnedSessionMessage, getStoredAssistantForClientMessage, listSessionTranscriptWindow, updateChatTitle } from "./db";
import { resolveRequestUser } from "./_core/context";
import { MODEL_IDS, MODEL_ROLES, chatWithRoleStream, publicChatError, type ChatMessage, type ChatSettings, type Provider, type RoleId } from "./providers";
import { buildChatContext, processMemoryExtractionJob } from "./chat-context";
import { getOrCreateGuestUser } from "./_core/guest-session";
import type { CapacityActor } from "./capacity-controller";
import { chatWithUserProviderStream, customUserProviderTarget, isSupportedUserProvider, publicUserProviderError, UserProviderGuestNotAllowedError, UserProviderNotConfiguredError, UserProviderSkipRequestedError } from "./user-providers";
import { decryptUserProviderSecret } from "./user-provider-secrets";

/**
 * Per-role allowance for ordinary Kairema Chat, counted per (user, role) in
 * `chat_stream_rate_windows`. Each of the four public roles carries its own budget, so a user who
 * spends their Flash minute still has an untouched Think, Context and Apex minute. The counter is
 * keyed by the stable role slug, so re-pointing a role at a different LLM keeps the same bucket.
 *
 * This is a per-role throttle, not a cap on the four roles combined: 15 × 4 roles is the maximum a
 * user can send inside one window. It is separate from the My API budget below, which is charged
 * only for BYOK turns.
 */
export const CHAT_STREAM_RATE_LIMIT = 15;
export const CHAT_STREAM_MAX_ACTIVE_PER_INSTANCE = 12;
export const CHAT_STREAM_MAX_ACTIVE_PER_USER = 2;
const CHAT_STREAM_RATE_WINDOW_MS = 60_000;
/** The owner dashboard reports the live quota window, so it is published rather than kept private. */
export const CHAT_STREAM_RATE_WINDOW_SECONDS = CHAT_STREAM_RATE_WINDOW_MS / 1_000;

/**
 * The sentence a user sees once their allowance for *this* role is spent. It names the role so the
 * limit is not mistaken for a whole-account block, and it says plainly that the other roles are
 * untouched. No internal detail (table names, counters, user ids) is disclosed.
 */
export function chatStreamRateLimitMessage(roleId: string): string {
  const label = MODEL_ROLES.find((role) => role.key === roleId)?.label ?? "Kairema";
  return `Лимит роли «${label}»: ${CHAT_STREAM_RATE_LIMIT} запросов в минуту. Другие роли Kairema не затронуты. Подождите немного и попробуйте снова.`;
}

/**
 * My API (BYOK) turns are capped much lower than ordinary chat: each one spends the user's own
 * provider key and money, so a runaway client or a script must not be able to drain an account
 * through this endpoint. The two budgets are metered separately and neither consumes the other.
 */
export const MY_API_RATE_LIMIT = 15;
export const MY_API_RATE_WINDOW_MS = 60_000;
/** The single sentence a user sees once their own-key budget for this minute is spent. */
export const MY_API_RATE_LIMIT_MESSAGE = "Лимит My API: 15 запросов в минуту. Подождите немного и попробуйте снова.";
const CHAT_STREAM_REPLAY_TTL_MS = 5 * 60_000;
type StreamResult = Awaited<ReturnType<typeof chatWithRoleStream>>;
type StoredReplay = Pick<StreamResult, "content" | "modelUsed" | "label" | "searchStatus" | "sources" | "webGrounding">;
type PendingReplay = { promise: Promise<StreamResult | null>; resolve: (result: StreamResult | null) => void };

type ChatStreamAuditRecord = {
  event: "chat_stream.completed" | "chat_stream.rate_limited" | "chat_stream.my_api_rate_limited";
  userId: number;
  roleId?: RoleId;
  provider?: Provider;
  /** Marks a generation that ran on the caller's own provider, so platform metrics stay separable. */
  executionMode?: "platform" | "my_api";
  searchAttached?: boolean;
  respondedLayer?: "you" | "serper" | "exa" | "tavily" | "rag" | "none";
  sourcesCount?: number;
  sourceDateMin?: string | null;
  sourceDateMax?: string | null;
  timestamp: string;
  retryAfterSeconds?: number;
};

/** Local replay state only avoids repeat work inside one process; durable message idempotency remains authoritative across replicas. */
const completedChatStreamReplays = new Map<string, { result: StreamResult; expiresAt: number }>();
const pendingChatStreamReplays = new Map<string, PendingReplay>();
const activeChatStreamsByUser = new Map<number, number>();
let activeChatStreams = 0;
const CHAT_STREAM_GAUGE_SAMPLE_LIMIT = 128;
const chatStreamRuntimeGauges = {
  accepted: 0,
  rateLimited: 0,
  quotaUnavailable: 0,
  capacityRejected: 0,
  perUserCapacityRejected: 0,
  replayCompleted: 0,
  replayPending: 0,
  replayStored: 0,
  completed: 0,
  failed: 0,
  cancelled: 0,
  startLatencyMs: [] as number[],
  activeDurationMs: [] as number[],
};

function addGaugeSample(samples: number[], value: number) {
  samples.push(Math.max(0, Math.round(value)));
  if (samples.length > CHAT_STREAM_GAUGE_SAMPLE_LIMIT) samples.splice(0, samples.length - CHAT_STREAM_GAUGE_SAMPLE_LIMIT);
}

function percentile(samples: number[], ratio: number) {
  if (!samples.length) return null;
  const sorted = [...samples].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)] ?? null;
}

/** Metadata-only local-process diagnostic snapshot. It contains no user IDs, content, prompts, responses, tokens or raw payloads. */
export function getChatStreamRuntimeGaugeSnapshot() {
  return {
    scope: "local_process" as const,
    limits: { activePerInstance: CHAT_STREAM_MAX_ACTIVE_PER_INSTANCE, activePerUser: CHAT_STREAM_MAX_ACTIVE_PER_USER },
    queue: { entered: 0, timedOut: 0, waitSamples: 0 },
    active: { streams: activeChatStreams, userBuckets: activeChatStreamsByUser.size },
    outcomes: {
      accepted: chatStreamRuntimeGauges.accepted,
      rateLimited: chatStreamRuntimeGauges.rateLimited,
      quotaUnavailable: chatStreamRuntimeGauges.quotaUnavailable,
      capacityRejected: chatStreamRuntimeGauges.capacityRejected,
      perUserCapacityRejected: chatStreamRuntimeGauges.perUserCapacityRejected,
      replayCompleted: chatStreamRuntimeGauges.replayCompleted,
      replayPending: chatStreamRuntimeGauges.replayPending,
      replayStored: chatStreamRuntimeGauges.replayStored,
      completed: chatStreamRuntimeGauges.completed,
      failed: chatStreamRuntimeGauges.failed,
      cancelled: chatStreamRuntimeGauges.cancelled,
    },
    samples: {
      count: { startLatency: chatStreamRuntimeGauges.startLatencyMs.length, activeDuration: chatStreamRuntimeGauges.activeDurationMs.length },
      startLatencyMs: { p50: percentile(chatStreamRuntimeGauges.startLatencyMs, 0.5), p95: percentile(chatStreamRuntimeGauges.startLatencyMs, 0.95), p99: percentile(chatStreamRuntimeGauges.startLatencyMs, 0.99) },
      activeDurationMs: { p50: percentile(chatStreamRuntimeGauges.activeDurationMs, 0.5), p95: percentile(chatStreamRuntimeGauges.activeDurationMs, 0.95), p99: percentile(chatStreamRuntimeGauges.activeDurationMs, 0.99) },
    },
  };
}

/** Test-only reset of local replay optimization; durable quota state is deliberately not process-local. */
export function resetChatStreamRateLimits() {
  completedChatStreamReplays.clear();
  pendingChatStreamReplays.clear();
  activeChatStreamsByUser.clear();
  activeChatStreams = 0;
  chatStreamRuntimeGauges.accepted = 0;
  chatStreamRuntimeGauges.rateLimited = 0;
  chatStreamRuntimeGauges.quotaUnavailable = 0;
  chatStreamRuntimeGauges.capacityRejected = 0;
  chatStreamRuntimeGauges.perUserCapacityRejected = 0;
  chatStreamRuntimeGauges.replayCompleted = 0;
  chatStreamRuntimeGauges.replayPending = 0;
  chatStreamRuntimeGauges.replayStored = 0;
  chatStreamRuntimeGauges.completed = 0;
  chatStreamRuntimeGauges.failed = 0;
  chatStreamRuntimeGauges.cancelled = 0;
  chatStreamRuntimeGauges.startLatencyMs.length = 0;
  chatStreamRuntimeGauges.activeDurationMs.length = 0;
}

function reserveActiveChatStream(userId: number): { allowed: true; release: () => void } | { allowed: false; reason: "instance" | "user" } {
	if (activeChatStreams >= CHAT_STREAM_MAX_ACTIVE_PER_INSTANCE) return { allowed: false, reason: "instance" };
  const userActiveStreams = activeChatStreamsByUser.get(userId) ?? 0;
	if (userActiveStreams >= CHAT_STREAM_MAX_ACTIVE_PER_USER) return { allowed: false, reason: "user" };
  activeChatStreams += 1;
  activeChatStreamsByUser.set(userId, userActiveStreams + 1);
  let released = false;
  return {
    allowed: true,
    release: () => {
      if (released) return;
      released = true;
      activeChatStreams = Math.max(0, activeChatStreams - 1);
      const remaining = (activeChatStreamsByUser.get(userId) ?? 1) - 1;
      if (remaining > 0) activeChatStreamsByUser.set(userId, remaining);
      else activeChatStreamsByUser.delete(userId);
    },
  };
}

function replayKey(userId: number, sessionId: string, clientMessageId: string) { return `${userId}:${sessionId}:${clientMessageId}`; }

/**
 * The "My API" execution path, kept separate from the platform path above.
 *
 * A guest is refused before any lookup, and the binding is resolved from the caller's own id
 * alone. The decrypted key exists only as a local variable for the duration of the upstream
 * fetch: it is never returned, logged, attached to the audit record or written into the
 * persisted transcript. There is no fallback branch here by design — if the chosen provider
 * fails, the user is told so instead of silently receiving an answer billed to someone else.
 */
async function generateWithUserProvider(options: {
  dependencies: StreamDependencies;
  userId: number;
  isGuest: boolean;
  roleId: RoleId;
  history: ChatMessage[];
  settings: ChatSettings | undefined;
  onDelta: (delta: string) => void;
  signal: AbortSignal;
  actor: CapacityActor;
  /** Providers the page already tried for this turn; see `skipProviders` in the input schema. */
  skipProviders?: readonly string[];
}): Promise<StreamResult> {
  if (options.isGuest) throw new UserProviderGuestNotAllowedError();
  const binding = await options.dependencies.getActiveUserProviderBinding(options.userId);
  if (!binding) throw new UserProviderNotConfiguredError();
  // Every provider the page already tried is dropped, the active one included. A Kairema provider
  // is still never substituted for it: the turn fails visibly rather than being answered from a
  // provider the user did not choose and is not paying for.
  if (options.skipProviders?.includes(binding.provider)) throw new UserProviderSkipRequestedError();
  // A custom provider is served from the configuration that was validated when it was saved;
  // the endpoint is re-checked here rather than taken from the request being answered.
  const target = binding.baseUrl
    ? customUserProviderTarget({ id: binding.provider, displayName: binding.displayName ?? "Мой провайдер", baseUrl: binding.baseUrl, modelsEndpoint: binding.modelsEndpoint })
    : binding.provider;
  const apiKey = options.dependencies.decryptUserProviderSecret(binding.encryptedApiKey);

  // The user's own other connected providers, used only if this one is rate-limited. Every entry
  // comes from this user's own saved configurations; a Kairema provider is never added here, so a
  // failed BYOK turn can never be answered by the platform on the user's behalf.
  const fallbacks = await loadUserProviderFallbacks(options.dependencies, options.userId, binding.provider, binding.model, options.skipProviders ?? []);
  return await options.dependencies.chatWithUserProviderStream({
    provider: target,
    model: binding.model,
    modelLabel: binding.model,
    apiKey,
    fallbacks,
    history: options.history,
    settings: options.settings,
    roleId: options.roleId,
    onDelta: options.onDelta,
    signal: options.signal,
    actor: options.actor,
  });
}

/**
 * The user's other connected providers, in the order they saved them, each with its own key.
 *
 * A provider whose key cannot be decrypted right now is skipped rather than allowed to fail the
 * whole request, and a provider the client does not know how to serve is left out entirely.
 */
async function loadUserProviderFallbacks(
  dependencies: StreamDependencies,
  userId: number,
  activeProvider: string,
  activeModel: string,
  skipProviders: readonly string[],
): Promise<Array<{ provider: string; model: string; apiKey: string; modelLabel?: string }>> {
  let configs: Awaited<ReturnType<StreamDependencies["listUserProviderConfigs"]>>;
  try {
    configs = await dependencies.listUserProviderConfigs(userId);
  } catch {
    return [];
  }
  const fallbacks: Array<{ provider: string; model: string; apiKey: string; modelLabel?: string }> = [];
  for (const config of configs) {
    if (config.provider === activeProvider || config.baseUrl) continue;
    // A provider the page already tried for this turn is not offered again, so a handover does not
    // repeat the failure the user was just shown.
    if (skipProviders.includes(config.provider)) continue;
    if (!isSupportedUserProvider(config.provider)) continue;
    let apiKey: string;
    try {
      apiKey = dependencies.decryptUserProviderSecret(config.encryptedApiKey);
    } catch {
      continue;
    }
    fallbacks.push({ provider: config.provider, model: config.activeModel || activeModel, apiKey, modelLabel: config.activeModel });
  }
  return fallbacks;
}

function getCompletedReplay(key: string, now = Date.now()): StreamResult | undefined {
  const item = completedChatStreamReplays.get(key);
  if (!item) return undefined;
  if (item.expiresAt <= now) { completedChatStreamReplays.delete(key); return undefined; }
  return item.result;
}
function createPendingReplay(key: string): PendingReplay {
  let resolve!: (result: StreamResult | null) => void;
  const promise = new Promise<StreamResult | null>((done) => { resolve = done; });
  const pending = { promise, resolve };
  pendingChatStreamReplays.set(key, pending);
  return pending;
}

function replayFromStoredAssistant(stored: Awaited<ReturnType<typeof getStoredAssistantForClientMessage>>, fallbackModelId: RoleId): StoredReplay | undefined {
  if (!stored) return undefined;
  return {
    content: stored.content,
    modelUsed: stored.modelId ?? fallbackModelId,
    label: "Kairema",
    ...(stored.metadata ? (() => { try { return JSON.parse(stored.metadata) as Pick<StoredReplay, "searchStatus" | "sources" | "webGrounding">; } catch { return {}; } })() : {}),
  };
}

/** Writes metadata only: no prompt, reply, session ID, headers, credentials, or client address. */
function recordChatStreamAudit(record: ChatStreamAuditRecord) {
  console.info("[Kairema audit]", JSON.stringify(record));
}

const streamInputSchema = z.object({
  sessionId: z.string().uuid(),
  modelId: z.enum(MODEL_IDS),
  content: z.string().trim().min(1).max(16_000),
  clientMessageId: z.string().uuid().optional(),
  regenerateMessageId: z.number().int().positive().optional(),
  settings: z.object({
    style: z.enum(["default", "professional", "friendly", "concise", "steps"]).optional(),
    responseLength: z.enum(["brief", "balanced", "detailed"]).optional(),
    effort: z.enum(["low", "standard", "high"]).optional(),
    thinking: z.boolean().optional(),
  }).optional(),
  attachmentIds: z.array(z.string().uuid()).max(4).optional(),
  /** Routes this request to the caller's own provider instead of the Kairema roles. */
  myApi: z.boolean().optional(),
  /**
   * Providers the client has already tried for this turn and does not want tried again.
   *
   * A browser-direct turn runs in the page, so the server learns about its failures only when the
   * client hands the turn over. Without this, a turn that already spent two attempts on OpenRouter
   * directly would be handed to a server that starts again from the same provider, and the user
   * would see the same failure twice for one question. Only the caller's own provider ids are
   * accepted, and they only ever remove candidates — they can never add one.
   */
  skipProviders: z.array(z.string().min(1).max(64)).max(16).optional(),
});

export function writeEvent(res: Response, event: string, payload: unknown) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
}

function historyError(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  if (/чат|хранилище/i.test(message)) return "Этап «история чата»: данные временно недоступны. Повторите попытку позже.";
  if (/вложен|файл|документ/i.test(message)) return "Этап «вложения»: не удалось подготовить выбранные файлы. Уберите вложение и повторите попытку.";
  if (/поиск|google|grounding|источник/i.test(message)) return "Этап «web-поиск»: свежие источники временно недоступны; попробуйте повторить запрос позже.";
  return "Этап «подготовка сообщения»: не удалось собрать приватный контекст. Повторите попытку позже.";
}

function normalizedDate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

const LIVE_VALUE_KINDS = ["temperature", "conditions", "clock", "rate"] as const;
const LIVE_VALUE_STATUSES = ["confirmed", "unconfirmed", "not_found"] as const;
/**
 * The live-value verdict crosses the boundary as an enum pair only. The value itself, the
 * snippet that proved it and the page it came from stay in the model context — an ordinary
 * user is told whether a value was confirmed, never handed raw provider output.
 */
function publicLiveValue(liveValue: NonNullable<StreamResult["searchStatus"]>["liveValue"]) {
  if (!liveValue) return undefined;
  const kind = LIVE_VALUE_KINDS.find((candidate) => candidate === liveValue.kind);
  const status = LIVE_VALUE_STATUSES.find((candidate) => candidate === liveValue.status);
  return kind && status ? { kind, status } : undefined;
}

/** The ordinary-user SSE boundary exposes only safe freshness metadata. */
function publicSearchStatus(status: StreamResult["searchStatus"]) {
  if (!status) return undefined;
  const sourceDateMin = normalizedDate(status.sourceDateMin);
  const sourceDateMax = normalizedDate(status.sourceDateMax);
  return {
    state: status.state,
    verificationStatus: status.verificationStatus,
    sourcesCount: Math.max(0, Math.floor(status.sourcesCount)),
    ...(status.freshnessBlocked ? { freshnessBlocked: true } : {}),
    ...(status.staleRagOnly ? { staleRagOnly: true } : {}),
    ...(publicLiveValue(status.liveValue) ? { liveValue: publicLiveValue(status.liveValue) } : {}),
    ...(sourceDateMin ? { sourceDateMin } : {}),
    ...(sourceDateMax ? { sourceDateMax } : {}),
  };
}

type PublicWebSource = { title: string; url: string; publishedAt?: string };

/** Keep only validated public web references; RAG snippets and provider diagnostics never cross this boundary. */
function publicWebSources(sources: StreamResult["sources"]): PublicWebSource[] {
  if (!Array.isArray(sources)) return [];
  const seen = new Set<string>();
  return sources.flatMap((source) => {
    if (!source || typeof source !== "object") return [];
    const candidate = source as { title?: unknown; url?: unknown; publishedAt?: unknown };
    if (typeof candidate.title !== "string" || typeof candidate.url !== "string") return [];
    let url: URL;
    try { url = new URL(candidate.url); } catch { return []; }
    if (!(url.protocol === "https:" || url.protocol === "http:") || seen.has(url.href)) return [];
    const title = candidate.title.replace(/\s+/g, " ").trim().slice(0, 180);
    if (!title) return [];
    seen.add(url.href);
    const publishedAt = normalizedDate(candidate.publishedAt);
    return [{ title, url: url.href, ...(publishedAt ? { publishedAt } : {}) }];
  }).slice(0, 5);
}

/** The public completion payload preserves only the V1 state and validated citation cards, never server-only context or cache metadata. */
function publicWebGrounding(grounding: StreamResult["webGrounding"], sources: StreamResult["sources"]) {
  if (!grounding || (grounding.intent !== "PREFERRED" && grounding.intent !== "REQUIRED")) return undefined;
  const state = grounding.state;
  if (!(state === "verified" || state === "disabled" || state === "empty" || state === "degraded" || state === "unavailable" || state === "admission_denied")) return undefined;
  const citations = state === "verified" ? publicWebSources(sources) : [];
  return { intent: grounding.intent, state, sourcesCount: Math.max(0, Math.min(5, Math.floor(grounding.sourcesCount))), citations, ...(grounding.freshnessBlocked === true ? { freshnessBlocked: true } : {}) };
}

function publicStreamResult(result: Pick<StreamResult, "content" | "modelUsed" | "label" | "searchStatus" | "sources" | "webGrounding">) {
  const sources = result.searchStatus?.verificationStatus === "verified" && !result.searchStatus.freshnessBlocked ? publicWebSources(result.sources) : [];
  const webGrounding = publicWebGrounding(result.webGrounding, result.sources);
  return {
    content: result.content,
    modelUsed: result.modelUsed,
    label: result.label,
    ...(result.searchStatus ? { searchStatus: publicSearchStatus(result.searchStatus) } : {}),
    ...(sources.length ? { sources } : {}),
    ...(webGrounding ? { webGrounding } : {}),
  };
}

type StreamDependencies = {
  authenticateRequest: (request: Request) => Promise<{ id: number } | null>;
  getOrCreateGuestUser: (request: Request, response: Response) => Promise<{ id: number; isGuest: boolean } | null>;
  getOwnedChatSession: typeof getOwnedChatSession;
  getStoredAssistantForClientMessage: typeof getStoredAssistantForClientMessage;
  consumeChatStreamRequestQuota: typeof consumeChatStreamRequestQuota;
  consumeMyApiRequestQuota: typeof consumeMyApiRequestQuota;
  deleteOwnedSessionUserMessage: typeof deleteOwnedSessionUserMessage;
  appendChatMessage: typeof appendChatMessage;
  updateChatTitle: typeof updateChatTitle;
  getOwnedSessionMessage: typeof getOwnedSessionMessage;
  listSessionTranscriptWindow: typeof listSessionTranscriptWindow;
  chatWithRoleStream: typeof chatWithRoleStream;
  chatWithUserProviderStream: typeof chatWithUserProviderStream;
  getActiveUserProviderBinding: typeof getActiveUserProviderBinding;
  listUserProviderConfigs: typeof listUserProviderConfigs;
  decryptUserProviderSecret: typeof decryptUserProviderSecret;
  buildChatContext: typeof buildChatContext;
  enqueueMemoryExtractionJob: typeof enqueueMemoryExtractionJob;
  processMemoryExtractionJob: typeof processMemoryExtractionJob;
  auditChatStream: (record: ChatStreamAuditRecord) => void | Promise<void>;
};

const defaultDependencies: StreamDependencies = {
  // Same permanent-first resolver as tRPC createContext, so /api/chat/stream and
  // auth.me always agree on userId for one browser session. A guest cookie no
  // longer shadows a verified Stytch/email session here either.
  authenticateRequest: async (request) => resolveRequestUser({ req: request }) as Promise<{ id: number } | null>,
  getOrCreateGuestUser: async (request, response) => {
    try {
      const guest = await getOrCreateGuestUser(request, response);
      return { id: guest.userId, isGuest: guest.isNew || true };
    } catch {
      return null;
    }
  },
  getOwnedChatSession,
  getStoredAssistantForClientMessage,
  consumeChatStreamRequestQuota,
  consumeMyApiRequestQuota,
  deleteOwnedSessionUserMessage,
  appendChatMessage,
  updateChatTitle,
  getOwnedSessionMessage,
  listSessionTranscriptWindow,
  chatWithRoleStream,
  chatWithUserProviderStream,
  getActiveUserProviderBinding,
  listUserProviderConfigs,
  decryptUserProviderSecret,
  buildChatContext,
  enqueueMemoryExtractionJob,
  processMemoryExtractionJob,
  auditChatStream: recordChatStreamAudit,
};

export function createChatStreamHandler(overrides: Partial<StreamDependencies> = {}): RequestHandler {
  const dependencies = { ...defaultDependencies, ...overrides };
  return async (req: Request, res: Response) => {
    let user = await dependencies.authenticateRequest(req).catch(() => null);
    let isGuest = false;

    // If no regular auth, try to get or create guest session
    if (!user) {
      const guest = await dependencies.getOrCreateGuestUser(req, res).catch(() => null);
      if (guest) {
        user = { id: guest.id } as { id: number };
        isGuest = true;
      }
    }

    if (!user) {
      res.status(401).json({ error: "Войдите, чтобы продолжить разговор." });
      return;
    }

    const parsed = streamInputSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Проверьте текст сообщения и выбранную модель." });
      return;
    }

    const input = parsed.data;
    const handlerStartedAt = performance.now();
    let pendingReplay: PendingReplay | undefined;
    let activeIdempotencyKey: string | undefined;
    let savedUserMessageId: number | undefined;
    let releaseActiveStream: (() => void) | undefined;
    let streamStartedAt: number | undefined;
    let streamOutcome: "completed" | "failed" | "cancelled" | undefined;
    try {
      const session = await dependencies.getOwnedChatSession(user.id, input.sessionId);
      if (!session) throw new Error("Чат не найден или недоступен.");
      const idempotencyKey = !input.regenerateMessageId && input.clientMessageId ? replayKey(user.id, input.sessionId, input.clientMessageId) : undefined;
      activeIdempotencyKey = idempotencyKey;
      const completedReplay = idempotencyKey ? getCompletedReplay(idempotencyKey) : undefined;
      const pendingReplayAtStart = idempotencyKey ? pendingChatStreamReplays.get(idempotencyKey) : undefined;
      if (completedReplay || pendingReplayAtStart) {
        if (completedReplay) chatStreamRuntimeGauges.replayCompleted += 1;
        else chatStreamRuntimeGauges.replayPending += 1;
        const replay = completedReplay ?? await pendingReplayAtStart!.promise;
        if (!replay) throw new Error("Предыдущее сообщение ещё не дало готового ответа. Повторите отправку через несколько секунд.");
        res.status(200);
        res.set({ "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform", "Connection": "keep-alive", "X-Accel-Buffering": "no" });
        res.flushHeaders();
        writeEvent(res, "start", { sessionId: input.sessionId, replayed: true });
        writeEvent(res, "done", publicStreamResult(replay));
        res.end();
        return;
      }
      const persistedReplay = idempotencyKey ? replayFromStoredAssistant(await dependencies.getStoredAssistantForClientMessage(user.id, input.sessionId, input.clientMessageId!), input.modelId) : undefined;
      if (persistedReplay) {
        chatStreamRuntimeGauges.replayStored += 1;
        res.status(200);
        res.set({ "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform", "Connection": "keep-alive", "X-Accel-Buffering": "no" });
        res.flushHeaders();
        writeEvent(res, "start", { sessionId: input.sessionId, replayed: true });
        writeEvent(res, "done", publicStreamResult(persistedReplay));
        res.end();
        return;
      }
      // The two budgets are metered on separate tables and each is charged only for its own mode.
      // A My API turn runs on the caller's own provider key and spends the caller's own money, so
      // charging it against the ordinary chat ingress budget would let BYOK usage exhaust Chat (and
      // vice versa): a user could lose access to the mode they were not even using. Each mode is
      // therefore limited by exactly one counter, and neither can spend the other's.
      let rateLimit: { allowed: boolean; retryAfterSeconds: number } = { allowed: true, retryAfterSeconds: 0 };
      try {
        if (!input.myApi) rateLimit = await dependencies.consumeChatStreamRequestQuota(user.id, input.modelId, CHAT_STREAM_RATE_LIMIT, CHAT_STREAM_RATE_WINDOW_MS);
      } catch {
        chatStreamRuntimeGauges.quotaUnavailable += 1;
        res.status(503).json({ error: "Проверка лимита временно недоступна. Повторите попытку позже." });
        return;
      }
      if (!rateLimit.allowed) {
        chatStreamRuntimeGauges.rateLimited += 1;
        void Promise.resolve(dependencies.auditChatStream({ event: "chat_stream.rate_limited", userId: user.id, timestamp: new Date().toISOString(), retryAfterSeconds: rateLimit.retryAfterSeconds })).catch(() => undefined);
        res.set("Retry-After", String(rateLimit.retryAfterSeconds)).status(429).json({ error: chatStreamRateLimitMessage(input.modelId) });
        return;
      }
      // My API turns spend the caller's own provider key, so they carry their own budget. This runs
      // only for `myApi` requests — ordinary Kairema Chat keeps the budget above and is untouched —
      // and it runs before the turn is persisted, so a refused request never becomes a half-written
      // turn the user has to clean up.
      if (input.myApi) {
        let myApiQuota: { allowed: boolean; retryAfterSeconds: number };
        try {
          myApiQuota = await dependencies.consumeMyApiRequestQuota(user.id, MY_API_RATE_LIMIT, MY_API_RATE_WINDOW_MS);
        } catch {
          // A quota that cannot be read cannot be enforced, and an unenforced quota is a way to
          // spend the user's own key without limit. Refuse rather than let the request through.
          chatStreamRuntimeGauges.quotaUnavailable += 1;
          res.status(503).json({ error: "Проверка лимита My API временно недоступна. Повторите попытку позже." });
          return;
        }
        if (!myApiQuota.allowed) {
          chatStreamRuntimeGauges.rateLimited += 1;
          void Promise.resolve(dependencies.auditChatStream({ event: "chat_stream.my_api_rate_limited", userId: user.id, timestamp: new Date().toISOString(), retryAfterSeconds: myApiQuota.retryAfterSeconds })).catch(() => undefined);
          res.set("Retry-After", String(myApiQuota.retryAfterSeconds)).status(429).json({ error: MY_API_RATE_LIMIT_MESSAGE, myApiRateLimited: true });
          return;
        }
      }
      const activeStream = reserveActiveChatStream(user.id);
      if (!activeStream.allowed) {
        chatStreamRuntimeGauges.capacityRejected += 1;
        if (activeStream.reason === "user") chatStreamRuntimeGauges.perUserCapacityRejected += 1;
        res.status(503).json({ error: "Сервис временно занят. Повторите попытку позже." });
        return;
      }
      releaseActiveStream = activeStream.release;
      chatStreamRuntimeGauges.accepted += 1;
      let transcript: Awaited<ReturnType<typeof dependencies.listSessionTranscriptWindow>> | undefined;
      if (input.regenerateMessageId) {
        const target = await dependencies.getOwnedSessionMessage(user.id, input.sessionId, input.regenerateMessageId);
        if (!target || target.role !== "assistant") throw new Error("Исходный запрос для регенерации не найден.");
        transcript = await dependencies.listSessionTranscriptWindow(user.id, input.sessionId, input.modelId, { beforeMessageId: target.id });
        if (!transcript.messages.some((message) => message.role === "user")) throw new Error("Исходный запрос для регенерации не найден.");
      } else {
        if (idempotencyKey) pendingReplay = createPendingReplay(idempotencyKey);
        const attachmentIds = Array.from(new Set(input.attachmentIds ?? [])).filter((attachmentId) => typeof attachmentId === "string" && attachmentId.length > 0);
        const userMetadata = attachmentIds.length > 0 ? JSON.stringify({ attachmentIds }) : undefined;
        const append = await dependencies.appendChatMessage(user.id, input.sessionId, "user", input.content, input.modelId, userMetadata, input.clientMessageId);
        savedUserMessageId = append.id;
        const isDuplicate = Boolean(input.clientMessageId && append && !append.created);
        if (isDuplicate && idempotencyKey) {
          const completed = getCompletedReplay(idempotencyKey);
          pendingReplay?.resolve(null);
          pendingChatStreamReplays.delete(idempotencyKey);
          const stored = !completed ? await dependencies.getStoredAssistantForClientMessage(user.id, input.sessionId, input.clientMessageId!) : undefined;
          const replay: StreamResult | StoredReplay | undefined = completed ?? replayFromStoredAssistant(stored, input.modelId);
          if (!replay) throw new Error("Предыдущее сообщение ещё не дало готового ответа. Повторите отправку через несколько секунд.");
          res.status(200);
          res.set({ "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform", "Connection": "keep-alive", "X-Accel-Buffering": "no" });
          res.flushHeaders();
          writeEvent(res, "start", { sessionId: input.sessionId, replayed: true });
          writeEvent(res, "done", publicStreamResult(replay));
          res.end();
          return;
        }
        if (session.title === "Новый разговор") await dependencies.updateChatTitle(user.id, input.sessionId, input.content.slice(0, 72));
        transcript = await dependencies.listSessionTranscriptWindow(user.id, input.sessionId, input.modelId, { throughMessageId: append.id });
      }

      const storedSettings = await dependencies.buildChatContext(user.id, input.sessionId, {
        attachmentIds: input.attachmentIds,
        query: input.content,
        role: input.modelId,
        capacityActor: { userId: user.id, requestKey: `stream:${user.id}:${input.clientMessageId ?? savedUserMessageId ?? input.regenerateMessageId ?? "generation"}` },
      });
      const effectiveSettings = { ...storedSettings, ...input.settings };

      res.status(200);
      res.set({
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",
      });
      res.flushHeaders();

      const controller = new AbortController();
      let closed = false;
      let finished = false;
      res.on("close", () => {
        if (!finished) {
          closed = true;
          controller.abort();
        }
      });
      writeEvent(res, "start", { sessionId: input.sessionId, regenerated: Boolean(input.regenerateMessageId) });
      streamStartedAt = performance.now();
      addGaugeSample(chatStreamRuntimeGauges.startLatencyMs, streamStartedAt - handlerStartedAt);

      try {
        const history = (transcript?.messages ?? []).map((message) => ({ role: message.role, content: message.content }));
        const onDelta = (delta: string) => { if (!closed) writeEvent(res, "delta", { content: delta }); };
        const actor = { userId: user.id, requestKey: `stream:${user.id}:${input.clientMessageId ?? savedUserMessageId ?? input.regenerateMessageId ?? "generation"}` };
        // The two modes differ only here: myApi runs the caller's own provider, the default
        // keeps the existing Kairema role chain untouched.
        const result = input.myApi
          ? await generateWithUserProvider({ dependencies, userId: user.id, isGuest, roleId: input.modelId, history, settings: effectiveSettings, onDelta, signal: controller.signal, actor, skipProviders: input.skipProviders })
          : await dependencies.chatWithRoleStream(
            input.modelId,
            history,
            effectiveSettings,
            onDelta,
            controller.signal,
            actor,
          );
        if (!closed) {
          const allSources = [...(result.sources ?? []), ...(result.ragSources ?? [])];
          const sourceDates = allSources.map((source) => normalizedDate(source.publishedAt) ?? ("retrievedAt" in source ? normalizedDate(source.retrievedAt) : null)).filter((value): value is string => Boolean(value)).sort();
          const normalizedSearchStatus = result.searchStatus ? {
            ...result.searchStatus,
            sourceDateMin: result.searchStatus.sourceDateMin ?? sourceDates[0] ?? null,
            sourceDateMax: result.searchStatus.sourceDateMax ?? sourceDates.at(-1) ?? null,
          } : undefined;
          const safeSearchStatus = publicSearchStatus(normalizedSearchStatus);
          const publicSources = normalizedSearchStatus?.verificationStatus === "verified" && !normalizedSearchStatus.freshnessBlocked ? publicWebSources(result.sources) : [];
          const safeWebGrounding = publicWebGrounding(result.webGrounding, result.sources);
          const sourceMetadata = safeSearchStatus || safeWebGrounding
            ? JSON.stringify({
              ...(safeSearchStatus ? { searchStatus: safeSearchStatus } : {}),
              ...(publicSources.length ? { sources: publicSources } : {}),
              ...(safeWebGrounding ? { webGrounding: safeWebGrounding } : {}),
            })
            : undefined;
          const savedAssistant = await dependencies.appendChatMessage(user.id, input.sessionId, "assistant", result.content, result.modelUsed, sourceMetadata);
          if (idempotencyKey) {
            completedChatStreamReplays.set(idempotencyKey, { result, expiresAt: Date.now() + CHAT_STREAM_REPLAY_TTL_MS });
            pendingReplay?.resolve(result);
            pendingChatStreamReplays.delete(idempotencyKey);
          }
          const sourcesCount = allSources.length;
          void Promise.resolve(dependencies.auditChatStream({
            event: "chat_stream.completed",
            userId: user.id,
            roleId: input.modelId,
            provider: result.provider,
            executionMode: input.myApi ? "my_api" : "platform",
            searchAttached: Boolean(result.searchStatus) || Boolean(result.sources?.length),
            respondedLayer: result.searchStatus?.cascadeUsed ?? (result.ragSources?.length ? "rag" : "none"),
            sourcesCount,
            sourceDateMin: sourceDates[0] ?? null,
            sourceDateMax: sourceDates.at(-1) ?? null,
            timestamp: new Date().toISOString(),
          })).catch(() => undefined);
          // The client marks its turn complete on `done` and may immediately
          // open a new chat. Persist the post-turn topic first, otherwise the
          // following turn can build context before its predecessor exists.
          if (!input.regenerateMessageId && savedUserMessageId && savedAssistant.id) {
            try {
              await dependencies.enqueueMemoryExtractionJob({
                userId: user.id,
                sessionId: input.sessionId,
                userMessageId: savedUserMessageId,
                assistantMessageId: savedAssistant.id,
                role: input.modelId,
              });
              await dependencies.processMemoryExtractionJob(user.id, savedAssistant.id);
            } catch {
              // The durable retry sweep owns recovery. Never turn a completed chat response into an error.
            }
          }
          writeEvent(res, "done", publicStreamResult({ ...result, searchStatus: normalizedSearchStatus }));
          streamOutcome = "completed";
          chatStreamRuntimeGauges.completed += 1;
          finished = true;
          res.end();
        } else if (idempotencyKey) {
          pendingReplay?.resolve(null);
          pendingChatStreamReplays.delete(idempotencyKey);
          streamOutcome = "cancelled";
          chatStreamRuntimeGauges.cancelled += 1;
        }
      } catch (error) {
        pendingReplay?.resolve(null);
        if (idempotencyKey) pendingChatStreamReplays.delete(idempotencyKey);
        if (closed) {
          streamOutcome = "cancelled";
          chatStreamRuntimeGauges.cancelled += 1;
        } else {
          streamOutcome = "failed";
          chatStreamRuntimeGauges.failed += 1;
        }
        if (!closed) {
          // A turn that produced no answer must not leave its question behind in the transcript.
          // The user message is written before the provider is called so the answer can attach to
          // it; on failure that question is rolled back, and only it — the history that preceded
          // this turn is what the user still has.
          if (savedUserMessageId) {
            await dependencies.deleteOwnedSessionUserMessage(user.id, input.sessionId, savedUserMessageId).catch(() => undefined);
          }
          // Each mode reports only its own sanitised text; a provider body never crosses the SSE boundary.
          writeEvent(res, "error", { message: input.myApi ? publicUserProviderError(error) : publicChatError(input.modelId, error) });
          finished = true;
          res.end();
        }
      }
    } catch (error) {
      pendingReplay?.resolve(null);
      if (activeIdempotencyKey) pendingChatStreamReplays.delete(activeIdempotencyKey);
      if (releaseActiveStream && !streamOutcome) {
        streamOutcome = "failed";
        chatStreamRuntimeGauges.failed += 1;
      }
      console.error("[CHAT_STREAM_OUTER_ERROR]", error?.constructor?.name ?? "Error", error instanceof Error ? error.message : String(error), error instanceof Error ? error.stack : "");
      res.status(400).json({ error: historyError(error) });
    } finally {
      if (streamStartedAt !== undefined) addGaugeSample(chatStreamRuntimeGauges.activeDurationMs, performance.now() - streamStartedAt);
      releaseActiveStream?.();
    }
  };
}

export function registerChatStreamRoute(app: Express) {
  app.post("/api/chat/stream", createChatStreamHandler());
}
