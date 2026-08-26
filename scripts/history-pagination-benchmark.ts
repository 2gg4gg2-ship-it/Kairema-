import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  decodeHistoryPageCursor,
  encodeHistoryPageCursor,
  HISTORY_PAGE_DEFAULT_LIMIT,
  normalizeHistoryPageLimit,
} from "../server/history-pagination";

type SyntheticMessage = { id: number; createdAt: number };

type LatencySummary = { p50Ms: number; p95Ms: number; p99Ms: number };

type TierResult = {
  historyRecords: number;
  iterations: number;
  pageLimit: number;
  legacy: {
    resultRecords: number;
    metadataBytes: number;
    p50Ms: number;
    p95Ms: number;
    p99Ms: number;
    logicalRecordsReturned: number;
  };
  paged: {
    firstPageRecords: number;
    nextPageRecords: number;
    pagePairMetadataBytes: number;
    p50Ms: number;
    p95Ms: number;
    p99Ms: number;
    logicalRecordsReturned: number;
    binarySearchComparisonsPerNextPage: number;
  };
  boundedResponseRatio: number;
  rssDeltaBytes: number;
  cpuMs: number;
};

export type HistoryPaginationBenchmarkResult = {
  generatedAt: string;
  scope: "isolated-in-memory-simulation";
  networkGuardBlockedAttempts: number;
  pageLimit: number;
  tiers: TierResult[];
  notes: string[];
};

const BENCHMARK_SECRET = "history-pagination-benchmark-secret";
const BENCHMARK_SESSION_ID = "synthetic-session";
const TIER_SIZES = [100, 1_000, 10_000, 50_000];
const ITERATIONS = 200;

function percentile(samples: number[], percentileValue: number) {
  if (samples.length === 0) return 0;
  const ordered = [...samples].sort((left, right) => left - right);
  const index = Math.min(ordered.length - 1, Math.max(0, Math.ceil((percentileValue / 100) * ordered.length) - 1));
  return ordered[index];
}

function summarize(samples: number[]): LatencySummary {
  return { p50Ms: percentile(samples, 50), p95Ms: percentile(samples, 95), p99Ms: percentile(samples, 99) };
}

function createSyntheticHistory(size: number): SyntheticMessage[] {
  const now = 1_780_000_000_000;
  return Array.from({ length: size }, (_, index) => ({
    id: size - index,
    createdAt: now - index,
  }));
}

/** Models an index-directed legacy full-history result without importing production DB code. */
function legacyFullHistory(recordsNewestFirst: SyntheticMessage[]) {
  return [...recordsNewestFirst].reverse();
}

/**
 * Returns an older page from a descending synthetic index. The comparison count is a model of
 * seek work, not a database execution statistic; no data-store is queried by this benchmark.
 */
function olderPage(recordsNewestFirst: SyntheticMessage[], cursor: { createdAt: number; id: number } | null, limit: number) {
  if (!cursor) return { messages: recordsNewestFirst.slice(0, limit), comparisons: 0 };
  let left = 0;
  let right = recordsNewestFirst.length;
  let comparisons = 0;
  while (left < right) {
    const middle = Math.floor((left + right) / 2);
    const candidate = recordsNewestFirst[middle];
    comparisons += 1;
    const isOlder = candidate.createdAt < cursor.createdAt || (candidate.createdAt === cursor.createdAt && candidate.id < cursor.id);
    if (isOlder) right = middle;
    else left = middle + 1;
  }
  return { messages: recordsNewestFirst.slice(left, left + limit), comparisons };
}

function metadataBytes(records: SyntheticMessage[]) {
  return Buffer.byteLength(JSON.stringify(records), "utf8");
}

export function runHistoryPaginationBenchmark(): HistoryPaginationBenchmarkResult {
  const originalFetch = globalThis.fetch;
  let networkGuardBlockedAttempts = 0;
  globalThis.fetch = (async () => {
    networkGuardBlockedAttempts += 1;
    throw new Error("Network access is forbidden in history-pagination benchmark");
  }) as typeof fetch;

  try {
    const pageLimit = normalizeHistoryPageLimit(HISTORY_PAGE_DEFAULT_LIMIT);
    const tiers: TierResult[] = TIER_SIZES.map((historyRecords) => {
      const records = createSyntheticHistory(historyRecords);
      const rssBefore = process.memoryUsage().rss;
      const cpuBefore = process.cpuUsage();
      const legacySamples: number[] = [];
      const pageSamples: number[] = [];
      let comparisons = 0;
      let legacyReturned = 0;
      let pagedReturned = 0;

      for (let iteration = 0; iteration < ITERATIONS; iteration += 1) {
        const legacyStarted = performance.now();
        const legacy = legacyFullHistory(records);
        legacySamples.push(performance.now() - legacyStarted);
        legacyReturned += legacy.length;

        const pageStarted = performance.now();
        const first = olderPage(records, null, pageLimit);
        const firstOldest = first.messages.at(-1);
        const cursor = firstOldest ? encodeHistoryPageCursor(BENCHMARK_SECRET, BENCHMARK_SESSION_ID, firstOldest) : null;
        const decoded = cursor ? decodeHistoryPageCursor(BENCHMARK_SECRET, BENCHMARK_SESSION_ID, cursor) : null;
        const next = olderPage(records, decoded, pageLimit);
        pageSamples.push(performance.now() - pageStarted);
        comparisons += next.comparisons;
        pagedReturned += first.messages.length + next.messages.length;
      }

      const legacy = legacyFullHistory(records);
      const first = olderPage(records, null, pageLimit);
      const firstOldest = first.messages.at(-1);
      const cursor = firstOldest ? encodeHistoryPageCursor(BENCHMARK_SECRET, BENCHMARK_SESSION_ID, firstOldest) : null;
      const next = olderPage(records, cursor ? decodeHistoryPageCursor(BENCHMARK_SECRET, BENCHMARK_SESSION_ID, cursor) : null, pageLimit);
      const cpuUsed = process.cpuUsage(cpuBefore);
      const legacyLatency = summarize(legacySamples);
      const pageLatency = summarize(pageSamples);
      const pagePairBytes = metadataBytes([...first.messages, ...next.messages]);
      const legacyBytes = metadataBytes(legacy);

      return {
        historyRecords,
        iterations: ITERATIONS,
        pageLimit,
        legacy: {
          resultRecords: legacy.length,
          metadataBytes: legacyBytes,
          logicalRecordsReturned: legacyReturned,
          ...legacyLatency,
        },
        paged: {
          firstPageRecords: first.messages.length,
          nextPageRecords: next.messages.length,
          pagePairMetadataBytes: pagePairBytes,
          logicalRecordsReturned: pagedReturned,
          binarySearchComparisonsPerNextPage: ITERATIONS === 0 ? 0 : comparisons / ITERATIONS,
          ...pageLatency,
        },
        boundedResponseRatio: legacy.length === 0 ? 1 : (first.messages.length + next.messages.length) / legacy.length,
        rssDeltaBytes: process.memoryUsage().rss - rssBefore,
        cpuMs: (cpuUsed.user + cpuUsed.system) / 1_000,
      };
    });

    return {
      generatedAt: new Date().toISOString(),
      scope: "isolated-in-memory-simulation",
      networkGuardBlockedAttempts,
      pageLimit,
      tiers,
      notes: [
        "Synthetic records contain only numeric id/createdAt metadata; no user data, DB, S3, router, provider or external network is imported.",
        "Latency/RSS/CPU are local process measurements of this model, not production DB, storage, network, socket or LLM metrics.",
        "The paged model performs two 60-record pages (or fewer at end); legacy model returns the whole synthetic history.",
      ],
    };
  } finally {
    globalThis.fetch = originalFetch;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const result = runHistoryPaginationBenchmark();
  const outputPath = resolve("reports/evidence/history-pagination-benchmark-results-2026-08.json");
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify(result)}\n`);
}
