# KAIREMA — isolated synthetic load test plan

**Дата:** 2026-08-26  
**Статус:** **APPROVED FOR LOCAL DETERMINISTIC EXECUTION**  
**Цель:** получить ограниченные, воспроизводимые local benchmark evidence для риска роста, не меняя production runtime и не выдавая simulation за production capacity certification.

## Неподлежащие изменению границы

| Граница | Правило |
|---|---|
| Production runtime | Не меняется: нет router/schema/migration/auth/provider/storage изменений, не запускается production build. |
| Данные | Используются только deterministic synthetic actor IDs, chat IDs и metadata в локальной памяти. Реальные users, chats, memory, attachments, exports, drafts и owner aggregates не читаются и не изменяются. |
| Сеть | Harness не импортирует Kairema provider, search, email, auth SDK, storage или database client и устанавливает fail-fast guards для `fetch`/HTTP(S). LLM, search, RAG, email и real external providers не вызываются. |
| Quotas | Нет реальных provider quota, email delivery, S3 object или DB write. Входная rate/SSE policy моделируется только по опубликованным server constants. |
| Инфраструктура | Нет Redis, PostgreSQL, VPS, AWS или paid service. Benchmark выполняется локально в sandbox как короткий процесс. |
| Интерпретация | Любое число относится только к deterministic in-memory model на текущем sandbox. Оно не является throughput, RPS или concurrency гарантией deployed Autoscale pod. |

## Модель workload

Каждый synthetic actor выполняет воспроизводимый сценарий из 100 логических операций. Содержимое — короткие нейтральные synthetic tokens; ни prompt, ни user text, ни attachment bytes не используются.

| Операция | Доля | Что моделируется | Что намеренно не выполняется |
|---|---:|---|---|
| Session validation | 12% | Проверка synthetic authenticated context и user-scoped key. | Manus OAuth/Stytch remote session verification. |
| Chat list/read | 18% | Owner-scoped list/read metadata и query-count model. | Реальный TiDB/MySQL read. |
| Chat create | 8% | Создание synthetic session metadata. | Реальная запись. |
| Message ingress/mutation | 20% | Idempotent client message key, user/assistant synthetic rows, durable extraction enqueue model. | LLM, SSE response, history/context DB read, search/RAG. |
| Memory read/extraction | 15% | SQL-window-sized facts/topics, extraction turn и CAS job model. | Реальный extraction model call и memory DB write. |
| Attachment metadata | 8% | Owner-scoped metadata/read/delete accounting. | Upload/download, S3/sign URL и file bytes. |
| Export history/create | 5% | Owner-scoped metadata/create accounting. | Markdown/PDF generation, S3 write, artifact signing. |
| Drafts | 8% | User/chat-scoped draft upsert/clear accounting. | Реальная DB write. |
| Owner aggregate metrics | 2% | Aggregate-only synthetic counter. | Реальная owner panel query/event log. |
| Duplicate/retry | 4% | Duplicate clientMessageId must give one logical mutation; retries are counted separately. | Real network retry. |

## Population and concurrency tiers

| Tier | Synthetic population | Executed logical operations | Local worker concurrency | Stream saturation scenario | Classification |
|---:|---:|---:|---:|---|---|
| 10 | 10 | 1,000 | 10 | 10 requested streams; below per-instance limit. | Measured local model. |
| 100 | 100 | 10,000 | 32 | 16 cross-user requests plus a same-user third request; tests 12/instance and 2/user policy. | Measured local model. |
| 1,000 | 1,000 | 100,000 | 64 | Same bounded saturation burst and retry mix. | Measured local model. |
| 10,000 | 10,000 | 1,000,000 | 64 | Population is exercised in chunks; not 10,000 simultaneous sockets. | Measured population model; true concurrency simulated only. |
| 50,000 | 50,000 | 5,000,000 | 64 | Population is exercised in chunks; not 50,000 simultaneous sockets. | Measured population model; true concurrency simulated only. |

The 64-worker ceiling protects the 1 vCPU / 512 MB sandbox and deliberately prevents accidental claims of 10K/50K real concurrent connections. The production local SSE guard remains 12 active per instance and 2 per user; the benchmark will report modelled acceptance/rejection, not a distributed pod-wide measurement.

## Measurement contract and gates

| Metric | Collection method | Local health gate | Status interpretation |
|---|---|---|---|
| Throughput / logical RPS | `performance.now()` around completed in-memory operation batches. | Report only; no production threshold. | Harness-only measurement. |
| p50/p95/p99 operation latency | Per-operation in-memory latency samples. | p99 under 250 ms through 1K, under 1 s for chunked 10K/50K runs. | Detects local harness regression, not API latency. |
| Error rate | Expected and unexpected synthetic outcomes counted separately. | 0 unexpected errors; controlled duplicate/saturation outcomes must match model. | Correctness gate. |
| Query count | Explicit deterministic query-cost model per logical operation. | Total and per-op distribution recorded. | **Simulated**, not DB telemetry. |
| Storage growth | Logical synthetic metadata bytes, no byte payload/file/object. | Report total and per-operation. | **Simulated**, not S3/TiDB growth. |
| Process memory / CPU | `process.memoryUsage()` and `process.cpuUsage()` deltas per tier. | RSS growth no more than 128 MiB/tier; process exits after run. | Local sandbox sample only. |
| SSE/concurrency saturation | In-memory mirror of current 12/instance, 2/user admission numbers. | Expected 12/instance cap and per-user third-request rejection. | Policy model; real handler is separately regression-tested. |
| Duplicate/retry correctness | Synthetic clientMessageId map records logical effects once. | All duplicate pairs result in exactly one logical mutation. | Model plus existing behavior regression coverage. |

## Explicitly unavailable or out of scope

| Metric or behavior | Why unavailable in this execution |
|---|---|
| Deployed HTTP RPS, p50/p95/p99 API/SSE latency, time-to-first-token and long-lived socket count | The benchmark is no-network/in-memory and does not use the deployed autoscale service. |
| True 10K/50K concurrent users or multi-pod coordination | Current sandbox is one short-lived 1 vCPU/512 MB process; chunked workers deliberately replace socket fan-out. |
| Real DB query count/latency, connection-pool headroom, `EXPLAIN`, lock waits and storage size | Reading or mutating real database data is prohibited by this plan. |
| Real S3 throughput/storage growth and attachment/export bytes | No storage APIs or bytes are used. |
| OAuth/Stytch remote validation, provider health, LLM, search/RAG, email or quota behavior | All would require external requests and are prohibited. |
| Autoscale CPU/RSS, event-loop lag and pod saturation | No production telemetry endpoint is introduced in this stage. |

## Acceptance statement

The execution is useful only if it remains deterministic and no-network, records every listed tier, distinguishes measured from simulated metrics and produces zero unexpected synthetic errors. A PASS result does **not** establish 10K/50K readiness. A later capacity claim requires an approved controlled test against an instrumented non-production environment with explicit SLO, DB/storage telemetry and external-provider stubs.
