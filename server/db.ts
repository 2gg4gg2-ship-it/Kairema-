import { and, asc, desc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { randomUUID } from "node:crypto";
import { ChatMessageRecord, ChatSession, InsertUser, chatSessions, messages, users } from "../drizzle/schema";
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

export async function appendChatMessage(userId: number, sessionId: string, role: "user" | "assistant", content: string, modelId?: string): Promise<void> {
  const db = requireDatabase(await getDb());
  requireOwnedSession(userId, await getOwnedChatSession(userId, sessionId));
  await db.insert(messages).values({ sessionId, role, content, modelId: modelId ?? null });
  await db.update(chatSessions).set({ updatedAt: new Date(), ...(modelId ? { modelId } : {}) }).where(eq(chatSessions.id, sessionId));
}

export async function updateChatTitle(userId: number, sessionId: string, title: string): Promise<void> {
  const db = requireDatabase(await getDb());
  await db.update(chatSessions).set({ title, updatedAt: new Date() }).where(and(eq(chatSessions.id, sessionId), eq(chatSessions.userId, userId)));
}
