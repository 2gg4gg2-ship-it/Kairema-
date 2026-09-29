import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";

const { getOwnerDashboardSummary, getOwnerObservabilitySnapshot, notifyOwner } = vi.hoisted(() => ({
  getOwnerDashboardSummary: vi.fn(),
  getOwnerObservabilitySnapshot: vi.fn(),
  notifyOwner: vi.fn(),
}));

vi.mock("./db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./db")>()),
  getOwnerDashboardSummary,
  getOwnerObservabilitySnapshot,
}));

// Stubbed so the admin-gate test exercises authorization only, without sending a real notification.
vi.mock("./_core/notification", () => ({ notifyOwner }));

// The real env module is loaded so the tests exercise the same configuration surface the process
// uses; the owner identity under test is supplied per case by assigning to the live ENV object.
import { ENV } from "./_core/env";
import { appRouter } from "./routers";
import { systemRouter } from "./_core/systemRouter";

/** The only account authorised to be the Kairema owner. */
const OWNER_EMAIL = "arbyz7874@gmail.com";
const OWNER_OPEN_ID = "owner-open-id";

function configureEnv(values: { ownerEmail?: string; ownerOpenId?: string }) {
  ENV.ownerEmail = values.ownerEmail ?? "";
  ENV.ownerOpenId = values.ownerOpenId ?? "";
}

function callerFor(user: Record<string, unknown> | null) {
  return appRouter.createCaller({
    user: user as TrpcContext["user"],
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

/**
 * Owner procedures that return owner data and must therefore refuse outright.
 *
 * `isOwner` and `claimDiagnostic` are excluded because they are capability probes: they answer
 * `false` for a non-owner by design and disclose nothing. Their output is asserted separately.
 */
const OWNER_PROCEDURES = [
  "dashboard",
  "flashTtft",
  "searchOutages",
  "observability",
  "providerControls",
  "providerControlTargets",
  "capacitySnapshot",
  "capacityPolicy",
] as const;

beforeEach(() => {
  getOwnerDashboardSummary.mockReset().mockResolvedValue({
    users: { total: 7, activeLast30d: 3 },
    requestsByRole: [{ roleId: "fast", count: 12 }],
    fallbackEvents: 2,
    providerEvents: 5,
  });
  getOwnerObservabilitySnapshot.mockReset().mockResolvedValue({ providers: [], events: [], memory: {}, search: {} });
  notifyOwner.mockReset().mockResolvedValue(true);
  vi.clearAllMocks();
});

describe("the configured owner is authorised", () => {
  beforeEach(() => configureEnv({ ownerEmail: OWNER_EMAIL, ownerOpenId: OWNER_OPEN_ID }));

  it("grants owner access to the account whose email matches OWNER_EMAIL", async () => {
    const caller = callerFor(ownerUser());
    expect(await caller.owner.isOwner()).toBe(true);
    await expect(caller.owner.dashboard()).resolves.toMatchObject({ users: { total: 7 } });
  });

  it("matches the email case- and whitespace-insensitively", async () => {
    // Addresses arrive from different identity providers with inconsistent casing; a case
    // difference must not lock the real owner out, and must not let anyone else in either.
    const caller = callerFor(ownerUser({ email: "  Arbyz7874@Gmail.COM  " }));
    expect(await caller.owner.isOwner()).toBe(true);
  });

  it("works when OWNER_EMAIL is set and OWNER_OPEN_ID is absent", async () => {
    configureEnv({ ownerEmail: OWNER_EMAIL, ownerOpenId: "" });
    const caller = callerFor(ownerUser({ openId: "a-different-open-id" }));
    expect(await caller.owner.isOwner()).toBe(true);
  });

  it("works when both OWNER_EMAIL and a matching OWNER_OPEN_ID are set", async () => {
    const caller = callerFor(ownerUser());
    expect(await caller.owner.isOwner()).toBe(true);
    await expect(caller.owner.dashboard()).resolves.toBeDefined();
  });
});

describe("no other account can become owner", () => {
  beforeEach(() => configureEnv({ ownerEmail: OWNER_EMAIL, ownerOpenId: OWNER_OPEN_ID }));

  it("refuses a different email even when it holds the owner openId", async () => {
    // A different person who somehow presents the configured openId still fails: the email claim is
    // authoritative and mandatory.
    const caller = callerFor(normalUser({ openId: OWNER_OPEN_ID, email: "intruder@example.com" }));
    expect(await caller.owner.isOwner()).toBe(false);
    await expect(caller.owner.dashboard()).rejects.toThrow(/владельц/i);
  });

  it("refuses a different email on every owner procedure", async () => {
    const caller = callerFor(normalUser());
    expect(await caller.owner.isOwner()).toBe(false);
    for (const procedure of OWNER_PROCEDURES) {
      await expect((caller.owner as unknown as Record<string, () => Promise<unknown>>)[procedure]()).rejects.toThrow();
    }
    expect(getOwnerDashboardSummary).not.toHaveBeenCalled();
    expect(getOwnerObservabilitySnapshot).not.toHaveBeenCalled();
  });

  it("refuses a guest on every owner procedure", async () => {
    // `protectedProcedure` rejects a guest before the owner check is even reached.
    const caller = callerFor(guestUser());
    for (const procedure of [...OWNER_PROCEDURES, "isOwner"] as unknown as string[]) {
      await expect((caller.owner as unknown as Record<string, () => Promise<unknown>>)[procedure]()).rejects.toThrow();
    }
  });

  it("refuses an unauthenticated caller", async () => {
    const caller = callerFor(null);
    await expect(caller.owner.dashboard()).rejects.toThrow();
    await expect(caller.owner.isOwner()).rejects.toThrow();
  });

  it("refuses a client-supplied role or admin flag", async () => {
    // The decision reads the configured email and the authenticated row only, so declaring
    // yourself an admin (or an owner) in the request changes nothing.
    const caller = callerFor(normalUser({ role: "admin", isOwner: true, isAdmin: true, owner: true }));
    expect(await caller.owner.isOwner()).toBe(false);
    await expect(caller.owner.dashboard()).rejects.toThrow();
  });
});

describe("missing or conflicting configuration fails closed", () => {
  it("grants nobody when OWNER_EMAIL is empty", async () => {
    configureEnv({ ownerEmail: "", ownerOpenId: OWNER_OPEN_ID });
    const caller = callerFor(ownerUser());
    expect(await caller.owner.isOwner()).toBe(false);
    await expect(caller.owner.dashboard()).rejects.toThrow();
  });

  it("grants nobody when OWNER_EMAIL is only whitespace", async () => {
    configureEnv({ ownerEmail: "   ", ownerOpenId: OWNER_OPEN_ID });
    expect(await callerFor(ownerUser()).owner.isOwner()).toBe(false);
  });

  it("does not let OWNER_OPEN_ID alone create a second owner", async () => {
    // Legacy deployments may still set only the openId. That must not authorise anyone, otherwise
    // the email rule could be bypassed entirely.
    configureEnv({ ownerEmail: "", ownerOpenId: OWNER_OPEN_ID });
    const legacy = callerFor(ownerUser());
    expect(await legacy.owner.isOwner()).toBe(false);
    await expect(legacy.owner.dashboard()).rejects.toThrow();
  });

  it("grants nobody when OWNER_EMAIL and OWNER_OPEN_ID describe different accounts", async () => {
    // The two variables disagree about who the owner is. Failing closed here means no account is
    // owner, rather than silently preferring one of the two candidates.
    configureEnv({ ownerEmail: OWNER_EMAIL, ownerOpenId: "a-completely-different-open-id" });
    expect(await callerFor(ownerUser()).owner.isOwner()).toBe(false);
    expect(await callerFor(normalUser({ email: OWNER_EMAIL })).owner.isOwner()).toBe(false);
    await expect(callerFor(ownerUser()).owner.dashboard()).rejects.toThrow();
  });

  it("grants nobody to an account that itself has no email when OWNER_EMAIL is unset", async () => {
    // The subtle case behind the explicit "is an owner email configured at all?" guard: with
    // OWNER_EMAIL empty, a row whose own email is also empty normalises to the same value, and a
    // naive equality check would let that account through.
    //
    // These are ordinary (non-guest) accounts so the test reaches the owner check itself rather
    // than being stopped earlier by `protectedProcedure`, which refuses guests outright.
    configureEnv({ ownerEmail: "", ownerOpenId: "" });
    for (const email of [null, "", "   ", undefined]) {
      const caller = callerFor(normalUser({ email, openId: "any-open-id" }));
      expect(await caller.owner.isOwner()).toBe(false);
      await expect(caller.owner.dashboard()).rejects.toThrow();
    }
  });

  it("grants nobody to an account with no email even when OWNER_OPEN_ID matches it", async () => {
    configureEnv({ ownerEmail: "", ownerOpenId: "any-open-id" });
    expect(await callerFor(normalUser({ email: null, openId: "any-open-id" })).owner.isOwner()).toBe(false);
  });
});

describe("the owner claim diagnostic leaks nothing", () => {
  beforeEach(() => configureEnv({ ownerEmail: OWNER_EMAIL, ownerOpenId: OWNER_OPEN_ID }));

  it("reports only one-way fingerprints and never the owner email", async () => {
    const diagnostic = await callerFor(normalUser()).owner.claimDiagnostic();
    const serialised = JSON.stringify(diagnostic);
    expect(serialised).not.toContain(OWNER_EMAIL);
    expect(serialised).not.toContain("arbyz7874");
    expect(diagnostic.expectedFingerprint).toMatch(/^sha256:[0-9a-f]{12}$/);
    expect(diagnostic.sessionFingerprint).toMatch(/^sha256:[0-9a-f]{12}$/);
    expect(diagnostic.matches).toBe(false);
  });

  it("reports 'not-configured' rather than an empty claim when unset", async () => {
    configureEnv({ ownerEmail: "", ownerOpenId: "" });
    const diagnostic = await callerFor(normalUser()).owner.claimDiagnostic();
    expect(diagnostic.configured).toBe(false);
    expect(diagnostic.expectedFingerprint).toBe("not-configured");
  });
});

describe("adminProcedure stays consistent with the unified owner check", () => {
  beforeEach(() => configureEnv({ ownerEmail: OWNER_EMAIL, ownerOpenId: OWNER_OPEN_ID }));

  function systemCaller(user: Record<string, unknown> | null) {
    return systemRouter.createCaller({
      user: user as TrpcContext["user"],
      req: { headers: {} } as TrpcContext["req"],
      res: {} as TrpcContext["res"],
    });
  }

  it("lets the authorised owner through the admin gate", async () => {
    // The owner must not be able to reach the dashboard while notifyOwner rejects them: the two
    // gates agree because both read the same identity.
    const owner = systemCaller(ownerUser({ role: "admin" }));
    await expect(owner.notifyOwner({ title: "test", content: "test" })).resolves.toEqual({ success: true });
  });

  it("refuses a normal user at the admin gate", async () => {
    const other = systemCaller(normalUser({ role: "user" }));
    await expect(other.notifyOwner({ title: "test", content: "test" })).rejects.toThrow();
    expect(notifyOwner).not.toHaveBeenCalled();
  });

  it("refuses an unauthenticated caller at the admin gate", async () => {
    const anonymous = systemCaller(null);
    await expect(anonymous.notifyOwner({ title: "test", content: "test" })).rejects.toThrow();
  });
});

describe("the owner dashboard payload", () => {
  beforeEach(() => configureEnv({ ownerEmail: OWNER_EMAIL, ownerOpenId: OWNER_OPEN_ID }));

  it("returns aggregates and the live quota without any secret", async () => {
    const result = await callerFor(ownerUser()).owner.dashboard();
    expect(result.quota).toMatchObject({ limitPerRole: 15, windowSeconds: 60 });
    expect(result.quota.roles.map((role) => role.roleId)).toEqual(["fast", "smart", "context", "flagship"]);

    const serialised = JSON.stringify(result).toLowerCase();
    for (const forbidden of ["apikey", "api_key", "encryptedapikey", "secret", "password", "databaseurl", "cookie", "jwt", "owneremail", "openid"]) {
      expect(serialised).not.toContain(forbidden);
    }
  });
});
