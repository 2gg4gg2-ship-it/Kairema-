# Kairema — combined capacity decision & build evidence

**Дата:** 27 августа 2026 года  
**Статус документа:** итог объединённого evidence-first этапа A–E.  
**Граница работ:** выполнены только metadata-only review, официальное public-docs исследование, один воспроизводимый build-time diagnostic и deterministic no-network revalidation. Не выполнялись генеративные запросы, provider/search quota probes, биллинг, создание аккаунтов, Cloudflare Worker/inference, новая интеграция, миграции, изменения маршрутизации или user data.

> **Правило интерпретации.** `VERIFIED/TESTED` означает подтверждение исходным кодом, controlled local execution или конкретным test. `SIMULATED` — только deterministic модель без реального provider/runtime throughput. `UNKNOWN` не является нулём и не допускает автоматической подстановки лимита либо capacity claim.

## 1. VERIFIED QUOTA METADATA

**VERIFIED (структура и защита, не численные квоты).** В `capacity_provider_budgets` уже есть owner-configurable metadata для `provider`, optional `modelId`, `scopeKey` (quota domain), `rpmLimit`, `tpmLimit`, daily request/token/unit limits, `maxConcurrent`, `resetWindow`, `enabled`, `billingSafe`, `billingState`, eligibility и quota state. Нулевые/неполные данные допускаются как `null`/`unknown`; это не означает unlimited capacity. Server-side owner guard и schema validation защищают update path, а client не может передать trusted actor, provider credential или reservation key. [Controller source](../../server/capacity-controller.ts) · [Schema](../../drizzle/schema.ts) · [Owner router](../../server/routers.ts)

| Факт | Статус | Получить без расходов и real provider traffic? | Вывод |
|---|---|---:|---|
| Actual remaining quota, current usage, reset timestamp, plan/billing для OpenRouter/OrcaRouter/Google/Groq и search domains | **UNKNOWN / NOT AVAILABLE** | Да, только из уже авторизованной owner dashboard либо явного owner evidence; текущая browser session не авторизована | Не записывать число и не включать global WCU limit автоматически. |
| Current Manus/WebDev usage, costs, replicas, CPU/memory entitlement | **UNKNOWN / NOT AVAILABLE** | Только owner/platform metadata без изменения plan | Не превращать локальные SSE limits в global capacity. |
| Public Cloudflare allowance | **DOCUMENTED**, но не Kairema account fact | Да, official docs | Не является текущей Kairema quota. |

## 2. OWNER INPUTS REQUIRED

Текущая owner форма достаточна для **контролируемого manual quota metadata input** по provider/model/quota domain и численным nullable limits без хранения key/token. Она не дублировалась. Однако она не хранит отдельные audit-grade `verified_at` и immutable `source` URL; `updatedAt` — лишь время изменения записи, а не доказательство provider verification. Поскольку этап запрещает миграцию, этот provenance gap остаётся явным, а не маскируется новым полем.

| Что владелец должен предоставить | Формат | Можно получить без расходов/traffic | Действие после получения |
|---|---|---:|---|
| Provider/model/quota domain, RPM/RPD/TPM/TPD, concurrency, reset window, enabled, billing-safe | Значения из dashboard или официального account plan, без ключей | Да | Внести только подтверждённые nullable значения через existing owner form. |
| `verified_at` и source URL/скриншот policy/account page | Дата UTC и ссылка/артефакт вне secrets | Да | Сохранить как evidence рядом с решением; schema не менять в этом этапе. |
| Manus usage/cost/replica limits | Read-only owner/platform screenshot или support response | Да, если интерфейс доступен | Обновить capacity conclusion, не runtime policy. |

## 3. CLOUDFLARE AI FEASIBILITY

**Классификация: INDEPENDENT CAPACITY CANDIDATE — не интегрирован; $0 eligibility и Kairema applicability UNKNOWN.** Public documentation указывает, что Workers Free включает **10 000 Neurons/day**, reset в **00:00 UTC**; выше нужен Workers Paid. Цена Paid указана как **$0.011/1 000 Neurons**, а часть frontier models billing-gated. Neuron usage model/input/output dependent, поэтому 10 000 нельзя честно перевести в requests, tokens или readiness для 10K/25K/50K. [1]

Text-generation default указан как **300 RPM**, но отдельные models могут иметь иные ограничения; это не daily sustainable capacity. Representative `@cf/meta/llama-3.1-8b-instruct-fast` документирован для text generation, streaming, 128K context и default 256 max output tokens, однако catalogue presence не подтверждает account eligibility, regional availability, quality или стабильность model ID. [2] [3] [4]

| Проверка | Итог |
|---|---|
| Независимость от current Kairema provider pool | **Потенциально independent quota domain** Cloudflare account, но аккаунт/remaining allowance не существуют в evidence; это не добавленная current capacity. |
| Non-paid eligibility / payment | **UNKNOWN for Kairema**; public Free allowance существует, однако paid gating части models создаёт spend risk. |
| Quota scope, context/output, regional/commercial constraints | Public docs частично описывают product/model limits; Kairema account-specific scope, region и production terms — **UNKNOWN / OWNER INPUT REQUIRED**. |
| Допуск к реализации сейчас | **NO-GO.** Не создан account, token, Worker или inference route; controller budget не менялся. |

## 4. CLOUDFLARE HOSTING FEASIBILITY

**Классификация: HOSTING CANDIDATE, но UNSUITABLE для немедленной миграции.** Workers Free публикует 100 000 requests/day, 10 ms CPU/request, 128 MB isolate memory, 50 subrequests/request и шесть simultaneous outgoing connections/request. [5] [6] Current Kairema — Node/Express/tRPC/Drizzle app, поэтому deployment туда потребовал бы нового runtime/backend design, а не безопасного hosting switch.

SSE как технология не исключён: docs не устанавливают hard HTTP-duration cap, пока подключён клиент, и указывают 30-second grace period для in-flight requests при runtime updates. Но CPU/memory bounds, database access, auth/session, storage, migration semantics, observability и globally coordinated controller behaviour в Workers для Kairema **не проверены**. Смена hosting не увеличит provider quotas и не исправит unknown account capacity.

## 5. PRODUCTION BUILD RESULT

**Итог: PLATFORM/RESOURCE BLOCKER.** Один диагностический запуск точной command `pnpm run build` начался корректно и был завершён внешним `SIGTERM` с **exit 143** примерно через **6 секунд** на Vite transform stage. TypeScript/source error, Rollup error и false success не обнаружены. No runtime code, dependencies, chunk policy или behaviour не менялись.

| Наблюдение | Status / interpretation |
|---|---|
| Build command и stage | **VERIFIED:** `pnpm run build` → Vite transform; final bundling/emit не достигнут. |
| Signal / duration | **VERIFIED:** SIGTERM / exit 143 / ≈6 s. OOM-kill доказательно не установлен. |
| Process/resource sample | **OBSERVED:** Vite build process около 916 MiB RSS; concurrent development `tsx` watcher около 902 MiB RSS; Vite находился в `D` state в sampled момент. Sandbox cgroup hard limit не был доступен как достоверный signal. |
| Code-related finding | **NOT PROVEN.** `vite.config.ts` содержит обычные React/Tailwind/Manus plugins и manual chunks; точечный config defect не доказан. |

Повторить build допустимо только в clean/достаточно resource-provisioned environment без heavy concurrent dev/browser processes и с доступным resource telemetry. До этого production build не считается passed и этот diagnostic не обходит проблему.

## 6. CAPACITY CONTROLLER REVALIDATION

**TESTED/SIMULATED:** существующий `benchmark:capacity-calibration` rerun завершился deterministic, `network.allowed=false`, `network.attempted=0`. Controller scenario подтверждает WCU admission semantics, а не provider token/cost/quota accounting.

| Сценарий | Результат |
|---|---|
| Reservation lifecycle / dedup | First reservation `reserved`; replay deduplicated; failure released once; fallback receives distinct attempt key; duplicate release does not mutate state. |
| Fallback | Trace 1→2: attempt 1 released, attempt 2 settled, 0 over hard maximum; network hard cap remains `MAX_ATTEMPTS=4`. |
| Shared provider domain | Synthetic domain 6 WCU admits model A at 4 WCU and denies model B at 4 WCU; model IDs не создают second independent budget. |
| Search isolation | Generation admission stays unaffected by exhausted synthetic search budget; denial results in existing truthful freshness-unavailable/degraded context, not fabricated freshness. |
| Degradation / queue | `high` denies flagship; `critical` leaves fast only; `exhausted` denies all. Queue disabled by default; configured queue is Flash-only, 1 500 ms / 64 depth, timeout has no reservation/upstream attempt. |
| Local vs durable | 12 streams/process and 2/user/process are local guards. Durable global example admits 3 across two processes and denies fourth, but does not constitute distributed queue/global scheduler guarantee. |

Artifact: [capacity-calibration-simulation-2026-08.json](data/capacity-calibration-simulation-2026-08.json). Relevant focused regressions reside in `server/capacity-controller.test.ts` and `server/capacity-calibration.test.ts`.

## 7. CURRENT MANUS RUNTIME/COST STATUS

Kairema is currently deployed on Manus WebDev Autoscale, and application-level guards are present. **UNKNOWN:** actual current cost, quota, remaining request/database/storage/network allowance, active replica count, routing/stickiness, per-replica resources and effective global concurrency. These values may be obtained without generation traffic only through owner/platform metadata; they are not visible from current access. Therefore **no cost-safe capacity assertion** is possible.

## 8. CURRENT LLM POOL STATUS

**VERIFIED at source level:** public roles are exactly Flash (`fast`), Think (`smart`), Context (`context`) and Apex (`flagship`); real upstream attempts remain capped at four; existing provider chains, server allowlists, Provider Health and cooldown logic remain authoritative. **UNKNOWN:** account-level capacity/remaining/reset/billing entitlement for all current provider pools. Extra model identifiers inside an existing provider domain do not prove additive capacity.

No production provider, model, fallback chain, routing rule or credential was changed. The primary free-first policy therefore remains **use current pool with controller protection**, not expand it on assumed capacity.

## 9. SEARCH STATUS

**VERIFIED at source/test level:** Search/RAG remains optional and has a separate controller admission path/budget; a capacity denial produces truthful unavailable/degraded freshness treatment rather than a claim of current web evidence. The existing You → Serper → Exa → Tavily cascade was not changed. **UNKNOWN:** account-level quotas, remaining budget and reset semantics for every live search provider.

The future search layer can continue to use this separate budget boundary. It must not share raw user-scoped data via a common search cache, and no full web-grounded model integration was started.

## 10. CAPACITY BOTTLENECKS

| Bottleneck | Evidence status | Can it be resolved for $0 now? | Practical handling |
|---|---|---:|---|
| Actual provider/account quota and reset facts | **UNKNOWN** | Only discoverable with owner dashboard evidence | Keep nullable metadata; do not tune limits. |
| Manus usage/cost/replica data | **UNKNOWN** | Only if owner/platform reports expose it | Treat local limits as local. |
| Multi-instance scheduling fairness | **PARTIAL:** durable counters, no distributed queue | No, not without architecture/infrastructure decision | Keep bounded admission/rejection; do not claim global scheduling. |
| Free-first inference ceiling | **FUNDAMENTAL:** account allowance finite and model-dependent | No | Rate-limit/admit fairly; require owner-approved verified capacity before expansion. |
| Production build SIGTERM | **BLOCKER** | Possibly, if clean resource environment is available | Re-run same command under documented resource conditions; no optimisation workaround. |
| Stytch Magic Link delivery | **EXTERNAL BLOCKER** | No app-only fix established | Preserve external HTTP 400 blocker; do not resend/mutate provider state. |

## 11. 10K/25K/50K CAPACITY ENVELOPE

**SIMULATED population projection only; not production capacity.** The revalidation artifact lists 10K, 25K and 50K registered actors at 1%, 5% and 10% DAU, with a 5% synthetic burst. This yields 100/500/1 000 DAU and 5/25/50 bursts at 10K; 250/1 250/2 500 DAU and 13/63/125 bursts at 25K; and 500/2 500/5 000 DAU and 25/125/250 bursts at 50K. Every projection deliberately records **no admit/reject result**, because real global provider/account capacity is unknown.

| Envelope statement | Status |
|---|---|
| Application admission mechanics can represent these populations without real accounts/data | **SIMULATED** only. |
| Current provider pool sustains 10K, 25K or 50K registered users | **UNKNOWN.** |
| Current runtime sustains that many concurrent SSE clients globally | **UNKNOWN.** Existing 12/process and 2/user/process are not a global ceiling proof. |
| Cloudflare turns any tier into a verified free capacity | **NO.** Neurons cannot be converted without measured model/input/output/account facts. |

## 12. FAIRNESS RESULT

**SIMULATED and deterministic:** with calibration-only global 120 WCU and per-user 12 WCU, one noisy user offered 100 low-cost requests and received **12 admissions / 88 per-user rejections**. One hundred quiet users with one request each received **100 admissions / 0 rejections**, consuming 112 WCU. The counterfactual without per-user guard admits 100 noisy requests and only 20 quiet users, denying 80 quiet users due to global pressure.

This verifies the intended anti-monopoly behaviour of the controller model. It does **not** prove end-to-end fairness across every Autoscale replica, nor convert WCU into money, tokens or provider quota.

## 13. FALLBACK AMPLIFICATION

**TESTED/SIMULATED safety boundary:** every actual provider attempt must reserve independently; controller rejections do not consume an upstream attempt. In the deterministic trace, first attempt is released after failure and second fallback settles with separate request key, ending at zero inflight WCU. The histogram reports attempts 1=1, 2=1, 3=0, 4=0, over-hard-maximum=0.

Failure classes including cooldown, transient 5xx/timeout/ECONNRESET and 401/403/429 stay governed by the existing Provider Health/cooldown/router path; no upstream failure was manufactured through a provider request. The four-attempt cap prevents unbounded fallback amplification, but a real financial/request amplification factor remains **UNKNOWN** until owner quota facts and actual account semantics are available.

## 14. RECOMMENDED ARCHITECTURE PATH

**Primary path A — STAY MANUS + CURRENT PROVIDERS.** Complete the formal multi-user evidence closure with existing hardened application controls, controller and one documented owner metadata package. This is the only current path with no new provider, billing or infrastructure commitment. It avoids treating Cloudflare docs or new model IDs as free capacity.

**Reserve path B — STAY MANUS + EXPAND INDEPENDENT PROVIDERS, only after evidence gate.** Consider Cloudflare Workers AI (or another genuinely independent provider) only after owner-approved, account-specific, $0-safe feasibility proof confirms model eligibility, billing behaviour, reset/allowance, regional/commercial constraints and controller mapping. It must be a deliberately approved capacity addition, not account duplication or quota circumvention.

**Not recommended now:** C (move backend/hosting) and D (hybrid). A migration cannot solve unknown provider quotas and would introduce unvalidated runtime/auth/storage/SSE changes while production build itself has a resource blocker. The largest possible capacity increase is **verified independent provider allowance**, not another model ID, frontend optimisation or hosting switch.

## 15. EXACT REMAINING MULTI-USER TASKS

| Remaining task | Owner / prerequisite | Closure evidence | Status |
|---|---|---|---|
| Supply verified current provider/search quota facts, reset windows, billing-safe state and sources | Owner, read-only dashboards or plan pages | Manual nullable metadata + dated source evidence | **OWNER INPUT REQUIRED.** |
| Supply Manus usage/cost/replica facts if platform exposes them | Owner/platform | Read-only evidence | **OWNER INPUT REQUIRED.** |
| Re-run exact production build in clean adequately provisioned runtime | Platform/runtime availability | `pnpm run build` exits 0 with log | **UNVERIFIED / PLATFORM-RESOURCE BLOCKER.** |
| Resolve or formally waive Magic Link provider delivery external dependency | Stytch/provider | Provider-side diagnosis, outside this task | **EXTERNAL BLOCKER.** |

No new audit cycle is needed for already-tested application controls. No Redis, new database, VPS/AWS/DigitalOcean/Timeweb, external queue, paid monitoring or automatic billing is required to close these documentation/evidence gaps.

## 16. TASKS THAT ARE NOW COMPLETE

The following are **IMPLEMENTED/TESTED** from the preserved baseline and this combined stage: four-role public contract; `MAX_ATTEMPTS=4`; server allowlists; Provider Health/cooldowns; verified session and server-derived identity; strict user scope; cursor pagination; bounded role-specific transcript context; secure attachment boundary; owner-only exports/operational controls; Google OAuth; Stytch email/password; draft autosave; current Search/RAG architecture; SSE local guard; durable/CAS protections; centralized controller V1; calibrated fairness/lifecycle/queue/search simulations; owner metadata review; Cloudflare read-only feasibility; and one reproducible build diagnosis.

No production routing or provider integration was changed by this report. The final revalidation remains no-network (`attempted=0`).

## 17. EXTERNAL BLOCKERS

| Blocker | Why it cannot be converted into an app result here | Status |
|---|---|---|
| Build SIGTERM | Sandbox terminated Vite during transform; source defect not proven and resource entitlement unavailable | **PLATFORM/RESOURCE BLOCKER.** |
| Provider/search remaining quotas and resets | Require account-visible facts; current access lacks authorised dashboards | **OWNER INPUT REQUIRED.** |
| Manus cost/usage/replicas | Project-specific platform data unavailable | **OWNER INPUT REQUIRED.** |
| Stytch Magic Link delivery | External EmailDelivery HTTP 400 with unknown coarse category; repeated sends/provider mutation prohibited | **EXTERNAL BLOCKER.** |
| Cloudflare applicability | No account, token, Worker, billing setting or inference evidence exists | **UNKNOWN / evidence-gated candidate.** |

## 18. FINAL GO/NO-GO DECISION

**GO — application-level multi-user implementation may remain on the current Manus runtime and current provider pool with the existing controller protections.** The safe final action for formal closure is an owner-supplied, evidence-backed quota/usage metadata package plus a clean-environment rerun of the exact production build command when platform resources permit. This has no automatic spend escalation.

**NO-GO — do not claim 10K/25K/50K production capacity, do not enable new providers/Cloudflare, and do not move hosting/backend now.** The fundamental free-first boundary is unknown account-level provider/Manus allowance; controller WCU and simulations protect fairness but cannot create capacity. Cloudflare is a future independent-capacity candidate, not present capacity. A different server is not currently required by application evidence and would not solve the quota unknowns.

### References

[1]: https://developers.cloudflare.com/workers-ai/platform/pricing/ "Cloudflare Workers AI pricing"
[2]: https://developers.cloudflare.com/workers-ai/platform/limits/ "Cloudflare Workers AI limits"
[3]: https://developers.cloudflare.com/workers-ai/models/ "Cloudflare Workers AI model catalog"
[4]: https://developers.cloudflare.com/workers-ai/models/llama-3.1-8b-instruct-fast/ "Llama 3.1 8B Instruct Fast on Workers AI"
[5]: https://developers.cloudflare.com/workers/platform/pricing/ "Cloudflare Workers pricing"
[6]: https://developers.cloudflare.com/workers/platform/limits/ "Cloudflare Workers limits"
