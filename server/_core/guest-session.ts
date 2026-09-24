import { randomUUID } from "node:crypto";
import { parse as parseCookieHeader } from "cookie";
import type { Request, Response } from "express";
import { GUEST_COOKIE_NAME, GUEST_TTL_MS, GUEST_MAX_LIFETIME_MS } from "@shared/const";
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

/** H2: Compute expiresAt as min(now + sliding TTL, createdAt + absolute max lifetime) */
function computeGuestExpiresAt(createdAt: Date): Date {
  const now = Date.now();
  const sliding = now + GUEST_TTL_MS;
  const absolute = new Date(createdAt).getTime() + GUEST_MAX_LIFETIME_MS;
  return new Date(Math.min(sliding, absolute));
}

/** H2: Check if a guest has exceeded its absolute lifetime (7 days from creation) */
function isGuestBeyondAbsoluteLifetime(createdAt: Date, now: Date = new Date()): boolean {
  const absoluteExpiry = new Date(new Date(createdAt).getTime() + GUEST_MAX_LIFETIME_MS);
  return now >= absoluteExpiry;
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
      // EXG1 + H2: Do not resurrect an expired guest. If expiresAt is in the
      // past OR the guest has exceeded its absolute lifetime (7 days),
      // skip updateUserActivity, trigger best-effort lazy cleanup (C4), and
      // fall through to create a new guest.
      if (!existingUser.expiresAt || existingUser.expiresAt >= new Date()) {
        if (!isGuestBeyondAbsoluteLifetime(existingUser.createdAt)) {
          await db.updateUserActivity(existingUser.id);
          res.cookie(GUEST_COOKIE_NAME, existingToken, getGuestCookieOptions(req));
          return { userId: existingUser.id, openId: existingToken, isNew: false };
        }
      }
      // C4: Lazy cleanup triggered only when we detect an expired guest.
      void maybeLazyCleanupExpiredGuests();
    }
  }

  const openId = generateGuestOpenId();
  const now = new Date();
  // H2: Use absolute lifetime capped expiresAt, not pure sliding TTL
  const expiresAt = computeGuestExpiresAt(now);

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
  // H2: Also reject guests beyond absolute lifetime
  if (user.createdAt && isGuestBeyondAbsoluteLifetime(user.createdAt)) {
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

  const { users, chatAttachments, chatExports } = await import("../../drizzle/schema");
  const { lt, eq, and, inArray } = await import("drizzle-orm");

  // 1. Find all expired guest users
  const expiredGuests = await dbInstance.select({ id: users.id }).from(users).where(and(
    eq(users.isGuest, 1),
    lt(users.expiresAt, now)
  ));

  if (expiredGuests.length === 0) return 0;

  const guestIds = expiredGuests.map(g => g.id);

  // 2. Collect all physical B2 file keys for these guests across tables
  const attachments = await dbInstance.select({ userId: chatAttachments.userId, fileKey: chatAttachments.fileKey }).from(chatAttachments)
    .where(inArray(chatAttachments.userId, guestIds));
  const exports = await dbInstance.select({ userId: chatExports.userId, fileKey: chatExports.fileKey }).from(chatExports)
    .where(inArray(chatExports.userId, guestIds));

  // Build a map: userId -> set of fileKeys to delete
  const filesByUser = new Map<number, Set<string>>();
  const trackFile = (userId: number, fileKey: string) => {
    if (!filesByUser.has(userId)) filesByUser.set(userId, new Set());
    filesByUser.get(userId)!.add(fileKey);
  };
  for (const a of attachments) trackFile(a.userId, a.fileKey);
  for (const e of exports) trackFile(e.userId, e.fileKey);

  // 3. For each guest, attempt to delete all B2 objects.
  //    If any delete fails, skip DB deletion for that guest — retry next cycle.
  const deletableGuestIds: number[] = [];
  for (const guestId of guestIds) {
    const fileKeys = filesByUser.get(guestId);
    if (!fileKeys || fileKeys.size === 0) {
      deletableGuestIds.push(guestId);
      continue;
    }

    let allPhysicalDeleted = true;
    for (const fileKey of Array.from(fileKeys)) {
      try {
        await storageDelete(fileKey);
      } catch {
        console.warn(`[Guest Cleanup] Failed to delete B2 object for user ${guestId}: ${fileKey}`);
        allPhysicalDeleted = false;
      }
    }

    if (allPhysicalDeleted) {
      deletableGuestIds.push(guestId);
    } else {
      // H4: Preserve the DB record so the next cleanup cycle can retry B2 deletion.
      console.warn(`[Guest Cleanup] Skipping DB deletion for user ${guestId} — B2 cleanup incomplete`);
    }
  }

  if (deletableGuestIds.length === 0) return 0;

  // 4. Delete only guests whose B2 objects were successfully removed.
  const result = await dbInstance.delete(users).where(and(
    eq(users.isGuest, 1),
    inArray(users.id, deletableGuestIds)
  ));
  return Number(result[0]?.affectedRows ?? 0);
}

/**
 * Lazy cleanup pass: triggers cleanup of expired guests on-demand.
 * Called after Render sleep when the scheduled cron route may be idle.
 * Best-effort — never throws, never blocks the caller.
 */
export async function maybeLazyCleanupExpiredGuests(): Promise<void> {
  try {
    await cleanupExpiredGuests();
  } catch {
    // Best-effort; next startup or cron run will retry
  }
}

/**
 * Startup cleanup pass: runs once after the app is ready to serve requests.
 * This is a free-first fallback when the external cron job was missed
 * (e.g. Render free tier sleeps).
 */
export async function startupCleanupExpiredGuests(): Promise<void> {
  if (process.env.NODE_ENV === "test") return;
  try {
    const deletedCount = await cleanupExpiredGuests();
    if (deletedCount > 0) console.log(`[Startup Cleanup] Removed ${deletedCount} expired guests`);
  } catch (error) {
    console.warn("[Startup Cleanup] failed:", error);
  }
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