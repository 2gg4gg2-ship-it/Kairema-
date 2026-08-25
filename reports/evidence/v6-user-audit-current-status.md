# Kairema v6 — текущий статус пользовательского аудита

**Дата актуализации:** 2026-08-25 UTC
**Статус документа:** промежуточная privacy-safe сводка; это не закрытие полного пользовательского аудита.
**Граница приватности:** документ содержит только агрегированные статусы и результаты. В нём нет истории, текстов запросов или ответов, имён чатов, идентификаторов, ссылок источников, данных вложений, OAuth-сессий, raw errors или секретов.

| Область | Статус | Подтверждённый результат | Остающееся ограничение |
|---|---|---|---|
| Четыре публичные роли | **СДЕЛАНО, с честным ограничением доступности** | Ровно Flash, Think, Context и Apex. Лимит не более четырёх upstream-попыток и server policy покрыты регрессиями. | Часть live-сервисов может быть ограничена; интерфейс не должен выдавать это за полный live-search PASS. |
| Память, профиль и темы | **СДЕЛАНО в source/test; NOT VERIFIED BY PLATFORM SESSION для browser** | Durable-before-completion сохранение тем, cross-chat context, реальные счётчики и protected clear-actions реализованы и покрыты code-level регрессиями. | Browser cross-chat retest, all-role recall, profile Save и destructive dialogs не повторялись из guest-shell среды. |
| Массовая очистка истории | **СДЕЛАНО в source/test; NOT VERIFIED BY PLATFORM SESSION для browser** | User-scoped bulk clear, каскад тем и double-submit guard покрыты DB/Home регрессиями. | Реальная destructive browser-приёмка не запускалась против существующей истории. |
| Фото-вложения | **СДЕЛАНО в live-приёмке** | Пользователь подтвердил, что фото корректно прикрепляются и работают в опубликованной версии. В том числе подтверждены компактный preview, удаление до отправки, binary upload, lifecycle и работа сценариев прикрепления. | PDF document-card и vision остаются отдельными **NOT VERIFIED** пунктами. |
| Выборочное копирование текста | **СДЕЛАНО в live-приёмке** | Пользователь подтвердил сценарий `long-press → Выбрать текст → фрагмент → Копировать`: копируется именно фрагмент, а повторное взаимодействие не отменяет selection mode. | Дополнительных ограничений не зафиксировано. |
| Live web-search | **ЧАСТИЧНО** | Server-side gate, safe count/date UI и redaction имеют code-level покрытие. Freshness-intents получают truthful limitation при недоступном живом поиске. | RAG-only stale badge и fresh current-event browser acceptance остаются **NOT VERIFIED**. |
| Citation/privacy redaction | **СДЕЛАНО** | Server stream/persistence и client replay/copy устраняют известные opaque citation forms, включая double-escaped вариант. | Ранее неоткрытая история не читалась и не переобрабатывалась для этой проверки. |
| UI и настройки | **ЧАСТИЧНО** | Theme rollback, полные описания ролей, dropdown behavior, guest login entry points и sidebar-collapse покрыты регрессиями. | Profile-save и memory-dialog acceptance остаются **NOT VERIFIED**. |
| Секреты во frontend bundle | **СДЕЛАНО** | Выполненные bundle audits и secret regressions не обнаружили server-secret имён в public assets. | Повторять после будущих интеграционных изменений. |
| Owner analytics, metrics export и `chat_exports` DROP | **BLOCKED BY PLATFORM** | Owner guard не ослаблялся; schema, owner mapping и `chat_exports` не менялись. | Нужен platform-level `OWNER_OPEN_ID` mapping; DROP запрещён до полного owner gate. |

## Актуальная техническая верификация

| Проверка | Результат |
|---|---|
| Focused и полный selection/attachment suite | **PASS:** 45 files passed, 1 skipped; 222 tests passed, 4 skipped. |
| `pnpm check` | **PASS** по последней подтверждённой валидации текущего исправления. |
| `git diff --check` | **PASS** перед evidence-checkpoint. |
| `pnpm build` | **NOT VERIFIED BY SANDBOX RESOURCES:** четыре запуска были завершены средой с SIGTERM при Vite chunk rendering; последняя попытка завершилась после 6107 transformed modules на `rendering chunks (303)`. Пользователь явно попросил оставить этот blocker открытым и не оптимизировать рабочий код ради него. |

> **Итог:** текущий mobile selection/photo scope подтверждён пользователем в live-сессии. Production-build acceptance намеренно остаётся открытым platform-blocker до доступного runtime. Эта сводка не заявляет PASS для browser-пунктов, которые не были выполнены в авторизованной среде.

## Основания

| № | Источник статуса |
|---|---|
| 1 | `todo.md`: tracked code/test/live acceptance и явные blockers. |
| 2 | Checkpoints `480096e8`, `842a2394`, `f43eb6c5`, `8ad120b7`: history mobile selection/photo acceptance и build-blocker evidence. |
