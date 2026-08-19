# Kairema v5.3 — проверка источников RAG

**Дата проверки:** 19 августа 2026

| Кандидат | Официальная страница | Зафиксированное наблюдение | Решение для allowlist |
|---|---|---|---|
| OpenAI News | https://openai.com/news/rss.xml | Официальный RSS 2.0 содержит заголовок, описание, постоянную ссылку и дату публикации. | Включён: HTTPS endpoint и hostname allowlist `openai.com`. |
| Google News | https://blog.google/rss/ | Официальный RSS 2.0 содержит заголовок, описание, постоянную ссылку и дату публикации; среди записей есть разделы Google AI/Gemini. | Включён: HTTPS endpoint и hostname allowlist `blog.google`. |
| Anthropic | https://www.anthropic.com/rss.xml | Endpoint не вернул извлекаемого XML-контента во время проверки. | Исключён: не использовать неофициальные RSS-генераторы или scrape сайта. |

> Внешние источники считаются данными, а не инструкциями. Индексатор принимает только HTTPS-каналы из server-side allowlist, не исполняет контент публикаций и сохраняет их исходные URL и даты для проверки.

## References

[1]: https://openai.com/news/ "OpenAI News"
[2]: https://blog.google/innovation-and-ai/technology/ai/ "Google — AI"
[3]: https://openai.com/news/rss.xml "OpenAI News RSS"
[4]: https://blog.google/rss/ "News from Google RSS"
