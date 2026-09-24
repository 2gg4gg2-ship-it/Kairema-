import { and, asc, desc, eq, gt, inArray, isNull, like, lt, lte, or, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { createHash, randomUUID } from "node:crypto";
import { ChatAttachment, ChatExport, ChatMessageRecord, ChatSession, DevApiAuditRecord, InsertUser, KnowledgeDocument, KnowledgeIngestionRun, KnowledgeSource, MemoryEntry, MemoryExtractionJob, MemoryFact, MemoryProfile, MemorySettings, ProviderHealthRecord, UserSettings, WebSearchStatusRecord, chatAttachments, chatDrafts, chatExports, chatSessions, chatStreamRateWindows, devApiAuditRecords, devApiRateWindows, flashTtftMetrics, knowledgeDocuments, knowledgeIngestionRuns, knowledgeSources, memoryEntries, memoryExtractionJobs, memoryFacts, memoryProfiles, memorySettings, messages, providerControlFlags, providerDailyUsage, providerHealth, providerIdentities, roleRuntimeStatus, searchOutageLogs, searchQualityMetrics, technicalEvents, userSettings, users, webSearchStatus } from "../drizzle/schema";
import { providerHealthHistory } from "../drizzle/schema";
import { stytchLinkIntents } from "../drizzle/schema";
import { ENV } from "./_core/env";
import { GUEST_MAX_LIFETIME_MS, GUEST_TTL_MS } from "@shared/const";
import { decodeHistoryPageCursor, encodeHistoryPageCursor, normalizeHistoryPageLimit } from "./history-pagination";
import { selectTranscriptWindow, TRANSCRIPT_WINDOW_BUDGETS, type TranscriptRole } from "./transcript-window";

let _db: ReturnType<typeof drizzle> | null = null;

export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch {
      _db = null;
    }
  }
  return _db;
}

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) throw new Error("User openId is required for upsert");
  const db = await getDb();
  if (!db) return;

  const values: InsertUser = { openId: user.openId, lastSignedIn: user.lastSignedIn ?? new Date() };
  const updateSet: Record<string, unknown> = { lastSignedIn: values.lastSignedIn };
  for (const field of ["name", "email", "loginMethod"] as const) {
    if (user[field] !== undefined) {
      values[field] = user[field] ?? null;
      updateSet[field] = values[field];
    }
  }
  if (user.isGuest !== undefined) {
    values.isGuest = user.isGuest;
    updateSet.isGuest = user.isGuest;
  }
  if (user.expiresAt !== undefined) {
    values.expiresAt = user.expiresAt;
    updateSet.expiresAt = user.expiresAt;
  }
  if (user.lastActivityAt !== undefined) {
    values.lastActivityAt = user.lastActivityAt;
    updateSet.lastActivityAt = user.lastActivityAt;
  }
  if (user.role !== undefined) {
    values.role = user.role;
    updateSet.role = user.role;
  } else if (user.openId === ENV.ownerOpenId) {
    values.role = "admin";
    updateSet.role = "admin";
  }
  await db.insert(users).values(values).onDuplicateKeyUpdate({ set: updateSet });
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
  return result[0];
}

export async function getUserById(userId: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  return result[0];
}

export async function updateUserActivity(userId: number): Promise<void> {
  const db = await getDb();
  if (!db) return;
  // H2: Enforce absolute lifetime on guest activity updates.
  // expiresAt = min(now + GUEST_TTL_MS, createdAt + GUEST_MAX_LIFETIME_MS)
  const user = await db.select({ createdAt: users.createdAt }).from(users).where(eq(users.id, userId)).limit(1);
  if (!user[0]) return;
  const now = Date.now();
  const sliding = now + GUEST_TTL_MS;
  const absolute = new Date(user[0].createdAt).getTime() + GUEST_MAX_LIFETIME_MS;
  const expiresAt = new Date(Math.min(sliding, absolute));
  await db.update(users)
    .set({ lastActivityAt: new Date(), expiresAt })
    .where(eq(users.id, userId));
}

export async function getUserByProviderIdentity(provider: string, providerSubject: string) {
  const db = await getDb();
  if (!db) return undefined;
  const identity = await db.select().from(providerIdentities)
    .where(and(eq(providerIdentities.provider, provider), eq(providerIdentities.providerSubject, providerSubject)))
    .limit(1);
  return identity[0] ? getUserById(identity[0].userId) : undefined;
}

/**
 * Attach a verified provider subject to a canonical user only by its immutable
 * provider subject. Email is intentionally not an input to this operation.
 */
export async function linkProviderIdentityToUser(input: {
  provider: string;
  providerSubject: string;
  userId: number;
}) {
  const db = requireDatabase(await getDb());
  const existing = await db.select().from(providerIdentities)
    .where(and(
      eq(providerIdentities.provider, input.provider),
      eq(providerIdentities.providerSubject, input.providerSubject),
    ))
    .limit(1);

  if (existing[0]) {
    if (existing[0].userId !== input.userId) {
      throw new Error("Provider identity is already linked to another canonical user");
    }
    return;
  }

  try {
    await db.insert(providerIdentities).values({
      provider: input.provider,
      providerSubject: input.providerSubject,
      userId: input.userId,
    });
  } catch {
    // Concurrent verification can race here. Re-read the mapping and fail
    // closed if the immutable provider subject now belongs to another user.
    const afterRace = await db.select().from(providerIdentities)
      .where(and(
        eq(providerIdentities.provider, input.provider),
        eq(providerIdentities.providerSubject, input.providerSubject),
      ))
      .limit(1);
    if (!afterRace[0] || afterRace[0].userId !== input.userId) {
      throw new Error("Provider identity could not be linked safely");
    }
  }
}

const STYTCH_LINK_INTENT_TTL_MS = 10 * 60_000;

function hashStytchLinkIntent(reference: string) {
  return createHash("sha256").update(reference).digest("hex");
}

/**
 * Issues only an opaque, short-lived action reference. The binding between that
 * reference and the initiating canonical user stays in the database.
 */
export async function createStytchLinkIntent(userId: number) {
  const db = requireDatabase(await getDb());
  const now = new Date();
  const reference = randomUUID();
  await db.delete(stytchLinkIntents).where(lt(stytchLinkIntents.expiresAt, now));
  await db.insert(stytchLinkIntents).values({
    tokenHash: hashStytchLinkIntent(reference),
    userId,
    expiresAt: new Date(now.getTime() + STYTCH_LINK_INTENT_TTL_MS),
  });
  return reference;
}

/**
 * Atomically consumes the link action only for the same initiating canonical
 * user. A changed Manus/Stytch session therefore cannot complete another
 * user's linking flow, and replay/expired references fail closed.
 */
export async function consumeStytchLinkIntent(reference: string, userId: number) {
  if (!reference || reference.length > 128) return false;
  const db = requireDatabase(await getDb());
  const result = await db.delete(stytchLinkIntents).where(and(
    eq(stytchLinkIntents.tokenHash, hashStytchLinkIntent(reference)),
    eq(stytchLinkIntents.userId, userId),
    gt(stytchLinkIntents.expiresAt, new Date()),
  ));
  return Number(result[0]?.affectedRows ?? 0) > 0;
}

export async function resolveOrCreateProviderUser(input: {
  provider: string;
  providerSubject: string;
  canonicalOpenId: string;
  verifiedEmail: string;
  displayName?: string | null;
  loginMethod: string;
}) {
  let candidate: Awaited<ReturnType<typeof getUserByOpenId>> | null = null;
  try {
    const existing = await getUserByProviderIdentity(input.provider, input.providerSubject);
    if (existing) {
      const db = requireDatabase(await getDb());
      await db.update(users).set({ lastSignedIn: new Date() }).where(eq(users.id, existing.id));
      console.error("[RESOLVE_EXISTING_OK]");
      return existing;
    }
    console.error("[RESOLVE_EXISTING_OK]");
  } catch (error) {
     const cause = (error as { cause?: unknown })?.cause;
    const source = cause ?? error;
    const e = source as { code?: unknown; errno?: unknown; syscall?: unknown };
    const message = (source as { message?: unknown })?.message?.toString() ?? "none";
    console.error(
      `[RESOLVE_EXISTING_ERROR] ` +
      `error_name=${error?.constructor?.name ?? "Error"} ` +
      `message=${message} ` +
      `errno=${e.errno?.toString() ?? "none"} ` +
      `code=${e.code?.toString() ?? "none"} ` +
      `syscall=${e.syscall?.toString() ?? "none"} ` +
      `stage=getUserByProviderIdentity`
    );
    throw error;
  }

  try {
    await upsertUser({
      openId: input.canonicalOpenId,
      email: input.verifiedEmail,
      name: input.displayName ?? null,
      loginMethod: input.loginMethod,
      lastSignedIn: new Date(),
    });
    console.error("[RESOLVE_UPSERT_OK]");
  } catch (error) {
    const cause = (error as { cause?: unknown })?.cause;
    const source = cause ?? error;
    const e = source as { code?: unknown; errno?: unknown; syscall?: unknown };
    const message = (source as { message?: unknown })?.message?.toString() ?? "none";
    console.error(
      `[RESOLVE_UPSERT_ERROR] ` +
      `error_name=${error?.constructor?.name ?? "Error"} ` +
      `message=${message} ` +
      `errno=${e.errno?.toString() ?? "none"} ` +
      `code=${e.code?.toString() ?? "none"} ` +
      `syscall=${e.syscall?.toString() ?? "none"}`
    );
    throw error;
  }

  try {
    candidate = await getUserByOpenId(input.canonicalOpenId);
    if (!candidate) {
      throw new Error("Canonical user could not be resolved");
    }
    console.error("[RESOLVE_OPENID_OK]");
  } catch (error) {
    const cause = (error as { cause?: unknown })?.cause;
    const source = cause ?? error;
    const e = source as { code?: unknown; errno?: unknown; syscall?: unknown };
    const message = (source as { message?: unknown })?.message?.toString() ?? "none";
    console.error(
      `[RESOLVE_OPENID_ERROR] ` +
      `error_name=${error?.constructor?.name ?? "Error"} ` +
      `message=${message} ` +
      `errno=${e.errno?.toString() ?? "none"} ` +
      `code=${e.code?.toString() ?? "none"} ` +
      `syscall=${e.syscall?.toString() ?? "none"}`
    );
    throw error;
  }

  try {
    await linkProviderIdentityToUser({
      provider: input.provider,
      providerSubject: input.providerSubject,
      userId: candidate!.id,
    });
    console.error("[RESOLVE_LINK_OK]");
  } catch (error) {
    const cause = (error as { cause?: unknown })?.cause;
    const source = cause ?? error;
    const e = source as { code?: unknown; errno?: unknown; syscall?: unknown };
    const message = (source as { message?: unknown })?.message?.toString() ?? "none";
    console.error(
      `[RESOLVE_LINK_ERROR] ` +
      `error_name=${error?.constructor?.name ?? "Error"} ` +
      `message=${message} ` +
      `errno=${e.errno?.toString() ?? "none"} ` +
      `code=${e.code?.toString() ?? "none"} ` +
      `syscall=${e.syscall?.toString() ?? "none"}`
    );
    throw error;
  }

  try {
    const mapped = await getUserByProviderIdentity(input.provider, input.providerSubject);
    if (!mapped) {
      throw new Error("Provider identity mapping could not be resolved");
    }
    console.error("[RESOLVE_FINAL_LOOKUP_OK]");
    return mapped;
  } catch (error) {
    console.error(`[RESOLVE_FINAL_LOOKUP_ERROR] error_name=${error?.constructor?.name ?? "Error"}`);
    throw error;
  }
}

function requireDatabase(db: Awaited<ReturnType<typeof getDb>>) {
  if (!db) throw new Error("Хранилище историй временно недоступно.");
  return db;
}

export async function listChatSessions(userId: number): Promise<ChatSession[]> {
  const db = requireDatabase(await getDb());
  return db.select().from(chatSessions).where(eq(chatSessions.userId, userId)).orderBy(desc(chatSessions.updatedAt));
}

export async function createChatSession(userId: number, modelId: string, title = "Новый разговор"): Promise<ChatSession> {
  const db = requireDatabase(await getDb());
  const session: ChatSession = { id: randomUUID(), userId, modelId, title, createdAt: new Date(), updatedAt: new Date() };
  await db.insert(chatSessions).values(session);
  return session;
}

export async function getOwnedChatSession(userId: number, sessionId: string): Promise<ChatSession | undefined> {
  const db = requireDatabase(await getDb());
  const result = await db.select().from(chatSessions).where(and(eq(chatSessions.id, sessionId), eq(chatSessions.userId, userId))).limit(1);
  return result[0];
}

export async function getOwnedChatDraft(userId: number, sessionId: string) {
  const db = requireDatabase(await getDb());
  requireOwnedSession(userId, await getOwnedChatSession(userId, sessionId));
  const rows = await db.select({ content: chatDrafts.content, updatedAt: chatDrafts.updatedAt })
    .from(chatDrafts).where(and(eq(chatDrafts.userId, userId), eq(chatDrafts.sessionId, sessionId))).limit(1);
  return rows[0] ?? null;
}

export async function saveOwnedChatDraft(userId: number, sessionId: string, content: string) {
  const db = requireDatabase(await getDb());
  requireOwnedSession(userId, await getOwnedChatSession(userId, sessionId));
  const normalized = content.slice(0, 16_000);
  if (!normalized) {
    await db.delete(chatDrafts).where(and(eq(chatDrafts.userId, userId), eq(chatDrafts.sessionId, sessionId)));
    return null;
  }
  const now = new Date();
  await db.insert(chatDrafts).values({ userId, sessionId, content: normalized, createdAt: now, updatedAt: now })
    .onDuplicateKeyUpdate({ set: { content: normalized, updatedAt: now } });
  return { content: normalized, updatedAt: now };
}

export async function clearOwnedChatDraft(userId: number, sessionId: string) {
  const db = requireDatabase(await getDb());
  requireOwnedSession(userId, await getOwnedChatSession(userId, sessionId));
  await db.delete(chatDrafts).where(and(eq(chatDrafts.userId, userId), eq(chatDrafts.sessionId, sessionId)));
  return { success: true } as const;
}

export function requireOwnedSession<T extends Pick<ChatSession, "userId">>(userId: number, session: T | undefined): T {
  if (!session || session.userId !== userId) throw new Error("Чат не найден или недоступен.");
  return session;
}

export async function listSessionMessages(userId: number, sessionId: string): Promise<ChatMessageRecord[]> {
  const db = requireDatabase(await getDb());
  requireOwnedSession(userId, await getOwnedChatSession(userId, sessionId));
  return db.select().from(messages).where(eq(messages.sessionId, sessionId)).orderBy(asc(messages.createdAt), asc(messages.id));
}

/** Resolves exactly one message after the same verified session ownership boundary. */
export async function getOwnedSessionMessage(userId: number, sessionId: string, messageId: number) {
  const db = requireDatabase(await getDb());
  requireOwnedSession(userId, await getOwnedChatSession(userId, sessionId));
  return (await db.select().from(messages).where(and(eq(messages.sessionId, sessionId), eq(messages.id, messageId))).limit(1))[0];
}

/**
 * Bounded, owner-scoped candidate read for a single LLM request. The separate
 * legacy listSessionMessages contract intentionally remains full-history for
 * exports and compatibility callers.
 */
export async function listSessionTranscriptWindow(userId: number, sessionId: string, role: TranscriptRole, input: { beforeMessageId?: number; throughMessageId?: number } = {}) {
  const db = requireDatabase(await getDb());
  requireOwnedSession(userId, await getOwnedChatSession(userId, sessionId));
  if (input.beforeMessageId && input.throughMessageId) throw new Error("Для transcript window разрешён только один boundary.");
  const boundaryMessageId = input.beforeMessageId ?? input.throughMessageId;
  const boundaryRecord = boundaryMessageId
    ? (await db.select({ id: messages.id, createdAt: messages.createdAt }).from(messages)
      .where(and(eq(messages.sessionId, sessionId), eq(messages.id, boundaryMessageId))).limit(1))[0]
    : undefined;
  if (boundaryMessageId && !boundaryRecord) throw new Error("Исходное сообщение для context не найдено.");
  const boundary = input.beforeMessageId && boundaryRecord
    ? and(eq(messages.sessionId, sessionId), or(lt(messages.createdAt, boundaryRecord.createdAt), and(eq(messages.createdAt, boundaryRecord.createdAt), lt(messages.id, boundaryRecord.id))))
    : input.throughMessageId && boundaryRecord
      ? and(eq(messages.sessionId, sessionId), or(lt(messages.createdAt, boundaryRecord.createdAt), and(eq(messages.createdAt, boundaryRecord.createdAt), lte(messages.id, boundaryRecord.id))))
    : eq(messages.sessionId, sessionId);
  const budget = TRANSCRIPT_WINDOW_BUDGETS[role];
  const newestFirst = await db.select().from(messages).where(boundary)
    .orderBy(desc(messages.createdAt), desc(messages.id)).limit(budget.maxCandidateMessages);
  return selectTranscriptWindow(role, [...newestFirst].reverse());
}

function historyCursorSecret() {
  if (!ENV.cookieSecret) throw new Error("Безопасная пагинация истории временно недоступна.");
  return ENV.cookieSecret;
}

/**
 * Opt-in user-scoped history page. The legacy full-history helper remains the
 * contract for exports and existing compatibility callers; LLM context uses
 * the separate bounded transcript helper above.
 */
export async function listSessionMessagesPage(userId: number, sessionId: string, input: { before?: string; limit?: number } = {}) {
  const db = requireDatabase(await getDb());
  requireOwnedSession(userId, await getOwnedChatSession(userId, sessionId));
  const cursorSecret = historyCursorSecret();
  const limit = normalizeHistoryPageLimit(input.limit);
  const cursor = input.before ? decodeHistoryPageCursor(cursorSecret, sessionId, input.before) : null;
  if (input.before && !cursor) throw new Error("Некорректный курсор истории.");
  const beforeDate = cursor ? new Date(cursor.createdAt) : null;
  const where = cursor && beforeDate
    ? and(eq(messages.sessionId, sessionId), or(lt(messages.createdAt, beforeDate), and(eq(messages.createdAt, beforeDate), lt(messages.id, cursor.id))))
    : eq(messages.sessionId, sessionId);
  const rows = await db.select().from(messages).where(where).orderBy(desc(messages.createdAt), desc(messages.id)).limit(limit + 1);
  const hasOlder = rows.length > limit;
  const newestFirstPage = hasOlder ? rows.slice(0, limit) : rows;
  const oldest = newestFirstPage[newestFirstPage.length - 1];
  return {
    messages: [...newestFirstPage].reverse(),
    nextCursor: hasOlder && oldest ? encodeHistoryPageCursor(cursorSecret, sessionId, { createdAt: oldest.createdAt.getTime(), id: oldest.id }) : null,
    pageSize: limit,
  };
}

/**
 * Appends a message once. A client UUID is accepted only for original user
 * messages; retries return `created: false` without creating another record.
 */
export async function appendChatMessage(userId: number, sessionId: string, role: "user" | "assistant", content: string, modelId?: string, metadata?: string, clientMessageId?: string): Promise<{ created: boolean; id: number }> {
  const db = requireDatabase(await getDb());
  requireOwnedSession(userId, await getOwnedChatSession(userId, sessionId));
  const safeClientMessageId = role === "user" ? clientMessageId : undefined;
  if (safeClientMessageId) {
    const [existing] = await db.select({ id: messages.id }).from(messages)
      .where(and(eq(messages.sessionId, sessionId), eq(messages.clientMessageId, safeClientMessageId)))
      .limit(1);
    if (existing) return { created: false, id: existing.id };
  }
  try {
    const inserted = await db.insert(messages).values({ sessionId, role, content, modelId: modelId ?? null, metadata: metadata ?? null, clientMessageId: safeClientMessageId ?? null });
    const id = Number(inserted[0]?.insertId ?? 0);
    if (!Number.isInteger(id) || id <= 0) throw new Error("Не удалось сохранить сообщение.");
    await db.update(chatSessions).set({ updatedAt: new Date(), ...(modelId ? { modelId } : {}) }).where(eq(chatSessions.id, sessionId));
    return { created: true, id };
  } catch (error) {
    if (!safeClientMessageId) throw error;
    const [existing] = await db.select({ id: messages.id }).from(messages)
      .where(and(eq(messages.sessionId, sessionId), eq(messages.clientMessageId, safeClientMessageId)))
      .limit(1);
    if (existing) return { created: false, id: existing.id };
    throw error;
  }
}

/** Retrieves only the assistant message immediately following an idempotent user send. */
export async function getStoredAssistantForClientMessage(userId: number, sessionId: string, clientMessageId: string): Promise<ChatMessageRecord | undefined> {
  const db = requireDatabase(await getDb());
  requireOwnedSession(userId, await getOwnedChatSession(userId, sessionId));
  const [userMessage] = await db.select({ id: messages.id }).from(messages)
    .where(and(
      eq(messages.sessionId, sessionId),
      eq(messages.clientMessageId, clientMessageId),
      eq(messages.role, "user"),
    ))
    .limit(1);
  if (!userMessage) return undefined;
  const [followingMessage] = await db.select().from(messages)
    .where(and(
      eq(messages.sessionId, sessionId),
      gt(messages.id, userMessage.id),
    ))
    .orderBy(asc(messages.id))
    .limit(1);
  return followingMessage?.role === "assistant" ? followingMessage : undefined;
}

export async function updateChatTitle(userId: number, sessionId: string, title: string): Promise<boolean> {
  const db = requireDatabase(await getDb());
  const result = await db.update(chatSessions).set({ title, updatedAt: new Date() }).where(and(eq(chatSessions.id, sessionId), eq(chatSessions.userId, userId)));
  return Number(result[0]?.affectedRows ?? 0) > 0;
}

export async function deleteOwnedChatSession(userId: number, sessionId: string): Promise<boolean> {
  const db = requireDatabase(await getDb());
  const owned = await db.select({ id: chatSessions.id }).from(chatSessions)
    .where(and(eq(chatSessions.id, sessionId), eq(chatSessions.userId, userId))).limit(1);
  if (!owned[0]) return false;
  // Remove only this user's topics for the owned session before its foreign key is nulled.
  await db.delete(memoryEntries).where(and(
    eq(memoryEntries.userId, userId),
    eq(memoryEntries.category, "dialog_topic"),
    eq(memoryEntries.sessionId, sessionId),
  ));
  const result = await db.delete(chatSessions).where(and(eq(chatSessions.id, sessionId), eq(chatSessions.userId, userId)));
  return result[0].affectedRows > 0;
}

/** Deletes only one user's chats and their dialog topics; other users' records are never selected or removed. */
export async function deleteAllOwnedChatSessions(userId: number): Promise<number> {
  const db = requireDatabase(await getDb());
  const sessions = await db.select({ id: chatSessions.id }).from(chatSessions).where(eq(chatSessions.userId, userId));
  const sessionIds = sessions.map((session) => session.id);
  if (!sessionIds.length) return 0;
  await db.delete(memoryEntries).where(and(
    eq(memoryEntries.userId, userId),
    eq(memoryEntries.category, "dialog_topic"),
    inArray(memoryEntries.sessionId, sessionIds),
  ));
  const result = await db.delete(chatSessions).where(eq(chatSessions.userId, userId));
  return Number(result[0]?.affectedRows ?? 0);
}

export async function listProviderHealth(): Promise<ProviderHealthRecord[]> {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(providerHealth);
}

export async function upsertProviderHealth(input: Omit<ProviderHealthRecord, "updatedAt">): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.insert(providerHealth).values(input).onDuplicateKeyUpdate({
    set: {
      state: input.state,
      category: input.category,
      http: input.http,
      confirmed: input.confirmed,
      checkedAt: input.checkedAt,
      blockedUntil: input.blockedUntil,
    },
  });
  await db.insert(providerHealthHistory).values({
    provider: input.provider,
    state: input.state,
    category: input.category,
    http: input.http,
    checkedAt: input.checkedAt,
  });
  const retention = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  await db.delete(providerHealthHistory).where(sql`${providerHealthHistory.checkedAt} < ${retention}`);
}

/** Returns a bounded readiness aggregate, never raw diagnostic probe details. */
export async function getProviderAvailability(provider: string, days = 30): Promise<{ samples: number; ready: number; uptime: number }> {
  const db = await getDb();
  if (!db) return { samples: 0, ready: 0, uptime: 0 };
  const since = new Date(Date.now() - Math.max(1, Math.min(days, 30)) * 24 * 60 * 60 * 1000);
  const rows = await db.select({ state: providerHealthHistory.state }).from(providerHealthHistory)
    .where(and(eq(providerHealthHistory.provider, provider), gt(providerHealthHistory.checkedAt, since)));
  const ready = rows.filter((row) => row.state === "ready").length;
  return { samples: rows.length, ready, uptime: rows.length ? Math.round((ready / rows.length) * 1000) / 10 : 0 };
}

export type ProviderControlFlagInput = {
  targetKey: string;
  targetType: "provider" | "model";
  disabled: boolean;
  preference: "normal" | "prefer" | "avoid";
  actorUserId: number;
};

export async function listProviderControlFlags() {
  const db = await getDb();
  if (!db) return [];
  return db.select({ targetKey: providerControlFlags.targetKey, targetType: providerControlFlags.targetType, disabled: providerControlFlags.disabled, preference: providerControlFlags.preference, updatedAt: providerControlFlags.updatedAt })
    .from(providerControlFlags).orderBy(desc(providerControlFlags.updatedAt));
}

export async function upsertProviderControlFlag(input: ProviderControlFlagInput) {
  const db = requireDatabase(await getDb());
  const now = new Date();
  await db.insert(providerControlFlags).values({ targetKey: input.targetKey, targetType: input.targetType, disabled: input.disabled ? 1 : 0, preference: input.preference, updatedByUserId: input.actorUserId, createdAt: now, updatedAt: now })
    .onDuplicateKeyUpdate({ set: { targetType: input.targetType, disabled: input.disabled ? 1 : 0, preference: input.preference, updatedByUserId: input.actorUserId, updatedAt: now } });
  return { targetKey: input.targetKey, targetType: input.targetType, disabled: input.disabled, preference: input.preference, updatedAt: now };
}

/** Stores only bounded diagnostic metadata with 30-day retention. */
export async function recordTechnicalEvent(input: { kind: "provider" | "fallback" | "search" | "owner_flag" | "attachment"; title: string; code?: string; roleId?: string; actorUserId?: number }) {
  const db = await getDb();
  if (!db) return;
  await db.insert(technicalEvents).values({ kind: input.kind, title: input.title.slice(0, 220), code: input.code?.slice(0, 48) ?? null, roleId: input.roleId?.slice(0, 24) ?? null, actorUserId: input.actorUserId ?? null });
  const retention = new Date(Date.now() - 30 * 24 * 60 * 60 * 1_000);
  await db.delete(technicalEvents).where(sql`${technicalEvents.createdAt} < ${retention}`);
}

export async function getOwnerObservabilitySnapshot() {
  const db = await getDb();
  if (!db) return { providers: [], events: [], memory: { facts: 0, topics: 0, profiles: 0 }, search: { samples24h: 0, outages24h: 0 } };
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1_000);
  const [providers, events, factRows, topicRows, profileRows, searchRows, outageRows] = await Promise.all([
    db.select({ provider: providerHealth.provider, state: providerHealth.state, category: providerHealth.category, checkedAt: providerHealth.checkedAt, blockedUntil: providerHealth.blockedUntil }).from(providerHealth).orderBy(asc(providerHealth.provider)),
    db.select({ id: technicalEvents.id, kind: technicalEvents.kind, title: technicalEvents.title, code: technicalEvents.code, roleId: technicalEvents.roleId, createdAt: technicalEvents.createdAt }).from(technicalEvents).orderBy(desc(technicalEvents.createdAt)).limit(30),
    db.select({ count: sql<number>`count(*)` }).from(memoryFacts),
    db.select({ count: sql<number>`count(*)` }).from(memoryEntries).where(eq(memoryEntries.category, "dialog_topic")),
    db.select({ count: sql<number>`count(*)` }).from(memoryProfiles),
    db.select({ count: sql<number>`count(*)` }).from(searchQualityMetrics).where(gt(searchQualityMetrics.createdAt, since24h)),
    db.select({ count: sql<number>`count(*)` }).from(searchOutageLogs).where(gt(searchOutageLogs.createdAt, since24h)),
  ]);
  return { providers, events, memory: { facts: Number(factRows[0]?.count ?? 0), topics: Number(topicRows[0]?.count ?? 0), profiles: Number(profileRows[0]?.count ?? 0) }, search: { samples24h: Number(searchRows[0]?.count ?? 0), outages24h: Number(outageRows[0]?.count ?? 0) } };
}

type PublicAvailabilityState = "ready" | "cooldown" | "auth_failed" | "unavailable" | "not_configured";
type PublicAvailabilityAggregate = { samples: number; ready: number; uptime: number };

/**
 * Bounded public history DTO. It deliberately excludes HTTP details, failure categories,
 * model IDs, probe routes and all fallback information.
 */
export async function getPublicProviderAvailabilityHistory(provider: string): Promise<{
  uptime24h: PublicAvailabilityAggregate;
  uptime7d: PublicAvailabilityAggregate;
  segments24h: Array<{ at: string; state: PublicAvailabilityState | "unknown" }>;
  events: Array<{ at: string; state: PublicAvailabilityState }>;
}> {
  const db = await getDb();
  const now = new Date();
  const hourMs = 60 * 60 * 1000;
  const start24h = new Date(now.getTime() - 24 * hourMs);
  const start7d = new Date(now.getTime() - 7 * 24 * hourMs);
  const emptyAggregate = { samples: 0, ready: 0, uptime: 0 };
  const emptySegments = Array.from({ length: 24 }, (_, index) => ({
    at: new Date(start24h.getTime() + index * hourMs).toISOString(),
    state: "unknown" as const,
  }));
  if (!db) return { uptime24h: emptyAggregate, uptime7d: emptyAggregate, segments24h: emptySegments, events: [] };

  const rows = await db.select({ state: providerHealthHistory.state, checkedAt: providerHealthHistory.checkedAt })
    .from(providerHealthHistory)
    .where(and(eq(providerHealthHistory.provider, provider), gt(providerHealthHistory.checkedAt, start7d)))
    .orderBy(desc(providerHealthHistory.checkedAt))
    .limit(512);
  const toPublicState = (value: string): PublicAvailabilityState => {
    if (value === "ready" || value === "cooldown" || value === "auth_failed" || value === "unavailable" || value === "not_configured") return value;
    return "unavailable";
  };

  const aggregate = (since: Date): PublicAvailabilityAggregate => {
    const windowRows = rows.filter((row) => row.checkedAt > since);
    const ready = windowRows.filter((row) => row.state === "ready").length;
    return { samples: windowRows.length, ready, uptime: windowRows.length ? Math.round((ready / windowRows.length) * 1000) / 10 : 0 };
  };
  const segments24h: Array<{ at: string; state: PublicAvailabilityState | "unknown" }> = emptySegments.map((segment, index) => {
    const start = start24h.getTime() + index * hourMs;
    const end = start + hourMs;
    const newest = rows.find((row) => row.checkedAt.getTime() >= start && row.checkedAt.getTime() < end);
    return { ...segment, state: newest ? toPublicState(newest.state) : "unknown" as const };
  });
  return {
    uptime24h: aggregate(start24h),
    uptime7d: aggregate(start7d),
    segments24h,
    events: rows.slice(0, 8).map((row) => ({ at: row.checkedAt.toISOString(), state: toPublicState(row.state) })),
  };
}

function utcDayKey(date = new Date()) { return date.toISOString().slice(0, 10); }

/** Counts only successful final answers and never stores prompt, user or model details. */
export async function incrementProviderDailySuccess(provider: string, dayKey = utcDayKey()): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.insert(providerDailyUsage).values({ provider, dayKey, successCount: 1 }).onDuplicateKeyUpdate({
    set: { successCount: sql`${providerDailyUsage.successCount} + 1` },
  });
}

export async function getProviderDailySuccess(provider: string, dayKey = utcDayKey()): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  const row = await db.select({ successCount: providerDailyUsage.successCount }).from(providerDailyUsage)
    .where(and(eq(providerDailyUsage.provider, provider), eq(providerDailyUsage.dayKey, dayKey))).limit(1);
  return row[0]?.successCount ?? 0;
}

/** Stores only a bounded timing sample; all identifiers and conversational content are intentionally excluded. */
export async function recordFlashTtftMetric(durationMs: number): Promise<void> {
  const db = await getDb();
  if (!db) return;
  const safeDuration = Math.max(0, Math.min(Math.round(durationMs), 120_000));
  await db.insert(flashTtftMetrics).values({ durationMs: safeDuration });
  const retention = new Date(Date.now() - 90 * 24 * 60 * 60 * 1_000);
  await db.delete(flashTtftMetrics).where(sql`${flashTtftMetrics.createdAt} < ${retention}`);
}

export type FlashTtftWindowStats = { samples: number; p50Ms: number | null; p95Ms: number | null };
export type FlashTtftStats = { last24h: FlashTtftWindowStats; last7d: FlashTtftWindowStats };

/** Owner-safe aggregates: only quantiles over anonymous Flash timings from the last 24 hours and 7 days. */
export async function getFlashTtftStats(): Promise<FlashTtftStats> {
  const db = await getDb();
  const empty: FlashTtftWindowStats = { samples: 0, p50Ms: null, p95Ms: null };
  if (!db) return { last24h: empty, last7d: empty };
  const now = Date.now();
  const since = new Date(now - 7 * 24 * 60 * 60 * 1_000);
  const rows = await db.select({ durationMs: flashTtftMetrics.durationMs, createdAt: flashTtftMetrics.createdAt }).from(flashTtftMetrics)
    .where(gt(flashTtftMetrics.createdAt, since)).orderBy(asc(flashTtftMetrics.durationMs)).limit(2_000);
  const aggregate = (durations: number[]): FlashTtftWindowStats => {
    if (!durations.length) return { samples: 0, p50Ms: null, p95Ms: null };
    const sorted = [...durations].sort((left, right) => left - right);
    const quantile = (percentile: number) => sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * percentile) - 1)]!;
    return { samples: sorted.length, p50Ms: quantile(0.5), p95Ms: quantile(0.95) };
  };
  const last24hCutoff = now - 24 * 60 * 60 * 1_000;
  return {
    last24h: aggregate(rows.filter((row) => row.createdAt.getTime() >= last24hCutoff).map((row) => row.durationMs)),
    last7d: aggregate(rows.map((row) => row.durationMs)),
  };
}

export type FlashTtftTrendPoint = { date: string; samples: number; p50Ms: number | null; p95Ms: number | null };

/** Owner-safe 7/30-day trend: anonymous timing values are reduced into daily quantiles only. */
export async function getFlashTtftTrend(days: 7 | 30): Promise<FlashTtftTrendPoint[]> {
  const db = await getDb();
  const dayMs = 24 * 60 * 60 * 1_000;
  const start = new Date(Date.now() - (days - 1) * dayMs);
  start.setUTCHours(0, 0, 0, 0);
  const aggregate = (durations: number[]): Omit<FlashTtftTrendPoint, "date"> => {
    if (!durations.length) return { samples: 0, p50Ms: null, p95Ms: null };
    const sorted = [...durations].sort((left, right) => left - right);
    const quantile = (percentile: number) => sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * percentile) - 1)]!;
    return { samples: sorted.length, p50Ms: quantile(0.5), p95Ms: quantile(0.95) };
  };
  const buckets = new Map<string, number[]>();
  for (let offset = 0; offset < days; offset += 1) {
    buckets.set(new Date(start.getTime() + offset * dayMs).toISOString().slice(0, 10), []);
  }
  if (db) {
    const rows = await db.select({ durationMs: flashTtftMetrics.durationMs, createdAt: flashTtftMetrics.createdAt }).from(flashTtftMetrics)
      .where(gt(flashTtftMetrics.createdAt, start)).orderBy(asc(flashTtftMetrics.createdAt)).limit(10_000);
    for (const row of rows) buckets.get(row.createdAt.toISOString().slice(0, 10))?.push(row.durationMs);
  }
  return Array.from(buckets.entries()).map(([date, durations]) => ({ date, ...aggregate(durations) }));
}

export type SearchOutageInput = {
	  layer: "you" | "serper" | "exa" | "firecrawl" | "google" | "tavily" | "openrouter";
  errorClass: "rate_limited" | "auth" | "not_found" | "http_error" | "network_error" | "no_sources" | "not_configured";
  latencyMs: number;
  fellBack: boolean;
};

/** Retains only bounded operational metadata for 30 days; prompts, URLs, sources, users and models are never stored. */
export async function recordSearchOutage(input: SearchOutageInput): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.insert(searchOutageLogs).values({
    layer: input.layer,
    errorClass: input.errorClass,
    latencyMs: Math.max(0, Math.min(Math.round(input.latencyMs), 30_000)),
    fellBack: input.fellBack ? 1 : 0,
  });
  const retention = new Date(Date.now() - 30 * 24 * 60 * 60 * 1_000);
  await db.delete(searchOutageLogs).where(sql`${searchOutageLogs.createdAt} < ${retention}`);
}

export type SearchOutageSummary = { last24h: number; last7d: number; recent: Array<{ layer: string; errorClass: string; latencyMs: number; fellBack: boolean; createdAt: string }> };

/** Narrow owner-only audit DTO; it deliberately excludes URLs, query text, sources, user data, providers and models. */
export async function getSearchOutageSummary(): Promise<SearchOutageSummary> {
  const db = await getDb();
  if (!db) return { last24h: 0, last7d: 0, recent: [] };
  const now = Date.now();
  const since = new Date(now - 7 * 24 * 60 * 60 * 1_000);
  const rows = await db.select().from(searchOutageLogs).where(gt(searchOutageLogs.createdAt, since)).orderBy(desc(searchOutageLogs.createdAt)).limit(80);
  const last24hCutoff = now - 24 * 60 * 60 * 1_000;
  return {
    last24h: rows.filter((row) => row.createdAt.getTime() >= last24hCutoff).length,
    last7d: rows.length,
    recent: rows.slice(0, 20).map((row) => ({ layer: row.layer, errorClass: row.errorClass, latencyMs: row.latencyMs, fellBack: Boolean(row.fellBack), createdAt: row.createdAt.toISOString() })),
  };
}

export type SearchQualityInput = {
  outcome: "found" | "empty" | "degraded" | "error";
  verification: "verified" | "no_results" | "degraded" | "unavailable";
  verifiedSourceCount: number;
  attemptedLayerCount: number;
  staleBlocked: boolean;
  latencyMs: number;
};

type SearchQualityPeriod = {
  sampleCount: number;
  counts: Record<SearchQualityInput["outcome"], number>;
  verifiedSourceCount: number;
  zeroSourceCount: number;
  staleBlockedCount: number;
  foundRate: number;
  verificationPassRate: number;
};

export type SearchQualityPanel = { last24h: SearchQualityPeriod; last7d: SearchQualityPeriod };

function summarizeSearchQuality(rows: Array<{ outcome: SearchQualityInput["outcome"]; verification: SearchQualityInput["verification"]; verifiedSourceCount: number; staleBlocked: number }>): SearchQualityPeriod {
  const counts: SearchQualityPeriod["counts"] = { found: 0, empty: 0, degraded: 0, error: 0 };
  let verifiedSourceCount = 0;
  let zeroSourceCount = 0;
  let staleBlockedCount = 0;
  let verificationPassCount = 0;
  for (const row of rows) {
    counts[row.outcome] += 1;
    verifiedSourceCount += row.verifiedSourceCount;
    if (row.verifiedSourceCount === 0) zeroSourceCount += 1;
    if (row.staleBlocked) staleBlockedCount += 1;
    if (row.verification === "verified") verificationPassCount += 1;
  }
  const sampleCount = rows.length;
  return {
    sampleCount,
    counts,
    verifiedSourceCount,
    zeroSourceCount,
    staleBlockedCount,
    foundRate: sampleCount ? Math.round((counts.found / sampleCount) * 10_000) / 100 : 0,
    verificationPassRate: sampleCount ? Math.round((verificationPassCount / sampleCount) * 10_000) / 100 : 0,
  };
}

/** Stores bounded operational quality metadata only; request text, URLs, source identities, users, providers and models are never persisted. */
export async function recordSearchQuality(input: SearchQualityInput): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.insert(searchQualityMetrics).values({
    outcome: input.outcome,
    verification: input.verification,
    verifiedSourceCount: Math.max(0, Math.min(Math.round(input.verifiedSourceCount), 5)),
    attemptedLayerCount: Math.max(0, Math.min(Math.round(input.attemptedLayerCount), 3)),
    staleBlocked: input.staleBlocked ? 1 : 0,
    latencyMs: Math.max(0, Math.min(Math.round(input.latencyMs), 30_000)),
  });
}

/** Existing daily heartbeat cleanup retains anonymous quality metrics for at most 90 days. */
export async function cleanupSearchQualityMetrics(): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  const retention = new Date(Date.now() - 90 * 24 * 60 * 60 * 1_000);
  const result = await db.delete(searchQualityMetrics).where(sql`${searchQualityMetrics.createdAt} < ${retention}`);
  return Number((result as { rowsAffected?: number } | undefined)?.rowsAffected ?? 0);
}

/** Narrow owner-only quality DTO. It contains aggregate numbers only and deliberately omits content, identity and routing data. */
export async function getSearchQualityPanel(): Promise<SearchQualityPanel> {
  const db = await getDb();
  const empty = summarizeSearchQuality([]);
  if (!db) return { last24h: empty, last7d: empty };
  const now = Date.now();
  const since7d = new Date(now - 7 * 24 * 60 * 60 * 1_000);
  const since24h = now - 24 * 60 * 60 * 1_000;
  const rows = await db.select({ outcome: searchQualityMetrics.outcome, verification: searchQualityMetrics.verification, verifiedSourceCount: searchQualityMetrics.verifiedSourceCount, staleBlocked: searchQualityMetrics.staleBlocked, createdAt: searchQualityMetrics.createdAt })
    .from(searchQualityMetrics).where(gt(searchQualityMetrics.createdAt, since7d)).orderBy(desc(searchQualityMetrics.createdAt)).limit(20_000);
  return {
    last24h: summarizeSearchQuality(rows.filter((row) => row.createdAt.getTime() >= since24h)),
    last7d: summarizeSearchQuality(rows),
  };
}

type SearchQualityOutcomeCounts = Record<SearchQualityInput["outcome"], number>;
export type SearchQualityChart = {
  daily: Array<{ date: string; requests: number; success: number; failures_by_layer: { layer_1: number; layer_2: number; layer_3: number }; p50: number; p95: number }>;
  hourlyLayers: Array<{ hour: string; layer1: number; layer2: number; layer3: number }>;
};

function emptyOutcomeCounts(): SearchQualityOutcomeCounts {
  return { found: 0, empty: 0, degraded: 0, error: 0 };
}

function utcDay(date: Date) { return date.toISOString().slice(0, 10); }
function utcHour(date: Date) { return date.toISOString().slice(0, 13); }

function emptyFailureLayers() { return { layer_1: 0, layer_2: 0, layer_3: 0 }; }
function percentile(values: number[], fraction: number) {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * fraction) - 1))]!;
}
function recordAnonymousLayerFailures(target: { layer1: number; layer2: number; layer3: number }, outcome: SearchQualityInput["outcome"], attemptedLayerCount: number) {
  const attempts = Math.max(0, Math.min(3, attemptedLayerCount));
  for (let layer = 1; layer < attempts; layer += 1) target[`layer${layer}` as "layer1" | "layer2" | "layer3"] += 1;
  if ((outcome === "degraded" || outcome === "error") && attempts > 0) target[`layer${attempts}` as "layer1" | "layer2" | "layer3"] += 1;
}

/**
 * Owner chart data is anonymous by construction. "layer1..3" is deliberately
 * ordinal rather than a provider name, so it exposes cascade quality without
 * revealing routing topology, user content, source identities or URLs.
 */
export async function getSearchQualityChart(now = new Date()): Promise<SearchQualityChart> {
  const db = await getDb();
  const dailyMap = new Map<string, { requests: number; success: number; failures: { layer1: number; layer2: number; layer3: number }; latencies: number[] }>();
  const hourlyMap = new Map<string, { layer1: number; layer2: number; layer3: number }>();
  const startDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 6));
  for (let offset = 0; offset < 7; offset += 1) {
    const date = new Date(startDay.getTime() + offset * 86_400_000);
    dailyMap.set(utcDay(date), { requests: 0, success: 0, failures: { layer1: 0, layer2: 0, layer3: 0 }, latencies: [] });
  }
  const startHour = new Date(now);
  startHour.setUTCMinutes(0, 0, 0);
  startHour.setUTCHours(startHour.getUTCHours() - 23);
  for (let offset = 0; offset < 24; offset += 1) {
    const date = new Date(startHour.getTime() + offset * 3_600_000);
    hourlyMap.set(utcHour(date), { layer1: 0, layer2: 0, layer3: 0 });
  }
  if (db) {
    const since = new Date(Math.min(startDay.getTime(), startHour.getTime()));
    const rows = await db.select({ outcome: searchQualityMetrics.outcome, attemptedLayerCount: searchQualityMetrics.attemptedLayerCount, latencyMs: searchQualityMetrics.latencyMs, createdAt: searchQualityMetrics.createdAt })
      .from(searchQualityMetrics).where(gt(searchQualityMetrics.createdAt, since)).orderBy(desc(searchQualityMetrics.createdAt)).limit(20_000);
    for (const row of rows) {
      const day = dailyMap.get(utcDay(row.createdAt));
      if (day) {
        day.requests += 1;
        if (row.outcome === "found") day.success += 1;
        day.latencies.push(Math.max(0, row.latencyMs));
        recordAnonymousLayerFailures(day.failures, row.outcome, row.attemptedLayerCount);
      }
      const hour = hourlyMap.get(utcHour(row.createdAt));
      if (hour) recordAnonymousLayerFailures(hour, row.outcome, row.attemptedLayerCount);
    }
  }
  return {
    daily: Array.from(dailyMap.entries()).map(([date, aggregate]) => ({ date, requests: aggregate.requests, success: aggregate.success, failures_by_layer: { layer_1: aggregate.failures.layer1, layer_2: aggregate.failures.layer2, layer_3: aggregate.failures.layer3 }, p50: percentile(aggregate.latencies, 0.5), p95: percentile(aggregate.latencies, 0.95) })),
    hourlyLayers: Array.from(hourlyMap.entries()).map(([hour, counts]) => ({ hour: `${hour.slice(11, 13)}:00`, ...counts })),
  };
}

export type RoleRuntimeStatusRecord = {
  roleId: "fast" | "smart" | "context" | "flagship";
  state: "ready" | "backup" | "unavailable";
  provider: string | null;
  modelUsed: string | null;
  checkedAt: Date;
};

export async function listRoleRuntimeStatus(): Promise<RoleRuntimeStatusRecord[]> {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(roleRuntimeStatus) as Promise<RoleRuntimeStatusRecord[]>;
}

export async function upsertRoleRuntimeStatus(input: RoleRuntimeStatusRecord): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.insert(roleRuntimeStatus).values(input).onDuplicateKeyUpdate({
    set: {
      state: input.state,
      provider: input.provider,
      modelUsed: input.modelUsed,
      checkedAt: input.checkedAt,
    },
  });
}

export async function getWebSearchStatus(): Promise<WebSearchStatusRecord | undefined> {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(webSearchStatus).where(eq(webSearchStatus.key, "google_grounding")).limit(1);
  return result[0];
}

export type WebSearchStatusInput = Omit<WebSearchStatusRecord, "updatedAt" | "youHttp" | "serperHttp" | "exaHttp"> & Partial<Pick<WebSearchStatusRecord, "youHttp" | "serperHttp" | "exaHttp">>;

export async function upsertWebSearchStatus(input: WebSearchStatusInput): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.insert(webSearchStatus).values(input).onDuplicateKeyUpdate({
    set: {
      state: input.state,
      reason: input.reason,
      googleHttp: input.googleHttp,
      tavilyHttp: input.tavilyHttp,
      openrouterHttp: input.openrouterHttp,
			youHttp: input.youHttp ?? null,
			serperHttp: input.serperHttp ?? null,
			exaHttp: input.exaHttp ?? null,
      checkedAt: input.checkedAt,
    },
  });
}

export type UserSettingsPatch = Partial<Pick<UserSettings, "language" | "theme" | "responseStyle" | "responseLength" | "effort" | "thinking" | "defaultRole" | "webSearch" | "toolAccess" | "healthRefreshSeconds" | "highContrast" | "emailNotifications">>;
export type KnowledgeSourcePatch = Omit<KnowledgeSource, "updatedAt">;
export type KnowledgeDocumentInput = Omit<KnowledgeDocument, "retrievedAt" | "updatedAt">;
export type KnowledgeRunInput = Omit<KnowledgeIngestionRun, "startedAt" | "finishedAt">;

/** Ensures the stable official source row exists before dependent documents or audit runs are recorded. */
export async function ensureKnowledgeSource(input: Pick<KnowledgeSourcePatch, "id" | "displayName" | "feedUrl">): Promise<void> {
  const db = requireDatabase(await getDb());
  await db.insert(knowledgeSources).values({ ...input, state: "unknown", lastFetchedAt: null, lastSuccessAt: null, lastError: null, indexedCount: 0 }).onDuplicateKeyUpdate({
    set: { displayName: input.displayName, feedUrl: input.feedUrl },
  });
}

export async function upsertKnowledgeSource(input: KnowledgeSourcePatch): Promise<void> {
  const db = requireDatabase(await getDb());
  await db.insert(knowledgeSources).values(input).onDuplicateKeyUpdate({
    set: {
      displayName: input.displayName,
      feedUrl: input.feedUrl,
      state: input.state,
      lastFetchedAt: input.lastFetchedAt,
      lastSuccessAt: input.lastSuccessAt,
      lastError: input.lastError,
      indexedCount: input.indexedCount,
    },
  });
}

export async function listKnowledgeSources(): Promise<KnowledgeSource[]> {
  const db = requireDatabase(await getDb());
  return db.select().from(knowledgeSources).orderBy(asc(knowledgeSources.displayName));
}

export async function recordKnowledgeDocument(input: KnowledgeDocumentInput): Promise<"created" | "updated"> {
  const db = requireDatabase(await getDb());
  const existing = await db.select({ id: knowledgeDocuments.id }).from(knowledgeDocuments).where(eq(knowledgeDocuments.sourceUrl, input.sourceUrl)).limit(1);
  await db.insert(knowledgeDocuments).values(input).onDuplicateKeyUpdate({
    set: {
      sourceId: input.sourceId,
      title: input.title,
      excerpt: input.excerpt,
      fingerprint: input.fingerprint,
      publishedAt: input.publishedAt,
      retrievedAt: new Date(),
    },
  });
  return existing[0] ? "updated" : "created";
}

export async function trimKnowledgeDocuments(sourceId: string, maximum = 120): Promise<void> {
  const db = requireDatabase(await getDb());
  const rows = await db.select({ id: knowledgeDocuments.id, publishedAt: knowledgeDocuments.publishedAt }).from(knowledgeDocuments)
    .where(eq(knowledgeDocuments.sourceId, sourceId))
    .orderBy(desc(knowledgeDocuments.publishedAt), desc(knowledgeDocuments.retrievedAt));
  const cutoff = Date.now() - 90 * 24 * 60 * 60 * 1_000;
  const currentRows = rows.filter((row) => !row.publishedAt || row.publishedAt.getTime() >= cutoff);
  const staleIds = Array.from(new Set([
    ...rows.filter((row) => row.publishedAt && row.publishedAt.getTime() < cutoff).map((row) => row.id),
    ...currentRows.slice(maximum).map((row) => row.id),
  ]));
  if (staleIds.length) await db.delete(knowledgeDocuments).where(inArray(knowledgeDocuments.id, staleIds));
}

export async function listKnowledgeDocuments(limit = 160): Promise<KnowledgeDocument[]> {
  const db = requireDatabase(await getDb());
  return db.select().from(knowledgeDocuments).orderBy(desc(knowledgeDocuments.publishedAt), desc(knowledgeDocuments.retrievedAt)).limit(Math.min(Math.max(limit, 1), 240));
}

export async function createKnowledgeRun(input: KnowledgeRunInput): Promise<void> {
  const db = requireDatabase(await getDb());
  await db.insert(knowledgeIngestionRuns).values(input);
}

export async function finishKnowledgeRun(id: string, patch: Pick<KnowledgeIngestionRun, "state" | "fetchedCount" | "indexedCount" | "updatedCount" | "error">): Promise<void> {
  const db = requireDatabase(await getDb());
  await db.update(knowledgeIngestionRuns).set({ ...patch, finishedAt: new Date() }).where(eq(knowledgeIngestionRuns.id, id));
}

export async function listKnowledgeRuns(limit = 8): Promise<KnowledgeIngestionRun[]> {
  const db = requireDatabase(await getDb());
  return db.select().from(knowledgeIngestionRuns).orderBy(desc(knowledgeIngestionRuns.startedAt)).limit(Math.min(Math.max(limit, 1), 20));
}

export type DevApiAuditInput = Pick<DevApiAuditRecord, "outcome" | "status"> & { userId?: number };

/** Atomically increments a user's current fixed-minute bucket and returns whether it remains within the quota. */
export async function consumeDevApiRequestQuota(userId: number, limit = 30, windowMs = 60_000): Promise<{ allowed: boolean; retryAfterSeconds: number }> {
  const db = requireDatabase(await getDb());
  const now = new Date();
  const cutoff = new Date(now.getTime() - windowMs);
  await db.insert(devApiRateWindows).values({ userId, windowStarted: now, requestCount: 1 }).onDuplicateKeyUpdate({ set: {
    requestCount: sql`if(${devApiRateWindows.windowStarted} <= ${cutoff}, 1, ${devApiRateWindows.requestCount} + 1)`,
    windowStarted: sql`if(${devApiRateWindows.windowStarted} <= ${cutoff}, ${now}, ${devApiRateWindows.windowStarted})`,
  } });
  const rows = await db.select().from(devApiRateWindows).where(eq(devApiRateWindows.userId, userId)).limit(1);
  const current = rows[0];
  if (!current) throw new Error("Не удалось проверить лимит Dev API.");
  const elapsed = Math.max(0, now.getTime() - current.windowStarted.getTime());
  return { allowed: current.requestCount <= limit, retryAfterSeconds: Math.max(1, Math.ceil((windowMs - elapsed) / 1_000)) };
}

/** Atomically increments a user's ordinary chat ingress bucket without sharing admin Dev API quota state. */
export async function consumeChatStreamRequestQuota(userId: number, limit = 60, windowMs = 60_000): Promise<{ allowed: boolean; retryAfterSeconds: number }> {
  const db = requireDatabase(await getDb());
  const now = new Date();
  const cutoff = new Date(now.getTime() - windowMs);
  await db.insert(chatStreamRateWindows).values({ userId, windowStarted: now, requestCount: 1 }).onDuplicateKeyUpdate({ set: {
    requestCount: sql`if(${chatStreamRateWindows.windowStarted} <= ${cutoff}, 1, ${chatStreamRateWindows.requestCount} + 1)`,
    windowStarted: sql`if(${chatStreamRateWindows.windowStarted} <= ${cutoff}, ${now}, ${chatStreamRateWindows.windowStarted})`,
  } });
  const rows = await db.select().from(chatStreamRateWindows).where(eq(chatStreamRateWindows.userId, userId)).limit(1);
  const current = rows[0];
  if (!current) throw new Error("Не удалось проверить лимит chat stream.");
  const elapsed = Math.max(0, now.getTime() - current.windowStarted.getTime());
  return { allowed: current.requestCount <= limit, retryAfterSeconds: Math.max(1, Math.ceil((windowMs - elapsed) / 1_000)) };
}

/** Writes only outcome metadata; prompts, responses, credentials, headers and IP addresses are never persisted. */
export async function recordDevApiAudit(input: DevApiAuditInput): Promise<void> {
  const db = requireDatabase(await getDb());
  await db.insert(devApiAuditRecords).values({ id: randomUUID(), userId: input.userId ?? null, outcome: input.outcome, status: input.status });
}

export type MemoryProfilePatch = Partial<Pick<MemoryProfile, "enabled" | "autoExtract" | "profile" | "summary">>;
export type MemorySettingsPatch = Partial<Pick<MemorySettings, "enabled" | "autoExtract">>;
export type MemoryEntryCategory = "profile" | "fact" | "dialog_topic";
export type MemoryEntryRole = "fast" | "smart" | "context" | "flagship";
export type MemoryEntrySource = "manual" | "auto";

async function ensureUserSettings(userId: number): Promise<void> {
  const db = requireDatabase(await getDb());
  await db.insert(userSettings).values({ userId }).onDuplicateKeyUpdate({ set: { userId } });
}

export async function getUserSettings(userId: number): Promise<UserSettings> {
  const db = requireDatabase(await getDb());
  await ensureUserSettings(userId);
  const record = await db.select().from(userSettings).where(eq(userSettings.userId, userId)).limit(1);
  if (!record[0]) throw new Error("Не удалось подготовить настройки пользователя.");
  return record[0];
}

export async function updateUserSettings(userId: number, patch: UserSettingsPatch): Promise<UserSettings> {
  const db = requireDatabase(await getDb());
  await ensureUserSettings(userId);
  if (Object.keys(patch).length) await db.update(userSettings).set(patch).where(eq(userSettings.userId, userId));
  return getUserSettings(userId);
}

async function ensureMemoryProfile(userId: number): Promise<void> {
  const db = requireDatabase(await getDb());
  await db.insert(memoryProfiles).values({ userId, profile: "", summary: "" }).onDuplicateKeyUpdate({ set: { userId } });
}

export async function getMemoryProfile(userId: number): Promise<MemoryProfile> {
  const db = requireDatabase(await getDb());
  await ensureMemoryProfile(userId);
  const record = await db.select().from(memoryProfiles).where(eq(memoryProfiles.userId, userId)).limit(1);
  if (!record[0]) throw new Error("Не удалось подготовить память пользователя.");
  return record[0];
}

export async function updateMemoryProfile(userId: number, patch: MemoryProfilePatch): Promise<MemoryProfile> {
  const db = requireDatabase(await getDb());
  await ensureMemoryProfile(userId);
  if (Object.keys(patch).length) await db.update(memoryProfiles).set(patch).where(eq(memoryProfiles.userId, userId));
  const profile = await getMemoryProfile(userId);
  if (patch.profile !== undefined) {
    if (patch.profile.trim()) await upsertMemoryEntry(userId, "profile", patch.profile, { memoryKey: "profile", source: "manual" });
    else await clearMemoryByCategory(userId, "profile");
  }
  return profile;
}

/** Refreshes a read-only, bounded summary of automatic facts. A manual profile always takes precedence. */
export async function refreshAutoMemoryProfileSummary(userId: number): Promise<MemoryProfile> {
  const db = requireDatabase(await getDb());
  const profile = await getMemoryProfile(userId);
  if (profile.profile.trim()) return profile;
  const facts = (await listMemoryEntries(userId, "fact"))
    .filter((entry) => entry.source === "auto")
    .slice(0, 8)
    .map((entry) => entry.value)
    .join("\n")
    .slice(0, 1_800);
  if (profile.summary !== facts) await db.update(memoryProfiles).set({ summary: facts }).where(eq(memoryProfiles.userId, userId));
  return getMemoryProfile(userId);
}

async function ensureMemorySettings(userId: number): Promise<void> {
  const db = requireDatabase(await getDb());
  await db.insert(memorySettings).values({ userId }).onDuplicateKeyUpdate({ set: { userId } });
}

export async function getMemorySettings(userId: number): Promise<MemorySettings> {
  const db = requireDatabase(await getDb());
  await ensureMemorySettings(userId);
  const record = await db.select().from(memorySettings).where(eq(memorySettings.userId, userId)).limit(1);
  if (!record[0]) throw new Error("Не удалось подготовить настройки памяти пользователя.");
  return record[0];
}

export async function updateMemorySettings(userId: number, patch: MemorySettingsPatch): Promise<MemorySettings> {
  const db = requireDatabase(await getDb());
  await ensureMemorySettings(userId);
  if (Object.keys(patch).length) await db.update(memorySettings).set(patch).where(eq(memorySettings.userId, userId));
  return getMemorySettings(userId);
}

function normalizeMemoryEntry(value: string) {
  return value.trim().replace(/\s+/g, " ").slice(0, 500);
}

/** Lists entries belonging to the authenticated user, newest first, without capacity pruning. */
export async function listMemoryEntries(userId: number, category?: MemoryEntryCategory, options: { limit?: number } = {}): Promise<MemoryEntry[]> {
  const db = requireDatabase(await getDb());
  const query = db.select().from(memoryEntries).where(category
    ? and(eq(memoryEntries.userId, userId), eq(memoryEntries.category, category))
    : eq(memoryEntries.userId, userId)).orderBy(desc(memoryEntries.lastSeenAt), desc(memoryEntries.updatedAt), desc(memoryEntries.createdAt));
  const requestedLimit = Number.isSafeInteger(options.limit) ? Math.max(0, options.limit ?? 0) : 0;
  const limit = Math.min(requestedLimit, 100);
  const rows = limit > 0 ? await query.limit(limit) : await query;
  return rows;
}

/** Inserts or refreshes a canonical entry. Matching is case-insensitive and never crosses user boundaries. */
export async function upsertMemoryEntry(userId: number, category: MemoryEntryCategory, value: string, options: {
  memoryKey?: string | null;
  role?: MemoryEntryRole | null;
  source?: MemoryEntrySource;
  sourceMessageId?: number | null;
  sessionId?: string | null;
} = {}): Promise<MemoryEntry | null> {
  const db = requireDatabase(await getDb());
  const normalized = normalizeMemoryEntry(value);
  if (normalized.length < 3) return null;
  const existing = await db.select().from(memoryEntries).where(and(eq(memoryEntries.userId, userId), eq(memoryEntries.category, category)));
  const normalizedKey = options.memoryKey?.trim().slice(0, 160) || null;
  const now = new Date();
  const recentTopicCutoff = new Date(now.getTime() - 24 * 60 * 60 * 1_000);
  const match = existing.find((entry) => {
    const sameValue = entry.value.toLocaleLowerCase("ru-RU") === normalized.toLocaleLowerCase("ru-RU");
    if (category !== "dialog_topic") return (normalizedKey && entry.memoryKey === normalizedKey) || sameValue;
    const sameChat = Boolean(options.sessionId && entry.sessionId === options.sessionId);
    const sameTopic = Boolean(normalizedKey && entry.memoryKey === normalizedKey) || sameValue;
    return sameChat && sameTopic && entry.lastSeenAt >= recentTopicCutoff;
  });
  if (match) {
    await db.update(memoryEntries).set({
      value: normalized,
      memoryKey: normalizedKey,
      role: options.role ?? null,
      source: options.source ?? match.source,
      sourceMessageId: options.sourceMessageId ?? match.sourceMessageId,
      sessionId: options.sessionId ?? match.sessionId,
      lastSeenAt: now,
    }).where(and(eq(memoryEntries.id, match.id), eq(memoryEntries.userId, userId)));
    const [updated] = await db.select().from(memoryEntries).where(and(eq(memoryEntries.id, match.id), eq(memoryEntries.userId, userId))).limit(1);
    return updated ?? null;
  }
  const record: MemoryEntry = {
    id: randomUUID(), userId, category, value: normalized, memoryKey: normalizedKey, role: options.role ?? null,
    source: options.source ?? "manual", sessionId: options.sessionId ?? null, sourceMessageId: options.sourceMessageId ?? null,
    lastSeenAt: now, createdAt: now, updatedAt: now,
  };
  await db.insert(memoryEntries).values(record);
  const [stored] = await db.select().from(memoryEntries).where(and(eq(memoryEntries.id, record.id), eq(memoryEntries.userId, userId))).limit(1);
  return stored ?? null;
}

export async function updateMemoryEntry(userId: number, entryId: string, value: string): Promise<MemoryEntry | null> {
  const db = requireDatabase(await getDb());
  const normalized = normalizeMemoryEntry(value);
  if (normalized.length < 3) return null;
  const [entry] = await db.select().from(memoryEntries).where(and(eq(memoryEntries.id, entryId), eq(memoryEntries.userId, userId))).limit(1);
  if (!entry) return null;
  const duplicate = await db.select({ id: memoryEntries.id }).from(memoryEntries).where(and(
    eq(memoryEntries.userId, userId), eq(memoryEntries.category, entry.category), eq(memoryEntries.value, normalized),
  )).limit(1);
  if (duplicate[0] && duplicate[0].id !== entryId) return null;
  await db.update(memoryEntries).set({ value: normalized }).where(and(eq(memoryEntries.id, entryId), eq(memoryEntries.userId, userId)));
  const [updated] = await db.select().from(memoryEntries).where(and(eq(memoryEntries.id, entryId), eq(memoryEntries.userId, userId))).limit(1);
  return updated ?? null;
}

export async function deleteMemoryEntry(userId: number, entryId: string): Promise<boolean> {
  const db = requireDatabase(await getDb());
  const [entry] = await db.select({ category: memoryEntries.category }).from(memoryEntries)
    .where(and(eq(memoryEntries.id, entryId), eq(memoryEntries.userId, userId))).limit(1);
  const result = await db.delete(memoryEntries).where(and(eq(memoryEntries.id, entryId), eq(memoryEntries.userId, userId)));
  const deleted = Number(result[0]?.affectedRows ?? 0) > 0;
  if (deleted && entry?.category === "fact") await refreshAutoMemoryProfileSummary(userId);
  return deleted;
}

export async function deleteMemoryEntryByValue(userId: number, category: MemoryEntryCategory, value: string): Promise<boolean> {
  const db = requireDatabase(await getDb());
  const normalized = normalizeMemoryEntry(value);
  const rows = await db.select({ id: memoryEntries.id, value: memoryEntries.value }).from(memoryEntries)
    .where(and(eq(memoryEntries.userId, userId), eq(memoryEntries.category, category)));
  const match = rows.find((entry) => entry.value.toLocaleLowerCase("ru-RU") === normalized.toLocaleLowerCase("ru-RU"));
  return match ? deleteMemoryEntry(userId, match.id) : false;
}

export async function deleteMemoryEntryByKey(userId: number, category: MemoryEntryCategory, memoryKey: string): Promise<boolean> {
  const db = requireDatabase(await getDb());
  const [match] = await db.select({ id: memoryEntries.id }).from(memoryEntries).where(and(
    eq(memoryEntries.userId, userId), eq(memoryEntries.category, category), eq(memoryEntries.memoryKey, memoryKey.slice(0, 160)),
  )).limit(1);
  return match ? deleteMemoryEntry(userId, match.id) : false;
}

export async function clearMemoryByCategory(userId: number, category: MemoryEntryCategory): Promise<void> {
  const db = requireDatabase(await getDb());
  await db.delete(memoryEntries).where(and(eq(memoryEntries.userId, userId), eq(memoryEntries.category, category)));
  if (category === "profile") {
    await ensureMemoryProfile(userId);
    await db.update(memoryProfiles).set({ profile: "", summary: "" }).where(eq(memoryProfiles.userId, userId));
    return;
  }
  if (category === "fact") await refreshAutoMemoryProfileSummary(userId);
}

export async function clearAllMemory(userId: number): Promise<void> {
  const db = requireDatabase(await getDb());
  await db.delete(memoryEntries).where(eq(memoryEntries.userId, userId));
  await db.delete(memoryFacts).where(eq(memoryFacts.userId, userId));
  await updateMemoryProfile(userId, { profile: "", summary: "" });
}

export type MemoryExtractionJobInput = {
  userId: number;
  sessionId: string;
  userMessageId: number;
  assistantMessageId: number;
  role: MemoryEntryRole;
};

/** Queue writes no chat text. The unique assistant message is the restart-safe idempotency key. */
export async function enqueueMemoryExtractionJob(input: MemoryExtractionJobInput): Promise<void> {
  const db = requireDatabase(await getDb());
  const now = new Date();
  try {
    await db.insert(memoryExtractionJobs).values({
      id: randomUUID(), ...input, status: "pending", attempts: 0, runAfter: now, lastErrorClass: null, completedAt: null, createdAt: now, updatedAt: now,
    });
  } catch {
    // Duplicate assistantMessageId denotes an already enqueued or processed turn.
  }
}

/** Claims pending work, or processing work stale for five minutes. No chat text is selected here. */
export async function claimMemoryExtractionJob(userId: number, assistantMessageId?: number): Promise<MemoryExtractionJob | null> {
  const db = requireDatabase(await getDb());
  const now = new Date();
  const staleAt = new Date(now.getTime() - 5 * 60 * 1_000);
  const due = or(
    and(eq(memoryExtractionJobs.status, "pending"), lte(memoryExtractionJobs.runAfter, now)),
    and(eq(memoryExtractionJobs.status, "processing"), lte(memoryExtractionJobs.updatedAt, staleAt)),
  );
  const conditions = [eq(memoryExtractionJobs.userId, userId), due];
  if (assistantMessageId) conditions.push(eq(memoryExtractionJobs.assistantMessageId, assistantMessageId));
  const [candidate] = await db.select().from(memoryExtractionJobs).where(and(...conditions))
    .orderBy(asc(memoryExtractionJobs.runAfter), asc(memoryExtractionJobs.createdAt))
    .limit(1);
  if (!candidate) return null;
  const claimed = await db.update(memoryExtractionJobs).set({ status: "processing", attempts: candidate.attempts + 1, lastErrorClass: null, updatedAt: now })
    .where(and(
      eq(memoryExtractionJobs.id, candidate.id),
      eq(memoryExtractionJobs.userId, userId),
      eq(memoryExtractionJobs.status, candidate.status),
      eq(memoryExtractionJobs.attempts, candidate.attempts),
    ));
  if (!Number(claimed[0]?.affectedRows ?? 0)) return null;
  return { ...candidate, status: "processing", attempts: candidate.attempts + 1, lastErrorClass: null, updatedAt: now };
}

export type MemoryExtractionJobReference = Pick<MemoryExtractionJob, "userId" | "assistantMessageId">;

/**
 * Returns a tiny text-free batch for the project-level retry launcher. Each
 * worker call still performs its own atomic claim, so overlap remains safe.
 */
export async function listDueMemoryExtractionJobReferences(limit = 8): Promise<MemoryExtractionJobReference[]> {
  const db = requireDatabase(await getDb());
  const now = new Date();
  const staleAt = new Date(now.getTime() - 5 * 60 * 1_000);
  const safeLimit = Math.min(12, Math.max(1, Math.floor(limit)));
  return db.select({ userId: memoryExtractionJobs.userId, assistantMessageId: memoryExtractionJobs.assistantMessageId })
    .from(memoryExtractionJobs)
    .where(or(
      and(eq(memoryExtractionJobs.status, "pending"), lte(memoryExtractionJobs.runAfter, now)),
      and(eq(memoryExtractionJobs.status, "processing"), lte(memoryExtractionJobs.updatedAt, staleAt)),
    ))
    .orderBy(asc(memoryExtractionJobs.runAfter), asc(memoryExtractionJobs.createdAt))
    .limit(safeLimit);
}

/** Reads the pair only after user/session ownership has been confirmed; payload is not logged or exported. */
export async function getMemoryExtractionJobTurn(userId: number, job: MemoryExtractionJob): Promise<{ userText: string; assistantText: string; hadLiveSearch: boolean } | null> {
  const db = requireDatabase(await getDb());
  const session = await getOwnedChatSession(userId, job.sessionId);
  if (!session) return null;
  const [[userMessage], [assistantMessage]] = await Promise.all([
    db.select().from(messages).where(and(
      eq(messages.id, job.userMessageId),
      eq(messages.sessionId, job.sessionId),
      eq(messages.role, "user"),
    )).limit(1),
    db.select().from(messages).where(and(
      eq(messages.id, job.assistantMessageId),
      eq(messages.sessionId, job.sessionId),
      eq(messages.role, "assistant"),
    )).limit(1),
  ]);
  if (!userMessage || !assistantMessage) return null;
  let hadLiveSearch = false;
  try {
    const metadata = assistantMessage.metadata ? JSON.parse(assistantMessage.metadata) as { searchStatus?: unknown } : null;
    hadLiveSearch = Boolean(metadata?.searchStatus);
  } catch {
    // Metadata is optional and malformed legacy data must not fail ordinary memory work.
  }
  return { userText: userMessage.content, assistantText: assistantMessage.content, hadLiveSearch };
}

export async function completeMemoryExtractionJob(userId: number, jobId: string): Promise<void> {
  const db = requireDatabase(await getDb());
  const now = new Date();
  await db.update(memoryExtractionJobs).set({ status: "completed", completedAt: now, lastErrorClass: null, updatedAt: now }).where(and(eq(memoryExtractionJobs.id, jobId), eq(memoryExtractionJobs.userId, userId)));
}

/** Retry metadata is a bounded error class, never a message, model response, URL or API key. */
export async function retryMemoryExtractionJob(userId: number, job: MemoryExtractionJob, error: unknown): Promise<void> {
  const db = requireDatabase(await getDb());
  const exhausted = job.attempts >= 3;
  const delayMs = Math.min(5_000, 250 * 2 ** Math.max(0, job.attempts - 1));
  const safeClasses = new Set(["settings_read", "turn_read", "llm_invoke", "content_shape", "json_invalid", "memory_write", "completion_write", "worker_unknown"]);
  const errorClass = error instanceof Error && safeClasses.has(error.name) ? error.name : "worker_unknown";
  await db.update(memoryExtractionJobs).set({ status: exhausted ? "failed" : "pending", runAfter: new Date(Date.now() + delayMs), lastErrorClass: errorClass, updatedAt: new Date() })
    .where(and(eq(memoryExtractionJobs.id, job.id), eq(memoryExtractionJobs.userId, userId)));
}

export async function listMemoryFacts(userId: number): Promise<MemoryFact[]> {
  const db = requireDatabase(await getDb());
  return db.select().from(memoryFacts).where(eq(memoryFacts.userId, userId)).orderBy(desc(memoryFacts.updatedAt), desc(memoryFacts.createdAt));
}

export type MemoryFactSource = "manual" | "auto";

function normalizeMemoryFact(fact: string) {
  return fact.trim().replace(/\s+/g, " ").slice(0, 280);
}

export async function listRelevantMemoryFacts(userId: number, query: string, limit = 20): Promise<MemoryFact[]> {
  const facts = await listMemoryFacts(userId);
  const terms = new Set(query.toLocaleLowerCase("ru-RU").match(/[A-Za-zА-Яа-яЁё0-9]{3,}/g) ?? []);
  if (!terms.size) return facts.slice(0, limit);
  return facts
    .map((fact, position) => ({ fact, position, score: (fact.fact.toLocaleLowerCase("ru-RU").match(/[A-Za-zА-Яа-яЁё0-9]{3,}/g) ?? []).filter((term) => terms.has(term)).length }))
    .sort((left, right) => right.score - left.score || left.position - right.position)
    .slice(0, limit)
    .map(({ fact }) => fact);
}

export async function createMemoryFact(userId: number, fact: string, sourceMessageId?: number | null, source: MemoryFactSource = "manual"): Promise<MemoryFact | null> {
  const db = requireDatabase(await getDb());
  const normalized = normalizeMemoryFact(fact);
  if (normalized.length < 3) return null;
  const existing = await listMemoryFacts(userId);
  if (existing.some((item) => item.fact.toLocaleLowerCase("ru-RU") === normalized.toLocaleLowerCase("ru-RU"))) return null;
  const record: MemoryFact = { id: randomUUID(), userId, fact: normalized, source, version: 1, sourceMessageId: sourceMessageId ?? null, createdAt: new Date(), updatedAt: new Date() };
  await db.insert(memoryFacts).values(record);
  return record;
}

export async function updateMemoryFact(userId: number, factId: string, fact: string): Promise<MemoryFact | null> {
  const db = requireDatabase(await getDb());
  const normalized = normalizeMemoryFact(fact);
  if (normalized.length < 3) return null;
  const sameUser = await listMemoryFacts(userId);
  if (sameUser.some((item) => item.id !== factId && item.fact.toLocaleLowerCase("ru-RU") === normalized.toLocaleLowerCase("ru-RU"))) return null;
  const result = await db.update(memoryFacts).set({ fact: normalized, version: sql`${memoryFacts.version} + 1` }).where(and(eq(memoryFacts.id, factId), eq(memoryFacts.userId, userId)));
  if (!Number(result[0]?.affectedRows ?? 0)) return null;
  const record = await db.select().from(memoryFacts).where(and(eq(memoryFacts.id, factId), eq(memoryFacts.userId, userId))).limit(1);
  return record[0] ?? null;
}

export async function deleteMemoryFact(userId: number, factId: string): Promise<boolean> {
  const db = requireDatabase(await getDb());
  const result = await db.delete(memoryFacts).where(and(eq(memoryFacts.id, factId), eq(memoryFacts.userId, userId)));
  return Number(result[0]?.affectedRows ?? 0) > 0;
}

export async function clearMemory(userId: number): Promise<void> {
  await clearAllMemory(userId);
}

const CHAT_ATTACHMENT_RETENTION_MS = 24 * 60 * 60 * 1000;

export async function createChatAttachment(userId: number, input: Omit<ChatAttachment, "id" | "userId" | "createdAt" | "expiresAt">): Promise<ChatAttachment> {
  const db = requireDatabase(await getDb());
  requireOwnedSession(userId, await getOwnedChatSession(userId, input.sessionId));
  const record: ChatAttachment = {
    ...input,
    id: randomUUID(),
    userId,
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + CHAT_ATTACHMENT_RETENTION_MS),
  };
  await db.insert(chatAttachments).values(record);
  return record;
}

export async function listSessionAttachments(userId: number, sessionId: string): Promise<ChatAttachment[]> {
  const db = requireDatabase(await getDb());
  requireOwnedSession(userId, await getOwnedChatSession(userId, sessionId));
  const now = new Date();
  return db.select().from(chatAttachments).where(and(
    eq(chatAttachments.userId, userId),
    eq(chatAttachments.sessionId, sessionId),
    or(isNull(chatAttachments.expiresAt), gt(chatAttachments.expiresAt, now)),
  )).orderBy(asc(chatAttachments.createdAt));
}

export async function getOwnedChatAttachments(userId: number, sessionId: string, attachmentIds: string[]): Promise<ChatAttachment[]> {
  const owned = await listSessionAttachments(userId, sessionId);
  const wanted = new Set(attachmentIds);
  const result = owned.filter((attachment) => wanted.has(attachment.id));
  if (result.length !== wanted.size) throw new Error("Одно или несколько вложений не найдены или недоступны.");
  return result;
}

export async function getOwnedChatAttachment(userId: number, attachmentId: string): Promise<ChatAttachment | undefined> {
  const db = requireDatabase(await getDb());
  const now = new Date();
  const result = await db.select().from(chatAttachments).where(and(
    eq(chatAttachments.id, attachmentId),
    eq(chatAttachments.userId, userId),
    or(isNull(chatAttachments.expiresAt), gt(chatAttachments.expiresAt, now)),
  )).limit(1);
  return result[0];
}

export async function deleteOwnedChatAttachment(userId: number, attachmentId: string): Promise<boolean> {
  const db = requireDatabase(await getDb());
  const result = await db.delete(chatAttachments).where(and(eq(chatAttachments.id, attachmentId), eq(chatAttachments.userId, userId)));
  return Number(result[0]?.affectedRows ?? 0) > 0;
}

/** Removes only expired attachment metadata. Object-store physical deletion is not available in the project storage API. */
export async function cleanupExpiredChatAttachments(now = new Date()): Promise<number> {
  const db = requireDatabase(await getDb());
  const result = await db.delete(chatAttachments).where(lt(chatAttachments.expiresAt, now));
  return Number(result[0]?.affectedRows ?? 0);
}

export type ChatExportFormat = "markdown" | "pdf";

export async function createChatExport(userId: number, input: {
  sessionId: string;
  fileKey: string;
  fileName: string;
  format: ChatExportFormat;
  contentType: string;
  byteSize: number;
  searchText?: string | null;
}): Promise<ChatExport> {
  const db = requireDatabase(await getDb());
  requireOwnedSession(userId, await getOwnedChatSession(userId, input.sessionId));
  const record: ChatExport = {
    id: randomUUID(),
    userId,
    sessionId: input.sessionId,
    fileKey: input.fileKey,
    fileName: input.fileName,
    format: input.format,
    contentType: input.contentType,
    byteSize: input.byteSize,
    archived: 0,
    searchText: input.searchText ?? null,
    createdAt: new Date(),
  };
  await db.insert(chatExports).values(record);
  return record;
}

export async function listOwnedChatExports(userId: number, sessionId?: string): Promise<ChatExport[]> {
  const db = requireDatabase(await getDb());
  if (sessionId) requireOwnedSession(userId, await getOwnedChatSession(userId, sessionId));
  return db.select().from(chatExports).where(and(
    eq(chatExports.userId, userId),
    ...(sessionId ? [eq(chatExports.sessionId, sessionId)] : []),
  )).orderBy(desc(chatExports.createdAt));
}

export async function getOwnedChatExport(userId: number, exportId: string): Promise<ChatExport | undefined> {
  const db = requireDatabase(await getDb());
  const result = await db.select().from(chatExports).where(and(
    eq(chatExports.id, exportId),
    eq(chatExports.userId, userId),
  )).limit(1);
  return result[0];
}

/** Deletion removes only a user-owned metadata record; storage has no physical-delete API. */
export async function deleteOwnedChatExport(userId: number, exportId: string): Promise<boolean> {
  const db = requireDatabase(await getDb());
  const result = await db.delete(chatExports).where(and(
    eq(chatExports.id, exportId),
    eq(chatExports.userId, userId),
  ));
  return Number(result[0]?.affectedRows ?? 0) > 0;
}

function searchSnippet(content: string, query: string, maximum = 220) {
  const lower = content.toLocaleLowerCase("ru-RU");
  const at = lower.indexOf(query.toLocaleLowerCase("ru-RU"));
  const start = Math.max(0, at - Math.floor(maximum / 3));
  const raw = content.slice(start, start + maximum).replace(/\s+/g, " ").trim();
  return `${start > 0 ? "…" : ""}${raw}${start + maximum < content.length ? "…" : ""}`;
}

export type SearchResult = { type: "chat" | "message"; id: string; sessionId?: string; title: string; snippet: string; createdAt: Date };

export async function searchUserContent(userId: number, query: string): Promise<SearchResult[]> {
  const db = requireDatabase(await getDb());
  const term = query.trim().slice(0, 120);
  if (term.length < 2) return [];
  const pattern = `%${term}%`;
  const [sessionRows, messageRows] = await Promise.all([
    db.select({ id: chatSessions.id, title: chatSessions.title, createdAt: chatSessions.updatedAt }).from(chatSessions).where(and(eq(chatSessions.userId, userId), like(chatSessions.title, pattern))).orderBy(desc(chatSessions.updatedAt)).limit(8),
    db.select({ id: messages.id, sessionId: messages.sessionId, title: chatSessions.title, content: messages.content, createdAt: messages.createdAt }).from(messages).innerJoin(chatSessions, eq(messages.sessionId, chatSessions.id)).where(and(eq(chatSessions.userId, userId), like(messages.content, pattern))).orderBy(desc(messages.createdAt)).limit(12),
  ]);
  return [
    ...sessionRows.map((row) => ({ type: "chat" as const, id: row.id, sessionId: row.id, title: row.title, snippet: row.title, createdAt: row.createdAt })),
    ...messageRows.map((row) => ({ type: "message" as const, id: String(row.id), sessionId: row.sessionId, title: row.title, snippet: searchSnippet(row.content, term), createdAt: row.createdAt })),
  ];
}
