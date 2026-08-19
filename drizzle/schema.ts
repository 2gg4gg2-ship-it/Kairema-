import { index, int, mysqlEnum, mysqlTable, text, timestamp, varchar } from "drizzle-orm/mysql-core";

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
export type WebSearchStatusRecord = typeof webSearchStatus.$inferSelect;
export type UserSettings = typeof userSettings.$inferSelect;
export type MemoryProfile = typeof memoryProfiles.$inferSelect;
export type MemoryFact = typeof memoryFacts.$inferSelect;
export type ChatAttachment = typeof chatAttachments.$inferSelect;
