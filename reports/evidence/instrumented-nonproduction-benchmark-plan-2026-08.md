# KAIREMA — instrumented non-production benchmark plan

**Дата:** 2026-08-26  
**Статус:** **APPROVED FOR BOUNDED LOCAL EXECUTION**

## Цель и границы

Этот этап дополняет предыдущую pure in-memory model ограниченным вызовом **реального** `createChatStreamHandler()` через dependency injection. Его цель — измерить serialization/SSE, admission order, idempotency/replay и local capacity behavior без запуска production server, без реального database/storage и без outbound network.

| Граница | Требование |
|---|---|
| Production behavior | Не меняется: никаких router, schema, migration, auth, provider, storage или limit changes. Новый код — отдельный script/test/evidence. |
| Реальный application seam | `createChatStreamHandler()` и его request parsing, SSE DTO serialization, durable quota dependency contract, active-stream guard, idempotency/replay order и post-turn memory enqueue/process order. |
| In-memory abstraction | Synthetic repository implements only the dependency surface used by handler: sessions/messages, quota window, replay lookup, memory extraction queue, pagination/memory/attachment/export/draft DTOs. Данные живут только в short-lived process. |
| Network / providers | `fetch`, `http` и `https` outbound entrypoints fail fast before dynamic loading handler. LLM/search/RAG/email/OAuth/Stytch/S3/real DB adapters не вызываются. Provider result — fixed local stub. |
| Privacy | Telemetry retains only counters, bounded timing values, response byte/event counts, error class and aggregate state. Не сохраняются prompts, responses, memory entries, tokens, user/session/client IDs, attachment/export names, secrets или raw payloads. |
| Tiers | 10, 100, 1K, 10K, 50K actors; 100 logical operations per actor in bounded chunks. 64 worker max. 10K/50K are population traversal, not socket concurrency. |

## Measurement matrix

| Path | Classification | Instrumentation |
|---|---|---|
| Chat message ingress/replay | **Actual handler + in-memory dependencies** | handler dispatch latency, SSE events/bytes, quota calls, append/list/context/extraction counters, replay hits and generic error classes. |
| Durable quota | **In-memory durable-contract simulation** | fixed-window per synthetic user, calls and denials; no real SQL upsert. |
| SSE capacity | **Actual handler local guard** | dedicated held-stream probes for 12/instance, 2/user and a 64-worker burst; accepted/rejected counts and max concurrent handler calls. |
| Chat pagination/read, memory retrieval, attachments, exports, drafts, owner aggregate | **In-memory application DTO adapter** | serialization latency, pagination cursor count, bounded fact/topic window, metadata byte model and error class counters. |
| DB/S3/network/provider runtime | **Unavailable by design** | explicitly not measured. |

## Local health gates

The gates diagnose harness correctness only: zero unexpected errors; all duplicate pairs produce one logical assistant mutation and one replay; saturation returns 4 instance and 1 per-user controlled rejections; p99 under 500 ms in each bounded tier; RSS delta under 128 MiB per tier. Passing them never establishes deployed capacity.

## Stop condition

If a bottleneck, error class or gate failure appears, record it and stop. Do not alter limits, database/schema, provider chains, transcript policy or production architecture to improve results.
