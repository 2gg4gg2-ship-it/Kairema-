# Kairema — Final practical multi-user closure

**Дата evidence:** 2026-08-27  
**Baseline:** опубликованная версия `7a25da83` перед текущим evidence-only этапом.  
**Граница:** отчёт не добавляет provider routing, квоты, billing, schema/migrations, Redis/queue, инфраструктуру или production-функциональность. В нём нет prompts, ответов, идентификаторов, email, файлов, токенов или секретов.

## A. LIVE ACCEPTANCE

| Сценарий | Статус | Практический результат и граница evidence |
|---|---|---|
| Вход и текущая authenticated session | **PASS (live)** | После подтверждённого пользователем входа браузер достиг опубликованного приложения, а не sign-in view. |
| Публичные роли | **PASS (live)** | Selector показал ровно четыре роли: Kairema Flash, Think, Context и Apex. Prompt не отправлялся. |
| Честный status surface | **PASS (live)** | UI показал `3/4` доступных сервисов. Это подтверждает наличие truthful status surface, но не причину состояния конкретного provider. |
| Attachments и export surface | **PASS (live)** | Видны отдельные controls фото/файла и Markdown/PDF export. Файл не выбирался, upload/export не выполнялись. |
| Settings и privacy disclosure | **PASS (live)** | Видны account-scoped preferences, privacy diagnostics, search opt-in и disclosure об отсутствии auto-merge identity по равенству email. Никакие settings не менялись. |
| Logout → re-login | **UNVERIFIED PLATFORM BLOCKER** | Logout control не был доступен в наблюдаемом mobile/browser content; поведение не выводится из кода как live PASS. |
| Второй изолированный identity, IDOR и отсутствие cross-user leakage | **UNVERIFIED PLATFORM BLOCKER** | Для safe cross-user проверки не был доступен второй контролируемый identity. Реальные данные и прямые чужие resource URLs не использовались. |
| Create/send/duplicate/concurrent message, memory cross-chat, history pagination, transcript bound, drafts, upload ownership, export history, reconnect | **UNVERIFIED BY TEST BOUNDARY** | Эти операции могли изменить реальные данные либо вызвать generation/provider traffic. Они не повторялись, поскольку code/no-network evidence уже существует, а этой browser-сессии не предоставлен отдельный disposable account. |
| Live WCU admission, SSE saturation, fallback and search exhaustion | **UNVERIFIED BY TEST BOUNDARY** | Нельзя безопасно индуцировать capacity/provider failure на опубликованной сессии. Ни один provider-heavy/load test не запускался. |

**Вывод A.** Доступная live acceptance не обнаружила функциональный FAIL. Она подтверждает authenticated published runtime, four-role UI и privacy/status surfaces. Полный двух-identity live proof остаётся ограничением среды, а не доказательством отсутствия application-level isolation: соответствующие серверные regression tests входят в раздел B.

## B. CAPACITY CONTROLLER FINAL VALIDATION

**PASS (deterministic no-network).** Финальный focused набор завершён с результатом **10 файлов / 114 тестов**. Он не вызывал LLM, provider, search, email, billing, account dashboard, S3 или реальные пользовательские данные. Существующий Controller V1 использовался без нового controller и без policy tuning.

| Контроль | Статус | Подтверждённая граница |
|---|---|---|
| Noisy user и quiet users | **PASS (SIMULATED)** | В bounded scenario noisy actor получил 12 admission и 88 controlled rejection; cohort quiet actors получил 100 admission. Это проверяет fair-share model, не production throughput. |
| Per-user burst и global weighted saturation | **PASS (SIMULATED)** | Per-user WCU guard и nullable/provisional global WCU policy проверялись через current controller seams; WCU не является tokens, cost или provider quota. |
| Provider exhausted/cooldown/failure classes | **PASS (TESTED)** | Capacity admission и Provider Health/cooldown paths дают controlled refusal/fallback, без uncontrolled attempts. |
| Fallback 1→2→3→4 | **PASS (TESTED)** | Каждая реальная попытка требует повторной reservation; жёсткий `MAX_ATTEMPTS=4` сохранён. Definitive failure class не образует бесконечного loop. |
| Search budget | **PASS (TESTED)** | Search admission отделён от generation. Исчерпание даёт truthful freshness-unavailable behavior, не старый ответ, выданный как свежий поиск. |
| Queue, reservation, duplicate, restart/TTL | **PASS (TESTED/SIMULATED)** | Flash-only queue остаётся opt-in, bounded (`max 64`, `max 1500 ms`). Settlement/release, idempotency и stale TTL cleanup проверены через deterministic store. |
| Shared quota domains и role degradation | **PASS (TESTED/SIMULATED)** | Scope keys и provider/model metadata проверяют shared-domain accounting. `normal/elevated/high/critical/exhausted` сохраняют Flash при доступной capacity и могут shed expensive roles. |
| Multi-instance semantics | **DOCUMENTED LIMITATION** | Durable reservations coordinate persisted aggregate state; `12 streams/process` и `2/user/process` являются только local guard и не доказывают distributed scheduler/global fairness across all Autoscale replicas. |

> **Controller verdict:** application-level capacity control is **VERIFIED** only в пределах deterministic no-network semantics. Это не claim о 10K/25K/50K production capacity, quota balance или token/cost budget.

## C. RATE-LIMIT STATUS

| Группа | Статус | Текущая server-side защита |
|---|---|---|
| Message generation / SSE ingress | **PASS (TESTED)** | Durable user-scoped ingress quota: `60` запросов за `60 s`; превышение возвращает controlled `429` и `Retry-After`. |
| Concurrent streaming | **PASS (TESTED)** | Existing local guards: `12` active streams/process и `2` streams/user/process; saturation отвечает controlled pre-provider `503`, counters release in `finally`. Это не глобальная cluster quota. |
| Generation capacity | **PASS (TESTED)** | Controller admission/reservation находится перед real upstream attempt; capacity/concurrency/queue denials не тратят одну из четырёх network attempts. |
| Search | **PASS (TESTED)** | Separate controller search admission и provider-layer cooldown prevent search exhaustion from becoming fabricated freshness. |
| Auth/login/register/resend/reset | **PARTIAL / EXISTING BOUNDARY** | Session/reset/link intent имеют bounded lifetime. Не добавлялся новый global limiter: source evidence этого этапа не показал безопасный общий counter, который можно применить без параллельной системы или произвольных limit values. |
| Upload/export/owner mutations | **PARTIAL / EXISTING AUTHORIZATION** | User scope, owner guard и existing failure handling проверены prior focused evidence. Новый rate limiter не был доказан как necessary; не создано second rate-limit path. |

**Вывод C.** Основания rate limiting для ingress, concurrency и controller admission готовы и controlled. Значения account-specific provider quotas остаются owner-configurable и неизвестными; их не подменяли произвольными числами.

## D. PROVIDER EXPANSION RESULT

**Итог: `NO SAFE CANDIDATE` для отдельного non-production PoC в этой сессии; дополнительная capacity не верифицирована.**

Уже исследованный Cloudflare Workers AI остаётся единственным технически правдоподобным independent-domain candidate: public documentation описывает 10,000 free Neurons/day, reset 00:00 UTC, и default text-generation 300 RPM, однако расход Neurons model/input/output-dependent и не переводится в фиксированное число запросов [1] [2]. Representative text model supports SSE/text generation, но catalog availability не доказывает eligibility конкретного Kairema account [3].

PoC не выполнялся: текущему проекту не предоставлены Cloudflare account/token, создание account/key для обхода quota запрещено, а Workers Paid и часть frontier models имеют billing-gated risk [1]. Кроме того, Workers Free constraints не делают текущий Express/Drizzle/Node backend мигрируемым без новой архитектуры: такой migration исключён из этапа [4]. Existing provider model IDs не признаны независимой capacity, поскольку account-level shared quota domains, remaining balance и reset state неизвестны.

## E. DB/INDEX STATUS

**DEFERRED — no index added.** Предыдущее read-only evidence показывает маленькие current cardinalities и deferred candidates. Current acceptance and bounded simulations не выявили конкретный message/memory/export bottleneck, который оправдывал бы один additive index. Не выполнялись DDL/DML, migration, DROP, schema reset или изменения `chat_exports`.

## F. PRODUCTION BUILD STATUS

| Плоскость | Статус | Доказательство |
|---|---|---|
| Application source/type safety | **PASS (available validation)** | Focused suite passed; `pnpm check` passed; `git diff --check` passed. Это не эквивалент production bundle. |
| Production bundle execution | **PLATFORM/RESOURCE BLOCKER** | Safe reproducible `pnpm run build` reached `vite build → transforming…`, then received `SIGTERM`, exit `143`, after ~6 seconds. До termination не было source error. |
| Resource interpretation | **UNVERIFIED CAUSE** | Snapshot had ~3.9 GiB total memory and ~1.18 GiB available; resident type-check watch process was ~920 MiB, with dev/browser processes also active. No readable cgroup limit or OS OOM evidence was captured, therefore report does not label this an application leak or an OOM kill. |

**Application build status:** source validation passes, but a successful local production bundle has **not** been established.  
**Platform build limitation:** current sandbox/runtime delivered `SIGTERM`; no architecture workaround, dependency removal or retry loop was applied.

## G. MULTI-USER GO/NO-GO

> **Verdict: READY WITH DOCUMENTED PLATFORM LIMITATIONS.**

Kairema is ready to close the **application-level multi-user stage** on the available evidence. The baseline preserves authenticated server-derived identity, user-scoped data boundaries, protected owner procedures, four public roles, maximum four upstream attempts, reservation-based capacity admission, fallback re-admission, graceful degradation, bounded transcript/history policy, attachment/export ownership boundaries, drafts and deterministic fair-use behavior. No test in the final focused set reports a regression.

This verdict does **not** certify a global 10K/25K/50K capacity figure, an account-level provider allowance, all-replica fairness, a successful local production bundle, or a two-real-identity browser proof. Those are documented platform/provider evidence gaps, not a reason to restart the closed security/SQL/provider audits.

## H. EXACT REMAINING BLOCKERS

| Item | Blocks what exactly | Does it block application-level closure? |
|---|---|---|
| Controlled second identity is unavailable in current browser environment | Direct live two-user/IDOR/logout-relogin acceptance | **No.** Code-level authorization/isolation remains covered; this is a live-evidence gap. |
| Sandbox terminates Vite build with `SIGTERM` and lacks observable cgroup limit | Successful local production bundle verification | **No** for application-level close; **yes** for declaring local build PASS. |
| Provider account remaining quota/reset and Autoscale replica facts are not exposed | Claiming sustainable provider/global production capacity or exact controller tuning | **No.** Controller is explicitly safe/configurable when values are unknown. |
| Cloudflare account/key and zero-billing proof are absent | Any Cloudflare PoC or production addition | **No.** Provider expansion is deferred rather than a dependency of current multi-user functionality. |

There is **no evidence-backed application-code blocker** discovered in this final stage.

## I. EXACT TASKS NOW COMPLETE

The final practical stage has completed the available published-session acceptance; final Controller V1 deterministic validation; current ingress/concurrency/search admission evidence; the constrained provider PoC decision; the final DB/index defer decision; and the build distinction between source validation and platform termination. The project did not add an unnecessary index, new rate-limit system, provider, paid fallback, billing relation, infrastructure service, queue, migration or destructive operation.

The acceptance, controller, rate-limit, build and feasibility observations are retained separately in sanitized evidence artifacts. The project tracker records every final-stage item without exposing private user or provider data.

## J. WEB-GROUNDED HANDOFF

The next separate product stage is **WEB-GROUNDED MODEL RESPONSES**. It is intentionally not implemented by this closure. A bounded future implementation should make the following path explicit:

1. Classify user intent as freshness-sensitive or ordinary before attempting external retrieval; a claim of “latest/current” requires dated web sources, not model-memory substitution.
2. Invoke the existing server-derived `CapacityActor` and `beginCapacitySearch` path before outbound search. Keep a **separate search budget**, independent of generation WCU and provider attempt budget.
3. Normalize public query intent and apply bounded public-cache/dedup with TTL, source URL, observed time, published date, layer status and freshness result. Do not cache prompts, private chat content, attachments or user identity in a shared public cache.
4. Pass sources to the model only as a clearly labelled external-context block. Return source cards/dates to the user; distinguish no results, stale results, provider cooldown and controller-budget denial truthfully.
5. Preserve current search cascade and no-amplification rules; controller admission failure must suppress the external call and surface freshness-unavailable rather than silently answering from training data.

**At most five remaining actions:** provide owner-verified quota/reset facts when available; obtain a disposable second test identity for optional live two-user proof; re-run build only in a resource-observable environment; decide separately whether a zero-billing Cloudflare sandbox is permitted; then open the Web-grounded stage using the handoff above.

Cloudflare source URLs used above: [Workers AI pricing][1], [Workers AI limits][2], [representative text model][3] and [Workers limits][4].

[1]: https://developers.cloudflare.com/workers-ai/platform/pricing/ "Cloudflare Workers AI pricing"
[2]: https://developers.cloudflare.com/workers-ai/platform/limits/ "Cloudflare Workers AI limits"
[3]: https://developers.cloudflare.com/workers-ai/models/llama-3.1-8b-instruct-fast/ "Cloudflare Workers AI Llama 3.1 8B Instruct Fast"
[4]: https://developers.cloudflare.com/workers/platform/limits/ "Cloudflare Workers limits"
