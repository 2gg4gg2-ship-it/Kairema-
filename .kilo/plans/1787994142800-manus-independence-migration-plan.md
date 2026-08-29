# План миграции Kairema с Manus на независимое окружение

## 1. Текущее состояние (baseline)
- Репозиторий: `2gg4gg2-ship-it/Kairema-`
- Baseline commit: `4e4cdfa6` (GitHub sync post-check)
- Текущий HEAD: `868078a` (service-only changes: `.bolt/mcp.json` + evidence report formatting)
- Основной код Kairema между baseline и HEAD **не изменялся**
- Стек: React 19 + Vite 7 + Express + tRPC + Drizzle/MySQL + Stytch
- 4 роли: Flash/Think/Context/Apex с fallback по 10 провайдерам

## 2. Зависимости от Manus (по приоритету отключения)

### P0 — Критично для запуска вне Manus

#### 2.1. Vite plugin: `vite-plugin-manus-runtime`
- **Файлы**: `package.json`, `vite.config.ts`
- **Что делает**: инжектирует runtime Manus, манипулирует сборкой
- **Замена**: удалить из `devDependencies` и `vite.config.ts`. Заменить на стандартный Vite + React preset. Функционал плагина не является критичным для приложения.

#### 2.2. Manus WebDev SDK/types (`server/_core/sdk.ts`, `server/_core/types/manusTypes.ts`)
- **Файлы**: `server/_core/sdk.ts`, `server/_core/types/manusTypes.ts`, `server/_core/oauth.ts`, `server/_core/oauth.callback.test.ts`
- **Что делает**: OAuth через Manus WebDev (`webdev.v1.WebDevAuthPublicService`), heartbeat (`webdevtoken.v1.WebDevService`), data API (`CallApi`)
- **Замена**: 
  - Удалить SDK вызовы в `sdk.ts`
  - Оставить только Stytch auth (`stytch-auth.ts`) как primary
  - Legacy Manus OAuth (`oauth.ts`) — удалить или завести на отдельный generic OAuth2/OIDC провайдер (Google, GitHub,email) если нужен
  - `manusTypes.ts` — удалить protobuf-типы

#### 2.3. Forge API (хранилище/voice/imagegen/maps/notifications/data/heartbeat)
- **Файлы**: 
  - `server/_core/env.ts` (`forgeApiUrl`, `forgeApiKey`)
  - `server/storage.ts`
  - `server/_core/storageProxy.ts` (route `/manus-storage/*`)
  - `server/_core/voiceTranscription.ts`
  - `server/_core/imageGeneration.ts`
  - `server/_core/map.ts`
  - `server/_core/notification.ts`
  - `server/_core/dataApi.ts`
  - `server/_core/heartbeat.ts`
- **Что делает**: presigned S3 upload через Forge, voice transcription, image generation, Google Maps proxy, notifications, data API, heartbeat
- **Замена**:
  - **Storage**: заменить на прямые AWS S3 SDK calls (`@aws-sdk/client-s3` уже в зависимостях) с собственными IAM credentials или presigned URLs через собственный backend
  - **Voice transcription**: убрать или подключить独立 provider (OpenAI Whisper, Google STT)
  - **Image generation**: убрать или подключить独立 provider (OpenAI DALL-E, Stability AI)
  - **Maps**: убрать или подключить独立 Google Maps SDK
  - **Notifications**: убрать или заменить на email/push через独立 сервис
  - **Data API**: убрать (внутренний Manus API)
  - **Heartbeat**: убрать (Manus-specific health check)

#### 2.4. Manus Storage proxy route
- **Файлы**: `server/_core/storageProxy.ts`, `client/src/lib/chat-export-pdf.ts` (hardcoded `/manus-storage/...`)
- **Замена**: 
  - Заменить route на `/api/storage/*` или `/files/*`
  - Использовать прямые S3 presigned URLs вместо proxy

#### 2.5. Debug collector / Manus hosts
- **Файлы**: `vite.config.ts`, `client/public/__manus__/debug-collector.js`
- **Что делает**: сбор логов браузера в `.manus-logs/`, allowed hosts `*.manuspre.computer`, `*.manus.computer` и т.д.
- **Замена**: удалить плагин `vitePluginManusDebugCollector` и debug collector script. Оставить стандартные Vite hosts (`localhost`, `127.0.0.1`, production domain).

#### 2.6. OpenRouter HTTP-Referer
- **Файлы**: `server/providers.ts:430`
- **Что делает**: отправляет `https://kairema.manus.space` как Referer
- **Замена**: заменить на реальный production domain или опционально через env var

### P1 — Важно для функциональной совместимости

#### 2.7. Manus OAuth legacy + session cookie
- **Файлы**: `server/_core/oauth.ts`, `server/_core/cookies.ts`, `shared/const.ts` (OAUTH_STATE_COOKIE comment)
- **Что делает**: legacy Manus OAuth flow, cookie name `app_session_id`, state cookie `__Host-oauth_state`
- **Замена**: 
  - Оставить Stytch как primary auth
  - Если нужен generic OAuth — добавить `@auth0/nextjs-auth0` или passport.js стратегии
  - Cookie name оставить или заменить на generic `session_id`
  - Убрать зависимость от `*.manus.space` в cookie domain comments

#### 2.8. Owner logic (`OWNER_OPEN_ID`)
- **Файлы**: `server/_core/env.ts`, `server/routers.ts` (`requireOwner`)
- **Что делает**: restricts owner tools to single hardcoded OpenID
- **Замена**: 
  - Оставить логику, но вынести `OWNER_OPEN_ID` в env var (уже есть)
  - Добавить валидацию: если не задан — owner endpoints возвращают 403 или disabled
  - В production задавать через secret manager

#### 2.9. Manus-specific env vars → generic names
- **Файлы**: `server/_core/env.ts`, `server/storage.ts`, `server/_core/heartbeat.ts`, `server/_core/imageGeneration.ts`, `server/_core/dataApi.ts`, `server/_core/voiceTranscription.ts`, `server/_core/map.ts`, `server/_core/notification.ts`
- **Замена**:
  - `BUILT_IN_FORGE_API_URL` → не нужен (удалить)
  - `BUILT_IN_FORGE_API_KEY` → не нужен (удалить)
  - `OAUTH_SERVER_URL` → заменить на generic `OAUTH_ISSUER_URL` или удалить если нет OAuth
  - Добавить `APP_URL` / `PUBLIC_APP_URL` для callback redirects

### P2 — Опционально / можно отложить

#### 2.10. Evidence reports / audit artifacts
- **Файлы**: `reports/evidence/**/*.md`, `todo.md`
- **Замена**: оставить как документация, не shipping в production

#### 2.11. `.bolt/mcp.json`
- **Файлы**: `.bolt/mcp.json`
- **Замена**: оставить как служебный файл IDE, не shipping

## 3. Новые environment variables (минимальный набор)

| Variable | Purpose | Required | Default |
|----------|---------|----------|---------|
| `DATABASE_URL` | MySQL connection | Yes | — |
| `JWT_SECRET` | Session signing | Yes | — |
| `STYTCH_PROJECT_ID` | Stytch auth | Yes | — |
| `STYTCH_SECRET` | Stytch auth | Yes | — |
| `OPENROUTER_API_KEY` | Primary LLM provider | Yes | — |
| `ORCAROUTER_API_KEY` | Fallback LLM provider | No | — |
| `GEMINI_API_KEY` | Fallback LLM provider | No | — |
| `GROQ_API_KEY` | Fallback LLM provider | No | — |
| `CEREBRAS_API_KEY` | Fallback LLM provider | No | — |
| `DEEPSEEK_API_KEY` | Fallback LLM provider | No | — |
| `MISTRAL_API_KEY` | Fallback LLM provider | No | — |
| `SAMBANOVA_API_KEY` | Fallback LLM provider | No | — |
| `ZENMUX_API_KEY` | Fallback LLM provider | No | — |
| `API_KEY_DOTS3` | Fallback LLM provider | No | — |
| `AWS_ACCESS_KEY_ID` | S3 storage | Yes (if storage needed) | — |
| `AWS_SECRET_ACCESS_KEY` | S3 storage | Yes (if storage needed) | — |
| `AWS_S3_BUCKET` | S3 storage | Yes (if storage needed) | — |
| `AWS_S3_REGION` | S3 storage | No | `us-east-1` |
| `OWNER_OPEN_ID` | Owner admin access | No | — |
| `APP_URL` | Base URL for callbacks | Yes | `http://localhost:3000` |
| `NODE_ENV` | Environment | Yes | `development` |
| `PORT` | Server port | No | `3000` |

**Удаляемые переменные** (Manus-specific):
- `BUILT_IN_FORGE_API_URL`
- `BUILT_IN_FORGE_API_KEY`
- `OAUTH_SERVER_URL` (если нет generic OAuth)

## 4. План по этапам

### P0 — Независимый запуск (обязательно)

**Этап 0.1: Удалить Manus Vite plugin и debug collector**
- Удалить `vite-plugin-manus-runtime` из `package.json` и `vite.config.ts`
- Удалить `vitePluginManusDebugCollector` из `vite.config.ts`
- Удалить `client/public/__manus__/debug-collector.js`
- Обновить `allowedHosts` в `vite.config.ts` на production domain + localhost
- **Файлы**: `package.json`, `vite.config.ts`, `client/public/__manus__/debug-collector.js`

**Этап 0.2: Удалить Forge API зависимости**
- Удалить voice transcription (`server/_core/voiceTranscription.ts`) или заменить на独立 provider
- Удалить image generation via Forge (`server/_core/imageGeneration.ts`) или заменить
- Удалить Maps proxy (`server/_core/map.ts`) или заменить
- Удалить Notifications via Forge (`server/_core/notification.ts`) или заменить
- Удалить Data API (`server/_core/dataApi.ts`)
- Удалить Heartbeat (`server/_core/heartbeat.ts`)
- Очистить `server/_core/env.ts` от `forgeApiUrl`/`forgeApiKey`
- **Файлы**: перечисленные выше + `server/_core/index.ts` (imports)

**Этап 0.3: Заменить Manus Storage на прямые S3**
- Удалить `server/storage.ts` (Forge-based)
- Удалить `server/_core/storageProxy.ts` (route `/manus-storage/*`)
- Создать `server/storage-s3.ts` с прямыми AWS SDK calls:
  - `storagePut`: generate presigned PUT URL via AWS SDK
  - `storageGet`: return presigned GET URL or S3 key
  - `storageGetSignedUrl`: presigned GET via AWS SDK
- Обновить routes в `server/_core/index.ts` (заменить `registerStorageProxy` на `registerS3Storage`)
- Обновить `client/src/lib/chat-export-pdf.ts` (убрать hardcoded `/manus-storage/`)
- Обновить `server/attachments.ts` (storage paths)
- **Файлы**: `server/storage.ts`, `server/_core/storageProxy.ts`, `server/_core/index.ts`, `client/src/lib/chat-export-pdf.ts`, `server/attachments.ts`, `server/chat-exports.ts`

**Этап 0.4: Удалить Manus WebDev SDK/types**
- Удалить `server/_core/types/manusTypes.ts`
- Удалить `server/_core/sdk.ts` или переписать на Stytch-only
- Удалить `server/_core/oauth.ts` (Manus OAuth) или заменить на generic
- Обновить `server/_core/index.ts` (убрать `registerOAuthRoutes` если удалён)
- Удалить `server/_core/oauth.callback.test.ts` если удалён OAuth
- **Файлы**: `server/_core/sdk.ts`, `server/_core/types/manusTypes.ts`, `server/_core/oauth.ts`, `server/_core/index.ts`, `server/_core/oauth.callback.test.ts`

**Этап 0.5: Обновить OpenRouter referer**
- Заменить `https://kairema.manus.space` на env var `APP_URL` или реальный domain
- **Файлы**: `server/providers.ts:430`

**Критерий успеха P0**:
- `pnpm install` проходит без `vite-plugin-manus-runtime` и Forge SDK
- `pnpm run dev` запускается на `http://localhost:3000`
- Приложение загружается, 4 роли отображаются
- Stytch auth работает (magic link / password)
- Chat, memory, attachments работают
- Storage работает через прямые S3 presigned URLs
- Все тесты проходят: `pnpm test`

### P1 — Функциональная совместимость

**Этап 1.1: Очистка env и cookie comments**
- Убрать Manus-специфичные комментарии из `shared/const.ts` про `*.manus.space`
- Переименовать/удалить `OAUTH_STATE_COOKIE` если нет OAuth
- **Файлы**: `shared/const.ts`, `server/_core/cookies.ts`

**Этап 1.2: Generic OAuth (если нужен)**
- Добавить `openid-client` или passport.js стратегию
- Настроить Google/GitHub OAuth
- Обновить `server/routers.ts` auth procedures
- **Файлы**: новые файлы в `server/_core/oauth/`, `server/routers.ts`

**Этап 1.3: Owner logic hardening**
- Добавить graceful disable: если `OWNER_OPEN_ID` не задан → owner endpoints возвращают 403 с понятным message
- **Файлы**: `server/routers.ts`, `server/_core/env.ts`

**Критерий успеха P1**:
- Production build (`pnpm run build`) завершается без SIGTERM
- Приложение развёртывается на VPS/Cloud Run без Manus-специфичных env vars
- Owner analytics доступны при заданном `OWNER_OPEN_ID`
- Все тесты проходят

### P2 — Дополнительно

**Этап 2.1: CI/CD и deployment configs**
- Добавить `Dockerfile`, `docker-compose.yml`
- Добавить GitHub Actions workflow для deploy
- **Файлы**: новые

**Этап 2.2: Мониторинг и observability**
- Добавить structured logging (Pino/Winston)
- Добавить health check endpoint
- **Файлы**: новые/изменённые в `server/_core/`

**Этап 2.3: Rate limiting и security hardening**
- Добавить express-rate-limit
- Добавить helmet
- **Файлы**: `server/_core/index.ts`

**Критерий успеха P2**:
- Docker image собирается и запускается
- Health check возвращает 200
- Логи структурированы

## 5. Риски и Mitigation

| Риск | Mitigation |
|------|-----------|
| Storage proxy `/manus-storage/*` используется в production | Сначала обновить all references, затем депрекейтить старый route с 301 redirect |
| Stytch auth — vendor lock-in | Stytch остаётся primary, но архитектура позволяет добавить generic OAuth позже |
| Web search providers имеют fallback | Удаление одного каскада не ломает поиск, если настроены alternatives |
| AI provider keys в env | Уже в env, не hardcoded. Для production использовать secret manager |
| Production build SIGTERM | Изолировать сборку, проверить memory limits, возможно esbuild config tweaks |

## 6. Валидация на каждом этапе

1. **После P0**: `pnpm check`, `pnpm test`, `pnpm run build` — все проходят. Приложение работает на localhost без Manus env vars.
2. **После P1**: staging deploy, smoke test (4 roles, auth, chat, memory, attachments, exports).
3. **После P2**: production deploy, monitoring active, logs структурированы.

## 7. Out of scope (на первом этапе)

- Изменение архитектуры (не переписываем, только отвязываем)
- Изменение AI provider chains или моделей
- Изменение схемы БД или миграций
- Изменение UI/UX
- Добавление новых функций
- Миграция с MySQL на другую БД
