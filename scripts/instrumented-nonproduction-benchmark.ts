import { EventEmitter } from "node:events";
import { performance } from "node:perf_hooks";
import { pathToFileURL } from "node:url";
import type { Request, Response } from "express";
import { MAX_LOCAL_WORKERS, OPERATIONS_PER_ACTOR, STREAM_LIMITS, SYNTHETIC_TIERS, withNoNetworkGuard } from "./synthetic-load-benchmark.mjs";

type ErrorClass = "none" | "bad_request" | "rate_limited" | "capacity" | "handler_error";
type LatencySummary = { samples: number; p50Ms: number; p95Ms: number; p99Ms: number };
type InMemoryMessage = { id: number; role: "user" | "assistant"; content: string; modelId?: string; metadata?: string; clientMessageId?: string };

const WORKLOAD = Object.freeze([
  ["session_validation", 12], ["chat_list_read", 18], ["chat_create", 8], ["message_ingress_mutation", 20], ["memory_read_extraction", 15],
  ["attachment_metadata", 8], ["export_history_create", 5], ["drafts", 8], ["owner_aggregate_metrics", 2], ["duplicate_retry", 4],
] as const);
const WEIGHTED_WORKLOAD = WORKLOAD.flatMap(([name, weight]) => Array.from({ length: weight }, () => name));
const MAX_REAL_HANDLER_DISPATCHES = 2_000;

function rounded(value: number, digits = 3) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function percentile(values: number[], ratio: number) {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1))]!;
}

function summarize(values: number[]): LatencySummary {
  return { samples: values.length, p50Ms: rounded(percentile(values, 0.5), 4), p95Ms: rounded(percentile(values, 0.95), 4), p99Ms: rounded(percentile(values, 0.99), 4) };
}

function syntheticUuid(number: number) { return `00000000-0000-4000-8000-${number.toString(16).padStart(12, "0").slice(-12)}`; }
function sessionIdFor(userId: number) { return syntheticUuid(userId); }
function clientMessageIdFor(sequence: number) { return syntheticUuid(1_000_000 + sequence); }

class MetadataTelemetry {
  activeSyntheticSessions = 0;
  maxActiveSyntheticSessions = 0;
  activeRequests = 0;
  maxConcurrentRequests = 0;
  activeSseStreams = 0;
  maxActiveSseStreams = 0;
  totalSseEvents = 0;
  totalSseBytes = 0;
  quotaCalls = 0;
  quotaDenied = 0;
  replayHits = 0;
  memoryEnqueued = 0;
  memoryProcessed = 0;
  paginationReads = 0;
  boundedMemoryReads = 0;
  attachmentMetadataReads = 0;
  exportMetadataCreates = 0;
  draftWrites = 0;
  ownerAggregateReads = 0;
  assistantMutations = 0;
  errorClasses: Record<ErrorClass, number> = { none: 0, bad_request: 0, rate_limited: 0, capacity: 0, handler_error: 0 };
  requestLatencies: number[] = [];
  adapterLatencies: number[] = [];

  beginRequest() { this.activeRequests += 1; this.maxConcurrentRequests = Math.max(this.maxConcurrentRequests, this.activeRequests); }
  endRequest() { this.activeRequests = Math.max(0, this.activeRequests - 1); }
  beginSse() { this.activeSseStreams += 1; this.maxActiveSseStreams = Math.max(this.maxActiveSseStreams, this.activeSseStreams); }
  endSse() { this.activeSseStreams = Math.max(0, this.activeSseStreams - 1); }
  beginSession() { this.activeSyntheticSessions += 1; this.maxActiveSyntheticSessions = Math.max(this.maxActiveSyntheticSessions, this.activeSyntheticSessions); }
  endSession() { this.activeSyntheticSessions = Math.max(0, this.activeSyntheticSessions - 1); }
}

class SyntheticResponse extends EventEmitter {
  statusCode = 200;
  closed = false;
  readonly telemetry: MetadataTelemetry;

  constructor(telemetry: MetadataTelemetry) { super(); this.telemetry = telemetry; }
  status(code: number) { this.statusCode = code; return this; }
  set(_value: unknown) { return this; }
  flushHeaders() { return undefined; }
  write(chunk: unknown) { this.telemetry.totalSseEvents += 1; this.telemetry.totalSseBytes += Buffer.byteLength(String(chunk)); return true; }
  end() { this.closed = true; return this; }
  json(_body: unknown) { this.closed = true; return this; }
}

class InMemoryApplicationRepository {
  private nextMessageId = 1;
  private readonly messagesBySession = new Map<string, InMemoryMessage[]>();
  private readonly clientMessages = new Map<string, InMemoryMessage>();
  private readonly assistantByClientKey = new Map<string, InMemoryMessage>();
  private readonly quotaWindows = new Map<number, { startedAt: number; requests: number }>();
  private readonly drafts = new Map<string, number>();
  readonly telemetry: MetadataTelemetry;

  constructor(telemetry: MetadataTelemetry) { this.telemetry = telemetry; }
  private key(userId: number, sessionId: string, clientMessageId: string) { return `${userId}:${sessionId}:${clientMessageId}`; }
  private sessionMessages(sessionId: string) { const existing = this.messagesBySession.get(sessionId); if (existing) return existing; const created: InMemoryMessage[] = []; this.messagesBySession.set(sessionId, created); return created; }

  validateSession(userId: number) { return this.serialize({ authenticated: true, userScope: `synthetic-${userId % 16}` }); }
  createChat(userId: number) { return this.serialize({ id: sessionIdFor(userId), title: "Synthetic", ownerScoped: true }); }
  listChatsPaged(userId: number) { this.telemetry.paginationReads += 1; return this.serialize({ items: [{ id: sessionIdFor(userId), title: "Synthetic" }], nextCursor: null, limit: 20 }); }
  readBoundedMemory(_userId: number) { this.telemetry.boundedMemoryReads += 1; return this.serialize({ facts: 30, topics: 15, bounded: true }); }
  attachmentMetadata(_userId: number) { this.telemetry.attachmentMetadataReads += 1; return this.serialize({ count: 1, ownerScoped: true, hasBytes: false }); }
  createExportMetadata(_userId: number) { this.telemetry.exportMetadataCreates += 1; return this.serialize({ state: "created", ownerScoped: true, artifactWritten: false }); }
  writeDraft(_userId: number, sessionId: string) { this.telemetry.draftWrites += 1; this.drafts.set(sessionId, 1); return this.serialize({ saved: true, ownerScoped: true }); }
  ownerAggregate() { this.telemetry.ownerAggregateReads += 1; return this.serialize({ active: this.telemetry.activeRequests, aggregateOnly: true }); }
  serialize<T>(dto: T): T { return JSON.parse(JSON.stringify(dto)) as T; }

  async getOwnedChatSession(_userId: number, sessionId: string) { return { id: sessionId, title: "Synthetic" }; }
  async getStoredAssistantForClientMessage(userId: number, sessionId: string, clientMessageId: string) { return this.assistantByClientKey.get(this.key(userId, sessionId, clientMessageId)); }
  async appendChatMessage(userId: number, sessionId: string, role: "user" | "assistant", content: string, modelId?: string, metadata?: string, clientMessageId?: string) {
    const session = this.sessionMessages(sessionId);
    if (role === "user" && clientMessageId) {
      const key = this.key(userId, sessionId, clientMessageId);
      const existing = this.clientMessages.get(key);
      if (existing) return { id: existing.id, created: false };
      const message: InMemoryMessage = { id: this.nextMessageId++, role, content, modelId, metadata, clientMessageId };
      this.clientMessages.set(key, message); session.push(message); return { id: message.id, created: true };
    }
    const message: InMemoryMessage = { id: this.nextMessageId++, role, content, modelId, metadata };
    session.push(message);
    if (role === "assistant") {
      this.telemetry.assistantMutations += 1;
      const currentUser = [...session].reverse().find((entry) => entry.role === "user" && entry.clientMessageId);
      if (currentUser?.clientMessageId) this.assistantByClientKey.set(this.key(userId, sessionId, currentUser.clientMessageId), message);
    }
    if (session.length > 8) session.splice(0, session.length - 8);
    return { id: message.id, created: true };
  }
  async updateChatTitle() { return undefined; }
  async listSessionMessages(_userId: number, sessionId: string) { return this.sessionMessages(sessionId).slice(-4).map(({ role, content }) => ({ role, content })); }
  async buildChatContext(userId: number) { this.readBoundedMemory(userId); return { style: "default" as const, responseLength: "normal" as const, quickReplies: false, effort: "standard" as const, thinking: false }; }
  async consumeQuota(userId: number, limit: number, windowMs: number) {
    this.telemetry.quotaCalls += 1;
    const now = Date.now(); const current = this.quotaWindows.get(userId);
    const window = !current || now - current.startedAt >= windowMs ? { startedAt: now, requests: 0 } : current;
    window.requests += 1; this.quotaWindows.set(userId, window);
    if (window.requests <= limit) return { allowed: true, retryAfterSeconds: 0 };
    this.telemetry.quotaDenied += 1;
    return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((windowMs - (now - window.startedAt)) / 1_000)) };
  }
  async enqueueMemoryExtractionJob() { this.telemetry.memoryEnqueued += 1; return { created: true }; }
  async processMemoryExtractionJob() { this.telemetry.memoryProcessed += 1; return undefined; }
}

function errorClassFromStatus(statusCode: number): ErrorClass {
  if (statusCode === 429) return "rate_limited";
  if (statusCode === 503) return "capacity";
  if (statusCode >= 400) return "bad_request";
  return "none";
}

async function mapBounded<T>(items: T[], concurrency: number, execute: (item: T, index: number) => Promise<void>) {
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (true) { const index = cursor; cursor += 1; if (index >= items.length) return; await execute(items[index]!, index); }
  }));
}

async function loadChatHandler() {
  const originalInfo = console.info;
  try {
    // The server module emits initialization metadata on import; benchmark raw evidence must remain JSON-only.
    console.info = () => undefined;
    return await import("../server/chat-stream");
  } finally { console.info = originalInfo; }
}

export async function runInstrumentedTier(population: number) {
  if (!SYNTHETIC_TIERS.includes(population)) throw new Error(`Unsupported instrumented tier ${population}.`);
  const { createChatStreamHandler, resetChatStreamRateLimits } = await loadChatHandler();
  resetChatStreamRateLimits();
  const telemetry = new MetadataTelemetry();
  const repository = new InMemoryApplicationRepository(telemetry);
  const providerStub = async (_role: unknown, _history: unknown, _settings: unknown, onDelta: (value: string) => void) => {
    telemetry.beginSse();
    try { await new Promise<void>((resolve) => setImmediate(resolve)); onDelta("s"); return { content: "synthetic", modelUsed: "synthetic", provider: "synthetic", label: "Synthetic" }; }
    finally { telemetry.endSse(); }
  };
  const handler = createChatStreamHandler({
    authenticateRequest: async (request: Request) => ({ id: Number(request.headers?.["x-synthetic-user"] ?? 1) }), getOwnedChatSession: repository.getOwnedChatSession.bind(repository),
    getStoredAssistantForClientMessage: repository.getStoredAssistantForClientMessage.bind(repository), appendChatMessage: repository.appendChatMessage.bind(repository),
    updateChatTitle: repository.updateChatTitle.bind(repository), listSessionMessages: repository.listSessionMessages.bind(repository),
    buildChatContext: repository.buildChatContext.bind(repository), consumeChatStreamRequestQuota: repository.consumeQuota.bind(repository),
    enqueueMemoryExtractionJob: repository.enqueueMemoryExtractionJob.bind(repository), processMemoryExtractionJob: repository.processMemoryExtractionJob.bind(repository),
    chatWithRoleStream: providerStub as never, auditChatStream: () => undefined,
  });
  const invoke = async (userId: number, clientMessageId: string, isDuplicate = false) => {
    const started = performance.now(); telemetry.beginRequest(); telemetry.beginSession();
    try {
      const response = new SyntheticResponse(telemetry);
      const assistantMutationsBefore = telemetry.assistantMutations;
      await handler({ headers: { "x-synthetic-user": String(userId) }, body: { sessionId: sessionIdFor(userId), modelId: "fast", content: "synthetic", clientMessageId } } as unknown as Request, response as unknown as Response, (() => undefined) as never);
      const errorClass = errorClassFromStatus(response.statusCode); telemetry.errorClasses[errorClass] += 1;
      if (isDuplicate && response.statusCode === 200 && telemetry.assistantMutations === assistantMutationsBefore) telemetry.replayHits += 1;
      return response.statusCode;
    } catch { telemetry.errorClasses.handler_error += 1; return 500; }
    finally { telemetry.requestLatencies.push(performance.now() - started); telemetry.endSession(); telemetry.endRequest(); }
  };
  const totalOperations = population * OPERATIONS_PER_ACTOR;
  const workers = Math.min(MAX_LOCAL_WORKERS, population);
  const handlerDispatches = Math.min(MAX_REAL_HANDLER_DISPATCHES, Math.max(20, population));
  const memoryStart = process.memoryUsage(); const cpuStart = process.cpuUsage(); const started = performance.now();
  let adapterCursor = 0;
  const adapterWorker = async () => {
    while (true) {
      const index = adapterCursor; adapterCursor += 1; if (index >= totalOperations) return;
      const userId = (index % population) + 1; const operation = WEIGHTED_WORKLOAD[index % WEIGHTED_WORKLOAD.length]!; const operationStart = performance.now();
      if (operation === "session_validation") repository.validateSession(userId);
      else if (operation === "chat_list_read") repository.listChatsPaged(userId);
      else if (operation === "chat_create") repository.createChat(userId);
      else if (operation === "memory_read_extraction") repository.readBoundedMemory(userId);
      else if (operation === "attachment_metadata") repository.attachmentMetadata(userId);
      else if (operation === "export_history_create") repository.createExportMetadata(userId);
      else if (operation === "drafts") repository.writeDraft(userId, sessionIdFor(userId));
      else if (operation === "owner_aggregate_metrics") repository.ownerAggregate();
      telemetry.adapterLatencies.push(performance.now() - operationStart);
      if ((index & 1023) === 1023) await Promise.resolve();
    }
  };
  await Promise.all(Array.from({ length: workers }, () => adapterWorker()));
  const pairCount = Math.floor(handlerDispatches / 2);
  await mapBounded(Array.from({ length: pairCount }, (_, index) => index), workers, async (index) => {
    const userId = (index % population) + 1; const original = clientMessageIdFor(index * 2);
    await invoke(userId, original); await invoke(userId, original, true);
  });
  const durationMs = performance.now() - started; const cpu = process.cpuUsage(cpuStart); const memoryEnd = process.memoryUsage();
  const p99 = Math.max(summarize(telemetry.requestLatencies).p99Ms, summarize(telemetry.adapterLatencies).p99Ms);
  return {
    population, logicalWorkloadOperations: totalOperations, actualHandlerDispatches: pairCount * 2, adapterOperations: totalOperations, workerConcurrency: workers,
    throughput: { logicalOperationsPerSecond: rounded((totalOperations + pairCount * 2) / (durationMs / 1_000)), handlerDispatchesPerSecond: rounded((pairCount * 2) / (durationMs / 1_000)) },
    latency: { actualHandler: summarize(telemetry.requestLatencies), adapterDto: summarize(telemetry.adapterLatencies), p99GateMs: 500, p99GatePassed: p99 <= 500 },
    errors: { classes: telemetry.errorClasses, unexpected: telemetry.errorClasses.handler_error, rate: rounded(telemetry.errorClasses.handler_error / Math.max(1, pairCount * 2), 6) },
    telemetry: {
      activeSyntheticSessionsPeak: telemetry.maxActiveSyntheticSessions, concurrentRequestsPeak: telemetry.maxConcurrentRequests, activeSseStreamsPeak: telemetry.maxActiveSseStreams,
      quotaCalls: telemetry.quotaCalls, quotaDenied: telemetry.quotaDenied, replayHits: telemetry.replayHits, assistantMutations: telemetry.assistantMutations, memoryEnqueued: telemetry.memoryEnqueued, memoryProcessed: telemetry.memoryProcessed,
      paginationReads: telemetry.paginationReads, boundedMemoryReads: telemetry.boundedMemoryReads, attachmentMetadataReads: telemetry.attachmentMetadataReads, exportMetadataCreates: telemetry.exportMetadataCreates, draftWrites: telemetry.draftWrites, ownerAggregateReads: telemetry.ownerAggregateReads,
      sseEvents: telemetry.totalSseEvents, sseBytes: telemetry.totalSseBytes,
    },
    process: { rssDeltaBytes: memoryEnd.rss - memoryStart.rss, heapUsedDeltaBytes: memoryEnd.heapUsed - memoryStart.heapUsed, cpuUserMicros: cpu.user, cpuSystemMicros: cpu.system, classification: "local-sandbox-sample" },
    classification: { handler: "actual-handler-in-memory-dependencies", quota: "in-memory-durable-contract-simulation", adapter: "in-memory-dto-adapter", concurrency: population >= 10_000 ? "chunked-population-not-real-sockets" : "bounded-local-workers" },
  };
}

export async function runInstrumentedSaturation() {
  const { createChatStreamHandler, resetChatStreamRateLimits } = await loadChatHandler();
  resetChatStreamRateLimits(); const telemetry = new MetadataTelemetry(); const repository = new InMemoryApplicationRepository(telemetry);
  const resolvers: Array<() => void> = [];
  const providerStub = async () => { telemetry.beginSse(); try { await new Promise<void>((resolve) => resolvers.push(resolve)); return { content: "synthetic", modelUsed: "synthetic", provider: "synthetic", label: "Synthetic" }; } finally { telemetry.endSse(); } };
  const handler = createChatStreamHandler({ authenticateRequest: async (request: Request) => ({ id: Number(request.headers?.["x-synthetic-user"] ?? 1) }), getOwnedChatSession: repository.getOwnedChatSession.bind(repository), getStoredAssistantForClientMessage: repository.getStoredAssistantForClientMessage.bind(repository), appendChatMessage: repository.appendChatMessage.bind(repository), updateChatTitle: repository.updateChatTitle.bind(repository), listSessionMessages: repository.listSessionMessages.bind(repository), buildChatContext: repository.buildChatContext.bind(repository), consumeChatStreamRequestQuota: repository.consumeQuota.bind(repository), enqueueMemoryExtractionJob: repository.enqueueMemoryExtractionJob.bind(repository), processMemoryExtractionJob: repository.processMemoryExtractionJob.bind(repository), chatWithRoleStream: providerStub as never, auditChatStream: () => undefined });
  const invokeHeld = async (userId: number, sequence: number) => { const response = new SyntheticResponse(telemetry); const run = handler({ headers: { "x-synthetic-user": String(userId) }, body: { sessionId: sessionIdFor(userId), modelId: "fast", content: "synthetic", clientMessageId: clientMessageIdFor(9_000_000 + sequence) } } as unknown as Request, response as unknown as Response, (() => undefined) as never); await new Promise((resolve) => setImmediate(resolve)); return { response, run }; };
  const held = await Promise.all(Array.from({ length: STREAM_LIMITS.perInstance }, (_, index) => invokeHeld(index + 1, index)));
  const overflow = await Promise.all(Array.from({ length: 4 }, (_, index) => invokeHeld(100 + index, 100 + index)));
  resolvers.splice(0).forEach((resolve) => resolve()); await Promise.all(held.map(({ run }) => run)); await Promise.all(overflow.map(({ run }) => run));
  resetChatStreamRateLimits(); resolvers.length = 0;
  const worker64 = await Promise.all(Array.from({ length: MAX_LOCAL_WORKERS }, (_, index) => invokeHeld(index + 1, 1_000 + index)));
  resolvers.splice(0).forEach((resolve) => resolve()); await Promise.all(worker64.map(({ run }) => run));
  resetChatStreamRateLimits(); resolvers.length = 0;
  const first = await invokeHeld(1, 300); const second = await invokeHeld(1, 301); const third = await invokeHeld(1, 302);
  resolvers.splice(0).forEach((resolve) => resolve()); await Promise.all([first.run, second.run, third.run]);
  return {
    instanceAccepted: held.filter(({ response }) => response.statusCode === 200).length,
    instanceRejected: overflow.filter(({ response }) => response.statusCode === 503).length,
    worker64Attempted: worker64.length,
    worker64Accepted: worker64.filter(({ response }) => response.statusCode === 200).length,
    worker64Rejected: worker64.filter(({ response }) => response.statusCode === 503).length,
    perUserRejected: third.response.statusCode === 503 ? 1 : 0,
    peakActiveSseStreams: telemetry.maxActiveSseStreams,
    limits: STREAM_LIMITS,
  };
}

export async function runInstrumentedBenchmark(tiers = SYNTHETIC_TIERS) {
  return withNoNetworkGuard(async () => {
    const results = [];
    for (const tier of tiers) results.push(await runInstrumentedTier(tier));
    const saturation = await runInstrumentedSaturation();
    return { generatedAt: new Date().toISOString(), guardrails: { noNetwork: true, realDatabase: false, realStorage: false, realProviders: false, productionRuntimeChanged: false }, results, saturation };
  }).then(({ result, blockedAttempts }) => ({ ...result, networkGuardBlockedAttempts: blockedAttempts }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const raw = process.argv.find((argument) => argument.startsWith("--tiers="));
  const tiers = raw ? raw.slice(8).split(",").map(Number) : SYNTHETIC_TIERS;
  const writeDiagnostic = (...values: unknown[]) => process.stderr.write(`[instrumented-benchmark] ${values.map(String).join(" ")}\n`);
  console.info = writeDiagnostic;
  console.log = writeDiagnostic;
  process.stdout.write(`${JSON.stringify(await runInstrumentedBenchmark(tiers), null, 2)}\n`);
}
