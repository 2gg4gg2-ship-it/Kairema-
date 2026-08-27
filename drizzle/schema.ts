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

/**
 * Provider subject → canonical Kairema user mapping.
 *
 * This deliberately does not use email: equal emails from different identity
 * providers remain separate until an explicit verified linking flow is added.
 */
export const providerIdentities = mysqlTable("provider_identities", {
  id: int("id").autoincrement().primaryKey(),
  provider: varchar("provider", { length: 64 }).notNull(),
  providerSubject: varchar("providerSubject", { length: 128 }).notNull(),
  userId: int("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => [
  uniqueIndex("provider_identities_provider_subject_unique").on(table.provider, table.providerSubject),
  index("provider_identities_user_idx").on(table.userId),
]);

/**
 * One-time, short-lived server-side reference for an explicit Stytch account
 * linking action. The browser receives only an opaque reference; the original
 * canonical user is retained server-side and verified again at callback time.
 */
export const stytchLinkIntents = mysqlTable("stytch_link_intents", {
  tokenHash: varchar("tokenHash", { length: 64 }).primaryKey(),
  userId: int("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expiresAt").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [index("stytch_link_intents_user_expiry_idx").on(table.userId, table.expiresAt)]);

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
  /** Browser-generated UUID only for original user sends; makes retries safe. */
  clientMessageId: varchar("clientMessageId", { length: 36 }),
  metadata: text("metadata"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [
  index("messages_session_created_idx").on(table.sessionId, table.createdAt),
  uniqueIndex("messages_client_message_id_unique").on(table.clientMessageId),
]);

/**
 * Compatibility mapping for the pre-existing persistent export archive.
 * This only reflects the legacy table; it does not create, drop, or migrate it.
 */
export const chatExports = mysqlTable("chat_exports", {
  id: varchar("id", { length: 36 }).primaryKey(),
  userId: int("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  sessionId: varchar("sessionId", { length: 36 }).notNull().references(() => chatSessions.id, { onDelete: "cascade" }),
  fileKey: varchar("fileKey", { length: 512 }).notNull(),
  fileName: varchar("fileName", { length: 255 }).notNull(),
  format: mysqlEnum("format", ["markdown", "pdf"]).notNull(),
  contentType: varchar("contentType", { length: 128 }).notNull(),
  byteSize: int("byteSize").notNull(),
  archived: int("archived").notNull().default(0),
  searchText: text("searchText"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [
	index("chat_exports_user_created_idx").on(table.userId, table.createdAt),
	index("chat_exports_session_created_idx").on(table.sessionId, table.createdAt),
]);

/** One unfinished composer text per verified user and chat; never used as a guest identity bridge. */
export const chatDrafts = mysqlTable("chat_drafts", {
	userId: int("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
	sessionId: varchar("sessionId", { length: 36 }).notNull().references(() => chatSessions.id, { onDelete: "cascade" }),
	content: text("content").notNull(),
	createdAt: timestamp("createdAt").defaultNow().notNull(),
	updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => [
	primaryKey({ columns: [table.userId, table.sessionId] }),
	index("chat_drafts_session_updated_idx").on(table.sessionId, table.updatedAt),
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

/** Owner-managed controls for existing allowlisted candidates; absent/unknown state resolves to enabled + normal. */
export const providerControlFlags = mysqlTable("provider_control_flags", {
	targetKey: varchar("targetKey", { length: 220 }).primaryKey(),
	targetType: mysqlEnum("targetType", ["provider", "model"]).notNull(),
	disabled: int("disabled").notNull().default(0),
	preference: mysqlEnum("preference", ["normal", "prefer", "avoid"]).notNull().default("normal"),
	updatedByUserId: int("updatedByUserId").references(() => users.id, { onDelete: "set null" }),
	createdAt: timestamp("createdAt").defaultNow().notNull(),
	updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => [index("provider_control_flags_updated_idx").on(table.updatedAt)]);

/** Bounded technical events; prompts, replies, URLs, files, secrets and private memory are never stored here. */
export const technicalEvents = mysqlTable("technical_events", {
	id: int("id").autoincrement().primaryKey(),
	kind: mysqlEnum("kind", ["provider", "fallback", "search", "owner_flag", "attachment"]).notNull(),
	title: varchar("title", { length: 220 }).notNull(),
	code: varchar("code", { length: 48 }),
	roleId: varchar("roleId", { length: 24 }),
	actorUserId: int("actorUserId").references(() => users.id, { onDelete: "set null" }),
	createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [index("technical_events_created_idx").on(table.createdAt)]);

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
	layer: varchar("layer", { length: 32 }).notNull(),
	errorClass: varchar("errorClass", { length: 32 }).notNull(),
	latencyMs: int("latencyMs").notNull(),
	fellBack: int("fellBack").notNull().default(0),
	createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [index("search_outage_logs_created_idx").on(table.createdAt)]);

/** Aggregate-ready search outcomes. This anonymous operational log never stores a user, query, URL, source, provider or model. */
export const searchQualityMetrics = mysqlTable("search_quality_metrics", {
	id: int("id").autoincrement().primaryKey(),
	outcome: mysqlEnum("outcome", ["found", "empty", "degraded", "error"]).notNull(),
	verification: mysqlEnum("verification", ["verified", "no_results", "degraded", "unavailable"]).notNull(),
	verifiedSourceCount: int("verifiedSourceCount").notNull(),
	attemptedLayerCount: int("attemptedLayerCount").notNull(),
	staleBlocked: int("staleBlocked").notNull().default(0),
	latencyMs: int("latencyMs").notNull(),
	createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [index("search_quality_metrics_created_idx").on(table.createdAt)]);

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
  tavilyHttp: int("tavilyHttp"),
  openrouterHttp: int("openrouterHttp"),
  youHttp: int("youHttp"),
  serperHttp: int("serperHttp"),
  exaHttp: int("exaHttp"),
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

/** Per-user fixed-minute quota state for ordinary chat-stream ingress; intentionally separate from Dev API quota. */
export const chatStreamRateWindows = mysqlTable("chat_stream_rate_windows", {
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
  highContrast: int("highContrast").notNull().default(0),
  emailNotifications: int("emailNotifications").notNull().default(0),
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

/** Separate per-user controls keep memory enablement independent of profile text. */
export const memorySettings = mysqlTable("memory_settings", {
  userId: int("userId").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  enabled: int("enabled").notNull().default(1),
  autoExtract: int("autoExtract").notNull().default(1),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

/** Facts and bounded conversation topics are always isolated by userId. The profile category is reserved for a future structured profile migration. */
export const memoryEntries = mysqlTable("memory_entries", {
  id: varchar("id", { length: 36 }).primaryKey(),
  userId: int("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  category: mysqlEnum("category", ["profile", "fact", "dialog_topic"]).notNull(),
  value: varchar("value", { length: 500 }).notNull(),
  memoryKey: varchar("memoryKey", { length: 160 }),
  role: mysqlEnum("role", ["fast", "smart", "context", "flagship"]),
  source: mysqlEnum("source", ["manual", "auto"]).notNull().default("manual"),
  /** Topics are scoped to the originating chat for 24-hour deduplication. */
  sessionId: varchar("sessionId", { length: 36 }).references(() => chatSessions.id, { onDelete: "set null" }),
  sourceMessageId: int("sourceMessageId").references(() => messages.id, { onDelete: "set null" }),
  /** FIFO and context recency are driven by refreshes, not initial creation. */
  lastSeenAt: timestamp("lastSeenAt").defaultNow().notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => [
  index("memory_entries_user_category_created_idx").on(table.userId, table.category, table.createdAt),
  index("memory_entries_user_category_updated_idx").on(table.userId, table.category, table.updatedAt),
  index("memory_entries_user_category_seen_idx").on(table.userId, table.category, table.lastSeenAt),
  index("memory_entries_topic_session_seen_idx").on(table.userId, table.sessionId, table.lastSeenAt),
]);

/**
 * Short-lived, text-free work queue for post-turn memory extraction. The job
 * points to the already-owned chat messages, so retries never duplicate the
 * turn and no prompt/response is copied into logs or task payloads.
 */
export const memoryExtractionJobs = mysqlTable("memory_extraction_jobs", {
  id: varchar("id", { length: 36 }).primaryKey(),
  userId: int("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  sessionId: varchar("sessionId", { length: 36 }).notNull().references(() => chatSessions.id, { onDelete: "cascade" }),
  userMessageId: int("userMessageId").notNull().references(() => messages.id, { onDelete: "cascade" }),
  assistantMessageId: int("assistantMessageId").notNull().references(() => messages.id, { onDelete: "cascade" }).unique(),
  role: mysqlEnum("role", ["fast", "smart", "context", "flagship"]).notNull(),
  status: mysqlEnum("status", ["pending", "processing", "completed", "failed"]).notNull().default("pending"),
  attempts: int("attempts").notNull().default(0),
  runAfter: timestamp("runAfter").defaultNow().notNull(),
  lastErrorClass: varchar("lastErrorClass", { length: 64 }),
  completedAt: timestamp("completedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => [
  index("memory_jobs_user_status_due_idx").on(table.userId, table.status, table.runAfter),
  index("memory_jobs_session_created_idx").on(table.sessionId, table.createdAt),
]);

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
  /** Temporary chat attachments become inaccessible after their short retention period. */
  expiresAt: timestamp("expiresAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [
  index("chat_attachments_user_session_idx").on(table.userId, table.sessionId, table.createdAt),
  index("chat_attachments_expires_idx").on(table.expiresAt),
]);

/** One server-controlled policy row; null WCU limits explicitly mean UNKNOWN/unconfigured, never unlimited provider capacity. */
export const capacityControllerSettings = mysqlTable("capacity_controller_settings", {
  id: int("id").primaryKey(),
  enabled: int("enabled").notNull().default(1),
  globalGenerationWcuLimit: int("globalGenerationWcuLimit"),
  globalSearchWcuLimit: int("globalSearchWcuLimit"),
  globalGenerationConcurrency: int("globalGenerationConcurrency"),
  globalSearchConcurrency: int("globalSearchConcurrency"),
  globalGenerationInflightWcuLimit: int("globalGenerationInflightWcuLimit"),
  degradationMode: mysqlEnum("degradationMode", ["normal", "elevated", "high", "critical", "exhausted"]).notNull().default("normal"),
  perUserGenerationWcuLimit: int("perUserGenerationWcuLimit").notNull().default(12),
  perUserSearchWcuLimit: int("perUserSearchWcuLimit").notNull().default(6),
  perUserGenerationConcurrency: int("perUserGenerationConcurrency").notNull().default(2),
  perUserSearchConcurrency: int("perUserSearchConcurrency").notNull().default(1),
  apexPressureReservePercent: int("apexPressureReservePercent").notNull().default(20),
  roleWeightsJson: text("roleWeightsJson").notNull(),
  modifierWeightsJson: text("modifierWeightsJson").notNull(),
  queueMaxWaitMs: int("queueMaxWaitMs").notNull().default(0),
  queueMaxDepth: int("queueMaxDepth").notNull().default(0),
  queueEligibleRolesJson: varchar("queueEligibleRolesJson", { length: 64 }).notNull().default('["fast"]'),
  reservationTtlSeconds: int("reservationTtlSeconds").notNull().default(180),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

/** Provider/model policy is owner-configurable but starts UNKNOWN: it contains no inferred provider quota. */
export const capacityProviderBudgets = mysqlTable("capacity_provider_budgets", {
  scopeKey: varchar("scopeKey", { length: 220 }).primaryKey(),
  provider: varchar("provider", { length: 48 }).notNull(),
  modelId: varchar("modelId", { length: 160 }),
  enabled: int("enabled").notNull().default(1),
  generationWcuLimit: int("generationWcuLimit"),
  maxConcurrent: int("maxConcurrent"),
  rpmLimit: int("rpmLimit"),
  tpmLimit: int("tpmLimit"),
  dailyUnitsLimit: int("dailyUnitsLimit"),
  dailyRequestLimit: int("dailyRequestLimit"),
  dailyTokenLimit: int("dailyTokenLimit"),
  resetWindow: varchar("resetWindow", { length: 96 }),
  cooldownState: mysqlEnum("cooldownState", ["unknown", "inherit_provider_health", "cooldown"]).notNull().default("inherit_provider_health"),
  roleEligibilityJson: text("roleEligibilityJson"),
  searchEligibility: mysqlEnum("searchEligibility", ["unknown", "eligible", "not_eligible"]).notNull().default("unknown"),
  eligibilityState: mysqlEnum("eligibilityState", ["unknown", "eligible", "not_eligible", "paid_required"]).notNull().default("unknown"),
  billingState: mysqlEnum("billingState", ["unknown", "free", "paid", "not_configured"]).notNull().default("unknown"),
  billingSafe: int("billingSafe"),
  quotaState: mysqlEnum("quotaState", ["unknown", "operator_configured"]).notNull().default("unknown"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => [index("capacity_provider_budgets_provider_idx").on(table.provider)]);

/** Scoped rolling fixed windows keep only aggregate WCU: no prompts, responses, tokens, user content or secrets. */
export const capacityBudgetWindows = mysqlTable("capacity_budget_windows", {
  scopeKey: varchar("scopeKey", { length: 220 }).primaryKey(),
  windowStarted: timestamp("windowStarted").defaultNow().notNull(),
  usedWcu: int("usedWcu").notNull().default(0),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

/** Atomic durable aggregate inflight counters. They coordinate best-effort guards across instances without holding private content. */
export const capacityInflightCounters = mysqlTable("capacity_inflight_counters", {
  scopeKey: varchar("scopeKey", { length: 220 }).primaryKey(),
  activeCount: int("activeCount").notNull().default(0),
  activeWcu: int("activeWcu").notNull().default(0),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

/** Reservation records make fallback accounting idempotent; scope keys are operational metadata only. */
export const capacityReservations = mysqlTable("capacity_reservations", {
  id: varchar("id", { length: 36 }).primaryKey(),
  requestKey: varchar("requestKey", { length: 180 }).notNull().unique(),
  userId: int("userId").references(() => users.id, { onDelete: "set null" }),
  kind: mysqlEnum("kind", ["generation", "search"]).notNull(),
  roleId: mysqlEnum("roleId", ["fast", "smart", "context", "flagship"]),
  provider: varchar("provider", { length: 48 }),
  modelId: varchar("modelId", { length: 160 }),
  wcu: int("wcu").notNull(),
  scopeKeysJson: text("scopeKeysJson").notNull(),
  inflightScopeKeysJson: text("inflightScopeKeysJson").notNull(),
  state: mysqlEnum("state", ["reserved", "settled", "released"]).notNull().default("reserved"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  finalizedAt: timestamp("finalizedAt"),
}, (table) => [
  index("capacity_reservations_created_idx").on(table.createdAt),
  index("capacity_reservations_user_created_idx").on(table.userId, table.createdAt),
]);

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;
export type ProviderIdentity = typeof providerIdentities.$inferSelect;
export type ChatSession = typeof chatSessions.$inferSelect;
export type ChatMessageRecord = typeof messages.$inferSelect;
export type ChatExport = typeof chatExports.$inferSelect;
export type ProviderHealthRecord = typeof providerHealth.$inferSelect;
export type ProviderDailyUsageRecord = typeof providerDailyUsage.$inferSelect;
export type FlashTtftMetricRecord = typeof flashTtftMetrics.$inferSelect;
export type SearchOutageLogRecord = typeof searchOutageLogs.$inferSelect;
export type SearchQualityMetricRecord = typeof searchQualityMetrics.$inferSelect;
export type WebSearchStatusRecord = typeof webSearchStatus.$inferSelect;
export type KnowledgeSource = typeof knowledgeSources.$inferSelect;
export type KnowledgeDocument = typeof knowledgeDocuments.$inferSelect;
export type KnowledgeIngestionRun = typeof knowledgeIngestionRuns.$inferSelect;
export type DevApiAuditRecord = typeof devApiAuditRecords.$inferSelect;
export type UserSettings = typeof userSettings.$inferSelect;
export type MemoryProfile = typeof memoryProfiles.$inferSelect;
export type MemorySettings = typeof memorySettings.$inferSelect;
export type MemoryEntry = typeof memoryEntries.$inferSelect;
export type MemoryExtractionJob = typeof memoryExtractionJobs.$inferSelect;
export type MemoryFact = typeof memoryFacts.$inferSelect;
export type ChatAttachment = typeof chatAttachments.$inferSelect;
export type CapacityControllerSettings = typeof capacityControllerSettings.$inferSelect;
export type CapacityProviderBudget = typeof capacityProviderBudgets.$inferSelect;
export type CapacityBudgetWindow = typeof capacityBudgetWindows.$inferSelect;
export type CapacityReservation = typeof capacityReservations.$inferSelect;
