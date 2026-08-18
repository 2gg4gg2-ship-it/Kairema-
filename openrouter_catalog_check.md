# Проверка каталога OpenRouter

Дата проверки: 18 августа 2026 года.

Источник: `GET https://openrouter.ai/api/v1/models` с server-side ключом OpenRouter. HTTP-статус запроса: **200**.

| Карточка | Указанный в исходной спецификации ID | Результат каталога | Используемый подтверждённый ID |
|---|---|---|---|
| Kairema Ultra (Gemma 4) | `google/gemma-4-26b-a4b:free` | Вариант без `-it` отсутствует; интерактивный вариант присутствует | `google/gemma-4-26b-a4b-it:free` |
| Kairema Code (North) | `openrouter/north-mini-code:free` | Префикс `openrouter` отсутствует; вариант Cohere присутствует | `cohere/north-mini-code:free` |
| Kairema Long-Context (Dots3) | `dots-studio/dots-3-note-preview:free` | Присутствует | Без изменений |
| Kairema Express (GPT-OSS) | `openai/gpt-oss-20b:free` | Присутствует | Без изменений |
| Kairema Auto-Router | `openrouter/free` | Присутствует | Без изменений |

Изменения ограничены двумя ID, которые отсутствовали в живом каталоге. Все карточки остаются статическими и постоянно видимыми независимо от дальнейших API-статусов.
