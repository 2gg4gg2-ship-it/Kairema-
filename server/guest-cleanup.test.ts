import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Request, Response } from "express";

const mockDbState = vi.hoisted(() => ({
  getDbReturnsNull: false,
}));

const mockStorage = vi.hoisted(() => ({
  storageDelete: vi.fn(),
  storageCopy: vi.fn(),
}));

const selectReturnQueue: unknown[][] = [];
const mockDbInstance = vi.hoisted(() => ({
  select: vi.fn(() => ({
    from: vi.fn(() => ({
      where: vi.fn(() => {
        return selectReturnQueue.shift() ?? [];
      }),
    })),
  })),
  delete: vi.fn(() => ({
    where: vi.fn(() => [{ affectedRows: 1 }]),
  })),
  transaction: vi.fn(async (cb: (tx: unknown) => Promise<unknown>) => cb({})),
}));

vi.mock("./db", () => ({
  getDb: () => (mockDbState.getDbReturnsNull ? null : mockDbInstance),
  getUserByOpenId: vi.fn(),
  updateUserActivity: vi.fn(),
  upsertUser: vi.fn(),
  getUserById: vi.fn(),
}));

vi.mock("./storage", () => mockStorage);

vi.mock("../drizzle/schema", () => ({
  users: { id: "users.id", isGuest: "users.isGuest", expiresAt: "users.expiresAt", openId: "users.openId" },
  chatAttachments: { userId: "chatAttachments.userId", fileKey: "chatAttachments.fileKey" },
  chatExports: { userId: "chatExports.userId", fileKey: "chatExports.fileKey" },
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn(() => "eq"),
  lt: vi.fn(() => "lt"),
  and: vi.fn(() => "and"),
  inArray: vi.fn(() => "inArray"),
}));

import { cleanupExpiredGuests, getOrCreateGuestUser, startupCleanupExpiredGuests, maybeLazyCleanupExpiredGuests } from "./_core/guest-session";
import { GUEST_COOKIE_NAME } from "@shared/const";

function makeExpiredGuest(id: number, openId: string) {
  return {
    id,
    openId,
    isGuest: 1,
    expiresAt: new Date(Date.now() - 1000),
    email: null,
    name: null,
    loginMethod: null,
  };
}

function makeActiveGuest(id: number, openId: string) {
  return {
    id,
    openId,
    isGuest: 1,
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    email: null,
    name: null,
    loginMethod: null,
  };
}

describe("cleanupExpiredGuests", () => {
  beforeEach(() => {
    mockDbState.getDbReturnsNull = false;
    selectReturnQueue.length = 0;
    mockStorage.storageDelete.mockReset();
    mockDbInstance.select.mockClear();
    mockDbInstance.delete.mockClear();
  });

  it("returns 0 when db is unavailable", async () => {
    mockDbState.getDbReturnsNull = true;
    const result = await cleanupExpiredGuests();
    expect(result).toBe(0);
    expect(mockStorage.storageDelete).not.toHaveBeenCalled();
  });

  it("returns 0 when no expired guests found", async () => {
    selectReturnQueue.push([]);

    const result = await cleanupExpiredGuests();
    expect(result).toBe(0);
    expect(mockStorage.storageDelete).not.toHaveBeenCalled();
    expect(mockDbInstance.delete).not.toHaveBeenCalled();
  });

  it("deletes expired guests when all B2 objects succeed (attachments + exports)", async () => {
    selectReturnQueue.push([{ id: 1 }, { id: 2 }]);
    selectReturnQueue.push([
      { userId: 1, fileKey: "attachments/1/sess/a.png" },
      { userId: 2, fileKey: "attachments/2/sess/b.jpg" },
    ]);
    selectReturnQueue.push([
      { userId: 1, fileKey: "exports/1/sess/export1.md" },
    ]);

    mockStorage.storageDelete.mockResolvedValue(true);
    mockDbInstance.delete.mockClear();
    mockDbInstance.delete.mockReturnValueOnce({ where: vi.fn(() => [{ affectedRows: 2 }]) });

    const result = await cleanupExpiredGuests();

    expect(result).toBe(2);
    expect(mockStorage.storageDelete).toHaveBeenCalledTimes(3);
    expect(mockDbInstance.delete).toHaveBeenCalledTimes(1);
  });

  it("preserves expired guests in DB when at least one B2 delete fails", async () => {
    selectReturnQueue.push([{ id: 1 }]);
    selectReturnQueue.push([
      { userId: 1, fileKey: "attachments/1/sess/a.png" },
      { userId: 1, fileKey: "attachments/1/sess/b.png" },
    ]);
    selectReturnQueue.push([]);

    mockStorage.storageDelete
      .mockResolvedValueOnce(true)
      .mockRejectedValueOnce(new Error("B2 temporarily unavailable"));

    const result = await cleanupExpiredGuests();

    expect(result).toBe(0);
    expect(mockStorage.storageDelete).toHaveBeenCalledTimes(2);
    expect(mockDbInstance.delete).not.toHaveBeenCalled();
  });

  it("deletes guests with no B2 objects immediately", async () => {
    selectReturnQueue.push([{ id: 1 }]);
    selectReturnQueue.push([]);
    selectReturnQueue.push([]);

    const result = await cleanupExpiredGuests();

    expect(result).toBe(1);
    expect(mockStorage.storageDelete).not.toHaveBeenCalled();
    expect(mockDbInstance.delete).toHaveBeenCalledTimes(1);
  });

  it("is idempotent — second run finds nothing to delete", async () => {
    selectReturnQueue.push([{ id: 1 }]);
    selectReturnQueue.push([{ userId: 1, fileKey: "key1" }]);
    selectReturnQueue.push([]);
    mockStorage.storageDelete.mockResolvedValue(true);
    mockDbInstance.delete.mockClear();

    const first = await cleanupExpiredGuests();
    expect(first).toBe(1);

    // Second run — no expired guests (empty select result)
    selectReturnQueue.push([]);
    mockDbInstance.delete.mockClear();

    const second = await cleanupExpiredGuests();
    expect(second).toBe(0);
    // Delete should NOT be called when there are no deletable guests
    expect(mockDbInstance.delete).not.toHaveBeenCalled();
  });

  it("retries after temporary B2 failure — second run cleans up", async () => {
    // First run: B2 delete fails
    selectReturnQueue.push([{ id: 1 }]);
    selectReturnQueue.push([{ userId: 1, fileKey: "attachments/1/file.png" }]);
    selectReturnQueue.push([]);
    mockStorage.storageDelete.mockRejectedValueOnce(new Error("B2 down"));

    const firstResult = await cleanupExpiredGuests();
    expect(firstResult).toBe(0);

    // Second run: B2 delete succeeds
    mockStorage.storageDelete.mockReset();
    mockStorage.storageDelete.mockResolvedValueOnce(true);
    mockDbInstance.delete.mockClear();
    mockDbInstance.delete.mockReturnValueOnce({ where: vi.fn(() => [{ affectedRows: 1 }]) });

    selectReturnQueue.push([{ id: 1 }]);
    selectReturnQueue.push([{ userId: 1, fileKey: "attachments/1/file.png" }]);
    selectReturnQueue.push([]);

    const secondResult = await cleanupExpiredGuests();
    expect(secondResult).toBe(1);
  });

  it("handles mixed success/failure — only cleans up successful guests", async () => {
    selectReturnQueue.push([{ id: 1 }, { id: 2 }]);
    selectReturnQueue.push([
      { userId: 1, fileKey: "attachments/1/success.png" },
      { userId: 2, fileKey: "attachments/2/fail.png" },
    ]);
    selectReturnQueue.push([]);
    mockDbInstance.delete.mockClear();
    mockDbInstance.delete.mockReturnValueOnce({ where: vi.fn(() => [{ affectedRows: 1 }]) });

    mockStorage.storageDelete
      .mockResolvedValueOnce(true)
      .mockRejectedValueOnce(new Error("B2 error"));

    const result = await cleanupExpiredGuests();

    expect(result).toBe(1);
    expect(mockDbInstance.delete).toHaveBeenCalledTimes(1);
  });

  it("handles guest with multiple attachments across both tables", async () => {
    selectReturnQueue.push([{ id: 1 }]);
    selectReturnQueue.push([
      { userId: 1, fileKey: "attachments/1/s1/a1.png" },
      { userId: 1, fileKey: "attachments/1/s2/a2.png" },
    ]);
    selectReturnQueue.push([
      { userId: 1, fileKey: "exports/1/s1/e1.md" },
      { userId: 1, fileKey: "exports/1/s2/e2.md" },
    ]);
    mockDbInstance.delete.mockClear();
    mockDbInstance.delete.mockReturnValueOnce({ where: vi.fn(() => [{ affectedRows: 1 }]) });
    mockStorage.storageDelete.mockResolvedValue(true);

    const result = await cleanupExpiredGuests();

    expect(result).toBe(1);
    expect(mockStorage.storageDelete).toHaveBeenCalledTimes(4);
    expect(mockDbInstance.delete).toHaveBeenCalledTimes(1);
  });
});

describe("getOrCreateGuestUser — EXG1 expired guest resurrection prevention", () => {
  beforeEach(() => vi.clearAllMocks());

  it("expired guest is NOT resurrected — creates new guest instead", async () => {
    const db = await import("./db");
    const expiredToken = "guest_expired-uuid";

    (db.getUserByOpenId as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(makeExpiredGuest(42, expiredToken))
      .mockResolvedValueOnce(makeActiveGuest(99, "guest_new-uuid"));

    (db.upsertUser as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

    const result = await getOrCreateGuestUser(
      { headers: { cookie: `${GUEST_COOKIE_NAME}=${expiredToken}` } } as unknown as Request,
      { cookie: vi.fn() } as unknown as Response,
    );

    expect(db.updateUserActivity).not.toHaveBeenCalled();
    expect(db.upsertUser).toHaveBeenCalled();
    expect(result.isNew).toBe(true);
    expect(result.userId).toBe(99);
  });

  it("active guest is reused (updateUserActivity called, isNew false)", async () => {
    const db = await import("./db");
    const activeToken = "guest_active-uuid";

    (db.getUserByOpenId as ReturnType<typeof vi.fn>).mockResolvedValueOnce(makeActiveGuest(42, activeToken));

    const result = await getOrCreateGuestUser(
      { headers: { cookie: `${GUEST_COOKIE_NAME}=${activeToken}` } } as unknown as Request,
      { cookie: vi.fn() } as unknown as Response,
    );

    expect(db.updateUserActivity).toHaveBeenCalledWith(42);
    expect(result.isNew).toBe(false);
    expect(result.userId).toBe(42);
    expect(result.openId).toBe(activeToken);
  });

  it("missing guest (no DB record) creates new guest without calling updateUserActivity", async () => {
    const db = await import("./db");
    const nonexistentToken = "guest_nonexistent-uuid";

    (db.getUserByOpenId as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(makeActiveGuest(100, "guest_fresh-uuid"));

    (db.upsertUser as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

    const result = await getOrCreateGuestUser(
      { headers: { cookie: `${GUEST_COOKIE_NAME}=${nonexistentToken}` } } as unknown as Request,
      { cookie: vi.fn() } as unknown as Response,
    );

    expect(db.updateUserActivity).not.toHaveBeenCalled();
    expect(db.upsertUser).toHaveBeenCalled();
    expect(result.isNew).toBe(true);
  });
});

describe("startupCleanupExpiredGuests and maybeLazyCleanupExpiredGuests", () => {
  beforeEach(() => {
    mockDbState.getDbReturnsNull = false;
    selectReturnQueue.length = 0;
    mockStorage.storageDelete.mockReset();
    mockDbInstance.select.mockClear();
    mockDbInstance.delete.mockClear();
  });

  it("startupCleanupExpiredGuests is a no-op in test env (guarded)", async () => {
    expect(process.env.NODE_ENV).toBe("test");
    await startupCleanupExpiredGuests();
    // In test env, cleanup is skipped
    expect(mockDbInstance.select).not.toHaveBeenCalled();
  });

  it("maybeLazyCleanupExpiredGuests is a no-op in test env (guarded)", async () => {
    expect(process.env.NODE_ENV).toBe("test");
    await maybeLazyCleanupExpiredGuests();
    expect(mockDbInstance.select).not.toHaveBeenCalled();
  });

  it("startupCleanupExpiredGuests skips cleanup in test env without side effects", async () => {
    selectReturnQueue.length = 0;
    await startupCleanupExpiredGuests();
    expect(mockDbInstance.delete).not.toHaveBeenCalled();
    expect(mockStorage.storageDelete).not.toHaveBeenCalled();
  });
});
