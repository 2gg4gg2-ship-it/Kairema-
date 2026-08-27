# Kairema — final read-only capacity decision audit

**Дата:** 27 августа 2026 года  
**Статус:** evidence-only; production changes отсутствуют.  
**Решение этого этапа:** **B — CURRENT MANUS + PROVIDER EXPANSION**, но только как **evidence-gated направление**. Оно не является разрешением на интеграцию нового provider, Cloudflare account, billing, routing change, controller или cache.

> **Классификации.** **VERIFIED** — подтверждено исходным кодом, детерминированным no-network test или безопасно видимой project metadata. **DOCUMENTED** — опубликовано в официальной документации, но не доказывает состояние аккаунта Kairema. **NOT AVAILABLE** — поле не было доступно в разрешённом owner/provider UI. **UNKNOWN** — из доступных evidence его нельзя вывести. **ILLUSTRATIVE** — формула либо сценарная переменная, не measurement и не capacity claim.

## CURRENT VERIFIED STATE

| Область | Текущее состояние | Классификация | Граница вывода |
|---|---|---|---|
| Kairema runtime | Full-stack Node/Express/tRPC application с React/Vite client; server-side providers и user-scoped data paths существуют в проекте. | VERIFIED | Это не замер production CPU, RAM или tail latency. |
| Manus WebDev | Project mode отмечен как **Autoscale**. Официальная документация описывает Cloud Run, документированный диапазон 0–5 instances и 1 vCPU/512 MB на instance. [1] | ACCOUNT-LEVEL VERIFIED + DOCUMENTED | Фактические active replicas, region и autoscaling events Kairema не видны. |
| SSE | Admission guard допускает до **12 active streams/process** и до **2 streams/user/process**; переполнение получает controlled pre-provider 503. | VERIFIED | Это process-local boundary, не global concurrency limit. |
| DB/storage | Application использует managed persistent database и secure storage abstractions; Manus документирует integrated persistent database и storage. [2] | VERIFIED + DOCUMENTED | DB tier, connection pool, IOPS, storage volume и latency не доступны. |
| LLM provider pool | Ровно четыре public roles: **Flash, Think, Context, Apex**. Active candidates используют OpenRouter, OrcaRouter, Groq и Google; Context имеет Dots server-only reserve. | VERIFIED | Наличие model ID не доказывает независимую квоту. |
| Search pool | Текущий cascade: **You → Serper → Exa → Tavily**; поиск optional и имеет cooldown/degraded semantics. | VERIFIED | Это не подтверждает доступность, remaining credits или контентную свежесть каждого provider. |
| Fallback | Real LLM upstream budget ограничен **MAX_ATTEMPTS=4**; Dots не образует пятый реальный call после четырёх попыток. | VERIFIED | Bounded retries уменьшают amplification, но не создают upstream capacity. |
| Current quotas | Public quota policies сохранены в provider evidence ledgers; actual plan, remaining allocation, reset timestamps и shared-domain state каждого Kairema account не показаны. | DOCUMENTED + UNKNOWN | Их нельзя суммировать как current free capacity. |
| Current counters | No global provider/search budget, remaining-quota или cross-replica SSE counter был видим в approved evidence. | NOT AVAILABLE | Отсутствие display не означает нулевое потребление. |
| Production build | Retained separate **SIGTERM/resource blocker**. | VERIFIED BLOCKER | Production build не воспроизводился в этом этапе. |
| Billing/usage | В owner shell безопасно виден только общий label **Free plan**. | ACCOUNT-LEVEL VERIFIED | Cloud/AI/API balance, billing period, usage and forecast remain NOT AVAILABLE/UNKNOWN. |
| Replica topology | Документирован Autoscale 0–5 instances. [1] | DOCUMENTED | Actual count, session affinity, per-pod occupancy и production saturation remain UNKNOWN. |

Ниже приведён source-level инвентарь active LLM roles; он намеренно не заменяет quota-domain analysis.

| Роль | Active ordered chain | Ключевой capacity факт |
|---|---|---|
| Flash | OpenRouter GPT-OSS 20B free → OrcaRouter DeepSeek V4 Flash free → Groq GPT-OSS 20B → Google Gemini Flash Lite | Четыре vendors/paths, но их account-level limits не проверены. |
| Think | OpenRouter Gemma 4 26B free → OrcaRouter HY3 free → Google Gemini Flash Lite → Groq GPT-OSS 120B | New model ID внутри OpenRouter/Groq/Google не является доказательством нового quota domain. |
| Context | OpenRouter Nemotron 3 Ultra free → OrcaRouter DeepSeek V4 Flash free → Google Gemini Flash Lite → Groq GPT-OSS 120B → Dots reserve | После четырёх реальных upstream attempts Dots не достигается как пятый call. |
| Apex | OpenRouter Gemma 4 31B free → OrcaRouter DeepSeek V4 Pro free → Google Gemini Flash Lite → Groq GPT-OSS 120B | Фактические plan, balance и reset всех routes UNKNOWN. |

Сохранённые product invariants не менялись: server-side allowlists and Provider Health/cooldown, verified session identity, user-scoped memory, signed cursor pagination, bounded transcript window, owner-only exports/probes, secure attachments, Google OAuth, Stytch email/password, current search/RAG and draft autosave, zero client-side secrets.

## CRITICAL UNKNOWNS

| Неизвестный факт | Почему он critical для решения | Как получить безопасно позднее | Можно ли отложить? |
|---|---|---|---|
| Actual plan, remaining quota, reset and quota scope OpenRouter/Groq/Google/OrcaRouter/Dots | Определяет, имеет ли путь B какой-либо измеримый AI headroom и какие fallbacks действительно независимы. | Read-only provider owner dashboards; без key disclosure, inference или billing change. | Нет для production capacity decision. |
| Free eligibility и payment-method condition выбранной Cloudflare text model | Без этого Cloudflare AI не может считаться zero-unexpected-cost capacity. | Separate terms/account metadata review; без account creation или token. | Нет для Cloudflare addition. |
| Model-specific neuron budget per bounded Kairema turn | **10,000 Neurons/day** нельзя честно превратить в requests/day без input/output token bounds. | Future static budget design and non-production compatibility evidence. | Нет для numeric Cloudflare capacity claim. |
| Actual replicas, region and autoscale behaviour | Определяет global SSE concurrency и cold-start/tail latency effect. | Project/runtime observability metadata, затем authorized representative no-network benchmark. | Нет для external-hosting decision; да для immediate evidence report. |
| Production build cause and reproducibility | Без BUILD PASS нельзя подтвердить final production artifact path. | Retained separate build diagnosis only. | Нет перед production rollout; да для present architecture choice. |
| DB/storage tier, pool and production query/storage latency | Нужны для proof, что database/storage, а не provider quotas, являются bottleneck. | Read-only runtime/db metadata plus later authorized benchmark. | Нет для external migration decision; да для provider feasibility. |
| Demand distribution: DAU, requests/DAU, tokens, search share and arrival burst | Registered users не равны requests; без distribution нельзя рассчитать sustainable demand. | Privacy-safe aggregate telemetry policy, approved later. | Нет для 10K/25K/50K claim. |

**Безопасно откладываемые unknowns:** точное число catalog models у vendors, cosmetic provider dashboard fields, price forecast, максимальное число theoretical model IDs, и speculative external-hosting comparisons. Они не меняют вывода, что current capacity не доказана и migration не доказанно выгодна.

## MANUS RUNTIME ASSESSMENT

Manus не доказан bottleneck. Наоборот, current evidence показывает managed Autoscale context, integrated persistence and storage, a bounded local SSE guard and prior deterministic synthetic/no-network evidence. Это достаточная причина **не** начинать перенос backend только на основании того, что actual provider limits и project metrics пока неизвестны.

> Официально documented Autoscale configuration — Cloud Run, 1 vCPU/512 MB per instance and 0–5 instances; это platform default, а не measurement текущих Kairema pods. [1]

| Гипотеза о bottleneck | Что известно | Что нужно доказать до пути C |
|---|---|---|
| Runtime CPU/RAM | Per-instance platform default DOCUMENTED; observed Kairema CPU/RSS and throttling UNKNOWN. | Controlled production-equivalent measurement of CPU/RSS, event-loop delay, saturation and 503 classes. |
| Global SSE concurrency | 12/process and 2/user/process VERIFIED. | Actual instance count, per-instance distribution, arrival/service-time profile and cross-replica coordination evidence. |
| Database/storage | Logical guards, pagination and bounded transcript policy already exist; physical limits UNKNOWN. | Query plan/cardinality under representative state, pool wait, DB latency and storage transfer measurement. |
| External hosting gain | No comparison evidence exists. | A defined workload, like-for-like runtime benchmark, operational/security comparison and build/deployment proof. |

Следовательно, **C — EXTERNAL BACKEND/HOSTING** сейчас нерационален: он добавит execution plane, auth/session, operational and data risks, но не устранит unverified provider-account quota or demand unknowns. Перенос может быть reconsidered только после доказательства persistent Manus-side bottleneck under a representative, authorized workload.

## CURRENT AI CAPACITY ASSESSMENT

Current LLM routing provides diversity of route names, Provider Health/cooldown and a hard limit of four real attempts. Это улучшает graceful degradation relative to an unbounded retry loop, но не доказательство aggregate free capacity.

| Quota domain | Publicly documented fact | Account-level Kairema fact | Decision use |
|---|---|---|---|
| OpenRouter `:free` | Public policy documents a shared free-model request pool whose RPD depends on purchase-history condition; free traffic cannot be counted model-by-model. [3] | Plan threshold, remaining quota and reset UNKNOWN. | Do not sum OpenRouter model IDs. |
| Groq | Public Free table documents model limits; documentation describes organization-level limits. [4] | Organization plan, current counters and whether active model limits aggregate independently UNKNOWN. | Per-model table figure is not Kairema capacity. |
| Google Gemini | Quotas are project/model/tier specific. [5] | AI Studio project tier, quota and remaining allocation UNKNOWN. | Gemini fallbacks cannot be assigned an RPD. |
| OrcaRouter | Limits are workspace-scoped and all keys share the workspace bucket; free traffic is best effort and numeric free caps are not published. [6] | Workspace plan/counters/reset UNKNOWN. | Additional `-free` IDs do not prove additional capacity. |
| Dots reserve | Source-level Context reserve exists. | Public quota/billing evidence and account-level quota are UNKNOWN. | Must not be included in a capacity sum. |

The strict conclusion remains: **actual sustainable current AI capacity is UNKNOWN**. The strongest safe statement is that an additional model ID inside a documented shared vendor/account/workspace domain provides no verified incremental capacity. A fallback may improve availability only if a separate remaining quota and independence proof exists.

### Symbolic capacity economics

For registered population \(U\in\{10{,}000,25{,}000,50{,}000\}\), sustainable demand must be evaluated from measured aggregates rather than registration count:

\[
L_U = U \times d \times r
\]

\[
A_U = L_U \times a
\]

\[
I_U = L_U \times (t_{in}+t_{out}),\qquad S_U = L_U \times w \times h
\]

where \(d\) is DAU share, \(r\) logical AI requests per active user/day, \(a\) average upstream LLM attempts (bounded by \(1\le a\le4\)), \(t_{in},t_{out}\) bounded-token observations, \(w\) search share, and \(h\) average cascade attempts per research intent. Concurrency also requires arrival rate \(\lambda\) and service time \(W\), e.g. \(C\approx\lambda W\); neither is currently measured in production.

| Registered users | Low activity | Moderate activity | High activity | Minimum evidence required before a capacity claim |
|---:|---|---|---|---|
| 10,000 | \(L_{10k}=10{,}000d_Lr_L\) | \(10{,}000d_Mr_M\) | \(10{,}000d_Hr_H\) | Actual provider remaining quotas/resets, token distribution, \(a\), \(w\), \(h\), \(\lambda\), \(W\), replicas. |
| 25,000 | \(L_{25k}=25{,}000d_Lr_L\) | \(25{,}000d_Mr_M\) | \(25{,}000d_Hr_H\) | Same evidence; no scaling factor may be inferred from local synthetic actors. |
| 50,000 | \(L_{50k}=50{,}000d_Lr_L\) | \(50{,}000d_Mr_M\) | \(50{,}000d_Hr_H\) | Same evidence plus actual runtime and DB/storage saturation evidence. |

The earlier 6.11M logical-operation synthetic result validates only its bounded no-network harness and error-free simulated operation; it does **not** fill the unknown terms above or establish a 10K/25K/50K production capacity.

## PROVIDER EXPANSION OPTIONS

Only one candidate has a documented independent vendor allocation suitable for a later feasibility review. The remaining entries either share a current quota domain, are account/production unknown, or conflict with a zero-unexpected-cost policy.

| Candidate | Model(s) | Quota-domain independence | Free/non-paid eligibility | Role fit | Likely capacity value | Known restrictions / billing risk | Status |
|---|---|---|---|---|---|---|---|
| Cloudflare Workers AI | **Specific non-paid text model not yet selected**; catalog lists Gemma 4 26B and GPT-OSS 20B. [7] | Independent vendor/domain candidate. Exact allocation aggregation across models/tasks requires validation. | 10,000 Neurons/day public allocation is documented; individual selected-model free eligibility/payment condition remains UNKNOWN. [8] | Potential Flash/Think fallback only after compatibility review. | Potentially additive, but not convertible to turns without bounded tokens and model neuron coefficients. | Account, token and server-side integration required; some named frontier models require paid billing; no SLA/region/terms approval evidence. | **FEASIBILITY ONLY** |
| SambaNova Cloud | No selected model. | Vendor is nominally separate. | Sustainable production-free eligibility and account quota UNKNOWN in current evidence. | Potential future text fallback. | Cannot be counted. | Needs separate official/account review, security and integration approval. | **UNKNOWN** |
| Mistral La Plateforme | No selected model. | Vendor is nominally separate. | Sustainable production-free eligibility and account quota UNKNOWN in current evidence. | Potential future text fallback. | Cannot be counted. | Needs separate official/account review, terms and integration approval. | **UNKNOWN** |
| Cerebras | No selected model. | Vendor separate, but current evidence records only a time-limited free trial requiring verified payment method. | Not renewable, zero-unexpected-cost capacity. | Not suitable as protected public fallback. | No countable sustainable capacity. | Payment/trial condition. | **UNSUITABLE** |
| ZenMux | Free IDs/catalog entries. | Potentially separate vendor, but not usable capacity. | Public terms evidence says Free plan has no API; Builder subscriptions prohibit production/end-user use; PAYG is paid. | None for public Kairema chain. | No legitimate free production capacity. | Commercial/end-user restriction and paid route. | **UNSUITABLE** |

### Candidates that do not add verified capacity

| Candidate family | Reason | Status |
|---|---|---|
| Additional OpenRouter `:free` IDs | Share a public free request domain; current account threshold/counter UNKNOWN. | **NO BENEFIT** |
| Additional Groq models | Current limits are organization-level; independence of aggregates is unproven. | **NO BENEFIT** |
| Additional Google Gemini IDs | Quotas are project/model/tier-dependent; current project counters/tier UNKNOWN. | **NO BENEFIT** |
| Additional OrcaRouter `-free` IDs | Workspace-scoped shared rate bucket, best-effort free traffic and unpublished numeric caps. | **NO BENEFIT** |
| Dots as an extra fifth call | `MAX_ATTEMPTS=4` prevents it from creating a fifth real network attempt. | **NO BENEFIT** |

No candidate is marked **ADD NOW**. “FEASIBILITY ONLY” means a separately authorized evidence task, not code or account action.

## CLOUDFLARE AI ASSESSMENT

Cloudflare Workers AI is the only current **independent** capacity candidate with a documented recurring free allocation: **10,000 Neurons/day**, reset at **00:00 UTC**, plus a documented default text-generation rate limit of **300 RPM**. [8][9] Neurons are model/compute-derived and pricing publishes model-specific input/output coefficients; therefore “10,000 Neurons/day” is **not** requests/day. [8]

| Question | Evidence-based answer |
|---|---|
| Can it add an independent quota domain? | **Yes, as a vendor/domain candidate.** It is not part of OpenRouter, Groq, Google or OrcaRouter. |
| Is it unlimited free compute? | **No.** The documented daily neuron allocation and rate limit are finite; relevant post-limit operations fail. |
| Is a concrete non-paid model proven usable? | **No.** The catalog has compatible-looking text models, but current evidence does not establish selected-model free eligibility, no-payment-method condition, role compatibility or account availability. |
| Can it be expressed as Kairema turns/day? | **No.** Required: selected model, exact input/output neuron coefficients, Kairema bounded token budget, token distribution and a conservative reservation formula. |
| Are paid models avoidable? | Some named frontier models are documented as requiring a paid billing method; those are excluded. [8] Absence from that list is not proof of a model’s zero-cost eligibility. |
| Is commercial/end-user use legally approved? | **No legal approval.** Public data-handling and terms evidence is not a Kairema-specific DPA/license/terms decision. [10][11] |

The narrow future feasibility gate is therefore: choose one catalog text model; verify its current Free-plan and payment condition in official/account metadata; calculate a conservative per-turn neuron upper bound from existing transcript budgets; verify API capability compatibility without public traffic; review privacy, retention, regional and model-license terms; then decide whether an implementation proposal is warranted. None of these steps is performed here.

## CLOUDFLARE HOSTING ASSESSMENT

Cloudflare Workers and Workers AI are separate planes. Workers Free documents **100,000 Worker requests/day** and **10 ms CPU time per invocation**; Workers Paid has a minimum monthly charge. [12] This is neither an inference hosting benchmark nor direct compatibility evidence for the Kairema Node/Express/SSE/Drizzle architecture.

| Factor | Current evidence | Architectural implication |
|---|---|---|
| Execution model | Workers Free is documented with request and CPU limits. [12] | A move requires application/runtime adaptation; it is not a no-op host swap. |
| Current Manus capacity | Autoscale platform default documented; actual Kairema usage/saturation UNKNOWN. | No proof Workers would solve a real current runtime bottleneck. |
| AI integration | Workers AI would still need account/token/model/security review. | Hosting move does not remove provider quota governance. |
| Cost/operations | Current actual Manus and Cloudflare usage/billing unknown. | A comparative cost or reliability claim cannot be made. |

**Decision:** do not select Cloudflare Workers hosting now. It is an external runtime path, not a verified remedy for provider capacity, and would add scope explicitly prohibited in this audit.

## FAIRNESS CONTROLLER READINESS

Existing controls already protect several local ingress paths, but they do not form a global multi-provider capacity controller.

| Required controller element | Current state | Evidence and gap |
|---|---|---|
| Verified user identity and isolation | **ALREADY IMPLEMENTED** | Server-derived canonical user identity and user-scoped records exist. |
| Per-user minute ingress quota | **ALREADY IMPLEMENTED** | Durable chat ingress quota is 60/min per user. |
| Local concurrent stream guard | **ALREADY IMPLEMENTED** | 2 streams/user/process and 12/process, `finally` release, controlled 503. |
| Retry ceiling and provider cooldown | **ALREADY IMPLEMENTED** | Up to four real attempts; server Provider Health/cooldown. |
| Per-user weighted daily/token usage | **MISSING** | No durable weighted cost/token bucket per user is evidenced. |
| Global shared budget | **MISSING** | No cross-replica global LLM/search budget/counter is evidenced. |
| Provider-specific budget and reservation | **MISSING** | No safe pre-network reservation against provider remaining quota exists. |
| Fallback re-admission | **PARTIALLY IMPLEMENTED** | Attempts are bounded, but there is no evidence of provider-budget-aware re-admission on each fallback. |
| Role priority | **MISSING** | No verified priority allocation across Flash/Think/Context/Apex under scarcity. |
| Budget-aware degradation | **PARTIALLY IMPLEMENTED** | Controlled errors/cooldowns exist; quota-aware alternate response, queue policy or retry-after budget semantics do not. |
| Cross-replica fairness | **REQUIRES EVIDENCE / DESIGN** | Process-local guards cannot establish global fairness in Autoscale topology. |

Path B must not be interpreted as permission to implement this controller. First, actual quota domains, demand and runtime topology must be measured in an approved later evidence stage.

## SEARCH CAPACITY READINESS

Search can become the first availability bottleneck when future answers are required to be web-grounded. The search cascade can create multiple provider attempts for a single logical research intent; the multiplier \(h\) is workload-dependent and must not be assumed to be one. Current provider account credits/limits and reset cycles are not visible.

| Requirement for future web-grounded responses | Current state | Needed before rollout |
|---|---|---|
| Per-user search budget | **MISSING** | Durable user-scoped allowance independent of LLM request count. |
| Global provider/source budget | **MISSING** | Per-provider current/remaining allocation, reservation and release policy. |
| Freshness gate | **PARTIALLY IMPLEMENTED** | Existing optional search and dated-source policy exist; must define a response path that declines fresh claims when no fresh source is available. |
| Cache/dedup | **DESIGN ONLY** | Cache only normalized, non-personal public queries; never profile, memory, attachment or chat content. Source permissions, TTLs and hit rate remain UNKNOWN. |
| Cascade accounting | **MISSING** | Record only privacy-safe aggregate attempt/outcome counts, not prompts/results/secrets, before deriving \(h\). |
| Degraded response | **PARTIALLY IMPLEMENTED** | Cooldown/fallback semantics exist; a policy for no-fresh-source answer must be explicitly designed and accepted. |

The present search layer must not be treated as shared unlimited research capacity, and no cache implementation is authorised by this report.

## PRODUCTION BUILD IMPACT

The retained **SIGTERM/resource blocker** remains a separate evidence gap. This audit deliberately did not invoke or workaround production build, change build configuration, reduce dependencies or alter application behaviour.

| Confidence area | Effect of build blocker |
|---|---|
| Current code-level invariants | Focused deterministic checks passed in earlier milestones; the blocker does not invalidate those source-level facts. |
| Deployable production artifact | Not independently confirmed in this final audit. |
| New provider/controller/host rollout | Cannot be considered ready until a separate safe build diagnosis reaches one of the agreed outcomes. |
| External-hosting decision | Blocker is not evidence that Manus is the bottleneck; it is an independent missing measurement. |

## RECOMMENDED ARCHITECTURE

### **B — CURRENT MANUS + PROVIDER EXPANSION (evidence-gated)**

This is the rational direction, not a deployment instruction. Retain current Manus/WebDev and the four-role server-side router. Do **not** move the backend now. Establish whether an independent, legally and economically viable provider allocation exists, then design a controller only after obtaining account-level quota, demand and topology evidence.

| Option | Evidence fit | Why not selected / selected |
|---|---|---|
| A — Current Manus + current provider pool | Insufficient for a scale claim. | Current provider quotas/counters are UNKNOWN and shared domains limit the value of more IDs. Retain it operationally while evidence is collected, but not as the 10K–50K strategy. |
| **B — Current Manus + independent provider expansion + future controller** | **Best conditional fit.** | Addresses the documented concentration risk without falsely blaming Manus. Cloudflare AI offers a potential independent vendor allocation, while current runtime changes are avoided. |
| C — External backend/hosting | Unsupported. | No proof of Manus runtime/DB/storage bottleneck or of a compatible external-runtime gain; adds operational migration risk. |
| A+B hybrid | Semantically overlaps B. | The recommendation keeps current pool and may add only independently proven capacity; therefore B already includes the safe hybrid behavior. |

The recommended endpoint is a controlled, evidence-backed multi-provider design—not a larger unmeasured list of free model IDs. No current source supports declaring Kairema 10K, 25K or 50K production-ready.

## DECISION BLOCKERS

| Blocker | Needed exact value or artefact | Blocks | Safe next evidence method |
|---|---|---|---|
| Provider account capacity | Plan, remaining quota, reset, quota scope and 401/403/429 status for each active LLM/search provider. | Numeric current capacity and fallback independence. | Owner-visible dashboard metadata only. |
| Cloudflare selection | One named text model’s Free eligibility, payment requirement, coefficients and API compatibility. | Whether Cloudflare adds zero-unexpected-cost capacity. | Separate terms/metadata feasibility review, no account creation or inference. |
| Demand model | Privacy-safe aggregates for DAU, requests/user, token bands, search share, attempt factor, arrival rate and service time. | 10K/25K/50K sustainable demand calculation. | Approved observability design and later bounded benchmark. |
| Runtime topology | Actual replicas/region/autoscale and DB/storage operational indicators. | Global SSE and external-hosting evaluation. | Read-only project/runtime metrics, then authorised no-network test. |
| Production build | Precise build stage, signal/resource evidence and reproducibility result. | Rollout confidence for any later code change. | Separate retained build diagnosis. |

Stytch Magic Link EmailDelivery remains an unrelated external blocker. It is not a capacity decision input and was not accessed, retried or changed.

## NEXT 3-5 STEPS

1. **Provider metadata evidence:** separately authorize safe read-only sign-in to active provider dashboards and record only plan, remaining quota, reset, scope and quota-domain facts—never keys, prompts, requests or billing actions.
2. **Cloudflare feasibility packet:** separately validate one text-generation model’s Free eligibility/no-payment condition, current neuron coefficients, role compatibility and applicable data/license terms; do not create an account or integrate it in that packet.
3. **Capacity-controller design review:** once quota domains and demand inputs are known, write a design-only proposal for durable per-user weighted budgets, global/provider/search reservations, fallback re-admission, priority and controlled degradation.
4. **Search governance design:** define the no-fresh-source policy and a privacy-safe cache/dedup proposal with source-permission validation, then obtain approval before implementation.
5. **Retained build diagnosis:** run the separate, safe production-build SIGTERM/resource investigation before approving any new runtime/integration change.

## Evidence references

[1] [Manus — Publishing and hosting](https://manus.im/docs/website-builder/publishing)  
[2] [Manus — Cloud infrastructure](https://manus.im/docs/website-builder/cloud-infrastructure)  
[3] [OpenRouter — Rate limits](https://openrouter.ai/docs/api-reference/limits)  
[4] [Groq — Rate limits](https://console.groq.com/docs/rate-limits)  
[5] [Google Gemini API — Rate limits](https://ai.google.dev/gemini-api/docs/rate-limits)  
[6] [OrcaRouter — Rate limits](https://docs.orcarouter.ai/operations/rate-limits), [Free models](https://docs.orcarouter.ai/routing/free-models), [Terms](https://www.orcarouter.ai/terms.html)  
[7] [Cloudflare Workers AI — Model catalog](https://developers.cloudflare.com/workers-ai/models/)  
[8] [Cloudflare Workers AI — Pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/)  
[9] [Cloudflare Workers AI — Limits](https://developers.cloudflare.com/workers-ai/platform/limits/)  
[10] [Cloudflare Workers AI — Data usage](https://developers.cloudflare.com/workers-ai/platform/data-usage/)  
[11] [Cloudflare — Application Services terms](https://www.cloudflare.com/service-specific-terms-application-services/)  
[12] [Cloudflare Workers — Pricing](https://developers.cloudflare.com/workers/platform/pricing/)

### Evidence provenance

This report synthesizes the previously checkpointed source and test evidence and the current saved ledgers: `provider-capacity-official-sources-2026-08.md`, `provider-capacity-followup-source-ledger-2026-08.md`, `provider-account-quota-source-ledger-2026-08.md`, `provider-account-level-quota-audit-2026-08.md`, `account-level-usage-quota-review-2026-08.md`, `ai-capacity-topology-account-followup-2026-08.md`, and prior scale/security/failure evidence reports. It performed **no** provider/search/inference request, dashboard action, billing action, account creation, deployment, build, infrastructure change, schema change, routing change or application-code change.
