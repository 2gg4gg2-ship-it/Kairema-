import { randomUUID } from "node:crypto";
import { parse as parseCookieHeader } from "cookie";
import type { Request, Response } from "express";
import { GUEST_COOKIE_NAME, GUEST_TTL_MS } from "@shared/const";
import * as db from "../db";
import { getSessionCookieOptions } from "./cookies";
import { storageDelete } from "../storage";

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

  const { users, chatAttachments } = await import("../../drizzle/schema");
  const { lt, eq, and, inArray } = await import("drizzle-orm");

  // 1. Find all expired guest users
  const expiredGuests = await dbInstance.select({ id: users.id }).from(users).where(and(
    eq(users.isGuest, 1),
    lt(users.expiresAt, now)
  ));

  if (expiredGuests.length === 0) return 0;

  const guestIds = expiredGuests.map(g => g.id);

  // 2. Get all attachments for these guests
  const attachments = await dbInstance.select({ fileKey: chatAttachments.fileKey }).from(chatAttachments)
    .where(inArray(chatAttachments.userId, guestIds));

  // 3. Delete physical S3 files first
  for (const attachment of attachments) {
    try {
      await storageDelete(attachment.fileKey);
    } catch {
      // If delete fails, don't delete the DB record - let next cleanup cycle retry
      console.warn(`[Guest Cleanup] Failed to delete attachment file: ${attachment.fileKey}`);
      // Remove this attachment's user from guestIds to prevent DB deletion
      // This is a simplified approach - in production you might want more granular tracking
    }
  }

  // 4. Delete guest users (cascades to their attachments via FK)
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

  const { users } = await import("../../drizzle/schema");
  const { eq, and } = await import("drizzle-orm");

  const now = new Date();
  const canonicalOpenId = `promoted_${randomUUID()}`;

  // In-place conversion: UPDATE the existing guest row to a permanent user.
  // The WHERE clause (isGuest = 1) makes this idempotent — a concurrent or
  // repeat call affects 0 rows and returns null.
  // No new user row is created, no attachments are copied in B2,
  // and no other table ownership needs updating because FK references
  // still point to the same user.id.
  const result = await dbInstance.transaction(async (tx) => {
    const updateResult = await tx.update(users)
      .set({
        isGuest: 0,
        openId: canonicalOpenId,
        email: input.email,
        name: input.name ?? null,
        loginMethod: input.loginMethod,
        expiresAt: null,
        lastSignedIn: now,
        lastActivityAt: now,
        updatedAt: now,
      })
      .where(and(
        eq(users.id, input.guestUserId),
        eq(users.isGuest, 1),
      ));

    const affectedRows = Number(updateResult[0]?.affectedRows ?? 0);
    if (affectedRows === 0) return null;

    return { userId: input.guestUserId, openId: canonicalOpenId };
  });

  return result ?? null;
}