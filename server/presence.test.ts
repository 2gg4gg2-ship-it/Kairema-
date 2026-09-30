import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";
import { PRESENCE_TTL_SECONDS } from "@shared/const";

/** One row per person, exactly as the real `users` table stores it. */
type PresenceRow = { id: number; isGuest: number; lastActivityAt: Date };

const state = vi.hoisted(() => ({
  /** When false the driver refuses to connect, which is how a deployment with no database looks. */
  dbAvailable: true,
  /** In-memory `users` rows, keyed by id: one person is one row, no matter how many tabs. */
  rows: new Map<number, PresenceRow>(),
  updates: [] as Array<{ payload: Record<string, unknown>; id: number | null }>,
  wheres: [] as unknown[],
  reads: 0,
}));

const mockDb = vi.hoisted(() => {
  /** The drizzle mock is defined here so it can reach the hoisted `state`/`rows` store. */
  const rows = () => state.rows;
  return {
    select: (fields?: Record<string, unknown>) => ({
      from: (table: unknown) => ({
        where: (condition: unknown) => {
          state.wheres.push(condition);
          state.reads += 1;
          // A `count(*)` projection is the presence read. It is answered by actually applying the
          // condition to the in-memory rows, so a stray extra predicate (a guest filter, a signup
          // date) changes the answer and fails the test rather than passing unnoticed.
          if (fields && "count" in fields) {
            const matched = [...rows().values()].filter((row) => matches(condition, row));
            return Promise.resolve([{ count: matched.length }]);
          }
          return Promise.resolve([]);
        },
      }),
    }),
    update: (table: unknown) => ({
      set: (payload: Record<string, unknown>) => ({
        where: (condition: unknown) => {
          state.wheres.push(condition);
          const id = paramValues(condition).find((value) => typeof value === "number") as number | undefined;
          state.updates.push({ payload, id: id ?? null });
          const existing = id === undefined ? undefined : rows().get(id);
          if (existing) existing.lastActivityAt = payload.lastActivityAt as Date;
          return Promise.resolve([{ affectedRows: existing ? 1 : 0 }]);
        },
      }),
    }),
  };
});

// The driver is the seam: yielding no handle is exactly the state `getDb` is written to tolerate,
// so this reproduces a deployment with no reachable database without touching db.ts itself. It is
// a null handle rather than a thrown error because `getDb` memoises its handle in a module-level
// variable, and a module that already cached one would keep serving it for the rest of the run.
vi.mock("drizzle-orm/mysql2", () => ({
  drizzle: () => (state.dbAvailable ? mockDb : null),
}));

// The routers are exercised against the same two functions, so only the presence exports are
// replaced here. Every other db export keeps its real implementation.
const { countUsersPresentNow, touchUserPresence } = vi.hoisted(() => ({
  countUsersPresentNow: vi.fn(),
  touchUserPresence: vi.fn(),
}));

vi.mock("./db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./db")>()),
  countUsersPresentNow,
  touchUserPresence,
}));

// The real db module, reached past the router mock, so the presence queries themselves are tested.
const realDb = await vi.importActual<typeof import("./db")>("./db");

/**
 * Returns a db module that has no database handle.
 *
 * `getDb` memoises the handle it obtains, so the "no database" path is only reachable on a module
 * that never got one; toggling the driver off for a single call is not enough. Resetting the
 * registry and re-importing gives a module whose own `_db` is still null.
 *
 * The driver is deliberately left switched off: `getDb` is not called until the presence function
 * under test runs, which is after this returns. `beforeEach` restores the driver for the next test.
 */
async function loadDbWithoutDatabase() {
  state.dbAvailable = false;
  vi.resetModules();
  return vi.importActual<typeof import("./db")>("./db");
}

import { ENV } from "./_core/env";
import { appRouter } from "./routers";

/** The only account authorised to be the Kairema owner. */
const OWNER_EMAIL = "presence-owner@example.com";
const OWNER_OPEN_ID = "presence-owner-open-id";

/**
 * Collects the values drizzle bound into a condition.
 *
 * A drizzle condition is a cyclic `SQL` graph, so it is neither serialisable nor walkable as a
 * plain object. Its `queryChunks` list, however, holds the bound parameters as `Param` chunks
 * whose `value` is the number or `Date` that was passed in, and string chunks whose `value` is an
 * array of SQL fragments. Filtering on the JS value type therefore recovers exactly the bound
 * parameters without depending on a private class name.
 */
function paramValues(condition: unknown, seen = new Set<unknown>()): unknown[] {
  if (condition === null || typeof condition !== "object" || seen.has(condition)) return [];
  seen.add(condition);
  const values: unknown[] = [];
  if ("value" in condition) {
    const value = (condition as { value: unknown }).value;
    if (typeof value === "number" || value instanceof Date) values.push(value);
  }
  const chunks = (condition as { queryChunks?: unknown }).queryChunks;
  if (Array.isArray(chunks)) {
    for (const chunk of chunks) values.push(...paramValues(chunk, seen));
  }
  return values;
}

/**
 * Flattens a drizzle `WHERE` into the `column`/`value` pairs it compares.
 *
 * A comparison is a chunk list of `[padding, column, operator, param, padding]`, and `and(...)`
 * nests those lists inside each other, so the walk has to recurse to see every predicate. A
 * comparison on a column the presence queries do not use is still collected: it is the caller's
 * job to reject it in `matches`, which is what makes an extra filter fail the test loudly.
 */
function collectPredicates(condition: unknown, out: Array<{ column: string; value: unknown }> = []): Array<{ column: string; value: unknown }> {
  const chunks = (condition as { queryChunks?: unknown[] } | null)?.queryChunks;
  if (!Array.isArray(chunks)) return out;
  for (let i = 0; i < chunks.length; i += 1) {
    const chunk = chunks[i];
    if (chunk === null || typeof chunk !== "object") continue;
    const name = (chunk as { name?: unknown }).name;
    if (typeof name === "string") {
      const bound = chunks.slice(i + 1).find(isBoundValue) as { value: unknown } | undefined;
      if (bound) out.push({ column: name, value: bound.value });
    } else {
      collectPredicates(chunk, out);
    }
  }
  return out;
}

/**
 * Evaluates a flattened `WHERE` against one in-memory `users` row.
 *
 * A column the presence queries are not meant to filter on matches nothing, rather than being
 * ignored: silently dropping an unrecognised predicate would let a query that filters on, say,
 * `isGuest` or a signup date report the same number as the real one and pass unnoticed.
 */
function matches(condition: unknown, row: PresenceRow): boolean {
  const predicates = collectPredicates(condition);
  if (predicates.length === 0) return false;
  return predicates.every(({ column, value }) => {
    if (column === "lastActivityAt" && value instanceof Date) return row.lastActivityAt > value;
    if (column === "isGuest" && typeof value === "number") return row.isGuest === value;
    if (column === "id" && typeof value === "number") return row.id === value;
    return false;
  });
}

function isBoundValue(chunk: unknown): boolean {
  if (chunk === null || typeof chunk !== "object") return false;
  if (!("value" in chunk)) return false;
  const value = (chunk as { value: unknown }).value;
  return typeof value === "number" || value instanceof Date;
}

function callerFor(user: Record<string, unknown> | null, isGuest = false) {
  return appRouter.createCaller({
    user: user as TrpcContext["user"],
    isGuest,
    req: { headers: {} } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  });
}

function ownerUser(overrides: Record<string, unknown> = {}) {
  return { id: 1, openId: OWNER_OPEN_ID, email: OWNER_EMAIL, name: "Owner", loginMethod: "manus", role: "admin", isGuest: 0, createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date(), ...overrides };
}

function normalUser(overrides: Record<string, unknown> = {}) {
  return { id: 2, openId: "someone-else", email: "someone@example.com", name: "Someone", loginMethod: "manus", role: "user", isGuest: 0, createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date(), ...overrides };
}

function guestUser(overrides: Record<string, unknown> = {}) {
  return { id: 3, openId: "guest-open-id", email: null, name: null, loginMethod: null, role: "user", isGuest: 1, createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date(), ...overrides };
}

const secondsAgo = (seconds: number) => new Date(Date.now() - seconds * 1_000);

beforeEach(() => {
  process.env.DATABASE_URL = "mysql://test";
  state.dbAvailable = true;
  state.rows = new Map();
  state.updates = [];
  state.wheres = [];
  state.reads = 0;
  countUsersPresentNow.mockReset().mockResolvedValue(0);
  touchUserPresence.mockReset().mockResolvedValue(undefined);
  ENV.ownerEmail = OWNER_EMAIL;
  ENV.ownerOpenId = OWNER_OPEN_ID;
  vi.clearAllMocks();
});

describe("presence heartbeat writes", () => {
  it("records presence by advancing lastActivityAt on the caller's own row", async () => {
    state.rows.set(2, { id: 2, isGuest: 0, lastActivityAt: secondsAgo(600) });

    await realDb.touchUserPresence(2);

    expect(state.updates).toHaveLength(1);
    expect(state.updates[0].id).toBe(2);
    // The new heartbeat is "now", not the stale value the row already held.
    expect(state.updates[0].payload.lastActivityAt).toBeInstanceOf(Date);
    expect(Date.now() - (state.updates[0].payload.lastActivityAt as Date).getTime()).toBeLessThan(5_000);
    expect(state.rows.get(2)!.lastActivityAt.getTime()).toBe(state.updates[0].payload.lastActivityAt.getTime());
  });

  it("writes only lastActivityAt and never recomputes the guest expiry", async () => {
    // `updateUserActivity` also sets `expiresAt` from the guest sliding/absolute TTL. Reusing it
    // here would hand a permanent user a guest expiry date, silently deleting their account
    // later, so the presence write must be that one column and nothing else.
    await realDb.touchUserPresence(2);

    const payload = state.updates[0].payload;
    expect(Object.keys(payload)).toEqual(["lastActivityAt"]);
    expect(payload).not.toHaveProperty("expiresAt");
    expect(payload).not.toHaveProperty("isGuest");
    expect(payload).not.toHaveProperty("lastSignedIn");
  });

  it("uses the same users row for a guest as for an account, so two tabs are one person", async () => {
    // Presence is a property of the person, not of the tab or of the session. Both tabs resolve
    // to the same guest `users` id, so two heartbeats land on one row and the person is counted
    // exactly once.
    state.rows.set(3, { id: 3, isGuest: 1, lastActivityAt: secondsAgo(600) });

    await realDb.touchUserPresence(3);
    await realDb.touchUserPresence(3);

    expect(state.updates).toHaveLength(2);
    expect(state.updates.every((update) => update.id === 3)).toBe(true);
    // One row for the guest, so the store still holds exactly one person.
    expect(state.rows.size).toBe(1);
    expect([...state.rows.keys()]).toEqual([3]);
  });

  it("does nothing at all when no database is configured", async () => {
    // A presence heartbeat is telemetry, not part of the request's job: failing the caller
    // because the telemetry store is unreachable would break a feature that otherwise works.
    const noDb = await loadDbWithoutDatabase();

    await expect(noDb.touchUserPresence(2)).resolves.toBeUndefined();
    expect(state.updates).toHaveLength(0);
  });
});

describe("counting who is in the app right now", () => {
  it("counts only the rows whose heartbeat is newer than the TTL", async () => {
    state.rows.set(1, { id: 1, isGuest: 0, lastActivityAt: new Date() });
    state.rows.set(2, { id: 2, isGuest: 0, lastActivityAt: secondsAgo(5) });
    // A guest is a person in the app just as much as a signed-in account, so it is counted too.
    state.rows.set(3, { id: 3, isGuest: 1, lastActivityAt: secondsAgo(PRESENCE_TTL_SECONDS - 5) });

    expect(await realDb.countUsersPresentNow()).toBe(3);
  });

  it("excludes a row whose heartbeat has aged past the TTL", async () => {
    state.rows.set(1, { id: 1, isGuest: 0, lastActivityAt: new Date() });
    // Exactly on the far side of the window: the client that stopped sending heartbeats when its
    // tab closed must drop out on its own, with no cleanup job and no row deletion.
    state.rows.set(2, { id: 2, isGuest: 0, lastActivityAt: secondsAgo(PRESENCE_TTL_SECONDS + 30) });

    expect(await realDb.countUsersPresentNow()).toBe(1);
  });

  it("filters on lastActivityAt rather than on a column it has no reason to read", async () => {
    await realDb.countUsersPresentNow();

    // The threshold is the only bound parameter, and it is `now - TTL`; a count scoped to
    // something else (a role, a signup date) would answer a different question.
    const dates = paramValues(state.wheres[0]).filter((value) => value instanceof Date) as Date[];
    expect(dates).toHaveLength(1);
    const drift = Math.abs(Date.now() - dates[0].getTime() - PRESENCE_TTL_SECONDS * 1_000);
    expect(drift).toBeLessThan(5_000);
  });

  it("returns 0 rather than throwing when no database is configured", async () => {
    // The owner dashboard must render a zero, not an error page, on a deployment with no database.
    state.rows.set(1, { id: 1, isGuest: 0, lastActivityAt: new Date() });
    const noDb = await loadDbWithoutDatabase();

    await expect(noDb.countUsersPresentNow()).resolves.toBe(0);
    // The unconnected handle was never reached, so the presence row was not read either.
    expect(state.reads).toBe(0);

    // The connected module still answers, so the zero above was the absent database and not a
    // presence query that simply found nobody.
    expect(await realDb.countUsersPresentNow()).toBe(1);
  });
});

describe("presence.heartbeat", () => {
  it("is open to any authenticated account, not just the owner", async () => {
    // Presence is bookkeeping about the caller's own row. Gating it behind the owner check would
    // mean an ordinary user's heartbeat was rejected and they never appeared in the count.
    await expect(callerFor(normalUser()).presence.heartbeat()).resolves.toEqual({ ok: true });
    expect(touchUserPresence).toHaveBeenCalledWith(2);
  });

  it("is open to a guest session, not just to signed-in accounts", async () => {
    await expect(callerFor(guestUser(), true).presence.heartbeat()).resolves.toEqual({ ok: true });
    expect(touchUserPresence).toHaveBeenCalledWith(3);
  });

  it("refuses a caller with no session and writes nothing", async () => {
    // Without a session there is no `users` row to write to, and no identity to attribute the
    // heartbeat to; `userOrGuestProcedure` rejects before the mutation body ever runs.
    await expect(callerFor(null).presence.heartbeat()).rejects.toThrow();
    expect(touchUserPresence).not.toHaveBeenCalled();
  });

  it("carries nothing back to the caller", async () => {
    // The response must not become a way to probe who is online.
    expect(await callerFor(normalUser()).presence.heartbeat()).toEqual({ ok: true });
  });
});

describe("owner.getOnlineUsersCount", () => {
  it("returns the count with its freshness window and nothing else", async () => {
    countUsersPresentNow.mockResolvedValue(4);

    const result = await callerFor(ownerUser()).owner.getOnlineUsersCount();

    expect(Object.keys(result).sort()).toEqual(["onlineUsers", "ttlSeconds", "updatedAt"]);
    expect(result.onlineUsers).toBe(4);
    expect(result.ttlSeconds).toBe(PRESENCE_TTL_SECONDS);
    expect(Number.isNaN(Date.parse(result.updatedAt))).toBe(false);
    expect(countUsersPresentNow).toHaveBeenCalledTimes(1);
  });

  it("discloses no identity of any kind", async () => {
    countUsersPresentNow.mockResolvedValue(4);

    const result = await callerFor(ownerUser()).owner.getOnlineUsersCount();
    const serialised = JSON.stringify(result).toLowerCase();
    // The aggregate field is deliberately named for what it is, so the payload is checked field by
    // field: a count, a window and a timestamp. None of them can carry an identity, and the owner
    // email / openId this test authenticated with must not appear either.
    expect(Object.keys(result).sort()).toEqual(["onlineUsers", "ttlSeconds", "updatedAt"]);
    for (const forbidden of ["openid", "email", "name", "token", "userid", "guest", "isguest", OWNER_EMAIL, OWNER_OPEN_ID]) {
      expect(serialised).not.toContain(forbidden);
    }
  });

  it("refuses a normal user", async () => {
    await expect(callerFor(normalUser()).owner.getOnlineUsersCount()).rejects.toThrow();
    expect(countUsersPresentNow).not.toHaveBeenCalled();
  });

  it("refuses a guest", async () => {
    // `protectedProcedure` rejects a guest before the owner check is even reached.
    await expect(callerFor(guestUser(), true).owner.getOnlineUsersCount()).rejects.toThrow();
    expect(countUsersPresentNow).not.toHaveBeenCalled();
  });

  it("refuses an unauthenticated caller", async () => {
    await expect(callerFor(null).owner.getOnlineUsersCount()).rejects.toThrow();
    expect(countUsersPresentNow).not.toHaveBeenCalled();
  });

  it("refuses a client-supplied admin or owner flag", async () => {
    // The gate reads the configured email and the authenticated row, so declaring oneself owner in
    // the request changes nothing.
    await expect(callerFor(normalUser({ role: "admin", isOwner: true, owner: true })).owner.getOnlineUsersCount()).rejects.toThrow();
  });

  it("fails closed when no owner email is configured", async () => {
    ENV.ownerEmail = "";
    await expect(callerFor(ownerUser()).owner.getOnlineUsersCount()).rejects.toThrow();
    expect(countUsersPresentNow).not.toHaveBeenCalled();
  });
});

describe("the presence count is gated in the source, not only at runtime", () => {
  const routers = readFileSync(new URL("./routers.ts", import.meta.url), "utf8");

  /** The source of a single procedure, so an assertion cannot be satisfied by a sibling route. */
  function procedureSource(name: string): string {
    const start = routers.indexOf(`${name}: `);
    expect(start).toBeGreaterThan(-1);
    const end = routers.indexOf("\n    }),\n", start);
    return routers.slice(start, end === -1 ? undefined : end);
  }

  it("gates the count with the single owner check", () => {
    const source = procedureSource("getOnlineUsersCount");
    expect(source).toContain("requireOwner(ctx);");
    expect(source).toContain("countUsersPresentNow()");
    // `requireOwner` must run before the query, or the count would be read for anyone.
    expect(source.indexOf("requireOwner(ctx);")).toBeLessThan(source.indexOf("countUsersPresentNow()"));
  });

  it("does not re-derive owner access from the raw owner configuration", () => {
    // `isOwnerAccount` is the only place that reads ENV.ownerEmail/ownerOpenId. A second
    // comparison here would be a second authorization path that can drift from the first.
    const source = procedureSource("getOnlineUsersCount");
    expect(source).not.toContain("ENV.ownerEmail");
    expect(source).not.toContain("ENV.ownerOpenId");
    expect(source).not.toContain("isOwnerAccount");
  });

  it("keeps the heartbeat outside the owner router, so it is not owner-only", () => {
    // If the heartbeat sat inside `owner: router({...})` it would inherit the owner gate and
    // ordinary users would silently never be counted as present.
    const presenceStart = routers.indexOf("presence: router({");
    const ownerStart = routers.indexOf("owner: router({");
    expect(presenceStart).toBeGreaterThan(-1);
    expect(ownerStart).toBeGreaterThan(-1);
    // It is a sibling defined before the owner router, and it uses the session-resolving
    // procedure rather than the owner-gated one.
    expect(presenceStart).toBeLessThan(ownerStart);
    const source = routers.slice(presenceStart, routers.indexOf("\n  }),\n", presenceStart));
    expect(source).toContain("userOrGuestProcedure.mutation");
    expect(source).not.toContain("requireOwner");
    expect(source).not.toContain("protectedProcedure");
  });
});
