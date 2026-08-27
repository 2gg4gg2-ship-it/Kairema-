# Kairema — read-only account-level Manus/WebDev usage and quota review

**Дата evidence-среза:** 27 августа 2026 (UTC).  
**Статус:** завершённый read-only audit.  
**Граница:** не выполнялись deployment, publish, rollback, настройка hosting, изменение тарифа, billing action, пополнение, запросы к LLM/search/email/provider, обращение к database/storage, генеративные запросы, изменение кода/routing/models/quotas/schema/UI или создание инфраструктуры.

> Этот отчёт фиксирует только то, что было безопасно видно в owner-интерфейсе и уже подтверждено source-level evidence. Отсутствие видимой метрики **не доказывает** ни нулевой usage, ни отсутствие лимита, ни достаточную capacity.

## 1. Executive result

В доступной owner-сессии был виден только общий label **Free plan**. Kairema-specific usage, applicable limits, reset period, cloud/runtime, database/storage, bandwidth/API, active replicas, throttling и resource-limit signals не были доступны в наблюдаемом интерфейсе. Поэтому фактические current usage, remaining allowance, cost и first production bottleneck остаются **UNKNOWN**.

Публичная документация описывает Autoscale как Cloud Run deployment с document-default **1 vCPU / 512 MB на instance** и autoscale диапазоном **0–5 instances**; это не подтверждает фактические replicas, регион, CPU/RSS, cold starts, database connections или throughput Kairema. [1] Existing Kairema safeguards ограничивают отдельные классы локальной нагрузки, но не образуют global multi-replica controller.

| Вывод | Классификация | Что это означает |
|---|---|---|
| В owner shell отображался общий `Free plan` | **ACCOUNT-LEVEL VERIFIED** | Это видимый account label, а не Kairema-specific balance, лимит или прогноз. |
| Kairema project usage/quota/cost/replica values | **NOT AVAILABLE / UNKNOWN** | Видимая owner home и доступный Projects route не отобразили эти поля. |
| Autoscale resource model 1 vCPU / 512 MB, 0–5 instances | **DOCUMENTED** | Платформенный default из документации; actual deployment state не измерялся. [1] |
| Current first production bottleneck | **UNKNOWN** | Без active replicas, p95 latency, CPU/RSS, DB/storage and upstream quota telemetry ранжирование было бы домыслом. |

## 2. Метод и ограничения доступа

Проверка ограничивалась уже доступным authenticated owner UI на `manus.im`. Были открыты general owner home и read-only project route, просмотрены уже отрисованные navigation/visible text и закрыт информационный overlay. Не открывались billing/settings/hosting controls, не совершались действия с проектом или аккаунтом. Подробный observation log находится в `reports/evidence/account-usage-quota-review-source-ledger-2026-08.md`.

| Поле, требуемое заданием | Результат read-only observation | Классификация |
|---|---|---|
| Текущий usage и applicable limit | Не отображены | **NOT AVAILABLE** |
| Reset period и remaining quota | Не отображены | **NOT AVAILABLE** |
| Hosting/runtime usage, CPU/RSS, cold starts | Не отображены | **NOT AVAILABLE** |
| Database/storage usage | Не отображены | **NOT AVAILABLE** |
| Bandwidth/API counters | Не отображены | **NOT AVAILABLE** |
| Autoscale/active replica information | Не отображено | **NOT AVAILABLE** |
| Throttling/resource-limit signals | Не отображены | **NOT AVAILABLE** |
| Условия поведения при platform limit | Для конкретного Kairema account не доступны; документированные Autoscale semantics — отдельно ниже | **UNKNOWN / DOCUMENTED** |

## 3. Что документировано о WebDev published runtime

Официальные страницы Manus описывают managed backend, persistent database и secure/scalable file storage как platform capabilities. [2] Publishing documentation описывает Autoscale и Reserved как различные hosting modes, а Autoscale — как elastic execution context with possible cold starts. [1] Это отвечает на вопрос о **типах** managed components, но не предоставляет показания их текущего consumption для Kairema.

Документация также разделяет Website usage/billing на cloud, AI и API consumption и указывает на Website usage & billing dashboard как место наблюдения. [3] В текущем owner access соответствующая Kairema-specific панель не была доступна. Этот audit не вычисляет, не оценивает и не прогнозирует billing/credits; для account-specific billing support следует использовать [Manus Help Center](https://help.manus.im).

| Компонент published Kairema | Документированная platform semantic | Что не подтверждено этим audit |
|---|---|---|
| Runtime / hosting | Autoscale Cloud Run default и resource envelope опубликованы | Actual instance count, region, start/stop count, CPU, RSS, request rate, errors. |
| Database | Integrated persistent database documented | Actual tier, connections, queries, locks, I/O, storage usage, limits. |
| File storage | Secure/scalable file storage documented | Object count, bytes, requests, transfer, access errors, limits. |
| AI/API | Public docs distinguish these usage categories | Kairema account usage, applicable limit, reset, remaining capacity and cost. |

## 4. Kairema safeguards: verified source-level crosscheck

Исходный код даёт контролируемые границы до provider streaming: server-derived authenticated user, owner-scoped session lookup, durable per-user request window, затем local SSE admission. `consumeChatStreamRequestQuota` выполняет atomic DB-backed increment с default **60 requests / 60 seconds per user**, а при недоступной quota-check handler возвращает controlled `503` до provider work. [4] `reserveActiveChatStream` затем допускает до **12 active streams per local process** и до **2 per user per local process**; saturation отдаёт controlled `503`. [5]

Эти значения являются защитой fairness/overload для одной process instance, не измерением platform capacity. Они не говорят, сколько instances сейчас активно, не суммируются в global limit и не доказывают допустимую concurrent-user нагрузку в production.

| Existing Kairema evidence | Статус | Связь с account-level review |
|---|---|---|
| Ровно Flash / Think / Context / Apex; не более 4 upstream LLM attempts | **VERIFIED, source-level** | Сдерживает максимум попыток на request, но не раскрывает provider remaining quota. |
| Provider Health, allowlists и cooldown | **VERIFIED, source-level** | Даёт controlled fallback behavior, не создаёт independent upstream capacity. |
| `60/min` durable per-user chat ingress quota | **VERIFIED, source-level** | Global для user via durable store; не является account-wide provider quota. [4] |
| `12/process`, `2/user/process` SSE admission | **VERIFIED, source-level** | Local process boundary only; actual active process/replica count **UNKNOWN**. [5] |
| Signed cursor history pagination | **VERIFIED, source-level** | Bounded UI history page avoids necessary full-history rendering; legacy compatibility reads persist. [6] |
| Role-bounded transcript window | **VERIFIED, source-level** | Limits LLM context candidates; does not measure tokens, model context or upstream speed. [6] |
| Durable replay/CAS-oriented duplicate protection | **VERIFIED, source-level** | Reduces duplicate work/retries; effectiveness under production traffic unmeasured. [5] |
| Graceful `429/503` before provider work | **VERIFIED, source-level** | Protects failure behavior, not a proof that saturation does not happen. [5] |
| Metadata-only owner observability | **VERIFIED, source-level** | Contains bounded local process gauges, not Manus account billing/usage or global telemetry. [5] |

## 5. Autoscale: what cannot be inferred

Autoscale documentation must not be interpreted as a live observation. It does not prove that Kairema currently has one, five or zero warm instances; it does not establish session affinity, shared in-memory state, real-time SSE affinity, global queue behavior or a universal concurrency ceiling. Likewise, `12 × 5 = 60` would be an **invalid capacity calculation** because it assumes the maximum replica count, simultaneous warmth, evenly distributed streams and no upstream/database/CPU limit.

| Inference proposed from Autoscale context | Audit result | Reason |
|---|---|---|
| “Kairema has five active pods” | **UNKNOWN / unsupported** | 0–5 is documentation default, not a live metric. |
| “Kairema can serve 60 simultaneous SSE streams” | **NOT VERIFIED** | Per-process limit cannot be multiplied by undocumented active replicas. |
| “Autoscale removes database/provider limits” | **False / unsupported** | Database, storage and upstream provider quota domains remain separate. |
| “No visible owner metric means no consumption” | **False / unsupported** | UI availability is not accounting evidence. |
| “Runtime is the confirmed first bottleneck” | **UNKNOWN** | CPU/RSS/replica/latency/saturation telemetry were not available. |

## 6. Current provider and search implication

The prior provider/model audit remains in force: current sustainable LLM capacity is **UNKNOWN** without provider account-level tier, remaining quota, reset and shared-domain evidence. The present Manus owner UI did not expose those provider values. Extra model IDs must not be counted as added capacity unless a new independent quota domain is proven.

The same rule applies to current search cascade: without provider-account counters, query quotas, reset, fallback-attempt share and freshness outcomes, sustainable search capacity is **UNKNOWN**. Existing policy and controlled fallback improve safety but cannot establish available provider headroom.

| Domain | Current status after this review | Evidence still required |
|---|---|---|
| LLM capacity | **UNKNOWN** | Read-only provider account quotas/tiers, reset periods, remaining quota and quota-domain independence. |
| Search capacity | **UNKNOWN** | Read-only current quotas/allowances, reset semantics, failure/throttle counters and cascade-attempt telemetry. |
| Manus runtime | **UNKNOWN** | Actual active replicas, CPU/RSS, request latency, errors/cold-start/overload signals. |
| Database/storage | **UNKNOWN** | Usage counters and read-only performance/limit metadata; no production query/load test in this scope. |

## 7. Concise decision matrix

| Decision area | VERIFIED | UNKNOWN | Next evidence needed |
|---|---|---|---|
| **MANUS RUNTIME** | Documented Autoscale default context; Kairema has local admission safeguards. [1][5] | Current instances, CPU/RSS, request latency, cold starts, saturation. | Read-only Kairema website runtime/usage panel, if exposed to owner. |
| **MANUS COST** | Public docs distinguish cloud, AI and API categories. [3] | Kairema balance, applicable allowance, reset, consumption and any account-specific billing fact. | Owner checks usage & billing dashboard; account-support questions via Help Center. |
| **LLM CAPACITY** | Four-role / max-four-attempt invariant and provider safeguards. | Actual remaining account capacity, tier, shared pools and reset. | Separate read-only provider dashboard/API metadata review, no inference. |
| **SEARCH CAPACITY** | Existing cascade/freshness safety design is retained. | Current provider quotas, fallback amplification and availability. | Separate read-only search-provider metadata review. |
| **REPLICA / CONCURRENCY** | `12/process`, `2/user/process`; durable `60/min/user` ingress gate. [4][5] | Active replicas and global concurrent streams. | Owner runtime telemetry plus non-production instrumented measurements. |
| **FIRST SUSPECTED BOTTLENECK** | Provider/search quota domains are already known external constraints. | Which domain fails first for Kairema. | Compare actual non-sensitive saturation/error counters against provider and runtime metadata. |

## 8. Owner manual checklist for unavailable fields

If an authorized owner can access a Kairema-specific Website usage & billing or runtime dashboard later, capture only the labels and non-sensitive numeric values below. Do not change plan, enable paid resources, rotate keys or invoke a provider merely to populate a field.

| Manual field to inspect | Record exactly | Do not infer |
|---|---|---|
| Project identifier and selected hosting mode | Label + displayed mode | Any actual replica count from mode alone. |
| Cloud/runtime usage and limit | Current displayed usage, limit, period/reset | CPU/RSS or concurrency if absent. |
| Database and storage | Displayed usage/limit and period/reset | Query throughput or attachment access rate. |
| Bandwidth/API | Displayed usage/limit and period/reset | Search/LLM use unless attribution exists. |
| Autoscale / replica / throttling | Current status, count or incidents exactly as shown | Global capacity from a configured maximum. |
| LLM/search provider dashboards | Tier, current quota, remaining quota, reset and explicit scope only | Combined capacity across models unless documentation proves independence. |

## 9. Final status and permitted next step

**Final status: `ACCOUNT USAGE METRICS NOT AVAILABLE IN CURRENT OWNER ACCESS`.** The only account-level numeric-like observation was the visible Free plan label. No evidence supports a claim that Manus runtime, database/storage, LLM or search is sufficient for any target population, nor that it is the first actual bottleneck.

The narrow next evidence step is a separate **read-only owner dashboard review** when a Kairema-specific usage/runtime panel is actually exposed. It should record only displayed account fields from the checklist and then be cross-checked against existing privacy-bounded Kairema observability. Cloudflare Workers AI integration, global WCU/capacity controller, shared search cache, fair scheduler, new infrastructure, Magic Link work and production-build SIGTERM diagnosis remain out of scope and untouched.

## References

[1] [Manus — Publishing and hosting](https://manus.im/docs/website-builder/publishing)  
[2] [Manus — Cloud infrastructure](https://manus.im/docs/website-builder/cloud-infrastructure)  
[3] [Manus — Website usage and pricing](https://manus.im/docs/website-builder/getting-started/usage-and-pricing)  
[4] `server/db.ts`, lines 266–320 and 980–994 (source-level evidence).  
[5] `server/chat-stream.ts`, lines 8–90 and 300–465 (source-level evidence).  
[6] `server/db.ts`, lines 266–320 (source-level evidence).
