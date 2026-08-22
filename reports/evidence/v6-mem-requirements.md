# Kairema v6-MEM — извлечённые требования и критерии

**Источник:** `/home/ubuntu/upload/pasted_content.txt`, получен 22 августа 2026 года.

## Приоритет и неизменяемые инварианты

Главным блоком является существующая единая память: одна user-scoped память для `fast`, `smart`, `context` и `flagship`, без изменения ролей, активных цепей, лимита четырёх LLM-попыток, поиска/RAG, экспорта и privacy-контрактов. Память не является набором инструкций и не содержит chat/user/database IDs, URL, snippets, ключи либо секреты.

## Целевое поведение

| Область | Требование |
|---|---|
| Настройки | Независимые persistent `enabled` и `auto_extract`; первое отключает memory block без удаления записей, второе запрещает новые automatic facts/topics. |
| Entries | User-isolated facts и `dialog_topic`; facts ≤30, topics ≤100, FIFO по `last_seen_at`; нормализованный topic в том же чате за 24 часа обновляется, а не дублируется. |
| Extraction | Только после успешного assistant turn, вне основного SSE; валидированный JSON, idempotent turn processing, bounded retry при transient failure, soft failure без поломки ответа. |
| Контекст | SYSTEM → ROLE CAPABILITIES → MEMORY → CURRENT INFORMATION → HISTORY → MESSAGE; memory block содержит профиль, ≤30 facts и ≤15 последних topics. |
| UI | Профиль, оба switch, поиск и фильтры entries, счётчики, user-scoped удаление, подтверждаемая очистка и persistence. |
| Приёмка памяти | T1–T11: cross-chat/cross-role, profile, UI/delete, persistence, isolation, disabled switches, duplicate turn, failure+retry и общее чтение памятью всех четырёх ролей. |

## Последующие блоки и окончательный gate

После памяти требуются preview временных attachments, отдельная owner-only аналитика с aggregate CSV/JSON и live refresh не чаще минуты. `chat_exports` допускается удалить только при настоящей owner OAuth-проверке обеих загрузок, отсутствии persistent server-copy, нулевом SQL count и согласованном нулевом grep. Любой FAIL/NOT VERIFIED удерживает table от удаления и исключает статус «v6-MEM ЗАКРЫТА».

## Gap-анализ опубликованной v6-L.4 (22 августа 2026 года)

| Критерий | Исходное состояние | Требуемое изменение v6-MEM |
|---|---|---|
| Два persistent switch | Уже существовали отдельные `memory_settings.enabled` и `autoExtract`; context уважал `enabled`, extraction — оба значения. | Сохранить контракт и добавить регрессии независимого поведения. |
| Лимиты и FIFO | Факты ограничивались 20, темы 50; trim сортировал по `createdAt`. | Изменить на facts ≤30 и topics ≤100, FIFO по `lastSeenAt`. |
| Topics | Тема была ключом `date:role:topic`, без `sessionId` и без 24-часового same-chat dedup. | Добавить безопасную привязку к чату и `lastSeenAt`, нормализованный 24-часовой refresh вместо дубля. |
| Idempotency и retry | Extraction запускался после `done`, но без persisted turn-idempotency и без retry после transient LLM ошибок. | Ввести persisted queue/job по assistant message ID, bounded retry и soft processing без изменения SSE-бюджета. |
| Память в context | Порядок включения уже соответствует target, но ограничен 20 facts/10 topics и не отделяет память как данные от инструкций. | Увеличить до 30/15 и экранировать пользовательские значения как справочные данные, а не инструкции. |
| Профиль и UI | Явное сохранение, листинг и удаление есть, но отсутствуют search/filter/counters и независимый auto-extract switch в UI. | Расширить существующий MemoryDialog без добавления нового хранилища. |

> Вывод: нужна миграция с минимальными additive полями и таблицей jobs. Четыре публичные роли, active chains, поиск/RAG, локальный export и политика server-only secrets не изменяются.
