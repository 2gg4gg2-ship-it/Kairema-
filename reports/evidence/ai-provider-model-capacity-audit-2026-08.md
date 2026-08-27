# Kairema — AI Provider / Model Capacity Audit

**Дата:** 27 августа 2026 года  
**Автор:** Manus AI  
**Статус:** завершённый evidence-only, read-only аудит.  
**Граница аудита:** исходный код Kairema и публичная официальная документация. Не выполнялись реальные LLM/search-запросы, измерение квот, вход в provider dashboard, просмотр секретов, оплата, активация биллинга, смена ключей, интеграция, изменение routing/model list/fallback/search order/quota/UI/schema/infrastructure. Production build SIGTERM и Stytch Magic Link остаются отдельными внешними задачами и здесь не исследовались.

> **Главный вывод.** Дополнительные model ID внутри уже используемого OpenRouter, Groq, Google или OrcaRouter не доказывают новую бесплатную capacity: публичные правила указывают на shared account/project/organization/workspace domains либо не доказывают их независимость. Единственный изученный кандидат с подтверждённой отдельной *renewable* free allocation — Cloudflare Workers AI (10 000 Neurons/день), но Neurons нельзя честно перевести в число LLM-ответов без выбора модели и token profile. Поэтому фактическая текущая sustainable capacity Kairema и готовность к 10K/25K/50K остаются **UNKNOWN**, а не «достаточны».

## 1. CURRENT PROVIDER/MODEL INVENTORY

В серверном реестре существуют ровно четыре публичные роли: Flash, Think, Context и Apex. Клиент выбирает роль, а не upstream model ID; сами IDs и порядок кандидатов остаются server-only. Это source-confirmed факт `server/providers.ts` (строки 3–153), а не утверждение о доступности, остатке квоты или стоимости конкретного аккаунта.

| Публичная роль | Активная server-side цепь в порядке кандидатов | Важное ограничение |
|---|---|---|
| Flash | OpenRouter `openai/gpt-oss-20b:free` → OrcaRouter `deepseek/deepseek-v4-flash-free` → Groq `openai/gpt-oss-20b` → Google `gemini-flash-lite-latest` | Google-кандидат помечен vision и requiresWebResearch. |
| Think | OpenRouter `google/gemma-4-26b-a4b-it:free` → OrcaRouter `tencent/hy3-free` → Google `gemini-flash-lite-latest` → Groq `openai/gpt-oss-120b` | Все candidate IDs — server-only. |
| Context | OpenRouter `nvidia/nemotron-3-ultra-550b-a55b:free` → OrcaRouter `deepseek/deepseek-v4-flash-free` → Google `gemini-flash-lite-latest` → Groq `openai/gpt-oss-120b` → Dots `dots-studio/dots3-note-prev` | Dots — server-only reserve: он может быть достигнут только если предыдущие кандидаты были пропущены; он **не** является пятой реальной попыткой после четырёх вызовов. |
| Apex | OpenRouter `google/gemma-4-31b-it:free` → OrcaRouter `deepseek/deepseek-v4-pro-free` → Google `gemini-flash-lite-latest` → Groq `openai/gpt-oss-120b` | Сохраняется та же общая граница попыток. |

`MAX_ATTEMPTS=4` — жёсткий лимит реальных upstream LLM вызовов на одну генерацию; skipped candidates из-за health/capability/control этот бюджет не тратят. Публичный Provider Health dashboard намеренно показывает только OpenRouter, OrcaRouter, Google и Groq; Dots и diagnostic-only ZenMux IDs туда не выводятся. Код знает provider secret gates, но этот аудит **не читал и не подтверждал** наличие, план, баланс или runtime status какого-либо секрета.

## 2. VERIFIED FREE LIMITS BY PROVIDER

Следующая таблица различает публичные правила поставщика и состояние аккаунта Kairema. «VERIFIED» означает только то, что указанное правило было найдено в официальной публичной документации на дату аудита; оно не означает, что ключ Kairema имеет этот лимит сейчас.

| Provider | Относится к текущей цепи | VERIFIED public limit / semantics | Quota domain | Kairema actual today |
|---|---:|---|---|---|
| OpenRouter | Да | `:free`: 20 RPM; 50 RPD при покупке менее $10 credits либо 1 000 RPD после достижения порога. Allowance shared всеми `:free` models. [1] | Account / shared free allowance | **UNKNOWN**: порог, остаток, модельная доступность. |
| Groq | Да | Public Free base table для каждого listed `gpt-oss-20b` и `gpt-oss-120b`: 30 RPM, 1 000 RPD, 8K TPM, 200K TPD. [2] | Organization | **UNKNOWN**: tier, remaining usage, и независимость aggregate двух model rows. |
| Google Gemini API | Да | Лимиты учитывают RPM, input TPM и RPD; они per project, model/tier-specific, RPD reset — midnight Pacific. [3] | Project | **UNKNOWN**: численные limits `gemini-flash-lite-latest`, tier и остаток. |
| OrcaRouter | Да | Limits workspace-scoped; все keys workspace share bucket. Для `-free` IDs public numeric renewable pool не опубликован в изученных docs; free routing best-effort. [4] [5] [6] | Workspace | **UNKNOWN**: plan, enabled models, numeric limits, balance/eligibility. |
| Dots reserve | Только Context reserve | Публичной проверенной free-quota таблицы в этом аудите нет. | **UNKNOWN** | **UNKNOWN**; не считать capacity. |
| Cloudflare Workers AI | Нет, кандидат | 10 000 Neurons/account/day, reset 00:00 UTC; расход model- и token-dependent. [7] | Account | Не интегрирован; число LLM turns **UNKNOWN**. |

Публичная документация Groq также называет обе активные GPT-OSS модели production models с 131 072-token context и 65 536-token maximum completion. [8] Эти контекстные пределы не доказывают throughput Kairema: действовать будет первая достигнутая граница RPM/RPD/TPM/TPD/organization account limit.

## 3. SHARED-QUOTA FINDINGS

Перестановка или добавление ID внутри одного quota domain может улучшить доступность конкретной модели, но не создаёт независимый бесплатный budget без явного доказательства provider-а. Это ключевое различие между fallback diversity и capacity diversity.

| Domain | VERIFIED finding | Вывод для additive arithmetic |
|---|---|---|
| OpenRouter | Публичная free allowance прямо shared across all `:free` models. [1] | Четыре присутствующих `:free` IDs — один allowance; суммировать их RPD нельзя. |
| Google | Gemini quotas per project; model/tier specific. [3] | Новый Google ID не доказывает отдельную quota; relation для конкретных IDs **UNKNOWN**. |
| Groq | Limits organization-level; account limits page authoritative. [2] | Нельзя складывать 1 000 RPD `20b` + 1 000 RPD `120b` в Kairema aggregate без доказательства независимости buckets. |
| OrcaRouter | All keys in a workspace share its bucket. [4] | Новый key или `-free` ID в workspace не образует отдельный pool. |
| Direct DeepSeek | Concurrency account-level независимо от key; API описан как token-balance paid path. [9] [10] | Дополнительный DeepSeek key/model ID не добавляет verified free capacity. |

## 4. CURRENT CAPACITY MAP

`CURRENT_POOL` — это действующие Kairema role chains, а не заявленная сумма upstream allowances. Надёжная карта показывает источник diversity, а не несуществующий total.

| Логический pool component | Роль в текущей системе | Численно включать в current total? | Причина |
|---|---|---:|---|
| OpenRouter free pool | Primary во всех четырёх ролях | Нет | У public docs есть 50/1 000 RPD conditional figure, но Kairema threshold, usage и availability **UNKNOWN**; allowance shared. |
| OrcaRouter workspace | Второй кандидат во всех ролях | Нет | Numeric free pool не опубликован; Kairema workspace limits **UNKNOWN**. |
| Google project | Fallback во всех ролях | Нет | Numeric active-model quota Kairema **UNKNOWN**. |
| Groq organization | Fallback для Flash/Think/Context/Apex | Нет | Per-row public defaults verified, но account tier/remaining allowance и cross-model aggregation **UNKNOWN**. |
| Dots reserve | Пятый listed Context candidate | Нет | Не следует за четырьмя реальными attempts; public capacity evidence отсутствует. |

Следовательно, **CURRENT_POOL total LLM requests/day = UNKNOWN**. Даже условная цифра из публичной таблицы не является гарантией для аккаунта, не отражает текущий остаток и обычно не учитывает token, concurrency, provider availability, region, commercial rights и попытки fallback.

## 5. FALLBACK AMPLIFICATION

Одна логическая генерация может дать от одной до четырёх реальных LLM attempts. Нормальный путь стремится завершиться первым успешным кандидатом, однако retryable failure/cooldown/fallback увеличивает upstream pressure. Формула модели:

> **upstream attempts/day = logical LLM requests/day × average attempts/request**, где average attempts — иллюстративное допущение 1.0, 1.1 или 1.5; строгий кодовый worst case равен 4.0.

| Метрика | Статус | Значение и граница |
|---|---|---|
| Real LLM calls per request | **VERIFIED (source)** | Не более 4: `MAX_ATTEMPTS=4`. |
| Attempt timeout | **VERIFIED (source)** | До 25 секунд на candidate; это latency bound, не capacity guarantee. |
| Typical average attempts | **ILLUSTRATIVE** | 1.0 / 1.1 / 1.5 — modelling cases, не измерение Kairema. |
| Worst-case amplification | **VERIFIED (source)** | ×4 real attempts, если четыре candidates реально вызываются. |
| Actual fallback rate | **UNKNOWN** | Не измерялся и не может быть выведен из registry. |

Поэтому нельзя сопоставлять «1 000 RPD provider-а» с «1 000 пользовательских сообщений»: при average 1.5 это соответствует лишь 667 logical requests при допущении, что именно этот provider был единственным limiting bucket; последнее здесь не доказано.

## 6. SEARCH CAPACITY MAP

Текущий server-side cascade строго упорядочен: **You → Serper → Exa → Tavily**. Он относится к optional web research и не является LLM quota. При неуспехе раннего provider-а один logical search может породить несколько provider attempts, поэтому search demand также нельзя приравнивать к одной операции провайдера.

| Search provider | Публичное правило | Classification | Что неизвестно для Kairema |
|---|---|---|---|
| You | В рамках данного official research не найдена численная public quota. | **UNKNOWN** | Plan, rate/budget, commercial scope, remaining availability. |
| Serper | Рекламируются 2 500 free queries без card. [11] | **VERIFIED figure; renewal UNKNOWN** | Renewal cadence, shared scope, rate limit, commercial eligibility, current balance. |
| Exa | $20 signup credits и $10/month Free Tier credits без payment method; credit price endpoint-dependent. [12] | **VERIFIED credits; request count UNKNOWN** | Queries/month, RPM, commercial terms, current balance and endpoint mix. |
| Tavily | 1 000 free API credits/month; basic search = 1 credit, advanced = 2. [13] | **VERIFIED public pricing** | Kairema balance, RPM, region and whether each Kairema query uses basic semantics. |

Ни один search provider не тестировался запросом. Кодовый freshness contract уже требует не изображать свежие сведения подтверждёнными без received dated evidence; этот аудит не менял его.

## 7. ADDITIONAL INDEPENDENT PROVIDER/MODEL CANDIDATES

Кандидат должен добавлять отдельный quota domain и иметь подтверждённые либо отдельно проверяемые production/free semantics. «ADD NOW» ниже означает **только** «достоин отдельного future evidence task»; это не разрешение на интеграцию, ключ, вызов API или routing change.

| Candidate | Независимый domain | Что подтверждено официально | Ограничение | Ranking |
|---|---|---|---|---|
| Cloudflare Workers AI | Да, отдельный account | Renewable 10 000 Neurons/day; UTC reset; model/token-dependent charging. [7] | Нельзя конвертировать Neurons в turns без candidate model и bounded input/output profile; часть models требует paid plan/prepaid credits. | **ADD NOW** — минимальный набор из одного кандидата для отдельной feasibility/evidence проверки. |
| Mistral | Потенциально да, organization | Free mode permits API keys/included monthly usage; limits shown in authenticated dashboard and organization/workspace spending caps apply. [14] | Public numeric allowance, reset, production eligibility, region and account authorization **UNKNOWN**. | **CONSIDER LATER**. |
| SambaNova | Потенциально да, user account | Free table публикует 20 RPM/20 RPD/200K TPD per listed model; paid Developer 20M TPD across models. [15] | Plans page says payment method and credit purchase are needed to run first requests; cross-model additive status and Kairema eligibility **UNKNOWN**. [16] | **CONSIDER LATER**. |

Cloudflare — единственный current minimal candidate, для которого audit нашёл публично подтверждённый renewable allowance и отдельный provider domain. Это всё ещё **не** даёт high-volume request/day capacity claim.

## 8. CANDIDATES THAT DO NOT ACTUALLY ADD CAPACITY

| Category | Provider / action | Why it does not add verified zero-unexpected-cost capacity |
|---|---|---|
| **NO CAPACITY BENEFIT** | Добавить OpenRouter `:free` model IDs | 20 RPM и 50/1 000 RPD explicitly shared across all `:free` models. [1] |
| **NO CAPACITY BENEFIT** | Добавить Groq IDs или второй key | Organization-level quotas; independent aggregate buckets not established. [2] |
| **NO CAPACITY BENEFIT** | Добавить Google model IDs/API keys | Quotas per project; model ID/key does not prove separate project quota. [3] |
| **NO CAPACITY BENEFIT** | Добавить OrcaRouter `-free` IDs/keys | Keys share workspace bucket; free routing best-effort and no numeric public pool. [4] [5] |
| **NO CAPACITY BENEFIT** | Рассматривать Dots как «пятую попытку» | The hard code budget blocks a fifth real LLM call; it only replaces skipped candidates. |
| **NOT SUITABLE** | ZenMux Free/Builder | Free has no API; Builder is barred from live production/commercial/end-user usage; PAYG is paid. [17] |
| **NOT SUITABLE** | Cerebras Free Trial | $5 after verified payment method, expires after 30 days; no permanently free tier. [18] |
| **NOT SUITABLE** | Cohere trial | 1 000 calls/month and 20 RPM are evaluation/trial, while production keys are paid. [19] |
| **NOT SUITABLE** | Direct DeepSeek API | Documented token-balance paid path; no public renewable free API quota found. [9] |

## 9. CURRENT_POOL VS EXPANDED_POOL SCENARIOS

| Pool definition | Included resource domains | Proven numerical statement | What may be claimed |
|---|---|---|---|
| `CURRENT_POOL` | Existing OpenRouter, OrcaRouter, Google, Groq active chains; latent Dots reserve | No trustworthy aggregate: **UNKNOWN**. | Fallback diversity exists; actual sustainable total capacity is **UNKNOWN**. |
| `EXPANDED_POOL_A` | `CURRENT_POOL` + extra IDs/keys in current provider domains | No newly proved independent allowance. | **No verified capacity increase.** |
| `EXPANDED_POOL_B` | `CURRENT_POOL` + one separate Cloudflare Workers AI account/domain in a future task | +10 000 Neurons/day, not requests/day. [7] | It potentially adds an independent renewable allocation, but LLM turns/day and cost-free eligible model are **UNKNOWN**. |

Для ориентировки, но **не** для суммирования, доступны только следующие public figures: OpenRouter 50 или 1 000 shared free requests/day (threshold status unknown), Groq 1 000 RPD per each listed active GPT-OSS row (organization aggregate relation unknown), и Cloudflare 10 000 Neurons/day. Эти единицы, domains и account statuses несовместимы; складывать их в единую «Kairema RPD» было бы методологической ошибкой.

## 10. 10K/25K/50K CAPACITY MODEL

Registered users не равны спросу. Прозрачная demand formula: **logical LLM requests/day = registered users × DAU rate × requests per DAU**. В таблицу внесены четыре representative points из полной сетки DAU `{1%, 2%, 5%, 10%}` × requests/DAU `{1, 3, 5}`. Они иллюстративны: это не telemetry и не benchmark.

| Registered users | DAU × R/DAU | Logical LLM req/day | Upstream @1.0 avg attempts | @1.1 | @1.5 | Strict worst @4 |
|---:|---:|---:|---:|---:|---:|---:|
| 10 000 | 1% × 1 | 100 | 100 | 110 | 150 | 400 |
| 10 000 | 2% × 3 | 600 | 600 | 660 | 900 | 2 400 |
| 10 000 | 5% × 3 | 1 500 | 1 500 | 1 650 | 2 250 | 6 000 |
| 10 000 | 10% × 5 | 5 000 | 5 000 | 5 500 | 7 500 | 20 000 |
| 25 000 | 1% × 1 | 250 | 250 | 275 | 375 | 1 000 |
| 25 000 | 2% × 3 | 1 500 | 1 500 | 1 650 | 2 250 | 6 000 |
| 25 000 | 5% × 3 | 3 750 | 3 750 | 4 125 | 5 625 | 15 000 |
| 25 000 | 10% × 5 | 12 500 | 12 500 | 13 750 | 18 750 | 50 000 |
| 50 000 | 1% × 1 | 500 | 500 | 550 | 750 | 2 000 |
| 50 000 | 2% × 3 | 3 000 | 3 000 | 3 300 | 4 500 | 12 000 |
| 50 000 | 5% × 3 | 7 500 | 7 500 | 8 250 | 11 250 | 30 000 |
| 50 000 | 10% × 5 | 25 000 | 25 000 | 27 500 | 37 500 | 100 000 |

Для search применяется отдельно: **logical search/day = logical LLM requests/day × search share**. Например, при 10% search share high-demand rows дают 500 / 1 250 / 2 500 logical searches/day для 10K / 25K / 50K соответственно. Реальных provider attempts может быть больше из-за cascade; multiplier, cache hit rate, token usage и peak concurrency — **UNKNOWN**.

Даже 10K registered users могут быть малой либо большой нагрузкой в зависимости от DAU/R-per-DAU. Нельзя объявлять `CURRENT_POOL` достаточным ни для одного tier: фактическая quota, token mix, model availability, fallback rate и peak-pattern не были измерены.

## 11. NOISY-USER FAIRNESS FINDINGS

Существующие code-level controls уменьшают риск, что один пользователь monopolizes один process: durable chat-ingress quota ограничена 60 requests/minute per user; локальный SSE guard допускает 12 active streams/process и не более 2/user/process. Они срабатывают до provider work и не содержат prompt/response quota data.

| Boundary | Что защищает | Что не защищает |
|---|---|---|
| Durable per-user ingress 60/min | Один actor не может создавать неограниченный ingress в системе. | Per-user daily/token/fallback budget, provider-wide RPD/TPM и burst across users. |
| 2 streams/user/process | Одна сессия не держит весь local SSE limit. | Один user через несколько pods; global concurrent stream limit. |
| 12 streams/process | Предсказуемая local admission / controlled 503 при saturation. | Global capacity: process-local map не coordinated между autoscaled pods. |

Provider limits обычно account/project/organization/workspace-scoped, а не user-scoped. Следующим возможным design task после достаточной quota evidence может быть durable per-user daily/token/fallback budget; он **не реализуется** в рамках этого аудита.

## 12. ZERO-UNEXPECTED-COST RISKS

«Free» не означает гарантированно нулевую и бессрочную production cost. Основные риски — billing gates, dynamic catalog, time-bounded trial, token-priced units и shared quotas. Не выполнялось ни одного действия для снятия этих рисков.

| Risk | Evidence | Effect |
|---|---|---|
| Account-specific tier/balance differs from public table | OpenRouter threshold, Groq dashboard-authoritative limits, Google AI Studio quota view. [1] [2] [3] | Actual available traffic may be lower, zero, or subject to different terms. |
| Shared domain treated as additive | Explicit OpenRouter shared allowance; Google/Groq/Orca scope evidence. [1] [2] [3] [4] | Overstated capacity and unexpected exhaustion/fallback. |
| Trial or paid-only hidden as free production capacity | Cerebras, Cohere, Direct DeepSeek, ZenMux. [9] [17] [18] [19] | Cost, service stop, or policy violation. |
| Unit mismatch | Cloudflare Neurons depend on model/input/output tokens. [7] | Cannot reserve a number of user turns without token profile. |
| Region/commercial/data-policy uncertainty | Not exhaustively evidenced for account eligibility. | **UNKNOWN**; blocks production readiness claim. |

## 13. SEARCH CACHE OPPORTUNITY

Ниже — только design direction; cache, database, route, TTL, storage и search cascade в этом аудите не менялись.

| Design boundary | Proposed safety rule | Classification |
|---|---|---|
| Cache key | Normalize only non-personal public freshness query plus source/policy version; do not key on user identity. | **DESIGN-ONLY**. |
| Eligible content | Public non-personal results with provenance/date metadata; never user prompts beyond normalized public query, profile, memory, chat history, attachments, document text or private RAG. | **DESIGN-ONLY / privacy constraint**. |
| TTL | Source- and query-class-specific: news shorter, stable public references longer. | Exact TTLs and hit rate **UNKNOWN**. |
| Failure caching | Do not treat temporary provider failure as durable factual absence; any negative/degraded cache needs a very conservative separately reviewed policy. | **DESIGN-ONLY**. |
| Provider terms | Validate caching/redistribution permissions per provider before implementation. | **UNKNOWN**; no exhaustive terms review was done. |

Правильно scoped shared public cache может снижать duplicate external searches, но не создаёт LLM capacity и не может быть обещан как quota solution до source-policy, privacy, terms и workload evidence.

## 14. VERIFIED / ILLUSTRATIVE / UNKNOWN separation

| Classification | В этом отчёте означает | Примеры |
|---|---|---|
| **VERIFIED** | Наблюдаемый source invariant либо публичное правило официальной документации на дату audit. | Four public roles, `MAX_ATTEMPTS=4`; OpenRouter shared 20 RPM/50-or-1 000 RPD; Groq published row limits; Cloudflare 10 000 Neurons/day. |
| **ILLUSTRATIVE** | Explicit scenario assumption/formula, а не measurement или commitment. | DAU 1–10%, 1/3/5 requests per DAU, 1.0/1.1/1.5 average attempts, example 10% search share. |
| **UNKNOWN** | Требует account dashboard, provider confirmation, real non-production measurement или user-approved evidence collection; ничего из этого здесь не делалось. | Kairema tier/balance/remaining quota, total combined pool, model availability, actual fallback rate, RPS/TPM/concurrency, region/commercial entitlement, cache hit rate. |
| **NOT APPLICABLE** | Не входит в sustainable zero-unexpected-cost production arithmetic. | Cerebras time-limited trial, ZenMux Builder, Cohere evaluation trial, Direct DeepSeek paid route. |

Этот audit не является load test, quota measurement, security certification или production readiness certification. Он намеренно не превращает provider marketing figures в гарантии Kairema.

## 15. RECOMMENDED NEXT STEP

Остановиться после этого evidence-only checkpoint. **Не менять текущий routing, models, fallback, search cascade, quotas, secrets, UI, schema или infrastructure.** `CURRENT_POOL` нельзя объявлять достаточным для 10K, 25K или 50K: по текущим доказательствам его real sustainable capacity **UNKNOWN**.

Минимальный future evidence path — один отдельно одобренный этап **Cloudflare Workers AI feasibility review**: подтвердить eligible model, commercial/data terms, account/billing preconditions, Neuron-to-token profile и безопасный non-production integration design до любых calls or routing edits. Это единственный кандидат ранга **ADD NOW** и означает «сначала изучить», не «сразу подключить».

Mistral и SambaNova остаются **CONSIDER LATER**, потому что их public numeric/account/production evidence недостаточна либо конфликтует с billing start condition. Все внутренние model-ID вариации в existing pools — **NO CAPACITY BENEFIT**; ZenMux, Cerebras trial, Cohere trial и Direct DeepSeek — **NOT SUITABLE** для требуемого zero-unexpected-cost public production pool.

## References

[1]: https://openrouter.ai/docs/api_reference/limits "OpenRouter — API limits"
[2]: https://console.groq.com/docs/rate-limits "Groq — Rate limits"
[3]: https://ai.google.dev/gemini-api/docs/rate-limits "Google Gemini API — Rate limits"
[4]: https://docs.orcarouter.ai/operations/rate-limits "OrcaRouter — Rate limits"
[5]: https://docs.orcarouter.ai/routing/free-models "OrcaRouter — Free models"
[6]: https://www.orcarouter.ai/terms.html "OrcaRouter — Terms"
[7]: https://developers.cloudflare.com/workers-ai/platform/pricing/ "Cloudflare Workers AI — Pricing"
[8]: https://console.groq.com/docs/models "Groq — Models"
[9]: https://api-docs.deepseek.com/quick_start/pricing/ "DeepSeek — Pricing"
[10]: https://api-docs.deepseek.com/quick_start/rate_limit/ "DeepSeek — Rate limits"
[11]: https://serper.dev/ "Serper — Official pricing page"
[12]: https://exa.ai/docs/reference/billing "Exa — Billing"
[13]: https://docs.tavily.com/documentation/api-credits "Tavily — API credits"
[14]: https://docs.mistral.ai/admin/billing-usage/usage-limits "Mistral — Usage limits"
[15]: https://docs.sambanova.ai/docs/en/models/rate-limits "SambaNova — Model rate limits"
[16]: https://cloud.sambanova.ai/plans "SambaNova — Plans"
[17]: https://zenmux.ai/docs/guide/subscription.html "ZenMux — Subscription"
[18]: https://inference-docs.cerebras.ai/support/rate-limits "Cerebras — Rate limits"
[19]: https://docs.cohere.com/docs/rate-limits "Cohere — Rate limits"
