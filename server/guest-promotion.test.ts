import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockDbState = vi.hoisted(() => ({
  affectedRows: 1,
  transactionShouldThrow: false,
  getDbReturnsNull: false,
}));

const mockTx = vi.hoisted(() => {
  const calls: Record<string, unknown[]> = { updates: [], deletes: [] };
  let pendingValues: Record<string, unknown> | null = null;
  return {
    update: vi.fn(() => ({
      set: vi.fn((values: Record<string, unknown>) => {
        pendingValues = values;
        return {
          where: vi.fn().mockImplementation(() => {
            if (pendingValues !== null) {
              calls.updates.push(pendingValues);
              pendingValues = null;
            }
            if (mockDbState.transactionShouldThrow) throw new Error("DB unavailable");
            return [{ affectedRows: mockDbState.affectedRows }];
          }),
        };
      }),
    })),
    _calls: calls,
  };
});

const mockDbInstance = vi.hoisted(() => ({
  transaction: vi.fn(async (callback: (tx: typeof mockTx) => Promise<unknown>) => {
    if (mockDbState.getDbReturnsNull) return null;
    return callback(mockTx);
  }),
}));

vi.mock("./db", () => ({
  getDb: () => (mockDbState.getDbReturnsNull ? null : mockDbInstance),
}));

vi.mock("../drizzle/schema", () => ({
  users: { id: "users.id", isGuest: "users.isGuest", openId: "users.openId" },
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((col: unknown, val: unknown) => ({ col, val })),
  and: vi.fn((...conds: unknown[]) => ({ and: conds })),
}));

vi.mock("../storage", () => ({
  storageDelete: vi.fn(),
  storageCopy: vi.fn(),
}));

import { promoteGuest, type PromoteGuestInput } from "./_core/guest-session";

function validInput(overrides: Partial<PromoteGuestInput> = {}): PromoteGuestInput {
  return {
    guestUserId: 42,
    email: "user@example.com",
    name: "Promoted User",
    loginMethod: "stytch-password",
    ...overrides,
  };
}

describe("promoteGuest — in-place conversion", () => {
  beforeEach(() => {
    mockDbState.affectedRows = 1;
    mockDbState.transactionShouldThrow = false;
    mockDbState.getDbReturnsNull = false;
    mockTx._calls.updates = [];
    vi.clearAllMocks();
  });

  it("converts guest to permanent user in-place: same user.id, isGuest 1->0, expiresAt -> null", async () => {
    const result = await promoteGuest(validInput());

    expect(result).toEqual({ userId: 42, openId: expect.stringMatching(/^promoted_[0-9a-f-]{36}$/) });
    expect(mockTx.update).toHaveBeenCalledTimes(1);
    const updateValues = mockTx._calls.updates[0] as Record<string, unknown>;
    expect(updateValues.isGuest).toBe(0);
    expect(updateValues.expiresAt).toBeNull();
    expect(updateValues.email).toBe("user@example.com");
    expect(updateValues.name).toBe("Promoted User");
    expect(updateValues.loginMethod).toBe("stytch-password");
    expect(updateValues.openId).toMatch(/^promoted_[0-9a-f-]{36}$/);
  });

  it("preserves existing user.id — does NOT create a new users row", async () => {
    const result = await promoteGuest(validInput());

    expect(result?.userId).toBe(42);
    expect(mockTx.update).toHaveBeenCalledTimes(1);
    expect(mockTx._calls.updates).toHaveLength(1);
    const updateValues = mockTx._calls.updates[0] as Record<string, unknown>;
    expect(updateValues).not.toHaveProperty("id");
  });

  it("performs promotion inside a single DB transaction", async () => {
    await promoteGuest(validInput());

    expect(mockDbInstance.transaction).toHaveBeenCalledTimes(1);
    expect(mockTx.update).toHaveBeenCalledTimes(1);
  });

  it("does NOT call storageCopy or storageDelete during promotion", async () => {
    await promoteGuest(validInput());

    const { storageDelete } = await import("../storage");
    const { storageCopy } = await import("../storage");
    expect(storageDelete).not.toHaveBeenCalled();
    expect(storageCopy).not.toHaveBeenCalled();
  });

  it("returns { userId, openId } with userId unchanged from input", async () => {
    const result = await promoteGuest(validInput({ guestUserId: 99 }));

    expect(result).toEqual({ userId: 99, openId: expect.stringMatching(/^promoted_/) });
  });

  it("preserves createdAt (does not reset it on promotion)", async () => {
    await promoteGuest(validInput());

    const updateValues = mockTx._calls.updates[0] as Record<string, unknown>;
    expect(updateValues).not.toHaveProperty("createdAt");
  });

  it("updates lastSignedIn, lastActivityAt, and updatedAt to current time", async () => {
    await promoteGuest(validInput());

    const updateValues = mockTx._calls.updates[0] as Record<string, unknown>;
    expect(updateValues.lastSignedIn).toBeInstanceOf(Date);
    expect(updateValues.lastActivityAt).toBeInstanceOf(Date);
    expect(updateValues.updatedAt).toBeInstanceOf(Date);
  });

  it("updates name to null when input omits name", async () => {
    const result = await promoteGuest(validInput({ name: undefined }));

    expect(result).toEqual({ userId: 42, openId: expect.stringMatching(/^promoted_/) });
    const updateValues = mockTx._calls.updates[0] as Record<string, unknown>;
    expect(updateValues.name).toBeNull();
  });
});

describe("promoteGuest — concurrent promotion idempotency", () => {
  beforeEach(() => {
    mockDbState.affectedRows = 1;
    mockDbState.transactionShouldThrow = false;
    mockTx._calls.updates = [];
    vi.clearAllMocks();
  });

  it("second concurrent call sees 0 affected rows and returns null (idempotent)", async () => {
    const input = validInput({ guestUserId: 42 });

    const first = await promoteGuest(input);
    expect(first).toEqual({ userId: 42, openId: expect.stringMatching(/^promoted_/) });

    mockDbState.affectedRows = 0;
    const second = await promoteGuest(input);
    expect(second).toBeNull();
  });

  it("only one UPDATE call per promotion attempt (no table-by-table transfer)", async () => {
    await promoteGuest(validInput());

    expect(mockTx.update).toHaveBeenCalledTimes(1);
    expect(mockTx._calls.updates).toHaveLength(1);
  });
});

describe("promoteGuest — failure safety", () => {
  beforeEach(() => {
    mockDbState.affectedRows = 1;
    mockDbState.transactionShouldThrow = false;
    mockDbState.getDbReturnsNull = false;
    mockTx._calls.updates = [];
    vi.clearAllMocks();
  });

  it("DB failure inside transaction leaves guest unchanged (no partial update)", async () => {
    mockDbState.transactionShouldThrow = true;

    await expect(promoteGuest(validInput())).rejects.toThrow("DB unavailable");
    expect(mockDbInstance.transaction).toHaveBeenCalledTimes(1);
  });

  it("getDb returning null returns null without any DB or storage calls", async () => {
    mockDbState.getDbReturnsNull = true;

    const result = await promoteGuest(validInput());
    expect(result).toBeNull();
    expect(mockDbInstance.transaction).not.toHaveBeenCalled();
  });

  it("returns null (not throw) when guest already promoted (0 affected rows)", async () => {
    mockDbState.affectedRows = 0;

    const result = await promoteGuest(validInput());
    expect(result).toBeNull();
  });

  it("no B2 side effects occur during transaction failure", async () => {
    mockDbState.transactionShouldThrow = true;

    await expect(promoteGuest(validInput())).rejects.toThrow();

    const { storageDelete } = await import("../storage");
    const { storageCopy } = await import("../storage");
    expect(storageDelete).not.toHaveBeenCalled();
    expect(storageCopy).not.toHaveBeenCalled();
  });
});

describe("promoteGuest — source code invariants", () => {
  it("does NOT call storageCopy or storageDelete in promotion code", () => {
    const source = readFileSync("server/_core/guest-session.ts", "utf8");
    const promoteSource = source.match(/export async function promoteGuest[\s\S]*?\n}/)?.[0] ?? "";

    expect(promoteSource).not.toContain("storageCopy");
    expect(promoteSource).not.toContain("storageDelete");
    expect(promoteSource).not.toContain("insert(users)");
    expect(promoteSource).not.toContain("delete(users)");
    expect(promoteSource).toContain("tx.update(users)");
    expect(promoteSource).toContain("isGuest: 0");
    expect(promoteSource).toContain("expiresAt: null");
  });

  it("does NOT transfer ownership across tables (no multi-table transfer)", () => {
    const source = readFileSync("server/_core/guest-session.ts", "utf8");
    const promoteSource = source.match(/export async function promoteGuest[\s\S]*?\n}/)?.[0] ?? "";

    expect(promoteSource).not.toContain("chatSessions");
    expect(promoteSource).not.toContain("memoryEntries");
    expect(promoteSource).not.toContain("memoryFacts");
    expect(promoteSource).not.toContain("memoryProfiles");
    expect(promoteSource).not.toContain("memorySettings");
    expect(promoteSource).not.toContain("chatAttachments");
    expect(promoteSource).not.toContain("stytchLinkIntents");
    expect(promoteSource).not.toContain("providerIdentities");
  });
});
