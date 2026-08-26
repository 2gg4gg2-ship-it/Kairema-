import { describe, expect, it } from "vitest";
import { SYNTHETIC_TIERS, STREAM_LIMITS, runSyntheticBenchmark, withNoNetworkGuard } from "../scripts/synthetic-load-benchmark.mjs";

describe("isolated synthetic load benchmark", () => {
  it("keeps the declared tier contract and reports deterministic local measurement boundaries", async () => {
    expect(SYNTHETIC_TIERS).toEqual([10, 100, 1_000, 10_000, 50_000]);
    const result = await runSyntheticBenchmark([10]);
    expect(result.guardrails).toMatchObject({ noNetwork: true, realDatabase: false, realStorage: false, realProviders: false, productionRuntimeChanged: false });
    expect(result.networkGuardBlockedAttempts).toBe(0);
    expect(result.results).toHaveLength(1);
    const [tier] = result.results;
    expect(tier).toMatchObject({ population: 10, totalOperations: 1_000, workers: 10, unexpectedErrors: 0, classification: "local-model-measured" });
    expect(tier.queryModel.classification).toBe("simulated");
    expect(tier.storageModel.classification).toBe("simulated");
    expect(tier.idempotencyModel).toMatchObject({ classification: "simulated" });
    expect(tier.idempotencyModel.duplicateAttempts).toBeGreaterThan(0);
    expect(tier.idempotencyModel.duplicatesPrevented).toBe(tier.idempotencyModel.duplicateAttempts);
    expect(tier.saturation).toMatchObject({ expectedInstanceLimit: STREAM_LIMITS.perInstance, expectedPerUserLimit: STREAM_LIMITS.perUser, instanceRejected: 4, perUserRejected: 1 });
  });

  it("fails fast when benchmark code tries to use a network entrypoint", async () => {
    const guarded = await withNoNetworkGuard(async () => {
      expect(() => globalThis.fetch("https://example.invalid")).toThrow("forbids outbound network access");
      return "guarded";
    });
    expect(guarded).toEqual({ result: "guarded", blockedAttempts: 1 });
  });
});
