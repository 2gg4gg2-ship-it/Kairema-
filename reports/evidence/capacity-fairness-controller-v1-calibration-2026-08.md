# CURRENT POLICY

**IMPLEMENTED / SOURCE-VERIFIED.** Калибровка относится только к уже опубликованному AI Capacity & Fairness Controller V1. Она не меняет маршрутизацию, схему, owner inputs, модельный список, Search/RAG, авторизацию или провайдеров. Контроллер принимает доверенный серверный `userId` и `requestKey`; клиент не передаёт идентичность квоты, ключ reservation, лимит или secret.

| Область | Текущая безопасная политика в коде | Статус калибровки |
|---|---|---|
| Публичные роли | Ровно Flash (`fast`), Think (`smart`), Context (`context`), Apex (`flagship`) | **IMPLEMENTED** |
| Реальные LLM attempts | Не более `MAX_ATTEMPTS=4`; reservation берётся непосредственно перед каждым реальным upstream attempt | **IMPLEMENTED / TESTED** |
| Стартовая controller policy | `enabled=true`; глобальные WCU/concurrency лимиты равны `null`; per-user generation/search WCU `12/6`; concurrency `2/1`; reserve Apex `20%` | **SOURCE-VERIFIED SAFE DEFAULT**, не provider quota |
| Очередь | Выключена по умолчанию (`0/0`); при явной настройке — только Flash, максимум `1 500 ms` и `64` ожидания | **IMPLEMENTED / TESTED** |
| Reservation lifecycle | Идемпотентный ключ attempt, один `settle/release`, TTL по умолчанию `180 s`, ограничение `30–900 s` | **IMPLEMENTED / TESTED** |
| Search | Отдельный admission path; отказ поиска не считается доказательством свежих данных и не меняет generation admission | **IMPLEMENTED / TESTED** |
| Owner control | Snapshot, policy и provider/model metadata доступны только существующему `requireOwner`; schema строго ограничивает значения | **IMPLEMENTED / TESTED** |

Ни один owner-параметр в ходе calibration **не менялся**. В частности, не были установлены глобальные WCU, RPM, TPM, daily limits, reset windows либо платные eligibility flags.

# QUOTA VALUES VERIFIED

**VERIFIED, но не как account capacity.** Проверены контракты хранения и безопасная обработка неизвестности: provider/model metadata поддерживает отдельные поля для WCU, concurrency, RPM, TPM, daily units/requests/tokens, reset, billing и quota state. Значение `quotaState` по умолчанию — `unknown`; оператор может указать только `operator_configured` через owner-only validation. Это подтверждает, что контроллер способен применить верифицированные сведения после ручного ввода, но не подтверждает ни одного фактического лимита аккаунта Kairema.

| Значение | Что действительно подтверждено | Что не следует из факта |
|---|---|---|
| WCU role weights `1/2/3/4` | Это локальные provisional controller units для Flash/Think/Context/Apex | Это не token, cost, RPM, TPM или provider quota |
| Modifier weights `thinking=1`, `vision=2`, `detailed=1`, `highEffort=1`, `webResearch=1` | Серверный расчёт reservation WCU детерминирован | Это не измерение нагрузки модели или тарифа |
| TTL `180 s` | Консервативный crash-path cleanup horizon и bounded owner input | Это не provider reset и не SLA |
| Public controller bounds | Global concurrency допускает только `1–128`, search concurrency `1–64`, per-user limits `1–12` и `1–6` | Это не подтверждение доступной global capacity |

# QUOTA VALUES UNKNOWN

**UNKNOWN / NOT AVAILABLE.** В calibration не производились inference, search, quota, billing или dashboard calls. Поэтому реальные remaining quota, план, billing eligibility, reset timestamp, concurrency, shared-domain scope и фактическое число реплик неизвестны. Неизвестное не приравнено к нулю и не заполнено synthetic числом.

| Domain / service family | Фактические Kairema account values: RPM/TPM/RPD/TPD/units/reset | Shared quota domain | Итог |
|---|---|---|---|
| OpenRouter models | **UNKNOWN** | **UNKNOWN** | Не вводить значения автоматически |
| OrcaRouter models | **UNKNOWN** | **UNKNOWN** | Не вводить значения автоматически |
| Google models | **UNKNOWN** | **UNKNOWN** | Не вводить значения автоматически |
| Groq models | **UNKNOWN** | **UNKNOWN** | Не вводить значения автоматически |
| You, Serper, Exa, Tavily search cascade | **UNKNOWN** | **UNKNOWN** | Не считать search budget generation budget |
| Cloudflare Workers AI | **NOT INTEGRATED**; account/token/billing/model choice отсутствуют | **UNKNOWN** | Не является fallback или capacity evidence |

Предыдущие evidence-only audits также не получили account-specific quotas. Публичные документированные лимиты стороннего сервиса, если они существуют, не заменяют лимит именно аккаунта Kairema и не используются в этой calibration.

# WCU STATUS

**IMPLEMENTED / PROVISIONAL.** WCU — намеренно внутренний admission unit, а не экономическая или provider-измерительная единица. Стартовые роли имеют веса Flash `1`, Think `2`, Context `3`, Apex `4`; модификаторы могут увеличить reservation. `globalGenerationWcuLimit=null` и `globalSearchWcuLimit=null` означают, что controller не имеет доказанного глобального quota ceiling, а не бесконечную capacity.

| Правило | Калибровочная интерпретация |
|---|---|
| Per-user WCU `12/6` | **SAFE DEFAULT** для ограничения одного actor, не подтверждённый entitlement пользователя |
| Global WCU `null` | **UNKNOWN / UNCONFIGURED**; не заменять synthetic числом |
| Provider/model WCU | **UNKNOWN**, пока owner не внесёт доказанный scope и bound |
| WCU window | Rolling controller window; не является provider reset period |
| `globalGenerationInflightWcuLimit` | **UNKNOWN / UNCONFIGURED** до evidence-backed owner configuration |

# NOISY-USER FAIRNESS RESULT

**SIMULATED / DETERMINISTIC.** В чистой synthetic модели предложены 200 Flash-class logical requests: 100 от одного noisy actor и по одному от 100 quiet actors. Для иллюстрации работы существующей per-user protection использованы только simulation constants: global window `120 WCU`, per-user `12 WCU`. Эти числа **не перенесены в runtime policy** и не являются quota.

| Сценарий | Noisy actor | Quiet cohort | Использовано WCU | Результат |
|---|---:|---:|---:|---|
| С existing per-user guard | 12 admitted, 88 user-denied | 100 admitted, 0 denied | 112 | **SIMULATED: quiet cohort protected** |
| Counterfactual без per-user guard | 100 admitted | 20 admitted, 80 global-denied | 120 | **SIMULATED: noisy actor монополизирует window** |

Direct controller tests дополнительно подтверждают sequential quiet cohort из 100 пользователей и local per-user concurrency. Это не доказывает fair scheduling между autoscale replicas; это ограничение отдельно зафиксировано ниже.

# PROVIDER EXHAUSTION RESULT

**TESTED / SIMULATED / UNKNOWN.** Existing provider failure classifier в focused no-network test детерминированно классифицировал `401` как `AUTH`, quota-shaped `429` как `QUOTA`, иной `429` как `RATE_LIMIT`, а `503` как `PROVIDER_UNAVAILABLE`. Controller test подтвердил, что явно disabled provider отклоняется до reservation и до upstream attempt.

| Ситуация | Реакция controller/router | Статус |
|---|---|---|
| Owner-configured provider disabled | Controlled rejection, reservation не создаётся | **TESTED** |
| Auth/quota/rate-limit/unavailable class | Existing Provider Health/cooldown/fallback logic использует классификацию | **TESTED без сети** |
| Два model IDs делят synthetic provider scope `6 WCU` | Первый synthetic request `4 WCU` принят; второй `4 WCU` отклонён provider scope | **SIMULATED** |
| Реальная provider exhaustion, remaining quota и reset | Не измерялись | **UNKNOWN** |

Synthetic shared-domain result показывает требуемый безопасный принцип: разные model IDs не должны рассматриваться как независимая capacity, пока независимость их quota domains не доказана.

# FALLBACK RESULT

**IMPLEMENTED / TESTED / SIMULATED.** Fallback не получает бесплатный обход admission: для каждой фактической candidate attempt требуется новая reservation на provider/model scopes, тогда как per-user WCU окно списывается один раз за логический запрос независимо от числа attempts. Focused controller test подтвердил, что policy-disabled candidate не создаёт reservation, а допустимый fallback проходит повторную admission. Отдельный synthetic lifecycle trace подтвердил, что attempt 1 после failure release имеет отдельный ключ от attempt 2, повторный release не изменяет состояние, итоговый inflight WCU равен нулю, а histogram не превышает четыре attempt.

| Проверка | Результат |
|---|---|
| Replay того же provider attempt key | Одна durable reservation; повтор — deduplicated | **TESTED** |
| Failure → release → fallback | Distinct attempt key и повторная admission | **TESTED / SIMULATED trace** |
| Attempt amplification | Synthetic histogram: attempts `1=1`, `2=1`, `3=0`, `4=0`, `>4=0` | **SIMULATED**, hard cap в runtime **IMPLEMENTED** |
| Stale reservation | TTL trace: cleanup после `181 s` при default `180 s` | **SIMULATED**; controller TTL path ранее covered no-network |

# SEARCH BUDGET RESULT

**IMPLEMENTED / TESTED / SIMULATED.** Search capacity отделена от generation: отдельная policy содержит search WCU/concurrency и separate admission. При search denial current context сохраняет честный `freshness-unavailable/degraded` смысл; generation admission не подтверждает свежесть и не запускает старое знание как имитацию поиска.

| Synthetic scenario | Результат |
|---|---|
| Search scope `1 WCU`: первый request | admitted |
| Второй search request того же synthetic window | denied in search scope |
| Generation после search exhaustion | Никак не использует exhaustion как generation limit; freshness остаётся честно degraded |
| Реальные search quotas, availability и cache hit rate | **UNKNOWN**, внешние вызовы запрещены |

Existing `chat-context` tests дополнительно покрывают degraded/empty search outcomes и truthful freshness warning без real search request.

# DEGRADATION RESULT

**IMPLEMENTED / TESTED / SIMULATED.** Degradation mode меняется только явным owner-only input; автоматической эскалации на несуществующих global signals нет. Synthetic matrix повторяет существующую V1 priority semantics.

| Mode | Flash | Think | Context | Apex | Статус |
|---|---|---|---|---|---|
| `normal` / `elevated` | allowed | allowed | allowed | allowed | **SIMULATED matrix** |
| `high` | allowed | allowed | allowed | shed | **TESTED для Apex; SIMULATED matrix** |
| `critical` | preserved when capacity exists | shed | shed | shed | **SIMULATED matrix** |
| `exhausted` | denied | denied | denied | denied | **SIMULATED matrix** |

Это priority/degradation policy, а не обещание SLA: при исчерпанной реальной capacity Flash также корректно получает controlled denial.

# MULTI-INSTANCE LIMITATION

**IMPLEMENTED LIMITATION.** SSE boundary `12 active streams/process` и `2/user/process` — локальная process guard, не глобальная capacity и не distributed fairness guarantee. Synthetic two-process trace показывает, что один actor теоретически способен удержать до четырёх local slots при двух независимых процессах. Durable reservation/inflight counters координируют configured aggregate scopes, но не создают external queue, sticky routing, consensus scheduler или доказательство fairness между всеми replicas.

| Граница | Что подтверждено | Чего она не подтверждает |
|---|---|---|
| `12/process`, `2/user/process` | Controlled local admission/release | Global concurrent users, cluster-wide fairness |
| Durable WCU/inflight/reservation records | Aggregate accounting при configured limits и TTL lifecycle | Global queue или replica topology |
| Autoscale deployment | Несколько instance допускаются как operational possibility | Их число, routing, stickiness и production saturation — **UNKNOWN** |

# SIMULATION RESULTS

**SIMULATED ONLY.** Runner `benchmark:capacity-calibration` записал deterministic JSON artifact без network attempt, database, user content, provider, search или billing access. Для 10K/25K/50K registered actors вычислены только illustrative DAU и 5% burst projection; admission outcome намеренно не вычислялся, потому что real global/provider quota неизвестна.

| Registered actors | DAU ratio | Synthetic DAU | 5% synthetic burst actors | Capacity conclusion |
|---:|---:|---:|---:|---|
| 10,000 | 1% / 5% / 10% | 100 / 500 / 1,000 | 5 / 25 / 50 | **SIMULATED workload only** |
| 25,000 | 1% / 5% / 10% | 250 / 1,250 / 2,500 | 13 / 63 / 125 | **SIMULATED workload only** |
| 50,000 | 1% / 5% / 10% | 500 / 2,500 / 5,000 | 25 / 125 / 250 | **SIMULATED workload only** |

> Ни один ряд не является заявлением, что Kairema готова к 10K, 25K или 50K production users. У runner: `deterministic=true`, `network.allowed=false`, `network.attempted=0`.

# SAFE OWNER POLICY

**SAFE DEFAULT, NO AUTO-CHANGE.** До появления account-specific evidence безопасная policy — оставить неизвестные глобальные и provider/model quota fields `null`/`unknown`, queue выключенной, degradation `normal`, текущие per-user protective defaults и `180 s` TTL без изменения. Не следует переносить synthetic constants `120`, `6` или `1 WCU` в owner UI: это учебные значения для проверки логики, а не рекомендуемые production limits.

| Owner field group | Безопасное действие сейчас | Допустимое изменение только после evidence |
|---|---|---|
| Global WCU/concurrency | Оставить `null` | Установить после измеряемого account-level ceiling и reset semantics |
| Provider/model budget metadata | Оставить quota/billing/reset `unknown`/`null` | Внести documented scope, quota, concurrency и reset с источником/датой |
| Per-user guard | Оставить V1 defaults | Calibrate against observed non-private admission aggregates, не против token estimate |
| Degradation | Оставить `normal`; менять вручную только во время подтверждённого incident | Установить high/critical/exhausted с recorded operational reason |
| Queue | Оставить off | Включать только Flash и только в bounded limits; это не межinstance очередь |

# OWNER INPUT REQUIRED

**REQUIRED BEFORE ANY CAPACITY CLAIM OR POLICY INCREASE.** Владелец должен предоставить проверяемые account-level данные без передачи API key: план/billing eligibility, current quota и остаток, RPM/TPM/daily limits, reset timezone/timestamp, provider/model eligibility, provider shared quota domains, concurrency, а также соответствие этого evidence дате и production environment. Для search нужны отдельные квоты и reset каждого используемого service family.

Отдельно нужны operational aggregates за выбранное окно: metadata-only admissions/rejections by reason, WCU window pressure, fallback-attempt histogram, stale reservation cleanup count, controller queue timeout/full count, provider cooldown class и instance topology. Prompts, responses, tokens, user IDs, emails, secrets и raw payloads не требуются и не должны добавляться в такую телеметрию.

# REMAINING BLOCKERS

**UNKNOWN / EXTERNAL BLOCKER.** Реальные account quotas и shared domains отсутствуют; поэтому нельзя определить устойчивую AI capacity или readiness для 10K/25K/50K. Также сохраняются ранее отделённые blockers: production build SIGTERM/resource diagnosis не запускался в этом этапе, а Stytch Magic Link EmailDelivery остаётся external HTTP 400 blocker с неизвестной coarse category. Ни один blocker не обходился изменением рабочего controller/auth/provider кода.

Не вводились Redis, external queue, Postgres, VPS, paid monitoring, Cloudflare integration, billing activation или новый provider. Не выполнялись migration/DDL/DML для calibration, provider/search/LLM requests, quota probes, account/billing actions или production build.

# NEXT STEP

**EVIDENCE-GATED.** Сначала собрать указанные owner account-level quota/domain/reset сведения и агрегированную runtime telemetry в контролируемом окне. Затем вручную согласовать policy values, применить их через существующий owner-only интерфейс и провести отдельную bounded no-content verification. До этого следующее безопасное состояние — оставлять global/provider quotas unknown, применяемые fallback chains неизменными и трактовать результаты этого отчёта только как **TESTED controller semantics** и **SIMULATED calibration**, а не как production capacity certification.
