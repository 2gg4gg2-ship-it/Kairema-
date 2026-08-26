# KAIREMA SCALE & STABILITY — Transcript-window policy для LLM context

**Статус:** реализовано и проверяется локально; данный документ описывает code-level и synthetic evidence, а не production capacity. Полная история пользователя остаётся в storage и UI; изменён только server-side материал, передаваемый в конкретный LLM request.

## CURRENT CONTEXT ASSEMBLY

До этого этапа оба LLM entrypoint получали результат `listSessionMessages`: упорядоченную, но неограниченную историю одной сессии. В streaming handler отправка сначала проходит identity/session ownership, quota, replay и admission control; normal send сохраняет user turn, а regeneration фиксирует границу до assistant target. Затем формируется `buildChatContext`, добавляющий существующие настройки, память, search/RAG и attachment-related context, и role handler получает dialogue messages. Non-stream router сохраняет ту же последовательность без SSE.

После изменения оба entrypoint получают только `transcript.messages` от нового `listSessionTranscriptWindow`. System identity, роль, Provider Health/allowlist, цепи fallback, maximum four LLM attempts, memory/search/RAG settings и persistence after generation не изменены. `buildChatContext` остаётся независимым слоем: transcript selector не принимает, не модифицирует и не подменяет Unified Memory.

| Путь | До этапа | После этапа | Граница совместимости |
|---|---|---|---|
| SSE normal send | Полная history query после записи user turn | Bounded candidate query, anchored `throughMessageId` | SSE/replay/quota/admission/fallback сохранены |
| SSE regeneration | Полная history query | Bounded candidate query строго до regenerated assistant | Assistant target не попадает в prompt |
| Non-stream `chats.send` | Полная history query после записи user turn | Тот же bounded selector с `throughMessageId` | Public procedure и результат не менялись |
| UI history | Cursor pagination `60`, hard max `100` | Без изменений | Полная история остаётся доступна lazy pages |
| Exports/legacy callers | `listSessionMessages` full-history contract | Без изменений | Это не LLM transcript path |

## VERIFIED FULL-HISTORY HOTSPOTS

`listSessionMessages` выполняет owner-checked, но unbounded read по session. Это сохраняется как legacy full-history contract для exports и совместимых callers. Его использование в LLM SSE и non-stream path заменено на отдельный helper; selector и pagination не смешиваются.

Новый helper сначала проверяет принадлежность `chat_sessions` verified server-derived user, затем при необходимости находит boundary record внутри той же session. Он читает newest-first не более role-specific `maxCandidateMessages`, разворачивает строки в chronological order и передаёт их pure selector. Для `throughMessageId` используется inclusive tuple boundary `(createdAt,id)`; для `beforeMessageId` — exclusive. Поэтому конкурентное более позднее сообщение не может стать частью уже строящегося context, а regenerated assistant исключён.

| Проверенный риск | Состояние | Code-level evidence |
|---|---|---|
| Full history в каждом LLM request | Устранён только для двух LLM entrypoints | Dedicated bounded helper вместо legacy helper |
| Unbounded UI/history storage | Намеренно сохранён | Cursor pagination и storage не менялись |
| Concurrent later turn в текущем prompt | Ограничен | Stored upper-bound anchor перед bounded query |
| Cross-user/cross-session read | Запрещён | `getOwnedChatSession` + `requireOwnedSession`, session predicate |
| Full-history export compatibility | Сохранена | Legacy helper не переписан |

## NEW TRANSCRIPT-WINDOW POLICY

Selector является pure server-only функцией. Он принимает только message metadata/role/content/timestamp/id, отбрасывает пустые, malformed и duplicate rows, стабильно сортирует по `(createdAt,id)` и находит последний valid user message как active request. Затем окно расширяется **назад только complete immediately-adjacent user-led exchanges**: предыдущий user turn и все сообщения до текущего cursor добавляются как цельный обмен. Частичный старый exchange не вставляется.

Это не arbitrary “top N”: recent active user request всегда сохраняется; coherent backward expansion ограничен одновременно количеством кандидатов, числом prior turns и суммой transcript characters. Если active legacy/imported message превышает hard char budget, pure helper defensively обрезает только этот malformed input; normal ingress уже ограничивает user content до 16,000 characters. Selector не удаляет и не обновляет никаких строк.

## ROLE-SPECIFIC BUDGETS

Budgets опираются на существующий 16,000-character ingress cap и оставляют разный bounded запас для coherent prior context. Значения являются application code limits, не token estimates и не production SLO.

| Public role | `maxContentChars` | `maxCandidateMessages` | `maxPriorTurns` | Обоснование policy |
|---|---:|---:|---:|---|
| Flash (`fast`) | 18,000 | 12 | 4 | Наименьшее bounded continuation сверх active request |
| Think (`smart`) | 30,000 | 20 | 8 | Более широкий reasoning tail без full history |
| Context (`context`) | 48,000 | 32 | 14 | Наибольшее окно для context-oriented role |
| Apex (`flagship`) | 40,000 | 28 | 12 | Расширенный coherent tail, но конечный hard bound |

System identity, role capabilities, current user message, effective settings и independently retrieved memory/search context остаются входами role handlers. Ни одна из четырёх ролей не выполняет unbounded transcript query.

## MEMORY INTERACTION

Unified Memory v6-MEM остаётся отдельным user-scoped relevance/recency/category/confidence/source-aware слоем `buildChatContext`. Новая policy не меняет `memory_entries`, facts/topics storage, user-facing lists, deletion semantics или memory retrieval rules. Она ограничивает только dialogue transcript payload.

Search/RAG и verified source context также продолжают собираться существующим context builder и передаваться отдельными settings. Следовательно, bounded transcript не имитирует поиск, не заменяет memory и не меняет existing source handling. Focused handler assertions подтверждают, что `buildChatContext` формируется отдельно от `transcript.messages`.

## SECURITY/ISOLATION

Каждый new transcript read начинается с verified server-derived user identity, затем `getOwnedChatSession`/`requireOwnedSession`. Boundary lookup и candidate query всегда predicate-ятся одной подтверждённой session; no client-provided cursor/anchor способен вывести reader за её пределы. Existing user-scoped memory, secure attachments, owner-only exports, Google OAuth, Stytch Email/password, drafts и binary attachment route не изменены.

No secret, prompt, response, user content, token count или raw payload не сохраняется в benchmark artifact. Magic Link остаётся external **BLOCKED**: delivery/support/mutation/retry не выполнялись. Schema, DDL/DML, indexes, Redis/queues/external services и provider/search/email requests не добавлялись.

## BEFORE/AFTER BENCHMARK

Benchmark `scripts/transcript-window-benchmark.ts` — deterministic local in-memory model. Он создаёт только synthetic id/role/timestamp/text-length records, подменяет global `fetch` fail-fast guard и сравнивает legacy ordered full result с latest bounded candidate slice плюс тем же pure selector. Во всех четырёх history tiers и ролях `networkGuardBlockedAttempts=0`; query-count proxy равен 1 в обеих моделях, но record-read proxy — длине full history против role candidate cap. Raw strict JSON: `transcript-window-benchmark-results-2026-08.json`.

| Synthetic history | Role | Legacy reads / selected | Bounded reads / selected | Legacy chars / bounded chars | Selected-record ratio |
|---:|---|---:|---:|---:|---:|
| 50,000 | Flash | 50,000 / 50,000 | 12 / 8 | 10,001,422 / 2,517 | 0.00016 |
| 50,000 | Think | 50,000 / 50,000 | 20 / 16 | 10,001,422 / 4,040 | 0.00032 |
| 50,000 | Context | 50,000 / 50,000 | 32 / 28 | 10,001,422 / 6,584 | 0.00056 |
| 50,000 | Apex | 50,000 / 50,000 | 28 / 24 | 10,001,422 / 5,846 | 0.00048 |

В этой модели selected message count и transcript character growth bounded per role даже при 10K/50K history. p50/p95/p99, local CPU time и RSS deltas записаны в raw JSON, но отражают только JavaScript model/process. Это **не** TiDB execution plan, production DB I/O, provider latency, LLM tokenization, multi-pod coordination, real sockets или capacity proof.

## UNMEASURED LIMITATIONS

Реальное число provider tokens зависит от tokenizer, system prompt, memory, search/source, attachment context и provider model; character limits не являются token quotas. Production cardinality, TiDB latency/locks/index choice, database read cost, RSS under real concurrent streams, memory retrieval payload size, real search/RAG source growth и client acceptance on populated multi-page history не измерялись здесь. Production build намеренно не запускался из-за сохранённого sandbox SIGTERM/resource blocker.

## REMAINING BOTTLENECKS

Legacy full-history helper продолжает быть допустимым path для exports/compatibility и остаётся potential large-read hotspot именно там. Transcript candidate query использует existing schema/index state; deferred SQL index candidates остаются **DEFERRED** до повторной cardinality/EXPLAIN evidence. Memory/search payload, attachment context, provider latency and local SSE admission remain independent constraints. No claim о production readiness для 10K/50K users делается.

## NEXT EVIDENCE-BASED STEP

После накопления достаточной non-private cardinality и только при отдельном решении выполнить read-only EXPLAIN/cardinality re-review transcript query и export hot paths. До такой evidence не создавать index, не менять memory semantics, не начинать transcript summarization или новую infrastructure. Отдельно можно провести authorised populated-history UI acceptance без открытия чужих данных.

## VALIDATION

Final deterministic no-network validation PASS: `server/transcript-window.test.ts`, `server/transcript-window-benchmark.test.ts`, `server/history-pagination.test.ts`, `server/db.scale.test.ts`, `server/db-storage-benchmark.test.ts`, `server/chat-stream.test.ts`, `server/owner-observability-controls.test.ts`, `client/src/pages/Home.integration.test.tsx` — **8 files / 77 tests PASS**. `pnpm check` and `git diff --check` PASS. Raw JSON structural check confirms zero network-guard attempts, exactly four tiers `100/1K/10K/50K` and four roles per tier.

Broad provider-oriented suite was not run because it can invoke external/provider paths; production build was not run due the retained sandbox SIGTERM/resource blocker. No live populated-history acceptance was performed in this stage.

## REFERENCES

1. `server/transcript-window.ts` — pure role budgets и deterministic selection.
2. `server/db.ts` — owner-scoped bounded reader, legacy history helper и UI pagination boundary.
3. `server/chat-stream.ts` и `server/routers.ts` — SSE и non-stream LLM entrypoints.
4. `scripts/transcript-window-benchmark.ts` и `reports/evidence/transcript-window-benchmark-results-2026-08.json` — local synthetic benchmark contract/result.
5. `server/transcript-window.test.ts`, `server/transcript-window-benchmark.test.ts` — no-network regression coverage.
