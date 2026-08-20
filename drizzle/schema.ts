import { index, int, mysqlEnum, mysqlTable, primaryKey, text, timestamp, uniqueIndex, varchar } from "drizzle-orm/mysql-core";

export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export const chatSessions = mysqlTable("chat_sessions", {
  id: varchar("id", { length: 36 }).primaryKey(),
  userId: int("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  title: varchar("title", { length: 255 }).notNull().default("Новый разговор"),
  modelId: varchar("modelId", { length: 160 }).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => [index("chat_sessions_user_updated_idx").on(table.userId, table.updatedAt)]);

export const messages = mysqlTable("messages", {
  id: int("id").autoincrement().primaryKey(),
  sessionId: varchar("sessionId", { length: 36 }).notNull().references(() => chatSessions.id, { onDelete: "cascade" }),
  role: mysqlEnum("role", ["user", "assistant"]).notNull(),
  content: text("content").notNull(),
  modelId: varchar("modelId", { length: 160 }),
  metadata: text("metadata"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [index("messages_session_created_idx").on(table.sessionId, table.createdAt)]);

export const chatExports = mysqlTable("chat_exports", {
  id: varchar("id", { length: 36 }).primaryKey(),
  userId: int("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  sessionId: varchar("sessionId", { length: 36 }).notNull().references(() => chatSessions.id, { onDelete: "cascade" }),
  fileKey: varchar("fileKey", { length: 512 }).notNull(),
  fileName: varchar("fileName", { length: 255 }).notNull(),
  format: mysqlEnum("format", ["markdown", "pdf"]).notNull(),
  contentType: varchar("contentType", { length: 128 }).notNull(),
  byteSize: int("byteSize").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [
  index("chat_exports_user_created_idx").on(table.userId, table.createdAt),
	index("chat_exports_session_created_idx").on(table.sessionId, table.createdAt),
]);

export const providerHealth = mysqlTable("provider_health", {
	provider: varchar("provider", { length: 32 }).primaryKey(),
	state: mysqlEnum("state", ["ready", "cooldown", "auth_failed", "unavailable", "not_configured"]).notNull(),
	category: varchar("category", { length: 32 }),
	http: int("http"),
	confirmed: text("confirmed").notNull(),
	checkedAt: timestamp("checkedAt").defaultNow().notNull(),
	blockedUntil: timestamp("blockedUntil"),
	updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

/** Bounded health history only: no prompts, keys, models, fallback chains, or request bodies. */
export const providerHealthHistory = mysqlTable("provider_health_history", {
	id: int("id").autoincrement().primaryKey(),
	provider: varchar("provider", { length: 32 }).notNull(),
	state: mysqlEnum("state", ["ready", "cooldown", "auth_failed", "unavailable", "not_configured"]).notNull(),
	category: varchar("category", { length: 32 }),
	http: int("http"),
	checkedAt: timestamp("checkedAt").defaultNow().notNull(),
}, (table) => [index("provider_health_history_provider_checked_idx").on(table.provider, table.checkedAt)]);

/** Aggregate-only daily provider usage; prompts, users and response content are never stored here. */
export const providerDailyUsage = mysqlTable("provider_daily_usage", {
	provider: varchar("provider", { length: 32 }).notNull(),
	dayKey: varchar("dayKey", { length: 10 }).notNull(),
	successCount: int("successCount").notNull().default(0),
}, (table) => [primaryKey({ columns: [table.provider, table.dayKey] })]);

/** Anonymous Flash first-visible-token durations. This table deliberately has no user, session, prompt, reply, provider or model column. */
export const flashTtftMetrics = mysqlTable("flash_ttft_metrics", {
	id: int("id").autoincrement().primaryKey(),
	durationMs: int("durationMs").notNull(),
	createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [index("flash_ttft_metrics_created_idx").on(table.createdAt)]);

/** Metadata-only record of a controlled web-search layer failover. No query, URL, source, user or model is persisted. */
export const searchOutageLogs = mysqlTable("search_outage_logs", {
	id: int("id").autoincrement().primaryKey(),
	layer: mysqlEnum("layer", ["google", "tavily", "openrouter"]).notNull(),
	errorClass: varchar("errorClass", { length: 32 }).notNull(),
	latencyMs: int("latencyMs").notNull(),
	fellBack: int("fellBack").notNull().default(0),
	createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [index("search_outage_logs_created_idx").on(table.createdAt)]);

export const roleRuntimeStatus = mysqlTable("role_runtime_status", {
	roleId: mysqlEnum("roleId", ["fast", "smart", "context", "flagship"]).primaryKey(),
	state: mysqlEnum("state", ["ready", "backup", "unavailable"]).notNull(),
	provider: varchar("provider", { length: 32 }),
	modelUsed: varchar("modelUsed", { length: 160 }),
	checkedAt: timestamp("checkedAt").defaultNow().notNull(),
});

export const webSearchStatus = mysqlTable("web_search_status", {
  key: varchar("key", { length: 32 }).primaryKey(),
  state: mysqlEnum("state", ["ready", "unavailable", "unknown"]).notNull(),
  reason: varchar("reason", { length: 255 }).notNull(),
  googleHttp: int("googleHttp"),
  openrouterHttp: int("openrouterHttp"),
  checkedAt: timestamp("checkedAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

/** Server-managed public-source registry. Users cannot add arbitrary URLs. */
export const knowledgeSources = mysqlTable("knowledge_sources", {
  id: varchar("id", { length: 32 }).primaryKey(),
  displayName: varchar("displayName", { length: 120 }).notNull(),
  feedUrl: varchar("feedUrl", { length: 512 }).notNull(),
  state: mysqlEnum("state", ["ready", "unavailable", "unknown"]).notNull().default("unknown"),
  lastFetchedAt: timestamp("lastFetchedAt"),
  lastSuccessAt: timestamp("lastSuccessAt"),
  lastError: varchar("lastError", { length: 255 }),
  indexedCount: int("indexedCount").notNull().default(0),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

/** RSS item bodies are bounded, attributable public excerpts used only for retrieval. */
export const knowledgeDocuments = mysqlTable("knowledge_documents", {
  id: varchar("id", { length: 36 }).primaryKey(),
  sourceId: varchar("sourceId", { length: 32 }).notNull().references(() => knowledgeSources.id, { onDelete: "cascade" }),
  sourceUrl: varchar("sourceUrl", { length: 512 }).notNull(),
  title: varchar("title", { length: 512 }).notNull(),
  excerpt: text("excerpt").notNull(),
  fingerprint: varchar("fingerprint", { length: 64 }).notNull(),
  publishedAt: timestamp("publishedAt"),
  retrievedAt: timestamp("retrievedAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => [
  uniqueIndex("knowledge_documents_url_unique").on(table.sourceUrl),
  index("knowledge_documents_source_published_idx").on(table.sourceId, table.publishedAt),
  index("knowledge_documents_fingerprint_idx").on(table.fingerprint),
]);

/** Bounded non-secret audit records for manual and scheduled ingestion attempts. */
export const knowledgeIngestionRuns = mysqlTable("knowledge_ingestion_runs", {
  id: varchar("id", { length: 36 }).primaryKey(),
  sourceId: varchar("sourceId", { length: 32 }).references(() => knowledgeSources.id, { onDelete: "set null" }),
  trigger: mysqlEnum("trigger", ["manual", "scheduled", "startup"]).notNull(),
  state: mysqlEnum("state", ["success", "partial", "failed"]).notNull(),
  fetchedCount: int("fetchedCount").notNull().default(0),
  indexedCount: int("indexedCount").notNull().default(0),
  updatedCount: int("updatedCount").notNull().default(0),
  error: varchar("error", { length: 255 }),
  startedAt: timestamp("startedAt").defaultNow().notNull(),
  finishedAt: timestamp("finishedAt"),
}, (table) => [index("knowledge_ingestion_runs_started_idx").on(table.startedAt)]);

/** Per-user fixed-minute quota state for the isolated admin-only Dev API. */
export const devApiRateWindows = mysqlTable("dev_api_rate_windows", {
  userId: int("userId").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  windowStarted: timestamp("windowStarted").defaultNow().notNull(),
  requestCount: int("requestCount").notNull().default(0),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

/** Metadata-only audit trail: never stores request prompts, response bodies, headers, IPs, or credentials. */
export const devApiAuditRecords = mysqlTable("dev_api_audit_records", {
  id: varchar("id", { length: 36 }).primaryKey(),
  userId: int("userId").references(() => users.id, { onDelete: "set null" }),
  outcome: mysqlEnum("outcome", ["allowed", "denied", "invalid", "rate_limited", "provider_error"]).notNull(),
  status: int("status").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [index("dev_api_audit_user_created_idx").on(table.userId, table.createdAt)]);

export const userSettings = mysqlTable("user_settings", {
  userId: int("userId").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  language: mysqlEnum("language", ["ru", "en"]).notNull().default("ru"),
  theme: mysqlEnum("theme", ["light", "dark"]).notNull().default("dark"),
  responseStyle: mysqlEnum("responseStyle", ["default", "professional", "friendly", "concise", "steps"]).notNull().default("default"),
  responseLength: mysqlEnum("responseLength", ["brief", "balanced", "detailed"]).notNull().default("balanced"),
  quickReplies: int("quickReplies").notNull().default(1),
  effort: mysqlEnum("effort", ["low", "standard", "high"]).notNull().default("standard"),
  thinking: int("thinking").notNull().default(0),
  defaultRole: mysqlEnum("defaultRole", ["fast", "smart", "context", "flagship"]).notNull().default("fast"),
  webSearch: int("webSearch").notNull().default(0),
  toolAccess: int("toolAccess").notNull().default(1),
  healthRefreshSeconds: int("healthRefreshSeconds").notNull().default(30),
  exportSortBy: mysqlEnum("exportSortBy", ["createdAt", "byteSize"]).notNull().default("createdAt"),
  exportSortDirection: mysqlEnum("exportSortDirection", ["asc", "desc"]).notNull().default("desc"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export const memoryProfiles = mysqlTable("memory_profiles", {
  userId: int("userId").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  enabled: int("enabled").notNull().default(1),
  autoExtract: int("autoExtract").notNull().default(1),
  profile: text("profile").notNull(),
  summary: text("summary").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export const memoryFacts = mysqlTable("memory_facts", {
  id: varchar("id", { length: 36 }).primaryKey(),
  userId: int("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  fact: varchar("fact", { length: 280 }).notNull(),
  source: mysqlEnum("source", ["manual", "auto"]).notNull().default("manual"),
  version: int("version").notNull().default(1),
  sourceMessageId: int("sourceMessageId").references(() => messages.id, { onDelete: "set null" }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => [index("memory_facts_user_updated_idx").on(table.userId, table.updatedAt)]);

export const chatAttachments = mysqlTable("chat_attachments", {
  id: varchar("id", { length: 36 }).primaryKey(),
  userId: int("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  sessionId: varchar("sessionId", { length: 36 }).notNull().references(() => chatSessions.id, { onDelete: "cascade" }),
  fileKey: varchar("fileKey", { length: 512 }).notNull(),
  fileName: varchar("fileName", { length: 255 }).notNull(),
  contentType: varchar("contentType", { length: 128 }).notNull(),
  byteSize: int("byteSize").notNull(),
  kind: mysqlEnum("kind", ["image", "document"]).notNull(),
  processingStatus: mysqlEnum("processingStatus", ["ready", "unsupported", "failed"]).notNull().default("ready"),
  extractedText: text("extractedText"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [index("chat_attachments_user_session_idx").on(table.userId, table.sessionId, table.createdAt)]);

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;
export type ChatSession = typeof chatSessions.$inferSelect;
export type ChatMessageRecord = typeof messages.$inferSelect;
export type ChatExport = typeof chatExports.$inferSelect;
export type ProviderHealthRecord = typeof providerHealth.$inferSelect;
export type ProviderDailyUsageRecord = typeof providerDailyUsage.$inferSelect;
export type FlashTtftMetricRecord = typeof flashTtftMetrics.$inferSelect;
export type SearchOutageLogRecord = typeof searchOutageLogs.$inferSelect;
export type WebSearchStatusRecord = typeof webSearchStatus.$inferSelect;
export type KnowledgeSource = typeof knowledgeSources.$inferSelect;
export type KnowledgeDocument = typeof knowledgeDocuments.$inferSelect;
export type KnowledgeIngestionRun = typeof knowledgeIngestionRuns.$inferSelect;
export type DevApiAuditRecord = typeof devApiAuditRecords.$inferSelect;
export type UserSettings = typeof userSettings.$inferSelect;
export type MemoryProfile = typeof memoryProfiles.$inferSelect;
export type MemoryFact = typeof memoryFacts.$inferSelect;
export type ChatAttachment = typeof chatAttachments.$inferSelect;
