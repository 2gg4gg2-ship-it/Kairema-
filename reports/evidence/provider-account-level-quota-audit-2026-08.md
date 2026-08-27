# Kairema — Provider Account-Level Quota Audit

**Дата:** 27 августа 2026 (GMT+3)  
**Статус:** завершённый evidence-only, строго read-only аудит.  
**Метод:** source-level inspection текущей server-side конфигурации, пассивный просмотр уже доступных owner/provider страниц и официальная документация. Не выполнялись LLM/search/inference-запросы, prompts, sign-in, выбор аккаунта/проекта, API/dashboard endpoint calls, создание/раскрытие/ротация ключей, payment/billing actions, новая интеграция, изменение routing, model list, fallback, quota, code, UI, schema или infrastructure.

> **Ключевой результат:** на дату аудита нет ни одного current provider/search quota, remaining balance или usage value, подтверждённого на уровне аккаунта Kairema. Это означает **не нулевую capacity**, а **невозможность численно доказать доступную current free capacity**. Опубликованные лимиты ниже — только **DOCUMENTED**, не измерение и не обещание live availability.

## 1. PROVIDER ACCOUNT INVENTORY

Текущий source of truth — server-side registry `server/providers.ts`; клиент не получает ключи или внутренние цепочки. Публичный контракт сохраняет ровно четыре роли и не менялся.

| Роль | Current candidate chain в порядке fallback | Provider account/quota domain | Статус account-level metadata |
|---|---|---|---|
| **Flash** | OpenRouter `openai/gpt-oss-20b:free` → OrcaRouter `deepseek/deepseek-v4-flash-free` → Groq `openai/gpt-oss-20b` → Google `gemini-flash-lite-latest` | OpenRouter account; OrcaRouter workspace; Groq organisation; Google project/model | **NOT AVAILABLE** для всех четырёх domains |
| **Think** | OpenRouter `google/gemma-4-26b-a4b-it:free` → OrcaRouter `tencent/hy3-free` → Google Gemini Flash Lite → Groq GPT-OSS 120B | Те же четыре vendor domains; model ID не доказывает независимый quota domain | **NOT AVAILABLE** |
| **Context** | OpenRouter `nvidia/nemotron-3-ultra-550b-a55b:free` → OrcaRouter DeepSeek V4 Flash free → Google Gemini Flash Lite → Groq GPT-OSS 120B → Dots `dots-studio/dots3-note-prev` | Четыре primary domains; Dots — server-only reserve | **NOT AVAILABLE**; Dots quota/billing evidence — **UNKNOWN** |
| **Apex** | OpenRouter `google/gemma-4-31b-it:free` → OrcaRouter `deepseek/deepseek-v4-pro-free` → Google Gemini Flash Lite → Groq GPT-OSS 120B | Те же четыре primary domains | **NOT AVAILABLE** |

`MAX_ATTEMPTS=4` — **source-level VERIFIED** hard bound на реальные LLM network attempts per logical request. Поэтому пятый Dots candidate не образует «пятую попытку» после четырёх реальных upstream вызовов; он может быть рассмотрен только если прежние candidates пропущены до attempt budget. Dots нельзя прибавлять к публичной free capacity.

Текущий source-level search cascade отдельно от LLM: **You → Serper → Exa → Tavily**. Он не является доказательством живого ключа, quotas или параллельной доступности всех четырёх search providers.

## 2. LLM ACCOUNT-LEVEL QUOTAS

| Provider / active model family | Account-level observation | Published quota / scope | Remaining, usage, reset, billing state | Classification |
|---|---|---|---|---|
| **OpenRouter** / all `:free` active candidates | `settings/credits` redirected to sign-in; no account data visible | 20 RPM; 50 RPD if lifetime purchased credits < $10, 1,000 RPD at/above $10; free traffic subject to platform/upstream caps. [Official limits](https://openrouter.ai/docs/api-reference/limits) | Historic-credit threshold, balance, active free eligibility, per-key cap, usage and reset: **NOT AVAILABLE** | Limits **DOCUMENTED**; current Kairema values **NOT AVAILABLE / UNKNOWN** |
| **Groq** / GPT-OSS 20B, GPT-OSS 120B | Organisation limits page showed loading/sign-in shell only | Each listed model row on Free table: 30 RPM, 1,000 RPD, 8K TPM, 200K TPD. Limits are organisation-level, and a binding dimension may reject first. [Official limits](https://console.groq.com/docs/rate-limits) | Organisation, plan, per-model split, remaining, usage, reset and headers: **NOT AVAILABLE** | Public defaults **DOCUMENTED**; current values **NOT AVAILABLE / UNKNOWN** |
| **Google Gemini API** / Gemini Flash Lite | AI Studio redirected to signed-out account chooser | Google evaluates RPM, input TPM and RPD per project, model and tier; RPD resets midnight Pacific time. [Official limits](https://ai.google.dev/gemini-api/docs/rate-limits) | Project, tier, model-specific limits, remaining, usage, billing and reset values: **NOT AVAILABLE** | Semantics **DOCUMENTED**; current values **NOT AVAILABLE / UNKNOWN** |
| **OrcaRouter** / free candidates | Canonical documented console rendered blank; no workspace value visible | Rate limits are per workspace; all workspace keys share bucket. Numeric free caps and remaining/reset headers are not published. [Official limits](https://docs.orcarouter.ai/operations/rate-limits) | Plan, bucket size, remaining, usage, reset, billing and per-model split: **NOT AVAILABLE** | Scope and 429 semantics **DOCUMENTED**; numeric current quota **UNKNOWN** |
| **Dots Studio** / Context reserve | No official API quota/billing/rate-limit documentation found; no dashboard action attempted | No admissible public numeric figure | All quota, balance, error, billing, region and commercial conditions: **UNKNOWN / NOT AVAILABLE** | Cannot count toward capacity |

For public error semantics: OpenRouter documents 401 invalid/disabled/expired credentials, 402 insufficient credits and several 403/429 causes; OrcaRouter documents `429` with `Retry-After`; Groq documents `429` with `Retry-After`; Google documents `429 RESOURCE_EXHAUSTED`. These are **DOCUMENTED contracts**, not live Kairema error observations. No 401/403/429 was intentionally provoked.

## 3. SEARCH ACCOUNT-LEVEL QUOTAS

Search capacity is not LLM capacity and must not be added to an LLM request/day total.

| Current search provider | Account-level observation | Public terms relevant to capacity | Account-level conclusion |
|---|---|---|---|
| **You** | Public API docs only; no Platform dashboard entered | Docs advertise a no-key MCP profile at 100 queries/day and $100 complimentary credits for new API-key accounts. [Official docs](https://docs.you.com/) | Kairema is not verified to use the public MCP profile. Current plan, quota, remaining, reset, production terms and error state are **NOT AVAILABLE / UNKNOWN**. |
| **Serper** | Redirected to login; no credentials used | Current public pricing URL retrieval returned 404. Earlier public home-page evidence is not used as current account capacity. | Current free quota, renewal, QPS, scope, remaining, reset, payment and production eligibility are **NOT AVAILABLE**. |
| **Exa** | Vercel Security Checkpoint; no challenge bypassed | Free tier advertises $20 signup + $10 monthly credit, no payment method, 5 Search QPS and 3 Agent concurrency; pricing is endpoint-specific. [Official pricing](https://exa.ai/pricing) | Dollar credits cannot become requests/day without selected endpoint and current balance. Current plan, balance, reset/carry and billing state are **NOT AVAILABLE / UNKNOWN**. |
| **Tavily** | Dashboard returned CloudFront 403 request-blocked before account UI | Docs state 100 RPM Development and 1,000 RPM Production; Production key access requires Paid Plan or PAYGO. [Official limits](https://docs.tavily.com/documentation/rate-limits) | Key environment, plan, balance, rate-limit, reset and production eligibility are **NOT AVAILABLE / UNKNOWN**. It is **not** verified zero-unexpected-cost production capacity. |

No account-level cache/deduplication permissions, regional restriction, search remaining balance or live availability is confirmed. The code’s provider order and 10-minute local cooldown for selected errors are **source-level facts**, not shared quota protection.

## 4. SHARED QUOTA DOMAINS

| Domain | What is established | What must not be assumed |
|---|---|---|
| **OpenRouter account / free traffic** | Public free traffic has platform policy limits; the configured role models are all OpenRouter `:free` candidates. | The four OpenRouter model IDs are **not** four independently additive free pools. Current account threshold, balance and any model-specific split are **UNKNOWN**. |
| **OrcaRouter workspace** | All keys in one workspace share one rate-limit bucket. | New key/member/model ID does not create a proven additional capacity domain; numeric bucket is **UNKNOWN**. |
| **Groq organisation** | Limits apply at organisation level; public table lists separate model rows. | GPT-OSS 20B and 120B cannot be summed into 2,000 verified Kairema RPD: current organisation/plan and whether rows yield independent aggregate capacity are **UNKNOWN**. |
| **Google project/model/tier** | Quotas are evaluated by project, model and tier. | A Google frontend/model ID is not independent of its project, and actual tier/model values are **UNKNOWN**. All Kairema roles use the same Flash Lite route. |
| **Dots account/route** | It is source-level server-only reserve only. | Any independent quota, no-cost status or production eligibility is **UNKNOWN**. |
| **Search providers** | Vendors are externally distinct services in code. | Existing keys/accounts, licence scope and actual quotas do not prove simultaneous independent capacity. Search must remain separate from LLM pool. |

## 5. CURRENT KAIREMA PROVIDER CAPACITY MAP

| Layer | Source-level status | Documented quota ceiling usable as a constraint | Account-level current free capacity |
|---|---|---|---|
| LLM admission | Four public roles; <=4 real upstream attempts; Provider Health/cooldown and server-side allowlist preserved | `MAX_ATTEMPTS=4` is a **VERIFIED code bound**, not a provider allocation | **UNKNOWN** |
| OpenRouter | Present in all roles | 20 RPM and conditional 50/1,000 RPD free figures | **NOT AVAILABLE** |
| OrcaRouter | Present in all roles | Workspace-shared scope; numerical cap unpublished | **UNKNOWN** |
| Groq | Present in all roles | Published per-listed-model 30 RPM / 1K RPD / 8K TPM / 200K TPD defaults | **NOT AVAILABLE** |
| Google | Present in all roles | Project/model/tier-specific RPM/TPM/RPD, exact values external to this audit | **NOT AVAILABLE** |
| Dots | Context reserve only | No usable public figure | **UNKNOWN** |
| Search cascade | Optional Search/RAG, independent of LLM paths | Exa/Tavily/You documented terms vary; Serper current terms unavailable | **NOT AVAILABLE / UNKNOWN** |

**Current pool conclusion:** there are four externally distinct primary provider frontends in each normal role chain, but the available Kairema account quota and provider-level independence are not verified. Therefore **a numeric aggregate current LLM capacity is not established** and cannot be represented by adding models, vendors or search credits.

## 6. FALLBACK INDEPENDENCE

| Role | Distinct fallback vendors in code | Independence conclusion | Degradation implication |
|---|---|---|---|
| Flash | OpenRouter, OrcaRouter, Groq, Google | Vendor endpoints are distinct; actual accounts and quotas are **UNKNOWN** | One upstream failure can move work to next vendor but may multiply provider attempts. |
| Think | OpenRouter, OrcaRouter, Google, Groq | Same conclusion | Same four-attempt maximum. |
| Context | OpenRouter, OrcaRouter, Google, Groq; conditional Dots reserve | Dots does not expand attempt budget and has unknown quota | Do not count five providers’ capacity. |
| Apex | OpenRouter, OrcaRouter, Google, Groq | Same conclusion | Same four-attempt maximum. |

Fallback is a resilience mechanism, **not** capacity multiplication. With average `A` upstream attempts per logical request, upstream LLM demand is `U = L × A`, where `1.0`, `1.2` and `1.5` are illustrative averages and `4` is the **VERIFIED code maximum** for a request. A retryable outage can consume more than one vendor quota domain before controlled failure; live frequency was not measured.

## 7. CURRENT POOL CAPACITY

There is **no ACCOUNT-LEVEL VERIFIED requests/day, tokens/day, concurrency or remaining balance** for any configured LLM provider. Accordingly the strict current capacity ledger is:

| Independent quota-domain candidate | Numeric public fact | Can be used as current Kairema capacity? | Reason |
|---|---:|---|---|
| OpenRouter | 20 RPM; conditional 50/1,000 RPD | **No** | Threshold, plan/credits, remaining and free eligibility are not visible. |
| Groq | Per-row 30 RPM; 1,000 RPD; 8K TPM; 200K TPD | **No** | Organisation/plan/current limits and cross-row aggregation are not visible. |
| Google Gemini | No fixed universal public number | **No** | Tier/project/model values unavailable. |
| OrcaRouter | Workspace scope; numeric free cap unpublished | **No** | Numeric budget and account state unavailable. |
| Dots | No admissible figure | **No** | Full eligibility/quota/billing state unknown. |

Thus **VERIFIED CURRENT POOL CAPACITY = NOT ESTABLISHED**, not `0` and not a guarantee of any daily count. The documented values are potential external constraints only; none authorises an upper-bound sum for the live Kairema configuration.

## 8. 10K/25K/50K DEMAND VS CAPACITY

All values in this section are **ILLUSTRATIVE DEMAND**, not benchmark results, current usage or production-capacity claims. Formula: `L = registered users × DAU share × AI requests per DAU per day`.

| Registered users | DAU | AI requests / DAU / day | L: logical AI requests / day |
|---:|---:|---:|---:|
| 10,000 | 1% | 1 / 3 / 5 | 100 / 300 / 500 |
| 10,000 | 2% | 1 / 3 / 5 | 200 / 600 / 1,000 |
| 10,000 | 5% | 1 / 3 / 5 | 500 / 1,500 / 2,500 |
| 10,000 | 10% | 1 / 3 / 5 | 1,000 / 3,000 / 5,000 |
| 25,000 | 1% | 1 / 3 / 5 | 250 / 750 / 1,250 |
| 25,000 | 2% | 1 / 3 / 5 | 500 / 1,500 / 2,500 |
| 25,000 | 5% | 1 / 3 / 5 | 1,250 / 3,750 / 6,250 |
| 25,000 | 10% | 1 / 3 / 5 | 2,500 / 7,500 / 12,500 |
| 50,000 | 1% | 1 / 3 / 5 | 500 / 1,500 / 2,500 |
| 50,000 | 2% | 1 / 3 / 5 | 1,000 / 3,000 / 5,000 |
| 50,000 | 5% | 1 / 3 / 5 | 2,500 / 7,500 / 12,500 |
| 50,000 | 10% | 1 / 3 / 5 | 5,000 / 15,000 / 25,000 |

| Population envelope | Logical L / day | Upstream LLM attempts `L×1.0 / 1.2 / 1.5 / 4` | Search logical requests at 0% / 10% / 20% share |
|---|---:|---:|---:|
| 10K: smallest / largest row | 100 / 5,000 | 100 / 120 / 150 / 400; 5,000 / 6,000 / 7,500 / 20,000 | 0 / 10 / 20; 0 / 500 / 1,000 |
| 25K: smallest / largest row | 250 / 12,500 | 250 / 300 / 375 / 1,000; 12,500 / 15,000 / 18,750 / 50,000 | 0 / 25 / 50; 0 / 1,250 / 2,500 |
| 50K: smallest / largest row | 500 / 25,000 | 500 / 600 / 750 / 2,000; 25,000 / 30,000 / 37,500 / 100,000 | 0 / 50 / 100; 0 / 2,500 / 5,000 |

Search upstream calls may be greater than logical search requests because its cascade can make up to four provider attempts before failure; the exact average is **UNKNOWN**. No demand row can be compared to current available pool capacity, because that denominator is **NOT ESTABLISHED**. Public per-provider figures must not be mixed across RPM, RPD, TPM/TPD, credit dollars and neurons without a defined model/token budget.

## 9. FIRST BOTTLENECKS

| Scenario condition | First binding limit that is actually established | Result / boundary |
|---|---|---|
| Any individual user bursts in Kairema | Durable per-user chat ingress cap: 60 requests/minute; SSE local admission: 2 active streams/user/process | **SOURCE-LEVEL VERIFIED.** These are fairness/admission controls, not global provider capacity. |
| More than 12 active streams on one process | Local SSE admission cap: 12 streams/process; controlled pre-provider 503 | **SOURCE-LEVEL VERIFIED.** Does not prove replicas or global stream count. |
| OpenRouter free route burst | Published 20 RPM | **DOCUMENTED possible limiter**, not a verified current Kairema binding cap. |
| Groq Free defaults | Published 30 RPM / 1K RPD / 8K TPM / 200K TPD per row | **DOCUMENTED possible limiter**; actual org plan and split are unavailable. |
| Google / OrcaRouter / Dots | Exact current numerical cap unavailable | **UNKNOWN**; no first limiter can be selected. |
| Search with Tavily Production key | Production key requires Paid Plan/PAYGO | **DOCUMENTED zero-cost eligibility gate**, but current key environment is unavailable. |

The first **proven global provider bottleneck is UNKNOWN**. The first proven Kairema-local bounds are admission/rate controls listed above. Any statement that the current pool first exhausts on a specific provider/day would require account-level remaining quotas, fixed token budgets and traffic distribution — none were measured.

## 10. ZERO-UNEXPECTED-COST RISKS

| Provider / path | Evidence-based zero-cost status | Required safe behavior when free quota/eligibility ends |
|---|---|---|
| OpenRouter `:free` routes | Current balance, account credits and spend controls are **NOT AVAILABLE**. Docs distinguish 402 insufficient credits from 429 free/rate/upstream limits. | Never substitute a paid model or add credits automatically; preserve controlled unavailable/degraded response. |
| Groq | Live plan/billing state **NOT AVAILABLE**. Public Free defaults are not an account guarantee. | Treat 429/availability failure as no-cost controlled fallback only; do not activate paid plan. |
| Google Gemini | Project tier/billing/remaining **NOT AVAILABLE**. | Do not infer zero cost from model name; fail safely and preserve existing fallback limits. |
| OrcaRouter free routes | Workspace plan/free traffic availability and cost semantics **NOT AVAILABLE**; free traffic is best effort in prior official evidence. | Do not create keys/workspaces or select paid route as quota bypass. |
| Dots reserve | Billing and commercial terms **UNKNOWN**. | Not suitable as a zero-unexpected-cost capacity source until separately verified. |
| Tavily | Production key docs require Paid Plan/PAYGO. | **NOT SUITABLE** for a zero-unexpected-cost production capacity claim. Keep optional-search degradation rather than activating billing. |
| Exa / Serper / You | Current account entitlement and conversion of credits to calls are unavailable. | Never enable auto-recharge/top-up or paid fallback. Provider exhaustion should yield honest no-fresh-source behavior. |

No automatic paid fallback was added or authorised. Adding accounts/projects/keys only to evade quota constraints is **NOT SUITABLE** and is not a scaling design.

## 11. NOISY-USER/FAIRNESS IMPLICATIONS

Kairema already has a durable, user-scoped 60-per-minute ingress quota before history/context/provider work, plus process-local SSE admission of 12 active streams total and 2 per user, with release in `finally`. Replay/idempotency, signed history cursors, role-specific bounded transcript windows, user-scoped memory, server-side Provider Health/cooldown and controlled degradation further reduce a single user’s ability to monopolise one process.

These are **SOURCE-LEVEL VERIFIED** protections, but provider scopes are account/project/organisation/workspace-level. Therefore one user’s requests can still consume a shared upstream daily/token quota that others need. A future design review may consider durable per-user daily/token/fallback budgets and a globally coordinated admission controller; it must use independently confirmed provider budget data first. **No controller is implemented in this audit.**

## 12. CLOUDFLARE WORKERS AI FEASIBILITY

| Question | Official evidence | Feasibility classification |
|---|---|---|
| Is it an externally independent quota-domain candidate? | Workers AI is a separate Cloudflare service, not OpenRouter/Groq/Google/OrcaRouter. | **REAL INDEPENDENT CAPACITY INCREASE — DOCUMENTED candidate only** |
| Is there a published free allocation? | 10,000 Neurons/day on Workers Free and Paid; reset 00:00 UTC. [Workers AI pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/) | **DOCUMENTED**, but neurons are not requests. |
| Is a rate limit published? | Default text-generation limit is 300 RPM, subject to model/task exceptions. [Workers AI limits](https://developers.cloudflare.com/workers-ai/platform/limits/) | **DOCUMENTED default**; quota aggregation scope and live account value **UNKNOWN**. |
| Can the allocation become chat turns/day? | Neuron consumption varies by model and input/output coefficients. | **NOT APPLICABLE** without selected free-eligible model and bounded token budget. |
| Is it zero-cost ready now? | Some frontier models require paid billing method; Kairema lacks Cloudflare account/model/terms/DPA/compatibility review. | **NOT SUITABLE NOW** for current free-first production pool. |
| Can Kairema use it today? | REST integration requires account, Account ID, token and a new route/proxy; Workers Free also has execution limits. | **NO — OUT OF SCOPE.** No account, token, Worker, inference or integration was created. |

Cloudflare’s current catalog includes text models, but model presence is not free eligibility, capacity, licence approval or route compatibility. Its documented allocation is a future independent capacity candidate, not an additive `requests/day` amount and not a production recommendation.

## 13. ADDITIONAL PROVIDER CANDIDATES

| Candidate / category | Capacity verdict | Reason and next boundary |
|---|---|---|
| **Cloudflare Workers AI** | **REAL INDEPENDENT CAPACITY INCREASE** (candidate only) | Separate vendor and documented neuron allocation; needs a new, separately authorised feasibility/integration review. |
| New OpenRouter free model ID | **NO INDEPENDENT CAPACITY** | Same OpenRouter account/free policy until a distinct quota domain is proven. |
| New OrcaRouter free model/key | **NO INDEPENDENT CAPACITY** | Workspace-shared bucket; new key is non-additive. |
| Groq extra model ID | **UNKNOWN** | Public model rows exist, but current organisation plan and aggregate independence are unverified. |
| Google additional frontend/model | **UNKNOWN** | Project/model/tier-specific; independence and live tier require account evidence. |
| Direct DeepSeek | **NOT SUITABLE** | Prior official review found paid token-balance semantics; no renewable verified free production pool. |
| Cerebras Free Trial / Cohere trial | **NOT SUITABLE** | Time-limited/evaluation terms do not establish sustainable free production capacity. |
| SambaNova / Mistral / ZenMux | **UNKNOWN** or **NOT SUITABLE** for free-first | Prior official evidence lacked verified sustainable production-zero-cost scope; ZenMux Builder terms prohibit production/end-user use. |
| Search candidates (Exa, Serper, You, Tavily) | **NOT LLM CAPACITY** | May contribute independent fresh-source routes only after separate account/terms proof; never added to LLM pool. |

## 14. MANUS CAPACITY STILL UNKNOWN

The preceding Manus/WebDev review remains unchanged: account shell displayed only **Free plan**. Kairema-specific cloud/AI/API usage, applicable limits, billing-cycle/reset, current/maximum replicas, region, runtime CPU/RAM consumption, database/storage/bandwidth/API usage, connection pool and throttling data were not visible through the permitted owner UI.

Official WebDev documentation describes Autoscale as Cloud Run with documented 0–5 instances and 1 vCPU/512 MB per instance, but actual Kairema replica count/region/usage are **UNKNOWN**. The local 12-stream SSE boundary is not a global capacity number. No production build was run; the existing **production build SIGTERM/resource diagnosis remains a separate blocker**.

## 15. VERIFIED / ILLUSTRATIVE / UNKNOWN

| Label | Meaning in this report | Examples |
|---|---|---|
| **ACCOUNT-LEVEL VERIFIED** | Safely visible in authorised owner UI, no mutation | General Manus shell label: Free plan only. No provider quotas reached this level. |
| **SOURCE-LEVEL VERIFIED** | Read directly from Kairema server source/tests | Four roles, <=4 LLM attempts, provider/search chain order, 60/min durable ingress, local 12/2 SSE guard. |
| **DOCUMENTED** | Official public provider/platform page; not Kairema account observation | OpenRouter 20 RPM; Groq public defaults; Google quota scope; OrcaRouter workspace scope; Cloudflare neurons/day; Exa/Tavily terms. |
| **ILLUSTRATIVE** | Transparent arithmetic assumption only | DAU/R-per-DAU demand table; average 1.0/1.2/1.5 attempts; search share 0/10/20%. |
| **UNKNOWN** | No admissible source or inaccessible account data | Remaining balances, live quotas, current provider billing, per-model split, global availability, latency and first provider limiter. |
| **NOT AVAILABLE** | Relevant page/account value was not safely visible or was blocked by sign-in/verification/network | OpenRouter, Groq, Google, OrcaRouter, Tavily, Exa and Serper account fields. |
| **NOT APPLICABLE** | Unit cannot be converted honestly with present evidence | Cloudflare Neurons/day to chat requests/day; dollar credits to requests/day without endpoint/token assumptions. |

## 16. RECOMMENDED NEXT STEP

### Final verdict

1. **Хватает ли current independent provider pool для realistic low-DAU 10K/25K/50K?** **Не доказано.** Даже 10K/1%/1 scenario creates 100 illustrative logical AI requests/day, but no current account-level remaining/free quotas are available for comparison. This is neither PASS nor a failure claim.
2. **Какие additional providers/models реально добавляют новую free capacity?** Only **Cloudflare Workers AI** is a **DOCUMENTED independent vendor/quota-domain candidate**; its 10,000 Neurons/day cannot become Kairema chat requests/day without a separately approved selected model/token/eligibility review. New OpenRouter/Orca model IDs are non-additive; Groq/Google additions are unknown; trials/paid/direct paths are unsuitable for free-first.
3. **Что является first proven bottleneck и что менять следующим этапом?** The only proven first Kairema bounds are local durable user ingress and SSE admission. The first global provider limiter is **UNKNOWN**; published OpenRouter/Groq figures are constraints, not live bindings. **No production change is justified from this evidence alone.**

> **Recommended next action:** obtain a separately authorised, passive account-level view for the currently configured provider accounts that exposes plan, remaining quota and reset without generating traffic. If such view remains unavailable, preserve the existing bounded fallback/degradation behaviour and do **not** expand routing, add models, activate billing, create accounts, or claim 10K/25K/50K capacity. A Cloudflare Workers AI feasibility task may be considered only after the above evidence gap is acknowledged and must remain separate from implementation.

### Preserved invariants and stop condition

All Kairema invariants remain unchanged: Flash/Think/Context/Apex, <=4 attempts, server Provider Health/cooldown/allowlist, canonical verified identity, user-scoped memory, signed cursor pagination, bounded transcripts, owner-only exports/probes, secure attachments, Google OAuth, Stytch email/password, Search/RAG, draft autosave and zero client-side secrets. **Stytch Magic Link remains external BLOCKED and untouched.** **Production build SIGTERM/resource diagnosis remains deferred and untouched.** Stop after this report: no Cloudflare integration, capacity controller, cache/scheduler, migration, infrastructure or billing work has begun.
