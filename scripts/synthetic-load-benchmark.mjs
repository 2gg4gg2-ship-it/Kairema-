import http from "node:http";
import https from "node:https";
import { performance } from "node:perf_hooks";
import { pathToFileURL } from "node:url";

export const SYNTHETIC_TIERS = [10, 100, 1_000, 10_000, 50_000];
export const OPERATIONS_PER_ACTOR = 100;
export const MAX_LOCAL_WORKERS = 64;
export const STREAM_LIMITS = Object.freeze({ perInstance: 12, perUser: 2 });

const WORKLOAD = Object.freeze([
  ["session_validation", 12, 1, 44],
  ["chat_list_read", 18, 2, 96],
  ["chat_create", 8, 1, 96],
  ["message_ingress_mutation", 20, 9, 336],
  ["memory_read_extraction", 15, 5, 272],
  ["attachment_metadata", 8, 2, 112],
  ["export_history_create", 5, 3, 176],
  ["drafts", 8, 2, 128],
  ["owner_aggregate_metrics", 2, 3, 64],
  ["duplicate_retry", 4, 2, 48],
]);
const MAX_TOTAL_LATENCY_SAMPLES = 200_000;

function percentile(sortedValues, fraction) {
  if (!sortedValues.length) return 0;
  const index = Math.min(sortedValues.length - 1, Math.max(0, Math.ceil(sortedValues.length * fraction) - 1));
  return sortedValues[index];
}

function rounded(value, digits = 3) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function parseTierArgument(argv) {
  const raw = argv.find((argument) => argument.startsWith("--tiers="));
  if (!raw) return SYNTHETIC_TIERS;
  const tiers = raw.slice("--tiers=".length).split(",").map((value) => Number(value.trim()));
  if (!tiers.length || tiers.some((tier) => !SYNTHETIC_TIERS.includes(tier))) {
    throw new Error(`Unsupported tier. Allowed tiers: ${SYNTHETIC_TIERS.join(", ")}.`);
  }
  return tiers;
}

/** Executes callback while all ordinary Node/Fetch outbound entrypoints fail synchronously. */
export async function withNoNetworkGuard(callback) {
  let blockedAttempts = 0;
  const fail = () => {
    blockedAttempts += 1;
    throw new Error("Synthetic load benchmark forbids outbound network access.");
  };
  const original = {
    fetch: globalThis.fetch,
    httpRequest: http.request,
    httpGet: http.get,
    httpsRequest: https.request,
    httpsGet: https.get,
  };
  globalThis.fetch = fail;
  http.request = fail;
  http.get = fail;
  https.request = fail;
  https.get = fail;
  try {
    const result = await callback();
    return { result, blockedAttempts };
  } finally {
    globalThis.fetch = original.fetch;
    http.request = original.httpRequest;
    http.get = original.httpGet;
    https.request = original.httpsRequest;
    https.get = original.httpsGet;
  }
}

class SyntheticKairemaState {
  constructor() {
    this.sessions = new Set();
    this.drafts = new Map();
    this.seenMessageKeys = new Set();
    this.messageAttemptsByUser = new Map();
    this.retryAttemptsByUser = new Map();
    this.logicalStorageBytes = 0;
    this.logicalMutations = 0;
    this.duplicateAttempts = 0;
    this.duplicatesPrevented = 0;
    this.queryModelCount = 0;
    this.operationCounts = Object.fromEntries(WORKLOAD.map(([name]) => [name, 0]));
    this.operationQueryCounts = Object.fromEntries(WORKLOAD.map(([name]) => [name, 0]));
  }

  sessionKey(userId) {
    return `synthetic-session-${userId}`;
  }

  execute(operation, userId, sequence) {
    const [, queryCost, storageBytes] = operation;
    const [name] = operation;
    const sessionKey = this.sessionKey(userId);
    this.operationCounts[name] += 1;
    this.operationQueryCounts[name] += queryCost;
    this.queryModelCount += queryCost;

    switch (name) {
      case "chat_create":
        this.sessions.add(sessionKey);
        this.logicalMutations += 1;
        this.logicalStorageBytes += storageBytes;
        break;
      case "message_ingress_mutation": {
        this.sessions.add(sessionKey);
        const attempt = (this.messageAttemptsByUser.get(userId) ?? 0) + 1;
        this.messageAttemptsByUser.set(userId, attempt);
        const messageKey = `synthetic-client-message-${userId}-${Math.floor((attempt - 1) / 2)}`;
        const duplicate = this.seenMessageKeys.has(messageKey);
        this.seenMessageKeys.add(messageKey);
        if (!duplicate) {
          this.logicalMutations += 2;
          this.logicalStorageBytes += storageBytes;
        } else {
          this.duplicateAttempts += 1;
          this.duplicatesPrevented += 1;
        }
        break;
      }
      case "memory_read_extraction":
        this.logicalMutations += 1;
        this.logicalStorageBytes += storageBytes;
        break;
      case "attachment_metadata":
      case "export_history_create":
        this.logicalMutations += 1;
        this.logicalStorageBytes += storageBytes;
        break;
      case "drafts":
        this.sessions.add(sessionKey);
        this.drafts.set(sessionKey, `draft-${sequence % 16}`);
        this.logicalMutations += 1;
        this.logicalStorageBytes += storageBytes;
        break;
      case "duplicate_retry": {
        const attempt = (this.retryAttemptsByUser.get(userId) ?? 0) + 1;
        this.retryAttemptsByUser.set(userId, attempt);
        const retryKey = `synthetic-retry-${userId}-${Math.floor((attempt - 1) / 2)}`;
        const duplicate = this.seenMessageKeys.has(retryKey);
        this.seenMessageKeys.add(retryKey);
        if (!duplicate) {
          this.logicalMutations += 1;
          this.logicalStorageBytes += storageBytes;
        } else {
          this.duplicateAttempts += 1;
          this.duplicatesPrevented += 1;
        }
        break;
      }
      default:
        break;
    }
  }
}

const WEIGHTED_WORKLOAD = Object.freeze(WORKLOAD.flatMap((operation) => {
  const weights = {
    session_validation: 12,
    chat_list_read: 18,
    chat_create: 8,
    message_ingress_mutation: 20,
    memory_read_extraction: 15,
    attachment_metadata: 8,
    export_history_create: 5,
    drafts: 8,
    owner_aggregate_metrics: 2,
    duplicate_retry: 4,
  };
  return Array.from({ length: weights[operation[0]] }, () => operation);
}));

function simulateStreamSaturation() {
  let active = 0;
  const byUser = new Map();
  let instanceAccepted = 0;
  let instanceRejected = 0;
  let perUserRejected = 0;
  const reserve = (userId) => {
    if (active >= STREAM_LIMITS.perInstance) {
      instanceRejected += 1;
      return false;
    }
    const current = byUser.get(userId) ?? 0;
    if (current >= STREAM_LIMITS.perUser) {
      perUserRejected += 1;
      return false;
    }
    active += 1;
    byUser.set(userId, current + 1);
    instanceAccepted += 1;
    return true;
  };
  for (let userId = 1; userId <= 16; userId += 1) reserve(userId);
  active = 0;
  byUser.clear();
  reserve(1);
  reserve(1);
  reserve(1);
  return { instanceAccepted, instanceRejected, perUserRejected, expectedInstanceLimit: STREAM_LIMITS.perInstance, expectedPerUserLimit: STREAM_LIMITS.perUser };
}

function aggregateLatencies(latencies) {
  return Object.fromEntries(Object.entries(latencies).map(([operation, values]) => {
    const sorted = [...values].sort((left, right) => left - right);
    return [operation, {
      samples: sorted.length,
      p50Ms: rounded(percentile(sorted, 0.5), 4),
      p95Ms: rounded(percentile(sorted, 0.95), 4),
      p99Ms: rounded(percentile(sorted, 0.99), 4),
    }];
  }));
}

export async function runSyntheticTier(population) {
  if (!SYNTHETIC_TIERS.includes(population)) throw new Error(`Unsupported synthetic tier ${population}.`);
  const totalOperations = population * OPERATIONS_PER_ACTOR;
  const workers = Math.min(MAX_LOCAL_WORKERS, population);
  const sampleStride = Math.max(1, Math.ceil(totalOperations / MAX_TOTAL_LATENCY_SAMPLES));
  const state = new SyntheticKairemaState();
  const latencies = Object.fromEntries(WORKLOAD.map(([name]) => [name, []]));
  const latencySeen = Object.fromEntries(WORKLOAD.map(([name]) => [name, 0]));
  const memoryStart = process.memoryUsage();
  const cpuStart = process.cpuUsage();
  const startedAt = performance.now();
  let cursor = 0;
  let unexpectedErrors = 0;

  const worker = async () => {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= totalOperations) return;
      const actorId = (index % population) + 1;
      const operation = WEIGHTED_WORKLOAD[index % WEIGHTED_WORKLOAD.length];
      const operationName = operation[0];
      const start = performance.now();
      try {
        state.execute(operation, actorId, index);
      } catch {
        unexpectedErrors += 1;
      }
      const durationMs = performance.now() - start;
      latencySeen[operationName] += 1;
      if (latencySeen[operationName] % sampleStride === 0) latencies[operationName].push(durationMs);
      if ((index & 1023) === 1023) await Promise.resolve();
    }
  };
  await Promise.all(Array.from({ length: workers }, () => worker()));
  const durationMs = performance.now() - startedAt;
  const cpu = process.cpuUsage(cpuStart);
  const memoryEnd = process.memoryUsage();
  const saturation = simulateStreamSaturation();
  const latencySummary = aggregateLatencies(latencies);
  const latencyP99Max = Math.max(...Object.values(latencySummary).map((entry) => entry.p99Ms));
  const p99GateMs = population <= 1_000 ? 250 : 1_000;

  return {
    population,
    totalOperations,
    workers,
    durationMs: rounded(durationMs),
    logicalRps: rounded(totalOperations / (durationMs / 1_000)),
    unexpectedErrors,
    p99GateMs,
    p99GatePassed: latencyP99Max <= p99GateMs,
    latency: latencySummary,
    queryModel: { total: state.queryModelCount, byOperation: state.operationQueryCounts, classification: "simulated" },
    storageModel: { logicalBytes: state.logicalStorageBytes, sessions: state.sessions.size, drafts: state.drafts.size, classification: "simulated" },
    logicalMutations: state.logicalMutations,
    idempotencyModel: { duplicateAttempts: state.duplicateAttempts, duplicatesPrevented: state.duplicatesPrevented, classification: "simulated" },
    process: {
      rssDeltaBytes: memoryEnd.rss - memoryStart.rss,
      heapUsedDeltaBytes: memoryEnd.heapUsed - memoryStart.heapUsed,
      cpuUserMicros: cpu.user,
      cpuSystemMicros: cpu.system,
      classification: "local-sandbox-sample",
    },
    saturation,
    network: { guardEnabled: true, blockedAttempts: 0 },
    classification: population >= 10_000 ? "population-measured-concurrency-simulated" : "local-model-measured",
  };
}

export async function runSyntheticBenchmark(tiers = SYNTHETIC_TIERS) {
  return withNoNetworkGuard(async () => {
    const results = [];
    for (const tier of tiers) results.push(await runSyntheticTier(tier));
    return {
      generatedAt: new Date().toISOString(),
      runtime: { node: process.version, platform: process.platform, arch: process.arch },
      guardrails: {
        noNetwork: true,
        realDatabase: false,
        realStorage: false,
        realProviders: false,
        productionRuntimeChanged: false,
      },
      results,
    };
  }).then(({ result, blockedAttempts }) => ({ ...result, networkGuardBlockedAttempts: blockedAttempts }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const tiers = parseTierArgument(process.argv.slice(2));
  const result = await runSyntheticBenchmark(tiers);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
