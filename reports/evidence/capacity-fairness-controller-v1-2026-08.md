# KAIREMA AI Capacity & Fairness Controller V1 — implementation evidence

**Статус:** implementation complete; этот документ не заявляет production-capacity и не заменяет отдельный production build SIGTERM diagnosis или Stytch Magic Link blocker.

## Scope and preserved invariants

Controller V1 добавляется как единственный server-side слой admission и accounting поверх уже существующего router. Он не меняет публичные роли **Flash / Think / Context / Apex**, `MAX_ATTEMPTS = 4`, provider allowlists, Provider Health/cooldowns, canonical server-verified identity, user-scoped data, current Search/RAG cascade, OAuth/Stytch auth, attachments, drafts или owner guard. Не добавлены Redis, очередь как отдельный сервис, VPS, AWS, Cloudflare account/token/Worker, billing action, provider model ID или автоматический paid fallback.

## Implemented controller contract

| Area | Controller V1 behavior | Scope / truthfulness boundary |
|---|---|---|
| WCU | Server-derived role plus modifier weights (`thinking`, `vision`, `detailed`, `highEffort`, `webResearch`) | WCU is a configured policy unit, **not** measured provider tokens, price or global capacity proof. |
| Admission | Canonical `userId` plus server-saved message identity form trusted actor/request keys | Client neither supplies quota identity nor reservation key. |
| Reservation | Durable idempotent reservation before each actual provider fetch; settlement/release is guarded | A rejected reservation creates no upstream attempt and does not consume the existing four-attempt budget. |
| Fallback | Each existing fallback attempt is independently reserved; no fifth attempt is introduced | Existing provider chains, health and cooldown logic stay authoritative. |
| Fairness | Durable scoped minute WCU windows plus instance-local generation/search concurrency | Instance-local counters are expressly **not** global production concurrency. |
| Queue | Safe default is disabled; if explicitly enabled, only low-cost Flash may use the short-lived, instance-local queue bounded to 1,500 ms / 64 waiters | It is not a distributed queue or fairness proof across replicas. |
| Search | Separate search reservation hook wraps only the existing live-search call | Search order and truthful stale/degraded outcomes remain unchanged; no query/content cache is stored. |
| Owner surface | Existing owner-only analytics gains policy, configured budget and metadata-only snapshot | No prompts, answers, tokens, secrets, provider keys or user content are exposed. |

## Durable accounting and migration boundary

The ordered additive migrations `0036_wandering_madame_masque.sql` through `0040_tiresome_dragon_lord.sql` add controller settings, provider-budget metadata, scoped WCU windows, durable aggregate in-flight counters and idempotent reservation records. They contain no destructive DDL, data deletion, schema rewrite, runtime host change or provider configuration. Nullable documented provider limits, reset, eligibility and billing fields default to `null`/`unknown`; no numeric value is invented and an operational WCU limit becomes active only after an explicit owner configuration action.

## Cloudflare Workers AI — lightweight feasibility classification

Cloudflare is present solely as a non-routable registry candidate (`cloudflare-workers-ai`, `feasibility-only`). No Cloudflare account, Worker, secret, token, billing profile, API request or model inference was created.

| Official fact | Feasibility interpretation for Kairema |
|---|---|
| Workers AI Free documents **10,000 Neurons/day**, resetting at **00:00 UTC**; usage beyond that requires Workers Paid [Pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/). | This is an independent candidate quota domain, but Neurons are model/input/output dependent and cannot honestly be converted to chat turns without a chosen model and measured token envelope. |
| Default Text Generation limit is **300 RPM**; some models have different limits [Limits](https://developers.cloudflare.com/workers-ai/platform/limits/). | The default RPM is not a Kairema sustainable-capacity claim and does not establish integration readiness. |
| The catalog lists Cloudflare-hosted text-generation models, including Gemma 4 26B A4B IT [Models](https://developers.cloudflare.com/workers-ai/models/). | A model candidate may be evaluated only in a future separate, account-authorized feasibility task; no model ID is added to Kairema today. |
| The pricing document names selected frontier models that require paid billing [Pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/). | Do not assume a desired model is free merely because Workers AI has a Free allocation; confirm model eligibility and no-spend controls before any future integration. |

**Classification:** a credible independent **feasibility candidate only**, not enabled capacity, zero-cost-ready capacity, active fallback or a hosting recommendation.

## Configuration, degradation and visibility

The existing owner-only analytics surface now exposes only the controller's aggregate state and permitted policy inputs: enablement, global and per-user generation/search WCU limits, per-user generation concurrency, bounded Flash queue limits, and the displayed Context/Apex pressure reserve. The router keeps policy and provider/model budget changes behind the existing verified owner guard; provider/model targets are checked against the existing server allowlist. No client-supplied identity, model routing, quota value, provider key or reservation key is trusted.

An explicit operator degradation mode may reject higher-cost roles before an upstream reservation while retaining Flash as the last protected path. A provider/model may be disabled or capped through the same owner-only configuration; a rejected reservation returns controlled admission feedback and does not create another upstream fetch or consume `MAX_ATTEMPTS`. This is policy, not an assertion of provider entitlement: no current provider's remaining quota, limit reset or paid eligibility has been discovered by this implementation.

## Validation and remaining work

All checks below are deterministic and no-network. The focused suite passed **9 files / 107 tests**, including the new controller cases for server-derived WCU, instance-local per-user concurrency, idempotent reservations, disabled-provider pre-upstream rejection, explicit degradation preserving Flash, one-time settlement and independently keyed fallback reservations, bounded queue expiry, restart-local semantics and separate search admission. Existing provider, stream, search and owner regressions in this focused set also passed. `pnpm check` and `git diff --check` passed.

| Boundary | Confirmed result | Still not claimed / remaining action |
|---|---|---|
| Generation attempts | Every actual existing upstream attempt is reserved immediately before its fetch; fallback gets a fresh reservation; no path adds a fifth attempt. | No provider call, quota query or production traffic measurement was performed. |
| Fairness | Durable scoped WCU/in-flight accounting is used for configured budget enforcement; reusable process-local concurrency reduces a single user's local burst. | Actual replicas, routing and cross-replica in-process counters remain unknown; local values are never global capacity. |
| Provider metadata | Owner may record explicit documented limits and eligibility with nullable unknown defaults, separately at provider and model scope. | No installed value proves a current real quota, free entitlement or economic cost. |
| Search | Only the existing live-search invocation receives an optional separate controller admission hook; its cascade and truthful degraded behavior were preserved. | No search cache was added; account-level search capacity is unknown. |
| Cloudflare | Official facts support an independent future feasibility review only. | No account, Worker, billing profile, token, request, inference, model route or fallback was created. |

The pending follow-up is evidence, not automatic expansion: first obtain account-authorized, documented limits and reset semantics; then set conservative owner policies and observe aggregate rejection/settlement telemetry; only after that decide whether a separately authorized Cloudflare model feasibility experiment is worthwhile. The production build SIGTERM/resource diagnosis and Stytch Magic Link delivery remain separate, untouched blockers.
