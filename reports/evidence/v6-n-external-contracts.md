# v6-N: проверенные external search contracts

Дата проверки: 2026-08-22 (UTC+03:00). Этот файл фиксирует только публичные contracts, применяемые для диагностики и безопасного восстановления слоя поиска; в нём нет ключей, пользовательских запросов, ответов или URL временных вложений.

| Слой | Подтверждённый contract | Решение для v6-N |
|---|---|---|
| Google Search grounding | `POST https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent`, заголовок `x-goog-api-key`, `tools: [{"google_search": {}}]`; grounded ответ содержит `groundingMetadata` с источниками. | Использовать лишь как server-side диагностический/grounding слой. Его результаты необходимо нормализовать до metadata-only source telemetry; URL не показываются обычному пользователю. |
| Tavily | `POST https://api.tavily.com/search` с JSON search request. Документация описывает `query`, `search_depth`, `max_results`, `topic` и time filters. | Добавлять только при фактическом доступном ключе и после request-level проверки. Не считать слой здоровым по одной конфигурации. |
| OpenRouter online | Документация помечает `:online` как deprecated и рекомендует `tools: [{ type: "openrouter:web_search" }]`. | Не подменять существующий независимый каскад скрытым model-web-search. Возможна только отдельная диагностическая попытка, если она подтверждает каталог и не нарушает budget/chain invariant. |

## Источники

1. [Google AI for Developers — Grounding with Google Search](https://ai.google.dev/gemini-api/docs/generate-content/google-search), обновлено источником 2026-08-20.
2. [Tavily — Search endpoint](https://docs.tavily.com/documentation/api-reference/endpoint/search).
3. [OpenRouter — Online Variant](https://openrouter.ai/docs/guides/routing/model-variants/online).
4. [OpenRouter — Web Search server tool](https://openrouter.ai/docs/guides/features/server-tools/web-search).
