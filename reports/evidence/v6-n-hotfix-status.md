# Kairema v6-N — статус hotfix и фактическая приёмка

**Дата обновления:** 2026-08-23 UTC  
**Граница отчёта:** только metadata-only диагностика. В отчёте нет API-ключей, OAuth claims, URL вложений, пользовательских текстов, изображений, сырых ответов провайдеров или цепей ролей.

> **Итог на дату отчёта: v6-N НЕ ЗАКРЫТА.** Server-side vision transport и правило fresh/historical покрыты тестами; полный published browser сценарий вложения и image-aware ответа не подтверждён в текущей рабочей OAuth-сессии.

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
| Published composer thumbnail и sent-bubble thumbnail | NOT VERIFIED for latest revision | До transport/timeout hotfix previews ранее были browser PASS; после последнего checkpoint OAuth cookie не появилась в рабочем browser окне, поэтому новый полный сценарий не утверждается. |
| Published neutral-image answer | NOT VERIFIED | До hotfix наблюдался отказ. После hotfix browser acceptance не удалось продолжить без пользовательской OAuth-сессии в рабочем окне. Server probe не заменяет browser PASS. |

### Устранённая причина

Первоначально в provider request передавался remote signed temporary URL. После browser failure transport заменён на **request-only inline image data URL**, получаемый server-side из защищённого вложения после проверки владельца. Отдельно image-aware Flash path был ограничен text-oriented TTFT deadline до первого реального vision response; этот конфликт устранён, при этом общий timeout и лимит попыток сохранены.

## 3. Живой поиск — диагностика `latest GPT model release 2026`

Все значения ниже получены 2026-08-23. Проверки выводили только layer, HTTP class, latency, result count, reason и min/max publication dates; URL, titles и snippets не сохранялись.

| Слой | Статус | HTTP | Latency | Источники | Диапазон дат | Причина / действие |
|---|---:|---:|---:|---:|---|---|
| You | PASS | 200 | 3,570 ms | 10 | Дата не предоставлена provider payload | Доступен; это первый слой active cascade. Реальный server cascade также вернул `found`, 5 sources. |
| Serper | PASS | 200 | 4,079 ms | 5 | 2026-06-19 — 2026-06-19 | Доступен; source-date normalization сохраняет безопасную date metadata. |
| Exa | PASS | 200 | 2,521 ms | 5 | 2026-08-18 — 2026-08-18 | Доступен; подтверждает источники 2026 года. |
| Tavily | PASS (direct diagnostic) | 200 | 2,601 ms | 5 | Дата не предоставлена provider payload | Endpoint/ключ отвечают. Tavily не является active user-facing cascade layer в текущем privacy-preserving architecture; chain не расширялась. |
| Google grounding | FAIL / unavailable | 404 | 161 ms | 0 | — | Direct diagnostic endpoint/model rejected. Active user-facing cascade не зависит от него; 404 не объявлен quota reset и не маскируется как healthy. |
| OpenRouter `:online` catalog | FAIL / empty | 200 | 3,027 ms | 0 | — | Каталог доступен, но подходящих `:online` IDs не обнаружено; новый online candidate не добавлялся. |
| RAG | NOT VERIFIED | — | — | — | — | В текущем browser session нет авторизованного user chat с RAG-only ответом; stale-RAG condition покрыт deterministic test и server-side signal, но live UI edge case не утверждается. |

### Реальная active cascade

Server probe `searchWeb()` для проверочного 2026-запроса завершился `found`/`verified` через `you`, с пятью подтверждёнными sources. Per-answer telemetry теперь включает только `respondedLayer`, `sourceCount`, `sourceDateMin` и `sourceDateMax`. При RAG-only ответе с maximum source date старше 90 дней server передаёт safe stale signal, а UI показывает честный badge без URL и raw source content.

## 4. Historical facts versus freshness-bound claims

| Acceptance | Статус | Проверка |
|---|---|---|
| T1: established historical fact отвечает из знаний, когда live search молчит | PASS (deterministic) | Provider system guidance и regression запрещают подменять устойчивый факт общим отказом поиска. |
| T2: «latest 2026» использует только live evidence или честно сообщает о деградации | PASS (deterministic + live search) | Prompt rule и regression запрещают называть старую версию «последней» без live evidence; active cascade фактически `found`. |
| T3: mixed historical + latest 2026 request сохраняет это различие | PASS (deterministic) | Regression проверяет разделение stable identity/explanation и fresh claim, без подстановки старого RAG как current evidence. |
| Browser screenshots T1–T3 | NOT VERIFIED | В текущем рабочем browser окне отсутствует OAuth-session cookie; server tests не заменяют пользовательские screenshots. |

## 5. Тесты и расхождение отчёта с фактом

| Проверка | Результат |
|---|---|
| Targeted v6-N provider / attachment / chat-context / search regressions | PASS до опубликованных checkpoints v6-N |
| Full `pnpm test` | Code regressions PASS; внешние provider timeout/403 фиксируются как real degradation, не как synthetic PASS. |
| `pnpm check` | PASS до опубликованных checkpoints v6-N |
| Production server-stream vision probe | PASS после final Flash image-path hotfix |
| Published vision browser acceptance | NOT VERIFIED после final hotfix из-за отсутствия OAuth cookie в рабочем browser окне |

> **Расхождение отчёта и факта:** нельзя считать server-stream vision PASS равным published user-flow PASS. Также наличие живых You/Serper/Exa не позволяет назвать Google grounding или OpenRouter online healthy. Поэтому итог остаётся **«v6-N НЕ ЗАКРЫТА — требуется browser acceptance вложений/vision и screenshots, а RAG-only stale UI scenario остаётся NOT VERIFIED»**.
