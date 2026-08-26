import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath, pathToFileURL } from "node:url";
import { selectTranscriptWindow, TRANSCRIPT_WINDOW_BUDGETS, type TranscriptMessage, type TranscriptRole } from "../server/transcript-window";

type LatencySummary = { p50Ms: number; p95Ms: number; p99Ms: number };
type PathMetrics = {
  queryCountProxy: number;
  recordReadsProxy: number;
  selectedMessages: number;
  selectedContentChars: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
};
type RoleResult = {
  role: TranscriptRole;
  budget: typeof TRANSCRIPT_WINDOW_BUDGETS[TranscriptRole];
  legacyFullHistory: PathMetrics;
  boundedTranscript: PathMetrics & { candidateMessages: number; selectedPriorTurns: number; truncated: boolean };
  selectedRecordRatio: number;
  selectedCharacterRatio: number;
  rssDeltaBytes: number;
  cpuMs: number;
};
type TierResult = { historyRecords: number; iterations: number; roles: RoleResult[] };

export type TranscriptWindowBenchmarkResult = {
  generatedAt: string;
  scope: "isolated-in-memory-simulation";
  networkGuardBlockedAttempts: number;
  tiers: TierResult[];
  notes: string[];
};

const HISTORY_SIZES = [100, 1_000, 10_000, 50_000];
const ITERATIONS = 100;
const ROLES: TranscriptRole[] = ["fast", "smart", "context", "flagship"];

function percentile(samples: number[], percentileValue: number) {
  const ordered = [...samples].sort((left, right) => left - right);
  if (ordered.length === 0) return 0;
  return ordered[Math.min(ordered.length - 1, Math.max(0, Math.ceil((percentileValue / 100) * ordered.length) - 1))]!;
}

function summarize(samples: number[]): LatencySummary {
  return { p50Ms: percentile(samples, 50), p95Ms: percentile(samples, 95), p99Ms: percentile(samples, 99) };
}

function createSyntheticHistory(size: number): TranscriptMessage[] {
  const epoch = 1_780_000_000_000;
  return Array.from({ length: size }, (_, index) => {
    const id = index + 1;
    const length = id === size ? 1_200 : 80 + ((id * 37) % 241);
    return {
      id,
      createdAt: new Date(epoch + id),
      role: id === size ? "user" : id % 2 === 0 ? "assistant" : "user",
      content: "x".repeat(length),
    };
  });
}

/** Models the current pre-policy LLM context handoff: one full ordered history result. */
function legacyFullHistory(records: readonly TranscriptMessage[]) {
  const messages = [...records];
  return { messages, selectedContentChars: messages.reduce((total, message) => total + message.content.length, 0) };
}

/** Models the exact bounded DB candidate result: newest descending LIMIT, then chronological selector input. */
function boundedCandidates(records: readonly TranscriptMessage[], role: TranscriptRole) {
  return records.slice(-TRANSCRIPT_WINDOW_BUDGETS[role].maxCandidateMessages);
}

function benchmarkRole(records: readonly TranscriptMessage[], role: TranscriptRole): RoleResult {
  const rssBefore = process.memoryUsage().rss;
  const cpuBefore = process.cpuUsage();
  const legacySamples: number[] = [];
  const boundedSamples: number[] = [];
  let legacy: ReturnType<typeof legacyFullHistory> = { messages: [], selectedContentChars: 0 };
  let bounded = selectTranscriptWindow(role, []);
  let candidates: TranscriptMessage[] = [];

  for (let iteration = 0; iteration < ITERATIONS; iteration += 1) {
    const legacyStarted = performance.now();
    legacy = legacyFullHistory(records);
    legacySamples.push(performance.now() - legacyStarted);

    const boundedStarted = performance.now();
    candidates = boundedCandidates(records, role);
    bounded = selectTranscriptWindow(role, candidates);
    boundedSamples.push(performance.now() - boundedStarted);
  }

  const cpuUsed = process.cpuUsage(cpuBefore);
  const legacyLatency = summarize(legacySamples);
  const boundedLatency = summarize(boundedSamples);
  return {
    role,
    budget: TRANSCRIPT_WINDOW_BUDGETS[role],
    legacyFullHistory: {
      queryCountProxy: 1,
      recordReadsProxy: records.length,
      selectedMessages: legacy.messages.length,
      selectedContentChars: legacy.selectedContentChars,
      ...legacyLatency,
    },
    boundedTranscript: {
      queryCountProxy: 1,
      recordReadsProxy: candidates.length,
      candidateMessages: candidates.length,
      selectedMessages: bounded.messages.length,
      selectedContentChars: bounded.selectedContentChars,
      selectedPriorTurns: bounded.selectedPriorTurns,
      truncated: bounded.truncated,
      ...boundedLatency,
    },
    selectedRecordRatio: records.length === 0 ? 1 : bounded.messages.length / records.length,
    selectedCharacterRatio: legacy.selectedContentChars === 0 ? 1 : bounded.selectedContentChars / legacy.selectedContentChars,
    rssDeltaBytes: process.memoryUsage().rss - rssBefore,
    cpuMs: (cpuUsed.user + cpuUsed.system) / 1_000,
  };
}

export function runTranscriptWindowBenchmark(): TranscriptWindowBenchmarkResult {
  const originalFetch = globalThis.fetch;
  let networkGuardBlockedAttempts = 0;
  globalThis.fetch = (async () => {
    networkGuardBlockedAttempts += 1;
    throw new Error("Network access is forbidden in transcript-window benchmark");
  }) as typeof fetch;

  try {
    return {
      generatedAt: new Date().toISOString(),
      scope: "isolated-in-memory-simulation",
      networkGuardBlockedAttempts,
      tiers: HISTORY_SIZES.map((historyRecords) => {
        const records = createSyntheticHistory(historyRecords);
        return { historyRecords, iterations: ITERATIONS, roles: ROLES.map((role) => benchmarkRole(records, role)) };
      }),
      notes: [
        "Synthetic messages contain only generated role/id/timestamp/text-length content; no user data, database, storage, router, provider or external network is imported.",
        "Both paths use one query-count proxy. Record-read and latency figures model full ordered result versus a descending bounded candidate result plus the production pure selector; they are not TiDB EXPLAIN, production runtime, socket, provider or LLM measurements.",
        "RSS and CPU are local-process samples for this isolated model and are intentionally not production capacity evidence for 10K/50K users.",
      ],
    };
  } finally {
    globalThis.fetch = originalFetch;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const result = runTranscriptWindowBenchmark();
  const outputPath = resolve("reports/evidence/transcript-window-benchmark-results-2026-08.json");
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify(result)}\n`);
}
