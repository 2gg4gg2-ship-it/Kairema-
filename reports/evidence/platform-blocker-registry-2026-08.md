# Kairema — реестр legacy platform-blockers

**Статус реестра:** зафиксирован 25 августа 2026 года по прямому решению пользователя. Он отделяет исторические browser/OAuth/owner/provider/build-приёмки от завершённого функционального code-level multi-user этапа. Никакая проверка из этого реестра при его создании не запускалась; OAuth, owner mapping и пользовательский контент не менялись.

> **Завершённый code-level scope.** В опубликованной версии реализованы и проверены server-derived multi-user boundaries и persistent server-side export lifecycle: user-scoped chat/message/memory/profile/settings/attachment/export access, explicit foreign denials, protected personal export history, signed download после owner lookup и user-controlled logical cleanup.

## Правило возобновления

Пункты ниже не являются дефектами, установленными по коду. Это приёмки, для которых отсутствует требуемая внешняя среда, либо проверки, остановленные по согласованной политике безопасности. Их можно возобновлять только отдельной задачей после доступности подходящей среды и без ослабления OAuth или owner checks.

| № | Исторический tracker ID | Статус | Причина блокировки | Допустимое условие разблокировки |
|---:|---|---|---|---|
| 1 | `v6-MEM/BUG-OWNER-ANALYTICS-GUARD` | BLOCKED — platform owner configuration | Требуется фактический owner claim в поддерживаемом runtime; менять owner mapping в коде запрещено. | Платформа поставляет корректный configured owner context. |
| 2 | `v6-MEM/BUG-OWNER-CLAIM-MAPPING` | BLOCKED — authenticated owner session | Нужна стабильная verified owner-сессия для маскированного сравнения claims; raw claims хранить нельзя. | Доступна owner-сессия в изолированном browser runtime. |
| 3 | `v6-MEM/BUG-OWNER-CLAIM-PRODUCTION-CONFIG` | BLOCKED — platform configuration | Значение owner claim управляется платформенной конфигурацией, а не приложением. | Платформа восстанавливает runtime configuration. |
| 4 | `v6-MEM/USER-ACCEPTANCE` | NOT VERIFIED — browser session | Требуется авторизованная user UI-приёмка памяти, controls и privacy поведения; такие проверки сейчас не запускаются. | Стабильная user-сессия и отдельная команда на приёмку. |
| 5 | `v6-MEM/OWNER-PLATFORM-BLOCKER` | BLOCKED — owner runtime | Owner analytics, export metrics и legacy DROP gate требуют platform owner context. | Восстановлен owner runtime; DROP только после отдельного gate. |
| 6 | `v6-MEM/USER-T1-T6` | NOT VERIFIED — second-account/browser acceptance | Code-level coverage не заменяет изолированную second-account UI-проверку. | Доступна изолированная авторизованная browser среда. |
| 7 | `v6-N/ACCEPTANCE` | NOT VERIFIED — stale RAG browser scenario | Остаётся только приемка искусственно stale RAG badge; намеренно не создавался stale user content. | Разрешён изолированный synthetic scenario. |
| 8 | `attachments-and-message-menu/REGRESSION-VALIDATION` | BLOCKED — sandbox build resources | `pnpm build` ранее завершался SIGTERM в Vite chunk rendering; пользователь запретил повторный запуск без новых ресурсов. | Доступны достаточные sandbox build resources. |
| 9 | `v6-MEM/TESTS` | NOT VERIFIED — authenticated model and owner flows | Реальные T1–T11, login persistence и owner downloads требуют соответствующих сессий. | Стабильные user и owner sessions в browser runtime. |
| 10 | `v6-MEM/DROP-GATE` | BLOCKED — prerequisite acceptance | Legacy table нельзя удалять без четырёх реальных проверок и owner download gate. | Все условия legacy DROP gate отдельно пройдены. |
| 11 | `v6-MEM/VALIDATION` | PARTIALLY BLOCKED — browser/build | Code regressions выполнены; browser matrix и production build не подтверждены в доступной среде. | Browser runtime и build resources доступны. |
| 12 | `v6-MEM/OAUTH-OWNER-ACCEPTANCE` | BLOCKED — owner session | Запуск возможен только после явного подтверждения owner-сессии; его нет в текущем этапе. | Пользователь отдельно подтверждает готовую owner-сессию. |
| 13 | `v6-MEM/OAUTH-SESSION-ISOLATION` | DEFERRED — user instruction | Пользователь запретил возобновлять очистку/изоляцию OAuth browser session сейчас. | Новая отдельная команда на session troubleshooting. |
| 14 | `v6-MEM/OWNER-ACCEPTANCE-RUN` | BLOCKED — owner session | Нужны owner UI, T1–T11 и download checks; они не заменяются unit tests. | Стабильная owner-сессия и отдельный acceptance этап. |
| 15 | `AUDIT-USER/MEMORY` | NOT VERIFIED — safe isolated user session | Проверка требует временного neutral marker без открытия реальной истории. | Изолированный новый чат с надёжной session boundary. |
| 16 | `AUDIT-USER/ATTACHMENTS` | NOT VERIFIED — authenticated browser acceptance | Photo/PDF/vision matrix требует user browser session и temporary artifacts. | Изолированная user-сессия и отдельное разрешение на test artifacts. |
| 17 | `AUDIT-USER/PRIMARY-ACCOUNT-NEUTRAL-ACCEPTANCE` | PARTIALLY BLOCKED — hidden file input/session boundary | Браузер не привязался к hidden file input, а память и профиль не открывались во избежание real-content exposure. | Исправная controlled browser input/session environment. |
| 18 | `AUDIT-USER/TEMPORARY-MEMORY-MARKER-ACCEPTANCE` | BLOCKED — isolation failure | После neutral send отрисовалась существующая беседа; дальнейшие действия остановлены. | Надёжный isolated new-chat boundary. |
| 19 | `v6-P/MEMORY-CLEANUP` | DEFERRED — real-content safety | Допустима лишь точная очистка явно названных test facts/topics, но текущая среда не даёт безопасно подтвердить scope. | Явный список test records и изолированная session boundary. |
| 20 | `v6-P/ATTACHMENTS` | PARTIALLY BLOCKED — PDF/vision UI acceptance | Composer preview/remove и TXT path уже подтверждены; PDF card и vision browser acceptance не запускались. | Временный user чат и доступный file input. |
| 21 | `v6-P/MOBILE-OAUTH-SESSION` | DEFERRED — user instruction/platform behavior | Mobile OAuth/PWA flow не возобновляется в текущем этапе. | Отдельная задача после стабилизации platform mobile session. |
| 22 | `v6-P/ATTACHMENTS-ISOLATED-BROWSER-ACCEPTANCE` | PARTIALLY BLOCKED — PDF/vision UI acceptance | Базовый temporary attachment flow проверен, однако PDF/vision часть не подтверждена. | Изолированная authenticated browser среда. |
| 23 | `v6-P/ATTACHMENTS-PDF-VISION-ISOLATED-BROWSER` | BLOCKED — browser session and test artifact flow | Нужны temporary PDF/image, vision request и controlled deletion. | Разрешённый isolated acceptance run. |
| 24 | `v6-P/AUTHORIZED-USER-ACCEPTANCE-RUN` | DEFERRED — user instruction | Пользователь выбрал не возобновлять browser/OAuth/owner приёмки в текущем этапе. | Отдельное явное поручение после готовности среды. |

## Внешние health ограничения, не относящиеся к multi-user authorization

Полный `pnpm test` затронут двумя внешними provider-health assertions: Groq catalog и Tavily вернули HTTP 403. Это не изменяет server-side authorization или export scope. Детерминированный набор с исключением этих assertions прошёл: **49 files, 244 tests; 1 file / 4 tests skipped**.

## Непрерывные ограничения

До отдельного этапа нельзя использовать этот реестр как основание для удаления `chat_exports`, ослабления `protectedProcedure`/`adminProcedure`, изменения `OWNER_OPEN_ID`, создания второй auth-системы или проверки реального пользовательского контента. Реестр предназначен только для прозрачного учёта внешних зависимостей и границ приёмки.
