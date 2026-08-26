# KAIREMA SCALE & STABILITY — read-only SQL/index review

**Дата:** 26 августа 2026 года.  
**Статус:** завершён строго read-only source/schema/evidence review. **Ни migration, index, schema, transcript-window policy, memory-dedup index, storage system, provider flow или runtime behavior не менялись.**

> **Классификация.** «Измерено» относится только к выполненным deterministic no-network contracts и ранее сохранённым local synthetic measurements. «Source-verified» означает точную проверку текущего Drizzle schema и server access path. «Не измерено» означает отсутствие безопасных production DB/S3 execution metrics, `EXPLAIN`, cardinality и lock/IO evidence. Такой статус не заменяется предположением о пользе индекса.

## 1. FULL-HISTORY PATH REVIEW

Главный confirmed source-level cost path — `listSessionMessages(userId, sessionId)`: сначала ownership lookup по `(chat_sessions.id, chat_sessions.userId)`, затем unbounded `SELECT` сообщений одного session с сортировкой `createdAt ASC, id ASC`. Helper не принимает cursor или limit. Он защищён от cross-user read, но объём результата растёт линейно с длиной конкретного chat. [1] [2]

В обычном accepted SSE запросе этот вызов происходит после verified identity, replay short-circuit, durable quota и local capacity reservation: short-circuited replay, 429 и capacity-503 не делают full-history read. Для нового message путь сначала appends user turn, затем читает full history один раз перед provider call; regeneration также читает full history один раз, чтобы найти prior assistant/user positions. Non-stream `chats.send` также использует тот же full-history helper. Это source-verified query shape; количество строк, bytes, DB time и effect long-text payloads не измерены. [2] [3]

| Path | Query/access shape | Boundedness | Статус и scale dimension |
|---|---|---|---|
| Stream new send | Session ownership lookup → append → `listSessionMessages` | **Unbounded by messages** | Source-verified; растёт с одним длинным chat |
| Stream regenerate | Session ownership lookup → `listSessionMessages` → in-process find/slice | **Unbounded by messages** | Source-verified; растёт с одним длинным chat |
| `chats.messages` API | `listSessionMessages` | **Unbounded by messages** | Source-verified; user-triggered history read |
| Persistent export create | Ownership lookup → `listSessionMessages` → filter/count/character gate | **Read happens before 1,000 messages / 2,000,000 chars gate** | Source-verified; export has post-read output gate, not pre-read DB bound |
| Replay lookup | Owner lookup → target user message → immediate following message, each with `limit(1)` | Bounded | Source-verified and deterministic contract PASS; no full history read |
| Memory extraction turn | Owner lookup → two ID-based message reads in `Promise.all` | Bounded to pair | Source-verified and deterministic contract PASS |

Existing `messages_session_created_idx(sessionId, createdAt)` aligns with session filter and the leading sort column. The code additionally orders by `id`; no execution plan is available to prove whether the database can satisfy both order keys without a filesort at realistic cardinality. Therefore an extension `(sessionId, createdAt, id)` is a **candidate for later review only**, not a justified migration now. [1] [2]

## 2. QUERY HOTSPOTS

The following map distinguishes confirmed source shapes from actual database bottlenecks. The 6,111,000-operation previous benchmark used an isolated in-memory adapter; it validates deterministic semantics, not TiDB/MySQL planner, storage or network cost. [8]

| Collection/path | Actual filters and order fields | Confirmed source behavior | Likely growth dimension | Classification |
|---|---|---|---|---|
| `chat_sessions` list | `userId`, `updatedAt DESC` | Reads **all** chats for a user; no page/cursor | One user with long chat history | Source-verified, cost not measured |
| `messages` history | `sessionId`, `createdAt ASC`, `id ASC` | Reads **all** messages in one chat | One long chat / large message text | Source-verified, cost not measured |
| `memory_entries` UI list | `userId`, optional `category`, `lastSeenAt DESC`, `updatedAt DESC`, `createdAt DESC` | UI callers currently pass no limit; server option can cap at 100 only if supplied | One user with many facts/topics | Source-verified, cost not measured |
| `memory_entries` upsert | Loads all rows for `(userId, category)`, then locale-aware JS comparison | Full category scan before update/insert | One user/category growth | Source-verified, no DB dedup bottleneck measured |
| `memory_facts` relevance/create/update | `userId`, `updatedAt DESC`; then JS token scoring/duplicate scan | Full user fact list before ranking/dedup | One user's fact count | Source-verified, cost not measured |
| `chat_exports` list | `userId`, optional `sessionId`, `createdAt DESC` | Reads all owner exports; no pagination | One user's export history | Source-verified, cost not measured |
| `chat_attachments` list | `userId`, `sessionId`, `expiresAt > now`, `createdAt ASC` | Reads all active attachment metadata for session | One session over retention period | Source-verified, cost not measured |
| Attachment preview list | Metadata list, then one signed URL call per returned attachment | N storage URL operations for N returned records | Attachments per session | Source-verified N-per-item storage fan-out; storage latency not measured |
| `chat_drafts` get/save | `(userId, sessionId)` | Single-row primary-key lookup/upsert | Constant per user+chat | Source-verified bounded path |
| Memory job claim | `userId`, `status`, due/stale time, `runAfter ASC, createdAt ASC`, then CAS update | `limit(1)` candidate plus compare-and-set | Per-user pending jobs | Source-verified bounded candidate; SQL plan not measured |
| Owner technical/aggregate view | Timestamp-window event/metrics reads and counts | Owner-only; metadata-only and retention-bounded where defined | Global project records | Source-verified; aggregate scan cost not measured |

## 3. N+1 FINDINGS

No classic per-row DB N+1 loop is proven on the central full-history path: message history is a single message select after an ownership select, not one query per message. Replay and extraction were previously narrowed to targeted rows rather than history scans; focused source contracts confirm this behavior. [2] [7]

The verified per-item fan-out is on the **storage** side of `attachments.list`: after `listSessionAttachments`, router code builds preview URLs with `Promise.all`, so N attachment metadata rows induce N signed-URL operations. This is not a SQL index issue. SQL row count remains unbounded in the helper, but the external storage latency, cost and request limits were intentionally not measured. [4] [6]

| Finding | Evidence | Status | Consequence |
|---|---|---|---|
| Full-history does not issue DB query per message | One list select after owner lookup | Source-verified | No DB N+1 proof, but response payload scales with chat length |
| Attachment previews have N signed URL operations | Router loops `Promise.all` over list result | Source-verified | Storage fan-out is suspected scale cost; not an index candidate yet |
| Memory fact/entry matching performs JS scans after user-scoped fetch | `listMemoryFacts` / category list then `find`/`some` | Source-verified | Potential one-user CPU/data-transfer growth; cardinality unknown |
| Export generation runs one full message read before output guard | Export service sequence | Source-verified | Long export can incur a read even when later rejected |

## 4. PAGINATION FINDINGS

Current design does **not** use cursor or offset pagination for `chat_sessions`, `messages`, `chat_exports`, `memory_entries` user UI lists, or session attachment metadata. `listMemoryEntries` supports an optional maximum of 100, but the actual user-facing memory callers pass no limit; that cap is therefore not active on those paths. Search is a different bounded path: it returns at most 8 chat matches and 12 message matches. [1] [3]

| Surface | Current pagination/limit | Result |
|---|---|---|
| Chat list | None | Full per-user chat list can grow without server page bound |
| Chat message list/history | None | Full per-session history is transferred and assembled |
| Memory UI fact/topic lists | Helper supports optional max 100; current callers omit it | Full category list can grow |
| Bounded server context | SQL window 30 facts / 15 topics | Bounded separately from memory UI lists |
| Export list | None | Full per-user or session export history can grow |
| Attachment list | None | Full active metadata list for session; retention does not prove a hard count |
| Search results | 8 sessions + 12 messages | Bounded response count, content `LIKE` cost not measured |

No list was shortened and no transcript-window policy was introduced. The absence of pagination is a **proven query-shape risk**, not proof that users currently have tens of thousands of records.

## 5. CURRENT INDEX COVERAGE

The table below records declared Drizzle schema coverage, not confirmed physical deployment or `EXPLAIN` usage. [1]

| Collection | Declared key/index | Access it directly supports | Important mismatch or limit |
|---|---|---|---|
| `chat_sessions` | `(userId, updatedAt)` | Per-user list ordered by update time | No paging; owner lookup is primarily by PK `id` plus user condition |
| `messages` | `(sessionId, createdAt)`; unique `clientMessageId` | Session chronology and retry identifier | Query also orders `id`; replay adds `id > ...` after `sessionId` |
| `chat_exports` | `(userId, createdAt)`, `(sessionId, createdAt)` | Owner-all and session chronological lists individually | Combined owner+session list does not exactly match either composite index |
| `chat_drafts` | PK `(userId, sessionId)` | Get/save/delete owned draft | Already exact, single-row pattern |
| `memory_entries` | `(userId, category, createdAt)`, `(userId, category, updatedAt)`, `(userId, category, lastSeenAt)`, `(userId, sessionId, lastSeenAt)` | Category recency and topic/session lookup | JS dedup by case-folded `value` has no exact declared lookup key |
| `memory_facts` | `(userId, updatedAt)` | Owner fact recency list | Relevance and dedup are JS scans of fetched facts |
| `memory_extraction_jobs` | `(userId, status, runAfter)`, `(sessionId, createdAt)`, unique `assistantMessageId` | Per-user due claim and idempotent enqueue | Global retry reference path filters status/due without user ID; plan unmeasured |
| `chat_attachments` | `(userId, sessionId, createdAt)`, `(expiresAt)` | Owner session chronology and expiry cleanup | Active-list expiry predicate is not covered by a single exact combined index |
| `technical_events` | `(createdAt)` | Retention/window ordering | Owner aggregate/filter cost and actor-specific lookup not measured |

## 6. PROVEN BOTTLENECKS

The term **proven** here is limited to code-level work shape, not measured production latency. The full-history reads, unpaginated growing lists, in-process memory fact/entry scans, export's post-read limit check and attachment signed-URL fan-out all exist in current source. Their real database/storage magnitude is not measured. [2] [3] [4] [5]

| Proven shape | Why it scales | Is a DB bottleneck proven? |
|---|---|---|
| Full `messages` history on stream/API/export | Rows and content bytes grow with one chat | **No** — only unbounded read is proven |
| Full per-user chat/export/memory lists | Rows grow with one user | **No** — no cardinality/plan/latency |
| JS duplicate/relevance scans after user-scoped fetch | CPU/payload grows with memory collection | **No** — no collection size or CPU sampling |
| Attachment preview N-url fan-out | Storage calls grow with active attachments | **No** — storage timing/rate data absent |

## 7. SUSPECTED BUT UNMEASURED BOTTLENECKS

Long history content can dominate DB-to-app transfer and prompt assembly even if an index locates rows efficiently; an index cannot reduce bytes of an intentional full-history read. An export rejected by its 1,000-message or 2,000,000-character limit can still have loaded the full message sequence first. `LIKE '%term%'` in content search and JS locale-aware memory dedup/relevance are likewise candidate cost centers because current source must inspect data, but there is no safe runtime evidence of their actual cost. [2] [5]

Global owner aggregate/technical-event work is metadata-only and owner-only, but the review has no table cardinality, job cadence, count query plans or production retention enforcement metrics. It remains **not measured** rather than a claimed hotspot.

## 8. LOW-RISK OPTIMIZATIONS

No optimization is implemented in this stage. The least risky next work would be an additional read-only evidence step: capture approved metadata-only cardinality and query-plan evidence for a narrowly selected path, then compare it with declared index order. That work must preserve server-derived `userId`, `(id,userId)` ownership checks, owner-only surfaces and current user-visible list semantics.

For full history, a product decision is required before any transcript window: the present model intentionally makes all session turns available. A query index could improve ordering/lookup but cannot bound memory, token, response or storage-transfer volume. For memory dedup, the application equivalence is case-folded Russian text plus category/session/time semantics; an index on a raw text field would not automatically preserve that comparison contract. Therefore there is no supported basis for a blind `memory_entries` dedup index.

## 9. INDEX CANDIDATES WITH EVIDENCE

| Candidate, **not implemented** | Exact access pattern | Expected lookup benefit | Write/storage cost | Compatibility and migration risk | Evidence threshold still missing |
|---|---|---|---|---|---|
| `(messages.sessionId, messages.createdAt, messages.id)` | Full history `WHERE sessionId` / `ORDER BY createdAt, id` | Could align all current order keys for long session chronology | Extra index write on every message and storage growth | Additive but hot-write table; must preserve current ordering | `EXPLAIN`, actual long-session cardinality and latency comparison |
| `(chat_exports.userId, chat_exports.sessionId, chat_exports.createdAt)` | Owner session export list filters both then orders time | Could align combined owner+session filter and order | Extra write/storage per export | Additive; legacy `chat_exports` must not be altered without separate gate | Query frequency, cardinality and plan evidence |
| No proposed `memory_entries` value/dedup index | App fetches category then case-folds text, and topics add session/24h rule | Raw DB index does not match current equivalence | Potential large text/index amplification | High semantic risk of incorrectly changing dedup behavior | Measured hot path and explicit normalized-key product/schema contract |
| No proposed attachment active-list composite index | Owner/session plus expiry predicate and created ordering | Possible but order/range trade-off is DB-specific | Extra write/storage per attachment | Low schema risk but unproven benefit | `EXPLAIN`, active-row cardinality, list frequency |

## 10. MIGRATION/RISK NOTES

No schema change is warranted from the available evidence. Any later index migration must be additive, generated from schema, inspected before application and verified with a non-destructive plan. It must not touch `chat_exports` destructive gate, DROP/RESET existing tables, introduce a parallel store, or claim capacity from in-memory simulation. Every candidate increases write amplification and index storage; `messages` is particularly sensitive because every user and assistant turn writes there.

## 11. SECURITY/ISOLATION CHECK

All reviewed user data paths retain explicit server-side ownership predicates or ownership checks before reads/mutations. Full-history, drafts, attachments and exports resolve/require owned session; point lookups include `userId`; owner observability remains an existing owner-only boundary and stores/displays metadata only. Targeted replay and memory-extraction pair reads are scoped before content is selected. [2] [4] [5] [7]

Any later index must preserve the existing scoped predicate as the query predicate; an index is never an authorization mechanism. No user IDs, prompts, responses, memory contents, signed URLs, tokens or secret values were added to this report or new telemetry.

## 12. TEST/EVIDENCE STATUS

| Evidence | Result | Classification |
|---|---:|---|
| Focused `server/db.scale.test.ts` | PASS, 6 tests | Deterministic source contracts for targeted replay, pair reads, memory bound option, durable quota, local stream guard |
| Focused `server/db-storage-benchmark.test.ts` | PASS, 1 test | No-network adapter replay/CAS/isolation artifact contract |
| Focused `server/chat-stream.test.ts` | PASS, 12 tests | Admission order, local capacity, cleanup and privacy-safe gauges |
| Focused `server/owner-observability-controls.test.ts` | PASS, 6 tests | Owner guard and metadata-only observability surface |
| Focused total | **PASS, 25 tests / 4 files** | No provider-oriented suite or real-network workload ran |
| `pnpm check` and `git diff --check` | **PASS** | TypeScript and whitespace only |
| Real DB/S3 `EXPLAIN`, cardinality, locks, IO, production RPS | Not run | **Not measured** by explicit scope |
| Production build | Not run | Retained SIGTERM/resource blocker; out of scope |

`owner-observability-controls` prints expected mock-environment `OAUTH_SERVER_URL` stderr; its test passes and does not invoke network/auth delivery. Stytch Magic Link remains an unrelated external blocker and was not touched. Web Search models were not changed.

> **Stop condition met.** The review identifies query shapes and narrowly framed evidence requirements only. It does not authorize automatic index creation, full-history truncation, transcript-window policy, memory deduplication or infrastructure work.

## References

[1]: ../../drizzle/schema.ts "Drizzle schema: declared keys and index coverage"
[2]: ../../server/db.ts "User-scoped database helpers and query shapes"
[3]: ../../server/chat-stream.ts "SSE ordering and full-history call placement"
[4]: ../../server/routers.ts "Protected runtime/API callers and attachment preview fan-out"
[5]: ../../server/chat-exports.ts "Persistent export full-history and post-read size gates"
[6]: ../../server/attachments.ts "Attachment metadata/storage access boundaries"
[7]: ../../server/db.scale.test.ts "Deterministic source-level scale contracts"
[8]: ./scale-stability-admission-db-storage-evidence-2026-08.md "Prior no-network DB/storage evidence and its limits"
