# ZenMux — внешняя верификация v6-A

**Дата проверки:** 20 августа 2026, GMT+3.

| Проверяемый факт | Подтверждение |
|---|---|
| OpenAI-совместимый базовый endpoint | Официальное руководство ZenMux указывает `https://zenmux.ai/api/v1`. [OpenClaw guide](https://zenmux.ai/docs/best-practices/openclaw.html) |
| Каталог моделей | Официальная документация описывает OpenAI-compatible endpoint списка моделей. [List Models](https://zenmux.ai/docs/api/openai/openai-list-models.html) |
| Авторизация и доступ к каталогу | Server-side Vitest от 20 августа 2026 выполнил `GET https://zenmux.ai/api/v1/models` с защищённым `ZENMUX_API_KEY`: HTTP 200 и массив `data`. Секрет и заголовок авторизации не записывались. |
| Ротация Free-каталога | Страницы ZenMux описывают широкий каталог и бесплатный план, но ни один model ID не считается разрешённым для Kairema до отдельной runtime-проверки точного ID и поля цены. [Quick Start](https://zenmux.ai/docs/guide/quickstart.html) |
| Явный free-признак в каталоге | В полученном 20 августа 2026 каталоге точно присутствовали только `z-ai/glm-5.3-free`, `z-ai/glm-4.7-flash-free` и `z-ai/glm-4.6v-flash-free`. У остальных рассмотренных ID не было суффикса `-free`, а значения `pricing.prompt` и `pricing.completion` отсутствовали, поэтому они исключены. |
| Живой вызов точных free-ID | Server-side POST `/chat/completions` для всех трёх exact ID вернул HTTP 403 `You have no permission to access this resource`. Следовательно, ключ может читать каталог, но пока не имеет права использовать free-модели для генерации. Модели не включены в активные ролевые цепи; ZenMux оставлен только в server-side health-проверке. |

> Решение v6-A: до успешного живого completion ZenMux не добавляется в active allowlist и цепи ролей. Проверка состояния использует только exact free-ID, не раскрывает model ID клиенту и фиксирует HTTP 403 в общей server-side health-модели.

## v6-A.1 — повторная активационная проверка

**Дата проверки:** 20 августа 2026, GMT+3; `GET /models` — HTTP 200.

### Проблема

Нужно было активировать ZenMux только после новой проверки доступа, точных бесплатных model ID и успешных коротких generation-запросов. Существующий OpenAI-совместимый `/models` вернул exact ID, но не возвращает pricing-поля, поэтому тариф нельзя было достоверно извлечь только из тела этого endpoint.

### Причина

Официальная витрина моделей ZenMux помечает `z-ai/glm-5.3-free` и `dots-studio/dots3-note-prev` как Free с input/output `$0/M`; документация указывает, что detailed pricing отображается на странице модели, а `/models` используется для каталога ID. [Models](https://zenmux.ai/models) [Pricing and Fees](https://zenmux.ai/docs/about/pricing-and-cost.html) Однако каждый короткий server-side `POST /chat/completions` вернул HTTP 403, поэтому право на каталог не подтверждает право на generation.

### Что изменено

Добавлен изолированный server-side верификатор `scripts/verify-zenmux-v6-a1.mjs`. Он берёт ключ только из окружения, использует официальный endpoint `https://zenmux.ai/api/v1`, не выводит ключ, authorization header, prompt или ответ модели и сохраняет только публичные идентификаторы, факт zero-price, HTTP-код, классификацию и latency с правами `0600` во временном файле. Active role chains, первые четыре кандидата, UI и память **не изменялись**; ZenMux остаётся исключительно в server-side health-контуре.

| Запрошенная модель | Exact ID из `/models` | Подтверждение $0 | HTTP completion | Latency | Итог |
|---|---|---|---:|---:|---|
| `z-ai/glm-5.3` | `z-ai/glm-5.3-free` | Official Models page | 403 | 893 ms | Не активирована |
| `z-ai/glm-4.7-flash` | `z-ai/glm-4.7-flash-free` | Official Models page | 403 | 835 ms | Не активирована |
| `dots-studio/dots3-note-prev` | `dots-studio/dots3-note-prev` | Official Models page | 403 | 772 ms | Не активирована |

### Как проверено

Проверка выполнена 20 августа 2026 в `08:29:07Z`: каталог доступен с HTTP 200, все три exact ID найдены. В отличие от v6-A, completion-запросы были повторены уже после заявленной разблокировки аккаунта; результатом снова стали три HTTP 403. В соответствии с правилом безопасной интеграции ни одна модель не добавлена в allowlist активных запросов или в пятую позицию цепи. Это сохраняет ровно четыре публичные роли, неизменность их первых четырёх кандидатов, отсутствие лишней сетевой попытки и отсутствие секретов в клиентском bundle.

> Решение v6-A.1: **ZENMUX НЕ АКТИВИРОВАН**, так как live generation-доступ не подтверждён. Для повторной активации требуется успешный HTTP 200 хотя бы на трёх указанных exact ID; до этого экран пользователей не раскрывает ID, маршруты или диагностические детали.
