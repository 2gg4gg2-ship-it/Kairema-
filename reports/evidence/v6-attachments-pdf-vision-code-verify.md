# Kairema — PDF и image vision: code-level verification

**Дата:** 2026-08-25 UTC  
**Статус:** безопасная проверка кода и регрессий завершена. Реальная отправка PDF и vision-запрос в авторизованном browser-сеансе остаются **NOT VERIFIED**.

## Проверенный контракт

| Область | Статус | Проверенный барьер |
|---|---|---|
| Допустимые типы | **PASS** | Принимаются только PNG, JPEG, WEBP, PDF, TXT и Markdown. |
| Размер и содержимое | **PASS** | Вложения ограничены 8 МБ; PNG/JPEG/WEBP/PDF проходят magic-byte проверку до хранения. |
| Имя и S3 lifecycle | **PASS** | Имя нормализуется; object key формируется в owner/session-scoped пути с UUID. В базе сохраняется key и metadata, а не байты файла. |
| Owner scope | **PASS** | Download и vision читают attachment только через owner-scoped lookup. Чат получает только attachment IDs текущего пользователя и текущей сессии. |
| PDF-контекст | **PASS (code-level)** | PDF text extraction ограничена 24 страницами и 30 000 символами; в prompt передаётся ограниченный document context. Текст документа явно трактуется как справочный материал, а не инструкции. |
| Image vision | **PASS (code-level)** | Vision допускает только image kind; bytes повторно проверяются после временного signed fetch и превращаются в data URL только для активного запроса. В chat-context действует лимит до четырёх attachment IDs. |
| UI PDF card | **NOT VERIFIED BY BROWSER SESSION** | Backend metadata contract доступен, но реальная карточка в авторизованном mobile-сеансе не проверялась. |
| Реальный vision-ответ модели | **NOT VERIFIED BY BROWSER SESSION** | Не создавались тестовые файлы и не выполнялся реальный upstream vision-запрос. |

> Никакие пользовательские файлы, temporary attachment IDs, signed URLs, текст PDF или ответы модели не открывались и не создавались во время проверки.

## Регрессии

| Набор | Результат |
|---|---|
| `server/attachments.lifecycle.test.ts` | **PASS:** 3 tests. |
| `server/chat-context.test.ts` | **PASS:** 25 tests, включая transient owner-scoped image vision context. |
| `client/src/lib/image-attachments.test.ts` | **PASS:** 2 tests. |
| Всего | **PASS:** 3 files, 30 tests. |

## Внутренние основания

| № | Компонент |
|---|---|
| 1 | `server/attachments.ts`: allowlist, bounds, magic checks, safe filename, S3 key, extraction, owner-scoped download и transient vision data URL. |
| 2 | `server/chat-context.ts`: owner/session attachment lookup, max-four limit и ephemeral `imageUrls` request context. |
| 3 | `server/attachments.lifecycle.test.ts`, `server/chat-context.test.ts`, `client/src/lib/image-attachments.test.ts`: 30 passed tests. |
