# WEB-GROUNDED V1 — минимальный published smoke (2026-08)

## Граница проверки

В опубликованном Kairema выполнен ровно один короткий неперсональный запрос с явным требованием актуального web-источника через Flash. Никакие private memory, attachments, export/history listings, настройки, реальные user resources, вторые identity, load scenarios или дополнительные generation/search запросы не открывались и не использовались.

## Наблюдение

Запрос перешёл в streaming и завершился с видимой пользователю специальной информацией, что проверяемые свежие источники недоступны. Ответ не выдал неподтверждённый current факт и не показал выдуманные citations. Это соответствует safe `SEARCH_REQUIRED` failure UX, а не успешному web-grounded source result.

## Статус evidence

| Проверка | Статус | Граница вывода |
|---|---|---|
| Published stream для controlled request | PASS | Один Flash request завершён. |
| SEARCH_REQUIRED truthful degradation | PASS | Нет fabricated current claim при отсутствии actual sources. |
| User-visible unavailable state | PASS | UI отличает отсутствие свежих источников от обычного ответа. |
| Live actual citations/source cards | UNVERIFIED | В этом единственном request actual source result не был доступен; дальнейший traffic не запускался. |
| Other roles / load / provider recovery | UNVERIFIED | Исключены из минимального smoke. |

Никакой capacity или provider availability claim из этого smoke не следует.
