# Kairema v6-Q — статус реализации

**Дата:** 2026-08-24 UTC  
**Статус:** промежуточный; v6-Q не закрыта.  
**Privacy boundary:** документ содержит только агрегированные статусы. Он не включает историю, содержимое сообщений, темы, факты, профили, идентификаторы, ссылки, OAuth-данные, raw errors или секреты.

| Пункт | Статус | Что реализовано / проверено | Что остаётся |
|---|---|---|---|
| Автоматические темы и cross-chat context | **FAIL в published browser** | Source/test contract PASS, однако в двух изолированных agent-created чатах свежая тестовая тема не отразилась в recall-ответе второго чата. Browser behavior имеет приоритет над локальной регрессией. | Диагностировать timing/persistence/context path, затем повторить на agent-created материалах и только после этого проверить остальные роли. |
| Неограниченная память | **PASS в source/test** | Убраны прежние capacity trims и read caps для facts/topics. Счётчики UI показывают фактические значения без fixed denominator; списки прокручиваются. Миграция не требовалась: существующая схема уже содержит необходимые поля и индексы. | Browser-проверка значений выше прежних порогов — **NOT VERIFIED**. |
| Массовая очистка истории | **PASS в source/test** | Добавлен protected user-scoped bulk-clear. Controlled dialog требует явное «Да, удалить всё», отмена не запускает mutation, повторная активация блокируется. Удаляются только сессии текущего пользователя и связанные с ними topics. | Destructive browser-проверка не запускалась без авторизованной сессии; реальные данные не затрагивались. |
| Массовая очистка памяти | **PASS в source/test** | Controlled dialog с explicit confirm и in-flight guard очищает только facts, topics и profile текущего пользователя через protected contract. | Авторизованная browser-приёмка — **NOT VERIFIED**. |
| Focused regressions, TypeScript и build | **PASS** | DB/context/router/Home regressions, `pnpm check`, production build и `git diff --check` успешно завершены. | Нет. |
| Полный test suite | **NOT PASS — внешний blocker** | Запуск полного набора дошёл до двух не относящихся к v6-Q external provider health checks: Groq catalog и Tavily search вернули HTTP 403. Provider chains не менялись. | Отдельно восстановить доступ к внешним health checks вне scope v6-Q. |
| Browser-приёмка v6-Q | **FAIL / NOT VERIFIED** | Published session восстановлена. Первый isolated cross-chat scenario выполнен только на agent-created нейтральных чатах и выявил failure recall; существующие чаты не использовались. | Исправить cross-chat failure, затем выполнить оставшиеся non-destructive проверки; destructive clear по-прежнему проводить только против созданного агентом материала. |
| Owner-функции | **BLOCKED BY PLATFORM** | Не изменялись. | Остаются вне scope v6-Q до решения platform-level owner mapping. |

> **Итог:** опубликованный source/test milestone v6-Q доступен, но заявлять «v6-Q ЗАКРЫТА» нельзя. Published browser выявил failure cross-chat recall на изолированном материале. До закрытия нужны исправление и browser PASS, а также успешный полный suite без внешнего 403 blocker.
