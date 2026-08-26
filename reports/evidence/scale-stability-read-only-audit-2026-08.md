# KAIREMA SCALE & STABILITY HARDENING — read-only audit

**Дата аудита:** 2026-08-26  
**Метод:** статическое чтение server, schema, storage, router и test-contract кода. Никакие пользовательские записи, mailbox, Stytch delivery, provider mutation, external infrastructure, migrations или runtime-конфигурация не изменялись.  
**Целевой горизонт:** 10K–50K synthetic users.  
**Ключевое ограничение:** это **не** load test и не capacity certification. Фактические RPS, p95/p99 latency, concurrent SSE connections, MySQL connection limits, deployment replica count и S3 throughput не измерялись.

## Executive finding

Kairema уже имеет хорошую базу для **correctness, privacy и controlled degradation**, но текущая реализация должна рассматриваться как **single-instance / low-to-moderate concurrency architecture, не верифицированная для 10K–50K concurrent synthetic users**. Основной риск не в четырёх ролях или в ограниченном fallback: он в process-local coordination, полном чтении растущих пользовательских наборов, long-lived SSE, server-buffered files и отсутствии capacity telemetry.

| Область | Статус | Фактический вывод |
|---|---|---|
| Каноническая user isolation | **PASS (code-level)** | `ctx.user.id`, owner-scoped helpers, user/session predicates и tests сохраняют серверную авторизацию. |
| OAuth / Stytch Email-Password | **PASS (code-level)** | Google/Manus и provider-managed Stytch paths сохраняются. Magic Link delivery — отдельный **external BLOCKED**, не часть scale remediation. |
| 4 роли и максимум 4 LLM attempts | **PASS (code-level)** | Router хранит allowlist/cooldown/fallback и ограниченный request budget. |
| Database correctness under ordinary races | **PARTIAL PASS** | Есть unique keys, user-scoped predicates, idempotent memory job enqueue и conditional claim. Полная нагрузочная конкуренция не измерялась. |
| Single-instance independence | **NOT VERIFIED / GAP** | Несколько важных coordination caches и stream controls process-local. |
| 10K–50K capacity | **NOT VERIFIED** | Нет workload profile, baseline, connection/queue metrics или controlled load result. |

> **Вывод:** не требуется немедленный Redis/PostgreSQL/VPS/AWS rewrite. Сначала нужны low-risk bounded reads, query/index hardening, ingress/resource limits и privacy-safe metrics. После этого — controlled synthetic load test с согласованным workload profile.

## Preserved invariants

Следующие invariants были проверены как существующие и **не должны изменяться** при любом будущем hardening:

| Invariant | Наблюдение в коде |
|---|---|
| Четыре public roles | `fast`, `smart`, `context`, `flagship` соответствуют Flash/Think/Context/Apex; role policy и status хранятся allowlisted. |
| Не более 4 LLM attempts | Provider router использует bounded candidate/fallback chain; отключённые/неhealth candidates не расходуют budget. |
| Server-side Provider Health | Persisted `provider_health`, role runtime status, control flags и bounded technical events остаются server-owned. |
| User isolation | Auth context derives the canonical user server-side; DB helpers use user/session ownership filters. |
| Owner-only exports | Exports retain owner-scoped lookup before artifact access. |
| Secure attachments | Attachment metadata carries user/session ownership; signed/storage access follows owned lookup. |
| Google OAuth + Stytch Email/Password | Existing provider-managed auth stays intact. Stytch Magic Link delivery remains an external blocker with **no new attempts**. |
| Drafts | Draft is user/chat scoped; no guest identity bridge. |
| Search architecture | Sequential degraded search/RAG behavior and truthful freshness warning remain intact. |

## Architecture map relevant to scale

| Layer | Current implementation | Scale implication |
|---|---|---|
| Runtime | Node/Express/tRPC process, lazy module-scoped Drizzle client (`server/db.ts`) | Process state is not a coordination substrate across replicas. DB connection pool sizing is not explicit in app code. |
| Chat ingress | SSE stream path in `server/chat-stream.ts` | Every active response holds an HTTP connection and request-scoped context until finish/cancel. |
| Context assembly | Preferences/profile/facts/topics in parallel; optional attachments, live search and RAG in `server/chat-context.ts` | Good parallelism, but several user-scoped lists are read in full. |
| Provider plane | Allowed candidates, health/cooldown, bounded four-attempt fallback (`server/providers.ts`) | Correct boundedness; fast cache/dedup state is process-local. |
| Primary data | MySQL/TiDB via Drizzle; user-scoped schema indexes | Good basic keys, but several hot global/order scans and app-side filtering remain. |
| Files | Server requests Forge presigned URL then PUTs a constructed `Blob` to S3 (`server/storage.ts`) | Server buffers attachment/export bytes and introduces two server-side network hops per upload. |
| Deferred memory | Durable job rows, retries, atomic claim attempt (`server/db.ts`, `memory-extraction-schedule.ts`) | Better than pure in-memory background work; claim selection still reads a user’s job set before conditional update. |
| Observability | Privacy-safe aggregate counters/statuses and bounded technical events | Good privacy baseline; lacks capacity/SLO and saturation telemetry. |

## What is already strong

### 1. Data isolation and ownership boundaries

The schema contains explicit user/session foreign-key structure and useful access-path indexes, including chat `(userId, updatedAt)`, messages `(sessionId, createdAt)`, attachments `(userId, sessionId, createdAt)`, exports `(userId, createdAt)`, and several user/category memory indexes. Provider identities are keyed by provider subject rather than matching email. These choices support the existing multi-user boundary model and should be retained.

### 2. Bounded model and search behavior

Provider selection is allowlisted, cooldown-aware and explicitly budgeted. Search failures use a truthful freshness warning rather than silently serving model-trained stale material. RAG is optional and failure-isolated. This is appropriate graceful degradation: an upstream outage should reduce capability, not bypass policy or multiply network attempts.

### 3. Durable, privacy-aware deferred work

Memory extraction uses a persisted job row, duplicate enqueue tolerance and a conditional update claim. `listDueMemoryExtractionJobReferences()` returns a capped text-free batch (maximum 12); retries are capped at three and store a fixed error class, not message content. This is much safer than a fire-and-forget process-memory queue.

### 4. Existing idempotency primitives

The messages table has a unique `clientMessageId`; draft and provider-control entities have restrictive keys; memory job enqueue treats a duplicate assistant message as already queued/processed. These are concrete building blocks for duplicate mutation resilience.

### 5. Privacy-conscious observability

Technical events, provider daily usage, search status/quality records and extraction error classes deliberately avoid prompts, replies, URLs, secrets and raw provider errors. This is the correct foundation for adding scale metrics without producing a second user-data store.

## Demonstrated bottlenecks and scale risks

The following are code-observed risks, not predictions of a specific outage.

| Priority | Finding | Evidence | Why it matters at 10K–50K | Lowest-risk hardening direction |
|---|---|---|---|---|
| High | **Process-local state** | Provider health/cache/dedup, stream/replay/rate-related state are maintained in module/process memory. | Autoscale replicas do not share cooldown, dedup or per-user burst knowledge; restart loses it. | Enumerate each map/TTL; persist only coordination needing cross-instance correctness, keep local cache as optimization. Do not add Redis before measuring which state needs it. |
| High | **Full memory reads in chat context** | `buildChatContext()` calls `listMemoryEntries()` for facts and topics; helper selects all user/category rows. | Unlimited storage turns every chat into growing DB transfer, prompt construction and token cost. | Cursor/limit at retrieval; retain unlimited storage and UI pagination. Use explicit recency/relevance budget for model context. |
| High | **App-side memory dedup scans** | `upsertMemoryEntry()` reads all entries in a user/category and finds match in JS. | Auto extraction cost grows linearly with one user’s memory corpus; concurrent jobs amplify it. | Target lookup by normalized stable key/value; add a carefully designed unique/composite index after migration review. |
| High | **Full session message read for one extraction turn** | `getMemoryExtractionJobTurn()` selects all session messages and then finds two ids in JS. | A long chat produces avoidable read/parse cost for every deferred extraction. | Fetch the two message ids directly with server ownership check; retain existing job semantics. |
| High | **Long-lived SSE without capacity gates** | Streaming response remains active through provider/context lifetime. | 10K concurrent streams can exhaust file descriptors, memory, upstream slots or autoscale instance concurrency before database limits. | Add measurable per-user and per-instance concurrency caps, queue/reject policy and cancel propagation before load test. |
| Medium | **Global due-job order query lacks matching global due index** | Scheduler queries `status` + `runAfter` globally; schema index is `(userId, status, runAfter)`. | At backlog growth MySQL may scan/sort more jobs than its capped batch needs. | Validate `EXPLAIN`; if confirmed, add index `(status, runAfter, createdAt)` in one additive migration. |
| Medium | **Claim selection is bounded globally but not per-user** | `listDue...` is capped; `claimMemoryExtractionJob()` selects all jobs for one user before conditional update. | Atomic update prevents duplicate winner, but a heavy user can create scan work. | Query due candidate with SQL predicate/order/limit; preserve conditional update. |
| Medium | **Server-buffered file paths** | `storagePut()` constructs a `Blob` from a Buffer/Uint8Array/string; attachment/vision paths assemble content server-side. | Parallel image/document uploads can create memory spikes and two synchronous remote calls per file. | Enforce aggregate request byte/concurrency limits; favor client-to-presigned S3 for user uploads after authorization design review; stream where supported. |
| Medium | **Search and RAG add serial external latency** | Context awaits live search for freshness and then optional RAG; search cascade is sequential. | Slow upstreams retain SSE capacity and multiply outbound requests during burst traffic. | Maintain existing timeout budget; add per-request cancellation, bounded query cache/singleflight only with privacy-safe keys and explicit TTL. |
| Medium | **Exports use server work and artifacts** | Owner-scoped artifact generation/storage lifecycle. | Repeated export generation can consume CPU/memory and Forge/S3 request budget. | Maintain owner scope; add per-user export creation concurrency/idempotency and explicit artifact size/time metrics. |
| Medium | **Provider health coordination** | Persisted state exists, but in-memory hydration/refresh dedup remains replica-local. | Replica A can probe/cool while B still attempts a candidate. | Use DB state as authoritative for cooldown decisions; bound/reduce duplicate probes before any external coordinator decision. |
| Low | **Technical-event retention/count behaviour** | Bounded payload fields and time-window cleanup are present. | Aggregate volume can still become table/index churn under failures. | Add retention/size dashboard metric; validate cleanup cadence and indexes under synthetic error rate. |

## N+1 and read-shape findings

No obvious classical “loop one DB query per chat row” was established in the inspected hot paths. The more material issue is **full-list reads followed by JavaScript filtering**, which can be equally problematic at tenant growth.

| Path | Current read shape | Classification |
|---|---|---|
| Memory context | Two complete user-category lists each turn | Real growth bottleneck. |
| Memory write/dedup | Complete user-category list then JS comparison | Real growth bottleneck. |
| Extraction turn | Complete session message list then two-item lookup | Real growth bottleneck. |
| Attachment context | Up to four requested attachment IDs; image fetches parallel | Bounded, but byte-size/cumulative-memory risk remains. |
| Due extraction launcher | Globally capped text-free references | Positive bounded pattern; index alignment needs validation. |
| Chat/export/attachment lists | Ownership indexes exist; actual cursor behavior should be verified route-by-route before claiming 10K readiness | Not enough runtime evidence. |

## Concurrency, duplicate mutation and rate limiting

| Mechanism | Current assessment | Remaining gap |
|---|---|---|
| Memory enqueue | Duplicate assistant message is safely ignored. | No overall tenant queue depth/backpressure metric. |
| Memory claim | Conditional update on id/user/status prevents two workers from both winning the same observed state. | Initial candidate selection is not one atomic SQL `SELECT … FOR UPDATE SKIP LOCKED`; stale recovery is time based. |
| Chat idempotency | Unique client message identifier is a strong primitive. | Verify all client retry/cancel paths consistently carry it under real network loss. |
| Draft writes | User/chat scoped persistence avoids cross-user collision. | Add debounce/write-frequency telemetry before high-load claims. |
| Dev API limit | Persisted atomic fixed-window counter exists. | This is not evidence of a global chat/SSE/provider rate limiter. |
| General ingress | Some request/stream controls are process-local. | Need explicit distributed or DB-backed policy only if metrics prove multi-replica need. |

## Resource limits and graceful degradation

**Already good:** four-attempt provider cap; fixed memory extraction schema (max three facts); retry cap; text-free scheduler references; optional RAG; explicit freshness warning; owner-scoped artifact access; S3 URL authorization path.

**Not yet demonstrated:** total HTTP body limit, cumulative attachment bytes per turn, per-user concurrent stream ceiling, provider inflight ceiling, cancellation propagation to every upstream, database pool headroom, max event-loop lag, queue depth, and overloaded-instance rejection behavior. These must be measured, not assumed.

## Observability maturity

The project has a strong **privacy** posture, but not yet a complete **capacity operations** posture.

| Present | Missing for responsible scale validation |
|---|---|
| Provider health/status, fallback and aggregate usage | Request rate, active SSE gauge, connection lifetime, cancellation count |
| Bounded technical event classes | p50/p95/p99 stream time-to-first-token and completion latency |
| Search outage and quality aggregates | Queue depth/oldest job age/retry exhaustion |
| Flash TTFT metric | DB query timing/rows returned, connection-pool saturation, event-loop lag |
| Owner-only control/diagnostic surface | Per-instance resource/heap telemetry and autoscale/restart visibility |

All new telemetry should remain **aggregate or fixed-category**, exclude prompt/reply/email/file/URL content, and avoid high-cardinality user identifiers.

## Security and isolation under scale

The inspection found the existing server-derived authorization design to be the correct direction: it does not delegate user identity, owner authority or provider selection to the browser. User-scoped helpers, explicit owner checks and storage lookup-before-signed-access are important strengths.

Scale hardening must not convert protective paths into cache shortcuts. In particular: do not cache authorization by unverified client id; do not use email equality to bridge identities; do not expose provider raw errors; do not make attachment or export URLs globally reusable; do not replace remote Stytch session validation with an app-generated auth token. The existing Magic Link delivery block does not weaken the verified Email/Password or OAuth server boundaries.

## Recommended implementation order — pending approval

1. **Bound context and query shapes without limiting stored history.** Add cursor/limit helpers for memory/history UI; fetch only a documented context budget; replace full-session extraction read with two owned message lookups.
2. **Validate DB plans before schema changes.** Run `EXPLAIN` only on anonymized query shapes; add the global extraction due index only if plan confirms it. Review indexes for user/category/key lookup before migration.
3. **Add privacy-safe capacity instrumentation.** Active streams, queue depth/age, duration buckets, rejection/cancellation classes, payload-size buckets and DB timing without user content or identifiers.
4. **Add bounded ingress rules.** Define explicit behavior for too many active streams, excessive attachment bytes and duplicate client retries; retain the current four-attempt maximum.
5. **Run a controlled synthetic test.** Start with an agreed production-like staging profile, not 50K immediately. Include ordinary chat, stream cancel, long-history, memory extraction, attachment, search outage and fallback paths. Record only aggregate results.
6. **Decide whether shared coordination is necessary from data.** Redis/Reserved hosting/other external infrastructure is a later decision only if cross-replica metrics show the local coordination gap is a material limit.

## Explicitly not recommended now

- No Redis/PostgreSQL/VPS/AWS/paid service migration before measurements.
- No rewrite of the four-role router, provider health allowlist, search/RAG architecture, OAuth, Stytch Email/Password, drafts, export ownership or attachment authorization.
- No Redis-backed cache that might weaken auth or cross-user boundaries.
- No Stytch Magic Link delivery retry, support escalation, reactivation or provider-side mutation.
- No production build: the documented sandbox SIGTERM/resource blocker remains outside this audit.

## Audit closure condition

This read-only audit is complete once reviewed. It does **not** close capacity readiness. Readiness for a 10K–50K workload requires approved hardening, measured database/query plans, privacy-safe runtime metrics, and a separately authorized synthetic load result.
