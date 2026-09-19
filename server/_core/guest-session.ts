import { randomUUID } from "node:crypto";
import { parse as parseCookieHeader } from "cookie";
import type { Request, Response } from "express";
import { GUEST_COOKIE_NAME, GUEST_TTL_MS } from "@shared/const";
import * as db from "../db";
import { getSessionCookieOptions } from "./cookies";

export type GuestUser = {
  userId: number;
  openId: string;
  isNew: boolean;
};

const GUEST_OPENID_PREFIX = "guest_";

function generateGuestOpenId(): string {
  return `${GUEST_OPENID_PREFIX}${randomUUID()}`;
}

function getGuestCookieOptions(req: Request) {
  return {
    ...getSessionCookieOptions(req),
    maxAge: GUEST_TTL_MS,
  };
}

export function getGuestTokenFromCookie(req: Request): string | null {
  const cookies = parseCookieHeader(req.headers.cookie ?? "");
  const raw = cookies[GUEST_COOKIE_NAME];
  if (!raw || typeof raw !== "string") return null;
  const token = raw.trim();
  return token.startsWith(GUEST_OPENID_PREFIX) ? token : null;
}

export async function getOrCreateGuestUser(req: Request, res: Response): Promise<GuestUser> {
  const existingToken = getGuestTokenFromCookie(req);

  if (existingToken) {
    const existingUser = await db.getUserByOpenId(existingToken);
    if (existingUser && existingUser.isGuest === 1) {
      await db.updateUserActivity(existingUser.id);
      res.cookie(GUEST_COOKIE_NAME, existingToken, getGuestCookieOptions(req));
      return { userId: existingUser.id, openId: existingToken, isNew: false };
    }
  }

  const openId = generateGuestOpenId();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + GUEST_TTL_MS);

  await db.upsertUser({
    openId,
    isGuest: 1,
    expiresAt,
    lastActivityAt: now,
    lastSignedIn: now,
  });

  const user = await db.getUserByOpenId(openId);
  if (!user) throw new Error("Failed to create guest user");

  res.cookie(GUEST_COOKIE_NAME, openId, getGuestCookieOptions(req));
  return { userId: user.id, openId, isNew: true };
}

export async function validateGuestSession(req: Request, res: Response): Promise<{ userId: number; openId: string } | null> {
  const token = getGuestTokenFromCookie(req);
  if (!token) return null;

  const user = await db.getUserByOpenId(token);
  if (!user || user.isGuest !== 1) return null;

  if (user.expiresAt && user.expiresAt < new Date()) {
    return null;
  }

  await db.updateUserActivity(user.id);
  res.cookie(GUEST_COOKIE_NAME, token, getGuestCookieOptions(req));
  return { userId: user.id, openId: token };
}

// Lightweight validation without cookie update (for SDK)
export async function validateGuestToken(token: string): Promise<{ userId: number; openId: string } | null> {
  if (!token || !token.startsWith(GUEST_OPENID_PREFIX)) return null;

  const user = await db.getUserByOpenId(token);
  if (!user || user.isGuest !== 1) return null;

  if (user.expiresAt && user.expiresAt < new Date()) {
    return null;
  }

  return { userId: user.id, openId: token };
}

export async function clearGuestCookie(res: Response, req: Request): Promise<void> {
  res.clearCookie(GUEST_COOKIE_NAME, {
    ...getSessionCookieOptions(req),
    maxAge: -1,
  });
}

export function isGuestOpenId(openId: string): boolean {
  return openId.startsWith(GUEST_OPENID_PREFIX);
}

export async function cleanupExpiredGuests(now = new Date()): Promise<number> {
  const dbInstance = await (await import("../db")).getDb();
  if (!dbInstance) return 0;

  const { users } = await import("../../drizzle/schema");
  const { lt, eq, and } = await import("drizzle-orm");

  const result = await dbInstance.delete(users).where(and(
    eq(users.isGuest, 1),
    lt(users.expiresAt, now)
  ));
  return Number((result as { rowsAffected?: number } | undefined)?.rowsAffected ?? 0);
}

export type PromoteGuestInput = {
  guestUserId: number;
  email: string;
  name?: string | null;
  loginMethod: string;
};

export async function promoteGuest(input: PromoteGuestInput): Promise<{ userId: number; openId: string } | null> {
  const dbInstance = await (await import("../db")).getDb();
  if (!dbInstance) return null;

  const { users, providerIdentities, chatSessions, messages, chatAttachments, chatExports, chatDrafts,
    userSettings, memoryProfiles, memorySettings, memoryEntries, memoryFacts, memoryExtractionJobs,
    devApiRateWindows, chatStreamRateWindows, devApiAuditRecords, stytchLinkIntents } = await import("../../drizzle/schema");
  const { eq, and } = await import("drizzle-orm");

  const guest = await dbInstance.select().from(users).where(and(eq(users.id, input.guestUserId), eq(users.isGuest, 1))).limit(1);
  if (!guest[0]) return null;

  const now = new Date();
  const canonicalOpenId = `promoted_${randomUUID()}`;

  await dbInstance.transaction(async (tx) => {
    await tx.insert(users).values({
      openId: canonicalOpenId,
      email: input.email,
      name: input.name ?? null,
      loginMethod: input.loginMethod,
      isGuest: 0,
      expiresAt: null,
      lastActivityAt: now,
      lastSignedIn: now,
      createdAt: now,
      updatedAt: now,
      role: "user",
    });

    const [newUser] = await tx.select().from(users).where(eq(users.openId, canonicalOpenId)).limit(1);
    if (!newUser) throw new Error("Failed to create promoted user");

    const newUserId = newUser.id;

    await Promise.all([
      tx.update(chatSessions).set({ userId: newUserId }).where(eq(chatSessions.userId, input.guestUserId)),
      tx.update(chatAttachments).set({ userId: newUserId }).where(eq(chatAttachments.userId, input.guestUserId)),
      tx.update(chatExports).set({ userId: newUserId }).where(eq(chatExports.userId, input.guestUserId)),
      tx.update(chatDrafts).set({ userId: newUserId }).where(eq(chatDrafts.userId, input.guestUserId)),
      tx.update(memoryEntries).set({ userId: newUserId }).where(eq(memoryEntries.userId, input.guestUserId)),
      tx.update(memoryFacts).set({ userId: newUserId }).where(eq(memoryFacts.userId, input.guestUserId)),
      tx.update(memoryProfiles).set({ userId: newUserId }).where(eq(memoryProfiles.userId, input.guestUserId)),
      tx.update(memorySettings).set({ userId: newUserId }).where(eq(memorySettings.userId, input.guestUserId)),
      tx.update(userSettings).set({ userId: newUserId }).where(eq(userSettings.userId, input.guestUserId)),
      tx.update(memoryExtractionJobs).set({ userId: newUserId }).where(eq(memoryExtractionJobs.userId, input.guestUserId)),
      tx.update(devApiRateWindows).set({ userId: newUserId }).where(eq(devApiRateWindows.userId, input.guestUserId)),
      tx.update(chatStreamRateWindows).set({ userId: newUserId }).where(eq(chatStreamRateWindows.userId, input.guestUserId)),
      tx.update(devApiAuditRecords).set({ userId: newUserId }).where(eq(devApiAuditRecords.userId, input.guestUserId)),
      tx.update(providerIdentities).set({ userId: newUserId }).where(eq(providerIdentities.userId, input.guestUserId)),
      tx.update(stytchLinkIntents).set({ userId: newUserId }).where(eq(stytchLinkIntents.userId, input.guestUserId)),
    ]);

    await tx.delete(users).where(eq(users.id, input.guestUserId));
  });

  return { userId: input.guestUserId, openId: canonicalOpenId };
}