# Kairema FIX v3 — LLM и security audit

**Дата проверки:** 2026-08-25 (GMT+3)  
**Режим:** read-only / нейтральные проверки; пользовательские чаты, память, профиль, история и вложения не открывались и не менялись.

## LLM: фактический результат нейтральной проверки

Проверялись только четыре существующие публичные роли с нейтральным диагностическим вводом. Тест не раскрывает ключи, raw upstream errors, request IDs или содержимое ответов.

| Публичная роль | Результат | Использованный кандидат | Серверный provider | Модель |
|---|---|---|---|---|
| Flash (`fast`) | Ответ получен | Backup | Groq | GPT-OSS 20B |
| Think (`smart`) | Ответ получен | Backup | Google | Gemini Flash Lite |
| Context (`context`) | Ответ получен | Backup | Google | Gemini Flash Lite |
| Apex (`flagship`) | Ответ получен | Backup | Google | Gemini Flash Lite |

> Проверка подтверждает доступность роли через устойчивый fallback, а не обещает постоянную доступность конкретного primary-кандидата. Очередность и public role names не менялись. Лимит остаётся не более четырёх upstream-попыток на запрос.

## Контуры устойчивости

| Контур | Состояние |
|---|---|
| Primary → fallback | Реализован в server-side role chains; failed/unavailable primary может быть пропущен без выдачи технической ошибки пользователю. |
| Attempt budget | Жёсткий серверный предел: максимум 4 upstream attempts. |
| Timeout и поздние ответы | Попытки ограничены временем; поздний результат не перезаписывает уже принятый fallback-результат. |
| Health/cooldown/circuit breaker | Provider health хранится сервером; rate-limit и временные ошибки переводят слой в cooldown, а не вызывают бесконечные повторы. |
| Публичная поверхность | Клиент видит ровно четыре роли и не получает секреты, internal provider traces или raw health errors. |

## Client security audit

| Проверка | Результат |
|---|---|
| Server-side credentials в клиентском исходнике | Не обнаружены. |
| Прямые upstream LLM/search endpoints в клиенте | Не обнаружены; клиент использует server/tRPC/SSE границы. |
| Единственный `dangerouslySetInnerHTML` | Относится к изолированному chart style template, не принимает пользовательский chat/search контент. Подтверждённого XSS exposure не найдено. |
| Документированные публичные источники поиска | Передаются только по whitelist: title, URL и реальная дата публикации; RAG и provider internals скрыты. |

## Не заявленные результаты

Этот audit не заменяет authenticated browser acceptance: он по-прежнему **NOT VERIFIED BY PLATFORM SESSION**. Canonical `lkn.manus.space` ранее возвращал platform maintenance/503 и остаётся **BLOCKED BY PLATFORM DELIVERY** до фактической доставки Kairema runtime. Ключи, конфигурация connector-ов, owner mapping, OAuth, storage и provider order не менялись.
