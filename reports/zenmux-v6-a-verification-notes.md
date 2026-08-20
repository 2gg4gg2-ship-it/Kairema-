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
