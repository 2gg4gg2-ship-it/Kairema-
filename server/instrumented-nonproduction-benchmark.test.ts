import { describe, expect, it } from "vitest";
import { STREAM_LIMITS } from "../scripts/synthetic-load-benchmark.mjs";
import { runInstrumentedBenchmark } from "../scripts/instrumented-nonproduction-benchmark";

describe("instrumented non-production benchmark", () => {
  it("exercises the real SSE handler with in-memory dependencies and emits metadata-only aggregates", async () => {
    const result = await runInstrumentedBenchmark([10]);
    const tier = result.results[0]!;
    expect(result.networkGuardBlockedAttempts).toBe(0);
    expect(tier.actualHandlerDispatches).toBeGreaterThan(0);
    expect(tier.errors.unexpected).toBe(0);
    expect(tier.telemetry.quotaCalls).toBeGreaterThan(0);
    expect(tier.telemetry.replayHits).toBeGreaterThan(0);
    expect(tier.telemetry.memoryEnqueued).toBeGreaterThan(0);
    expect(tier.classification.handler).toBe("actual-handler-in-memory-dependencies");
    expect(JSON.stringify(tier)).not.toContain("synthetic-message");
  });

  it("measures the actual handler local guard at the published instance and user limits", async () => {
    const result = await runInstrumentedBenchmark([10]);
    expect(result.saturation).toMatchObject({ instanceAccepted: STREAM_LIMITS.perInstance, instanceRejected: 4, worker64Attempted: 64, worker64Accepted: STREAM_LIMITS.perInstance, worker64Rejected: 64 - STREAM_LIMITS.perInstance, perUserRejected: 1, limits: STREAM_LIMITS });
  });
});
