# Multi-user foundation — audit и первый additive шаг

**Дата:** 2026-08-25 UTC  
**Статус:** source-level audit завершён; неэкспортные multi-user границы и отдельный persistent export lifecycle реализованы и покрыты изолированными регрессиями. Это не заменяет отложенную browser-приёмку и не является заявлением о production build.

| Требование | Текущий результат |
|---|---|
| Auth | Существующий Manus OAuth и `protectedProcedure` уже формируют server-derived user context; вторая auth-система не добавлялась. |
| Chat/message isolation | `chat_sessions.userId`, `getOwnedChatSession`, `requireOwnedSession` и owner-filtered CRUD создают серверную границу истории; `chats.rename` теперь возвращает server-side `NOT_FOUND` для foreign/no-op update, а не успешный no-op. |
| Shared memory | Facts, topics, profile и memory settings уже user-scoped; chat context получает их по server-derived user ID для всех четырёх публичных ролей. |
| Attachments | Existing binary upload, attachment owner scope, S3 key lifecycle и transient vision context сохранены; foreign `attachments.list` преобразуется в безопасный `NOT_FOUND` до создания preview/signed URL. |
| User preferences | Существующие settings серверно сохраняются; добавлено `user_settings.emailNotifications` с opt-out default `0`, protected allowlist и UI-переключатель. |
| Notifications | Добавлена только user-scoped preference abstraction. Email delivery, provider, client secrets и фиктивная отправка не добавлялись. |
| Exports | Существующая `chat_exports` получила только Drizzle mapping без DDL. Protected server lifecycle создаёт Markdown/PDF artifact в S3 по пути `exports/{userId}/{sessionId}/…`, сохраняет metadata, показывает только личную историю и выдаёт signed URL лишь после owner-scoped lookup. Retention user-controlled: запись хранится до удаления пользователем; при удалении из metadata/UI удаляются owner-scoped key и reference. Это соответствует storage contract: unreferenced object считается effectively gone; отдельный physical-delete API не используется. |
| Owner/admin | Owner mapping не менялся; admin boundary остаётся server-side. |

## Migration и проверки

| Проверка | Результат |
|---|---|
| `0030_confused_starbolt.sql` | **APPLIED:** additive `emailNotifications int DEFAULT 0 NOT NULL` в `user_settings`; без удаления или преобразования данных. |
| `0031_export_compatibility_mapping.sql` | **APPLIED:** compatibility-only пустая migration. `chat_exports` уже существовала; `CREATE`/`ALTER`/`DROP`, индексы и данные не затрагивались. |
| Focused settings regressions | **PASS:** 2 files, 6 tests. |
| Core cross-user boundary regressions | **PASS:** 3 files, 30 tests для chat/attachment/memory owner scope; export/settings-specific IDOR coverage остаётся открытой. |
| Expanded non-export router sweep | **PASS:** 9 files, 48 tests. Включает foreign chat rename denial, foreign attachment list denial до signed URL и runtime scope profile/memory settings/user settings только из `ctx.user.id`; реальные пользовательские данные, файлы и signed URLs не создавались. |
| Attachment download IDOR | **PASS:** structural regression подтверждает owner-scoped lookup до signed URL и безопасную ошибку при неуспешном owner lookup; `attachments.lifecycle.test.ts`, 4 tests. Positive signed-download flow этим тестом не заявляется. |
| `pnpm check` | **PASS**. |
| `git diff --check` | **PASS**. |
| Export IDOR regressions | **PASS:** `server/chat-exports.test.ts` и `server/chat-ownership.router.test.ts`: 2 files, 11 tests. Покрыты foreign session/export denial для create/list/download/delete; реальные export records и файлы не читались. |
| Export UI integration | **PASS:** `Home.integration.test.tsx`: 34 tests. Проверяет доступность личной export history control и client contract protected lifecycle. |
| Export retention contract | **PASS:** `server/export-retention.contract.test.ts`: 2 tests. Проверены disclosure user-controlled retention и owner-scoped logical cleanup без неподдерживаемого physical-delete path. |
| Full regression suite | `pnpm test`: **не является PASS** из-за двух внешних credential-health assertions: Groq catalog и Tavily search вернули HTTP 403. Application code, OAuth, export lifecycle и provider routing в ответ на это не менялись. |
| Deterministic regression suite | **PASS:** с исключением только двух внешних 403 health tests — 49 files, 244 tests; 1 file / 4 tests skipped. Также прошли `pnpm check` и `git diff --check`. |

> Production build не повторялся: пользователь ранее явно оставил этот platform-blocker открытым после четырёх SIGTERM среды во время Vite chunk rendering.
