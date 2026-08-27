import { describe, expect, it } from "vitest";
import { classifyOpenRouterFailure } from "./providers";
import {
  roleAllowedByDegradation,
  runCapacityCalibration,
  simulateDegradationAndQueue,
  simulateNoisyUserFairness,
  simulateProviderDomainAndSearch,
  simulateReservationLifecycle,
} from "./capacity-calibration";

describe("capacity calibration synthetic no-network model", () => {
  it("protects a quiet cohort from one noisy actor in the declared calibration window", () => {
    const result = simulateNoisyUserFairness();
    expect(result.guardedControllerModel).toMatchObject({ noisyAdmitted: 12, noisyRejectedByUser: 88, quietAdmitted: 100, quietRejected: 0, usedWcu: 112, quietCohortProtected: true });
    expect(result.counterfactualWithoutPerUserGuard).toMatchObject({ noisyAdmitted: 100, quietAdmitted: 20, quietUsersDeniedByGlobal: 80, usedWcu: 120 });
  });

  it("models exactly-once settlement, retry deduplication, distinct fallback reservation and TTL recovery", () => {
    const result = simulateReservationLifecycle();
    expect(result.firstReservation.deduplicated).toBe(false);
    expect(result.replay.deduplicated).toBe(true);
    expect(result).toMatchObject({ firstFailureReleased: true, duplicateReleaseChangedState: false, distinctAttemptKeys: true, fallbackSettled: true, finalInflightWcu: 0 });
    expect(result.attemptHistogram).toMatchObject({ 1: 1, 2: 1, overHardMaximum: 0 });
    expect(result.staleReservation.releasedExactlyOnce).toBe(true);
  });

  it("models shared provider scope and a separately exhausted search scope", () => {
    const result = simulateProviderDomainAndSearch();
    expect(result.sharedProviderDomain.modelA.admitted).toBe(true);
    expect(result.sharedProviderDomain.modelB).toMatchObject({ admitted: false, deniedBy: "provider" });
    expect(result.separateSearchBudget).toMatchObject({ generation: { affectedBySearchExhaustion: false }, search: { firstAdmission: true, secondAdmission: false } });
  });

  it("keeps Flash available through high and critical degradation, while exhausted blocks every role", () => {
    const result = simulateDegradationAndQueue();
    expect(result.degradation).toMatchObject({ high: { fast: true, smart: true, context: true, flagship: false }, critical: { fast: true, smart: false, context: false, flagship: false }, exhausted: { fast: false, smart: false, context: false, flagship: false } });
    expect(result.queue).toMatchObject({ disabledDefault: { overflowAction: "controlled immediate rejection before upstream" }, configuredFlashOnly: { eligibleRole: "fast", maxWaitMs: 1500, maxDepth: 64, nextRequest: "queue_full" } });
    expect(roleAllowedByDegradation("fast", "critical")).toBe(true);
    expect(roleAllowedByDegradation("fast", "exhausted")).toBe(false);
  });

  it("uses existing provider error classification without making an upstream request", () => {
    expect(classifyOpenRouterFailure(401, {}).category).toBe("AUTH");
    expect(classifyOpenRouterFailure(429, { error: "quota exhausted" }).category).toBe("QUOTA");
    expect(classifyOpenRouterFailure(429, { error: "slow down" }).category).toBe("RATE_LIMIT");
    expect(classifyOpenRouterFailure(503, { error: "overload" }).category).toBe("PROVIDER_UNAVAILABLE");
  });

  it("keeps population projections and multi-instance conclusion explicitly synthetic", () => {
    const result = runCapacityCalibration();
    expect(result.network).toEqual({ allowed: false, attempted: 0 });
    expect(result.populationProjections).toHaveLength(9);
    expect(result.populationProjections.find((entry) => entry.registeredActors === 50_000 && entry.dauRatio === 0.1)).toMatchObject({ dailyActiveActors: 5_000, syntheticBurstActors: 250 });
    expect(result.multiInstance.twoIndependentProcesses.oneActorCanHold).toBe(4);
    expect(result.multiInstance.durableCounterIllustration.fourthAdmission).toBe("durably denied");
  });
});
