# Kairema Development Runtime Environment — Architectural Audit

## Executive Summary

Kairema is a **Manus WebDev template** runtime with tightly coupled dependencies on Manus-provided infrastructure. There is **no existing local development setup** (no `.env.example`, no `docker-compose.yml`, no Dockerfile, no SQLite fallback). The database layer is **MySQL-only** via Drizzle ORM with MySQL-specific schema constructs. Authentication requires either the **Manus OAuth server** or **Stytch** — there is **no dev bypass or mock mode** in production code. At minimum, a functional local E2E environment requires a running MySQL instance, valid Manus OAuth credentials (or Stytch), at least one LLM provider API key, and the Forge storage credentials.

---

## 1. Database Layer

### Driver & Dialect

| Property | Value | Location |
|----------|-------|----------|
| **ORM** | Drizzle ORM | `drizzle-orm` v0.44.x (package.json:62) |
| **Driver** | `mysql2` | `server/db.ts:2` — `import { drizzle } from "drizzle-orm/mysql2"` |
| **Dialect** | MySQL | `drizzle.config.ts:11` — `dialect: "mysql"` |
| **Connection string** | `process.env.DATABASE_URL` | `server/db.ts:14,16` |

### Schema Characteristics (MySQL-Specific)

The schema (`drizzle/schema.ts:1`) uses MySQL-only constructs:
- `mysqlTable()` — line 1
- `mysqlEnum("role", ["user", "admin"])` — line 9
- `int("id").autoincrement().primaryKey()` — line 4
- `timestamp("updatedAt").defaultNow().onUpdateNow()` — line 11
- `uniqueIndex(...).on(table.provider, table.providerSubject)` — lines 29-30

**Conclusion: Drizzle cannot work with SQLite for this project without a full schema rewrite.** All tables, enums, and indexes are MySQL-specific.

### Test/Dev Database Setup

| File | Line | Status |
|------|------|--------|
| `server/db.memory.test.ts` | 31, 46 | **Mocks** `drizzle-orm/mysql2` with `vi.mock`; sets `process.env.DATABASE_URL = "mysql://test"` but never connects |
| `server/db.quota.test.ts` | 22, 28 | Same pattern — mocks drizzle, sets fake DATABASE_URL |
| `drizzle.config.ts` | 3-6 | **Throws** if `DATABASE_URL` is missing — blocks `pnpm db:push` |
| `server/db.ts` | 13-22 | `getDb()` returns `null` if `DATABASE_URL` is missing — **graceful degradation** at runtime |

**There is no existing local MySQL dev setup, no Docker Compose, no seed data, and no SQLite fallback.**

### Can Drizzle work with a local SQLite or test MySQL?

- **SQLite**: **No** — schema is MySQL-specific. Would require rewriting `drizzle/schema.ts` to use `sqliteTable`, `integer`, `text`, etc.
- **Test MySQL**: Theoretically yes, but no infrastructure exists. You would need:
  1. A running MySQL 8.0+ instance
  2. `DATABASE_URL=mysql://user:pass@localhost:3306/kairema_dev`
  3. Run `pnpm db:push` to create tables
  4. No seed data or migration snapshots exist for dev

---

## 2. Authentication / Session Layer

### Architecture Overview

The system has **two parallel auth paths** with Manus OAuth as primary and Stytch as fallback:

```
Incoming Request
    ├─→ Manus OAuth cookie (COOKIE_NAME = "app_session_id")
    │       └─→ JWT verify with JWT_SECRET
    │           └─→ getUserInfoWithJwt() → OAuth server
    │               └─→ upsertUser() → DATABASE
    │
    └─→ Stytch cookie (__Host-kairema-stytch-session)
            └─→ Stytch sessions.authenticate() → Stytch API
                └─→ resolveOrCreateProviderUser() → DATABASE
```

### Key Files & Line Numbers

| File | Lines | Purpose |
|------|-------|---------|
| `server/_core/sdk.ts` | 1-350 | **Core SDK** — Manus OAuth client, JWT session creation/verification |
| `server/_core/sdk.ts` | 31-76 | `OAuthService` class — calls Manus OAuth server |
| `server/_core/sdk.ts` | 156-197 | Session JWT creation/verification — requires `JWT_SECRET` |
| `server/_core/sdk.ts` | 258-320 | `authenticateRequest()` — main auth entry point |
| `server/_core/oauth.ts` | 32-86 | OAuth callback route `/api/oauth/callback` |
| `server/stytch-auth.ts` | 37-108 | Stytch callback route `/api/stytch/callback` |
| `server/stytch.ts` | 53-77 | Stytch client factory — requires `STYTCH_PROJECT_ID`, `STYTCH_SECRET`, `STYTCH_ENVIRONMENT` |
| `server/stytch.ts` | 87-100 | `getStytchCallbackUrl()` — requires `STYTCH_CALLBACK_BASE_URL` |
| `server/_core/context.ts` | 13-48 | tRPC context — tries Manus OAuth, falls back to Stytch |
| `server/_core/trpc.ts` | 22-37 | `protectedProcedure` — requires `ctx.user` from auth |
| `shared/const.ts` | 1-11 | `COOKIE_NAME = "app_session_id"`, `ONE_YEAR_MS`, `OAUTH_STATE_COOKIE` |

### Minimum Auth Setup for Local E2E

To authenticate any user (required for most routes), you need **at least one** of:

**Option A: Manus OAuth**
- `OAUTH_SERVER_URL` — Manus OAuth server endpoint (e.g., `https://manus.im`)
- `VITE_APP_ID` — OAuth client ID
- `JWT_SECRET` — any 32+ byte string for JWT signing
- The OAuth server must be reachable and return valid tokens

**Option B: Stytch Email Auth**
- `STYTCH_PROJECT_ID` — Stytch project ID
- `STYTCH_SECRET` — Stytch secret
- `STYTCH_ENVIRONMENT` — `test` or `live`
- `STYTCH_CALLBACK_BASE_URL` — HTTPS callback origin
- `JWT_SECRET` — still required for session signing
- A Stytch project with email magic links configured

### Dev/Test Auth Bypass or Mock Mode

**None exists in production code.** The `server/_core/sdk.ts:258-320` `authenticateRequest()` always attempts real OAuth or Stytch verification. There is no `DEV_MODE=true` bypass, no hardcoded test user, and no mock auth middleware.

Tests work by **mocking at the module level**:
- `server/dev-api.test.ts:12` — `vi.mock("./_core/sdk", () => ({ sdk: { authenticateRequest: fixtures.authenticateRequest } }))`
- `server/chat-stream.test.ts:6-9` — `vi.mock("./db", ...)` and overrides dependencies
- `server/attachment-upload.failure.test.ts:36-38` — passes mock `authenticateRequest`

**This means you cannot run the actual server with a mock auth layer without code changes.**

### Can we use a simple local session/JWT for dev without OAuth server?

**Not without code changes.** The current flow is:
1. Client hits `/api/oauth/callback` with a code
2. Server exchanges code for token via `sdk.exchangeCodeForToken()` → calls OAuth server
3. Server gets user info via `sdk.getUserInfo()` → calls OAuth server
4. Server creates JWT session token

There is no endpoint to mint a session from a raw openId. To add a dev bypass, you would need to add a new route (e.g., `/api/dev/login`) that creates a JWT directly from a provided openId.

---

## 3. Environment Variable Audit

### Complete Variable Catalog

| Variable | Source File:Line | Category | Required for Dev E2E | Current Status | Safe Dev Replacement | Production Impact | Next Action |
|----------|-----------------|----------|---------------------|----------------|---------------------|-------------------|-------------|
| `DATABASE_URL` | `server/db.ts:14`, `env.ts:4` | **Critical** | ✅ Yes | MySQL connection string | Local MySQL (`mysql://root:root@localhost:3306/kairema_dev`) | None — standard DB | Set up local MySQL |
| `JWT_SECRET` | `server/_core/sdk.ts:157-158`, `env.ts:3` | **Critical** | ✅ Yes | Any 32+ byte string | `dev-secret-key-please-change-1234567890` | **High risk if weak** — signs all sessions | Use strong random string |
| `OAUTH_SERVER_URL` | `server/_core/sdk.ts:33,80`, `env.ts:5` | **Critical** | ✅ Yes (if using Manus OAuth) | Manus OAuth endpoint | None without code changes | Blocks OAuth auth | Use Manus staging or add dev bypass |
| `VITE_APP_ID` | `server/_core/sdk.ts:50`, `env.ts:2` | **Critical** | ✅ Yes (if using Manus OAuth) | OAuth client ID | None without code changes | Blocks OAuth auth | Use Manus staging app ID |
| `STYTCH_PROJECT_ID` | `server/stytch.ts:73` | **Critical** | ✅ Yes (if using Stytch) | Stytch project ID | Stytch test project ID | None — test env is isolated | Create Stytch test project |
| `STYTCH_SECRET` | `server/stytch.ts:74` | **Critical** | ✅ Yes (if using Stytch) | Stytch secret | Stytch test secret | None — test env is isolated | Create Stytch test project |
| `STYTCH_ENVIRONMENT` | `server/stytch.ts:75,64-68` | **Critical** | ✅ Yes (if using Stytch) | `test` or `live-*` | `test` | None | Set to `test` |
| `STYTCH_CALLBACK_BASE_URL` | `server/stytch.ts:88` | **Critical** | ✅ Yes (if using Stytch) | HTTPS callback origin | `https://localhost:3000` | **Must be HTTPS in production** | Use localhost with HTTPS or HTTP-only dev mode |
| `BUILT_IN_FORGE_API_URL` | `server/_core/llm.ts:218`, `storage.ts:8`, `env.ts:8` | **Important** | ✅ Yes (for chat, attachments, storage) | Manus Forge API URL | None without code changes | Blocks storage proxy, LLM via Forge, notifications | Use Manus Forge endpoint |
| `BUILT_IN_FORGE_API_KEY` | `server/_core/llm.ts:223`, `storage.ts:9`, `env.ts:9` | **Important** | ✅ Yes (for chat, attachments, storage) | Manus Forge API key | None without code changes | Blocks storage proxy, LLM via Forge, notifications | Use Manus Forge key |
| `OWNER_OPEN_ID` | `server/routers.ts:81`, `env.ts:6` | **Optional** | ❌ No | Owner openId for admin routes | `test-owner-openid` | None — only gates owner features | Set for owner feature testing |
| `PORT` | `server/_core/index.ts:69` | **Optional** | ❌ No | Server port | Default `3000` | None | Leave unset |
| `NODE_ENV` | `server/_core/index.ts:63`, `vite.ts:52` | **Optional** | ❌ No | `development` or `production` | `development` | Affects Vite vs static serving | Set to `development` |
| `OPENROUTER_API_KEY` | `server/providers.ts:214-233` | **Important** | ✅ Yes (needed for LLM) | OpenRouter API key | OpenRouter free-tier key | None — standard provider key | Get free OpenRouter key |
| `ORCAROUTER_API_KEY` | `server/providers.ts:216` | **Optional** | ❌ No | OrcaRouter API key | OrcaRouter key | None | Optional fallback |
| `ZENMUX_API_KEY` | `server/providers.ts:218` | **Optional** | ❌ No | ZenMux API key | ZenMux key | None | Optional fallback |
| `GEMINI_API_KEY` | `server/providers.ts:221` | **Optional** | ❌ No | Google AI Studio key | Google AI key | None | Optional fallback |
| `GROQ_API_KEY` | `server/providers.ts:224` | **Optional** | ❌ No | Groq API key | Groq key | None | Optional fallback |
| `SAMBANOVA_API_KEY` | `server/providers.ts:226` | **Optional** | ❌ No | SambaNova API key | SambaNova key | None | Optional fallback |
| `MISTRAL_API_KEY` | `server/providers.ts:228` | **Optional** | ❌ No | Mistral API key | Mistral key | None | Optional fallback |
| `CEREBRAS_API_KEY` | `server/providers.ts:230` | **Optional** | ❌ No | Cerebras API key | Cerebras key | None | Optional fallback |
| `DEEPSEEK_API_KEY` | `server/providers.ts:232` | **Optional** | ❌ No | DeepSeek API key | DeepSeek key | None | Optional fallback |
| `YOU_API_KEY` | `server/web-search.ts:232,236` | **Optional** | ❌ No | You.com search key | You.com key | None | Optional — web search |
| `SERPER_API_KEY` | `server/web-search.ts:232,236` | **Optional** | ❌ No | Serper.dev search key | Serper key | None | Optional — web search |
| `EXA_API_KEY` | `server/web-search.ts:232,236` | **Optional** | ❌ No | Exa.ai search key | Exa key | None | Optional — web search |
| `TAVILY_API_KEY` | `server/web-search.ts:232,236` | **Optional** | ❌ No | Tavily search key | Tavily key | None | Optional — web search |
| `API_KEY_DOTS3` | `server/providers.ts:221` | **Optional** | ❌ No | Dots Studio API key | Dots key | None | Optional fallback |

### Categorization Summary

| Category | Count | Variables |
|----------|-------|-----------|
| **Critical** (blocks startup/core auth) | 8 | `DATABASE_URL`, `JWT_SECRET`, `OAUTH_SERVER_URL`, `VITE_APP_ID`, `STYTCH_PROJECT_ID`, `STYTCH_SECRET`, `STYTCH_ENVIRONMENT`, `STYTCH_CALLBACK_BASE_URL` |
| **Important** (blocks E2E chat) | 2 | `BUILT_IN_FORGE_API_URL`, `BUILT_IN_FORGE_API_KEY` |
| **Important** (blocks LLM generation) | 1+ | At least one of: `OPENROUTER_API_KEY`, `ORCAROUTER_API_KEY`, `ZENMUX_API_KEY`, `GEMINI_API_KEY`, `GROQ_API_KEY`, etc. |
| **Optional** (enhances functionality) | 7 | `OWNER_OPEN_ID`, `PORT`, `NODE_ENV`, web search keys, other provider keys |

---

## 4. Route / Service Dependency Matrix

### Public Routes (No Auth Required)

| Route | File:Line | Dependencies | Blocks Without |
|-------|-----------|-------------|----------------|
| `GET /api/trpc/system/health` | `server/_core/systemRouter.ts:6-14` | None | Nothing — always works |
| `GET /api/trpc/models/list` | `server/routers.ts:258` | None | Nothing — returns model config |
| `GET /manus-storage/*` | `server/_core/storageProxy.ts:4-47` | `BUILT_IN_FORGE_API_URL`, `BUILT_IN_FORGE_API_KEY` | Returns 500 if missing |
| `GET /api/trpc/knowledge/status` | `server/routers.ts:431` | None (soft fail) | Nothing — returns empty if no DB |

### Authenticated Routes (Require Valid Session)

| Route | File:Line | Dependencies | Blocks Without |
|-------|-----------|-------------|----------------|
| `POST /api/oauth/callback` | `server/_core/oauth.ts:33` | `OAUTH_SERVER_URL`, `VITE_APP_ID`, `JWT_SECRET`, `DATABASE_URL` | Entire OAuth flow |
| `GET /api/stytch/callback` | `server/stytch-auth.ts:38` | All `STYTCH_*` vars, `JWT_SECRET`, `DATABASE_URL` | Entire Stytch flow |
| `POST /api/chat/stream` | `server/chat-stream.ts:534` | Auth + `DATABASE_URL` + ≥1 provider API key | Chat streaming |
| `tRPC auth.me` | `server/routers.ts:145` | Auth | Returns null without DB |
| `tRPC auth.logout` | `server/routers.ts:146-154` | Auth + `DATABASE_URL` | Logout (soft fail) |
| `tRPC chats.list/create/messages/...` | `server/routers.ts:503-631` | Auth + `DATABASE_URL` + provider key (for send) | All chat operations |
| `tRPC settings.get/update` | `server/routers.ts:356-370` | Auth + `DATABASE_URL` | Settings |
| `tRPC memory.get/update/...` | `server/routers.ts:372-410` | Auth + `DATABASE_URL` | Memory features |
| `tRPC search.query` | `server/routers.ts:412-421` | Auth + `DATABASE_URL` | Search |
| `tRPC providers/dashboard` | `server/routers.ts:261` | Auth + `DATABASE_URL` | Provider dashboard |
| `tRPC attachments.list/upload/...` | `server/routers.ts:443-473` | Auth + `DATABASE_URL` + `BUILT_IN_FORGE_API_URL/KEY` | Attachments |
| `tRPC exports.list/create/...` | `server/routers.ts:475-501` | Auth + `DATABASE_URL` | Chat exports |
| `POST /api/attachments/upload` | `server/attachment-upload.ts:62` | Auth + `DATABASE_URL` + storage | Binary uploads |
| `POST /api/dev` | `server/dev-api.ts:21` | Admin auth + provider key | Dev API (admin only) |

### Routes Completely Blocked Without Specific Variables

| Variable | Blocked Routes |
|----------|---------------|
| **No `DATABASE_URL`** | All auth routes, all chat routes, all settings/memory/search routes, all attachment/export routes, Stytch callback |
| **No `JWT_SECRET`** | OAuth callback (cannot sign session), Stytch callback (cannot sign session), any session verification |
| **No `OAUTH_SERVER_URL`** | `/api/oauth/callback` — completely non-functional |
| **No `STYTCH_PROJECT_ID`/`STYTCH_SECRET`** | `/api/stytch/callback` — completely non-functional |
| **No `BUILT_IN_FORGE_API_URL`/`BUILT_IN_FORGE_API_KEY`** | `/manus-storage/*`, attachment uploads/downloads, LLM via Forge (`server/_core/llm.ts:218-226`), owner notifications |
| **No provider API keys** | Chat streaming (`server/providers.ts:213-234` — `secretFor()` returns undefined, all candidates marked `unconfigured`) |

---

## 5. Existing Dev/Test Infrastructure

### Package.json Scripts (`package.json:6-20`)

| Script | Command | Purpose |
|--------|---------|---------|
| `dev` | `NODE_ENV=development tsx watch server/_core/index.ts` | Dev server with hot reload |
| `build` | `vite build && esbuild server/_core/index.ts --platform=node --packages=external --bundle --format=esm --outdir=dist` | Production build |
| `start` | `NODE_ENV=production node dist/index.js` | Production start |
| `test` | `vitest run` | Run all tests |
| `db:push` | `drizzle-kit generate && drizzle-kit migrate` | Generate and apply DB migrations |
| `benchmark:*` | Various `tsx scripts/...` | Load/storage benchmarks |

### Missing Infrastructure

| Item | Status |
|------|--------|
| `.env.example` | **Does not exist** |
| `.env.test` | **Does not exist** |
| `.env.local` | **Does not exist** |
| `docker-compose.yml` | **Does not exist** |
| `Dockerfile` | **Does not exist** |
| `docker/` directory | **Does not exist** |
| Seed data / fixtures | **Does not exist** |
| SQLite fallback config | **Does not exist** |

### Test Infrastructure (`vitest.config.ts`)

| Setting | Value |
|---------|-------|
| Environment | `node` |
| Include patterns | `server/**/*.test.ts`, `server/**/*.spec.ts`, `client/**/*.test.ts`, `client/**/*.test.tsx` |
| Aliases | `@shared` → `shared/`, `@` → `client/src/` |

### Test Mocking Patterns

The test suite uses **heavy module-level mocking**:

| Test File | Pattern |
|-----------|---------|
| `server/db.memory.test.ts:31` | `vi.mock("drizzle-orm/mysql2", () => ({ drizzle: () => mockDb }))` |
| `server/db.quota.test.ts:22` | Same drizzle mock pattern |
| `server/chat-stream.test.ts:6-9` | `vi.mock("./db", ...)` + dependency injection via `createChatStreamHandler(overrides)` |
| `server/dev-api.test.ts:12-14` | `vi.mock("./_core/sdk", ...)` + `vi.mock("./db", ...)` + `vi.mock("./providers", ...)` |
| `server/attachment-upload.failure.test.ts:35-38` | Direct dependency injection with mock `authenticateRequest` and `upload` |

**No test file tests the actual HTTP server with real auth.** All tests mock at the module boundary.

---

## 6. Recommended Shortest Safe Path to Local E2E

### Prerequisites

1. **MySQL 8.0+ instance** — local Docker, Homebrew, or cloud
2. **At least one LLM provider API key** — OpenRouter free tier is easiest
3. **Manus OAuth credentials** OR **Stytch test project**

### Step-by-Step

```bash
# 1. Start MySQL
docker run --name kairema-mysql \
  -e MYSQL_ROOT_PASSWORD=root \
  -e MYSQL_DATABASE=kairema_dev \
  -p 3306:3306 \
  -d mysql:8.0

# 2. Install dependencies
pnpm install

# 3. Create .env file
cat > .env << 'EOF'
NODE_ENV=development
DATABASE_URL=mysql://root:root@localhost:3306/kairema_dev
JWT_SECRET=dev-secret-key-at-least-32-bytes-long-1234567890
VITE_APP_ID=your-manus-app-id
OAUTH_SERVER_URL=https://manus.im
BUILT_IN_FORGE_API_URL=https://forge.manus.im
BUILT_IN_FORGE_API_KEY=your-forge-api-key
OPENROUTER_API_KEY=your-openrouter-key
EOF

# 4. Push schema
pnpm db:push

# 5. Start dev server
pnpm dev
```

### Minimal Variables for Basic E2E (OAuth path)

| Variable | Why Needed |
|----------|-----------|
| `DATABASE_URL` | All user data, sessions, chat history |
| `JWT_SECRET` | Session signing/verification |
| `VITE_APP_ID` | OAuth client identification |
| `OAUTH_SERVER_URL` | Token exchange and user info |
| `OPENROUTER_API_KEY` | LLM generation (primary fallback chain) |
| `BUILT_IN_FORGE_API_URL` | LLM API routing |
| `BUILT_IN_FORGE_API_KEY` | LLM API authentication |

### Minimal Variables for Basic E2E (Stytch path)

| Variable | Why Needed |
|----------|-----------|
| `DATABASE_URL` | All user data, sessions, chat history |
| `JWT_SECRET` | Session signing/verification |
| `STYTCH_PROJECT_ID` | Stytch authentication |
| `STYTCH_SECRET` | Stytch authentication |
| `STYTCH_ENVIRONMENT` | `test` |
| `STYTCH_CALLBACK_BASE_URL` | `https://localhost:3000` |
| `OPENROUTER_API_KEY` | LLM generation |
| `BUILT_IN_FORGE_API_URL` | LLM API routing |
| `BUILT_IN_FORGE_API_KEY` | LLM API authentication |

### Critical Gaps That Require Code Changes for True Local E2E

1. **No dev auth bypass** — You cannot bypass OAuth/Stytch without modifying `server/_core/sdk.ts:258-320` or adding a new dev auth route. All protected routes require a valid external auth flow.

2. **No SQLite support** — The schema is MySQL-specific. For fully offline dev, you would need to either:
   - Add a SQLite schema variant, or
   - Use a MySQL test container (recommended)

3. **Storage proxy requires Forge** — `server/_core/storageProxy.ts:12-14` returns 500 if Forge credentials are missing. Attachments (`server/attachments.ts:74`) call `storagePut()` which requires Forge. For offline dev, you would need a local S3-compatible mock (e.g., MinIO) or a storage bypass.

4. **Cookie `secure` flag** — `server/_core/cookies.ts:46` sets `secure: isSecureRequest(req)`. On `http://localhost`, cookies won't have the `Secure` flag, which is correct for HTTP. But if you use HTTPS locally, cookies work. The `sameSite: "none"` setting (`server/_core/cookies.ts:45`) requires `Secure` in modern browsers, which creates a catch-22 for local HTTP dev.

---

## 7. Variable/Service Table Summary

| Variable/Service | Required for Dev E2E | Current Status | Safe Dev Replacement | Production Impact | Next Action |
|-------------------|---------------------|----------------|---------------------|-------------------|-------------|
| MySQL (DATABASE_URL) | ✅ Critical | No local instance | Docker MySQL or local install | None | Start MySQL, set DATABASE_URL |
| JWT_SECRET | ✅ Critical | Any value works | Random 32+ byte string | **High if weak** — use strong random | Generate strong secret |
| OAUTH_SERVER_URL | ✅ Critical | Manus-only endpoint | None without code changes | Blocks Manus OAuth | Use Manus staging or add dev bypass |
| VITE_APP_ID | ✅ Critical | Manus-only ID | None without code changes | Blocks OAuth | Use Manus staging app |
| STYTCH_PROJECT_ID | ✅ Critical (Stytch path) | Stytch-only | Stytch test project | None — test env isolated | Create Stytch test project |
| STYTCH_SECRET | ✅ Critical (Stytch path) | Stytch-only | Stytch test secret | None — test env isolated | Create Stytch test project |
| STYTCH_ENVIRONMENT | ✅ Critical (Stytch path) | Required | `test` | None | Set to `test` |
| STYTCH_CALLBACK_BASE_URL | ✅ Critical (Stytch path) | Required | `https://localhost:3000` | Must be HTTPS in prod | Use localhost |
| BUILT_IN_FORGE_API_URL | ✅ Important | Manus-only | None without code changes | Blocks storage + Forge LLM | Use Manus Forge endpoint |
| BUILT_IN_FORGE_API_KEY | ✅ Important | Manus-only | None without code changes | Blocks storage + Forge LLM | Use Manus Forge key |
| ≥1 LLM Provider Key | ✅ Important | Multiple options | OpenRouter free key | None — standard provider | Get OpenRouter free key |
| OPENROUTER_API_KEY | ✅ Important | OpenRouter | Free tier key | None | Register at openrouter.ai |
| ORCAROUTER_API_KEY | ❌ Optional | OrcaRouter | OrcaRouter key | None | Optional fallback |
| ZENMUX_API_KEY | ❌ Optional | ZenMux | ZenMux key | None | Optional fallback |
| GEMINI_API_KEY | ❌ Optional | Google AI | Google AI key | None | Optional fallback |
| GROQ_API_KEY | ❌ Optional | Groq | Groq key | None | Optional fallback |
| Other provider keys | ❌ Optional | Various | Various | None | Optional fallbacks |
| Web search keys (YOU, SERPER, EXA, TAVILY) | ❌ Optional | Various | Various | None | Optional — web search |
| OWNER_OPEN_ID | ❌ Optional | Any openId | `test-owner` | None — gates owner features only | Set for owner testing |
| PORT | ❌ Optional | Default 3000 | Unset | None | Leave unset |
| NODE_ENV | ❌ Optional | `development` | `development` | Affects Vite vs static | Set to `development` |

---

## 8. Code Locations Reference

### Database Layer
- `server/db.ts:1-22` — Drizzle MySQL connection, graceful null return
- `server/db.ts:196-198` — `requireDatabase()` throws on null
- `server/db.ts:24-45` — `upsertUser()` with MySQL `onDuplicateKeyUpdate`
- `drizzle.config.ts:1-15` — Drizzle Kit config, throws without DATABASE_URL
- `drizzle/schema.ts:1-100` — MySQL-specific schema definitions

### Auth Layer
- `server/_core/sdk.ts:31-76` — OAuthService class
- `server/_core/sdk.ts:156-197` — JWT session creation/verification
- `server/_core/sdk.ts:258-320` — `authenticateRequest()` — main auth gate
- `server/_core/oauth.ts:32-86` — OAuth callback route
- `server/stytch.ts:53-77` — Stytch client factory
- `server/stytch.ts:87-100` — Stytch callback URL builder
- `server/stytch-auth.ts:37-108` — Stytch callback handler
- `server/_core/context.ts:13-48` — tRPC auth context
- `server/_core/trpc.ts:22-37` — `protectedProcedure` middleware
- `shared/const.ts:1-11` — Cookie names, timeouts, error messages

### Env Variables
- `server/_core/env.ts:1-10` — Central ENV object
- `server/_core/llm.ts:217-226` — Forge API URL/key resolution
- `server/providers.ts:213-234` — Per-provider API key resolution
- `server/web-search.ts:232-236` — Web search API key resolution
- `server/stytch.ts:53-57` — Stytch env var validation

### Routes
- `server/_core/index.ts:39-83` — Server startup, route registration
- `server/routers.ts:142-635` — All tRPC routes
- `server/chat-stream.ts:533-535` — SSE chat route
- `server/attachment-upload.ts:62-67` — Binary upload route
- `server/dev-api.ts:20-54` — Admin dev API
- `server/_core/systemRouter.ts:1-29` — Health check
- `server/_core/storageProxy.ts:4-47` — Storage proxy route

### Storage/Attachments
- `server/storage.ts:7-18` — Forge config requirement
- `server/attachments.ts:64-86` — Attachment upload with storagePut
