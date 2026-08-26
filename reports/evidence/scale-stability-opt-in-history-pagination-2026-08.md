# KAIREMA SCALE & STABILITY — opt-in history pagination evidence

**Дата:** 26 августа 2026 года.  
**Статус:** реализация и evidence завершены без DDL, migration, index creation, transcript-window policy, memory-list изменения или новой инфраструктуры.

> **Классификация evidence.** «Проверено» означает текущий source contract, focused deterministic no-network regression или локально измеренный isolated benchmark. «Смоделировано» означает in-memory numeric history model без production DB/S3/router/provider. «Не измерено» означает отсутствие production cardinality, payload, query-plan timing, storage/network и capacity evidence. Ни один результат не заявляет production readiness для 10K/50K пользователей.

## PAGINATION CHANGES

Наиболее опасный подтверждённый unbounded path — сообщения одного chat session: legacy helper `listSessionMessages` оставлен без изменения для LLM context, exports и compatibility callers. Новый sibling path `listSessionMessagesPage` выполняет owned-session check, затем читает только bounded page. `chats.historyPage` — отдельная `protectedProcedure`; legacy `chats.messages` продолжает возвращать полный список прежним контрактом. [1] [2]

| Свойство | Реализация | Статус |
|---|---|---:|
| Default page size | 60 records | Enforced server-side |
| Maximum page size | 100 records | Enforced server-side |
| Initial retrieval | Latest page, descending DB retrieval; rows разворачиваются для chronological UI | Implemented |
| Older retrieval | Cursor tuple `(createdAt,id)` bound to one session | Implemented |
| End of history | `nextCursor=null`, UI does not offer another page | Implemented |
| Cursor input | Optional `before`, max 512 chars, server validation | Implemented |
| Legacy full history | Unchanged for context/export/old endpoint | Preserved |
| Memory lists / retrieval | Не менялись | Preserved |

Cursor opaque: it contains only pagination position plus an HMAC-derived session tag, is signed with already server-only secret material and does not expose content, user ID or raw session ID. Decode rejects malformed, tampered, cross-session and wrong-secret cursors by returning a controlled `BAD_REQUEST` (`Некорректный курсор истории.`). Cursor comparison is timing-safe. [1] [2]

## COMPATIBILITY

Изменён только authenticated **Home rendering path**: initial message rendering now calls `chats.historyPage({ sessionId, limit: 60 })`; older history is fetched on explicit user demand. Existing `chats.messages`, `listSessionMessages`, stream prompt construction, regeneration, exports, RAG/search, memory, attachment binary route, draft autosave and owner controls не были переведены на pagination и не получили скрытого cap. [2] [3]

`AIChatBox` показывает одну доступную кнопку загрузки ранних сообщений только при `hasOlderHistory`. Перед prepend сохраняется scroll height/top, после merge anchor восстанавливается, поэтому UI не должен перескакивать вниз. Home stores older rows per active session, deduplicates by message identifier and sorts chronologically for display. Session reference blocks a late response from a previous chat from being merged into newly selected chat. [3] [4]

| Compatibility boundary | Сохранённое поведение |
|---|---|
| Existing clients / `chats.messages` | Full-history response unchanged; нет silent truncation |
| LLM context | Full existing history path unchanged; transcript-window не вводился |
| Persistent exports | Existing full-history export and 1,000-message/2,000,000-character post-read gates unchanged |
| First Home page | Latest available messages render chronologically, with explicit option load older |
| New messages / stream completion | Page cache invalidated and initial bounded page is refreshed |
| Duplicate fetch / concurrent UI state | Merge deduplicates stable message IDs; cursor is session-anchored |

## SECURITY/ISOLATION

Page read starts from `getOwnedChatSession(serverDerivedUserId, sessionId)`. Cursor is additionally signed and session-bound; it cannot be reused for another session, and no client-supplied user ID exists. Query predicate remains scoped by session after ownership check, not by cursor alone. The feature remains behind `protectedProcedure` and does not create a public or owner-bypass endpoint. [1] [2]

| Contract | Evidence |
|---|---|
| User/IDOR isolation | Owned-session lookup precedes page query; focused source contract verifies scope |
| Chat isolation | Signed session tag invalidates cross-session cursor replay |
| Tamper resistance | HMAC verification and timing-safe comparison; malformed/tampered cursor rejected |
| Response bound | Limit normalized to 60 default and 100 hard max |
| Content privacy | Cursor and telemetry contain no message content, prompt, response, token, email, user/session ID or secret |
| Existing invariants | Four roles, max four LLM attempts, Provider Health/allowlist, OAuth/Stytch, search/RAG, attachments, exports and owner controls unchanged |

No provider, search, email, Stytch Magic Link, browser-session, attachment binary or real-network request was performed in this work. Magic Link remains **external BLOCKED** and untouched.

## BENCHMARK BEFORE/AFTER

The new benchmark is an isolated in-memory numeric model: it imports only pure cursor helpers, creates synthetic `{id,createdAt}` records, hard-blocks `fetch`, and imports no production DB/router/storage/provider code. Every tier runs 200 iterations; each paged measurement fetches the current page and one older page, where available. `networkGuardBlockedAttempts=0`. [5] [6]

| Synthetic history | Legacy records / response | Paged first + next | Paged/legacy records ratio | Legacy metadata bytes | Paged pair bytes | Legacy p95 ms | Paged p95 ms | Paged next lookup comparisons | RSS Δ | CPU ms |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 100 | 100 | 60 + 40 | 1.0000 | 3,593 | 3,593 | 0.00090 | 0.02224 | 6 | 1.36 MiB | 4.348 |
| 1,000 | 1,000 | 60 + 60 | 0.1200 | 36,894 | 4,442 | 0.00234 | 0.02461 | 10 | 0.39 MiB | 5.531 |
| 10,000 | 10,000 | 60 + 60 | 0.0120 | 378,895 | 4,562 | 0.02867 | 0.02500 | 14 | 4.89 MiB | 10.702 |
| 50,000 | 50,000 | 60 + 60 | 0.0024 | 1,938,895 | 4,681 | 0.41269 | 0.02842 | 16 | 10.82 MiB | 63.557 |

The model demonstrates bounded **per-page response cardinality** and a deterministic reduction in returned record/metadata count for long synthetic histories: two pages contain 120 records regardless of 1K/10K/50K history size. It does **not** measure TiDB/MySQL query time, physical index use, SQL bytes, app serialization, browser rendering, production RSS/CPU, sockets, LLM context or user load. The higher 100-record paged p95 is model/cursor overhead on a tiny dataset, not a product regression claim. [5]

## CARDINALITY RE-REVIEW POLICY

No fixed production capacity threshold is invented. A new metadata-only cardinality plus representative `EXPLAIN`/safe `EXPLAIN ANALYZE` review must be scheduled when any evidence-based trigger occurs. It must again use only aggregates/plan metadata, preserve scopes and avoid row content.

| Trigger category | Re-review condition | Required next evidence |
|---|---|---|
| History growth | Measurable growth by multiple orders of magnitude from the 14-message baseline, or repeated product reports of long sessions | Aggregate count distribution, scoped plan, bounded endpoint payload/latency metadata |
| Pagination behavior | Measurable page p95/query cost increase, repeated cursor failures, or response-size growth despite max limit | Cursor error class counts without IDs/content; safe plan and serialization evidence |
| Full scans / sorting | `EXPLAIN` shows scan/sort regression for scoped order, or root sort persists with meaningful cardinality | Fresh physical index metadata, representative plan and write-cost evidence |
| Read/write amplification | Repeated measurable excess queries, storage fan-out or index-write overhead | Aggregated query/storage count and cardinality evidence |
| Candidate lifecycle | Trigger for a candidate meets its exact table below | Candidate-specific plan, cardinality and cost review before any DDL |

## DEFERRED INDEXES

No index is created. All three candidates remain **DEFERRED** because current exact cardinalities (`chat_exports=0`, `memory_entries=7`, `messages=14`) are too small to establish benefit. [7]

| Candidate | Current plan/evidence | Re-review trigger | Why still deferred |
|---|---|---|---|
| `chat_exports(userId, sessionId, createdAt)` | Owner+session list uses FK/user filtering plus residual session/filter sort | Exports become non-trivial and a repeated owner+session plan shows sort/filter cost with measured access frequency | `chat_exports=0`; no real query cost |
| `memory_entries(userId, category, lastSeenAt, updatedAt, createdAt)` | Existing category-recency plan has root sort after partial index match | Aggregate memory entry growth plus repeatable category-order sort cost after semantics unchanged | 7 rows; frequent `lastSeenAt` writes could make wider index harmful |
| `messages(sessionId, createdAt, id)` | Existing `(sessionId,createdAt)` plan is index-directed without root sort | Long-session tie-heavy ordering shows measurable sort/scan cost after current paged path proof | Highest write table; no current plan evidence that wider index helps |

## VERIFIED FACTS

| Fact | Status |
|---|---:|
| Separate protected `chats.historyPage` exists; legacy `chats.messages` remains unchanged | Verified source contract |
| Default 60 and hard maximum 100 are server-enforced | Deterministic regression |
| Cursor is signed, opaque, session-bound and rejects malformed/tampered/cross-session inputs | Deterministic regression |
| First/next/end ordering, empty state, duplicate merge, concurrent insertion boundary and bounded page semantics | Focused no-network regressions |
| Existing full-history helper remains for context/export compatibility callers | Source contract regression |
| Home lazy loading is active only for paged rendering and preserves scroll anchor | Home integration regression/source review |
| Synthetic benchmark produced strict JSON and zero network attempts | Verified artifact |
| Physical index inventory and cardinality baseline remain the previous metadata-only evidence | Verified prior report |

## TEST RESULTS

| Validation | Result | Boundary |
|---|---:|---|
| `server/history-pagination.test.ts` | PASS, 5 tests | Signed cursor, bounds, first/next/end, invalid/stale/session scope and legacy compatibility contract |
| `server/db.scale.test.ts` | PASS, 6 tests | Targeted full-history alternatives, quota and local stream source contracts |
| `server/db-storage-benchmark.test.ts` | PASS, 1 test | No-network adapter isolation, CAS/replay and aggregate artifact |
| `server/chat-stream.test.ts` | PASS, 12 tests | Admission, local capacity, cleanup and metadata-only runtime gauges |
| `server/owner-observability-controls.test.ts` | PASS, 6 tests | Owner boundary and privacy DTO |
| `client/src/pages/Home.integration.test.tsx` | PASS, 36 tests | Paged history cache/invalidation, lazy loading and existing stream UI compatibility |
| Focused total | **PASS, 66 tests / 6 files** | No provider-oriented or real-network test executed |
| `pnpm check` | **PASS** | TypeScript |
| `git diff --check` | **PASS** | Whitespace/conflict check |
| Visual shell | PASS | Current authenticated empty-chat shell rendered; no historic content was opened, so lazy-load control itself remains code/integration-test verified |

## UNMEASURED LIMITATIONS

Not measured: real chat length distribution, response content bytes, TiDB statistics freshness, real DB `EXPLAIN ANALYZE` on user sessions, query p50/p95/p99, storage URL latency, browser UI performance with populated multi-page history, production load/RPS, multi-pod fairness, real 10K/50K concurrent users, provider latency, LLM prompt token volume and production capacity. No production build is claimed because the retained sandbox SIGTERM/resource blocker remains.

## NEXT EVIDENCE-BASED STEP

Stop at this point. The next separate step should be a metadata-only cardinality/plan re-review only when a trigger above is observed. It may then decide whether to revisit one deferred candidate; `chat_exports` candidate #1 remains deferred until live evidence exists. A transcript-window policy, memory dedup index, new DB index, Redis/queue/provider/storage change or new infrastructure must not start automatically from this report.

## References

[1]: ../../server/history-pagination.ts "Pure signed cursor codec, limits and session binding"
[2]: ../../server/db.ts and ../../server/routers.ts "Scoped page helper and sibling protected procedure"
[3]: ../../client/src/pages/Home.tsx "Opt-in Home page query, lazy loader, merge and session anchor"
[4]: ../../client/src/components/AIChatBox.tsx "Load-older control and scroll anchor preservation"
[5]: ./history-pagination-benchmark-results-2026-08.json "Strict local no-network benchmark artifact"
[6]: ../../scripts/history-pagination-benchmark.ts "Isolated benchmark implementation and fetch guard"
[7]: ./scale-stability-db-cardinality-explain-2026-08.md "Metadata-only cardinality and EXPLAIN baseline"
