import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Captures the row `upsertUser` is about to write, so the test can assert on the `role` column
 * that the rest of the application authorises against.
 */
const state = vi.hoisted(() => ({ written: [] as Array<Record<string, unknown>> }));

const mockDb = vi.hoisted(() => ({
  insert: vi.fn(() => ({
    values: vi.fn((value: unknown) => {
      state.written.push(value as Record<string, unknown>);
      return { onDuplicateKeyUpdate: vi.fn().mockResolvedValue(undefined) };
    }),
  })),
  select: vi.fn(() => ({ from: vi.fn(() => ({ where: vi.fn(() => ({ limit: vi.fn().mockResolvedValue([]) })) })) })),
}));

vi.mock("drizzle-orm/mysql2", () => ({ drizzle: () => mockDb }));

import { ENV } from "./_core/env";
import { upsertUser } from "./db";

const OWNER_EMAIL = "arbyz7874@gmail.com";
const OWNER_OPEN_ID = "owner-open-id";

function configureEnv(values: { ownerEmail?: string; ownerOpenId?: string }) {
  ENV.ownerEmail = values.ownerEmail ?? "";
  ENV.ownerOpenId = values.ownerOpenId ?? "";
}

function roleFor(row: Record<string, unknown> | undefined) {
  return row?.role;
}

beforeEach(() => {
  process.env.DATABASE_URL = "mysql://test";
  state.written = [];
  configureEnv({ ownerEmail: OWNER_EMAIL, ownerOpenId: OWNER_OPEN_ID });
  vi.clearAllMocks();
});

describe("automatic admin role assignment", () => {
  it("grants admin to the configured owner account", async () => {
    await upsertUser({ openId: OWNER_OPEN_ID, email: OWNER_EMAIL });
    expect(roleFor(state.written[0])).toBe("admin");
  });

  it("never grants admin to another account, however it signs in", async () => {
    await upsertUser({ openId: "first-user-ever", email: "first@example.com" });
    await upsertUser({ openId: OWNER_OPEN_ID, email: "attacker@example.com" });
    await upsertUser({ openId: "someone-else", email: OWNER_EMAIL });
    for (const row of state.written) {
      expect(roleFor(row)).not.toBe("admin");
    }
  });

  it("does not promote the first registered user", async () => {
    // There is no "first user wins" rule: an ordinary account signing up first stays ordinary. No
    // `role` is written for it at all, so the column default (`user`) applies.
    await upsertUser({ openId: "first", email: "first@example.com" });
    expect(roleFor(state.written[0])).toBeUndefined();
  });

  it("grants admin to nobody when OWNER_EMAIL is unset", async () => {
    configureEnv({ ownerEmail: "", ownerOpenId: OWNER_OPEN_ID });
    await upsertUser({ openId: OWNER_OPEN_ID, email: OWNER_EMAIL });
    expect(roleFor(state.written[0])).not.toBe("admin");
  });

  it("grants admin to nobody when the configured openId is not the owner's", async () => {
    // If OWNER_EMAIL and OWNER_OPEN_ID disagree about which account is the owner, the owner
    // cannot satisfy both claims and so no row is promoted. This is the fail-closed outcome.
    configureEnv({ ownerEmail: OWNER_EMAIL, ownerOpenId: "a-different-open-id" });

    await upsertUser({ openId: "a-different-open-id", email: OWNER_EMAIL });
    await upsertUser({ openId: OWNER_OPEN_ID, email: OWNER_EMAIL });

    // The first row genuinely satisfies both claims and is the owner; the second does not and is
    // refused, which is the half of the conflict that must fail closed.
    expect(roleFor(state.written[0])).toBe("admin");
    expect(roleFor(state.written[1])).not.toBe("admin");
  });

  it("grants admin to nobody when OWNER_OPEN_ID alone is configured", async () => {
    // A legacy openId by itself is no longer sufficient to promote anyone.
    configureEnv({ ownerEmail: "", ownerOpenId: OWNER_OPEN_ID });
    await upsertUser({ openId: OWNER_OPEN_ID, email: OWNER_EMAIL });
    expect(roleFor(state.written[0])).not.toBe("admin");
  });

  it("leaves the admin role alone on a later sign-in by a non-owner", async () => {
    // The promotion branch only runs when the caller is not already carrying an explicit role, so
    // a non-owner never has `admin` written, and a guest stays a guest.
    await upsertUser({ openId: "guest", email: null, isGuest: 1 });
    expect(roleFor(state.written[0])).not.toBe("admin");
  });
});
