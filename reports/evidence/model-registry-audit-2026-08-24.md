# Kairema: реестр моделей и устойчивости

**Дата аудита:** 24 августа 2026 года.  
**Метод:** read-only анализ server-side реестра и публичного локального endpoint `models.list`. Запросы к пользовательским чатам, история, вложения, ключи и сырые ответы провайдеров не использовались.

> В интерфейсе доступны только четыре роли. Конкретные upstream model ID выбираются и переключаются исключительно сервером; пользователь не может отправить произвольный ID модели.

## Текущий runtime

Ниже показан **последний сохранённый успешный runtime каждой роли** на момент read-only проверки. Это подтверждает, какой резерв был использован последним; это не обещание, что тот же провайдер будет доступен в следующую секунду.

| Публичная роль | Последний успешно использованный кандидат | Провайдер | Состояние |
|---|---|---|---|
| **Kairema Flash** | Gemini Flash Lite | Google AI Studio | Резерв активен |
| **Kairema Think** | Gemini Flash Lite | Google AI Studio | Резерв активен |
| **Kairema Context** | DeepSeek V4 Flash | OrcaRouter | Резерв активен |
| **Kairema Apex** | DeepSeek V4 Pro | OrcaRouter | Резерв активен |

## Активные цепочки ролей

Порядок в каждой строке — строгий порядок попыток. Система делает не более четырёх настоящих обращений к upstream в рамках одного ответа; health/capability skips не расходуют этот лимит.

| Роль | Основной кандидат | Резерв 1 | Резерв 2 | Резерв 3 | Дополнительный резерв |
|---|---|---|---|---|---|
| **Flash** | OpenRouter — GPT-OSS 20B (`openai/gpt-oss-20b:free`) | OrcaRouter — DeepSeek V4 Flash (`deepseek/deepseek-v4-flash-free`) | Groq — GPT-OSS 20B (`openai/gpt-oss-20b`) | Google AI Studio — Gemini Flash Lite (`gemini-flash-lite-latest`) | — |
| **Think** | OpenRouter — Gemma 4 26B (`google/gemma-4-26b-a4b-it:free`) | OrcaRouter — Tencent HY 3 (`tencent/hy3-free`) | Google AI Studio — Gemini Flash Lite (`gemini-flash-lite-latest`) | Groq — GPT-OSS 120B (`openai/gpt-oss-120b`) | — |
| **Context** | OpenRouter — Nemotron 3 Ultra (`nvidia/nemotron-3-ultra-550b-a55b:free`) | OrcaRouter — DeepSeek V4 Flash (`deepseek/deepseek-v4-flash-free`) | Google AI Studio — Gemini Flash Lite (`gemini-flash-lite-latest`) | Groq — GPT-OSS 120B (`openai/gpt-oss-120b`) | Dots Studio — Dots3 Note Preview (`dots-studio/dots3-note-prev`) |
| **Apex** | OpenRouter — Gemma 4 31B (`google/gemma-4-31b-it:free`) | OrcaRouter — DeepSeek V4 Pro (`deepseek/deepseek-v4-pro-free`) | Google AI Studio — Gemini Flash Lite (`gemini-flash-lite-latest`) | Groq — GPT-OSS 120B (`openai/gpt-oss-120b`) | — |

### Модели с обработкой изображений

В текущих активных цепочках флаг vision задан у **Gemini Flash Lite**. Это означает, что для роли, дошедшей до этого кандидата, сервер может передать поддерживаемое изображение по существующему защищённому lifecycle вложений. Это не делает vision гарантированно доступным при недоступности соответствующего провайдера.

## Диагностические и отключённые от пользовательских цепочек кандидаты

Следующие элементы **не являются доступными ролями и не участвуют в генерации обычного ответа**.

| Элемент | Назначение | Статус участия в ответах |
|---|---|---|
| OpenRouter Auto (`openrouter/free`) | Server-side диагностический probe | Исключён из активных цепочек |
| OrcaRouter Auto (`orcarouter/free`) | Server-side диагностический probe | Исключён из активных цепочек |
| ZenMux GLM 5.3 Free (`z-ai/glm-5.3-free`) | Allowlist для диагностики каталога/health | Исключён из активных цепочек до отдельной live-верификации |
| ZenMux GLM 4.7 Flash Free (`z-ai/glm-4.7-flash-free`) | Allowlist для диагностики каталога/health | Исключён из активных цепочек до отдельной live-верификации |
| ZenMux GLM 4.6V Flash Free (`z-ai/glm-4.6v-flash-free`) | Allowlist для диагностики каталога/health | Исключён из активных цепочек до отдельной live-верификации |

Код содержит также server-side адаптеры health probe для SambaNova, Mistral, Cerebras и DeepSeek. Они **не добавлены** в цепочки четырёх ролей, поэтому не следует считать их работающими резервами пользовательского чата.

## Что обеспечивает устойчивость

| Механизм | Текущая реализация |
|---|---|
| Фиксированная поверхность | Ровно четыре публичные роли: Flash, Think, Context и Apex. Raw model ID не принимаются от клиента. |
| Ограничение нагрузки | Не более **4** реальных upstream LLM-вызовов на одну генерацию. |
| Лимит времени | Каждая попытка, включая streaming, имеет ограничение **25 секунд**. |
| Быстрый первый фрагмент Flash | Для Flash задан TTFT deadline **1,5 секунды**; fallback допускается до показа видимого фрагмента. |
| Health store | Состояние провайдера сохраняется серверно, включая готовность, cooldown, недоступность, отсутствие конфигурации и отказ авторизации. |
| Circuit breaker | 429, quota, временная недоступность, сеть и timeout переводят провайдер в cooldown/blocked-state; следующие цепочки пропускают его до восстановления. |
| Безопасный recheck | Health обновляется при старте, по истечении окна проверки и защищённым cron/Heartbeat endpoint. Повторная готовность фиксируется только после успешного server-side ping. |
| Защита от запоздалого успеха | Generation guard не позволяет позднему успешному ответу стереть более свежую блокировку quota/auth. |
| Runtime transparency | Сервер хранит последний provider/model роли и передаёт UI агрегированные статусы «Готов», «Резерв активен», «Недоступно», «Не настроено» без ключей и сырых ответов. |
| Безопасность контента | System prompt запрещает имитировать свежие данные без подтверждённого контекста; исходящие ответы очищаются от reasoning- и source-артефактов. |

## Важное разграничение статусов

**«Резерв активен»** означает, что последний успешный ответ роли обслужил не её первичный кандидат. Это является подтверждением работоспособного fallback path, но не раскрывает ключи и не заменяет непрерывный SLA-мониторинг. **«Не настроено»** означает отсутствие server-side конфигурации, а **«Недоступно»** — отсутствие пригодного кандидата в момент оценки. Эти статусы не показывают пользовательский текст, вложения, идентификаторы сессии или диагностику провайдера.

## Источники внутри проекта

- `server/providers.ts`: `MODEL_ROLES`, `DIAGNOSTIC_CANDIDATES`, allowlists, request budget, timeout, health и fallback policy.
- `server/routers.ts`: публичный read-only endpoint `models.list`.
- Read-only результат endpoint `models.list`, полученный локально 24 августа 2026 года.
