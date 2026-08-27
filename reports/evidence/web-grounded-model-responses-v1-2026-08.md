# WEB-GROUNDED MODEL RESPONSES V1 — итоговый отчёт

## Статус

**PASS — V1 реализован и опубликован после checkpoint.** Реализация расширяет единственный существующий путь поиска и контекста, не меняя четыре публичные роли, provider chains, `MAX_ATTEMPTS=4`, auth, memory, exports, attachments или schema.

## Контракт и orchestration

Server-side intent использует `NONE`, `PREFERRED` и `REQUIRED`. Для актуальных запросов применяются server-derived search admission и текущий каскад You → Serper → Exa → Tavily. Каждая реально допускаемая cascade-попытка получает/завершает отдельный Controller V1 search lease. Denial, empty, degraded и unavailable состояния не превращаются в неподтверждённый «свежий» факт.

## Provenance и citations

Только нормализованные фактические источники с URL, доменом и допустимой датой попадают в marked `WEB SOURCES` model context. Источники объявлены недоверенными данными; конфликтующие факты должны быть явно обозначены. В public response попадает только sanitised `webGrounding` и фактические citation links; private query, hidden context, controller/provider internals и сырые errors исключены. Совместимость обеспечена для streaming, persisted replay и non-stream metadata.

## Cache, privacy и limits

Public cache включается лишь для признанного неперсональным контекста: SHA-256 server-only key, TTL 90 seconds, максимум 32 entries, cloned outcomes и concurrent dedup. Personal/account/email/attachment/memory signals принудительно обходят cache. Failed/transient outcomes не кешируются. Cache остаётся process-local и не является global guarantee.

## Observability

Existing owner-only snapshot включает aggregate process-local V1 counters: requests, cache hits, dedup joins, real network-layer attempts и found/empty/degraded/unavailable outcomes. Данные query, URL, user, source body и provider response не хранятся и не выдаются. Полная multi-instance telemetry остаётся **UNVERIFIED** без новой инфраструктуры.

## Проверки

Deterministic mocked/no-network V1 coverage проверяет intent, dated-source gating, cache/dedup/privacy, per-layer lease settlement, hostile source isolation, conflict instructions, four-role metadata propagation, SSE/non-stream replay и citation UI. Focused acceptance достигала 11 files/140 tests; последующие узкие compatibility/telemetry regressions также PASS. `pnpm check` и `git diff --check` выполняются в final validation.

## Published smoke

Один нейтральный Flash `SEARCH_REQUIRED` запрос в published runtime завершился streaming и правдиво сообщил отсутствие проверяемых свежих источников без fabricated citation/current fact. Live actual-citation success, all-role recovery и load testing остаются **UNVERIFIED**: дополнительные provider-heavy requests не выполнялись.

## Ограничения и handoff

Не заявляются production provider quota, global capacity или all-replica cache/fairness. Production build SIGTERM/143 остаётся отдельным platform/resource blocker. Следующий этап при доступности среды: безопасно подтвердить live source-success для controlled public query, затем измерить aggregate metrics в clean observable runtime; не менять routing или создавать новую search system.
