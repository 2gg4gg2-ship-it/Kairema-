# v6-K — проверка search-провайдеров

Дата проверки: **21 августа 2026 г.**

| Провайдер | Официально подтверждённый маршрут | Доступность | Решение на этапе проверки |
|---|---|---|---|
| You.com Web Search | `POST https://ydc-index.io/v1/search`, заголовок `X-API-Key`; поддерживает query-relevant `highlights`, язык, страну и freshness. [Документация][1] | На странице тарифа указаны 100 бесплатных запросов в день и $100 стартового кредита. [Тариф][2] | Допущен к server-side live-проверке. Полученный защищённый ключ дал HTTP 200 в изолированном Vitest-тесте. |
| Serper.dev | `POST https://google.serper.dev/search`, заголовок `X-API-KEY`; возвращает метаданные результатов. [Витрина][3] | Стартовый кредит, не подтверждённый постоянный бесплатный лимит. | **HTTP 200 подтверждён** в изолированной server-side проверке; допускается только как резерв. |
| Exa AI | `POST https://api.exa.ai/search`, заголовок `x-api-key`; может возвращать результаты и highlights. [API][4] | Новым аккаунтам выдаются $20 при регистрации и $10 каждый месяц без платёжного метода. [Тариф][5] | **HTTP 200 подтверждён** в изолированной server-side проверке; допускается только как резерв. |
| Firecrawl | `POST https://api.firecrawl.dev/v2/search`, заголовок `Authorization: Bearer`; search возвращает web-результаты и при необходимости извлечённый контент. [API][6] | Free Plan: 1 000 кредитов ежемесячно; поиск расходует 2 кредита на 10 результатов. [Тариф][7] | **HTTP 200 подтверждён** в изолированной server-side проверке; допускается только как резерв. |
| Keirolabs | `POST https://api.keirolabs.cloud/api/v2/search/fast`, заголовок `Authorization: Bearer`; документированный ответ содержит title, URL, snippet, score и credits_used. [Документация][8] | Витрина указывает Free: 500 кредитов в месяц, no card; grant-страница требует отдельного одобрения и не используется как бесплатный тариф. [Тариф][9] | **Не активирован:** свежая проверка вернула HTTP 404, поэтому сервис не допускается в каскад до подтверждённого исправления контракта. |

## Ограничения реализации

* Только сервер использует ключи. В browser bundle, публичные DTO, логи и отчёт не попадают ключи, полные цепи, model ID или внутренние URL диагностики.
* Одно сообщение выполняет максимум три search-слоя; число role upstream-вызовов остаётся не более четырёх.
* RAG-источники остаются атрибутированными и отображаются отдельно; никаких подставных URL или фиктивных цитат.
* Bright Data исключён по спецификации. Keirolabs остаётся неинтегрированным после HTTP 404; Serper.dev, Exa AI и Firecrawl прошли только server-side допуск и будут ограничены трёхслойным каскадом без раскрытия деталей клиенту.

[1]: https://you.com/docs/api-reference/search/v1-search
[2]: https://you.com/pricing
[3]: https://serper.dev/
[4]: https://exa.ai/docs/reference/search
[5]: https://exa.ai/docs/reference/billing
[6]: https://docs.firecrawl.dev/api-reference/endpoint/search
[7]: https://www.firecrawl.dev/pricing
[8]: https://keirolabs.cloud/
[9]: https://keirolabs.cloud/blogs/comparisons/ai-search-api-pricing-compared
