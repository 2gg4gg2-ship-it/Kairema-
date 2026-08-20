import { and, asc, desc, eq, inArray, like, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { randomUUID } from "node:crypto";
import { ChatAttachment, ChatExport, ChatMessageRecord, ChatSession, DevApiAuditRecord, InsertUser, KnowledgeDocument, KnowledgeIngestionRun, KnowledgeSource, MemoryFact, MemoryProfile, ProviderHealthRecord, UserSettings, WebSearchStatusRecord, chatAttachments, chatExports, chatSessions, devApiAuditRecords, devApiRateWindows, knowledgeDocuments, knowledgeIngestionRuns, knowledgeSources, memoryFacts, memoryProfiles, messages, providerDailyUsage, providerHealth, roleRuntimeStatus, userSettings, users, webSearchStatus } from "../drizzle/schema";
import { ENV } from "./_core/env";

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

export function requireOwnedSession<T extends Pick<ChatSession, "userId">>(userId: number, session: T | undefined): T {
  if (!session || session.userId !== userId) throw new Error("Чат не найден или недоступен.");
  return session;
}

export async function listSessionMessages(userId: number, sessionId: string): Promise<ChatMessageRecord[]> {
  const db = requireDatabase(await getDb());
  requireOwnedSession(userId, await getOwnedChatSession(userId, sessionId));
  return db.select().from(messages).where(eq(messages.sessionId, sessionId)).orderBy(asc(messages.createdAt), asc(messages.id));
}

export async function appendChatMessage(userId: number, sessionId: string, role: "user" | "assistant", content: string, modelId?: string, metadata?: string): Promise<void> {
  const db = requireDatabase(await getDb());
  requireOwnedSession(userId, await getOwnedChatSession(userId, sessionId));
  await db.insert(messages).values({ sessionId, role, content, modelId: modelId ?? null, metadata: metadata ?? null });
  await db.update(chatSessions).set({ updatedAt: new Date(), ...(modelId ? { modelId } : {}) }).where(eq(chatSessions.id, sessionId));
}

export async function updateChatTitle(userId: number, sessionId: string, title: string): Promise<void> {
  const db = requireDatabase(await getDb());
  await db.update(chatSessions).set({ title, updatedAt: new Date() }).where(and(eq(chatSessions.id, sessionId), eq(chatSessions.userId, userId)));
}

export async function deleteOwnedChatSession(userId: number, sessionId: string): Promise<boolean> {
  const db = requireDatabase(await getDb());
  const result = await db.delete(chatSessions).where(and(eq(chatSessions.id, sessionId), eq(chatSessions.userId, userId)));
  return result[0].affectedRows > 0;
}

export async function createChatExportRecord(userId: number, input: Omit<ChatExport, "userId" | "createdAt">): Promise<ChatExport> {
  const db = requireDatabase(await getDb());
  requireOwnedSession(userId, await getOwnedChatSession(userId, input.sessionId));
  const record: ChatExport = { ...input, userId, createdAt: new Date() };
  await db.insert(chatExports).values(record);
  return record;
}

export async function listChatExports(userId: number): Promise<ChatExport[]> {
  const db = requireDatabase(await getDb());
  return db.select().from(chatExports).where(eq(chatExports.userId, userId)).orderBy(desc(chatExports.createdAt));
}

export async function getOwnedChatExport(userId: number, exportId: string): Promise<ChatExport | undefined> {
  const db = requireDatabase(await getDb());
  const result = await db.select().from(chatExports).where(and(eq(chatExports.id, exportId), eq(chatExports.userId, userId))).limit(1);
  return result[0];
}

export function isOwnedChatExport(userId: number, record: Pick<ChatExport, "userId"> | undefined): boolean {
  return Boolean(record && record.userId === userId);
}

export async function deleteOwnedChatExport(userId: number, exportId: string): Promise<boolean> {
  const db = requireDatabase(await getDb());
  const owned = await getOwnedChatExport(userId, exportId);
  if (!isOwnedChatExport(userId, owned)) return false;
  await db.delete(chatExports).where(and(eq(chatExports.id, exportId), eq(chatExports.userId, userId)));
  return true;
}

export async function deleteAllOwnedChatExports(userId: number): Promise<number> {
  const db = requireDatabase(await getDb());
  const result = await db.delete(chatExports).where(eq(chatExports.userId, userId));
  return result[0].affectedRows;
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

export async function upsertWebSearchStatus(input: Omit<WebSearchStatusRecord, "updatedAt">): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.insert(webSearchStatus).values(input).onDuplicateKeyUpdate({
    set: {
      state: input.state,
      reason: input.reason,
      googleHttp: input.googleHttp,
      openrouterHttp: input.openrouterHttp,
      checkedAt: input.checkedAt,
    },
  });
}

export type UserSettingsPatch = Partial<Pick<UserSettings, "language" | "theme" | "responseStyle" | "responseLength" | "quickReplies" | "effort" | "thinking" | "defaultRole" | "webSearch" | "toolAccess">>;
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

/** Writes only outcome metadata; prompts, responses, credentials, headers and IP addresses are never persisted. */
export async function recordDevApiAudit(input: DevApiAuditInput): Promise<void> {
  const db = requireDatabase(await getDb());
  await db.insert(devApiAuditRecords).values({ id: randomUUID(), userId: input.userId ?? null, outcome: input.outcome, status: input.status });
}

export type MemoryProfilePatch = Partial<Pick<MemoryProfile, "enabled" | "autoExtract" | "profile" | "summary">>;

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
  return getMemoryProfile(userId);
}

export async function listMemoryFacts(userId: number): Promise<MemoryFact[]> {
  const db = requireDatabase(await getDb());
  return db.select().from(memoryFacts).where(eq(memoryFacts.userId, userId)).orderBy(desc(memoryFacts.updatedAt), desc(memoryFacts.createdAt));
}

export async function createMemoryFact(userId: number, fact: string, sourceMessageId?: number | null): Promise<MemoryFact | null> {
  const db = requireDatabase(await getDb());
  const normalized = fact.trim().replace(/\s+/g, " ").slice(0, 280);
  if (normalized.length < 3) return null;
  const existing = await listMemoryFacts(userId);
  if (existing.some((item) => item.fact.toLocaleLowerCase("ru-RU") === normalized.toLocaleLowerCase("ru-RU"))) return null;
  const record: MemoryFact = { id: randomUUID(), userId, fact: normalized, sourceMessageId: sourceMessageId ?? null, createdAt: new Date(), updatedAt: new Date() };
  await db.insert(memoryFacts).values(record);
  return record;
}

export async function deleteMemoryFact(userId: number, factId: string): Promise<boolean> {
  const db = requireDatabase(await getDb());
  const result = await db.delete(memoryFacts).where(and(eq(memoryFacts.id, factId), eq(memoryFacts.userId, userId)));
  return Number(result[0]?.affectedRows ?? 0) > 0;
}

export async function clearMemory(userId: number): Promise<void> {
  const db = requireDatabase(await getDb());
  await db.delete(memoryFacts).where(eq(memoryFacts.userId, userId));
  await updateMemoryProfile(userId, { profile: "", summary: "" });
}

export async function createChatAttachment(userId: number, input: Omit<ChatAttachment, "id" | "userId" | "createdAt">): Promise<ChatAttachment> {
  const db = requireDatabase(await getDb());
  requireOwnedSession(userId, await getOwnedChatSession(userId, input.sessionId));
  const record: ChatAttachment = { ...input, id: randomUUID(), userId, createdAt: new Date() };
  await db.insert(chatAttachments).values(record);
  return record;
}

export async function listSessionAttachments(userId: number, sessionId: string): Promise<ChatAttachment[]> {
  const db = requireDatabase(await getDb());
  requireOwnedSession(userId, await getOwnedChatSession(userId, sessionId));
  return db.select().from(chatAttachments).where(and(eq(chatAttachments.userId, userId), eq(chatAttachments.sessionId, sessionId))).orderBy(asc(chatAttachments.createdAt));
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
  const result = await db.select().from(chatAttachments).where(and(eq(chatAttachments.id, attachmentId), eq(chatAttachments.userId, userId))).limit(1);
  return result[0];
}

export async function deleteOwnedChatAttachment(userId: number, attachmentId: string): Promise<boolean> {
  const db = requireDatabase(await getDb());
  const result = await db.delete(chatAttachments).where(and(eq(chatAttachments.id, attachmentId), eq(chatAttachments.userId, userId)));
  return Number(result[0]?.affectedRows ?? 0) > 0;
}

function searchSnippet(content: string, query: string, maximum = 220) {
  const lower = content.toLocaleLowerCase("ru-RU");
  const at = lower.indexOf(query.toLocaleLowerCase("ru-RU"));
  const start = Math.max(0, at - Math.floor(maximum / 3));
  const raw = content.slice(start, start + maximum).replace(/\s+/g, " ").trim();
  return `${start > 0 ? "…" : ""}${raw}${start + maximum < content.length ? "…" : ""}`;
}

export type SearchResult = { type: "chat" | "message" | "export"; id: string; sessionId?: string; title: string; snippet: string; createdAt: Date };

export async function searchUserContent(userId: number, query: string): Promise<SearchResult[]> {
  const db = requireDatabase(await getDb());
  const term = query.trim().slice(0, 120);
  if (term.length < 2) return [];
  const pattern = `%${term}%`;
  const [sessionRows, messageRows, exportRows] = await Promise.all([
    db.select({ id: chatSessions.id, title: chatSessions.title, createdAt: chatSessions.updatedAt }).from(chatSessions).where(and(eq(chatSessions.userId, userId), like(chatSessions.title, pattern))).orderBy(desc(chatSessions.updatedAt)).limit(8),
    db.select({ id: messages.id, sessionId: messages.sessionId, title: chatSessions.title, content: messages.content, createdAt: messages.createdAt }).from(messages).innerJoin(chatSessions, eq(messages.sessionId, chatSessions.id)).where(and(eq(chatSessions.userId, userId), like(messages.content, pattern))).orderBy(desc(messages.createdAt)).limit(12),
    db.select({ id: chatExports.id, sessionId: chatExports.sessionId, fileName: chatExports.fileName, createdAt: chatExports.createdAt }).from(chatExports).where(and(eq(chatExports.userId, userId), like(chatExports.fileName, pattern))).orderBy(desc(chatExports.createdAt)).limit(8),
  ]);
  return [
    ...sessionRows.map((row) => ({ type: "chat" as const, id: row.id, sessionId: row.id, title: row.title, snippet: row.title, createdAt: row.createdAt })),
    ...messageRows.map((row) => ({ type: "message" as const, id: String(row.id), sessionId: row.sessionId, title: row.title, snippet: searchSnippet(row.content, term), createdAt: row.createdAt })),
    ...exportRows.map((row) => ({ type: "export" as const, id: row.id, sessionId: row.sessionId, title: row.fileName, snippet: row.fileName, createdAt: row.createdAt })),
  ];
}
