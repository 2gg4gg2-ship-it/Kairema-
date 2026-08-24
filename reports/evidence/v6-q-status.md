# Kairema v6-Q — статус реализации

**Дата:** 2026-08-24 UTC  
**Статус:** промежуточный; v6-Q не закрыта.  
**Privacy boundary:** документ содержит только агрегированные статусы. Он не включает историю, содержимое сообщений, темы, факты, профили, идентификаторы, ссылки, OAuth-данные, raw errors или секреты.

| Пункт | Статус | Что реализовано / проверено | Что остаётся |
|---|---|---|---|
| Автоматические темы и cross-chat context | **FIX PUBLISHED; browser retest NOT VERIFIED** | Source/test contract PASS. После первого published failure устранена race между сохранением темы и client-visible completion; исправление опубликовано и покрыто focused stream/context regressions. | Повторить на agent-created материалах: OAuth возврат в Kairema после выбора доступной browser-учётной записи открыл пустую вкладку, поэтому новая acceptance-сессия не стартовала. |
| Неограниченная память | **PASS в source/test** | Убраны прежние capacity trims и read caps для facts/topics. Счётчики UI показывают фактические значения без fixed denominator; списки прокручиваются. Миграция не требовалась: существующая схема уже содержит необходимые поля и индексы. | Browser-проверка значений выше прежних порогов — **NOT VERIFIED**. |
| Массовая очистка истории | **PASS в source/test** | Добавлен protected user-scoped bulk-clear. Controlled dialog требует явное «Да, удалить всё», отмена не запускает mutation, повторная активация блокируется. Удаляются только сессии текущего пользователя и связанные с ними topics. | Destructive browser-проверка не запускалась без авторизованной сессии; реальные данные не затрагивались. |
| Массовая очистка памяти | **PASS в source/test** | Controlled dialog с explicit confirm и in-flight guard очищает только facts, topics и profile текущего пользователя через protected contract. | Авторизованная browser-приёмка — **NOT VERIFIED**. |
| Focused regressions, TypeScript и build | **PASS** | DB/context/router/Home regressions, `pnpm check`, production build и `git diff --check` успешно завершены. | Нет. |
| Полный test suite | **NOT PASS — внешний blocker** | Запуск полного набора дошёл до двух не относящихся к v6-Q external provider health checks: Groq catalog и Tavily search вернули HTTP 403. Provider chains не менялись. | Отдельно восстановить доступ к внешним health checks вне scope v6-Q. |
| Browser-приёмка v6-Q | **NOT VERIFIED / BLOCKED BY PLATFORM-BROWSER** | Первый isolated cross-chat scenario до race fix выявил failure recall; существующие чаты не использовались. Race fix и OAuth root-return/session-verification fix опубликованы. Пользователь подтвердил завершение стандартного входа в Kairema. | Managed browser продолжает показывать гостевую оболочку: завершённая пользовательская сессия не передалась в то же управляемое окно. Новые test records и destructive действия после fixes не выполнялись. |
| Owner-функции | **BLOCKED BY PLATFORM** | Не изменялись. | Остаются вне scope v6-Q до решения platform-level owner mapping. |

> **Итог:** опубликованные source/test fixes v6-Q доступны, но заявлять «v6-Q ЗАКРЫТА» нельзя. До закрытия нужен browser PASS на agent-created данных и успешный полный suite без внешнего 403 blocker. Текущий retest остановлен ограничением передачи авторизованной сессии из пользовательского Kairema-окна в managed browser; реальные данные не затрагивались.
