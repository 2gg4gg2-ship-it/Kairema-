import { describe, expect, it } from "vitest";
import { runDbStorageBenchmark } from "../scripts/db-storage-benchmark";

describe("deterministic DB/storage benchmark isolation", () => {
  it("uses only aggregate synthetic adapters, preserves replay/CAS/isolation semantics, and does not attempt network", async () => {
    const result = await runDbStorageBenchmark([10]);
    const tier = result.tiers[0];
    expect(result.isolation).toEqual({
      realDatabaseOrStorage: false,
      importsProductionRuntime: false,
      networkGuardBlockedAttempts: 0,
      maximumLogicalWorkers: 64,
    });
    expect(tier?.logicalOperations).toBe(1_000);
    expect(tier?.adapter.duplicateAttempts).toBeGreaterThan(0);
    expect(tier?.adapter.replayHits).toBe(tier?.adapter.duplicateAttempts);
    expect(tier?.adapter.assistantMutations).toBeLessThan(tier?.adapter.duplicateAttempts);
    expect(tier?.adapter.cas).toEqual({ contenders: 64, winners: 1, losers: 63 });
    expect(tier?.adapter.crossActorDenials).toBeGreaterThan(0);
    expect(tier?.errors.unexpected).toBe(0);
    expect(JSON.stringify(result)).not.toContain("actor-");
  });
});
