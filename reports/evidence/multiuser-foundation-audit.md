# Multi-user foundation — audit и первый additive шаг

**Дата:** 2026-08-25 UTC  
**Статус:** source-level audit завершён; реализована одна минимальная additive user-scoped preference. Это не заявление о закрытии всего multi-user ТЗ.

| Требование | Текущий результат |
|---|---|
| Auth | Существующий Manus OAuth и `protectedProcedure` уже формируют server-derived user context; вторая auth-система не добавлялась. |
| Chat/message isolation | `chat_sessions.userId`, `getOwnedChatSession`, `requireOwnedSession` и owner-filtered CRUD уже создают серверную границу истории. |
| Shared memory | Facts, topics, profile и memory settings уже user-scoped; chat context получает их по server-derived user ID для всех четырёх публичных ролей. |
| Attachments | Existing binary upload, attachment owner scope, S3 key lifecycle и transient vision context сохранены. |
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
| `pnpm check` | **PASS**. |
| `git diff --check` | **PASS**. |

> Production build не повторялся: пользователь ранее явно оставил этот platform-blocker открытым после четырёх SIGTERM среды во время Vite chunk rendering.
