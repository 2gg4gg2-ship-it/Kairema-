# Kairema: production topology, account metadata и Cloudflare Workers AI — follow-up audit

**Дата:** 27 августа 2026 года  
**Автор:** Manus AI  
**Статус:** завершённый **read-only evidence audit**. Это продолжение `ai-provider-model-capacity-audit-2026-08.md`, а не повторный inventory и не утверждение production capacity.

> **Краткий вывод.** Первый фактический *глобальный* потолок Kairema пока нельзя доказательно назвать: реальные Manus cloud-usage, число активных replicas, остатки LLM/search quota и reset timestamps не были доступны через безопасный owner-канал. Единственная наблюдаемая application boundary — **12 одновременных SSE streams в одном process** (и 2 на пользователя в этом process); это не platform-wide capacity и не число concurrent users. Cloudflare Workers AI — **реально независимый будущий ADD NOW CANDIDATE для отдельной feasibility-проверки**, но не готовая бесплатная production capacity и не разрешение на интеграцию.

## 1. Scope, method и классификация

Аудит ограничен официальной документацией, уже сохранёнными source-level evidence Kairema и безопасно видимыми owner metadata. Не выполнялись inference/LLM/search/API запросы, quota measurement, создание Cloudflare account/token/Worker, provider dashboard/API inspection, billing action, deployment/redeploy, изменение routing/models/fallback/quota/UI/schema/storage/infrastructure или production build. Magic Link Stytch и production-build SIGTERM остаются внешними, отдельными и нетронутыми blockers.

| Метка | Значение в этом отчёте |
|---|---|
| **VERIFIED** | Непосредственно подтверждено неизменённым Kairema source-level evidence либо безопасным техническим наблюдением. |
| **ACCOUNT-LEVEL VERIFIED** | Видимо в owner-интерфейсе текущего аккаунта, без обхода UI или mutation. |
| **DOCUMENTED** | Зафиксировано в официальном публичном документе; не доказывает состояние аккаунта Kairema. |
| **SIMULATED** | Результат ранее выполненного isolated no-network harness; не production throughput/capacity. |
| **ILLUSTRATIVE** | Формула или пример, который не является прогнозом или измерением. |
| **UNKNOWN** | Данных недостаточно; значение не выводится из модели, plan name или model ID. |

## 2. Production topology опубликованного Kairema

**ACCOUNT-LEVEL VERIFIED:** текущий проект задан как **Autoscale**. По официальной документации Manus этот mode использует Google Cloud Run, документированный диапазон составляет 0–5 instances, а базовая спецификация — 1 vCPU и 512 MB на instance; документация также указывает default US region и возможные cold starts.[1] Это определяет platform model, но не наблюдаемую в данный момент topology конкретного приложения.

| Вопрос | Evidence | Вывод |
|---|---|---|
| Published backend/runtime | ACCOUNT-LEVEL VERIFIED + DOCUMENTED | Kairema опубликован как Manus WebDev **Autoscale**; documented execution plane — Cloud Run.[1] |
| Число действующих instances/replicas | UNKNOWN | Возможны 0–5 по public default, но active/peak replicas, scale trigger и распределение запросов не видны. Нельзя предполагать один экземпляр. |
| Request distribution / sticky session | UNKNOWN | В доступных project/owner metadata и изученной public документации не найдено Kairema-specific гарантий affinity/stickiness. Stateful correctness не должна зависеть от process locality. |
| Restart/redeploy | DOCUMENTED + VERIFIED | Autoscale допускает scale-to-zero/cold start; process-local state не является durable. Kairema durable data хранит через managed DB/storage, но локальные gauges/guards сбрасываются с process lifecycle.[1] [2] |
| Persistent DB/storage | DOCUMENTED | Manus описывает managed backend, integrated persistent database и secure/scalable file storage.[2] Их tier, pool, IOPS, latency, region и actual consumption для Kairema — UNKNOWN. |

### Что означает «12 active SSE streams/instance»

**VERIFIED:** `server/chat-stream.ts` применяет module/process-local admission guard: максимум **12** active streams per process и **2** streams per user per process. До provider call проверяется durable user-scoped ingress window **60 chat requests/minute**; release stream-slot защищён `finally`. Это полезная защита от monopolization одной instance и от burst одного пользователя, но не distributed queue, не global concurrency cap и не доказательство того, что Cloud Run принимает лишь 12 SSE connections. При нескольких replicas aggregate SSE admission зависит от request placement и остаётся **UNKNOWN**. После restart/redeploy process-local maps/gauges обнуляются; durable ingress quota не является process-memory state.

> Следовательно, «12» — **локальная application policy**, наблюдаемая в source-level/benchmark evidence, а не подтверждённый лимит Manus или global production capacity.

## 3. Manus resource и cost visibility

Официальные материалы разделяют WebDev usage на cloud, AI и API consumption и направляют владельца к Website usage & billing dashboard для monitoring.[3] Public materials также говорят о shared monthly complimentary hosting/database cloud allowance, но это не измеряет текущий баланс или будущие расходы Kairema.[4] Владелецский shell безопасно показал только **Free plan** и уведомление, что free usage может иметь daily limit, зависящий от demand/system capacity; численное значение и reset period не отображались.

| Meter / question | Доступное evidence | Текущее значение |
|---|---|---|
| Project plan | ACCOUNT-LEVEL VERIFIED | Free plan. |
| Cloud runtime / hosting usage, allowance, remaining balance, reset | UNKNOWN | Kairema-specific panel/values не были доступны в исследованном read-only owner view. |
| Database usage, storage usage, bandwidth/egress | UNKNOWN | Public platform capability не равна current consumption или limit конкретного проекта.[2] |
| AI/API project consumption | UNKNOWN | В текущем view не видны Kairema counters, balance, hard/soft cap или forecast. |
| Что происходит при достижении account/project limit | UNKNOWN | Нельзя выводить из Free label, текущего deployment или public allowance. |

Владелец может вручную проверить в доступном **Website usage & billing** разделе только следующие значения: selected hosting mode и region; billing-cycle/reset date; cloud/runtime, database, storage и bandwidth usage versus included allowance; AI/API usage; лимит/остаток; soft/hard behaviour и надлежащие project-level notifications. Этот аудит не вычисляет цену, расход credits или стоимость пользователей; вопросы о тарифе/начислении следует направлять в [Manus Help Center](https://help.manus.im).

## 4. Account-level provider и search quota crosscheck

Ни один account/provider dashboard, secret, API counter, usage endpoint или reset timestamp не запрашивался. Поэтому ниже **не** приведён fictitious «remaining quota». Column *Documented limit* переносит только документальные результаты завершённого предыдущего audit; он не обновляет и не суммирует account capacity.

| Provider / active Kairema use | Documented limit / condition | Account-level observed remaining | Scope / reset | Confidence |
|---|---|---|---|---|
| OpenRouter `:free` | Shared public free pool: 20 RPM; documentation previously recorded 50 RPD without qualifying purchase or 1,000 RPD after qualifying historic purchase. | UNKNOWN | Account-wide free pool; Kairema purchase threshold/status and reset evidence unavailable. | DOCUMENTED / UNKNOWN |
| Groq GPT-OSS 20B / 120B | Public free table previously recorded 30 RPM, 1,000 RPD, 8K TPM and 200K TPD for each listed model row. | UNKNOWN | Docs describe organisation-level limits; independence of two model rows and actual entitlement are UNKNOWN. | DOCUMENTED / UNKNOWN |
| Google Gemini Flash Lite | Project/model/tier-specific quota policy exists. | UNKNOWN | Actual project tier, configured limit, remaining units and reset are UNKNOWN. | DOCUMENTED / UNKNOWN |
| OrcaRouter free routes | Workspace-scoped shared key bucket; numeric free caps unpublished; free traffic best-effort and mutable. | UNKNOWN | Fixed minute/day windows are documented, numeric value/reset timestamp unavailable. | DOCUMENTED / UNKNOWN |
| Dots reserve | Server-only Context reserve; its candidate cannot be reached after four real upstream attempts. | UNKNOWN | Quota cannot add normal post-fourth-attempt capacity. | VERIFIED / UNKNOWN |
| Search cascade: You → Serper → Exa → Tavily | Existing previous audit records documented Tavily 1,000 credits/month with a basic search costing one credit; other public tiers have qualification caveats. | UNKNOWN | Provider-level scope/actual balance/reset unknown for all four. Cascade may create more than one upstream attempt. | VERIFIED chain / DOCUMENTED / UNKNOWN |

The reference inventory, exact model chains and source citations are intentionally retained in the prior report rather than repeated here.[5] **VERIFIED crosscheck:** four public roles remain Flash/Think/Context/Apex; current routing has at most four real LLM attempts; Provider Health/cooldown and server allowlist remain server-side. **VERIFIED:** current search order is You → Serper → Exa → Tavily with local cooldown after 429/503 and bounded 25-second cascade behaviour. These controls bound some application amplification; they do not disclose upstream remaining quota.[5]

## 5. Current capacity crosscheck and first real bottleneck

Kairema already has user-scoped identity/memory, signed cursor pagination, bounded transcript selection, attachment isolation, owner-only operational probes, and bounded per-user ingress/SSE protections. Earlier no-network benchmarks were **SIMULATED** bounded harnesses; they explicitly did not claim production 10K/50K socket, database, provider or cloud capacity.[5]

| Layer | Confirmed control or condition | What it cannot prove | Potential bottleneck status |
|---|---|---|---|
| Per-user ingress | Durable 60 requests/minute before chat execution. | Daily/token/fallback fair-share and account-wide protection. | VERIFIED local product guard. |
| SSE streaming | 12/process; 2/user/process. | Aggregate concurrency across 0–5 Autoscale instances, actual pod count or platform connection ceiling. | VERIFIED per-process; global UNKNOWN. |
| LLM router | Four roles and max four real attempts; cooldown/fallback policy. | Provider availability, remaining quota, token throughput and shared-pool headroom. | VERIFIED policy; capacity UNKNOWN. |
| Search | Bounded ordered cascade, freshness policy and local cooldown. | Current remaining search allowance, external availability or aggregate cascade amplification. | VERIFIED policy; capacity UNKNOWN. |
| Runtime / DB / storage | Managed persistent components and documented Autoscale defaults. | Actual usage, saturation, regional placement, connection limits, IO or cost ceiling. | DOCUMENTED model; Kairema capacity UNKNOWN. |

**Answer to the main bottleneck question:** the first *globally binding, observed* ceiling is **UNKNOWN**. The earliest confirmed application-level rejection boundary is a per-process 12-stream guard (or a per-user 60/minute ingress guard for an individual noisy user). It may become user-visible before an external quota on a concentrated instance, but it cannot be promoted to a global ceiling because replica count and routing placement are unknown. Conversely, public LLM/search limits may bind first under distributed traffic, but account-level remaining quota is unknown. No claim that Manus runtime, Manus cost, LLM capacity or search is categorically first is justified.

## 6. Cloudflare Workers AI feasibility — no integration

Cloudflare Workers AI is documented as a serverless GPU inference product available on Free and Paid Workers plans, with a current catalog showing 85 models.[6] [7] Its public quota/billing plane is distinct from OpenRouter, Groq, Google and OrcaRouter. Therefore a qualified Cloudflare account and a non-paid-gated model would be an **independent vendor/quota-domain candidate**, not merely another model ID in an existing Kairema provider pool.

| Feasibility question | Evidence | Assessment |
|---|---|---|
| Free-first allocation | DOCUMENTED: 10,000 Neurons/day at no charge; reset at 00:00 UTC; relevant over-limit operations fail.[6] | Independent potential capacity, but not requests/day. |
| Requests/tokens/concurrency | DOCUMENTED: default text-generation rate limit 300 RPM with task/model exceptions.[8] Neuron coefficients vary by model/input/output.[6] | Request-equivalent capacity and quota-domain aggregation are UNKNOWN without selected model and bounded token budget. |
| Catalog / compatibility | DOCUMENTED: 85 model catalog entries; some overlap Kairema model families such as Gemma/GPT-OSS.[7] | Catalog entry is neither free eligibility nor functional/quality/streaming compatibility. Exact candidate is UNKNOWN. |
| Authentication | DOCUMENTED: Cloudflare account, Account ID and Workers AI API token are required for REST use.[9] | Would require a new server-side integration/secret, prohibited in this audit. |
| Payment behaviour | DOCUMENTED: some named frontier models require a paid billing method.[6] | A zero-unexpected-cost route must exclude those models and retain hard evidence for the selected model. Whether a payment method is mandatory merely for Workers Free is UNKNOWN from reviewed sources. |
| Geography / latency / SLA | DOCUMENTED global-network positioning.[10] | Kairema region, p50/p95 latency, availability/SLA, placement and user-country compatibility are UNKNOWN. |
| Data / commercial conditions | Inputs/outputs are Customer Content; Cloudflare says it does not train/improve models/services with it without explicit consent. Individual models may have their own licences.[11] | Model licence, applicable agreement/DPA, end-user/commercial compatibility and retention fit require a separate legal/security review; not approved by this audit. |
| Current Kairema integration | VERIFIED absent. | No Cloudflare account, token, Worker, REST call, billing activation, test inference or routing was created/changed. |

> **Classification: ADD NOW CANDIDATE — evidence task only.** Cloudflare Workers AI is the only new candidate that publicly establishes a separately administered daily free allocation rather than another ID in an existing pool. “ADD NOW” means *approve a separate, bounded feasibility/terms/security review if desired*; it does **not** mean add it to Flash/Think/Context/Apex, create an account or assume 10,000 chat turns/day.

## 7. Decision matrix

| Decision area | Verified / documented position | Decision now |
|---|---|---|
| **MANUS RUNTIME LIMIT** | Autoscale mode; public 0–5 instance default and 1 vCPU/512 MB per instance. Actual replicas/routing/stickiness/resource headroom UNKNOWN.[1] | **REQUIRES MORE EVIDENCE**; no runtime redesign or load test. |
| **MANUS COST LIMIT** | Free plan visible; project-specific meters/balance/reset/over-limit behaviour unavailable. | **UNKNOWN**; no price/credit claim. |
| **LLM PROVIDER CAPACITY** | Public constraints and shared-quota caveats documented previously; all actual remaining quotas UNKNOWN. | **REQUIRES MORE EVIDENCE**; do not add same-domain model IDs. |
| **SEARCH CAPACITY** | Existing cascade and some public plan figures known; current balances and aggregate usage UNKNOWN. | **REQUIRES MORE EVIDENCE**; do not reorder or cache now. |
| **CLOUDFLARE CAPACITY** | Separate 10,000-Neuron/day public allocation, 00:00 UTC reset, 300 default text RPM; model/token conversion and plan/terms fit unresolved.[6] [8] | **ADD NOW CANDIDATE** only for a separate feasibility gate; no integration. |
| **FIRST REAL BOTTLENECK** | Local 12-stream and 60/minute controls are verified; global runtime/provider/search/cost ceiling is not observed. | **UNKNOWN**. |
| **CAN BE SOLVED FOR $0** | Evidence review, documented-token budget design, fair-share/controller design and no-network compatibility plan can be planned without paid infrastructure. | **Not implemented in this stage.** |
| **REQUIRES PAID CAPACITY** | Named Workers AI frontier models require paid billing; sustained demand beyond free allocations may require paid capacity, but Kairema threshold is unmeasured.[6] | Do not commit to paid capacity without observed metering and a separately approved decision. |
| **REQUIRES MORE EVIDENCE** | Account-level usage/limits/resets; actual Autoscale topology; provider dashboards; Cloudflare selected-model compatibility, terms and security. | **Yes.** |

## 8. Narrow recommendation and stopping point

Adding new models/providers **now is not justified**. The current pool is not proven sufficient, but nor is it proven insufficient; the accountable answer is **UNKNOWN** without account counters and production-safe capacity evidence. A future capacity controller may improve fairness and cap fallback amplification, but it is deliberately not designed or implemented here. Adding additional IDs behind the same OpenRouter/Groq/Google/OrcaRouter quota domain would not establish new independent capacity.

The minimum next decision, if the owner requests it, is a **separate Cloudflare feasibility gate**: verify account/plan availability without billing activation, select a documented non-paid-gated text model, derive a strict per-turn Neuron envelope, check model licence/privacy/streaming/error compatibility, and define an explicit zero-spend failure policy before any secret or route change. A separate read-only access path to account-level Manus/provider dashboards would then be required to determine which observed meter, rather than the current local guard, is the first actual bottleneck.

This audit stops here. It makes no Cloudflare, provider, routing, controller, cache, global scheduler, Redis, PostgreSQL, VPS/AWS, monitoring, UI, schema, database, auth, deployment or billing change.

## References

[1]: https://manus.im/docs/website-builder/publishing "Manus WebDev publishing and hosting"

[2]: https://manus.im/docs/website-builder/cloud-infrastructure "Manus WebDev cloud infrastructure"

[3]: https://manus.im/docs/website-builder/getting-started/usage-and-pricing "Manus WebDev usage and pricing"

[4]: https://manus.im/blog/manus-hosting-web-builder "Manus hosting and Web Builder"

[5]: ./ai-provider-model-capacity-audit-2026-08.md "Kairema AI provider/model capacity audit — prior evidence"

[6]: https://developers.cloudflare.com/workers-ai/platform/pricing/ "Cloudflare Workers AI pricing"

[7]: https://developers.cloudflare.com/workers-ai/models/ "Cloudflare Workers AI model catalog"

[8]: https://developers.cloudflare.com/workers-ai/platform/limits/ "Cloudflare Workers AI limits"

[9]: https://developers.cloudflare.com/workers-ai/get-started/rest-api/ "Cloudflare Workers AI REST API quickstart"

[10]: https://developers.cloudflare.com/workers-ai/ "Cloudflare Workers AI overview"

[11]: https://developers.cloudflare.com/workers-ai/platform/data-usage/ "Cloudflare Workers AI data usage"
