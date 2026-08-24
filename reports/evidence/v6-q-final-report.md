# KAIREMA v6-Q — итоговый статус

**Дата:** 2026-08-24 UTC  
**Режим завершения:** подтверждённый source/test объём закрыт; browser-приёмка остановлена по прямому решению пользователя.  
**Privacy boundary:** отчёт содержит только агрегированные статусы. В нём нет пользовательских сообщений, тем, фактов, профилей, идентификаторов, OAuth/session данных, raw errors, файлов или секретов.

## Закрытые локальные и кодовые пункты

| Пункт | Статус | Подтверждённый результат |
|---|---|---|
| Автоматические темы и cross-chat context | **PASS в source/test** | После допустимого завершённого обмена сохраняется ограниченная однострочная тема с датой и публичной ролью. Cross-chat context передаёт сохранённые темы и содержит правило не заявлять отсутствие памяти при наличии тем. |
| Immediate recall race | **FIX PUBLISHED** | Первичная isolated browser-проверка выявила race между client-visible завершением streaming-ответа и durable topic persistence. Поток теперь завершает extraction до финального client completion; введён стабильный per-exchange topic key и focused stream/context regressions. |
| Неограниченная user-scoped память | **PASS в source/test** | Удалены прежние trim/read caps facts/topics. UI использует реальные counts без fixed denominator; списки остаются прокручиваемыми. Существующая схема достаточна, миграция не требовалась. |
| Массовая очистка истории | **PASS в source/test** | Protected user-scoped bulk clear удаляет только сессии вызывающего пользователя и каскадно их dialog topics. Dialog требует «Да, удалить всё», отмена не вызывает mutation, повторная активация блокируется. |
| Массовая очистка памяти | **PASS в source/test** | Controlled explicit-confirm dialog и in-flight guard очищают только facts, topics и profile текущего пользователя через protected contract. |
| OAuth возврат | **FIX PUBLISHED** | Успешный callback возвращает HTTP 303 на корень validated initiating HTTPS app origin после nonce-проверки. Проверка сессии принимает пустое необязательное display name, по-прежнему требуя непустые openId/appId. |
| Техническая валидация | **PASS с документированным внешним ограничением** | Focused DB/context/router/Home и OAuth callback tests, `pnpm check`, `git diff --check` и production build прошли. Полный suite запускался, но не стал зелёным только из-за внешних HTTP 403 в health checks Groq catalog и Tavily search; provider chains не менялись. |

## Browser/UI пункты, остановленные платформенной сессией

| Пункт | Итоговый статус | Причина остановки |
|---|---|---|
| Cross-chat recall после published race fix | **NOT VERIFIED BY PLATFORM SESSION** | В managed browser не появилась авторизованная сессия для безопасного retest. |
| Recall во всех четырёх ролях | **NOT VERIFIED BY PLATFORM SESSION** | Нет сессии в том же контролируемом окне. |
| Counts выше прежних порогов и scroll/load в UI | **NOT VERIFIED BY PLATFORM SESSION** | Browser-приёмка остановлена до создания новых test records. |
| «Очистить всю историю» и каскад тем | **NOT VERIFIED BY PLATFORM SESSION** | Destructive UI сценарий сознательно не запускался без сессии. |
| «Очистить всю память» | **NOT VERIFIED BY PLATFORM SESSION** | Destructive UI сценарий сознательно не запускался без сессии. |
| Вложения, vision и switch | **ВНЕ v6-Q; ручная проверка пользователем** | Пользователь сообщил, что выполнит ручную UI-приёмку после стабилизации canonical runtime. |

> **Итоговое решение:** новые OAuth и browser-попытки прекращены. Переход в Manus PWA, белая страница и guest-shell в managed browser рассматриваются как platform/session boundary. Это не является PASS browser-приёмки и не маскируется под неё. Реальные пользовательские история, память, профиль и вложения во время остановленного retest не затрагивались.
