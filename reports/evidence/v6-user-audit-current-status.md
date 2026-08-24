# Kairema v6 — текущий статус пользовательского аудита

**Дата:** 2026-08-23 UTC  
**Статус документа:** промежуточный, не является закрытием аудита.  
**Privacy boundary:** документ содержит только статусы и агрегированные результаты. В нём нет истории, текстов запросов или ответов, имён чатов, идентификаторов, ссылок источников, данных вложений, OAuth-сессий, raw errors или секретов.

| Область | Статус | Подтверждённый результат | Что остаётся |
|---|---|---|---|
| Четыре публичные роли | **СДЕЛАНО, с честным ограничением доступности** | Ровно Flash, Think, Context и Apex; server policy и лимит не более четырёх upstream-попыток покрыты регрессиями. Нейтральная published-матрица всех четырёх ролей завершена с approved safe search metadata и без raw links/recognized technical citation patterns. | Доступность части live-сервисов ограничена и отражена UI; это не маскируется как полный live-search PASS. |
| Память и профиль | **ЧАСТИЧНО** | Изоляция, settings, extraction, post-turn worker и bounded profile summary покрыты server/client tests. v6-P добавляет исключение служебных/test и live-search turns, user-scoped каскад topics при удалении чата, FIFO и capacity guard. | Целевая очистка начата с точным user-scope, но UI-подтверждение одной поздней операции задержалось; полный перечень разрешённых user data пока **NOT VERIFIED**. Cross-chat/all-role recall, profile Save и second-user acceptance также **NOT VERIFIED**. |
| Вложения и vision | **ЧАСТИЧНО** | Protected lifecycle, previews и image-aware flow имеют code-level evidence; v6-P добавляет немедленный local image preview, безопасный revoke и 15-second retry state; component regression PASS. | Browser automation по-прежнему не привязывается к hidden native input, поэтому свежий picker/sent-bubble/vision/PDF-proof — **NOT VERIFIED**; это не доказанный app defect. |
| Live web-search | **ЧАСТИЧНО** | Persisted `webSearch` является server-side gate; safe count/date UI и redaction покрыты тестами. v6-P исключает transient live-search turns из авто-памяти и добавляет server-side truthful limitation для freshness-intents при выключенном, empty, degraded или unavailable live search. | RAG-only stale badge и fresh current-event browser acceptance без искусственных данных — **NOT VERIFIED**. |
| Citation/privacy redaction | **СДЕЛАНО** | Server stream/persistence и client replay/copy устраняют opaque citation forms, включая double-escaped вариант; fresh neutral published absence check выполнен. | Ничего дополнительного не заявляется для ранее неоткрытой истории. |
| UI и настройки | **ЧАСТИЧНО** | Theme rollback, role descriptions, dropdown behavior, Home suite и published desktop sidebar-collapse исправлены и проверены. v6-P добавляет две независимые guest-mode точки входа: topbar и заметную empty-state кнопку с 44px touch target; обе use only existing event-driven OAuth entry. Direct canonical `/welcome` is blocked by platform 404, so the data-free phone entry is gateway-safe root query `/?welcome=1`; App/Welcome regression, TypeScript, build and 375px local visual check PASS. | **СЛОМАНО (canonical root-query delivery):** query reaches Kairema shell but the published runtime ignores the welcome branch; public asset lacks the welcome signature. A post-propagation retry changed shell mode, so verification stopped without data access. This is a delivery/runtime mismatch, not an OAuth issue. Authenticated profile-save/settings switch persistence и memory dialog acceptance remain **NOT VERIFIED**. |
| Selective copy | **СДЕЛАНО в коде** | Message text selection и copy boundary покрыты component/UI regressions. | Не заменяет ручную mobile long-press приемку. |
| Секреты в frontend bundle | **СДЕЛАНО** | Текущий non-printing bundle audit и secret regressions не выявили обозначенных server-secret имён в public assets. | Повторять после изменений интеграций. |
| Owner analytics, metrics export и `chat_exports` DROP | **BLOCKED BY PLATFORM** | Strict owner guard не ослаблялся; schema, owner mapping и `chat_exports` не менялись. | Требуется platform-level `OWNER_OPEN_ID` mapping; DROP запрещён до полного owner gate. |

## Актуальная техническая верификация

| Проверка | Результат |
|---|---|
| `pnpm test` | **EXTERNAL AVAILABILITY BLOCKER:** 39 files passed, 1 failed, 1 skipped; 196 tests passed, 1 failed, 4 skipped. Единственный отказ — timeout внешнего SambaNova health probe; provider semantics не менялись и отказ не маскируется. |
| `pnpm check` | **PASS** |
| `pnpm build` | **PASS**; только advisory о размере chunk. |
| Public bundle audit server-secret names | **PASS** |

> **Итог:** аудит пользовательской части **не закрыт**. Все незакрытые пункты остаются явно обозначенными как **NOT VERIFIED**, а owner-only блок — как **BLOCKED BY PLATFORM**. Никакой непроверенный browser-flow не считается PASS на основании одних тестов.
