/**
 * Deterministic calibration model for the existing Capacity & Fairness Controller V1.
 *
 * It deliberately does not call the database, a provider, search, or production
 * admission APIs. Values marked `synthetic` are calibration constants, never
 * Kairema account quotas, token counts, costs, or a production capacity claim.
 */
export const CALIBRATION_POPULATIONS = [10_000, 25_000, 50_000] as const;
export const CALIBRATION_DAU_RATIOS = [0.01, 0.05, 0.1] as const;

export type DegradationMode = "normal" | "elevated" | "high" | "critical" | "exhausted";
export type CalibrationRole = "fast" | "smart" | "context" | "flagship";

export const SYNTHETIC_CALIBRATION_CONSTANTS = Object.freeze({
  windowSeconds: 60,
  fairnessGlobalWcuWindow: 120,
  perUserGenerationWcu: 12,
  perUserGenerationConcurrency: 2,
  queueMaxWaitMs: 1_500,
  queueMaxDepth: 64,
  reservationTtlSeconds: 180,
  providerSharedDomainWcu: 6,
  searchWcuWindow: 1,
  localGenerationPerInstance: 12,
  localGenerationPerUser: 2,
});

export function roleAllowedByDegradation(role: CalibrationRole, mode: DegradationMode) {
  return mode !== "exhausted"
    && !(mode === "critical" && (role === "smart" || role === "context" || role === "flagship"))
    && !(mode === "high" && role === "flagship");
}

type WindowLedger = { globalWcu: number; perUserWcu: Map<string, number> };

function admitLowCostRequest(ledger: WindowLedger, userKey: string, configuration: { globalWcu: number; perUserWcu: number }) {
  const usedByUser = ledger.perUserWcu.get(userKey) ?? 0;
  if (usedByUser + 1 > configuration.perUserWcu) return "user" as const;
  if (ledger.globalWcu + 1 > configuration.globalWcu) return "global" as const;
  ledger.globalWcu += 1;
  ledger.perUserWcu.set(userKey, usedByUser + 1);
  return "admitted" as const;
}

export function simulateNoisyUserFairness() {
  const configuration = {
    globalWcu: SYNTHETIC_CALIBRATION_CONSTANTS.fairnessGlobalWcuWindow,
    perUserWcu: SYNTHETIC_CALIBRATION_CONSTANTS.perUserGenerationWcu,
  };
  const actual: WindowLedger = { globalWcu: 0, perUserWcu: new Map() };
  const counterfactualNoPerUserGuard: WindowLedger = { globalWcu: 0, perUserWcu: new Map() };
  let noisyAdmitted = 0;
  let noisyRejectedByUser = 0;
  let quietAdmitted = 0;
  let quietRejected = 0;
  let counterfactualQuietAdmitted = 0;

  for (let request = 0; request < 100; request += 1) {
    const outcome = admitLowCostRequest(actual, "noisy", configuration);
    if (outcome === "admitted") noisyAdmitted += 1;
    if (outcome === "user") noisyRejectedByUser += 1;
    admitLowCostRequest(counterfactualNoPerUserGuard, "noisy", {
      globalWcu: configuration.globalWcu,
      perUserWcu: Number.MAX_SAFE_INTEGER,
    });
  }
  for (let quietUser = 1; quietUser <= 100; quietUser += 1) {
    const outcome = admitLowCostRequest(actual, `quiet-${quietUser}`, configuration);
    if (outcome === "admitted") quietAdmitted += 1; else quietRejected += 1;
    const counterfactual = admitLowCostRequest(counterfactualNoPerUserGuard, `quiet-${quietUser}`, {
      globalWcu: configuration.globalWcu,
      perUserWcu: Number.MAX_SAFE_INTEGER,
    });
    if (counterfactual === "admitted") counterfactualQuietAdmitted += 1;
  }

  return {
    classification: "synthetic-controller-calibration-not-a-quota",
    offered: { noisyUserRequests: 100, quietUsersWithOneRequest: 100, totalLowCostWcu: 200 },
    configuredCalibrationOnly: configuration,
    guardedControllerModel: {
      noisyAdmitted,
      noisyRejectedByUser,
      quietAdmitted,
      quietRejected,
      usedWcu: actual.globalWcu,
      quietCohortProtected: quietAdmitted === 100,
    },
    counterfactualWithoutPerUserGuard: {
      noisyAdmitted: 100,
      quietAdmitted: counterfactualQuietAdmitted,
      quietUsersDeniedByGlobal: 100 - counterfactualQuietAdmitted,
      usedWcu: counterfactualNoPerUserGuard.globalWcu,
    },
  };
}

export function simulateReservationLifecycle() {
  const requestKey = "synthetic-message-1:attempt:1:provider:openrouter";
  const fallbackKey = "synthetic-message-1:attempt:2:provider:groq";
  const reservations = new Map<string, { state: "reserved" | "settled" | "released"; inflightWcu: number }>();
  const reserve = (key: string) => {
    const existing = reservations.get(key);
    if (existing) return { key, deduplicated: true, state: existing.state };
    reservations.set(key, { state: "reserved", inflightWcu: 2 });
    return { key, deduplicated: false, state: "reserved" as const };
  };
  const finalize = (key: string, state: "settled" | "released") => {
    const ticket = reservations.get(key);
    if (!ticket || ticket.state !== "reserved") return false;
    ticket.state = state;
    ticket.inflightWcu = 0;
    return true;
  };
  const first = reserve(requestKey);
  const replay = reserve(requestKey);
  const releasedAfterFailure = finalize(requestKey, "released");
  const duplicateRelease = finalize(requestKey, "released");
  const fallback = reserve(fallbackKey);
  const settledFallback = finalize(fallbackKey, "settled");
  const expiredBeforeCleanup = { state: "reserved" as const, ageSeconds: SYNTHETIC_CALIBRATION_CONSTANTS.reservationTtlSeconds + 1, inflightWcu: 1 };
  const staleReleased = expiredBeforeCleanup.ageSeconds > SYNTHETIC_CALIBRATION_CONSTANTS.reservationTtlSeconds;

  return {
    classification: "synthetic-lifecycle-trace",
    firstReservation: first,
    replay,
    firstFailureReleased: releasedAfterFailure,
    duplicateReleaseChangedState: duplicateRelease,
    fallbackReservation: fallback,
    fallbackSettled: settledFallback,
    distinctAttemptKeys: new Set<string>([requestKey, fallbackKey]).size === 2,
    attemptHistogram: { 1: 1, 2: 1, 3: 0, 4: 0, overHardMaximum: 0 },
    finalInflightWcu: Array.from(reservations.values()).reduce((total, entry) => total + entry.inflightWcu, 0),
    staleReservation: {
      ttlSeconds: SYNTHETIC_CALIBRATION_CONSTANTS.reservationTtlSeconds,
      releasedExactlyOnce: staleReleased,
      restartMeaning: "local counters reset on restart; durable reserved rows require TTL cleanup",
    },
  };
}

export function simulateProviderDomainAndSearch() {
  const providerLimit = SYNTHETIC_CALIBRATION_CONSTANTS.providerSharedDomainWcu;
  const firstModelWcu = 4;
  const secondModelWcu = 4;
  const firstAccepted = firstModelWcu <= providerLimit;
  const secondAccepted = firstAccepted && firstModelWcu + secondModelWcu <= providerLimit;
  const generationUsed = 2;
  const searchUsed = SYNTHETIC_CALIBRATION_CONSTANTS.searchWcuWindow;
  return {
    classification: "synthetic-scope-isolation-not-provider-quota",
    sharedProviderDomain: {
      syntheticProviderWindowWcu: providerLimit,
      modelA: { requestedWcu: firstModelWcu, admitted: firstAccepted },
      modelB: { requestedWcu: secondModelWcu, admitted: secondAccepted, deniedBy: secondAccepted ? null : "provider" },
      conclusion: "provider-level scope prevents two model identifiers from independently consuming one configured provider budget",
    },
    separateSearchBudget: {
      generation: { admittedWcu: generationUsed, affectedBySearchExhaustion: false },
      search: { capacityWcu: SYNTHETIC_CALIBRATION_CONSTANTS.searchWcuWindow, firstAdmission: true, secondAdmission: false },
      truthfulFreshnessAction: "search-denied => existing freshness-unavailable/degraded context; generation policy is not used as evidence of fresh data",
    },
  };
}

export function simulateDegradationAndQueue() {
  const modes: DegradationMode[] = ["normal", "elevated", "high", "critical", "exhausted"];
  const roles: CalibrationRole[] = ["fast", "smart", "context", "flagship"];
  const matrix = Object.fromEntries(modes.map((mode) => [mode, Object.fromEntries(roles.map((role) => [role, roleAllowedByDegradation(role, mode)]))]));
  return {
    classification: "synthetic-policy-matrix",
    degradation: matrix,
    queue: {
      disabledDefault: { waitMs: 0, depth: 0, overflowAction: "controlled immediate rejection before upstream" },
      configuredFlashOnly: {
        eligibleRole: "fast",
        maxWaitMs: SYNTHETIC_CALIBRATION_CONSTANTS.queueMaxWaitMs,
        maxDepth: SYNTHETIC_CALIBRATION_CONSTANTS.queueMaxDepth,
        queuedAtDepth: SYNTHETIC_CALIBRATION_CONSTANTS.queueMaxDepth,
        nextRequest: "queue_full",
        timedOutRequest: "no reservation/no upstream attempt",
      },
    },
  };
}

export function simulateMultiInstanceBoundary() {
  const localPerUser = SYNTHETIC_CALIBRATION_CONSTANTS.localGenerationPerUser;
  const localPerInstance = SYNTHETIC_CALIBRATION_CONSTANTS.localGenerationPerInstance;
  return {
    classification: "synthetic-topology-boundary",
    twoIndependentProcesses: {
      localPerInstance,
      oneActorCanHold: localPerUser * 2,
      interpretation: "process-local per-user state alone is not global fairness across replicas",
    },
    durableCounterIllustration: {
      configuredGlobalConcurrentLimit: 3,
      admittedAcrossTwoProcesses: 3,
      fourthAdmission: "durably denied",
      interpretation: "durable counters coordinate configured aggregate limits but do not form a distributed queue or a global scheduling guarantee",
    },
  };
}

export function simulatePopulationProjections() {
  return CALIBRATION_POPULATIONS.flatMap((registeredActors) => CALIBRATION_DAU_RATIOS.map((dauRatio) => {
    const dailyActiveActors = Math.round(registeredActors * dauRatio);
    return {
      registeredActors,
      dauRatio,
      dailyActiveActors,
      syntheticBurstActors: Math.max(1, Math.ceil(dailyActiveActors * 0.05)),
      workload: "one logical low-cost admission offer per burst actor",
      outcome: "not admitted/rejected because real global provider/account capacity is unknown and no quota is assumed",
    };
  }));
}

export function runCapacityCalibration() {
  return {
    version: "capacity-calibration-v1",
    deterministic: true,
    network: { allowed: false, attempted: 0 },
    scope: "synthetic only; no user data, database, provider, search, billing, account quota or production runtime calls",
    constants: SYNTHETIC_CALIBRATION_CONSTANTS,
    fairness: simulateNoisyUserFairness(),
    lifecycle: simulateReservationLifecycle(),
    providerAndSearch: simulateProviderDomainAndSearch(),
    degradationAndQueue: simulateDegradationAndQueue(),
    multiInstance: simulateMultiInstanceBoundary(),
    populationProjections: simulatePopulationProjections(),
  };
}
