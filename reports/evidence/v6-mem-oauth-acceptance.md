# Kairema v6-MEM — авторизованная owner-приёмка

Дата проверки: 22 августа 2026, GMT+3. Проверка выполняется только после явного пользовательского подтверждения «ВОШЁЛ КАК ВЛАДЕЛЕЦ».

| Проверка | Статус | Фактическое наблюдение | Evidence |
| --- | --- | --- | --- |
| OAuth return в Kairema | PASS (сессия приложения) | Browser находится на опубликованном `kairema-ai-gxujplkn.manus.space`, показаны история, четыре роли и controls Markdown/PDF. Это подтверждает авторизованный возврат в приложение; owner-only route будет проверен отдельно. | `/home/ubuntu/screenshots/kairema-ai-gxujplkn__2026-08-22_07-14-45_6943.webp` |
| Memory UI: факт и поиск | PASS | Владелец добавил обратимый факт `Приёмочный маркер v6-MEM: cobalt-917`; счётчик вырос с 1/30 до 2/30, встроенный search по `cobalt-917` вернул только этот факт. | `/home/ubuntu/screenshots/kairema-ai-gxujplkn__2026-08-22_07-15-38_7398.webp` |
| T1 source turn | PASS (этап источника) | В новом чате роли Flash отправлен осмысленный вопрос «Какого размера Луна?», получен полный ответ: `Диаметр Луны составляет примерно 3 474 километра.` | `/home/ubuntu/screenshots/kairema-ai-gxujplkn__2026-08-22_07-16-48_4290.webp` |
| T1 — межчатовая/межролевая тема | FAIL | Source Flash turn прошёл, но новый Think chat ответил, что в прошлых беседах нет сведений о размере Луны. Владелец открыл Memory dialog: `Темы диалогов 0/100`. Предметный ответ не является доказательством retrieval, а явное отрицание и нулевой topic list ему противоречат. | `/home/ubuntu/screenshots/kairema-ai-gxujplkn__2026-08-22_07-17-43_8099.webp`; `/home/ubuntu/screenshots/kairema-ai-gxujplkn__2026-08-22_07-17-59_3711.webp` |
| T2–T11 memory | PENDING | Реальные проверки будут выполняться и фиксироваться по отдельным критериям. T1 FAIL уже исключает итоговый PASS релиза и DROP. | — |
| Profile save | PASS | Нажатие «Сохранить» завершилось toast `Память сохранена`; профиль оставлен без изменения. | `/home/ubuntu/screenshots/kairema-ai-gxujplkn__2026-08-22_07-16-02_4871.webp` |
| Temporary attachment preview / vision | PENDING | Не запускались. | — |
| Markdown/PDF downloads | PENDING | Не запускались. | — |
| Owner analytics | PENDING | Не запускалась. | — |
| DROP gate | PENDING | Не переоценивался после owner return. | — |

> Никакой вывод о завершении v6-MEM или физическом `DROP TABLE chat_exports` до фиксации всех обязательных gate не делается.
