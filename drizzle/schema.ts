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

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;
export type ChatSession = typeof chatSessions.$inferSelect;
export type ChatMessageRecord = typeof messages.$inferSelect;
export type ChatExport = typeof chatExports.$inferSelect;
export type ProviderHealthRecord = typeof providerHealth.$inferSelect;
