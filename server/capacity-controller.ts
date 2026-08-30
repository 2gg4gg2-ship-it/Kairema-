import { randomUUID } from "node:crypto";
import { and, eq, inArray, lt, sql } from "drizzle-orm";
import {
  capacityBudgetWindows,
  capacityControllerSettings,
  capacityInflightCounters,
  capacityProviderBudgets,
  capacityReservations,
  type CapacityControllerSettings,
} from "../drizzle/schema";
import { getDb } from "./db";
import type { ChatSettings, Provider, RoleId } from "./providers";

export type CapacityKind = "generation" | "search";
export type CapacityProviderTarget = { provider: Provider; modelId?: string | null };
export type CapacityActor = { userId: number; requestKey: string };
export type CapacityRoleWeights = Record<RoleId, number>;
export type CapacityModifierWeights = Record<"thinking" | "vision" | "detailed" | "highEffort" | "webResearch", number>;

export type CapacityPolicy = {
  enabled: boolean;
  globalGenerationWcuLimit: number | null;
  globalSearchWcuLimit: number | null;
  globalGenerationConcurrency: number | null;
  globalSearchConcurrency: number | null;
  globalGenerationInflightWcuLimit: number | null;
  perUserGenerationWcuLimit: number;
  perUserSearchWcuLimit: number;
  perUserGenerationConcurrency: number;
  perUserSearchConcurrency: number;
  /** A configured low-cost reserve: high-cost Context/Apex may not consume the final portion of a global budget. */
  apexPressureReservePercent: number;
  roleWeights: CapacityRoleWeights;
  modifierWeights: CapacityModifierWeights;
  queueMaxWaitMs: number;
  queueMaxDepth: number;
  queueEligibleRoles: RoleId[];
  /** Conservative crash-path lease cleanup horizon; never a provider availability claim. */
  reservationTtlSeconds: number;
  /** Manually configured only; no automatic tier escalation is claimed without measured global signals. */
  degradationMode: "normal" | "elevated" | "high" | "critical" | "exhausted";
};

type ReservationState = "reserved" | "settled" | "released";
type ScopeLimit = { key: string; limit: number | null; blockingScope: "global" | "user" | "provider" | "search" };
type InflightLimit = ScopeLimit & { maxConcurrent: number | null; maxWcu: number | null };

const WINDOW_MS = 60_000;
const INSTANCE_GENERATION_LIMIT = 12;
const INSTANCE_SEARCH_LIMIT = 6;
const MAX_QUEUE_WAIT_MS = 1_500;
const MAX_QUEUE_DEPTH = 64;
const DEFAULT_ROLE_WEIGHTS: CapacityRoleWeights = { fast: 1, smart: 2, context: 3, flagship: 4 };
const DEFAULT_MODIFIER_WEIGHTS: CapacityModifierWeights = { thinking: 1, vision: 2, detailed: 1, highEffort: 1, webResearch: 1 };

const DEFAULT_POLICY_ROW: Omit<CapacityControllerSettings, "createdAt" | "updatedAt"> = {
  id: 1,
  enabled: 1,
  globalGenerationWcuLimit: null,
  globalSearchWcuLimit: null,
  globalGenerationConcurrency: null,
  globalSearchConcurrency: null,
  globalGenerationInflightWcuLimit: null,
  perUserGenerationWcuLimit: 12,
  perUserSearchWcuLimit: 6,
  perUserGenerationConcurrency: 2,
  perUserSearchConcurrency: 1,
  apexPressureReservePercent: 20,
  roleWeightsJson: JSON.stringify(DEFAULT_ROLE_WEIGHTS),
  modifierWeightsJson: JSON.stringify(DEFAULT_MODIFIER_WEIGHTS),
  queueMaxWaitMs: 0,
  queueMaxDepth: 0,
  queueEligibleRolesJson: JSON.stringify(["fast"]),
  reservationTtlSeconds: 180,
  degradationMode: "normal",
};

export class CapacityAdmissionError extends Error {
  constructor(
    readonly status: 429 | 503,
    readonly reason: "capacity" | "concurrency" | "provider_disabled" | "queue_full" | "unavailable",
    readonly retryAfterSeconds: number,
    readonly scope: "global" | "user" | "provider" | "search" | "instance",
    message?: string,
  ) {
    super(message ?? "Генерация временно ограничена контроллером мощности.");
    this.name = "CapacityAdmissionError";
  }
}

class CapacityLimitReached extends Error {
  constructor(readonly scope: ScopeLimit["blockingScope"]) { super("capacity limit reached"); }
}

function positiveInt(value: unknown, fallback: number, max = 100_000): number {
  return typeof value === "number" && Number.isInteger(value) && value > 0 && value <= max ? value : fallback;
}

function nullablePositiveInt(value: unknown): number | null {
  return value === null || value === undefined ? null : positiveInt(value, 0) || null;
}

function parseWeights<T extends Record<string, number>>(raw: string, fallback: T): T {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return Object.fromEntries(Object.entries(fallback).map(([key, value]) => [key, positiveInt(parsed[key], value, 32)])) as T;
  } catch {
    return { ...fallback };
  }
}

function parseQueueEligibleRoles(raw: string): RoleId[] {
  try {
    const values = JSON.parse(raw) as unknown;
    if (!Array.isArray(values)) return ["fast"];
    const roles = values.filter((value): value is RoleId => value === "fast" || value === "smart" || value === "context" || value === "flagship");
    return roles.length ? Array.from(new Set(roles)) : ["fast"];
  } catch {
    return ["fast"];
  }
}

function policyFromRow(row: CapacityControllerSettings): CapacityPolicy {
  return {
    enabled: Boolean(row.enabled),
    globalGenerationWcuLimit: nullablePositiveInt(row.globalGenerationWcuLimit),
    globalSearchWcuLimit: nullablePositiveInt(row.globalSearchWcuLimit),
    globalGenerationConcurrency: nullablePositiveInt(row.globalGenerationConcurrency),
    globalSearchConcurrency: nullablePositiveInt(row.globalSearchConcurrency),
    globalGenerationInflightWcuLimit: nullablePositiveInt(row.globalGenerationInflightWcuLimit),
    perUserGenerationWcuLimit: positiveInt(row.perUserGenerationWcuLimit, DEFAULT_POLICY_ROW.perUserGenerationWcuLimit),
    perUserSearchWcuLimit: positiveInt(row.perUserSearchWcuLimit, DEFAULT_POLICY_ROW.perUserSearchWcuLimit),
    perUserGenerationConcurrency: positiveInt(row.perUserGenerationConcurrency, DEFAULT_POLICY_ROW.perUserGenerationConcurrency, 12),
    perUserSearchConcurrency: positiveInt(row.perUserSearchConcurrency, DEFAULT_POLICY_ROW.perUserSearchConcurrency, 6),
    apexPressureReservePercent: Math.min(80, Math.max(0, Number(row.apexPressureReservePercent) || 0)),
    roleWeights: parseWeights(row.roleWeightsJson, DEFAULT_ROLE_WEIGHTS),
    modifierWeights: parseWeights(row.modifierWeightsJson, DEFAULT_MODIFIER_WEIGHTS),
    queueMaxWaitMs: Math.min(MAX_QUEUE_WAIT_MS, Math.max(0, Number(row.queueMaxWaitMs) || 0)),
    queueMaxDepth: Math.min(MAX_QUEUE_DEPTH, Math.max(0, Number(row.queueMaxDepth) || 0)),
    queueEligibleRoles: parseQueueEligibleRoles(row.queueEligibleRolesJson),
    reservationTtlSeconds: Math.min(900, positiveInt(row.reservationTtlSeconds, DEFAULT_POLICY_ROW.reservationTtlSeconds, 900)),
    degradationMode: row.degradationMode === "elevated" || row.degradationMode === "high" || row.degradationMode === "critical" || row.degradationMode === "exhausted" ? row.degradationMode : "normal",
  };
}

async function databaseOrThrow() {
  const db = await getDb();
  if (!db) throw new CapacityAdmissionError(503, "unavailable", 1, "instance", "Контроллер мощности временно недоступен.");
  return db;
}

async function ensurePolicyRow(db: Awaited<ReturnType<typeof getDb>>) {
  if (!db) throw new CapacityAdmissionError(503, "unavailable", 1, "instance");
  await db.insert(capacityControllerSettings).values(DEFAULT_POLICY_ROW).onDuplicateKeyUpdate({ set: { id: sql`${capacityControllerSettings.id}` } });
}

export async function getCapacityPolicy(): Promise<CapacityPolicy> {
  const db = await databaseOrThrow();
  await ensurePolicyRow(db);
  const row = (await db.select().from(capacityControllerSettings).where(eq(capacityControllerSettings.id, 1)).limit(1))[0];
  if (!row) throw new CapacityAdmissionError(503, "unavailable", 1, "instance");
  return policyFromRow(row);
}

export type CapacityPolicyPatch = Partial<{
  enabled: boolean;
  globalGenerationWcuLimit: number | null;
  globalSearchWcuLimit: number | null;
  globalGenerationConcurrency: number | null;
  globalSearchConcurrency: number | null;
  globalGenerationInflightWcuLimit: number | null;
  perUserGenerationWcuLimit: number;
  perUserSearchWcuLimit: number;
  perUserGenerationConcurrency: number;
  perUserSearchConcurrency: number;
  apexPressureReservePercent: number;
  roleWeights: CapacityRoleWeights;
  modifierWeights: CapacityModifierWeights;
  queueMaxWaitMs: number;
  queueMaxDepth: number;
  queueEligibleRoles: RoleId[];
  reservationTtlSeconds: number;
  degradationMode: CapacityPolicy["degradationMode"];
}>;

export async function updateCapacityPolicy(patch: CapacityPolicyPatch): Promise<CapacityPolicy> {
  const db = await databaseOrThrow();
  await ensurePolicyRow(db);
  const set: Partial<typeof capacityControllerSettings.$inferInsert> = {};
  if (patch.enabled !== undefined) set.enabled = patch.enabled ? 1 : 0;
  if (patch.globalGenerationWcuLimit !== undefined) set.globalGenerationWcuLimit = patch.globalGenerationWcuLimit;
  if (patch.globalSearchWcuLimit !== undefined) set.globalSearchWcuLimit = patch.globalSearchWcuLimit;
  if (patch.globalGenerationConcurrency !== undefined) set.globalGenerationConcurrency = patch.globalGenerationConcurrency;
  if (patch.globalSearchConcurrency !== undefined) set.globalSearchConcurrency = patch.globalSearchConcurrency;
  if (patch.globalGenerationInflightWcuLimit !== undefined) set.globalGenerationInflightWcuLimit = patch.globalGenerationInflightWcuLimit;
  if (patch.perUserGenerationWcuLimit !== undefined) set.perUserGenerationWcuLimit = patch.perUserGenerationWcuLimit;
  if (patch.perUserSearchWcuLimit !== undefined) set.perUserSearchWcuLimit = patch.perUserSearchWcuLimit;
  if (patch.perUserGenerationConcurrency !== undefined) set.perUserGenerationConcurrency = patch.perUserGenerationConcurrency;
  if (patch.perUserSearchConcurrency !== undefined) set.perUserSearchConcurrency = patch.perUserSearchConcurrency;
  if (patch.apexPressureReservePercent !== undefined) set.apexPressureReservePercent = patch.apexPressureReservePercent;
  if (patch.queueMaxWaitMs !== undefined) set.queueMaxWaitMs = patch.queueMaxWaitMs;
  if (patch.queueMaxDepth !== undefined) set.queueMaxDepth = patch.queueMaxDepth;
  if (patch.reservationTtlSeconds !== undefined) set.reservationTtlSeconds = patch.reservationTtlSeconds;
  if (patch.roleWeights !== undefined) set.roleWeightsJson = JSON.stringify(patch.roleWeights);
  if (patch.modifierWeights !== undefined) set.modifierWeightsJson = JSON.stringify(patch.modifierWeights);
  if (patch.queueEligibleRoles !== undefined) set.queueEligibleRolesJson = JSON.stringify(patch.queueEligibleRoles);
  if (patch.degradationMode !== undefined) set.degradationMode = patch.degradationMode;
  if (Object.keys(set).length) await db.update(capacityControllerSettings).set(set).where(eq(capacityControllerSettings.id, 1));
  return getCapacityPolicy();
}

export type CapacityProviderBudgetPatch = {
  target: CapacityProviderTarget;
  enabled?: boolean;
  generationWcuLimit?: number | null;
  maxConcurrent?: number | null;
  rpmLimit?: number | null;
  tpmLimit?: number | null;
  dailyUnitsLimit?: number | null;
  dailyRequestLimit?: number | null;
  dailyTokenLimit?: number | null;
  resetWindow?: string | null;
  cooldownState?: "unknown" | "inherit_provider_health" | "cooldown";
  roleEligibility?: RoleId[] | null;
  searchEligibility?: "unknown" | "eligible" | "not_eligible";
  billingSafe?: boolean | null;
  eligibilityState?: "unknown" | "eligible" | "not_eligible" | "paid_required";
  billingState?: "unknown" | "free" | "paid" | "not_configured";
  quotaState?: "unknown" | "operator_configured";
};

function providerScope(target: CapacityProviderTarget) {
  return target.modelId ? `model:${target.provider}:${target.modelId}` : `provider:${target.provider}`;
}

export async function listCapacityProviderBudgets() {
  const db = await databaseOrThrow();
  return db.select().from(capacityProviderBudgets).orderBy(capacityProviderBudgets.provider, capacityProviderBudgets.modelId);
}

export async function updateCapacityProviderBudget(patch: CapacityProviderBudgetPatch) {
  const db = await databaseOrThrow();
  const scopeKey = providerScope(patch.target);
  await db.insert(capacityProviderBudgets).values({
    scopeKey,
    provider: patch.target.provider,
    modelId: patch.target.modelId ?? null,
    enabled: patch.enabled === false ? 0 : 1,
    generationWcuLimit: patch.generationWcuLimit ?? null,
    maxConcurrent: patch.maxConcurrent ?? null,
    rpmLimit: patch.rpmLimit ?? null,
    tpmLimit: patch.tpmLimit ?? null,
    dailyUnitsLimit: patch.dailyUnitsLimit ?? null,
    dailyRequestLimit: patch.dailyRequestLimit ?? null,
    dailyTokenLimit: patch.dailyTokenLimit ?? null,
    resetWindow: patch.resetWindow ?? null,
    cooldownState: patch.cooldownState ?? "inherit_provider_health",
    roleEligibilityJson: patch.roleEligibility === undefined || patch.roleEligibility === null ? null : JSON.stringify(patch.roleEligibility),
    searchEligibility: patch.searchEligibility ?? "unknown",
    billingSafe: patch.billingSafe === undefined || patch.billingSafe === null ? null : patch.billingSafe ? 1 : 0,
    eligibilityState: patch.eligibilityState ?? "unknown",
    billingState: patch.billingState ?? "unknown",
    quotaState: patch.quotaState ?? "unknown",
  }).onDuplicateKeyUpdate({ set: {
    ...(patch.enabled === undefined ? {} : { enabled: patch.enabled ? 1 : 0 }),
    ...(patch.generationWcuLimit === undefined ? {} : { generationWcuLimit: patch.generationWcuLimit }),
    ...(patch.maxConcurrent === undefined ? {} : { maxConcurrent: patch.maxConcurrent }),
    ...(patch.rpmLimit === undefined ? {} : { rpmLimit: patch.rpmLimit }),
    ...(patch.tpmLimit === undefined ? {} : { tpmLimit: patch.tpmLimit }),
    ...(patch.dailyUnitsLimit === undefined ? {} : { dailyUnitsLimit: patch.dailyUnitsLimit }),
    ...(patch.dailyRequestLimit === undefined ? {} : { dailyRequestLimit: patch.dailyRequestLimit }),
    ...(patch.dailyTokenLimit === undefined ? {} : { dailyTokenLimit: patch.dailyTokenLimit }),
    ...(patch.resetWindow === undefined ? {} : { resetWindow: patch.resetWindow }),
    ...(patch.cooldownState === undefined ? {} : { cooldownState: patch.cooldownState }),
    ...(patch.roleEligibility === undefined ? {} : { roleEligibilityJson: patch.roleEligibility === null ? null : JSON.stringify(patch.roleEligibility) }),
    ...(patch.searchEligibility === undefined ? {} : { searchEligibility: patch.searchEligibility }),
    ...(patch.billingSafe === undefined ? {} : { billingSafe: patch.billingSafe === null ? null : patch.billingSafe ? 1 : 0 }),
    ...(patch.eligibilityState === undefined ? {} : { eligibilityState: patch.eligibilityState }),
    ...(patch.billingState === undefined ? {} : { billingState: patch.billingState }),
    ...(patch.quotaState === undefined ? {} : { quotaState: patch.quotaState }),
  } });
  return (await db.select().from(capacityProviderBudgets).where(eq(capacityProviderBudgets.scopeKey, scopeKey)).limit(1))[0] ?? null;
}

function calculation(settings: ChatSettings, roleId: RoleId, policy: CapacityPolicy): { wcu: number; modifiers: string[] } {
  const modifiers: Array<keyof CapacityModifierWeights> = [];
  if (settings.thinking) modifiers.push("thinking");
  if (settings.imageUrls?.length) modifiers.push("vision");
  if (settings.responseLength === "detailed") modifiers.push("detailed");
  if (settings.effort === "high") modifiers.push("highEffort");
  if (settings.webResearch) modifiers.push("webResearch");
  return { wcu: policy.roleWeights[roleId] + modifiers.reduce((total, key) => total + policy.modifierWeights[key], 0), modifiers };
}

function enforceRoleDegradation(policy: CapacityPolicy, roleId: RoleId) {
  const rejected = policy.degradationMode === "exhausted"
    || (policy.degradationMode === "critical" && (roleId === "smart" || roleId === "context" || roleId === "flagship"))
    || (policy.degradationMode === "high" && roleId === "flagship");
  if (rejected) {
    throw new CapacityAdmissionError(429, "capacity", 30, "global", "Этот режим ответа временно ограничен policy controller до upstream вызова.");
  }
}

function affectedRows(result: unknown) {
  const header = Array.isArray(result) ? result[0] : result;
  return Number((header as { affectedRows?: number } | undefined)?.affectedRows ?? 0);
}

async function addScopedWcu(tx: any, scope: ScopeLimit, wcu: number, now: Date, cutoff: Date) {
  await tx.insert(capacityBudgetWindows).values({ scopeKey: scope.key, windowStarted: now, usedWcu: 0 }).onDuplicateKeyUpdate({ set: { scopeKey: sql`${capacityBudgetWindows.scopeKey}` } });
  const remainingSql = sql`if(${capacityBudgetWindows.windowStarted} <= ${cutoff}, 0, ${capacityBudgetWindows.usedWcu})`;
  const result = await tx.update(capacityBudgetWindows).set({
    usedWcu: sql`if(${capacityBudgetWindows.windowStarted} <= ${cutoff}, ${wcu}, ${capacityBudgetWindows.usedWcu} + ${wcu})`,
    windowStarted: sql`if(${capacityBudgetWindows.windowStarted} <= ${cutoff}, ${now}, ${capacityBudgetWindows.windowStarted})`,
  }).where(scope.limit === null
    ? eq(capacityBudgetWindows.scopeKey, scope.key)
    : and(eq(capacityBudgetWindows.scopeKey, scope.key), sql`${remainingSql} + ${wcu} <= ${scope.limit}`));
  if (scope.limit !== null && affectedRows(result) !== 1) throw new CapacityLimitReached(scope.blockingScope);
}

async function addInflightScope(tx: any, scope: InflightLimit, wcu: number) {
  await tx.insert(capacityInflightCounters).values({ scopeKey: scope.key, activeCount: 0, activeWcu: 0 })
    .onDuplicateKeyUpdate({ set: { scopeKey: sql`${capacityInflightCounters.scopeKey}` } });
  const conditions = [eq(capacityInflightCounters.scopeKey, scope.key)];
  if (scope.maxConcurrent !== null) conditions.push(sql`${capacityInflightCounters.activeCount} < ${scope.maxConcurrent}` as any);
  if (scope.maxWcu !== null) conditions.push(sql`${capacityInflightCounters.activeWcu} + ${wcu} <= ${scope.maxWcu}` as any);
  const result = await tx.update(capacityInflightCounters).set({
    activeCount: sql`${capacityInflightCounters.activeCount} + 1`,
    activeWcu: sql`${capacityInflightCounters.activeWcu} + ${wcu}`,
  }).where(and(...conditions));
  if ((scope.maxConcurrent !== null || scope.maxWcu !== null) && affectedRows(result) !== 1) {
    throw new CapacityLimitReached(scope.blockingScope);
  }
}

function parseInflightScopes(raw: string): Array<{ key: string; wcu: number }> {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((entry) => {
      if (!entry || typeof entry !== "object") return [];
      const candidate = entry as { key?: unknown; wcu?: unknown };
      return typeof candidate.key === "string" && typeof candidate.wcu === "number" && candidate.wcu > 0
        ? [{ key: candidate.key, wcu: candidate.wcu }]
        : [];
    });
  } catch {
    return [];
  }
}

async function releaseReservationInflightCounters(tx: any, reservation: { inflightScopeKeysJson: string }) {
  for (const scope of parseInflightScopes(reservation.inflightScopeKeysJson)) {
    await tx.update(capacityInflightCounters).set({
      activeCount: sql`if(${capacityInflightCounters.activeCount} > 0, ${capacityInflightCounters.activeCount} - 1, 0)`,
      activeWcu: sql`if(${capacityInflightCounters.activeWcu} >= ${scope.wcu}, ${capacityInflightCounters.activeWcu} - ${scope.wcu}, 0)`,
    }).where(eq(capacityInflightCounters.scopeKey, scope.key));
  }
}

async function releaseExpiredReservations(tx: any, now: Date, policy: CapacityPolicy) {
  const expiresBefore = new Date(now.getTime() - policy.reservationTtlSeconds * 1_000);
  const expired = await tx.select().from(capacityReservations)
    .where(and(eq(capacityReservations.state, "reserved"), lt(capacityReservations.createdAt, expiresBefore)));
  let released = 0;
  for (const reservation of expired) {
    const result = await tx.update(capacityReservations).set({ state: "released", finalizedAt: now })
      .where(and(eq(capacityReservations.id, reservation.id), eq(capacityReservations.state, "reserved")));
    if (affectedRows(result) === 1) {
      await releaseReservationInflightCounters(tx, reservation);
      released += 1;
    }
  }
  return released;
}

type GenerationReservationInput = {
  actor: CapacityActor;
  roleId: RoleId;
  target: CapacityProviderTarget;
  attemptIndex: number;
  wcu: number;
  policy: CapacityPolicy;
};

export type CapacityReservationTicket = { id: string; requestKey: string; wcu: number; deduplicated: boolean };

async function reserve(input: GenerationReservationInput | { actor: CapacityActor; roleId: RoleId; wcu: number; policy: CapacityPolicy; kind: "search" }): Promise<CapacityReservationTicket> {
  const db = await databaseOrThrow();
  const kind: CapacityKind = "target" in input ? "generation" : input.kind;
  const target = "target" in input ? input.target : null;
  const requestKey = "target" in input
    ? `${input.actor.requestKey}:attempt:${input.attemptIndex}:${providerScope(target!)}`.slice(0, 180)
    : `${input.actor.requestKey}:search`.slice(0, 180);
  const now = new Date();
  const cutoff = new Date(now.getTime() - WINDOW_MS);
  const policy = input.policy;
  if (!policy.enabled) return { id: `disabled:${requestKey}`, requestKey, wcu: input.wcu, deduplicated: false };
  if (kind === "generation") enforceRoleDegradation(policy, input.roleId);

  const providerBudget = target
    ? (await db.select().from(capacityProviderBudgets).where(inArray(capacityProviderBudgets.scopeKey, [providerScope({ provider: target.provider }), providerScope(target)])).limit(2))
    : [];
  const providerPolicy = target ? providerBudget.find((row) => row.scopeKey === providerScope({ provider: target.provider })) : undefined;
  const modelPolicy = target?.modelId ? providerBudget.find((row) => row.scopeKey === providerScope(target)) : undefined;
  if ((providerPolicy && !providerPolicy.enabled) || (modelPolicy && !modelPolicy.enabled)) {
    throw new CapacityAdmissionError(503, "provider_disabled", 30, "provider", "Этот provider или model отключён policy controller; резерв выбран без upstream вызова.");
  }

  const isHighCostRole = input.roleId === "context" || input.roleId === "flagship";
  const protectedGlobalGenerationLimit = kind === "generation" && isHighCostRole && policy.globalGenerationWcuLimit !== null
    ? Math.max(1, policy.globalGenerationWcuLimit - Math.ceil(policy.globalGenerationWcuLimit * policy.apexPressureReservePercent / 100))
    : policy.globalGenerationWcuLimit;
  const scopeLimits: ScopeLimit[] = kind === "generation"
    ? [
      { key: "global:generation", limit: protectedGlobalGenerationLimit, blockingScope: "global" },
      { key: `user:generation:${input.actor.userId}`, limit: policy.perUserGenerationWcuLimit, blockingScope: "user" },
      { key: providerScope({ provider: target!.provider }), limit: providerPolicy?.generationWcuLimit ?? null, blockingScope: "provider" },
      ...(target!.modelId ? [{ key: providerScope(target!), limit: modelPolicy?.generationWcuLimit ?? null, blockingScope: "provider" as const }] : []),
    ]
    : [
      { key: "global:search", limit: policy.globalSearchWcuLimit, blockingScope: "search" },
      { key: `user:search:${input.actor.userId}`, limit: policy.perUserSearchWcuLimit, blockingScope: "search" },
    ];
  const inflightScopes: InflightLimit[] = kind === "generation"
    ? [
      { key: "global:generation", limit: null, maxConcurrent: policy.globalGenerationConcurrency, maxWcu: policy.globalGenerationInflightWcuLimit, blockingScope: "global" },
      { key: `user:generation:${input.actor.userId}`, limit: null, maxConcurrent: policy.perUserGenerationConcurrency, maxWcu: null, blockingScope: "user" },
      { key: providerScope({ provider: target!.provider }), limit: null, maxConcurrent: providerPolicy?.maxConcurrent ?? null, maxWcu: null, blockingScope: "provider" },
      ...(target!.modelId ? [{ key: providerScope(target!), limit: null, maxConcurrent: modelPolicy?.maxConcurrent ?? null, maxWcu: null, blockingScope: "provider" as const }] : []),
    ]
    : [
      { key: "global:search", limit: null, maxConcurrent: policy.globalSearchConcurrency, maxWcu: null, blockingScope: "search" },
      { key: `user:search:${input.actor.userId}`, limit: null, maxConcurrent: policy.perUserSearchConcurrency, maxWcu: null, blockingScope: "search" },
    ];

  try {
    return await db.transaction(async (tx) => {
      const staleReleased = await releaseExpiredReservations(tx, now, policy);
      if (staleReleased) localCounters.staleReleased += staleReleased;
      const existing = (await tx.select().from(capacityReservations).where(eq(capacityReservations.requestKey, requestKey)).limit(1))[0];
      if (existing) return { id: existing.id, requestKey, wcu: existing.wcu, deduplicated: true };
      for (const scope of scopeLimits) await addScopedWcu(tx, scope, input.wcu, now, cutoff);
      for (const scope of inflightScopes) await addInflightScope(tx, scope, input.wcu);
      const id = randomUUID();
      await tx.insert(capacityReservations).values({
        id,
        requestKey,
        userId: input.actor.userId,
        kind,
        roleId: input.roleId,
        provider: target?.provider ?? null,
        modelId: target?.modelId ?? null,
        wcu: input.wcu,
        scopeKeysJson: JSON.stringify(scopeLimits.map((scope) => scope.key)),
        inflightScopeKeysJson: JSON.stringify(inflightScopes.map((scope) => ({ key: scope.key, wcu: input.wcu }))),
        state: "reserved",
      });
      return { id, requestKey, wcu: input.wcu, deduplicated: false };
    });
  } catch (error) {
    if (error instanceof CapacityLimitReached) {
      const status: 429 | 503 = error.scope === "provider" ? 503 : 429;
      throw new CapacityAdmissionError(status, "capacity", Math.ceil(WINDOW_MS / 1_000), error.scope, "Лимит мощности на текущую минуту достигнут до upstream вызова.");
    }
    throw error;
  }
}

export async function settleCapacityReservation(ticket: CapacityReservationTicket, state: Exclude<ReservationState, "reserved"> = "settled") {
  if (ticket.id.startsWith("disabled:")) return;
  const db = await databaseOrThrow();
  const finalized = await db.transaction(async (tx) => {
    const reservation = (await tx.select().from(capacityReservations).where(eq(capacityReservations.id, ticket.id)).limit(1))[0];
    if (!reservation || reservation.state !== "reserved") return false;
    const result = await tx.update(capacityReservations).set({ state, finalizedAt: new Date() })
      .where(and(eq(capacityReservations.id, ticket.id), eq(capacityReservations.state, "reserved")));
    if (affectedRows(result) !== 1) return false;
    await releaseReservationInflightCounters(tx, reservation);
    return true;
  });
  if (finalized) {
    if (state === "settled") localCounters.settled += 1;
    else localCounters.released += 1;
  }
}

type LocalKindState = { active: number; activeByUser: Map<number, number>; waiters: Array<() => void> };
const localState: Record<CapacityKind, LocalKindState> = {
  generation: { active: 0, activeByUser: new Map(), waiters: [] },
  search: { active: 0, activeByUser: new Map(), waiters: [] },
};
const localCounters = { admissions: 0, rejectedCapacity: 0, rejectedConcurrency: 0, queued: 0, queueTimedOut: 0, settled: 0, released: 0, staleReleased: 0, fallbackReservations: 0, searchAdmissions: 0, searchRejected: 0 };

/** Test seam only: resets process-local admission state; it is never exposed through a router. */
export function resetCapacityControllerRuntimeForTests() {
  for (const kind of ["generation", "search"] as const) {
    localState[kind].active = 0;
    localState[kind].activeByUser.clear();
    localState[kind].waiters.length = 0;
  }
  for (const key of Object.keys(localCounters) as Array<keyof typeof localCounters>) localCounters[key] = 0;
}

function localLimit(kind: CapacityKind) { return kind === "generation" ? INSTANCE_GENERATION_LIMIT : INSTANCE_SEARCH_LIMIT; }

async function acquireLocal(kind: CapacityKind, actor: CapacityActor, policy: CapacityPolicy, roleId?: RoleId) {
  const state = localState[kind];
  const perUserLimit = kind === "generation" ? policy.perUserGenerationConcurrency : policy.perUserSearchConcurrency;
  const allowed = () => state.active < localLimit(kind) && (state.activeByUser.get(actor.userId) ?? 0) < perUserLimit;
  if (!allowed()) {
    const queueEnabled = kind === "generation" && roleId === "fast" && policy.queueEligibleRoles.includes(roleId)
      && policy.queueMaxWaitMs > 0 && policy.queueMaxDepth > 0;
    if (!queueEnabled) {
      localCounters.rejectedConcurrency += 1;
      throw new CapacityAdmissionError(503, "concurrency", 1, "instance", "Локальная очередь controller отключена или занята; запрос не был отправлен upstream.");
    }
    if (state.waiters.length >= policy.queueMaxDepth) {
      localCounters.rejectedConcurrency += 1;
      throw new CapacityAdmissionError(503, "queue_full", 1, "instance", "Короткая локальная очередь занята; запрос не был отправлен upstream.");
    }
    localCounters.queued += 1;
    await new Promise<void>((resolve, reject) => {
      const onTimeout = setTimeout(() => {
        const index = state.waiters.indexOf(wake);
        if (index >= 0) state.waiters.splice(index, 1);
        localCounters.queueTimedOut += 1;
        reject(new CapacityAdmissionError(503, "concurrency", 1, "instance", "Ожидание локальной очереди истекло до upstream вызова."));
      }, policy.queueMaxWaitMs);
      const wake = () => { clearTimeout(onTimeout); resolve(); };
      state.waiters.push(wake);
    });
    return acquireLocal(kind, actor, { ...policy, queueMaxDepth: 0, queueMaxWaitMs: 0 }, roleId);
  }
  state.active += 1;
  state.activeByUser.set(actor.userId, (state.activeByUser.get(actor.userId) ?? 0) + 1);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    state.active = Math.max(0, state.active - 1);
    const next = Math.max(0, (state.activeByUser.get(actor.userId) ?? 1) - 1);
    if (next) state.activeByUser.set(actor.userId, next); else state.activeByUser.delete(actor.userId);
    localCounters.released += 1;
    state.waiters.shift()?.();
  };
}

export type CapacityGenerationLease = {
  policy: CapacityPolicy;
  wcu: number;
  modifiers: string[];
  reserveAttempt(target: CapacityProviderTarget, attemptIndex: number): Promise<CapacityReservationTicket>;
  release(): void;
};

export async function beginCapacityGeneration(actor: CapacityActor, roleId: RoleId, settings: ChatSettings): Promise<CapacityGenerationLease> {
  const policy = await getCapacityPolicy();
  const weight = calculation(settings, roleId, policy);
  const release = policy.enabled ? await acquireLocal("generation", actor, policy, roleId) : () => undefined;
  localCounters.admissions += 1;
  return {
    policy,
    wcu: weight.wcu,
    modifiers: weight.modifiers,
    reserveAttempt: async (target, attemptIndex) => {
      try {
        const ticket = await reserve({ actor, roleId, target, attemptIndex, wcu: weight.wcu, policy });
        if (attemptIndex > 1) localCounters.fallbackReservations += 1;
        return ticket;
      } catch (error) {
        if (error instanceof CapacityAdmissionError) localCounters.rejectedCapacity += 1;
        throw error;
      }
    },
    release,
  };
}

export type CapacitySearchLease = { reserve(): Promise<CapacityReservationTicket>; release(): void };

export async function beginCapacitySearch(actor: CapacityActor, roleId: RoleId): Promise<CapacitySearchLease> {
  const policy = await getCapacityPolicy();
  const release = policy.enabled ? await acquireLocal("search", actor, policy) : () => undefined;
  return {
    reserve: async () => {
      try {
        const ticket = await reserve({ actor, roleId, kind: "search", wcu: 1, policy });
        localCounters.searchAdmissions += 1;
        return ticket;
      } catch (error) {
        if (error instanceof CapacityAdmissionError) localCounters.searchRejected += 1;
        throw error;
      }
    },
    release,
  };
}

/** Registry only. Cloudflare is deliberately not routable, credentialed or counted as active capacity. */
export const CAPACITY_PROVIDER_ADAPTERS = Object.freeze([
  { id: "openrouter", routing: "existing", budgetScope: "provider/model", status: "active-chain" },
  { id: "orcarouter", routing: "existing", budgetScope: "provider/model", status: "active-chain" },
  { id: "teamorouter", routing: "existing", budgetScope: "provider/model", status: "active-chain" },
  { id: "tokenharbor", routing: "existing", budgetScope: "provider/model", status: "active-chain" },
  { id: "bazaarlink", routing: "existing", budgetScope: "provider/model", status: "active-chain" },
  { id: "google", routing: "existing", budgetScope: "provider/model", status: "active-chain" },
  { id: "groq", routing: "existing", budgetScope: "provider/model", status: "active-chain" },
  { id: "dots", routing: "existing-reserve", budgetScope: "provider/model", status: "reserve-not-guaranteed" },
  { id: "cloudflare-workers-ai", routing: "none", budgetScope: "independent candidate", status: "feasibility-only" },
] as const);

export async function getCapacityControllerSnapshot() {
  const policy = await getCapacityPolicy();
  const db = await databaseOrThrow();
  const currentWindow = await db.select({ scopeKey: capacityBudgetWindows.scopeKey, usedWcu: capacityBudgetWindows.usedWcu, windowStarted: capacityBudgetWindows.windowStarted })
    .from(capacityBudgetWindows)
    .where(inArray(capacityBudgetWindows.scopeKey, ["global:generation", "global:search"]));
  const durableInflight = await db.select({ scopeKey: capacityInflightCounters.scopeKey, activeCount: capacityInflightCounters.activeCount, activeWcu: capacityInflightCounters.activeWcu })
    .from(capacityInflightCounters)
    .where(inArray(capacityInflightCounters.scopeKey, ["global:generation", "global:search"]));
  const budgets = await listCapacityProviderBudgets();
  return {
    policy: {
      ...policy,
      globalCapacity: policy.globalGenerationWcuLimit === null ? "UNKNOWN / unconfigured" : "operator-configured",
      searchCapacity: policy.globalSearchWcuLimit === null ? "UNKNOWN / unconfigured" : "operator-configured",
      queueScope: policy.queueMaxDepth > 0 && policy.queueMaxWaitMs > 0 ? "instance-local bounded" : "disabled (safe default)",
    },
    currentWindow,
    durableInflight,
    providerBudgets: budgets.map((budget) => ({
      scopeKey: budget.scopeKey,
      provider: budget.provider,
      modelId: budget.modelId,
      enabled: Boolean(budget.enabled),
      generationWcuLimit: budget.generationWcuLimit,
      maxConcurrent: budget.maxConcurrent,
      rpmLimit: budget.rpmLimit,
      tpmLimit: budget.tpmLimit,
      dailyUnitsLimit: budget.dailyUnitsLimit,
      dailyRequestLimit: budget.dailyRequestLimit,
      dailyTokenLimit: budget.dailyTokenLimit,
      resetWindow: budget.resetWindow,
      cooldownState: budget.cooldownState,
      roleEligibility: budget.roleEligibilityJson,
      searchEligibility: budget.searchEligibility,
      eligibilityState: budget.eligibilityState,
      billingState: budget.billingState,
      billingSafe: budget.billingSafe === null ? null : Boolean(budget.billingSafe),
      quotaState: budget.quotaState,
    })),
    local: {
      scope: "single process only; not a global production concurrency claim",
      generation: { active: localState.generation.active, queued: localState.generation.waiters.length, instanceLimit: INSTANCE_GENERATION_LIMIT },
      search: { active: localState.search.active, queued: localState.search.waiters.length, instanceLimit: INSTANCE_SEARCH_LIMIT },
      counters: { ...localCounters },
    },
    adapters: CAPACITY_PROVIDER_ADAPTERS,
  };
}
