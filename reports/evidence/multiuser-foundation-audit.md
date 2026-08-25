# Multi-user foundation — audit и первый additive шаг

**Дата:** 2026-08-25 UTC  
**Статус:** source-level audit завершён; реализована одна минимальная additive user-scoped preference. Это не заявление о закрытии всего multi-user ТЗ.

| Требование | Текущий результат |
|---|---|
| Auth | Существующий Manus OAuth и `protectedProcedure` уже формируют server-derived user context; вторая auth-система не добавлялась. |
| Chat/message isolation | `chat_sessions.userId`, `getOwnedChatSession`, `requireOwnedSession` и owner-filtered CRUD создают серверную границу истории; `chats.rename` теперь возвращает server-side `NOT_FOUND` для foreign/no-op update, а не успешный no-op. |
| Shared memory | Facts, topics, profile и memory settings уже user-scoped; chat context получает их по server-derived user ID для всех четырёх публичных ролей. |
| Attachments | Existing binary upload, attachment owner scope, S3 key lifecycle и transient vision context сохранены; foreign `attachments.list` преобразуется в безопасный `NOT_FOUND` до создания preview/signed URL. |
| User preferences | Существующие settings серверно сохраняются; добавлено `user_settings.emailNotifications` с opt-out default `0`, protected allowlist и UI-переключатель. |
| Notifications | Добавлена только user-scoped preference abstraction. Email delivery, provider, client secrets и фиктивная отправка не добавлялись. |
| Exports | Persistent export lifecycle остаётся незакрытым: требуются отдельные schema/router/UI/tests, поэтому этот audit не выдаёт его за реализованный. |
| Owner/admin | Owner mapping не менялся; admin boundary остаётся server-side. |

## Migration и проверки

| Проверка | Результат |
|---|---|
| `0030_confused_starbolt.sql` | **APPLIED:** additive `emailNotifications int DEFAULT 0 NOT NULL` в `user_settings`; без удаления или преобразования данных. |
| Focused settings regressions | **PASS:** 2 files, 6 tests. |
| Core cross-user boundary regressions | **PASS:** 3 files, 30 tests для chat/attachment/memory owner scope; export/settings-specific IDOR coverage остаётся открытой. |
| Expanded non-export router sweep | **PASS:** 9 files, 48 tests. Включает foreign chat rename denial, foreign attachment list denial до signed URL и runtime scope profile/memory settings/user settings только из `ctx.user.id`; реальные пользовательские данные, файлы и signed URLs не создавались. |
| Attachment download IDOR | **PASS:** structural regression подтверждает owner-scoped lookup до signed URL и безопасную ошибку при неуспешном owner lookup; `attachments.lifecycle.test.ts`, 4 tests. Positive signed-download flow этим тестом не заявляется. |
| `pnpm check` | **PASS**. |
| `git diff --check` | **PASS**. |
| Full regression suite | `pnpm test`: **не является PASS** только из-за `server/zenmux.secret.test.ts` — внешний `https://zenmux.ai/api/v1/models` завершился `ConnectTimeoutError`; это не изменение application code. Альтернативный suite с исключением только этого live network test: **PASS**, 49 files, 237 tests; 1 file / 4 tests skipped. |

> Production build не повторялся: пользователь ранее явно оставил этот platform-blocker открытым после четырёх SIGTERM среды во время Vite chunk rendering.
