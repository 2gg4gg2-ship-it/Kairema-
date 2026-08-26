# KAIREMA — deterministic DB/storage abstraction benchmark plan

**Дата:** 2026-08-26  
**Статус:** **APPROVED FOR ISOLATED EXECUTION**

## Scope and isolation

The benchmark executes only a local TypeScript in-memory adapter that mirrors the ownership, paging, replay, CAS, draft, attachment/export metadata and aggregate-read shapes of existing Kairema helpers. It does not import `server/db.ts`, database client modules, storage helpers, routers, providers, auth SDKs or network clients. It uses synthetic actor keys only in process memory and emits aggregate counters only.

| Boundary | Rule |
|---|---|
| Production runtime | No router, schema, migration, provider, auth, attachment or storage lifecycle change. |
| Database and storage | No connection, query, transaction, object, signed URL, upload or file bytes. Adapter counters are not DB telemetry. |
| Network | No imports/calls to HTTP(S), `fetch`, provider, search, email or telemetry service. Global `fetch` is fail-fast guarded during execution. |
| Data | No real users, chats, messages, memory, attachments, exports, drafts, prompts, responses, tokens, secrets or raw identifiers are written to the raw artifact. |
| Workload | 10/100/1K/10K/50K synthetic actors, 100 logical operations per actor, maximum 64 logical workers, and a separate 64-contender CAS/replay/isolation probe. |
| Interpretation | Results measure a deterministic local adapter. They cannot establish TiDB/MySQL/S3 latency, index behavior, locks, connection pools, deployed RPS, or production capacity. |

## Workload model

| Operation family | Modeled path |
|---|---|
| User-scoped chat reads/mutations | Direct owner index, chat create/read, paged message read, cross-user denial. |
| Message/replay | Synthetic client-message replay map with one logical assistant mutation per duplicate pair. |
| Durable-like quota and CAS | Fixed-window actor quota model and one-winner CAS job claim under 64 logical contenders. |
| Memory | Bounded fact/topic windows and owner-scoped extraction turn pair. |
| Metadata storage | Attachment and export metadata list/create/delete accounting; no object bytes. |
| Drafts and owner aggregates | User/chat draft upsert/clear and aggregate-only count read. |

## Measurements

Per tier the artifact records logical operations, bounded worker concurrency, adapter operation throughput, p50/p95/p99 sampled operation latency, expected versus unexpected error classes, semantic query-cost units, synthetic metadata-byte estimate, replay/dedup outcomes, CAS contention, isolation denials, CPU/RSS deltas and no-network guard state. The final report must label semantic query units and metadata bytes as **modeled**, not real DB/S3 measurements.

## Stop condition

This stage records bottlenecks only. It does not add an index, change memory dedup, introduce a transcript window, alter queue/admission behavior, add infrastructure, or change production architecture.
