# Kairema v3 — снимок каталогов моделей

Проверено 2026-08-19 через официальные каталоги: [OpenRouter Models](https://openrouter.ai/api/v1/models), [Google Gemini Models](https://generativelanguage.googleapis.com/v1beta/models) и [Groq Models](https://api.groq.com/openai/v1/models). Полный машиночитаемый снимок находится в `reports/provider-catalog-snapshot.json`; в нём нет ключей.

| Провайдер | Итог | Подтверждённые кандидаты |
|---|---:|---|
| OpenRouter | 415 чат-моделей | `dots-studio/dots-3-note-preview:free`, `google/gemma-4-26b-a4b-it:free`, `google/gemma-4-31b-it:free`, `nvidia/nemotron-3-super-120b-a12b:free`, `nvidia/nemotron-3-ultra-550b-a55b:free`, `cohere/north-mini-code:free`, `openai/gpt-oss-20b:free` |
| Google AI Studio | 37 генеративных моделей | `gemini-2.5-flash`, `gemini-flash-latest`, `gemini-3.5-flash`, `gemini-3.7-flash` |
| Groq | 13 моделей | `openai/gpt-oss-20b`, `openai/gpt-oss-120b`, `qwen/qwen3.6-27b`, `groq/compound-mini` |

Ключ Groq прошёл отдельный серверный health-check `GET /openai/v1/models` с HTTP 200. Задача реализации должна использовать эти реальные ID либо повторно сверить каталог непосредственно перед live-тестом.
