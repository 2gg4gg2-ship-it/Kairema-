import { beforeEach, describe, expect, it, vi } from "vitest";
import { capacityBudgetWindows, capacityControllerSettings, capacityProviderBudgets, capacityReservations } from "../drizzle/schema";

const state = vi.hoisted(() => ({
  settings: null as Record<string, unknown> | null,
  providerBudget: null as Record<string, unknown> | null,
  reservations: new Map<string, Record<string, unknown>>(),
  forceReservationLookupMiss: false,
  forceBudgetWindowContention: false,
}));

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
      if (table === capacityBudgetWindows) undefined;
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
  resetCapacityControllerRuntimeForTests,
  settleCapacityReservation,
  updateCapacityPolicy,
} from "./capacity-controller";

const normal = { thinking: false, imageUrls: [], responseLength: "concise" as const, effort: "normal" as const, webResearch: false };

beforeEach(() => {
  state.settings = null;
  state.providerBudget = null;
  state.reservations.clear();
  state.forceReservationLookupMiss = false;
  state.forceBudgetWindowContention = false;
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
});
