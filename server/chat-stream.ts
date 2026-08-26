import type { Express, Request, RequestHandler, Response } from "express";
import { z } from "zod";
import { appendChatMessage, consumeChatStreamRequestQuota, enqueueMemoryExtractionJob, getOwnedChatSession, getStoredAssistantForClientMessage, listSessionMessages, updateChatTitle } from "./db";
import { sdk } from "./_core/sdk";
import { MODEL_IDS, chatWithRoleStream, publicChatError, type Provider, type RoleId } from "./providers";
import { buildChatContext, processMemoryExtractionJob } from "./chat-context";

export const CHAT_STREAM_RATE_LIMIT = 60;
export const CHAT_STREAM_MAX_ACTIVE_PER_INSTANCE = 12;
export const CHAT_STREAM_MAX_ACTIVE_PER_USER = 2;
const CHAT_STREAM_RATE_WINDOW_MS = 60_000;
const CHAT_STREAM_REPLAY_TTL_MS = 5 * 60_000;
type StreamResult = Awaited<ReturnType<typeof chatWithRoleStream>>;
type StoredReplay = Pick<StreamResult, "content" | "modelUsed" | "label" | "searchStatus" | "sources">;
type PendingReplay = { promise: Promise<StreamResult | null>; resolve: (result: StreamResult | null) => void };

type ChatStreamAuditRecord = {
  event: "chat_stream.completed" | "chat_stream.rate_limited";
  userId: number;
  roleId?: RoleId;
  provider?: Provider;
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

/** Test-only reset of local replay optimization; durable quota state is deliberately not process-local. */
export function resetChatStreamRateLimits() {
  completedChatStreamReplays.clear();
  pendingChatStreamReplays.clear();
  activeChatStreamsByUser.clear();
  activeChatStreams = 0;
}

function reserveActiveChatStream(userId: number): { allowed: true; release: () => void } | { allowed: false } {
  if (activeChatStreams >= CHAT_STREAM_MAX_ACTIVE_PER_INSTANCE) return { allowed: false };
  const userActiveStreams = activeChatStreamsByUser.get(userId) ?? 0;
  if (userActiveStreams >= CHAT_STREAM_MAX_ACTIVE_PER_USER) return { allowed: false };
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
    ...(stored.metadata ? (() => { try { return JSON.parse(stored.metadata) as Pick<StoredReplay, "searchStatus" | "sources">; } catch { return {}; } })() : {}),
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

function publicStreamResult(result: Pick<StreamResult, "content" | "modelUsed" | "label" | "searchStatus" | "sources">) {
  const sources = result.searchStatus?.verificationStatus === "verified" && !result.searchStatus.freshnessBlocked ? publicWebSources(result.sources) : [];
  return {
    content: result.content,
    modelUsed: result.modelUsed,
    label: result.label,
    ...(result.searchStatus ? { searchStatus: publicSearchStatus(result.searchStatus) } : {}),
    ...(sources.length ? { sources } : {}),
  };
}

type StreamDependencies = {
  authenticateRequest: (request: Request) => Promise<{ id: number } | null>;
  getOwnedChatSession: typeof getOwnedChatSession;
  getStoredAssistantForClientMessage: typeof getStoredAssistantForClientMessage;
  consumeChatStreamRequestQuota: typeof consumeChatStreamRequestQuota;
  appendChatMessage: typeof appendChatMessage;
  updateChatTitle: typeof updateChatTitle;
  listSessionMessages: typeof listSessionMessages;
  chatWithRoleStream: typeof chatWithRoleStream;
  buildChatContext: typeof buildChatContext;
  enqueueMemoryExtractionJob: typeof enqueueMemoryExtractionJob;
  processMemoryExtractionJob: typeof processMemoryExtractionJob;
  auditChatStream: (record: ChatStreamAuditRecord) => void | Promise<void>;
};

const defaultDependencies: StreamDependencies = {
  authenticateRequest: async (request) => sdk.authenticateRequest(request) as Promise<{ id: number }>,
  getOwnedChatSession,
  getStoredAssistantForClientMessage,
  consumeChatStreamRequestQuota,
  appendChatMessage,
  updateChatTitle,
  listSessionMessages,
  chatWithRoleStream,
  buildChatContext,
  enqueueMemoryExtractionJob,
  processMemoryExtractionJob,
  auditChatStream: recordChatStreamAudit,
};

export function createChatStreamHandler(overrides: Partial<StreamDependencies> = {}): RequestHandler {
  const dependencies = { ...defaultDependencies, ...overrides };
  return async (req: Request, res: Response) => {
    const user = await dependencies.authenticateRequest(req).catch(() => null);
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
    let pendingReplay: PendingReplay | undefined;
    let activeIdempotencyKey: string | undefined;
    let savedUserMessageId: number | undefined;
    let releaseActiveStream: (() => void) | undefined;
    try {
      const session = await dependencies.getOwnedChatSession(user.id, input.sessionId);
      if (!session) throw new Error("Чат не найден или недоступен.");
      const idempotencyKey = !input.regenerateMessageId && input.clientMessageId ? replayKey(user.id, input.sessionId, input.clientMessageId) : undefined;
      activeIdempotencyKey = idempotencyKey;
      const completedReplay = idempotencyKey ? getCompletedReplay(idempotencyKey) : undefined;
      const pendingReplayAtStart = idempotencyKey ? pendingChatStreamReplays.get(idempotencyKey) : undefined;
      if (completedReplay || pendingReplayAtStart) {
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
        res.status(200);
        res.set({ "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform", "Connection": "keep-alive", "X-Accel-Buffering": "no" });
        res.flushHeaders();
        writeEvent(res, "start", { sessionId: input.sessionId, replayed: true });
        writeEvent(res, "done", publicStreamResult(persistedReplay));
        res.end();
        return;
      }
      let rateLimit: { allowed: boolean; retryAfterSeconds: number };
      try {
        rateLimit = await dependencies.consumeChatStreamRequestQuota(user.id, CHAT_STREAM_RATE_LIMIT, CHAT_STREAM_RATE_WINDOW_MS);
      } catch {
        res.status(503).json({ error: "Проверка лимита временно недоступна. Повторите попытку позже." });
        return;
      }
      if (!rateLimit.allowed) {
        void Promise.resolve(dependencies.auditChatStream({ event: "chat_stream.rate_limited", userId: user.id, timestamp: new Date().toISOString(), retryAfterSeconds: rateLimit.retryAfterSeconds })).catch(() => undefined);
        res.set("Retry-After", String(rateLimit.retryAfterSeconds)).status(429).json({ error: "Слишком много запросов. Подождите минуту." });
        return;
      }
      const activeStream = reserveActiveChatStream(user.id);
      if (!activeStream.allowed) {
        res.status(503).json({ error: "Сервис временно занят. Повторите попытку позже." });
        return;
      }
      releaseActiveStream = activeStream.release;
      let history: Awaited<ReturnType<typeof dependencies.listSessionMessages>> | undefined;
      if (input.regenerateMessageId) {
        const currentHistory = await dependencies.listSessionMessages(user.id, input.sessionId);
        const targetIndex = currentHistory.findIndex((message) => message.id === input.regenerateMessageId && message.role === "assistant");
        const promptIndex = targetIndex < 0 ? -1 : currentHistory.slice(0, targetIndex).map((message) => message.role).lastIndexOf("user");
        if (promptIndex < 0) throw new Error("Исходный запрос для регенерации не найден.");
        history = currentHistory.slice(0, targetIndex);
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
        history = await dependencies.listSessionMessages(user.id, input.sessionId);
      }

      const storedSettings = await dependencies.buildChatContext(user.id, input.sessionId, { attachmentIds: input.attachmentIds, query: input.content, role: input.modelId });
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

      try {
        const result = await dependencies.chatWithRoleStream(
          input.modelId,
          history.map((message) => ({ role: message.role, content: message.content })),
          effectiveSettings,
          (delta: string) => {
            if (!closed) writeEvent(res, "delta", { content: delta });
          },
          controller.signal,
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
          const sourceMetadata = safeSearchStatus ? JSON.stringify({ searchStatus: safeSearchStatus, ...(publicSources.length ? { sources: publicSources } : {}) }) : undefined;
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
          finished = true;
          res.end();
        } else if (idempotencyKey) {
          pendingReplay?.resolve(null);
          pendingChatStreamReplays.delete(idempotencyKey);
        }
      } catch (error) {
        pendingReplay?.resolve(null);
        if (idempotencyKey) pendingChatStreamReplays.delete(idempotencyKey);
        if (!closed) {
          writeEvent(res, "error", { message: publicChatError(input.modelId, error) });
          finished = true;
          res.end();
        }
      }
    } catch (error) {
      pendingReplay?.resolve(null);
      if (activeIdempotencyKey) pendingChatStreamReplays.delete(activeIdempotencyKey);
      res.status(400).json({ error: historyError(error) });
    } finally {
      releaseActiveStream?.();
    }
  };
}

export function registerChatStreamRoute(app: Express) {
  app.post("/api/chat/stream", createChatStreamHandler());
}
