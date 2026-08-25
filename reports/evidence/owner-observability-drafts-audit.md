# Kairema — owner observability и draft autosave: audit

**Дата:** 2026-08-25 UTC  
**Статус:** реализовано и проверено на code-level. Existing Manus OAuth, owner mapping, multi-user isolation, memory, exports, attachments, search cascade, четыре роли и bounded fallback contract сохранены.

## Выполненный объём

Этап расширяет существующую owner-only страницу и server-side contracts, а не создаёт второй dashboard, routing layer или auth mechanism. Доступ к новым observability reads и control mutations определяется действующим trusted server identity и `OWNER_OPEN_ID`; фронтенд скрытие не является границей доступа.[1] [2]

| Область | Статус | Реализация |
|---|---|---|
| Owner-only diagnostics | **PASS (code-level)** | Добавлены protected server contracts для aggregate observability, last technical events, search/memory status и allowlisted control targets. Guest получает `UNAUTHORIZED`, non-owner — `FORBIDDEN`. |
| Mobile owner panel | **PASS (code-level)** | Существующая `/owner-analytics` расширена компактными status cards, fallback overview, bounded events и controls; подтверждение требуется перед изменением control. Direct route остаётся закрыт verified-session gate. |
| Provider/model flags | **PASS (code-level)** | Persistent additive controls разрешают только server allowlist provider/model targets, поддерживают `disabled`, `normal`, `prefer`, `avoid`, и записывают metadata-only owner audit event. |
| Fail-safe fallback | **PASS (code-level)** | Manual-disabled candidate пропускается до сети, не расходует LLM-attempt budget; unknown/missing flag не меняет базовую цепочку. Existing maximum of four real LLM attempts не увеличен. |
| Technical observability | **PASS (code-level)** | Сохраняются bounded metadata-only events для fallback, search/provider issue и owner flags: timestamp, category/code, role/actor when relevant. Prompt, response, memory content, attachment data, credentials и URLs не включаются. |
| Aggregate metrics | **PASS (code-level)** | Snapshot показывает health, provider/search aggregates и memory counts без user IDs, private memory, chat text или files. |
| Persistent drafts | **PASS (code-level)** | Debounced composer autosave привязан к verified `ctx.user.id` и `sessionId`; same-chat hydration, clear after confirmed send и retention after failed/aborted send покрыты тестами. Draft никогда не отправляется автоматически. |

## Persistent data design

Migration `0032_tricky_domino.sql` применена как additive-only change. Она добавляет три модели: persistent provider controls, bounded technical events и user/chat-scoped drafts. Existing users, chats, messages, memory, exports, attachments и provider-health data не изменялись и не удалялись.[3]

| Модель | Scope и назначение | Privacy / retention boundary |
|---|---|---|
| Provider controls | Server-managed allowlisted provider/model target | Нет keys, токенов или client-only override; flag сохраняется после restart. |
| Technical events | Owner diagnostics | Только metadata; recent list bounded на server-side. |
| Chat drafts | `userId` + `sessionId` | Owner-scoped chat lookup предшествует read/write/clear; guest не получает server draft. |

> **Fail-safe правило:** disabled flag может только исключить уже разрешённый candidate. Он не добавляет provider, не меняет allowlist, не раскрывает credentials и не обходит rate limits или bounded retry policy.

## Проверки

| Проверка | Результат |
|---|---|
| Focused owner/provider/draft regression sweep | **PASS:** 5 files, 76 tests. Включает owner/guest denial, allowlist, audit event, manual-disabled fallback skip, cross-user draft boundary и composer lifecycle. |
| Full `pnpm test` | **PASS:** 56 files passed, 1 skipped; 269 tests passed, 4 skipped. Внешние provider-secret assertions в этом запуске также прошли. |
| `pnpm check` | **PASS:** TypeScript без ошибок. |
| `git diff --check` | **PASS:** whitespace errors отсутствуют. |
| Dev root availability | **PASS:** `GET http://127.0.0.1:3000/` вернул HTTP 200. |
| Production build | **NOT RUN:** прежний sandbox SIGTERM blocker сохранён по явному требованию; это не code regression. |
| Live owner/mobile browser acceptance | **NOT VERIFIED BY PLATFORM SESSION:** не запускались OAuth/owner browser actions и не открывались private user/owner data. Code-level owner UI и responsive contracts покрыты компонентными/route tests, но это не заменяет future authenticated device acceptance. |

## Сохранённые границы

Этот этап не меняет OAuth/Google/Manus auth, email/password status, `OWNER_OPEN_ID` mapping, user-scoped memory, export lifecycle, attachments, search cascade или existing fallback chains. В частности, Tavily credentials не изменялись, а проверка full suite не используется как разрешение выполнять внешние provider mutations.

## Следующая допустимая проверка

Когда platform owner session станет стабильно доступна, можно отдельно выполнить live acceptance без просмотра лишних данных: открыть owner panel, проверить mobile card layout, toggle a permitted provider flag, убедиться в fallback skip и вернуть flag в исходное состояние. До этого code-level проверка остаётся единственным заявленным evidence.

## References

[1]: ../../server/routers.ts "Owner diagnostics, allowlisted controls и user-scoped draft procedures"
[2]: ../../client/src/pages/OwnerAnalytics.tsx "Compact owner-only mobile panel"
[3]: ../../drizzle/0032_tricky_domino.sql "Additive persistence migration"
[4]: ../../server/providers.ts "Controlled candidates и bounded fallback execution"
[5]: ../../server/db.ts "Aggregate observability, bounded technical events и owned drafts"
[6]: ../../server/owner-observability-controls.test.ts "Owner boundary и metadata-only regressions"
[7]: ../../server/chat-drafts.router.test.ts "Draft user/chat ownership regressions"
[8]: ../../client/src/pages/Home.integration.test.tsx "Draft hydration, send-success clear и failed-send retention"
