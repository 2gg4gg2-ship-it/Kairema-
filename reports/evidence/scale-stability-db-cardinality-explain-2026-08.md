# KAIREMA SCALE & STABILITY — metadata-only DB cardinality и EXPLAIN evidence

**Дата:** 26 августа 2026 года.  
**Версия evidence baseline:** `6675194f`.  
**Статус:** завершён строго read-only metadata review. Никакие пользовательские строки, prompts, responses, memory values, attachment/export metadata, credentials, schema, indexes, migration, runtime, auth, provider или storage behavior не изменялись.

> **Классификация evidence.** «Проверено» означает точный aggregate `COUNT(*)`, `information_schema` metadata, `EXPLAIN`/один safe zero-row `EXPLAIN ANALYZE` либо прочитанный server source. «Не измерено» означает, что не выполнялись запросы с реальными private identifiers, workload, full table payload reads, production RPS/load test, index creation или destructive operation. Малые текущие counts не доказывают будущую capacity.

## 1. Границы и метод

Проверка использовала только metadata-safe операции: aggregate cardinality по разрешённым таблицам, physical-index inventory из `information_schema.STATISTICS`, `EXPLAIN` representative query shapes с пустыми sentinel predicates и один `EXPLAIN ANALYZE` для zero-row `messages` predicate. Sentinel не совпадает с private session/user identifiers; пользовательские rows не возвращались. Все SQL-запросы были `SELECT`/`EXPLAIN` и не содержали DDL, DML, migration или storage/provider access.

> TiDB план помечает статистику как `pseudo`/`partial` для ряда таблиц. Поэтому estimated rows в plan не трактуются как реальная cardinality и не используются для capacity claim.

## 2. VERIFIED CARDINALITIES

`COUNT(*)` выполнен как metadata-only aggregate 26 августа 2026 года. Значения отражают только момент чтения и не раскрывают contents, user IDs или row-level ownership.

| Collection | Exact rows | Интерпретация |
|---|---:|---|
| `chat_sessions` | 1 | Текущий dataset слишком мал для измерения list pagination benefit |
| `messages` | 14 | Too small для оценки long-history DB/transfer cost |
| `memory_entries` | 7 | Too small для оценки memory list/dedup throughput |
| `memory_facts` | 0 | Нет live cardinality evidence для fact retrieval |
| `chat_attachments` | 2 | Нет evidence о production signed-URL fan-out |
| `chat_exports` | 0 | Нет live evidence для export-list candidate |
| `chat_drafts` | 0 | Exact point-key path, но live volume отсутствует |
| `technical_events` | 0 | Нет live owner-event scan evidence |
| `memory_extraction_jobs` | 7 | Нет backlog evidence beyond small metadata count |

**Вывод:** ни одна коллекция в момент review не имеет cardinality, достаточной для оправдания немедленного index migration. Source-level unbounded paths сохраняются как будущий risk, но real DB capacity/latency не измерялась. [1] [2]

## 3. VERIFIED PHYSICAL INDEX COVERAGE

Physical index inventory получен из `information_schema`, а не только из Drizzle declaration. Важные current keys показаны ниже; каждый существует в текущей DB metadata. [3]

| Collection | Проверенные relevant physical indexes | Current access alignment |
|---|---|---|
| `chat_sessions` | `PRIMARY(id)`; `(userId)`; `(userId, updatedAt)` | User chat list `WHERE userId ORDER BY updatedAt DESC` |
| `messages` | `PRIMARY(id)`; `UNIQUE(clientMessageId)`; `(sessionId)`; `(sessionId, createdAt)` | Session chronology and replay/client idempotency |
| `memory_entries` | `(userId, category, createdAt)`; `(userId, category, updatedAt)`; `(userId, category, lastSeenAt)`; `(userId, sessionId, lastSeenAt)` | Owner/category and recency variants |
| `memory_facts` | `(userId)`; `(userId, updatedAt)` | Owner fact recency |
| `chat_attachments` | `(userId, sessionId, createdAt)`; `(expiresAt)` | Owner/session chronology and expiry cleanup |
| `chat_exports` | `(userId, createdAt)`; `(sessionId, createdAt)` | Owner-all and session-only export chronology |
| `chat_drafts` | `PRIMARY(userId, sessionId)`; `(sessionId, updatedAt)` | Exact owned draft point lookup/upsert |
| `technical_events` | `(actorUserId)`; `(createdAt)` | Metadata actor/window paths |
| `memory_extraction_jobs` | `UNIQUE(assistantMessageId)`; `(userId, status, runAfter)`; `(sessionId, createdAt)` | Idempotent enqueue and per-user due candidate |

## 4. VERIFIED EXPLAIN FINDINGS

Representative plans were generated without returning row data. The planner sees `pseudo`/`partial` statistics, so plan shape is useful but estimated cardinality is not a load result.

| Query shape | Verified plan result | What it proves | What it does **not** prove |
|---|---|---|---|
| Chats: `WHERE userId ORDER BY updatedAt DESC` | `IndexRangeScan` on `(userId, updatedAt)`, `keep order:true`, descending | Existing list index aligns with filter/order | Real list latency or need for pagination |
| Messages: `WHERE sessionId ORDER BY createdAt, id` | `IndexRangeScan` on `(sessionId, createdAt)`, `keep order:true`; no root sort in returned plan | Existing primary history order is already index-directed | Whether secondary `id` causes a cost at real timestamp ties; full-history payload cost |
| Memory entries: `WHERE userId AND category ORDER BY lastSeenAt, updatedAt, createdAt DESC` | Uses `(userId, category, createdAt)` then root `Sort` | Current chosen index does not fully match multi-column order | Real sort duration or a justified new index at 7 rows |
| Attachments: `WHERE userId AND sessionId AND active-expiry ORDER BY createdAt` | `(userId, sessionId, createdAt)` ordered index scan plus expiry `Selection` | Owner/session chronology index is used; expiry is residual predicate | Real active attachment cardinality or storage signed-URL latency |
| Exports: `WHERE userId AND sessionId ORDER BY createdAt DESC` | Plan selected FK `(userId)`, residual session filter, root `Sort` | No single current physical index matches both scope predicates plus order | Benefit at current zero export rows |
| Draft: `WHERE userId AND sessionId` | `Point_Get` on `PRIMARY(userId, sessionId)` | Exact bounded draft key path | Any global draft load claim |
| Memory facts: `WHERE userId ORDER BY updatedAt DESC` | `(userId, updatedAt)` `IndexRangeScan`, `keep order:true` | Owner fact recency index aligns | In-process relevance/dedup cost |
| Technical events: recent timestamp window ordered descending | `(createdAt)` `IndexRangeScan`, `keep order:true`, descending | Current timestamp-window index aligns | Owner aggregate cost/cardinality |

The one safe `EXPLAIN ANALYZE` ran `messages` with a zero-row sentinel session scope. It performed an ordered index range scan, returned **0 rows**, visited **2 index keys**, took about **624 μs** at root and reported one RPC. This confirms command availability and zero-row execution only; it is **not** a benchmark of any real chat session, full history, user workload, network or production p95. [4]

## 5. PATH / INDEX / PAGINATION MAP

| Path | Current ownership boundary | Query boundary | Index / pagination state | Evidence status |
|---|---|---|---|---|
| Chat list | `userId` | Full user list, `updatedAt DESC` | Index aligned; no cursor/limit | Source + EXPLAIN verified |
| Chat message/history | Ownership lookup then `sessionId` | Full session history, `createdAt ASC, id ASC` | Index-directed; no cursor/limit | Source + EXPLAIN verified |
| Memory UI entries | `userId`, optional category | Full list unless caller supplies optional max ≤100 | Existing indexes are partial order matches; current UI callers omit limit | Source + EXPLAIN verified |
| Memory facts/relevance | `userId` | Full fact list then JS rank/dedup | Recency index aligned; semantic scan remains in app | Source + EXPLAIN verified |
| Attachments | Owned session then `userId,sessionId` | All non-expired session metadata | Ordered scope index plus residual expiry; no page | Source + EXPLAIN verified |
| Exports | `userId`, optional owned session | Full owner or owner+session history | Separate owner/time and session/time indexes; combined scope/order mismatch | Source + EXPLAIN verified |
| Drafts | `PRIMARY(userId,sessionId)` | One row | Exact point key | Source + EXPLAIN verified |
| Owner events | Existing owner guard | Timestamp-window metadata | Timestamp index aligned; aggregate cardinality zero now | Source + EXPLAIN verified |

The map does not change user isolation: every user-scoped list is already filtered/checked server-side; owner observability remains behind `requireOwner`; no index can serve as an authorization mechanism. [1] [5]

## 6. RANKED INDEX CANDIDATES — NOT IMPLEMENTED

There are exactly three candidates below because they are the only source/plan mismatches with a concrete additive definition. **All are deferred.** None has measured benefit at the current small/empty collections, and no migration is authorised by this report.

| Rank | Candidate exact definition | Query evidence | Expected benefit | Write / storage cost | Compatibility / migration risk | Recommendation now |
|---:|---|---|---|---|---|---|
| 1 | `CREATE INDEX chat_exports_user_session_created_idx ON chat_exports (userId, sessionId, createdAt)` | Current owner+session export plan uses user FK + session filter + root sort | Could make combined owner/session time list index-directed | One additional index write per export; index bytes per metadata row | Additive and low semantic risk, but legacy export lifecycle must remain intact | **Defer**: current `chat_exports=0`; gather live query frequency/cardinality and re-run plan first |
| 2 | `CREATE INDEX memory_entries_user_category_seen_updated_created_idx ON memory_entries (userId, category, lastSeenAt, updatedAt, createdAt)` | Current category-recency plan shows root sort after `(userId,category,createdAt)` | Could align the exact list order | Extra write amplification for frequent `lastSeenAt` updates; wider index storage | Additive but more write-sensitive; must not change case-insensitive dedup/topic semantics | **Defer**: seven rows globally and no measured sort cost |
| 3 | `CREATE INDEX messages_session_created_id_idx ON messages (sessionId, createdAt, id)` | Current history order includes `id` secondary key, while current index ends at `createdAt` | At most a tie-order alignment improvement | Extra write/storage on the highest-write conversation table | Additive but potentially costly at every user/assistant message | **Do not prioritise**: current plan is already ordered with no root sort; needs real tie/cardinality evidence |

An index on raw `memory_entries.value` is deliberately **not** recommended. Current matching is Russian-locale case-folded text plus category, memory key, session and 24-hour topic conditions; a raw text index would not preserve that equivalence contract. [1]

## 7. BACKWARD-COMPATIBLE HISTORY PAGINATION RECOMMENDATION — NOT IMPLEMENTED

The lowest-risk design is an **additive, opt-in page API/helper** rather than modification of `listSessionMessages`, stream context, existing `chats.messages` response, export history, message rendering or database schema.

| Design element | Recommendation | Backward-compatibility / security rationale |
|---|---|---|
| New surface | Add a separately named `listSessionMessagesPage` / `chats.messagesPage` only in a future approved implementation | Existing clients retain full-history response and behavior |
| Scope first | Resolve `getOwnedChatSession(serverDerivedUserId, sessionId)` before cursor query | Preserves current server-side user/session isolation |
| Cursor | Opaque, validated tuple `{createdAt, id}`; never raw content or user identifier | Stable order tie-breaker and no payload leak |
| Direction | Fetch newest page using `ORDER BY createdAt DESC, id DESC LIMIT bounded`; reverse rows only for chronological UI rendering | Efficient initial loading while keeping user-visible chronology |
| Next page | `WHERE sessionId = ? AND (createdAt < cursor.createdAt OR (createdAt = cursor.createdAt AND id < cursor.id))` | Avoids offset drift and retains one scoped session boundary |
| Default behavior | Do **not** silently cap existing full-history endpoint/helper | Prevents user-visible truncation/regression |
| Stream/export/context | Keep current full history until a separate product decision and evidence supports a transcript-window policy | Pagination alone must not silently alter model context or exports |
| Rollout gate | Add focused cursor/order/isolation tests and measure opt-in endpoint only after explicit approval | No automatic code/schema change from this report |

This is a recommendation only. It intentionally stops short of adding an endpoint, cursor codec, index, migration or UI change.

## 8. SECURITY / ISOLATION CONFIRMATION

The metadata review did not inspect user content and confirms the current query boundaries used by reviewed helpers: `userId` filter or owned-session check precedes list/read/mutation, point operations include an ownership predicate, and owner diagnostics call existing `requireOwner`. Planned candidate indexes retain the same predicates; they cannot bypass them. [1] [5]

No cross-user probe, direct object-storage read, attachment URL generation, provider call, Stytch action, browser session action or production load test occurred.

## 9. NOT MEASURED / EXTERNAL LIMITATIONS

The following remain explicitly unmeasured: real per-user and global cardinality distribution; payload bytes; full-history query latency; TiDB statistics freshness; lock waits; write amplification; index size; storage/S3 URL latency; production pod CPU/RSS; real SSE concurrency; multi-pod distribution; RPS/p95/p99 under user load; provider latency; and user-visible capacity for 10K/50K users.

Current `pseudo`/`partial` plan statistics mean that physical plan selection should be revalidated after a real, privacy-safe cardinality threshold is reached. No production-ready/capacity claim follows from this review.

## 10. TESTS AND STOP CONDITION

The review itself changed only evidence documentation and the tracker. Focused no-network contracts from the immediately preceding evidence stage remain applicable: DB scale contract, DB/storage adapter isolation, SSE admission/gauge privacy and owner metadata boundary. No provider-oriented or external-network test is needed for this documentation-only work. Final static validation is recorded with this checkpoint: `pnpm check` and `git diff --check` must pass before publication.

> **Stop condition met:** aggregate counts, physical index metadata, safe plan shape and three deferred candidates are recorded. No DDL/DML, migration, index creation, pagination implementation, transcript-window policy, memory dedup work, external queue, Redis, provider, search, auth, attachment/export lifecycle or production build work has been performed.

## References

[1]: ../../server/db.ts "User-scoped database helpers, full-history/list semantics and ownership checks"
[2]: ./scale-stability-sql-index-review-2026-08.md "Prior source/schema SQL and index review"
[3]: `information_schema.STATISTICS` query executed 2026-08-26 "Physical index metadata only"
[4]: `EXPLAIN` and zero-row `EXPLAIN ANALYZE` queries executed 2026-08-26 "Read-only execution-plan evidence"
[5]: ../../server/routers.ts "Protected procedures and existing owner guard"
