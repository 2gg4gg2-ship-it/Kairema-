# v6-MEM — журнал повторной live-приёмки

## Повтор T1 после hotfix `3ab6d469`

| Время (UTC) | Действие | Наблюдение | Статус | Скриншот |
|---|---|---|---|---|
| 2026-08-22 07:55 | Открыт опубликованный домен в сохранённой OAuth-сессии | Доступны история, память, настройки и четыре роли; экран не показывает форму входа | PASS: owner session доступна | `kairema-ai-gxujplkn__2026-08-22_07-55-45_9546.webp` |
| 2026-08-22 07:55 | В выбранном Flash отправлен новый source-turn о размере Луны | Пользовательское сообщение принято; во время фиксации заметки streaming ещё продолжался | IN PROGRESS | `kairema-ai-gxujplkn__2026-08-22_07-55-55_5759.webp` |
| 2026-08-22 07:56 | Завершение source-turn и открытие UI памяти | Flash дал краткий ответ, но раздел «Темы диалогов» показывает `0/100` и пустое состояние. Автоматическое извлечение темы не подтверждено. | **FAIL** | `kairema-ai-gxujplkn__2026-08-22_07-56-10_8411.webp`, `kairema-ai-gxujplkn__2026-08-22_07-56-16_5111.webp` |

> Предыдущий T1 FAIL не заменяется этой записью. Повтор T1 после `3ab6d469` также завершился **FAIL** до этапа Apex retrieval. Дальнейшие T1–T11 и DROP gate остановлены; требуется новая безопасная диагностика worker production path.

## Новый повтор T1 после fallback hotfix `6fa1fd75`

| Время (UTC) | Действие | Наблюдение | Статус | Скриншот |
|---|---|---|---|---|
| 2026-08-22 08:00 | Открыт опубликованный домен в сохранённой OAuth-сессии и отправлен новый Flash source-turn «Какого размера Луна? Ответь кратко и точно.» | Flash завершил ответ «Диаметр ≈ 3 474,8 км». Это подтверждает только source-turn; наличие автоматической темы ещё не проверено. | IN PROGRESS | `kairema-ai-gxujplkn__2026-08-22_08-00-40_2154.webp`, `kairema-ai-gxujplkn__2026-08-22_08-00-46_7862.webp` |
| 2026-08-22 08:01 | Открыт раздел «Память» до retrieval в другой роли | UI показывает `Темы диалогов 1/100` и запись `2026-08-22 Flash: размер луны`. Новый source-turn создал автоматическую тему. | PASS: T1 source-topic | `kairema-ai-gxujplkn__2026-08-22_08-01-06_3341.webp` |
| 2026-08-22 08:01–08:02 | Создан отдельный новый чат в роли Apex и отправлен retrieval-вопрос о сохранённой теме и роли-источнике | До отправки Apex чат показывал стартовый экран без сообщений. Завершённый ответ: «Сохранена тема „размер луны“. Роль: Flash.» | PASS: T1 cross-role retrieval | `kairema-ai-gxujplkn__2026-08-22_08-01-42_5089.webp`, `kairema-ai-gxujplkn__2026-08-22_08-02-12_8463.webp` |
| 2026-08-22 08:03 | Создан отдельный Think чат и отправлен вопрос «Что я спросил у Flash в предыдущем диалоге?» | Завершённый Think ответ перечислил сохранённые обращения к Flash, включая «Луна: диаметр», «Луна: размер и характеристики» и «размер луны». | PASS: T2 cross-role retrieval | `kairema-ai-gxujplkn__2026-08-22_08-02-55_6952.webp`, `kairema-ai-gxujplkn__2026-08-22_08-03-30_5368.webp` |
| 2026-08-22 08:03–08:04 | Создан отдельный Context чат и отправлен вопрос «Как меня зовут?» | Завершённый ответ: «Вас зовут Александр — так указано в моей памяти о вас.» | PASS: T3 saved profile | `kairema-ai-gxujplkn__2026-08-22_08-03-51_1241.webp`, `kairema-ai-gxujplkn__2026-08-22_08-04-02_6107.webp` |
| 2026-08-22 08:04 | Создан отдельный Context чат и отправлен вопрос «Какую тему я недавно обсуждал с Flash?» | Завершённый Context ответ: «тему Луны — её размер, диаметр и характеристики». | PASS: T11 Context sharing Flash topic | `kairema-ai-gxujplkn__2026-08-22_08-04-16_8042.webp`, `kairema-ai-gxujplkn__2026-08-22_08-04-29_8703.webp` |
| 2026-08-22 08:04 | В Memory UI введён обязательный поисковый запрос «Луна». | При имеющейся теме `Flash: размер луны` интерфейс вывел «Поиск не дал совпадений» и в Facts, и в Topics. | FAIL (preliminary): T4 search — точный acceptance query не проходит; удаление темы и follow-up отложены до исправления. | `kairema-ai-gxujplkn__2026-08-22_08-04-52_8350.webp` |

## Состояние после T4 hotfix `137a4d5d`

| Время (GMT+3) | Действие | Наблюдение | Статус | Скриншот |
|---|---|---|---|---|
| 2026-08-22 08:08 | Повторно открыт published domain для T4 follow-up | UI показывает «Войдите, чтобы начать чат с Kairema» и «Войти для истории»: owner OAuth cookie в текущей browser-сессии отсутствует. T4 browser follow-up, analytics, attachments/vision, exports, logout/login и DROP gate не запускались. | NOT VERIFIED: owner session unavailable | `kairema-ai-gxujplkn__2026-08-22_08-08-00_1570.webp` |
| 2026-08-22 08:10 | Owner session восстановлена; в Memory UI повторён обязательный поиск `Луна` | Результаты содержат facts и dialog topics, включая `Flash: Луна: диаметр`, `Flash: Луна: размер и характеристики`, `Flash: Луна — диаметр`. Тема «размер луны» находит совпадения через нормализацию окончания. | PASS: T4 search follow-up | `kairema-ai-gxujplkn__2026-08-22_08-10-36_9664.webp` |
| 2026-08-22 08:10 | При активном поиске `Луна` выбран фильтр «Факты памяти», затем «Темы» | В facts разделе отображаются только соответствующие facts, а topics показывают «Поиск не дал совпадений»; при выборе topics факты пусты, отображаются только четыре найденные dialog topics. | PASS: T4 filter isolation | `kairema-ai-gxujplkn__2026-08-22_08-10-51_1470.webp`, `kairema-ai-gxujplkn__2026-08-22_08-10-58_2982.webp` |
| 2026-08-22 08:11 | В topics уточнён поиск `размер луны` для точечной очистки | Показаны три темы: Think, Apex и Flash. Для удаления выбран только Flash test topic; операция ещё не подтверждена и пока не засчитывается. | IN PROGRESS: T4 delete/follow-up | `kairema-ai-gxujplkn__2026-08-22_08-11-23_4109.webp` |
| 2026-08-22 08:12 | Удалена точная `Flash: размер луны` topic в поиске `размер луны` | Счётчик topics изменился с 9/100 до 8/100; в результатах остались только `Think: Размер Луны` и `Apex: размер луны`. Flash test topic отсутствует. | PASS: T4 targeted delete | `kairema-ai-gxujplkn__2026-08-22_08-12-14_6655.webp` |
| 2026-08-22 08:13 | Independent Apex follow-up after targeted Flash topic deletion | Новый Apex чат заявил, что в памяти остаются три темы Flash о Луне, включая «Луна: размер и характеристики» и «Луна — диаметр». Следовательно требование T4 «follow-up must not claim it from memory» не подтверждено. Другие owner-записи не удалялись. | FAIL: T4 follow-up | `kairema-ai-gxujplkn__2026-08-22_08-13-07_7959.webp` |
| 2026-08-22 08:13 | Memory UI inspection after T4 follow-up | UI показывает 8 topics, среди них `Flash: Луна: диаметр`, `Flash: Луна: размер и характеристики` и `Flash: Луна — диаметр`; также отображаются acceptance facts `Луна`, `размер, диаметр и характеристики Луны` и `3 474,8 км`. Это подтверждает наличие отдельных связанных test entries после точечного удаления, а не исчезновение записи из UI. | Evidence for T4 FAIL | `kairema-ai-gxujplkn__2026-08-22_08-13-30_1263.webp` |

## T5 — refresh persistence

| Время (GMT+3) | Действие | Наблюдение | Статус | Скриншот |
|---|---|---|---|---|
| 2026-08-22 08:15 | Published URL открыт повторно в активной owner browser-сессии | Показан экран `Войдите, чтобы начать чат с Kairema`; левый раздел истории заменён на `Войти для истории`, а все роли показывают `Ответов пока нет`. | **FAIL: T5 refresh persistence** — owner OAuth cookie не пережила refresh. Logout/login, T6–T10, attachments/vision, analytics и real export click-through после этого refresh не запускались. | `kairema-ai-gxujplkn__2026-08-22_08-15-07_7088.webp` |

| 2026-08-22 08:17 | Повторный refresh с ожиданием завершения auth/history queries | Сразу после reload был тот же краткий unauth-placeholder, но без нового OAuth-входа через ~5 секунд восстановились owner history, выбранный Flash чат, модельный статус и memory-dependent ответ. | **T5 refresh persistence PASS с UI-оговоркой:** cookie/session сохраняется, но initial loading state ошибочно выглядит как signed-out. Полная часть T5 — контролируемый logout/login — ещё не выполнена. | `kairema-ai-gxujplkn__2026-08-22_08-17-01_8665.webp`, `kairema-ai-gxujplkn__2026-08-22_08-17-06_3378.webp` |

## T7 — отключение использования памяти без удаления

| Время (GMT+3) | Действие | Наблюдение | Статус | Скриншот |
|---|---|---|---|---|
| 2026-08-22 08:17–08:18 | В Memory UI выключен `Включить память`; в отдельном новом Flash чате задан вопрос о имени только из сохранённой памяти | Switch был выключен до отправки. Flash завершил ответом: «Я не знаю вашего имени — у меня нет сохранённой памяти о вас.» Существующие записи не удалялись. | PASS: T7 no retrieval when disabled | `kairema-ai-gxujplkn__2026-08-22_08-17-58_3181.webp`, `kairema-ai-gxujplkn__2026-08-22_08-18-07_4951.webp` |
| 2026-08-22 08:18 | В Memory UI повторно включён `Использовать память в ответах` | Факты и темы всё ещё отображаются (`14/30`, `9/100`); тестовое выключение не удалило записи и настройка восстановлена. | PASS: T7 restoration | `kairema-ai-gxujplkn__2026-08-22_08-18-39_7520.webp` |

## T8 — отключение automatic extraction

| Время (GMT+3) | Действие | Наблюдение | Статус | Скриншот |
|---|---|---|---|---|
| 2026-08-22 08:19 | В Memory UI выключен `Автоматически извлекать новые факты`; `Использовать память в ответах` остаётся включённым | Memory dialog закрыт после смены только auto-extract setting. До meaningful source-turn и итоговой проверки счётчиков. | В процессе | `kairema-ai-gxujplkn__2026-08-22_08-19-06_9763.webp`, `kairema-ai-gxujplkn__2026-08-22_08-19-12_6523.webp` |
| 2026-08-22 08:19 | В отдельном Flash chat отправлена тема `полярная комета amber-482`; Flash ответил о хвостах комет | Source-turn завершён. `autoExtract` всё ещё выключен; проверка отсутствия новой темы/факта и восстановление настройки следуют далее. | В процессе | `kairema-ai-gxujplkn__2026-08-22_08-19-39_5381.webp` |
| 2026-08-22 08:19 | Memory UI открыт после source-turn | Счётчики показывают `14/30` фактов и `9/100` тем; в видимых списках marker `amber-482` отсутствует. Для точной проверки будет применён локальный поиск. | В процессе | `kairema-ai-gxujplkn__2026-08-22_08-19-54_4639.webp` |
| 2026-08-22 08:20 | Точный Memory UI поиск `amber-482` | В обоих разделах показано «Поиск не дал совпадений» при неизменных `14/30` фактах и `9/100` темах. Это подтверждает: выключенный auto-extract не добавил marker. Затем выполнен restore-click `Автоматически извлекать новые факты`; визуальная верификация состояния следует отдельно. | PASS (создание новых automatic entries) | `kairema-ai-gxujplkn__2026-08-22_08-20-09_9860.webp`, `kairema-ai-gxujplkn__2026-08-22_08-20-15_1047.webp` |
| 2026-08-22 08:20 | Проверено состояние auto-extract после restore-click | Доступный switch вернул `aria-checked: true`, `data-state: checked`. Owner-настройка восстановлена. | PASS (restore) | `console_outputs/exec_result_2026-08-22_08-20-34_902.txt` |
| 2026-08-22 08:21 | Подготовка attachment acceptance | В composer обнаружено accept-only поле выбора временного вложения: `image/png,image/jpeg,image/webp,application/pdf,text/plain,text/markdown,.md`. Подготовлен локальный безопасный PNG; upload ещё не выполнен. | В процессе | `console_outputs/exec_result_2026-08-22_08-21-33_161.txt` |
| 2026-08-22 08:24 | Temporary image upload завершён без отправки сообщения | Composer показывает thumbnail/preview `v6-mem-attachment-test.png`, отдельную кнопку `Убрать вложение` и статус «Загрузка завершена: 1 файл(а).» | PASS: composer preview; sent bubble, vision и delete callback ещё не проверены | `kairema-ai-gxujplkn__2026-08-22_08-24-09_9158.webp` |
| 2026-08-22 08:25 | Первая image/vision попытка в Flash | После отправки вопроса Flash вернул: «Недоступно … Провайдер отклонил модель или endpoint». Поэтому vision-ответ не подтверждён. На видимом user bubble отдельная image-card также не наблюдалась; это нельзя считать PASS без отдельного успешного evidence. | FAIL: vision; NOT VERIFIED: sent-bubble preview | `kairema-ai-gxujplkn__2026-08-22_08-24-48_7948.webp` |
| 2026-08-22 08:26 | Повторная Think image attempt: upload до отправки | В новом Think чате единственная загрузка `v6-mem-attachment-test.png` завершилась: UI показал thumbnail/preview и отдельную protected кнопку `Убрать вложение`. Сообщение ещё не отправлялось. | PASS: composer preview / remove control; IN PROGRESS: sent bubble и vision | `kairema-ai-gxujplkn__2026-08-22_08-26-24_2238.webp` |
| 2026-08-22 08:27 | Повторная Think image/vision attempt | Отправленный image-only вопрос завершился ответом `Недоступно … Провайдер отклонил модель или endpoint`. Composer-status всё ещё показывает `Загрузка завершена: 1 файл(а)`, но отдельная image-card в отправленном bubble не наблюдалась. | FAIL: vision; NOT VERIFIED: sent-bubble preview; composer preview остаётся PASS | `kairema-ai-gxujplkn__2026-08-22_08-27-33_4180.webp` |

### Attachment temporary preview and protected delete

| Время (GMT+3) | Действие | Наблюдение | Статус | Скриншот |
|---|---|---|---|---|
| 2026-08-22 08:30 | В текущий пустой Context chat загружен один допустимый WEBP | Composer показал thumbnail и доступную кнопку `Убрать вложение` именно для вложения текущего чата. | PASS: scoped composer preview | `kairema-ai-gxujplkn__2026-08-22_08-30-04_4434.webp` |
| 2026-08-22 08:30 | Нажата `Убрать вложение` до отправки | Thumbnail и remove control исчезли. Служебное сообщение «Загрузка завершена: 1 файл(а)» осталось, но не является preview и не даёт отправить удалённый файл. | PASS: protected temporary delete | `kairema-ai-gxujplkn__2026-08-22_08-30-10_1341.webp` |

> Composer preview и protected delete подтверждены. Sent-bubble preview остаётся **NOT VERIFIED**, а реальный vision-answer — **FAIL**: обе изолированные попытки Flash/Think достигли provider error уже после успешного composer preview.

### Owner analytics route

| Время (GMT+3) | Действие | Наблюдение | Статус | Скриншот |
|---|---|---|---|---|
| 2026-08-22 08:31 | Открыт прямой published route `/owner-analytics` | Страница показала `Аналитика недоступна` и owner guard вместо 7d/24h графиков и кнопок CSV/JSON. | FAIL: owner analytics acceptance | `kairema-ai-gxujplkn__2026-08-22_08-31-09_6975.webp` |
| 2026-08-22 08:33 | Выполнена privacy-safe same-session проверка auth/owner flags | `authHttp: 200`, `authenticated: true`, `ownerHttp: 200`, `owner: false`; идентификаторы, тексты чатов и токены не читались и не сохранялись. | FAIL: owner authorization не установлена; guard намеренно не ослаблялся | `console_outputs/exec_result_2026-08-22_08-33-34_242.txt` |

### Published owner claim diagnostic after current OAuth login

| Время (GMT+3) | Действие | Наблюдение | Статус | Скриншот |
|---|---|---|---|---|
| 2026-08-22 09:00 | После подтверждённого OAuth-входа открыт published `/owner-analytics` версии `6bcd28d3` | Self-scoped diagnostic сравнил claim `openId`; configured mapping отсутствует, expected fingerprint `not-configured`, fingerprint текущей сессии `sha256:048f7ce8deb5`, `matches: false`. Реальные IDs, JWT, токены, сообщения и метрики не отображались. | **FAIL: production owner mapping не настроен**; это не client cache и не основание ослаблять guard | `kairema-ai-gxujplkn__2026-08-22_09-00-45_2420.webp` |

> Причина отказа установлена на server-authoritative published path: `OWNER_OPEN_ID` не доступен production runtime. Код сравнения `ctx.user.openId === ENV.ownerOpenId` не изменён. Исправление требует поддерживаемой настройки системного owner claim на платформе; нельзя безопасно вывести raw OAuth claim в UI, evidence, БД или логи и нельзя заменить guard на роль `admin`.

### User-scoped memory controls after attachment session fix

| Время (GMT+3) | Действие | Наблюдение | Статус | Скриншот |
|---|---|---|---|---|
| 2026-08-22 09:12 | Открыт published диалог «Память» версии `766248cb` в авторизованной обычной пользовательской сессии | Показаны отдельные editable profile, facts и dialog topics; счётчики находятся в заявленных FIFO-пределах (`15/30`, `10/100`). Два доступных switch имеют отдельные privacy-safe объяснения: отключение памяти не удаляет записи, отключение auto extract останавливает только новые автоматические записи. Содержание profile/facts/topics не внесено в evidence. | PASS: user memory UI structure and control semantics | `kairema-ai-gxujplkn__2026-08-22_09-12-05_5759.webp` |
| 2026-08-22 09:12 | Проверены search input и закрытые-value filters | Видны user-scoped `Все`, `Факты памяти`, `Темы` и поле поиска без owner analytics. Русская нормализация обязательного поиска уже покрыта pure regression. | PASS: memory search/filter controls available to ordinary user | `kairema-ai-gxujplkn__2026-08-22_09-12-05_5759.webp` |
| 2026-08-22 09:13 | Нажата «Сохранить» для существующего profile memory без изменения текста | UI перешёл `Сохраняем…` → `Память сохранена`; profile-save mutation завершилась без ошибки. Текст профиля не повторяется в evidence. | PASS: profile save | `kairema-ai-gxujplkn__2026-08-22_09-13-49_6222.webp`, `kairema-ai-gxujplkn__2026-08-22_09-13-53_6130.webp` |
| 2026-08-22 09:12 | Временно выключен и немедленно восстановлен switch использования памяти | `aria-checked` сменился на `false`, затем вернулся к `true`; автоматическое извлечение осталось `true`. Записи памяти не удалялись. | PASS: switch persistence and restore | `console_outputs/exec_result_2026-08-22_09-12-42_976.txt`, `console_outputs/exec_result_2026-08-22_09-12-54_601.txt` |
| 2026-08-22 09:14 | Открыт role dropdown в опубликованной обычной пользовательской сессии | В закрытом trigger видно текущее значение `Kairema Flash`; раскрытое `menu` содержит ровно четыре `menuitemradio` с полными различающимися описаниями. Flash описан только как «Короткие повседневные ответы без ожидания», без обещания сложного кода или исследовательских таблиц; сложные и контекстные задачи зарезервированы для Think/Context/Apex. | PASS: honest role capabilities and complete open dropdown descriptions | `kairema-ai-gxujplkn__2026-08-22_09-14-24_8038.webp`, `kairema-ai-gxujplkn__2026-08-22_09-14-31_9969.webp` |
| 2026-08-22 09:15 | Начата повторная vision-приёмка в новом Context chat с нейтральным PNG | Context выбран и видит `Резерв активен`; первая попытка browser upload не дошла до file input, поскольку доступным элементом был button-trigger. Это не provider result и не меняет прежний FAIL vision. | IN PROGRESS: повторная vision attempt | `kairema-ai-gxujplkn__2026-08-22_09-14-57_3275.webp`, `kairema-ai-gxujplkn__2026-08-22_09-15-01_9320.webp` |
| 2026-08-22 09:15 | Проверка штатного attachment input для повторной vision-приёмки | В DOM присутствует один file input, допускающий только PNG/JPEG/WEBP/PDF/TXT/Markdown. Для автоматизированной приёмки он временно сделан browser-accessible; код приложения, accept-policy и данные не менялись. | PASS: attachment input policy confirmed; live provider response pending | console record `exec_result_2026-08-22_09-15-25_892.txt` |
| 2026-08-22 09:16 | Открыт «Аудит RAG» в опубликованной обычной сессии | Показаны только privacy-safe label/domain, число фрагментов, проверка и state для разрешённых RSS-источников; в UI отсутствуют clickable URL, raw source links, пользовательские query/ответы и owner aggregate export controls. | PASS: non-owner RAG audit remains link-free and aggregate-safe | `kairema-ai-gxujplkn__2026-08-22_09-16-04_7513.webp` |
| 2026-08-22 09:16 | Browser-only preparation for neutral attachment upload | Штатный input временно показан в текущем browser DOM так, чтобы automation мог выбрать файл; accept-policy остаётся ограниченной, приложение и опубликованный код не менялись. | IN PROGRESS: enable neutral upload automation only | `kairema-ai-gxujplkn__2026-08-22_09-16-33_4459.webp`, console record `exec_result_2026-08-22_09-16-28_110.txt` |
| 2026-08-22 09:16 | Neutral image composer preview | Нейтральный PNG успешно прошёл штатную временную загрузку: визуальная thumbnail, protected preview action и remove control появились в активном composer; status сообщает об одном завершённом файле. Адрес временного файла и его данные не сохранялись в evidence. | PASS: composer thumbnail and protected current-composer controls | `kairema-ai-gxujplkn__2026-08-22_09-16-54_9336.webp` |
| 2026-08-22 09:17 | Sent neutral vision request | В Context отправлен минимальный нейтральный запрос с image attachment. Пузырь пользователя сформирован, интерфейс показал state генерации и control отмены; не сохраняются текст запроса, временный URL или содержимое изображения. | IN PROGRESS: sent state observed; final vision result pending provider | `kairema-ai-gxujplkn__2026-08-22_09-17-15_9624.webp` |
| 2026-08-22 09:17 | Neutral Context vision result | Генерация завершилась безопасным публичным сообщением о недоступности provider/model endpoint. В UI не возник успешный vision-answer; thumbnail ранее подтверждена только в composer. Технические endpoint details, message text и адрес вложения не включены. | FAIL: live vision response; sent-bubble preview remains NOT VERIFIED on failed request | `kairema-ai-gxujplkn__2026-08-22_09-17-28_9689.webp` |
