import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Request, Response } from "express";

const mockDbState = vi.hoisted(() => ({
  getDbReturnsNull: false,
}));

const mockStorage = vi.hoisted(() => ({
  storageDelete: vi.fn(),
  storageCopy: vi.fn(),
}));

const mockDbInstance = vi.hoisted(() => {
  const whereFn = vi.fn(() => []);
  const fromFn = vi.fn(() => ({ where: whereFn }));
  return {
    select: vi.fn(() => ({ from: fromFn })),
    delete: vi.fn(() => ({
      where: vi.fn(() => [{ affectedRows: 1 }]),
    })),
    transaction: vi.fn(async (cb: (tx: unknown) => Promise<unknown>) => cb({})),
    _whereFn: whereFn,
    _fromFn: fromFn,
  };
});

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
  return { id, openId, isGuest: 1, expiresAt: new Date(Date.now() - 1000), email: null, name: null, loginMethod: null };
}

function makeActiveGuest(id: number, openId: string) {
  return { id, openId, isGuest: 1, expiresAt: new Date(Date.now() + 60 * 60 * 1000), email: null, name: null, loginMethod: null };
}

describe("cleanupExpiredGuests", () => {
  beforeEach(() => {
    mockDbState.getDbReturnsNull = false;
    mockDbInstance._whereFn.mockReset();
    mockDbInstance._fromFn.mockClear();
    mockDbInstance.select.mockClear();
    mockDbInstance.delete.mockClear();
    mockStorage.storageDelete.mockReset();
  });

  it("returns 0 when db is unavailable", async () => {
    mockDbState.getDbReturnsNull = true;
    const result = await cleanupExpiredGuests();
    expect(result).toBe(0);
    expect(mockStorage.storageDelete).not.toHaveBeenCalled();
  });

  it("returns 0 when no expired guests found", async () => {
    mockDbInstance._whereFn.mockReturnValueOnce([]);
    const result = await cleanupExpiredGuests();
    expect(result).toBe(0);
    expect(mockStorage.storageDelete).not.toHaveBeenCalled();
    expect(mockDbInstance.delete).not.toHaveBeenCalled();
  });

  it("deletes expired guests when all B2 objects succeed (attachments + exports)", async () => {
    mockDbInstance._whereFn
      .mockReturnValueOnce([{ id: 1 }, { id: 2 }])
      .mockReturnValueOnce([
        { userId: 1, fileKey: "attachments/1/sess/a.png" },
        { userId: 2, fileKey: "attachments/2/sess/b.jpg" },
      ])
      .mockReturnValueOnce([
        { userId: 1, fileKey: "exports/1/sess/export1.md" },
      ]);
    mockDbInstance.delete.mockClear();
    mockDbInstance.delete.mockReturnValueOnce({ where: vi.fn(() => [{ affectedRows: 2 }]) });
    mockStorage.storageDelete.mockResolvedValue(true);

    const result = await cleanupExpiredGuests();

    expect(result).toBe(2);
    expect(mockStorage.storageDelete).toHaveBeenCalledTimes(3);
    expect(mockDbInstance.delete).toHaveBeenCalledTimes(1);
  });

  it("preserves expired guests in DB when at least one B2 delete fails", async () => {
    mockDbInstance._whereFn
      .mockReturnValueOnce([{ id: 1 }])
      .mockReturnValueOnce([
        { userId: 1, fileKey: "attachments/1/sess/a.png" },
        { userId: 1, fileKey: "attachments/1/sess/b.png" },
      ])
      .mockReturnValueOnce([]);

    mockStorage.storageDelete
      .mockResolvedValueOnce(true)
      .mockRejectedValueOnce(new Error("B2 temporarily unavailable"));

    const result = await cleanupExpiredGuests();

    expect(result).toBe(0);
    expect(mockStorage.storageDelete).toHaveBeenCalledTimes(2);
    expect(mockDbInstance.delete).not.toHaveBeenCalled();
  });

  it("deletes guests with no B2 objects immediately", async () => {
    mockDbInstance._whereFn
      .mockReturnValueOnce([{ id: 1 }])
      .mockReturnValueOnce([])
      .mockReturnValueOnce([]);

    const result = await cleanupExpiredGuests();

    expect(result).toBe(1);
    expect(mockStorage.storageDelete).not.toHaveBeenCalled();
    expect(mockDbInstance.delete).toHaveBeenCalledTimes(1);
  });

  it("is idempotent — second run finds nothing to delete", async () => {
    mockDbInstance._whereFn
      .mockReturnValueOnce([{ id: 1 }])
      .mockReturnValueOnce([{ userId: 1, fileKey: "key1" }])
      .mockReturnValueOnce([]);
    mockStorage.storageDelete.mockResolvedValue(true);

    const first = await cleanupExpiredGuests();
    expect(first).toBe(1);

    mockDbInstance._whereFn.mockReset();
    mockDbInstance._whereFn.mockReturnValueOnce([]);
    mockDbInstance.delete.mockClear();

    const second = await cleanupExpiredGuests();
    expect(second).toBe(0);
    expect(mockDbInstance.delete).not.toHaveBeenCalled();
  });

  it("retries after temporary B2 failure — second run cleans up", async () => {
    mockDbInstance._whereFn
      .mockReturnValueOnce([{ id: 1 }])
      .mockReturnValueOnce([{ userId: 1, fileKey: "attachments/1/file.png" }])
      .mockReturnValueOnce([]);
    mockStorage.storageDelete.mockRejectedValueOnce(new Error("B2 down"));

    const firstResult = await cleanupExpiredGuests();
    expect(firstResult).toBe(0);

    mockDbInstance._whereFn.mockReset();
    mockStorage.storageDelete.mockReset();
    mockDbInstance._whereFn
      .mockReturnValueOnce([{ id: 1 }])
      .mockReturnValueOnce([{ userId: 1, fileKey: "attachments/1/file.png" }])
      .mockReturnValueOnce([]);
    mockStorage.storageDelete.mockResolvedValueOnce(true);

    const secondResult = await cleanupExpiredGuests();
    expect(secondResult).toBe(1);
  });

  it("handles mixed success/failure — only cleans up successful guests", async () => {
    mockDbInstance._whereFn
      .mockReturnValueOnce([{ id: 1 }, { id: 2 }])
      .mockReturnValueOnce([
        { userId: 1, fileKey: "attachments/1/success.png" },
        { userId: 2, fileKey: "attachments/2/fail.png" },
      ])
      .mockReturnValueOnce([]);
    mockStorage.storageDelete
      .mockResolvedValueOnce(true)
      .mockRejectedValueOnce(new Error("B2 error"));

    const result = await cleanupExpiredGuests();

    expect(result).toBe(1);
    expect(mockDbInstance.delete).toHaveBeenCalledTimes(1);
  });

  it("handles guest with multiple attachments across both tables", async () => {
    mockDbInstance._whereFn
      .mockReturnValueOnce([{ id: 1 }])
      .mockReturnValueOnce([
        { userId: 1, fileKey: "attachments/1/s1/a1.png" },
        { userId: 1, fileKey: "attachments/1/s2/a2.png" },
      ])
      .mockReturnValueOnce([
        { userId: 1, fileKey: "exports/1/s1/e1.md" },
        { userId: 1, fileKey: "exports/1/s2/e2.md" },
      ]);
    mockStorage.storageDelete.mockResolvedValue(true);

    const result = await cleanupExpiredGuests();

    expect(result).toBe(1);
    expect(mockStorage.storageDelete).toHaveBeenCalledTimes(4);
    expect(mockDbInstance.delete).toHaveBeenCalledTimes(1);
  });
});

describe("getOrCreateGuestUser — EXG1", () => {
  beforeEach(async () => {
    mockDbState.getDbReturnsNull = false;
    mockDbInstance._whereFn.mockReset();
    mockStorage.storageDelete.mockReset();
    // Restore select to original implementation (vi.fn doesn't clear impl, but mockReset might)
    mockDbInstance.select.mockImplementation(() => ({ from: mockDbInstance._fromFn }));
    mockDbInstance.delete.mockClear();
    // Clear db module mock functions
    const db = await import("./db");
    (db.getUserByOpenId as ReturnType<typeof vi.fn>).mockClear();
    (db.upsertUser as ReturnType<typeof vi.fn>).mockClear();
    (db.updateUserActivity as ReturnType<typeof vi.fn>).mockClear();
  });

  it("expired guest is NOT resurrected — creates new guest instead", async () => {
    const db = await import("./db");
    (db.getUserByOpenId as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(makeExpiredGuest(42, "guest_expired-uuid"))
      .mockResolvedValueOnce(makeActiveGuest(99, "guest_new-uuid"));
    (db.upsertUser as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

    const result = await getOrCreateGuestUser(
      { headers: { cookie: `${GUEST_COOKIE_NAME}=guest_expired-uuid` } } as unknown as Request,
      { cookie: vi.fn() } as unknown as Response,
    );

    expect(db.updateUserActivity).not.toHaveBeenCalled();
    expect(db.upsertUser).toHaveBeenCalled();
    expect(result.isNew).toBe(true);
    expect(result.userId).toBe(99);
  });

  it("expired guest triggers lazy cleanup (C4)", async () => {
    const db = await import("./db");
    (db.getUserByOpenId as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(makeExpiredGuest(42, "guest_expired-uuid"))
      .mockResolvedValueOnce(makeActiveGuest(99, "guest_fresh-uuid"));
    (db.upsertUser as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

    mockDbInstance._whereFn.mockReturnValueOnce([]);

    await getOrCreateGuestUser(
      { headers: { cookie: `${GUEST_COOKIE_NAME}=guest_expired-uuid` } } as unknown as Request,
      { cookie: vi.fn() } as unknown as Response,
    );

    // Wait for fire-and-forget lazy cleanup microtask
    await new Promise(resolve => setImmediate(resolve));

    expect(mockDbInstance.select).toHaveBeenCalled();
  });

  it("active guest is reused — updateUserActivity called, lazy cleanup NOT triggered", async () => {
    const db = await import("./db");
    (db.getUserByOpenId as ReturnType<typeof vi.fn>).mockResolvedValueOnce(makeActiveGuest(42, "guest_active-uuid"));

    mockDbInstance.select.mockClear();

    const result = await getOrCreateGuestUser(
      { headers: { cookie: `${GUEST_COOKIE_NAME}=guest_active-uuid` } } as unknown as Request,
      { cookie: vi.fn() } as unknown as Response,
    );

    expect(db.updateUserActivity).toHaveBeenCalledWith(42);
    expect(mockDbInstance.select).not.toHaveBeenCalled();
    expect(result.isNew).toBe(false);
    expect(result.userId).toBe(42);
    expect(result.openId).toBe("guest_active-uuid");
  });

  it("cleanup error during lazy cleanup does NOT block new guest creation", async () => {
    const db = await import("./db");
    (db.getUserByOpenId as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(makeExpiredGuest(42, "guest_expired-uuid"))
      .mockResolvedValueOnce(makeActiveGuest(99, "guest_new-uuid"));
    (db.upsertUser as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

    mockDbInstance.select.mockImplementation(() => {
      throw new Error("DB down during cleanup");
    });

    const result = await getOrCreateGuestUser(
      { headers: { cookie: `${GUEST_COOKIE_NAME}=guest_expired-uuid` } } as unknown as Request,
      { cookie: vi.fn() } as unknown as Response,
    );

    // Wait for fire-and-forget lazy cleanup microtask (which throws and is swallowed)
    await new Promise(resolve => setImmediate(resolve));

    expect(db.upsertUser).toHaveBeenCalled();
    expect(result.isNew).toBe(true);
    expect(result.userId).toBe(99);
    expect(db.updateUserActivity).not.toHaveBeenCalled();

    // Restore select implementation for subsequent tests
    mockDbInstance.select.mockReset();
  });

  it("missing guest (no DB record) creates new guest without calling updateUserActivity", async () => {
    const db = await import("./db");
    (db.getUserByOpenId as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(makeActiveGuest(100, "guest_fresh-uuid"));
    (db.upsertUser as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

    const result = await getOrCreateGuestUser(
      { headers: { cookie: `${GUEST_COOKIE_NAME}=guest_nonexistent-uuid` } } as unknown as Request,
      { cookie: vi.fn() } as unknown as Response,
    );

    expect(db.updateUserActivity).not.toHaveBeenCalled();
    expect(db.upsertUser).toHaveBeenCalled();
    expect(result.isNew).toBe(true);
  });
});

describe("startupCleanupExpiredGuests", () => {
  beforeEach(() => {
    mockDbState.getDbReturnsNull = false;
    mockDbInstance._whereFn.mockReset();
    mockStorage.storageDelete.mockReset();
    mockDbInstance.select.mockClear();
    mockDbInstance.delete.mockClear();
  });

  it("is a no-op in test env (guarded)", async () => {
    expect(process.env.NODE_ENV).toBe("test");
    await startupCleanupExpiredGuests();
    expect(mockDbInstance.select).not.toHaveBeenCalled();
  });

  it("skips cleanup in test env without side effects", async () => {
    await startupCleanupExpiredGuests();
    expect(mockDbInstance.delete).not.toHaveBeenCalled();
    expect(mockStorage.storageDelete).not.toHaveBeenCalled();
  });
});

describe("maybeLazyCleanupExpiredGuests", () => {
  beforeEach(() => {
    mockDbState.getDbReturnsNull = false;
    mockDbInstance._whereFn.mockReset();
    mockStorage.storageDelete.mockReset();
    mockDbInstance.select.mockClear();
    mockDbInstance.delete.mockClear();
  });

  it("calls cleanupExpiredGuests (no test env guard)", async () => {
    mockDbInstance._whereFn.mockReturnValueOnce([]);

    await maybeLazyCleanupExpiredGuests();
    expect(mockDbInstance.select).toHaveBeenCalled();
  });

  it("swallows errors and does not throw", async () => {
    mockDbInstance.select.mockImplementation(() => {
      throw new Error("DB error");
    });

    await expect(maybeLazyCleanupExpiredGuests()).resolves.not.toThrow();
  });
});
