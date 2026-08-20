# OrcaRouter: внешняя проверка v5.9

Проверка выполнена: **2026-08-20T05:52:07Z**.

## Подтверждённый API

Официальная страница модели подтверждает OpenAI-совместимый базовый URL `https://api.orcarouter.ai/v1`, авторизацию `Authorization: Bearer <ORCAROUTER_API_KEY>` и endpoint `POST /v1/chat/completions`.

Источник: <https://www.orcarouter.ai/models/deepseek/deepseek-v4-pro-free>

## Подтверждённые ID из аутентифицированного `GET https://api.orcarouter.ai/v1/models`

| ID | Решение |
|---|---|
| `deepseek/deepseek-v4-pro-free` | Разрешить для server-side OrcaRouter-кандидата «Флагмана». |
| `deepseek/deepseek-v4-flash-free` | Разрешить для server-side OrcaRouter-кандидатов «Быстрого» и «Контекста». |
| `tencent/hy3-free` | Разрешить для server-side OrcaRouter-кандидата «Смекалистого». |
| `qwen/qwen3.8-27b-free` | Подтверждён для отдельного живого теста; не добавлять в роль без отдельного решения о цепи. |
| `orcarouter/free` | Подтверждён как диагностический ID; исключить из активных цепей. |

## Ограничения free tier

Официальная документация подтверждает, что free ID следует обнаруживать через `/v1/models`; `429` с `Retry-After` означает заполненное временное окно, а `429` без такого заголовка — слишком большой prompt. Документация также запрещает передавать free ID как fallback в `extra_body.models` одного запроса. Kairema не использует этот механизм: каждая кандидатная попытка — самостоятельный server-side запрос в уже ограниченной четырьмя попытками цепи.

Источник: <https://docs.orcarouter.ai/routing/free-models>
