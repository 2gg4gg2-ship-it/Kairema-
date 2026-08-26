# KAIREMA SCALE & STABILITY — admission, gauges и DB/storage evidence

**Дата:** 26 августа 2026 года.  
**Статус:** evidence-only этап завершён; никаких transcript-window policy, memory-dedup index, новой инфраструктуры, migration или изменения provider/search/auth flow не выполнялось.

> **Классификация результатов.** «Измерено» означает локальное детерминированное измерение изолированного in-memory adapter либо focused regression. «Смоделировано» означает synthetic semantic model, не реальную базу данных, S3, сеть или production workload. «Не измерено» означает, что для метрики не было допустимого безопасного способа получить значение в данном этапе. Ни один результат ниже не является заявлением production-capacity для 10K или 50K пользователей.

## CURRENT SSE ADMISSION

Текущий путь SSE сохраняет установленный порядок: verified server-derived identity и input validation, затем local/persisted replay short-circuit, затем durable per-user quota, затем local active-stream admission, и только после успешного reservation — history/context/provider. При переполнении active-stream guard ответ **503** формируется до history/context/provider; reservation освобождается в `finally`. Ограничения остаются **12 активных streams на process instance** и **2 на verified user в process instance**. [1] [4]

| Свойство | Статус | Фактическая граница/результат |
|---|---:|---|
| Проверка identity до admission | Измерено/проверено тестами | server-derived verified user предшествует quota и capacity path |
| Durable quota до capacity | Проверено исходником и focused suite | отказ quota не запускает history/context/provider |
| Local capacity | Измерено focused tests | 12 process-local streams; 2 streams на user bucket |
| Освобождение reservation | Измерено focused tests | release выполняется в `finally` на completion/cancel/error |
| Кросс-реплика coordination | Не измерено/отсутствует | process-local guard не видит другие pods |

## NEW ADMISSION POLICY

Рассмотрена bounded queue/wait policy. Она **не добавлена**: локальная очередь была бы неравномерной между pods, теряла бы ожидания при restart, удерживала бы HTTP/SSE resources на длительном provider stream и не могла бы корректно координироваться без запрещённой распределённой инфраструктуры. Сохранена простая policy: немедленно принять запрос в имеющийся local budget или вернуть controlled pre-provider **503**. Queue gauges поэтому намеренно фиксированы в нуле: `entered=0`, `timedOut=0`, `waitSamples=0`. [1]

Это low-risk решение не меняет четыре public roles Flash/Think/Context/Apex, лимит до четырёх LLM network attempts, Provider Health/allowlist, fallback chains, search/RAG, Google OAuth, Stytch Email/password, drafts, attachments, exports или owner mapping.

## ADMISSION SLO TARGETS

Следующая таблица задаёт **операционные policy targets**, а не измеренную production SLO. Для настоящих latency/error SLO понадобятся согласованные production telemetry и multi-replica measurement; их на этом этапе не добавляли.

| Target | Статус | Условие |
|---|---:|---|
| Admission decision без очереди | Policy target | accept либо 503 принимается до history/context/provider |
| Instance budget | Enforced | active streams не превышают 12 в одном process |
| User fairness floor | Enforced | один user не занимает более 2 local streams |
| Exhaustion behavior | Enforced | controlled 503 без провайдера и без тяжёлого context path |
| Cleanup | Enforced | terminal stream outcome освобождает reservation в `finally` |
| Cross-pod fairness / global queue latency | Не измерено | требует распределённого coordination, сознательно не добавленного |

## STREAM/QUERY GAUGES

Owner-only observability дополнена bounded process-local snapshot из `chat-stream.ts`. В нём есть текущие active streams и active user buckets, aggregate outcome counters, replay/rate/quota/capacity counters, bounded duration/start-latency quantiles и queue-zero declaration. Duration samples ограничены 128 значениями; state очищается при restart/reset и не является durable или cross-pod telemetry. В snapshot намеренно отсутствуют user IDs, session IDs, prompts, responses, memory content, token counts, secrets и raw payloads. Snapshot добавлен только к уже owner-guarded observability response и отображается компактными aggregate cards. [4]

| Gauge family | Scope/retention | Privacy boundary | Статус |
|---|---|---|---:|
| Active streams и active user buckets | Один process, текущий state | Только количества | Измерено focused test |
| Accepted, rate-limited, quota-unavailable, capacity rejected | Один process, reset on restart | Только counters | Измерено focused test |
| Replay completed/pending/stored | Один process, reset on restart | Только counters | Измерено focused test |
| Completion/cancel/fail и p50/p95/p99 duration/start latency | Max 128 samples | Без IDs и content | Измерено focused test |
| Queue counters | Один process | Только три нулевых counters | Policy declaration; queue отсутствует |

## DB BENCHMARK WORKLOAD

Benchmark запущен локально direct `tsx` entrypoint с global fetch guard. Он не импортирует production router/DB/storage/providers, не использует реальные users, database, S3, OAuth, Stytch, LLM, search или email. Каждая tier содержит 100 logical operations на synthetic actor; maximum 64 logical workers ограничивает local execution. Всего выполнено **6 111 000 logical operations** для 10/100/1K/10K/50K actors. Raw artifact — строгий JSON без package-manager banner; `networkGuardBlockedAttempts=0`. [2] [3]

| Workload path | Модель на actor | Что именно отражает |
|---|---:|---|
| Session validation | 12 | User-scoped admission prerequisite |
| Owner-scoped chat list / pagination read | 18 | Semantic query units, не SQL execution plan |
| Chat create | 8 | Synthetic metadata mutation |
| Message mutation + durable replay read | 20 + 10 | Duplicate/replay semantics |
| Memory extraction pair + CAS | 10 + 10 | Bounded turn lookup и one-winner contention |
| Bounded memory fact/topic read | 5 | Context-shaped bounded retrieval model |
| Attachment/export metadata | 8 + 5 | Только metadata; binary/S3 bytes исключены |
| Draft upsert / owner aggregate | 8 + 4 | User/chat scope и aggregate-only owner view |
| Cross-actor denial | 2 | Negative authorization path |
| Shared CAS contention | 64 contenders/tier | 1 winner, 63 losers |

## DB BENCHMARK RESULTS

Значения latency, RPS, CPU/RSS и metadata bytes ниже **измерены только для локального in-memory adapter**. Они полезны для выявления роста synthetic traversal и ошибок модели, но не являются DB latency, IOPS, SQL query time, S3 throughput, pod CPU utilization или capacity test. `Semantic query units` — счётчик adapter paths, а не фактические query calls к TiDB/MySQL.

| Actors | Logical ops | Workers | Elapsed ms | Logical RPS | p50 / p95 / p99 ms | Semantic query units | Synthetic metadata | RSS Δ | CPU ms | Unexpected errors |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 10 | 1,000 | 10 | 1.314 | 761,144 | 0.00016 / 0.00056 / 0.00395 | 1,264 | 5,784 B | 0 B | 1.312 | 0 |
| 100 | 10,000 | 64 | 4.463 | 2,240,407 | 0.00008 / 0.00023 / 0.00042 | 12,064 | 57,680 B | 1.86 MiB | 8.778 | 0 |
| 1,000 | 100,000 | 64 | 21.794 | 4,588,334 | 0.00008 / 0.00013 / 0.00020 | 120,064 | 576,576 B | 4.89 MiB | 33.113 | 0 |
| 10,000 | 1,000,000 | 64 | 141.385 | 7,072,902 | 0.00004 / 0.00011 / 0.00018 | 1,200,064 | 5.50 MiB | 4.13 MiB | 145.011 | 0 |
| 50,000 | 5,000,000 | 64 | 803.189 | 6,225,184 | 0.00004 / 0.00008 / 0.00013 | 6,000,064 | 27.49 MiB | 36.03 MiB | 826.450 | 0 |

Рост query units почти линейный, потому что workload фиксирован: 120 semantic units на actor плюс 64 shared CAS attempts. Это **не доказывает** отсутствие N+1 или достаточность production indexes: in-memory adapter не моделирует SQL planner, locks, network latency, cold cache или storage transport. [2]

## CONCURRENCY RESULTS

Для каждой tier benchmark выполнил один shared 64-contender CAS probe: **64 contenders, 1 winner, 63 losers**. Все пять tiers сохранили этот результат без unexpected error. В модели также обработано 28 duplicate attempts на actor: всего 280 / 2,800 / 28,000 / 280,000 / 1,400,000 replay hits соответственно. Это доказывает только deterministic adapter semantics и отказ duplicate mutation в тестовом contract; не является измерением production transaction isolation или database lock contention. [2]

Реальный SSE saturation boundary измерен отдельно в предыдущем instrumented non-production handler harness: 12 held local streams допускаются, а overflow controlled 503; per-user boundary — 2. Этот этап не создавал 10K/50K sockets и не трактует 64 logical workers как 64 production concurrent HTTP connections. [4] [9]

## PAGINATION/HISTORY RESULTS

Synthetic workload выполнил 18 owner-scoped pagination/list reads на actor: от 180 для 10 actors до 900,000 для 50K actors. Это отображает **счётчик model paths**, не количество row scans. Source-level hardening ранее сузил replay path до owner-scoped lookup и ближайшего assistant pair вместо broad replay read. [5]

Текущий stream path всё ещё может читать полный session history там, где это нужно для ответа. Это остаётся фактическим source-level hotspot при очень длинных chats, а не найденной в этом benchmark SQL regression. Transcript-window policy сознательно **не вводилась**: benchmark не дал доказательства, достаточного для изменения user-visible history policy.

## MEMORY RETRIEVAL RESULTS

Каждый synthetic actor выполнил 5 bounded fact/topic reads: 50 / 500 / 5,000 / 50,000 / 250,000 по tiers. Модель не хранит memory content, а synthetic artifact содержит только aggregate counters и synthetic metadata bytes. Production context remains bounded by existing SQL windows: до **30 facts** и **15 topics**; это сохранённая boundary, а не новая policy. [5]

Не измерены actual memory table cardinality, SQL execution plan, cache hit rate, text bytes и prompt assembly bytes для production records. Поэтому benchmark не даёт основания вводить memory-dedup index или менять memory retrieval architecture.

## SECURITY/ISOLATION RESULTS

Negative cross-actor authorization model дала 20 / 200 / 2,000 / 20,000 / 100,000 expected denials по tiers, без unexpected error. Focused SSE/owner/benchmark tests проверяют owner-scoped access contracts, one-winner CAS/replay semantics и aggregate-only output. Это не заменяет penetration test реальной database, но подтверждает, что deterministic adapter не допускает synthetic foreign reads/mutations в закреплённом contract. [2] [5]

Проверка serialization runtime snapshot дополнительно подтверждает отсутствие user/session/content/prompt/response fields и тестовой русскоязычной строки. Owner surface остаётся закрыт existing owner guard; public endpoint не добавлялся.

## TEST RESULTS

| Проверка | Результат | Граница |
|---|---:|---|
| `server/chat-stream.test.ts` | PASS, 12 tests | Admission order, 12/2 capacity, cleanup, gauge privacy/counters |
| `server/owner-observability-controls.test.ts` | PASS, 6 tests | Owner guard и metadata-only owner response |
| `server/db-storage-benchmark.test.ts` | PASS, 1 test | Fetch guard, replay/CAS/isolation/aggregate artifact |
| Focused total | **PASS, 19 tests / 3 files** | No provider-oriented or real-network test included |
| `pnpm check` | **PASS** | TypeScript only |
| `git diff --check` | **PASS** | Whitespace/conflict check |
| Production build | **Не запускался** | Retained sandbox SIGTERM/resource blocker; не требовался user scope |

В `owner-observability-controls` mock environment напечатал known missing `OAUTH_SERVER_URL` stderr. Test завершился PASS; это не network call и не вход/авторизация пользователя.

## EXTERNAL BLOCKERS

| Blocker | Состояние | Следствие для evidence |
|---|---:|---|
| Autoscale multi-pod topology | Не наблюдалась в этом этапе | Local guard/gauges не дают global admission/fairness claim |
| Real DB/S3/network | Намеренно исключены | Нет DB query plan, lock, storage latency/throughput или provider evidence |
| Production build | Retained SIGTERM/resource blocker | Build completion не включён в evidence |
| Stytch Magic Link EmailDelivery HTTP 400 | External BLOCKED / не трогался | Не связан с benchmark; ни resend, ни provider request не выполнены |

## UNMEASURED METRICS

Не измерены и не должны читаться между строками этого отчёта: real 10K/50K concurrent users, sockets или SSE streams; multi-pod scheduler distribution; global rate-limit/fairness; database CPU/IO/locks/index usage; TiDB/MySQL query latency; S3 storage latency/egress; provider TTFT/end-to-end latency; real network RPS; memory/prompt text volume; production RSS/CPU across pods; and user-visible availability SLA.

## REAL BOTTLENECKS

Первый реальный enforced bottleneck — local SSE concurrency: 12 streams per process и 2 per user дают controlled shedding, но не cross-replica admission. Второй реальный source-level risk — full session history for long conversations; он не оптимизирован в этом evidence-only stage. Третий риск — отсутствие production DB/storage measurements: synthetic query units не могут подтвердить indexes, absence of N+1, lock behavior или capacity. Наконец, process-local gauges reset on restart и не являются durable monitoring.

Ни одна из этих находок не является основанием заявлять readiness к 10K/50K или добавлять Redis, queue, Postgres, VPS, AWS, paid monitoring либо другую инфраструктуру.

## LOW-RISK NEXT STEPS

Следующий отдельный этап, если будет одобрен, может сначала собрать read-only production-safe metadata или source-level SQL evidence для конкретного full-history query path и index coverage. Только при подтверждённой проблеме допустим узкий proposal, не реализация: bounded transcript-window policy с explicit product decision или отдельная index review. Вторым отдельным шагом можно определить cross-replica admission requirements и оценить platform-supported coordination, не создавая process-local queue как ложное решение. Третьим шагом может быть owner-visible durable aggregate telemetry только при наличии согласованного privacy-safe storage contract.

На этом этапе работа остановлена: transcript window, memory deduplication, Web Search changes, provider modifications, new migrations и new infrastructure не выполнялись.

## References

[1]: ./sse-admission-contract-2026-08.md "SSE admission contract"
[2]: ./deterministic-db-storage-benchmark-results-2026-08.json "Strict JSON result emitted by the isolated DB/storage benchmark"
[3]: ./deterministic-db-storage-benchmark-plan-2026-08.md "Deterministic DB/storage benchmark plan"
[4]: ../../server/chat-stream.ts "SSE handler, local guard and metadata-only snapshot"
[5]: ../../server/db.scale.test.ts "Source-level scale boundary regression"
[6]: ../../server/attachments.ts "Attachment limits"
[7]: ../../server/chat-exports.ts "Export limits"
[8]: ../../server/routers.ts "Chat ingress and attachment count limits"
[9]: ./instrumented-nonproduction-benchmark-results-2026-08.md "Prior real-handler no-network saturation evidence"
