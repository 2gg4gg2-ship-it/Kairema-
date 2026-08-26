# KAIREMA — результаты isolated synthetic load test

**Дата запуска:** 2026-08-26  
**Статус:** **LOCAL MODEL PASS; 10K/50K PRODUCTION CAPACITY NOT VERIFIED**  
**Raw results:** `reports/evidence/synthetic-load-local-results-2026-08.json`  
**Workload/SLO:** `reports/evidence/synthetic-load-test-plan-2026-08.md`

## Вывод

Изолированный deterministic benchmark выполнен для populations **10, 100, 1,000, 10,000 и 50,000** synthetic actors. Он выполнил 6,111,000 логических операций в локальной in-memory model, не обращаясь к production runtime, реальной БД, storage, LLM, search/RAG, email, OAuth/Stytch или любому external provider. Счётчик harness зафиксировал **0 network attempts**; отдельный regression test подтверждает fail-fast при попытке использовать network entrypoint.

> Результаты измеряют скорость короткой deterministic JavaScript model в текущем sandbox. Они не измеряют deployed HTTP/SSE, TiDB/MySQL, S3, auth/provider latency, реальные 10K/50K sockets или работу нескольких autoscale pods. Поэтому они **не доказывают** готовность Kairema к 10K или 50K пользователей.

## Зафиксированный workload и SLO

Каждый actor выполнил 100 synthetic операций: session validation, chat list/read, chat creation, message ingress/mutation, memory read/extraction model, attachment metadata, export history/create model, drafts, owner aggregate metrics и duplicate/retry. Микс и допустимые local-only gates были утверждены до запуска в test plan: отсутствие unexpected errors; явная идемпотентность duplicate/retry; p99 менее 250 ms для tiers до 1K и менее 1 s для chunked 10K/50K; RSS delta менее 128 MiB на tier.

| Population | Операции | Local workers | Режим concurrency | Фактическая классификация |
|---:|---:|---:|---|---|
| 10 | 1,000 | 10 | Малый local batch. | **Measured local model** |
| 100 | 10,000 | 64 | Bounded worker pool, saturation burst. | **Measured local model** |
| 1,000 | 100,000 | 64 | Bounded worker pool, saturation burst. | **Measured local model** |
| 10,000 | 1,000,000 | 64 | Population processed chunked; не 10K sockets. | **Population measured; concurrency simulated** |
| 50,000 | 5,000,000 | 64 | Population processed chunked; не 50K sockets. | **Population measured; concurrency simulated** |

## Измеренные локальные результаты

Значения p50/p95/p99 ниже — **максимум среди пер-операционных percentiles** внутри tier, а не смешанный end-to-end API percentile. `Logical RPS` — скорость in-memory model и не является production RPS. CPU и RSS — deltas короткого локального процесса; 0.00 MiB означает измеренный delta, а не доказательство нулевого потребления памяти.

| Population | Duration | Logical RPS | max p50 / p95 / p99, ms | Unexpected error rate | CPU user+sys, ms | RSS delta | p99/RSS gate |
|---:|---:|---:|---:|---:|---:|---:|---|
| 10 | 1.379 ms | 725,385 | 0.0007 / 0.0011 / 0.0571 | 0% | 1.769 | 0.00 MiB | **PASS** |
| 100 | 6.218 ms | 1,608,181 | 0.0006 / 0.0012 / 0.0021 | 0% | 14.560 | 8.76 MiB | **PASS** |
| 1,000 | 25.908 ms | 3,859,740 | 0.0003 / 0.0006 / 0.0010 | 0% | 26.575 | 6.11 MiB | **PASS** |
| 10,000 | 273.308 ms | 3,658,879 | 0.0004 / 0.0009 / 0.0012 | 0% | 294.285 | 33.89 MiB | **PASS** |
| 50,000 | 1,599.345 ms | 3,126,280 | 0.0005 / 0.0011 / 0.0015 | 0% | 1,693.105 | 50.15 MiB | **PASS** |

Все p99 values находятся значительно ниже local model gates. Это показывает отсутствие алгоритмической ошибки или uncontrolled memory growth в harness при росте synthetic population; это **не** означает, что соответствующая latency достижима в реальном API.

## Query, storage, duplicate/retry и SSE saturation

| Population | Query model | Logical storage model | Duplicate attempts prevented | SSE saturation model | Статус |
|---:|---:|---:|---:|---|---|
| 10 | 13,300 | 2,240 B | 120 / 120 | 4 instance rejections; 1 third-stream same-user rejection | **PASS** |
| 100 | 133,000 | 22,400 B | 1,200 / 1,200 | 4 instance rejections; 1 third-stream same-user rejection | **PASS** |
| 1,000 | 1,330,000 | 224,000 B | 12,000 / 12,000 | 4 instance rejections; 1 third-stream same-user rejection | **PASS** |
| 10,000 | 13,300,000 | 2.24 MB | 120,000 / 120,000 | 4 instance rejections; 1 third-stream same-user rejection | **PASS, simulated concurrency** |
| 50,000 | 66,500,000 | 11.20 MB | 600,000 / 600,000 | 4 instance rejections; 1 third-stream same-user rejection | **PASS, simulated concurrency** |

Query count и storage growth являются явной **моделью**, а не DB/S3 telemetry. На 50K tier model даёт 13.3 logical query units на операцию; крупнейшие modelled contributors — message ingress/mutation (20.0M), chat list/read (16.2M) и memory read/extraction (11.25M). Это указывает на приоритеты будущего instrumentation, но не доказывает реальный database bottleneck.

Saturation scenario воспроизводит опубликованную local policy: максимум 12 active streams per instance и максимум 2 active streams per user. В ней ожидаемо фиксируются controlled rejections; они не учитываются как unexpected errors. Это model policy verification, тогда как реальный handler отдельно покрыт server regressions из предыдущего hardening package.

## Что фактически протестировано, смоделировано и не измерено

| Категория | Статус | Доказательство / ограничение |
|---|---|---|
| Workload mix, synthetic ownership keys, duplicate/retry logical effects | **FACTUALLY TESTED** | Все пять populations выполнены; 0 unexpected errors; duplicate prevention равен числу duplicate attempts. |
| In-memory latency, logical throughput, process CPU/RSS delta | **FACTUALLY MEASURED LOCALLY** | Raw JSON содержит per-tier duration, percentiles и Node process samples. |
| No-network contract | **FACTUALLY VERIFIED** | `blockedAttempts=0`; harness regression PASS подтверждает fail-fast на network entrypoint. |
| Query count and storage growth | **SIMULATED** | Это explicit query/storage cost model; реальная DB/S3 не импортировалась. |
| 10K/50K population traversal | **FACTUALLY MEASURED** | 1M / 5M logical operations реально выполнены. |
| 10K/50K concurrent users and SSE sockets | **SIMULATED / NOT MEASURED** | Worker ceiling 64; benchmark намеренно не создавал sockets. |
| HTTP RPS and API/SSE p50/p95/p99 | **NOT MEASURED** | Нет deployed endpoint или HTTP ingress в scope. |
| Real DB query count/latency, plans, locks and pool headroom | **NOT MEASURED** | Real database access запрещён планом. |
| Storage object growth/throughput | **NOT MEASURED** | Нет S3/files/bytes. |
| Remote auth, LLM, search/RAG, email, provider quota/health | **NOT MEASURED** | External network calls запрещены планом. |
| Pod peak RSS, event-loop lag and multi-pod aggregate CPU | **NOT MEASURED** | Локальный short process даёт только per-tier delta, не production telemetry. |

## Bottleneck interpretation и следующий low-risk шаг

Тест не выявил фактического production bottleneck: он исключил именно те components, где этот bottleneck должен проявиться. Он подтвердил, что current bounded local SSE policy и synthetic idempotency model не дают uncontrolled logical mutation growth при duplicate workload.

Следующий low-risk шаг — **не** увеличивать limits и не менять provider/storage architecture. Сначала следует согласовать отдельный non-production, instrumented benchmark: metadata-only latency/query counters, process/stream gauges и explicit transcript-window workload. После этого можно измерить реальный owner-scoped DB path и long-lived SSE без обращения к LLM/search/email/provider APIs. Любое решение об индексе для memory dedup или transcript-window должно оставаться отдельным reviewed design.

## Validation

| Проверка | Результат |
|---|---|
| Harness contract and fail-fast network guard | **PASS** — 2 tests. |
| All approved tiers | **PASS** — 10/100/1K/10K/50K, 6,111,000 operations total; `blockedAttempts=0`. |
| Focused no-network harness regression | **PASS** — 2 tests для tier contract и fail-fast network guard. |
| Wider regression command | **NOT USED AS NO-NETWORK EVIDENCE** — последняя широкая команда с неполным списком исключений запустила несколько provider-oriented test files, поэтому её результат не классифицируется как no-network и не используется для вывода benchmark. Новые provider-oriented test runs после обнаружения не выполнялись. |
| TypeScript | **PASS** — `pnpm check`. |
| Whitespace diff | **PASS** — `git diff --check`. |
| Production build | **NOT RUN** — сохранённый SIGTERM/resource blocker; не входил в scope. |

## Invariants

Production router/schema/auth/provider/storage code не менялись. Сохраняются четыре роли Flash/Think/Context/Apex, максимум четыре real LLM attempts, Provider Health/allowlists/fallback chains, search/RAG, Unified Memory, Google OAuth, Stytch email/password, attachments, exports, drafts и owner controls. Stytch Magic Link remains **EXTERNAL BLOCKED / UNTOUCHED**: без resend, provider mutation, Support escalation, mailbox/link/token access или flow change.

## Validation exception

После первоначального isolated execution была по ошибке запущена широкая Vitest-команда с неполным перечнем provider-test exclusions. Она включила provider-oriented test files и поэтому не отвечает согласованному no-network режиму. Их outcomes не использованы в benchmark evidence, и новые широкие/provider test runs после выявления не выполнялись. Этот incident не меняет production runtime и не затрагивает реальные пользовательские данные, однако он означает, что только focused harness regression, local benchmark, `pnpm check` и `git diff --check` следует считать compliant validation данного этапа.

## Заключение

Изолированный test plan и deterministic local benchmark завершены с корректной классификацией доказательств. Их результат — **PASS для local model correctness**, **NOT VERIFIED для production capacity**. Не следует утверждать готовность к 10K/50K до проведения отдельного approved instrumented non-production benchmark с реальным, но полностью stubbed external perimeter.
