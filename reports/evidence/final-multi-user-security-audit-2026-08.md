# KAIREMA — FINAL MULTI-USER + SECURITY AUDIT

**Дата:** 26 августа 2026 г.  
**Граница аудита:** deterministic/read-only source review и focused no-network regressions. Реальные пользовательские записи, S3-объекты, внешние LLM/search/email providers, Stytch delivery и production build не открывались и не вызывались.

> **Статусы.** `PASS` — доказано исходным кодом и focused test; `FIXED` — в этом этапе устранён конкретный дефект с regression; `UNMEASURED` — не может быть честно подтверждён в согласованной local/no-network границе; `EXTERNAL BLOCKER` — зависит от внешней платформы или ранее заблокированного провайдера.

## AUTH/SESSION

**PASS (code-level).** Protected procedures получают identity только из verified server context; tests покрывают first-launch boundary, session-auth и Stytch security adapter. Доверие к `user_id`, переданному клиентом, не является входным контрактом защищённых procedures. Canonical user ID прокидывается в owner-scoped DB helpers, а intent для Stytch link привязан к текущей server identity. [1] [2]

| Проверка | Статус | Доказательство |
|---|---|---|
| Server-derived user identity | PASS | `session-auth` и `auth.first-launch-boundary`: 4 focused assertions [1] |
| Login/register/callback code boundaries | PASS | `stytch.security`: 4 stubbed security assertions [2] |
| Live email/Magic Link delivery | EXTERNAL BLOCKER | Ранее зафиксированный Stytch EmailDelivery HTTP 400; повторная доставка намеренно не запускалась |
| Cross-browser/session-cookie production acceptance | UNMEASURED | Не выполнялась в sandbox boundary |

## USER ISOLATION/IDOR

**PASS.** Две synthetic identities (`101` и `202`) доказательно изолированы: foreign session отклоняется до чтения messages или exports. Router-level tests проверяют предсказуемый `NOT_FOUND` для чужого chat ID, attachment list, export list/create/download/delete. Memory, profile/settings и notifications используют authenticated server user scope. [3] [4] [5]

| Объект | Статус | Результат |
|---|---|---|
| Chats/messages | PASS | Session ownership проверяется до reads/mutations |
| Memory/profile/settings | PASS | User-scoped helpers и router tests |
| Attachments | PASS | Metadata и binary route привязаны к server identity |
| Exports/drafts | PASS | Chat-owner-scoped tRPC contracts и foreign-ID denial |
| Notifications/owner resources | PASS | User settings scope сохранён; operational owner guards усилены в этом этапе |

## CHAT/MESSAGES

**PASS.** Chat ingress использует durable user/session/client-message idempotency, stored replay и controlled pending-replay path. Конкурентная duplicate send не должна запускать второй model invocation; transcript reader проверяет owner session и берёт bounded ordered window. Full stored history и cursor UI pagination не менялись. [6] [7]

## MEMORY

**PASS (code-level).** Extraction claim использует durable candidate/CAS semantics; completed assistant turn служит stable identity для extraction. Tests покрывают idempotent no-op, parallel contender semantics, user scope и bounded context injection. Unified Memory не удалялась, не обрезалась и не получила нового semantic-list policy. [8] [9]

## ATTACHMENTS

**PASS (stubbed/code-level).** Upload/download/vision paths получают authenticated identity server-side; object-key namespace содержит owner и session. Focused lifecycle tests покрывают ownership, validation и storage-error contract. Реальный S3, raw file bytes и чужие реальные attachments не использовались. [3] [10]

## EXPORTS

**PASS (chat-owner scope).** Create/history/download/delete используют owner-scoped chat/export helpers и возвращают `NOT_FOUND` до выдачи foreign export metadata или signed URL. Duplicate/retention contracts покрыты no-network tests. Это не меняет существующий persistent export lifecycle, schema или `chat_exports`/DROP gate. [4] [11]

## DRAFTS

**PASS.** Router regression проверяет chat/user scoping и сохранение draft contract. Existing max-size, clear/send и concurrency behaviour не переписывались; audited path сохраняет server identity boundary. UI browser acceptance autosave не выполнялась. [12]

## RATE LIMITS

**PASS (chat ingress).** Durable per-user fixed-window quota защищает ordinary chat stream; controlled `429` содержит `Retry-After`, а unavailable quota storage fails closed with `503` до history/provider work. Owner Dev API quota остаётся отдельной. [6] [13]

**UNMEASURED (остальные группы).** В данном этапе не вводилась новая central rate-limit policy для login/register/resend/reset/search/upload/export because that would require a separate endpoint-by-endpoint product/security decision and could change production behaviour. Реальные IP-, edge- и provider-side limits не измерялись.

## SSE

**PASS (process-local boundary).** Admission guard ограничивает stream до `12` active/process и `2` active/user/process; saturation получает controlled pre-provider `503`, a `finally` releases the slot. Replay and quota tests include concurrent synthetic requests. Межpod coordination намеренно не заявляется без запрещённой shared infrastructure. [6] [14]

## ROUTER/PROVIDERS

**PASS (stubbed).** Public registry сохраняет ровно четыре роли: Flash, Think, Context и Apex. Active chain ограничен максимум четырьмя network attempts; allowlist, cooldown/health, retry classification и no-fifth-attempt contract покрыты 29 deterministic provider assertions. Никакой provider request в рамках audit не выполнялся. [15]

## SEARCH/RAG

**FIXED / PASS.** Source review обнаружил, что authenticated non-owner мог вызвать external operational mutations `webSearch.probe` и RSS-writing `knowledge.refresh`. Это не раскрывало чужие данные, но нарушало least privilege и позволяло не-владельцу расходовать operational resources. Обе mutations переведены на существующий verified owner guard; read-only status DTO не изменён. New no-network denial regression доказывает `FORBIDDEN` до probe/RSS work. Existing cascade, order, bounded behavior и honest unavailable state не менялись. [16] [17]

## ERROR HANDLING

**PASS (focused paths).** Foreign resources map to safe `NOT_FOUND`; owner-only operational mutations map to `FORBIDDEN`; quota and capacity use controlled `429`/`503`. Provider tests preserve public error classification without upstream response body disclosure. Client-stream parser regression covers safe event parsing. Comprehensive HTTP fuzzing and all browser-rendered error states остаются `UNMEASURED`. [4] [6] [15] [18]

## SECURITY

**PASS (source/test scope).** Audit found no change that sends secrets to client code or records private chat content in diagnostics. Existing owner guard, verified context, scoped storage keys and signed-download boundaries remain intact. The only verified access-control defect was the operational probe access noted above and is `FIXED`.

**UNMEASURED.** Static production bundle secret scan, third-party dependency/SBOM scan, CSP/header penetration tests, live OAuth redirect and S3 authorization probing were outside the agreed no-network audit boundary.

## PRIVACY

**PASS.** Owner runtime observability remains metadata-only; focused tests assert absence of prompts, responses, tokens, IDs and secret-bearing payloads in the exposed snapshot. Search quality telemetry excludes query, URL, user ID, provider and model fields. This audit itself used only synthetic IDs and mocks. [19] [17]

## GRACEFUL DEGRADATION

| Component failure | Статус | Deterministic evidence |
|---|---|---|
| LLM/provider failure and retry selection | PASS | Stubbed provider chains/classification; no private provider body exposure [15] |
| Search provider failure | PASS | Stubbed cascade/status tests retain unavailable/failure semantics [17] |
| Memory claim/extraction conflict | PASS | CAS/idempotent no-op tests [8] |
| Attachment/storage contract failure | PASS (stubbed) | Attachment lifecycle tests [10] |
| Export failure/retention contract | PASS (stubbed) | Export tests [11] |
| Auth/email provider failure | PASS (adapter) / EXTERNAL BLOCKER (delivery) | Stytch adapter security tests; no new delivery request [2] |
| Telemetry failure | PASS | Best-effort metadata instrumentation tests [19] |
| SSE capacity or quota failure | PASS | Controlled 503 / fail-closed quota tests [6] |

## CONCURRENCY

**PASS (bounded synthetic scope).** Tests cover durable replay, pending duplicate handling, quota isolation, memory CAS (`64` contenders / one winner), transcript upper anchor and stream admission. They do not create real 10K/50K sockets, real cross-pod transactions or production race workloads. [6] [8] [9]

## VERIFIED FAILURES

| Finding | Статус | Evidence-backed remediation |
|---|---|---|
| Authenticated non-owner could initiate `webSearch.probe` and `knowledge.refresh` operational work | FIXED | Added existing `requireOwner` guard to both mutations; denial regression proves no external operation begins for a synthetic non-owner [16] |

No other failure is claimed from a source-only or stubbed scenario.

## UNMEASURED/PLATFORM LIMITATIONS

Production build remains **UNMEASURED** due the retained sandbox SIGTERM/resource blocker. No capacity claim for 10K/50K users or cross-pod SSE coordination is made. Browser acceptance with populated real user data, production DB/S3 latency, TLS/header scanning, real OAuth cookie transitions and real provider quotas were intentionally not exercised.

Stytch Magic Link delivery remains **EXTERNAL BLOCKER**: the prior provider-side HTTP 400 has no confirmed coarse cause; no resend, mailbox access, provider mutation or Support escalation was performed.

## REQUIRED FIXES

**No further code fix is justified by this audit evidence.** The sole verified low-risk finding is fixed. Before any future change, a separate design/evidence stage is required for: a durable rate-limit policy across auth/search/upload/export endpoint groups; cross-pod coordination; production build/resource diagnosis; and live acceptance after the platform/runtime becomes available. None of these work items starts automatically from this report.

## VALIDATION

Final deterministic no-network validation PASS: **29 test files / 170 tests**. It covers auth/session, user isolation, chat/memory, attachments, exports, drafts, quota/SSE, provider/search, telemetry, safe parsing and owner controls. `pnpm check`, `git diff --check`, and strict required-heading checks PASS. Broad provider-oriented suites and production build are excluded.

## REFERENCES

[1]: ../../server/session-auth.test.ts "Session authentication regression"
[2]: ../../server/stytch.security.test.ts "Stytch adapter security regression"
[3]: ../../server/multiuser-boundaries.test.ts "Multi-user source-level boundaries"
[4]: ../../server/chat-ownership.router.test.ts "tRPC foreign-ID denial"
[5]: ../../server/settings.notifications.test.ts "Scoped notification settings"
[6]: ../../server/chat-stream.test.ts "Chat stream quota, replay and capacity"
[7]: ../../server/transcript-window.test.ts "Bounded owner-scoped transcript"
[8]: ../../server/chat-context.test.ts "Memory extraction and CAS semantics"
[9]: ../../server/db.memory.test.ts "Memory persistence scope"
[10]: ../../server/attachments.lifecycle.test.ts "Attachment lifecycle security"
[11]: ../../server/chat-export.test.ts "Export ownership and retention"
[12]: ../../server/chat-drafts.router.test.ts "Draft router scope"
[13]: ../../server/db.quota.test.ts "Durable quota contract"
[14]: ../../server/owner-observability-controls.test.ts "Runtime guards and metadata-only observability"
[15]: ../../server/providers.test.ts "Four-role provider registry and retry controls"
[16]: ../../server/operational-owner-guard.test.ts "Operational owner guard denial"
[17]: ../../server/web-search.test.ts "Search cascade and metadata-safe status"
[18]: ../../server/client-stream.test.ts "Safe stream parsing"
[19]: ../../server/owner-observability-controls.test.ts "Privacy-safe owner observability"
