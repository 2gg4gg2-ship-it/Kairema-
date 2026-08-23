# Kairema v6-MEM — фактический статус пользовательской приёмки

**Дата обновления:** 2026-08-23  
**Основание:** опубликованные browser-проверки, unit/component/integration-регрессии и существующий подробный live journal `v6-mem-live-run-notes.md`.  
**Защита данных:** этот отчёт не содержит OAuth ID, токенов, URL вложений, содержимого сообщений, содержимого памяти или raw provider errors.

> **Итог на данный момент: v6-MEM ПОЛЬЗОВАТЕЛЬСКАЯ ЧАСТЬ НЕ ЗАКРЫТА.**
>
> Причины: поздняя controlled published vision-проверка уже дала PASS, но T4 и T6 не имеют полного PASS. Owner-only часть дополнительно блокирована отсутствующей платформенной production-настройкой owner claim. Никакой исторический FAIL не удаляется и не маскируется формулировкой PASS.

## Пользовательская память

| Пункт | Фактический статус | Подтверждение | Примечание |
|---|---|---|---|
| T1: факт/тема из одного чата доступны в новом чате и ролях | **PASS** после повторной проверки | Published browser evidence; повторная durable extraction проверка | Ранняя неуспешная проверка из-за очереди extraction сохранена в live journal как исторический факт. |
| T2: общая память Flash → Think | **PASS** | Published browser evidence | Подтверждён общий user-scoped memory context. |
| T3: общая память доступна Context | **PASS** | Published browser evidence | Подтверждено без переноса содержимого memory entries в evidence. |
| T4: поиск/фильтры Memory UI | **FAIL** | Browser evidence и regression Russian inflection matcher | Поиск «Луна» исправлен и проходит, но контроль очистки/фильтрации выявил дополнительные independently-created lunar topic entries; результат полного T4 не может быть объявлен PASS. |
| T5: сохранение профиля и refresh | **PASS WITH UI CAVEAT** | Published browser Save; refresh browser observation | Сохранение профиля подтверждено. После refresh первоначально кратко отображается неавторизованный UI, затем сессия и история восстанавливаются без нового OAuth. Полный logout/login не выполнялся. |
| T6: изоляция между разными пользователями | **NOT VERIFIED** | Server ownership tests существуют | Второй реальный OAuth-пользователь для browser-приёмки не использовался; server-only tests не являются её заменой. |
| Search/filters и memory switches | **PASS** для подтверждённых UI действий | Published browser evidence | Поиск по русской форме, filter UI и восстановление включённого memory switch подтверждены; записи при отключении memory не удалялись в проверяемом UI flow. |

## Вложения и vision

| Пункт | Фактический статус | Подтверждение | Примечание |
|---|---|---|---|
| Composer thumbnail | **PASS** | Published neutral-image browser check | Перед отправкой отображается preview; в evidence не сохранены байты, имя, URL или текст запроса. |
| Protected temporary delete | **PASS** | Published browser check | Удаление доступно только для текущего composer attachment и после удаления preview/control исчезают. |
| Sent-bubble thumbnail при provider failure | **PASS** | Published retest после `bd263b3c` | Исправлена hydration race между persisted message и attachment query; браузер подтвердил preview в user bubble при безопасной provider failure. |
| Live vision answer | **PASS** | Controlled neutral-image published acceptance, 2026-08-23 | Composer preview, sent-bubble preview и image-aware assistant answer получены в обычной authenticated session. В evidence не сохранены байты, имя, URL, prompt, answer text или provider chain. Ранние Context/Apex availability failures остаются историческим evidence, но не являются последним фактом. |

## Роли, controls и RAG

| Пункт | Фактический статус | Подтверждение | Примечание |
|---|---|---|---|
| Четыре публичные роли и честные ROLE CAPABILITIES | **PASS** | Published role dropdown check | В UI остаются ровно Flash, Think, Context и Apex; описания открываются целиком. Flash не обещает сложный код или исследовательские таблицы. |
| Выборочное копирование | **PASS** | Published native Selection API/`user-select` check | Стандартное выделение текста сообщения не блокируется; содержание сообщений не извлекалось. |
| Switch: устойчивое конечное положение | **PASS** | Published retest после `eecdb55b` | Checked root/thumb имеют `data-state=checked`; computed CSS показывает `translate: 16px`. Исходное enabled состояние возвращено. |
| Dropdown: closed value и полные описания при открытии | **PASS** | Published browser role-dropdown check | Выбранное значение отображается в закрытом состоянии, а описания в открытом не обрезаются. |
| RAG Audit для не-владельца | **PASS** | Published non-owner browser check | Нет кликабельных источников/URL, raw query/answer content и owner aggregate export controls. |

## Owner-only и platform-blocked gates

| Пункт | Статус | Причина | Безопасное действие |
|---|---|---|---|
| Owner analytics | **BLOCKED by platform** | Published hash-only diagnostic: configured owner claim отсутствует в production runtime; session fingerprint не сопоставляется с `not-configured`. | Ожидать восстановления системного `OWNER_OPEN_ID` платформой; guard не ослаблять и не заменять ролью admin. |
| Export metrics CSV/JSON | **BLOCKED by platform** | Требует корректного owner guard. | Проверить после platform fix. |
| Owner Markdown/PDF browser-download gate | **BLOCKED by platform** | Owner acceptance нельзя подтвердить до восстановления mapping. | Проверить после platform fix. |
| `DROP TABLE chat_exports` | **BLOCKED / PROHIBITED** | User gates не все PASS; strict historical grep уже не проходит из-за неизменяемой истории миграций. | Не выполнять DROP и не переписывать историю. |

## Расхождение отчёта и факта

| Предварительное ожидание или отчёт | Фактическое наблюдение | Корректирующее действие |
|---|---|---|
| Source-level regression утверждала сохранение sent-bubble preview после provider failure. | Первая published Apex проверка показала отсутствие preview после hydration. | Добавлен scoped fallback и invalidation attachment query; новая regression покрыла hydration race; опубликованный retest подтвердил PASS. |
| Первая поправка switch прошла unit/integration tests. | Browser probe не показал конечную геометрию thumb. | Введён explicit production CSS root-state → thumb; после `eecdb55b` browser подтвердил `translate: 16px`. |
| Attachment preview создавал впечатление готовности vision. | Ранние Context/Apex attempts не дали vision answer из-за provider/model endpoint availability, но поздний controlled neutral-image published flow дал image-aware answer. | Composer/sent preview и vision answer остаются раздельными критериями; исторические availability failures сохранены, а текущий live vision status обновлён до PASS по более позднему browser факту. |
| Владелец проекта ожидался доступным в owner analytics. | Hash-only production diagnostic показал `configured=false`, не claim mismatch. | Guard сохранён строгим; необходима platform configuration repair, а не role-based обход. |

## Доступные доказательства

Подробная хронология и ссылки на локальные screenshot artifacts находятся в `reports/evidence/v6-mem-live-run-notes.md`. Ключевые подтверждения включают published switch PASS после `eecdb55b`, sent-bubble preview PASS после `bd263b3c`, memory/profile/control checks, исторический vision FAIL и поздний controlled published vision PASS. Артефакты не содержат секретов в тексте этого отчёта.

## Следующие обязательные шаги

1. Восстановить системный production owner claim через платформенную поддержку, не передавая raw OAuth ID в код, БД или чат.
2. После восстановления mapping повторить owner analytics, metric export, owner download, T1–T11 и все DROP prerequisites.
3. Выполнить T6 под безопасно авторизованным вторым пользователем либо оставить его **NOT VERIFIED**.
4. Не использовать финальную формулировку о закрытии v6-MEM, пока каждая обязательная строка не имеет PASS.
