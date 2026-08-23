# Kairema v6-N — статус hotfix и фактическая приёмка

**Дата обновления:** 2026-08-23 UTC  
**Граница отчёта:** только metadata-only диагностика. В отчёте нет API-ключей, OAuth claims, URL вложений, пользовательских текстов, изображений, сырых ответов провайдеров или цепей ролей.

> **Итог на дату отчёта: v6-N НЕ ЗАКРЫТА.** Server-side vision transport и правило fresh/historical покрыты тестами; published browser сценарий neutral-image вложения и image-aware ответа, а также flows T1–T3, подтверждены. При этом live source-date display и RAG-only stale badge ещё не подтверждены, поэтому итоговая приёмка не закрыта.

## 1. Инварианты

| Инвариант | Статус | Проверка |
|---|---|---|
| Ровно четыре публичные роли | PASS | Конфигурация ролей сохранена; новых public cards не добавлено. |
| Не более четырёх реальных upstream LLM-попыток | PASS | Существующий `MAX_ATTEMPTS = 4` сохранён; v6-N не добавляет попытки. |
| Секреты и attachment URLs server-only | PASS | Vision использует transient in-memory data URL только после ownership-проверки; bytes и URL не сохраняются в БД/telemetry. |
| Память per-user, schedules и ZenMux health-only | PASS | v6-N не изменяет memory schema, существующий Heartbeat или ZenMux activation policy. |
| `chat_exports` | NOT TOUCHED | Нет миграции, DROP или изменения export gate. |

## 2. Вложения и vision

| Требование | Статус | Фактический результат |
|---|---|---|
| Protected upload/preview/delete/session scope | PASS (regression) | Существующие server/client regressions подтверждают scoped temporary attachment lifecycle; UI transport не менялся v6-N. |
| Server handoff user-owned image | PASS | Только изображение текущего пользователя/чата проходит ownership/type/size check и становится request-only inline data URL для vision-capable candidate. |
| Vision serialization и candidate filtering | PASS | Targeted regression подтверждает image content part, vision-capable selection и прежний budget. |
| Flash image-path timeout | PASS | Text-only TTFT 1,5 с сохранён; image-aware Flash не преждевременно обрывает единственный vision path и использует общий bounded attempt timeout. |
| Реальный server-stream vision probe | PASS | 2026-08-23: ответ присутствует, streaming delta получена, fallback path допустим; provider/model/payload не фиксируются в evidence. |
| Published composer thumbnail и sent-bubble thumbnail | PASS | 2026-08-23 authenticated published acceptance: контролируемый neutral PNG появился в composer и сохранился в отправленном user bubble. Evidence намеренно не содержит image/file URL, attachment URL или содержимого. |
| Published neutral-image answer | PASS | 2026-08-23 authenticated published acceptance: обычный Flash role path вернул image-aware ответ для того же neutral PNG. Это browser-user-flow факт, а не замена server probe; provider payload и текст ответа не сохраняются в evidence. |
| Legacy source-object redaction | NOT VERIFIED (2026-08-23) | Сразу после checkpoint `cef3d3a2` уже загруженный pre-refresh browser document визуализировал old source control. Cache-busted fresh document больше не имел OAuth session, поэтому факт нельзя приписывать текущему deployed bundle. В этот отчёт не переносятся URL, titles, domains, snippets или content. Новый safe SSE/persisted DTO покрыт regression; для итогового статуса нужен fresh authenticated published recheck legacy record. |
| Published asset / checkpoint parity | PASS (2026-08-23) | Повторная fresh asset inspection после propagation подтвердила наличие ожидаемых safe UI labels для count/date, stale и verified states в текущем published bundle. Проверка не читала чаты, источники или user data. Следовательно, прежнее pre-refresh наблюдение не относится к current bundle; dynamic authenticated UI и legacy record recheck остаются отдельно NOT VERIFIED. |

### Устранённая причина

Первоначально в provider request передавался remote signed temporary URL. После browser failure transport заменён на **request-only inline image data URL**, получаемый server-side из защищённого вложения после проверки владельца. Отдельно image-aware Flash path был ограничен text-oriented TTFT deadline до первого реального vision response; этот конфликт устранён, при этом общий timeout и лимит попыток сохранены.

## 3. Живой поиск — диагностика `latest GPT model release 2026`

Все значения ниже получены 2026-08-23. Проверки выводили только layer, HTTP class, latency, result count, reason и min/max publication dates; URL, titles и snippets не сохранялись.

| Слой | Статус | HTTP | Latency | Источники | Диапазон дат | Причина / действие |
|---|---:|---:|---:|---:|---|---|
| You | PASS | 200 | 3,515 ms | 10 | Дата не предоставлена provider payload | Доступен; это первый слой active cascade. Реальный server cascade также вернул `found`, 5 sources. |
| Serper | PASS | 200 | 5,635 ms | 5 | 2026-06-19 — 2026-08-02 | Доступен; source-date normalization сохраняет безопасную date metadata. |
| Exa | PASS | 200 | 2,451 ms | 5 | 2026-08-18 — 2026-08-18 | Доступен; подтверждает источники 2026 года. |
| Tavily | PASS (direct diagnostic) | 200 | 2,911 ms | 5 | Дата не предоставлена provider payload | Endpoint/ключ отвечают. Tavily не является active user-facing cascade layer в текущем privacy-preserving architecture; chain не расширялась. |
| Google grounding | FAIL / unavailable | 404 | 177 ms | 0 | — | Google Search grounding invocation возвращает 404 даже с model ID, подтверждённым live catalog. Это не quota reset и не healthy status. Active user-facing cascade от Google не зависит; отдельный grounded слой не включался. |
| OpenRouter `:online` catalog | FAIL / empty | 200 | 2,291 ms | 0 | — | Каталог доступен, но подходящих `:online` IDs не обнаружено; новый online candidate не добавлялся. |
| RAG | PARTIAL | — | — | — | — | 2026-08-23 published RAG audit показал metadata-only readiness/last-check status без URL и raw source content. Текущие records не были stale; искусственный stale scenario не создавался. Поэтому live RAG-only stale badge остаётся NOT VERIFIED, хотя condition покрыт deterministic test и server-side signal. |

### Реальная active cascade

Server probe `searchWeb()` для проверочного 2026-запроса завершился `found`/`verified` через `you`, с пятью подтверждёнными sources. Per-answer telemetry теперь включает только `respondedLayer`, `sourceCount`, `sourceDateMin` и `sourceDateMax`. При RAG-only ответе с maximum source date старше 90 дней server передаёт safe stale signal, а UI показывает честный badge без URL и raw source content.

## 4. Historical facts versus freshness-bound claims

| Acceptance | Статус | Проверка |
|---|---|---|
| T1: established historical fact отвечает из знаний, когда live search молчит | PASS (deterministic + published browser) | Provider system guidance и regression запрещают подменять устойчивый факт общим отказом поиска. 2026-08-23 authenticated published neutral-fact flow дал корректный краткий ответ без обязательного live-search claim; prompt/answer не сохраняются в evidence. |
| T2: «latest 2026» использует только live evidence или честно сообщает о деградации | PASS (deterministic + live search + published browser) | Prompt rule и regression запрещают называть старую версию «последней» без live evidence; active cascade фактически `found`. 2026-08-23 authenticated published freshness-bound flow показал safe source-count indicator и не выдал неподтверждённую новизну за факт. Prompt, response, URL и source content не сохраняются в evidence. |
| T3: mixed historical + latest 2026 request сохраняет это различие | PASS (deterministic + published browser) | Regression проверяет разделение stable identity/explanation и fresh claim, без подстановки старого RAG как current evidence. 2026-08-23 authenticated published neutral mixed flow отобразил отдельные stable и freshness-bound sections; current часть была честно ограничена при отсутствии подтверждённого fresh source. Prompt, response и source details не сохраняются в evidence. |
| Browser screenshots T1–T3 | PASS (flows) / NOT VERIFIED (source-date UI) | T1–T3 подтверждены authenticated published browser flows. T2–T3 показали safe source-count indicator и честную обработку unconfirmed freshness-bound части. Отдельный source-date display в UI не наблюдался; этот узкий UI-критерий остаётся NOT VERIFIED. |

## 5. Тесты и расхождение отчёта с фактом

| Проверка | Результат |
|---|---|
| Targeted v6-N provider / attachment / chat-context / search regressions | PASS до опубликованных checkpoints v6-N |
| Full `pnpm test` | Code regressions PASS; внешние provider timeout/403 фиксируются как real degradation, не как synthetic PASS. |
| `pnpm check` | PASS до опубликованных checkpoints v6-N |
| Production server-stream vision probe | PASS после final Flash image-path hotfix |
| Published vision browser acceptance | PASS: 2026-08-23 authenticated controlled neutral-image flow показал composer preview, sent-bubble preview и image-aware answer. |

> **Расхождение отчёта и факта:** ранняя запись `NOT VERIFIED/FAIL` для live vision отражала отсутствие рабочей OAuth-сессии либо ситуацию до hotfix. Она заменена более сильным поздним фактом: **published controlled neutral-image user flow PASS**. Позднее T1–T3 получили published browser PASS; в T2–T3 UI также честно отразил наличие проверенных источников в metadata-only форме, но без наблюдаемой даты источника. Это не делает live source-date display или RAG-only stale badge проверенными. Также наличие живых You/Serper/Exa не позволяет назвать Google grounding или OpenRouter online healthy. Поэтому итог остаётся **«v6-N НЕ ЗАКРЫТА — vision и T1–T3 PASS; source-date display и RAG-only stale UI остаются NOT VERIFIED»**.
