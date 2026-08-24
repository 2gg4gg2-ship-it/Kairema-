# Kairema v6-R — source/test и delivery report

**Дата:** 24 августа 2026, UTC  
**Опубликованный checkpoint:** `08945dc2`  
**Область проверки:** source/test, production build, агрегированные provider health-сигналы и публичная unauthenticated delivery. Ни история, ни память, ни профиль, ни вложения, ни OAuth-параметры, ни cookies не открывались и не записывались.

> v6-R **не может быть объявлена закрытой по живой пользовательской приёмке**: canonical hostname не обслуживает Kairema, а доступный project hostname на момент проверки ещё отдаёт предыдущий bundle. Ни один из этих фактов не является подтверждением того, что пользовательский UI прошёл проверку.

## Результаты по багам

| Баг / требование | Что изменено и проверено в source/test | Публичная живая проверка | Статус |
|---|---|---|---|
| Свежий web search | Для fresh/current запроса минимум один источник должен иметь provider-supplied дату публикации. Недатированные результаты больше не считаются подтверждёнными; в безопасный UI status передаётся `freshnessBlocked`, а интерфейс показывает «Живой поиск недоступен». System context запрещает выдавать неподтверждённые сведения как актуальные. | Требует авторизованного вопроса «последние новости ИИ»; не выполнен из-за delivery/session ограничений. | **SOURCE/TEST PASS; NOT VERIFIED BY PLATFORM DELIVERY/SESSION** |
| Provider chain | Сохранён ограниченный active cascade You → Serper → Exa и существующее ограничение попыток; Google и Tavily не добавлялись в active cascade. RAG остаётся только дополнительным контекстом, не заменой live sources. | Агрегированный server-side probe выполнен без payload/ключей; см. таблицу ниже. | **PASS (diagnostics)** |
| Мгновенный cross-chat recall | Topic extraction остаётся завершённым до SSE `done`; Home invalidates список чатов на завершении. Фокусные context/stream/Home регрессии прошли. | Создание темы «Солнце» и немедленный новый чат не выполнялись, чтобы не обходить остановленную platform session. | **SOURCE/TEST PASS; NOT VERIFIED BY PLATFORM SESSION** |
| Удаление вложения до отправки | В composer предусмотрена отдельная доступная верхняя правая кнопка удаления с понятной подписью. | Нужен авторизованный attach/tap; не выполнялся. | **SOURCE/TEST PASS; NOT VERIFIED BY PLATFORM SESSION** |
| Компактные изображения | Composer и sent bubble используют 64px geometry (в диапазоне 56–72px); sent thumbnail сохраняет tap-to-full-view. Регрессии компонента прошли. | Нужен авторизованный attach/send/tap; не выполнялся. | **SOURCE/TEST PASS; NOT VERIFIED BY PLATFORM SESSION** |
| Публикация и cache bust | Checkpoint `08945dc2` сохранён; content-hashed assets являются cache-busting механизмом. | Canonical всё ещё maintenance/503; project domain всё ещё отдаёт старый fingerprint без v6-R markers. | **BLOCKED BY PLATFORM DELIVERY** |

## Privacy-safe provider diagnostic

Проверка выполнена **24 августа 2026, 17:32:29 UTC**. Она выводила только агрегированные состояния и timestamps; ключи, запросы, URLs, документы и сырые provider errors не выводились.

| Слой | Статус | Интерпретация |
|---|---|---|
| Google | `not_in_active_cascade` | Не является активным слоем текущего web cascade; отдельный live status не заявляется. |
| Tavily | `ready` | Агрегированный compatibility health-сигнал готов; не добавлялся в active cascade. |
| You | `ready` | Доступен в active cascade. Проверочный поиск вернул пять результатов, но без пригодных publication dates; для fresh ответа они будут честно заблокированы. |
| Serper | `ready` | Доступен как bounded fallback в active cascade. |
| Exa | `unknown` | Не был подтверждён текущей проверкой; используется только как следующий bounded fallback. |
| RAG | `ready` | 3 источника, последний запуск `success` в 01:30:34 UTC. RAG не подменяет live web sources. |

## Техническая верификация

| Проверка | Результат |
|---|---|
| Focused v6-R search/context/stream/Home/AIChatBox | PASS |
| Полный `pnpm test` | **44 passed, 1 skipped; 214 passed, 4 skipped** |
| `pnpm check` | PASS |
| `pnpm build` | PASS |
| Diff whitespace check | PASS |
| Удалённая browser UI приёмка | Не запускалась: нет delivery нового runtime и ранее зафиксирован нестабильный OAuth/session handoff. |

## Delivery evidence

| Endpoint | Публично наблюдаемый результат | Вердикт |
|---|---|---|
| `https://lkn.manus.space/` | «Site under maintenance», HTTP 503, platform-origin 404, `no-cache` | **BLOCKED BY PLATFORM DELIVERY** |
| `https://kairema-ai-gxujplkn.manus.space/?welcome=1` | Guest shell существует, но assets `index-MouuzhQK.js` и `index-BuJ1VYLR.css` не содержат v6-R markers после checkpoint `08945dc2` | **BLOCKED BY PLATFORM DELIVERY** для propagation |

Полная публичная metadata-only фиксация находится в [`runtime-delivery-audit.md`](./runtime-delivery-audit.md).

## Остаток

Нужно дождаться, когда platform delivery начнёт отдавать runtime checkpoint `08945dc2` на project domain и привяжет/вернёт Kairema на `lkn.manus.space`. Только после этого возможна честная browser-приёмка: dated sources либо badge, Sun → новый чат → recall, composer X, 64px sent thumbnail и full view. До этого в отчёте остаётся **BLOCKED BY PLATFORM DELIVERY**, а не ложный PASS.
