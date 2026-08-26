# KAIREMA — Final Graceful Degradation / Failure Evidence

**Дата:** 26 августа 2026 года. **Базовая опубликованная версия:** `3743de10`. Этот этап выполнялся как deterministic no-network audit: не вызывались LLM, поиск, email/Stytch, S3, production DB, OAuth callback или provider quota. Synthetic fixtures и dependency injection использовались только в focused regression tests.

## COMPONENT

| Компонент | Проверяемая граница | Статус | Краткий итог |
|---|---|---:|---|
| LLM/provider chain | Flash/Think/Context/Apex, fallback, cooldown, malformed/HTTP failure | PASS | Сохраняются allowlist, Provider Health и максимум четыре generation attempts. |
| Web search/RAG | недоступность и HTTP classification разрешённых search paths | PASS | Возвращается честный unavailable/error path, без заявления успешного поиска. |
| Memory/context | extraction, CAS/retry, bounded transcript, user scope | PARTIAL PASS | Current policy сохраняет memory отдельно от chat flow; remote DB read fault не инжектировался. |
| Attachment upload/storage | invalid/oversized data, auth, unexpected storage/DB failure | FIXED | Неожиданная ошибка больше не возвращается клиенту как raw message. |
| Export | owner scope и error isolation | PASS | Сбой export path не является частью chat/history mutation и не открывает чужие exports. |
| Drafts | persistence/scope/retry contract | PARTIAL PASS | User/chat scope и deterministic mutation contract проверены; реальная transient DB fault не запускалась. |
| Stytch/auth | provider error, duplicate session/user prevention | PARTIAL PASS | Code-level safe contracts проверены; delivery остаётся external blocker и не вызывался. |
| Telemetry/owner analytics | owner-only DTO, metadata bounds, user-path independence | PARTIAL PASS | Контент и идентификаторы не экспортируются; реальный telemetry outage не инжектировался. |
| SSE admission | saturation, cancellation/release, cross-user isolation | PASS | Controlled 503 до provider call, 12/process и 2/user/process, release в `finally`. |
| Generic tRPC/API errors | unexpected database/storage throw, JSON-safe response | FIXED | Internal error normalised to stable JSON-safe message without stack data. |

## FAILURE SIMULATION

| Сценарий | Модель отказа | Ожидаемое поведение | Actual result | Статус |
|---|---|---|---|---:|
| Один LLM candidate недоступен | mocked transport/provider failure | Следующий разрешённый candidate или controlled result | Provider tests подтвердили fallback и счётчик не более 4 | PASS |
| Все LLM candidates недоступны | mocked exhausted chain | Non-fatal error без hang и без пятой попытки | Controlled completion/error path; UI transport не застревает | PASS |
| Malformed provider response | invalid streamed/parsed provider payload | Safe parsing failure и fallback/error | Malformed paths не интерпретируются как valid answer | PASS |
| LLM 401/403/429/5xx | mocked HTTP classification | Корректная классификация, без бессмысленного retry | Classification и cooldown/fallback contracts сохранены | PASS |
| Search 401/403/429/5xx | mocked search provider results | Следующий allowed path либо `search unavailable` | No fabricated fresh sources; unavailable state available | PASS |
| Memory extraction/retry | CAS/replay/scheduling fixture | Не терять и не перезаписывать чужую memory | User-scoped CAS и replay guards проходят | PASS |
| Attachment storage failure | injected error with synthetic internal text | 503 JSON, safe retry message, no raw internals | Ранее raw text мог вернуться из binary boundary; исправлено | FIXED |
| Attachment invalid/oversized | lifecycle and binary-boundary validation fixture | Deterministic rejection, no upload ownership bypass | 400/413 contract, auth before upload | PASS |
| Export failure/scope | mocked export/storage contract | Chat/history продолжают быть отдельными | Owner and post-read boundaries pass | PASS |
| Draft retry/persistence | deterministic router fixtures | Не смешивать users/chats и не дублировать mutation | Scoped contracts pass | PARTIAL PASS |
| Stytch/provider failure | SDK error fixtures, no delivery | Safe pending/error, no duplicate user/session | Code-level mappings pass; no new email sent | PASS |
| Telemetry/analytics failure | owner observability fixtures | User chat path не требует telemetry success | Metadata-only owner controls remain isolated | PARTIAL PASS |
| SSE capacity exhausted | 12/process, 2/user synthetic saturation | Controlled 503 до provider, no cross-user leak | Admission test passes; release observed | PASS |
| Database/storage unexpected throw | generic tRPC error shape | JSON-safe generic error, no stack/raw message | Missing formatter guard identified and fixed | FIXED |
| Invalid cursor | malformed/tampered/cross-session cursor fixture | Controlled `BAD_REQUEST`, no IDOR | Signed/session-bound cursor rejects input | PASS |
| Duplicate/retry/cancellation | replay key, abort and retry fixtures | No duplicate LLM generation/message/export operation | Replay and cancellation contracts pass | PASS |

> **Interpretation rule.** `PASS` means the listed deterministic code-level scenario passed with no external call. `PARTIAL PASS` means the security/contract portion passed, but a true remote service outage was deliberately not emulated. `FIXED` records a defect found by source and synthetic-boundary evidence and closed in this stage. It is not a production-capacity claim.

## EXPECTED BEHAVIOR

The failure posture is intentionally fail-closed for identity and ownership, controlled for capacity, and non-fatal for optional integrations. Provider, search, email, storage and export failures must neither impersonate success nor leak private state; core chat may degrade only according to current memory/search policy. Binary and RPC gateways must return structured JSON rather than an HTML fallback or raw infrastructure details.

All pre-existing product invariants remain in scope: four public roles, four-attempt cap, server allowlists and Provider Health, user-scoped memory, signed history cursor, bounded transcript, owner-only exports, secure attachments, drafts, no client-side secrets and owner-only operational probes.

## ACTUAL RESULT

The focused suite exercised **32 files / 175 tests** after both boundary changes. It covered deterministic provider/search classification, authentication, session state, two-user ownership, chat replay/SSE, attachment lifecycle, exports, drafts, memory/CAS, history cursor, transcript bounds, Stytch safe contracts, owner observability and tRPC/HTTP safe errors. It made no business-network request; OAuth initialization logs in isolated tests are framework startup diagnostics, not login or callback operations.

The audit found two evidence-backed safe-error gaps. No failure was found that justified changing role chains, auth/session mapping, schema, data, provider routing, search policy, memory semantics, pagination or infrastructure.

## FIXED ISSUES

| Finding | Minimal fix | Regression evidence |
|---|---|---|
| Unexpected attachment storage/database failure could propagate its raw `Error.message` through `/api/attachments/upload`. | Added explicit public validation-error type and mapped all unknown upload errors to `503` with a generic retry-safe Russian message. | `attachment-upload.failure.test.ts`: storage text is absent from JSON; safe validation and unauthenticated denial remain unchanged. |
| Core tRPC initialization lacked an explicit formatter for unexpected `INTERNAL_SERVER_ERROR`; default shape could retain an internal message/stack. | Added formatter that preserves deliberate `TRPCError` contracts but replaces unexpected message and removes stack data. | `trpc-error-boundary.test.ts`: formatter contract and existing 401/403 contracts are asserted. |

The attachment route was refactored only to accept injectable dependencies for deterministic failure simulation. Production wiring remains `sdk.authenticateRequest` plus `uploadOwnedChatAttachmentBytes`, and the server-derived `user.id` remains the sole upload owner scope.

## REGRESSION TESTS

The final focused no-network command explicitly ran the following groups: `auth.first-launch-boundary`, `auth.logout`, `session-auth`, `stytch.security`, `stytch.delivery-observability`, `chat-context`, `chat-drafts.router`, `chat-export`, `chat-exports`, `chat-ownership.router`, `chat-stream`, `client-export`, `client-stream`, `attachments.lifecycle`, `attachment-upload.failure`, `db.access`, `db.memory`, `db.quota`, `history-pagination`, `memory-extraction-schedule`, `memory.router`, `multiuser-boundaries`, `multiuser-owner-boundary`, `operational-owner-guard`, `owner-observability-controls`, `providers-v5.5`, `providers`, `search.quality-panel`, `transcript-window`, `trpc-error-boundary`, `user-scope.router` and `web-search`.

Final post-report validation passed with **32/32 files and 175/175 tests**; `pnpm check`, `git diff --check` and all seven required-heading checks also passed. Broad provider-oriented suites and production build are intentionally excluded.

## UNMEASURED LIMITATIONS

| Area | Why unmeasured | Status |
|---|---|---:|
| Real provider/search/email/S3/DB outage and timeout timing | Prohibited external calls and production data access | UNMEASURED |
| Stytch Magic Link delivery | Existing external HTTP 400 blocker; no resend or provider mutation allowed | EXTERNAL BLOCKER |
| Production DB read fault and adapter retry behaviour | No production DB or storage call permitted | UNMEASURED |
| Mobile radio/network loss and browser cancellation UX | No live browser/session acceptance in this stage | UNMEASURED |
| Multi-pod SSE coordination | Current guard is intentionally process-local; no Redis/queue infrastructure introduced | UNMEASURED |
| Production build/runtime resource behavior | Retained sandbox SIGTERM/resource blocker | UNMEASURED |

No index, migration, DDL/DML, schema reset, data deletion, provider switch, secret exposure, Stytch delivery attempt, role change or new infrastructure was performed. The task stops here; index work, new features and production capacity claims are deferred.
