# Kairema v6 — текущий статус пользовательского аудита

**Дата:** 2026-08-23 UTC  
**Статус документа:** промежуточный, не является закрытием аудита.  
**Privacy boundary:** документ содержит только статусы и агрегированные результаты. В нём нет истории, текстов запросов или ответов, имён чатов, идентификаторов, ссылок источников, данных вложений, OAuth-сессий, raw errors или секретов.

| Область | Статус | Подтверждённый результат | Что остаётся |
|---|---|---|---|
| Четыре публичные роли | **СДЕЛАНО в коде** | Ровно Flash, Think, Context и Apex; server policy и лимит не более четырёх upstream-попыток покрыты регрессиями. | Свежая authenticated live-search матрица для Context/Apex — **NOT VERIFIED**. |
| Память и профиль | **ЧАСТИЧНО** | Изоляция, настройки, extraction, post-turn worker и bounded profile summary покрыты server/client tests. | Новый чистый cross-chat/all-role recall, profile save, fact/topic search/filter/delete и second-user acceptance — **NOT VERIFIED**. |
| Вложения и vision | **ЧАСТИЧНО** | Protected lifecycle, previews и image-aware flow имеют code-level и ранее documented neutral evidence; PDF card contract покрыт. | Свежая browser picker/PDF-proof в безопасной сессии — **NOT VERIFIED**. |
| Live web-search | **ЧАСТИЧНО** | Persisted `webSearch` является server-side gate; safe count/date UI и техническая redaction покрыты тестами. | Полная fresh role matrix и RAG-only stale badge без искусственных данных — **NOT VERIFIED**. |
| Citation/privacy redaction | **СДЕЛАНО** | Server stream/persistence и client replay/copy устраняют opaque citation forms, включая double-escaped вариант; fresh neutral published absence check выполнен. | Ничего дополнительного не заявляется для ранее неоткрытой истории. |
| UI и настройки | **ЧАСТИЧНО** | Theme rollback, role descriptions, dropdown behavior, focused Home suite и published desktop sidebar-collapse исправлены и проверены. | Fresh authenticated profile-save/settings persistence повторно не выполнялись после browser-isolation stop. |
| Selective copy | **СДЕЛАНО в коде** | Message text selection и copy boundary покрыты component/UI regressions. | Не заменяет ручную mobile long-press приемку. |
| Секреты в frontend bundle | **СДЕЛАНО** | Текущий non-printing bundle audit и secret regressions не выявили обозначенных server-secret имён в public assets. | Повторять после изменений интеграций. |
| Owner analytics, metrics export и `chat_exports` DROP | **BLOCKED BY PLATFORM** | Strict owner guard не ослаблялся; schema, owner mapping и `chat_exports` не менялись. | Требуется platform-level `OWNER_OPEN_ID` mapping; DROP запрещён до полного owner gate. |

## Актуальная техническая верификация

| Проверка | Результат |
|---|---|
| `pnpm test` | **PASS:** 40 files passed, 1 skipped; 193 tests passed, 4 skipped. |
| `pnpm check` | **PASS** |
| `pnpm build` | **PASS**; только advisory о размере chunk. |
| Public bundle audit server-secret names | **PASS** |

> **Итог:** аудит пользовательской части **не закрыт**. Все незакрытые пункты остаются явно обозначенными как **NOT VERIFIED**, а owner-only блок — как **BLOCKED BY PLATFORM**. Никакой непроверенный browser-flow не считается PASS на основании одних тестов.
