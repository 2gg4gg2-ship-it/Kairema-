# KAIREMA SCALE & STABILITY HARDENING — пакет 1

**Дата:** 2026-08-26  
**Статус:** **CODE-LEVEL PASS; 10K–50K capacity NOT VERIFIED**  
**Граница работ:** только подтверждённые read-only audit low-risk изменения; без Redis, PostgreSQL, VPS, AWS, платных сервисов и без production build. Runtime hardening code не добавляет provider requests; исключение test-side внешней попытки явно зафиксировано ниже.

## Итог

Первый пакет уменьшает подтверждённые риски роста в критическом chat ingress и memory hot path, не изменяя пользовательский contract, роли или provider routing. Все новые coordination данные — минимальные server-side metadata: per-user счётчик окна chat ingress. Сообщения, session ID, client message ID, IP-адреса, prompt/response и provider payload в новой quota таблице не сохраняются.

> Это не load test и не capacity certification. Новые ограничения защищают instance и user fair-share, но не доказывают готовность к 10K–50K synthetic users.

## Устранённые bottleneck'и

| Область | Статус | Что изменено | Почему это low-risk |
|---|---|---|---|
| Replay lookup | **PASS** | `getStoredAssistantForClientMessage()` выполняет owner check, точечный поиск user message по `clientMessageId` и читает только непосредственно следующее assistant message. | Сохраняет прежнюю семантику replay: более поздний произвольный ответ не принимается; устраняет full session read на duplicate path. |
| Memory extraction claim | **PASS** | `claimMemoryExtractionJob()` выбирает одну due/stale job в SQL и применяет compare-and-swap по observed `status` и `attempts`. | Retry timing, limit и user scope не изменены; проигравший конкурент не получает job. |
| Extraction turn read | **PASS** | Для extraction читается owner-scoped session и только пара `userMessageId`/`assistantMessageId`. | Нет изменения extraction content или v6-MEM policy; устраняется полный read истории ради двух строк. |
| Memory context transfer | **PASS** | `listMemoryEntries()` имеет opt-in SQL limit; chat context получает 30 facts и 15 topics, совпадающих с прежним prompt slicing. | Unlimited storage и полные user-facing Memory lists сохранены; уменьшается только DB-to-server transfer для уже ограниченного model context. |
| Chat ingress quota | **PASS** | Добавлена отдельная `chat_stream_rate_windows`: атомарный per-user fixed-minute upsert, перед history/context/provider work. Dev API quota не переиспользуется. | Миграция `0035_tense_vertigo.sql` только создаёт таблицу и FK; содержимое чатов и существующие таблицы не меняются. Persisted replay до quota не расходует новую квоту. |
| SSE resource admission | **PASS (local)** | Добавлены лимиты максимум 12 active streams на instance и 2 на user на instance; reservation освобождается в `finally`, включая success/error/cancel path. | Возвращает generic 503 до history/context/provider work; не меняет четыре роли, fallback или лимит LLM attempts. Это local pressure guard, не distributed coordination. |
| Graceful degradation | **PASS** | Недоступность durable quota возвращает generic 503 до history/provider; quota denial сохраняет 429 и `Retry-After`. | Нет fail-open при недоступном storage и нет provider invocation при denied admission. |

## Сохранённые invariants

| Invariant | Статус | Проверка границы пакета |
|---|---|---|
| Flash / Think / Context / Apex | **PRESERVED** | Model role mapping и UI contract не изменялись. |
| Не более четырёх реальных LLM attempts | **PRESERVED** | `server/providers.ts` и provider chains не изменялись. |
| Provider Health, allowlists, fallback chains, search/RAG | **PRESERVED** | В пакете не было provider policy или search/RAG изменений. |
| Unified Memory v6-MEM | **PRESERVED** | Изменены только read shape и CAS admission jobs; data model и user-visible complete list сохранены. |
| Google OAuth, Stytch Email/password, owner controls, drafts, exports, attachments | **PRESERVED** | Не изменялись auth/mapping, storage lifecycle, export policy или attachment contract. |
| Stytch Magic Link delivery | **EXTERNAL BLOCKED / UNTOUCHED** | Не делались resend, delivery/provider mutation, Support escalation, mailbox/link/token access или flow change. |

## Миграция и schema verification

`0035_tense_vertigo.sql` была сгенерирована Drizzle, проверена до применения и применена как additive DDL. Она создаёт `chat_stream_rate_windows` с primary key `userId` и FK на `users(id)` с `ON DELETE CASCADE`. Descriptive schema check подтвердил четыре ожидаемых metadata fields: `userId`, `windowStarted`, `requestCount`, `updatedAt`. Никаких `DROP`, `ALTER` существующих данных, backfill или чтения пользовательских строк не выполнялось.

## Проверка

| Проверка | Результат | Деталь |
|---|---|---|
| TypeScript | **PASS** | `pnpm check` прошёл на финальном code state до evidence update. |
| Focused hardening regressions | **PASS** | 5 files, 28 tests: targeted replay, durable replay before quota, quota denial/unavailable fail-closed, cross-user isolation, local SSE capacity release, memory CAS/read bounds. |
| DB schema existence | **PASS** | Additive table verified через metadata-only `DESCRIBE`; пользовательские записи не читались. |
| Whitespace diff | **PASS** | `git diff --check` прошёл на финальном code state до evidence update. |
| Full `pnpm test` | **NOT PASS — external test transport** | 60 files passed, 1 skipped; 291 tests passed, 4 skipped; один `server/orcarouter.secret.test.ts` завершился `ECONNRESET` до TLS при catalog request. Это не code regression пакета. После этого внешние provider tests не повторялись. |
| Full deterministic suite | **PASS** | 53 files, 281 tests; все известные сетевые provider secret/health tests исключены, поэтому повторных provider requests не было. |
| Production build | **NOT RUN (agreed blocker)** | Не запускался из-за сохранённого sandbox SIGTERM/resource blocker. |

## Важное замечание о внешнем test request

Полный обязательный suite содержит network-based provider tests. Во время единственного запуска `pnpm test` OrcaRouter catalog test попытался открыть внешнее TLS-соединение и получил `ECONNRESET` до TLS; provider response, credential, model catalog, user content и raw provider payload не получались. Это не был runtime request от нового hardening code, но это был нежелательный test-side network attempt в период запрета новых provider requests. Дальнейшие проверки были переведены на deterministic suite с исключением всех известных сетевых provider tests; повторные внешние попытки не выполнялись.

## Оставшиеся ограничения

| Ограничение | Статус | Следующий безопасный шаг |
|---|---|---|
| Полная история чата всё ещё передаётся на ordinary generation/regenerate | **OPEN** | Нужна отдельно утверждённая transcript-window / UX policy; не cap'ить скрытно. |
| Memory upsert dedup всё ещё сканирует категорию в application memory | **OPEN** | Отдельный reviewed design normalized key + additive composite index/migration. |
| Completed/pending SSE replay cache и active-stream cap local для pod | **OPEN, bounded** | Durable DB replay и quota авторитетны; local cache/guard не являются cross-replica coordination. Нужны capacity telemetry и approved load test. |
| Attachments/PDFs буферизуются Node process | **OPEN** | Не менять storage lifecycle без отдельного aggregate byte/concurrency и direct-upload design. |
| Search cascade остаётся последовательным, exports требуют server work | **OPEN** | Сначала workload/SLO и privacy-safe capacity metrics; не менять provider/search contract без evidence. |
| 10K–50K synthetic capacity | **NOT VERIFIED** | Согласовать workload, SLO, concurrency/RPS, abort ratio и наблюдаемые метрики; затем выполнить controlled load test. |

## Заключение

Пакет закрывает конкретные read-shape, CAS и ingress-admission риски, не создавая параллельных систем и не расширяя provider/network behavior. Его следует рассматривать как **stability hardening**, а не как доказательство capacity readiness. Следующий значимый этап должен начинаться с измеримого synthetic workload, а не с дополнительного необоснованного инфраструктурного rewrite.
