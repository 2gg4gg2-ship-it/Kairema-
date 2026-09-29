import { beforeEach, describe, expect, it, vi } from "vitest";
import { capacityBudgetWindows, capacityControllerSettings, capacityProviderBudgets, capacityReservations } from "../drizzle/schema";

const state = vi.hoisted(() => ({
  settings: null as Record<string, unknown> | null,
  providerBudget: null as Record<string, unknown> | null,
  reservations: new Map<string, Record<string, unknown>>(),
  /** Durable WCU window charges, counted per scope key; the fake DB has no SQL predicate evaluator. */
  windowCharges: new Map<string, number>(),
  lastWindowScopeKey: null as string | null,
  forceReservationLookupMiss: false,
  forceBudgetWindowContention: false,
  forceWindowContentionScopePrefix: null as string | null,
}));

function windowChargeCount(scopeKey: string) {
  return state.windowCharges.get(scopeKey) ?? 0;
}

function rowsFor(table: unknown) {
  if (table === capacityControllerSettings) return state.settings ? [state.settings] : [];
  if (table === capacityProviderBudgets) return state.providerBudget ? [state.providerBudget] : [];
  if (table === capacityReservations) return state.forceReservationLookupMiss ? [] : [...state.reservations.values()];
  return [];
}

const db = {
  insert: (table: unknown) => ({
    values: (values: Record<string, unknown>) => {
      if (table === capacityControllerSettings && !state.settings) state.settings = { ...values };
      if (table === capacityProviderBudgets) state.providerBudget = { ...state.providerBudget, ...values };
      if (table === capacityReservations) state.reservations.set(String(values.requestKey), { ...values });
      if (table === capacityBudgetWindows) {
        state.lastWindowScopeKey = String(values.scopeKey);
        state.windowCharges.set(state.lastWindowScopeKey, windowChargeCount(state.lastWindowScopeKey) + 1);
      }
      return { onDuplicateKeyUpdate: async () => undefined };
    },
  }),
  select: () => ({
    from: (table: unknown) => {
      const rows = () => rowsFor(table);
      const whereResult = {
        limit: async () => rows(),
        then: <T>(resolve: (value: Record<string, unknown>[]) => T | PromiseLike<T>) => Promise.resolve(rows()).then(resolve),
      };
      return {
        where: () => whereResult,
        limit: async () => rows(),
        orderBy: async () => rows(),
      };
    },
  }),
  update: (table: unknown) => ({
    set: (values: Record<string, unknown>) => ({
      where: async () => {
        if (table === capacityBudgetWindows && state.forceBudgetWindowContention) return [{ affectedRows: 0 }];
        if (table === capacityBudgetWindows && state.forceWindowContentionScopePrefix !== null
          && (state.lastWindowScopeKey ?? "").startsWith(state.forceWindowContentionScopePrefix)) return [{ affectedRows: 0 }];
        if (table === capacityControllerSettings && state.settings) state.settings = { ...state.settings, ...values };
        if (table === capacityReservations) {
          for (const [key, row] of state.reservations) state.reservations.set(key, { ...row, ...values });
        }
        return [{ affectedRows: 1 }];
      },
    }),
  }),
  transaction: async <T>(fn: (transaction: typeof db) => Promise<T>) => fn(db),
};

vi.mock("./db", () => ({ getDb: async () => db }));

import {
  CapacityAdmissionError,
  beginCapacityGeneration,
  beginCapacitySearch,
  getCapacityPolicy,
  resetCapacityControllerRuntimeForTests,
  settleCapacityReservation,
  updateCapacityPolicy,
} from "./capacity-controller";

const normal = { thinking: false, imageUrls: [], responseLength: "concise" as const, effort: "normal" as const, webResearch: false };

beforeEach(() => {
  state.settings = null;
  state.providerBudget = null;
  state.reservations.clear();
  state.windowCharges.clear();
  state.lastWindowScopeKey = null;
  state.forceReservationLookupMiss = false;
  state.forceBudgetWindowContention = false;
  state.forceWindowContentionScopePrefix = null;
  resetCapacityControllerRuntimeForTests();
});

describe("capacity controller V1", () => {
  it("derives WCU from server-side role/modifier policy without a client quota field", async () => {
    const lease = await beginCapacityGeneration({ userId: 11, requestKey: "m-11" }, "context", { ...normal, thinking: true, webResearch: true });
    expect(lease.wcu).toBe(5);
    expect(lease.modifiers).toEqual(["thinking", "webResearch"]);
    lease.release();
  });

  it("enforces reusable instance-local per-user generation concurrency without treating it as global capacity", async () => {
    const first = await beginCapacityGeneration({ userId: 42, requestKey: "m-1" }, "fast", normal);
    const second = await beginCapacityGeneration({ userId: 42, requestKey: "m-2" }, "fast", normal);
    await expect(beginCapacityGeneration({ userId: 42, requestKey: "m-3" }, "fast", normal)).rejects.toMatchObject<Partial<CapacityAdmissionError>>({ status: 503, reason: "concurrency", scope: "instance" });
    const anotherUser = await beginCapacityGeneration({ userId: 43, requestKey: "m-4" }, "fast", normal);
    first.release(); second.release(); anotherUser.release();
  });

  it("makes a provider-attempt reservation idempotent for retry/replay and records no second row", async () => {
    const lease = await beginCapacityGeneration({ userId: 9, requestKey: "saved-message-9" }, "smart", normal);
    const first = await lease.reserveAttempt({ provider: "openrouter", modelId: "known-model" }, 1);
    const replay = await lease.reserveAttempt({ provider: "openrouter", modelId: "known-model" }, 1);
    expect(first.deduplicated).toBe(false);
    expect(replay).toMatchObject({ id: first.id, deduplicated: true });
    expect(state.reservations).toHaveLength(1);
    lease.release();
  });

  it("rejects a disabled provider before any generation network path can be attempted", async () => {
    state.providerBudget = { scopeKey: "provider:groq", provider: "groq", modelId: null, enabled: 0, generationWcuLimit: null, quotaState: "unknown" };
    const lease = await beginCapacityGeneration({ userId: 77, requestKey: "m-77" }, "fast", normal);
    await expect(lease.reserveAttempt({ provider: "groq", modelId: "known-model" }, 1)).rejects.toMatchObject<Partial<CapacityAdmissionError>>({ status: 503, reason: "provider_disabled", scope: "provider" });
    expect(state.reservations).toHaveLength(0);
    lease.release();
  });

  it("applies an explicit operator degradation policy before any upstream reservation while preserving Flash", async () => {
    await updateCapacityPolicy({ degradationMode: "high" });
    const flagship = await beginCapacityGeneration({ userId: 81, requestKey: "m-81" }, "flagship", normal);
    await expect(flagship.reserveAttempt({ provider: "openrouter", modelId: "known-model" }, 1))
      .rejects.toMatchObject<Partial<CapacityAdmissionError>>({ status: 429, reason: "capacity", scope: "global" });
    flagship.release();

    const flash = await beginCapacityGeneration({ userId: 82, requestKey: "m-82" }, "fast", normal);
    await expect(flash.reserveAttempt({ provider: "openrouter", modelId: "known-model" }, 1)).resolves.toMatchObject({ deduplicated: false });
    flash.release();
  });

  it("charges the per-user WCU window exactly once for one Flash request without fallback", async () => {
    const lease = await beginCapacityGeneration({ userId: 401, requestKey: "flash-401" }, "fast", normal);
    expect(lease.wcu).toBe(1);
    await lease.reserveAttempt({ provider: "openrouter", modelId: "flash-model" }, 1);

    expect(windowChargeCount("user:generation:401")).toBe(1);
    expect(windowChargeCount("global:generation")).toBe(1);
    expect(windowChargeCount("provider:openrouter")).toBe(1);
    expect(windowChargeCount("model:openrouter:flash-model")).toBe(1);
    lease.release();
  });

  it("keeps the per-user WCU window at one charge when one Flash request falls back through four attempts", async () => {
    const lease = await beginCapacityGeneration({ userId: 402, requestKey: "flash-402" }, "fast", normal);
    // The fake selector has no SQL predicate evaluator; each later attempt key is modeled explicitly.
    state.forceReservationLookupMiss = true;
    await lease.reserveAttempt({ provider: "openrouter", modelId: "flash-a" }, 1);
    await lease.reserveAttempt({ provider: "orcarouter", modelId: "flash-b" }, 2);
    await lease.reserveAttempt({ provider: "groq", modelId: "flash-c" }, 3);
    await lease.reserveAttempt({ provider: "google", modelId: "flash-d" }, 4);

    expect(windowChargeCount("user:generation:402")).toBe(1);
    // Provider, model and global accounting stays per real attempt.
    expect(windowChargeCount("global:generation")).toBe(4);
    expect(windowChargeCount("provider:openrouter")).toBe(1);
    expect(windowChargeCount("provider:orcarouter")).toBe(1);
    expect(windowChargeCount("provider:groq")).toBe(1);
    expect(windowChargeCount("provider:google")).toBe(1);
    expect(windowChargeCount("model:openrouter:flash-a")).toBe(1);
    expect(windowChargeCount("model:orcarouter:flash-b")).toBe(1);
    expect(windowChargeCount("model:groq:flash-c")).toBe(1);
    expect(windowChargeCount("model:google:flash-d")).toBe(1);
    expect(state.reservations).toHaveLength(4);
    lease.release();
  });

  it("charges the per-user WCU window once per request with the role weight regardless of fallback count", async () => {
    const cases = [
      { role: "fast" as const, userId: 411, wcu: 1, scope: "user:generation:411" },
      { role: "smart" as const, userId: 412, wcu: 2, scope: "user:generation:412" },
      { role: "context" as const, userId: 413, wcu: 3, scope: "user:generation:413" },
      { role: "flagship" as const, userId: 414, wcu: 4, scope: "user:generation:414" },
    ];
    for (const testCase of cases) {
      const lease = await beginCapacityGeneration({ userId: testCase.userId, requestKey: `role-${testCase.role}` }, testCase.role, normal);
      expect(lease.wcu).toBe(testCase.wcu);
      // The fake selector has no SQL predicate evaluator; the fallback attempt key is modeled explicitly.
      state.forceReservationLookupMiss = true;
      await lease.reserveAttempt({ provider: "openrouter", modelId: `model-${testCase.role}-a` }, 1);
      await lease.reserveAttempt({ provider: "groq", modelId: `model-${testCase.role}-b` }, 2);
      expect(windowChargeCount(testCase.scope)).toBe(1);
      expect(windowChargeCount(`provider:openrouter`)).toBeGreaterThanOrEqual(1);
      lease.release();
    }
  });

  it("never charges the per-user WCU window twice for a repeated reservation of the same logical request", async () => {
    const lease = await beginCapacityGeneration({ userId: 421, requestKey: "replay-421" }, "smart", normal);
    const first = await lease.reserveAttempt({ provider: "openrouter", modelId: "replay-model" }, 1);
    const replay = await lease.reserveAttempt({ provider: "openrouter", modelId: "replay-model" }, 1);
    expect(replay.deduplicated).toBe(true);
    expect(replay.id).toBe(first.id);
    expect(state.reservations).toHaveLength(1);
    expect(windowChargeCount("user:generation:421")).toBe(1);

    // A later fallback attempt of the same request must not charge the per-user window again.
    state.forceReservationLookupMiss = true;
    await lease.reserveAttempt({ provider: "groq", modelId: "replay-fallback" }, 2);
    expect(windowChargeCount("user:generation:421")).toBe(1);
    expect(windowChargeCount("provider:groq")).toBe(1);
    lease.release();
  });

  it("charges independent per-user WCU windows for independent logical requests", async () => {
    const first = await beginCapacityGeneration({ userId: 431, requestKey: "logical-a" }, "fast", normal);
    await first.reserveAttempt({ provider: "openrouter", modelId: "logical-a-model" }, 1);
    first.release();

    const second = await beginCapacityGeneration({ userId: 431, requestKey: "logical-b" }, "fast", normal);
    // The fake selector has no SQL predicate evaluator; a second logical request is modeled explicitly.
    state.forceReservationLookupMiss = true;
    await second.reserveAttempt({ provider: "openrouter", modelId: "logical-b-model" }, 1);
    second.release();

    const other = await beginCapacityGeneration({ userId: 432, requestKey: "logical-c" }, "fast", normal);
    await other.reserveAttempt({ provider: "openrouter", modelId: "logical-c-model" }, 1);
    other.release();

    expect(windowChargeCount("user:generation:431")).toBe(2);
    expect(windowChargeCount("user:generation:432")).toBe(1);
  });

  it("still enforces the per-user WCU window for every new logical request", async () => {
    const first = await beginCapacityGeneration({ userId: 441, requestKey: "enforced-a" }, "fast", normal);
    await first.reserveAttempt({ provider: "openrouter", modelId: "enforced-a-model" }, 1);
    first.release();
    expect(windowChargeCount("user:generation:441")).toBe(1);

    state.forceWindowContentionScopePrefix = "user:generation:";
    // The fake selector has no SQL predicate evaluator; the second logical request key is modeled explicitly.
    state.forceReservationLookupMiss = true;
    const blocked = await beginCapacityGeneration({ userId: 441, requestKey: "enforced-b" }, "fast", normal);
    await expect(blocked.reserveAttempt({ provider: "openrouter", modelId: "enforced-b-model" }, 1))
      .rejects.toMatchObject<Partial<CapacityAdmissionError>>({ status: 429, reason: "capacity", scope: "user" });
    blocked.release();
    expect(state.reservations).toHaveLength(1);
    state.forceWindowContentionScopePrefix = null;
  });

  it("settles each reservation once and gives a fallback attempt its own durable idempotency key", async () => {
    const lease = await beginCapacityGeneration({ userId: 91, requestKey: "m-91" }, "smart", normal);
    const first = await lease.reserveAttempt({ provider: "openrouter", modelId: "known-model-a" }, 1);
    await settleCapacityReservation(first, "released");
    await settleCapacityReservation(first, "released");
    expect([...state.reservations.values()][0]).toMatchObject({ state: "released" });

    // The fake selector has no SQL predicate evaluator; model the different fallback request key explicitly.
    state.forceReservationLookupMiss = true;
    const fallback = await lease.reserveAttempt({ provider: "groq", modelId: "known-model-b" }, 2);
    expect(fallback.requestKey).not.toBe(first.requestKey);
    expect(fallback.deduplicated).toBe(false);
    expect(state.reservations).toHaveLength(2);
    lease.release();
  });

  it("keeps search admission in a separate per-user local domain without invoking the search cascade", async () => {
    const first = await beginCapacitySearch({ userId: 51, requestKey: "m-51" }, "fast");
    await expect(beginCapacitySearch({ userId: 51, requestKey: "m-52" }, "fast")).rejects.toMatchObject<Partial<CapacityAdmissionError>>({ status: 503, reason: "concurrency", scope: "instance" });
    const otherUser = await beginCapacitySearch({ userId: 52, requestKey: "m-53" }, "fast");
    first.release(); otherUser.release();
  });

  it("allows a large sequential cohort of low-cost users without letting one actor retain local capacity", async () => {
    for (let userId = 1; userId <= 100; userId += 1) {
      const lease = await beginCapacityGeneration({ userId, requestKey: `quiet-${userId}` }, "fast", normal);
      lease.release();
    }
    const afterCohort = await beginCapacityGeneration({ userId: 101, requestKey: "quiet-after" }, "fast", normal);
    afterCohort.release();
  });

  it("permits an independently admitted fallback after a policy-disabled candidate was skipped before upstream work", async () => {
    state.providerBudget = { scopeKey: "provider:openrouter", provider: "openrouter", modelId: null, enabled: 0, generationWcuLimit: null, quotaState: "unknown" };
    const lease = await beginCapacityGeneration({ userId: 93, requestKey: "m-93" }, "smart", normal);
    await expect(lease.reserveAttempt({ provider: "openrouter", modelId: "blocked-model" }, 1))
      .rejects.toMatchObject<Partial<CapacityAdmissionError>>({ reason: "provider_disabled", scope: "provider" });
    state.providerBudget = null;
    await expect(lease.reserveAttempt({ provider: "groq", modelId: "fallback-model" }, 2))
      .resolves.toMatchObject({ deduplicated: false });
    expect(state.reservations).toHaveLength(1);
    lease.release();
  });

  it("rejects simulated durable CAS contention before recording a reservation or spending an upstream attempt", async () => {
    await updateCapacityPolicy({ globalGenerationWcuLimit: 10 });
    state.forceBudgetWindowContention = true;
    const lease = await beginCapacityGeneration({ userId: 94, requestKey: "m-94" }, "fast", normal);
    await expect(lease.reserveAttempt({ provider: "openrouter", modelId: "cas-model" }, 1))
      .rejects.toMatchObject<Partial<CapacityAdmissionError>>({ status: 429, reason: "capacity", scope: "global" });
    expect(state.reservations).toHaveLength(0);
    lease.release();
  });

  it("keeps the Flash-only local queue bounded and expires its waiter before any upstream attempt", async () => {
    await updateCapacityPolicy({ queueMaxWaitMs: 10, queueMaxDepth: 1, queueEligibleRoles: ["fast"] });
    const holders = await Promise.all(Array.from({ length: 12 }, (_, index) =>
      beginCapacityGeneration({ userId: 200 + index, requestKey: `holder-${index}` }, "fast", normal),
    ));
    vi.useFakeTimers();
    try {
      const waiting = beginCapacityGeneration({ userId: 299, requestKey: "expires" }, "fast", normal);
      const expectedTimeout = expect(waiting).rejects.toMatchObject<Partial<CapacityAdmissionError>>({ status: 503, reason: "concurrency", scope: "instance" });
      await vi.advanceTimersByTimeAsync(15);
      await expectedTimeout;
      expect(state.reservations).toHaveLength(0);
    } finally {
      vi.useRealTimers();
      holders.forEach((lease) => lease.release());
    }
  });

  it("does not rely on process-local admission state after an instance restart boundary", async () => {
    const beforeRestart = await beginCapacityGeneration({ userId: 301, requestKey: "before-restart" }, "fast", normal);
    resetCapacityControllerRuntimeForTests();
    const afterRestart = await beginCapacityGeneration({ userId: 301, requestKey: "after-restart" }, "fast", normal);
    beforeRestart.release();
    afterRestart.release();
  });

  it("normalizes malformed persisted policy values to bounded safe defaults without inventing global quota", async () => {
    state.settings = {
      id: 1,
      enabled: 1,
      globalGenerationWcuLimit: -1,
      globalSearchWcuLimit: 0,
      globalGenerationConcurrency: -2,
      globalSearchConcurrency: null,
      globalGenerationInflightWcuLimit: "invalid",
      perUserGenerationWcuLimit: 0,
      perUserSearchWcuLimit: -1,
      perUserGenerationConcurrency: 999,
      perUserSearchConcurrency: 999,
      apexPressureReservePercent: 999,
      roleWeightsJson: "not-json",
      modifierWeightsJson: "not-json",
      queueMaxWaitMs: 9_999,
      queueMaxDepth: 9_999,
      queueEligibleRolesJson: '["not-a-role"]',
      reservationTtlSeconds: 9_999,
      degradationMode: "not-a-mode",
    };
    const policy = await getCapacityPolicy();
    expect(policy).toMatchObject({
      globalGenerationWcuLimit: null,
      globalSearchWcuLimit: null,
      globalGenerationConcurrency: null,
      globalSearchConcurrency: null,
      globalGenerationInflightWcuLimit: null,
      perUserGenerationWcuLimit: 12,
      perUserSearchWcuLimit: 6,
      perUserGenerationConcurrency: 2,
      perUserSearchConcurrency: 1,
      apexPressureReservePercent: 80,
      roleWeights: { fast: 1, smart: 2, context: 3, flagship: 4 },
      queueMaxWaitMs: 1_500,
      queueMaxDepth: 64,
      queueEligibleRoles: ["fast"],
      reservationTtlSeconds: 180,
      degradationMode: "normal",
    });
  });
});
