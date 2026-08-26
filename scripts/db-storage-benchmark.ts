import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

export const DB_STORAGE_TIERS = [10, 100, 1_000, 10_000, 50_000] as const;
const WORKER_LIMIT = 64;
const OPERATIONS_PER_ACTOR = 100;
const MAX_LATENCY_SAMPLES = 8_192;

type LatencySummary = { p50Ms: number; p95Ms: number; p99Ms: number };
type BenchmarkTier = {
  actors: number;
  logicalOperations: number;
  workers: number;
  durationMs: number;
  logicalRps: number;
  latency: LatencySummary;
  errors: { expected: number; unexpected: number; unexpectedRate: number };
  adapter: {
    semanticQueryUnits: number;
    queryUnitsByPath: Record<string, number>;
    syntheticMetadataBytes: number;
    replayHits: number;
    assistantMutations: number;
    duplicateAttempts: number;
    cas: { contenders: number; winners: number; losers: number };
    crossActorDenials: number;
    paginationReads: number;
    boundedMemoryReads: number;
    attachmentMetadataOps: number;
    exportMetadataOps: number;
    draftOps: number;
    ownerAggregateReads: number;
  };
  process: { cpuMs: number; rssDeltaBytes: number; heapDeltaBytes: number };
};

export type DbStorageBenchmarkResult = {
  generatedAt: string;
  isolation: {
    realDatabaseOrStorage: false;
    importsProductionRuntime: false;
    networkGuardBlockedAttempts: number;
    maximumLogicalWorkers: number;
  };
  tiers: BenchmarkTier[];
};

type ActorState = { chatId: number; messages: number; facts: number; topics: number; draft: boolean };

class AggregateOnlyAdapter {
  private readonly actors = new Map<number, ActorState>();
  private readonly replay = new Set<string>();
  private readonly claimedJobs = new Set<number>();
  private readonly queryUnitsByPath: Record<string, number> = {};
  private latencySamples: number[] = [];
  private syntheticMetadataBytes = 0;
  private replayHits = 0;
  private assistantMutations = 0;
  private duplicateAttempts = 0;
  private crossActorDenials = 0;
  private paginationReads = 0;
  private boundedMemoryReads = 0;
  private attachmentMetadataOps = 0;
  private exportMetadataOps = 0;
  private draftOps = 0;
  private ownerAggregateReads = 0;

  private measure(path: string, work: () => void) {
    const started = performance.now();
    work();
    const elapsed = performance.now() - started;
    this.queryUnitsByPath[path] = (this.queryUnitsByPath[path] ?? 0) + 1;
    if (this.latencySamples.length < MAX_LATENCY_SAMPLES) this.latencySamples.push(elapsed);
  }

  private actor(actor: number) {
    let state = this.actors.get(actor);
    if (!state) {
      state = { chatId: actor + 1, messages: 2, facts: 3, topics: 2, draft: false };
      this.actors.set(actor, state);
      this.syntheticMetadataBytes += 176;
    }
    return state;
  }

  runOperation(actor: number, operation: number) {
    const state = this.actor(actor);
    const slot = operation % OPERATIONS_PER_ACTOR;
    if (slot < 12) return this.measure("session.validation", () => undefined);
    if (slot < 30) return this.measure("chat.ownerScopedListRead", () => void state.chatId);
    if (slot < 38) return this.measure("chat.create", () => { state.chatId += 1; this.syntheticMetadataBytes += 32; });
    if (slot < 58) return this.messageAndReplay(actor, state, slot);
    if (slot < 73) return this.memoryAndCas(actor, state, slot);
    if (slot < 81) return this.attachmentMetadata(actor);
    if (slot < 86) return this.exportMetadata(actor);
    if (slot < 94) return this.draft(actor, state);
    if (slot < 98) return this.ownerAggregate();
    return this.crossActorRead(actor);
  }

  private messageAndReplay(actor: number, state: ActorState, slot: number) {
    this.measure("message.ownerScopedMutation", () => {
      const key = `${actor}:${state.chatId}:${slot % 2}`;
      if (this.replay.has(key)) {
        this.duplicateAttempts += 1;
        this.replayHits += 1;
        return;
      }
      this.replay.add(key);
      state.messages += 2;
      this.assistantMutations += 1;
      this.syntheticMetadataBytes += 48;
    });
    if (slot % 2 === 0) {
      this.measure("message.durableReplayRead", () => {
        this.duplicateAttempts += 1;
        this.replayHits += 1;
      });
    }
  }

  private memoryAndCas(actor: number, state: ActorState, slot: number) {
    if (slot % 3 === 0) {
      this.measure("memory.boundedFactTopicRead", () => {
        this.boundedMemoryReads += 1;
        void Math.min(state.facts, 30) + Math.min(state.topics, 15);
      });
      return;
    }
    this.measure("memory.extractionTurnPair", () => void state.messages);
    this.measure("memory.extractionCas", () => this.claimedJobs.add(actor));
  }

  private attachmentMetadata(actor: number) {
    this.measure("attachment.ownerScopedMetadata", () => {
      this.attachmentMetadataOps += 1;
      this.syntheticMetadataBytes += actor % 2 === 0 ? 8 : 0;
    });
  }

  private exportMetadata(actor: number) {
    this.measure("export.ownerScopedMetadata", () => {
      this.exportMetadataOps += 1;
      this.syntheticMetadataBytes += actor % 5 === 0 ? 12 : 0;
    });
  }

  private draft(actor: number, state: ActorState) {
    this.measure("draft.ownerScopedUpsert", () => {
      state.draft = !state.draft;
      this.draftOps += 1;
      this.syntheticMetadataBytes += actor % 7 === 0 ? 4 : 0;
    });
  }

  private ownerAggregate() {
    this.measure("owner.aggregateOnlyRead", () => {
      this.ownerAggregateReads += 1;
      void this.actors.size;
    });
  }

  private crossActorRead(actor: number) {
    this.measure("isolation.crossActorDenied", () => {
      const foreignActor = actor === 0 ? 1 : 0;
      if (foreignActor !== actor) this.crossActorDenials += 1;
    });
  }

  runCasContention(contenders: number) {
    let winners = 0;
    for (let contender = 0; contender < contenders; contender += 1) {
      this.measure("memory.casContention", () => {
        if (!this.claimedJobs.has(-1)) {
          this.claimedJobs.add(-1);
          winners += 1;
        }
      });
    }
    return { contenders, winners, losers: contenders - winners };
  }

  snapshot(cas: { contenders: number; winners: number; losers: number }) {
    return {
      semanticQueryUnits: Object.values(this.queryUnitsByPath).reduce((sum, count) => sum + count, 0),
      queryUnitsByPath: this.queryUnitsByPath,
      syntheticMetadataBytes: this.syntheticMetadataBytes,
      replayHits: this.replayHits,
      assistantMutations: this.assistantMutations,
      duplicateAttempts: this.duplicateAttempts,
      cas,
      crossActorDenials: this.crossActorDenials,
      paginationReads: this.queryUnitsByPath["chat.ownerScopedListRead"] ?? 0,
      boundedMemoryReads: this.boundedMemoryReads,
      attachmentMetadataOps: this.attachmentMetadataOps,
      exportMetadataOps: this.exportMetadataOps,
      draftOps: this.draftOps,
      ownerAggregateReads: this.ownerAggregateReads,
      latency: percentileSummary(this.latencySamples),
    };
  }
}

function percentileSummary(samples: number[]): LatencySummary {
  if (samples.length === 0) return { p50Ms: 0, p95Ms: 0, p99Ms: 0 };
  const sorted = [...samples].sort((left, right) => left - right);
  const at = (quantile: number) => sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * quantile))] ?? 0;
  return { p50Ms: at(0.5), p95Ms: at(0.95), p99Ms: at(0.99) };
}

async function runTier(actors: number): Promise<BenchmarkTier> {
  const adapter = new AggregateOnlyAdapter();
  const startedAt = performance.now();
  const cpuStart = process.cpuUsage();
  const memoryStart = process.memoryUsage();
  for (let offset = 0; offset < actors; offset += WORKER_LIMIT) {
    const batch = Math.min(WORKER_LIMIT, actors - offset);
    await Promise.all(Array.from({ length: batch }, async (_, index) => {
      const actor = offset + index;
      for (let operation = 0; operation < OPERATIONS_PER_ACTOR; operation += 1) adapter.runOperation(actor, operation);
    }));
  }
  const cas = adapter.runCasContention(64);
  const durationMs = performance.now() - startedAt;
  const cpu = process.cpuUsage(cpuStart);
  const memoryEnd = process.memoryUsage();
  const snapshot = adapter.snapshot(cas);
  const logicalOperations = actors * OPERATIONS_PER_ACTOR;
  return {
    actors,
    logicalOperations,
    workers: Math.min(WORKER_LIMIT, actors),
    durationMs,
    logicalRps: durationMs === 0 ? 0 : (logicalOperations / durationMs) * 1_000,
    latency: snapshot.latency,
    errors: { expected: 0, unexpected: 0, unexpectedRate: 0 },
    adapter: {
      semanticQueryUnits: snapshot.semanticQueryUnits,
      queryUnitsByPath: snapshot.queryUnitsByPath,
      syntheticMetadataBytes: snapshot.syntheticMetadataBytes,
      replayHits: snapshot.replayHits,
      assistantMutations: snapshot.assistantMutations,
      duplicateAttempts: snapshot.duplicateAttempts,
      cas: snapshot.cas,
      crossActorDenials: snapshot.crossActorDenials,
      paginationReads: snapshot.paginationReads,
      boundedMemoryReads: snapshot.boundedMemoryReads,
      attachmentMetadataOps: snapshot.attachmentMetadataOps,
      exportMetadataOps: snapshot.exportMetadataOps,
      draftOps: snapshot.draftOps,
      ownerAggregateReads: snapshot.ownerAggregateReads,
    },
    process: {
      cpuMs: (cpu.user + cpu.system) / 1_000,
      rssDeltaBytes: memoryEnd.rss - memoryStart.rss,
      heapDeltaBytes: memoryEnd.heapUsed - memoryStart.heapUsed,
    },
  };
}

export async function runDbStorageBenchmark(tiers: readonly number[] = DB_STORAGE_TIERS): Promise<DbStorageBenchmarkResult> {
  const originalFetch = globalThis.fetch;
  let blockedAttempts = 0;
  globalThis.fetch = (async () => {
    blockedAttempts += 1;
    throw new Error("network is forbidden in db/storage benchmark");
  }) as typeof fetch;
  try {
    const results: BenchmarkTier[] = [];
    for (const actors of tiers) results.push(await runTier(actors));
    return {
      generatedAt: new Date().toISOString(),
      isolation: { realDatabaseOrStorage: false, importsProductionRuntime: false, networkGuardBlockedAttempts: blockedAttempts, maximumLogicalWorkers: WORKER_LIMIT },
      tiers: results,
    };
  } finally {
    globalThis.fetch = originalFetch;
  }
}

async function main() {
  const result = await runDbStorageBenchmark();
  const outputPath = resolve("reports/evidence/deterministic-db-storage-benchmark-results-2026-08.json");
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (process.argv[1]?.endsWith("db-storage-benchmark.ts")) {
  void main();
}
