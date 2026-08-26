# KAIREMA — instrumented non-production benchmark: результаты

**Дата запуска:** 2026-08-26  
**Статус:** **LOCAL SERVER-PATH PASS; PRODUCTION CAPACITY NOT VERIFIED**  
**План:** `reports/evidence/instrumented-nonproduction-benchmark-plan-2026-08.md`  
**Raw metadata-only data:** `reports/evidence/instrumented-nonproduction-local-results-2026-08.json`

## Итог и граница доказательств

Выполнен bounded instrumented non-production benchmark для tiers 10, 100, 1K, 10K и 50K synthetic actors. Он вызывает реальный `createChatStreamHandler` вместе с его serialization/SSE events, admission ordering, replay path, local SSE capacity guard и post-turn memory enqueue/processing contract. Repository, durable quota, storage-like metadata and DTO/pagination/memory paths заменены изолированными in-memory adapters; они не импортируют real database, storage, provider, search, auth SDK или production router startup.

Telemetry содержит только агрегаты и process samples: active synthetic sessions, concurrent requests, active SSE streams, capacity/rate outcomes, request latency, replay/mutation counts, metadata adapter counters, RSS и CPU. Prompts, responses, user content, memory content, tokens, secrets и raw payloads не записывались. `networkGuardBlockedAttempts=0`.

> Результат измеряет real handler control flow с in-memory dependencies в одном локальном process. Он не является измерением deployed HTTP/SSE, production database/storage, OAuth/Stytch validation, LLM/search/email, provider quotas, multi-pod coordination или настоящих 10K/50K sockets. Готовность к 10K/50K **не утверждается**.

## Фактические результаты по tier

`Handler latency` включает быстрые early 503 capacity responses, поэтому это latency dispatch/admission path, а не end-to-end streaming latency. `Capacity 503` — ожидаемое protective outcome local 12-stream guard, отдельно от unexpected errors.

| Tier | Logical ops / real handler dispatches | Local concurrency | Logical / handler dispatch RPS | Handler p50 / p95 / p99, ms | Capacity 503 rate | Unexpected errors | RSS delta | CPU user+sys | Peak SSE |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 10 | 1,000 / 20 | 10 | 262,665 / 5,150 | 0.073 / 2.381 / 2.395 | 0.0% | 0.0% | +0.26 MiB | 3.91 ms | 10 |
| 100 | 10,000 / 100 | 64 | 1,367,071 / 13,535 | 0.250 / 0.917 / 0.954 | 76.0% | 0.0% | +0.00 MiB | 15.07 ms | 12 |
| 1,000 | 100,000 / 1,000 | 64 | 1,459,424 / 14,450 | 0.219 / 0.393 / 5.215 | 97.6% | 0.0% | +2.38 MiB | 108.91 ms | 12 |
| 10,000 | 1,000,000 / 2,000 | 64, chunked | 2,045,384 / 4,083 | 0.194 / 0.647 / 0.853 | 98.8% | 0.0% | +28.40 MiB | 493.59 ms | 12 |
| 50,000 | 5,000,000 / 2,000 | 64, chunked | 2,113,749 / 845 | 0.125 / 0.280 / 0.800 | 98.8% | 0.0% | −61.95 MiB* | 2,425.25 ms | 12 |

\* Отрицательный delta означает, что during-run garbage collection освободил heap; это не свидетельство отсутствия memory usage и не может сравниваться с pod peak RSS.

Все measured handler p99 оказались ниже local 500 ms guard. Однако после 10 actors 64-worker burst быстро достигает local 12-stream admission limit, и большая часть handler dispatches корректно получает 503 до provider/history work. Поэтому low p99 на high tiers отражает в том числе скорость корректного early rejection и не должен интерпретироваться как capacity throughput.

## Admission, replay, memory and adapter telemetry

| Tier | Active sessions / concurrent peak | Quota calls / denials | Replay hits / assistant mutations | Memory enqueue / processed | Pagination / bounded memory reads | Attachment / export / draft / owner metadata operations |
|---:|---:|---:|---:|---:|---:|
| 10 | 10 / 10 | 10 / 0 | 10 / 10 | 10 / 10 | 180 / 160 | 80 / 50 / 80 / 20 |
| 100 | 50 / 50 | 88 / 0 | 12 / 12 | 12 / 12 | 1,800 / 1,512 | 800 / 500 / 800 / 200 |
| 1,000 | 64 / 64 | 988 / 0 | 12 / 12 | 12 / 12 | 18,000 / 15,012 | 8,000 / 5,000 / 8,000 / 2,000 |
| 10,000 | 64 / 64 | 1,988 / 0 | 12 / 12 | 12 / 12 | 180,000 / 150,012 | 80,000 / 50,000 / 80,000 / 20,000 |
| 50,000 | 64 / 64 | 1,988 / 0 | 12 / 12 | 12 / 12 | 900,000 / 750,012 | 400,000 / 250,000 / 400,000 / 100,000 |

`Replay hit` фиксировался только когда duplicate request завершался 200 без новой assistant mutation. In-memory quota contract не отказал ни одному distinct actor в этой workload; отказы high tiers классифицированы как capacity, не rate limiting. Pagination and bounded-memory counters — фактические вызовы synthetic metadata adapter, **не** database query telemetry.

## Отдельные saturation probes

| Probe | Фактический результат | Интерпретация |
|---|---:|---|
| 12 held streams per instance | 12 accepted | Actual handler local guard admits published per-instance limit. |
| Затем 4 distinct overflow streams | 4 rejected with 503 | Capacity protection activates before provider/history work. |
| 64-worker held-stream burst | 12 accepted, 52 rejected with 503 | **Observed local saturation point: 12 active streams per instance.** |
| Третья concurrent stream одного actor | 1 rejected with 503 | Actual handler respects published 2-stream per-user guard. |
| Network guard | 0 blocked attempts; no calls attempted | The benchmark did not invoke network APIs. |

## Что измерено, что смоделировано, что недоступно

| Область | Статус | Пояснение |
|---|---|---|
| Handler admission/order, SSE serialization/events, local capacity guard, cached/durable replay ordering and post-turn memory contract | **MEASURED ON REAL HANDLER** | Реальный `createChatStreamHandler` executed with injected in-memory dependencies. |
| 12/instance, 2/user и 64-worker saturation | **MEASURED ON REAL HANDLER** | Held provider stub isolates concurrency without external LLM call. |
| Per-operation DTO/pagination/memory/attachment/export/draft/owner aggregate counters | **MEASURED ON ADAPTER** | Реальные synthetic adapter calls; no real DB/storage backend. |
| Durable quota | **SIMULATED CONTRACT** | In-memory atomic fixed-window adapter replaces `chat_stream_rate_windows`; no real DB commit/lock/query plan. |
| DB query count/latency, index/lock/connection-pool metrics | **NOT MEASURED** | Real database access prohibited by scope. |
| S3/object throughput and storage bytes | **NOT MEASURED** | Metadata only; no objects or attachment/export bytes. |
| HTTP ingress, real socket load, TTFT, streaming model latency and providers | **NOT MEASURED** | No deployed endpoint, real socket fan-out or external network. |
| 10K/50K concurrent users and multi-pod coordination | **NOT MEASURED** | Population was chunked at 64 workers. |
| Production CPU/RSS/event-loop/pod metrics | **NOT MEASURED** | Only local short-process RSS/CPU deltas are available. |

## Observed bottleneck — record only

The benchmark found one clear limit: at a 64-worker held-stream burst the local capacity guard admits 12 streams and rejects 52 with expected 503. This is the intended safety boundary for a 1 vCPU / 512 MB process, not a failure to be bypassed. The high 76.0%–98.8% controlled 503 rate under the test's instantaneous burst demonstrates that a single instance cannot be presented as a 64-stream sustained admission target.

No architecture, limit, provider policy, DB schema or transcript-window behavior was changed to improve the figure. The next low-risk step is only to **record and review** an explicit queueing/admission SLO for a separately approved non-production test. It must not alter the 12/2 guard or proceed to transcript-window policy without a new decision.

## Validation and preserved invariants

| Validation | Result |
|---|---|
| Focused instrumented harness regression | **PASS** — 2 tests; real handler, metadata-only output, 12/2 and 64-worker probes. |
| `pnpm check` | **PASS** |
| `git diff --check` | **PASS** |
| Provider-oriented / real-network tests | **EXCLUDED FROM EVIDENCE** |
| Production build | **NOT RUN** — existing SIGTERM/resource blocker; out of scope. |

Production runtime behavior was not changed. Four roles Flash/Think/Context/Apex, maximum four real LLM attempts, provider health/allowlists/fallback chains, search/RAG, Unified Memory, Google OAuth, Stytch Email/password, attachments, exports, drafts and owner controls remain unchanged. Stytch Magic Link remains **EXTERNAL BLOCKED / UNTOUCHED**: no resend, provider mutation, Support escalation, mailbox/link/token access or flow change.

## Stop condition

The requested benchmark is complete. It stops at the documented 12-stream local saturation finding. No transcript-window policy work is included or authorized by this result.
