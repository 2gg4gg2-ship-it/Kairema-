# WEB-GROUNDED V1 — controlled source-success closeout (2026-08)

Этот документ закрывает только ограниченный evidence-only этап после опубликованного V1 checkpoint `72b9ca53`. Он не является новым аудитом и не изменяет search cascade, LLM routing, authentication, schema, infrastructure или production behavior. Все статусы ниже относятся к доказательству, а не к предположениям.

## LIVE SOURCE-SUCCESS

| Проверка | Статус | Evidence boundary |
|---|---|---|
| Единственный разрешённый authenticated controlled public-current request | **PASS** | Published runtime показал application UI без guest login screen. Ровно один нейтральный current-web request был отправлен; login/OAuth mutation и unrelated user-scoped access не выполнялись. [10] |
| Actual live source result and citation cards | **BLOCKED** | Authenticated request завершился truthful degraded state: UI сообщил, что проверяемые свежие источники недоступны; реальные source cards/links не появились. Это не source-success PASS. [10] |

## END-TO-END TRACE

| Проверка | Статус | Evidence boundary |
|---|---|---|
| Production trace from request through frontend citation display | **BLOCKED** | Request-to-frontend trace reached truthful degraded rendering, but no verified live source record or citation card was returned, so the full source-success chain is not proven. [10] |
| Existing trace contract | **PASS** | V1 code and deterministic no-network evidence cover intent → Controller-backed real-attempt hook → existing cascade → normalization → labelled context → structured grounding → stream/replay/non-stream display. [2] [3] |

## SEARCH INTENT

| Проверка | Статус | Evidence boundary |
|---|---|---|
| Fresh public-current request classification | **PASS** | The single permitted neutral current-web request was accepted as a freshness-sensitive request and produced the expected degraded web-grounding path. [10] |
| REQUIRED/PREFERRED/NONE policy | **PASS** | Deterministic classifier coverage confirms REQUIRED for current external facts, PREFERRED for source-seeking questions and NONE for ordinary/internal requests. [4] |

## SEARCH ADMISSION

| Проверка | Статус | Evidence boundary |
|---|---|---|
| Live admission lease observation | **UNVERIFIED** | The request reached the published application, but no public live lease metadata is exposed in the UI; no bypass is inferred. |
| Per-real-attempt admission/settlement contract | **PASS** | Existing controller integration invokes admission around actual cascade work; each fallback layer receives a distinct pre-attempt lifecycle rather than bypassing capacity policy. [3] [5] |

## REAL SOURCES

| Проверка | Статус | Evidence boundary |
|---|---|---|
| Live normalized source count, URL presence and retrieval metadata | **BLOCKED** | The single request returned no verifiable fresh source records; no source URL, body or provider payload is claimed. [10] |
| Normalization and duplicate-safe source contract | **PASS** | Mocked fixtures verify normalized, deduplicated verifiable source records, public title/domain/date handling, and no fabricated current result when dated evidence does not qualify. [5] |

## MODEL WEB CONTEXT

| Проверка | Статус | Evidence boundary |
|---|---|---|
| Live provider payload receipt | **BLOCKED** | The request completed with a degraded no-verifiable-source outcome; raw provider payloads are not retained or exposed. [10] |
| Labelled untrusted WEB SOURCES boundary | **PASS** | Four-role deterministic fixtures verify that current web data is inserted as a distinct data block, not as system instructions or hidden server state. [6] |

## GROUNDING CORRECTNESS

| Проверка | Статус | Evidence boundary |
|---|---|---|
| Live answer-to-source fact comparison | **BLOCKED** | No actual source-success response or verifiable source record exists for comparison. The model correctly declined to present a current fact as verified. [10] |
| Required-search safe failure behaviour | **PASS** | Existing no-network coverage preserves an explicit freshness warning where verified current sources are unavailable; it does not promote stale, empty or degraded data to verified current evidence. [4] [5] |

## CITATION INTEGRITY

| Проверка | Статус | Evidence boundary |
|---|---|---|
| Live citation-to-backend record matching | **BLOCKED** | No live citations were produced because no verifiable live source records were returned. [10] |
| Structured citation integrity | **PASS** | Deterministic stream/UI fixtures preserve only actual normalized public citation fields, validate public HTTP(S) cards, and omit private/internal context from completion metadata. [7] [8] |

## FRESHNESS

| Проверка | Статус | Evidence boundary |
|---|---|---|
| Live published/updated timestamp observation | **BLOCKED** | The UI reported no verifiable fresh sources and displayed no live source timestamp that could be matched. [10] |
| Dated-source and stale-evidence handling | **PASS** | Fixtures accept only valid non-future dates, enforce requested freshness windows and return explicit degraded/empty states rather than inventing dates or currentness. [4] [5] |

## PROMPT INJECTION

| Проверка | Статус | Evidence boundary |
|---|---|---|
| Hostile live page execution | **UNVERIFIED** | Deliberately not sent to a live provider. |
| Untrusted source-data boundary | **PASS** | A deterministic malicious-source fixture verifies the data-not-instructions rule, placement before source content, no secret disclosure instruction, and transparent conflict guidance for each public role. [6] |

## CACHE/DEDUP

| Проверка | Статус | Evidence boundary |
|---|---|---|
| Live cache hit or concurrent dedup observation | **UNVERIFIED** | No repeated live request was justified or executed; one request only. |
| Public-only bounded cache/dedup contract | **PASS** | Existing V1 evidence and deterministic tests cover a fixed in-process cache, fixed TTL/eviction, cloned outcomes, in-flight dedup, and no failure caching; personal/account, attachment and memory contexts bypass shared cache. [3] [4] [5] |

## SEARCH BUDGET

| Проверка | Статус | Evidence boundary |
|---|---|---|
| Live search-budget observation | **BLOCKED** | Depends on the blocked authenticated run. |
| Separate search capacity lifecycle | **PASS** | Controller V1 treats search admission separately from generation; deterministic coverage verifies distinct search reservation/lease outcomes and truthful admission-denied degradation without a quota-bypass claim. [3] [9] |

## FOUR ROLES

| Проверка | Статус | Evidence boundary |
|---|---|---|
| One live source-success role | **BLOCKED** | Authenticated Flash request was executed, but the live search returned no verifiable sources; no citation-success role result is claimed. [10] |
| Flash, Think, Context and Apex contract | **PASS** | Deterministic fixtures cover the same labelled source boundary and graceful-failure instruction for exactly four public roles; `MAX_ATTEMPTS=4` remains unchanged. [4] [6] |

## STREAM/REPLAY/NON-STREAM

| Проверка | Статус | Evidence boundary |
|---|---|---|
| Live stream/replay citation persistence | **BLOCKED** | The single request reached a degraded completion, not a source-success citation response; no replay citation persistence is claimed. [10] |
| Public structured metadata propagation | **PASS** | Existing fixtures prove public `webGrounding` propagation through stream completion and persisted replay metadata, while excluding private RAG text, excerpt bodies and internal cascade fields; provider results carry the same additive DTO in stream and non-stream paths. [2] [7] |

## FRONTEND

| Проверка | Статус | Evidence boundary |
|---|---|---|
| Published source-card acceptance | **BLOCKED** | The published UI showed truthful unavailable-source status and no source cards; actual citation-card acceptance remains unproven. [10] |
| Citation and honest-status rendering | **PASS** | UI fixtures verify actual public citation links and labels for verified grounding and an explicit unavailable state without links where current sources are unavailable. [8] |

## CAPACITY CONTROLLER

| Проверка | Статус | Evidence boundary |
|---|---|---|
| Controller bypass on live search | **UNVERIFIED** | No live request was available to inspect; no bypass is inferred. |
| Existing Controller V1 integration | **PASS** | The existing implementation admits only real cascade attempts, retains a separate search lifecycle, preserves cooldown/order semantics and does not turn cache reuse or fallback into an extra LLM attempt. [3] [5] [9] |

## PRIVACY

| Проверка | Статус | Evidence boundary |
|---|---|---|
| Current closeout browser scope | **PASS** | Only the published chat UI and the single request result were observed. History, memory, exports, settings, attachments, resource IDs and unrelated user content were not opened. [10] |
| Cache, telemetry and public DTO data minimisation | **PASS** | Existing V1 contract/test coverage prohibits user identity, personal context, query text, raw source bodies, URLs in aggregate telemetry, tokens and provider responses from shared cache/telemetry; the public DTO is limited to structured citation/status fields. [3] [4] [5] [7] |

## COST SAFETY

| Проверка | Статус | Evidence boundary |
|---|---|---|
| Live traffic in this closeout | **PASS** | Exactly one user-authorized current-web chat request was sent; no additional LLM/search/email/quota probe, retry or load traffic was sent. |
| Architecture/account cost change | **PASS** | No provider, account, key, billing activation, routing/model change, quota-bypass, external infrastructure, migration or UI change was made. |

## FIXES MADE

| Проверка | Статус | Evidence boundary |
|---|---|---|
| Production code fix | **PASS** | No concrete V1 code defect was observed; no source/runtime code was changed to force a result. |
| Evidence-only closeout changes | **FIXED** | Added only sanitized live-result evidence, this closeout report update and tracker closure; production behavior was not changed. |

## TEST RESULTS

| Проверка | Статус | Evidence boundary |
|---|---|---|
| Published V1 baseline | **PASS** | The published V1 closeout recorded 11 focused mocked/no-network files / 141 tests, `pnpm check`, `git diff --check` and V1 report/tracker gates as passing. [2] |
| Current closeout narrow rerun and static gates | **PASS** | Re-ran the approved 11-file fully mocked/no-network V1+Controller scope: 11 files / 141 tests passed. `pnpm check` and `git diff --check` also passed. Broad suites and production build were excluded. |

## BLOCKED/UNVERIFIED

| Item | Статус | Reason and safe next condition |
|---|---|---|
| Actual authenticated source-success/citation proof | **BLOCKED** | Authenticated Flash request was executed once, but the live search returned no verifiable sources and therefore no citation-success proof. No retry is permitted in this closeout. [10] |
| Live source metadata, grounded answer comparison, citation UI and live admission | **BLOCKED** | The request produced only a truthful degraded outcome; source records and citation cards were absent, while public admission metadata is not exposed. No independent provider failure is claimed. [10] |
| Cache-live hit/dedup and hostile-live provider proof | **UNVERIFIED** | Intentionally not needed for this constrained closeout; deterministic fixtures provide the permitted evidence. |
| Production bundle completion | **BLOCKED** | The retained Vite SIGTERM/resource classification is a separate platform/resource item and was not rerun. [2] |
| Stytch Magic Link EmailDelivery | **BLOCKED** | Preserved external HTTP 400 delivery blocker; no new delivery/status/provider action occurred. [2] |

## FINAL WEB-GROUNDED V1 STATUS

**Verdict: WEB-GROUNDED V1 READY WITH DOCUMENTED LIMITATIONS.** The published V1 code-level/deterministic contract remains intact, and the single authenticated live request confirmed truthful degraded behavior when no verifiable fresh sources were available. Actual source-success is **BLOCKED** because this request returned no verifiable live source records or citations; this report makes no claim of successful live retrieval, provider quota, global capacity or production build completion.

No new Web Search audit is started by this closeout. No further live request is authorized in this closeout. Any future targeted task would require a separate explicit scope.

[1]: data/web-grounded-v1-source-success-prerequisite-2026-08.md "Sanitised published-session prerequisite evidence"
[2]: web-grounded-model-responses-v1-2026-08.md "Published WEB-GROUNDED MODEL RESPONSES V1 evidence"
[3]: data/web-grounded-v1-contract-2026-08.md "V1 provenance, Controller, cache and public-metadata contract"
[4]: ../../server/chat-context.test.ts "Mocked/no-network freshness, privacy, cache, role and degradation coverage"
[5]: ../../server/web-search.test.ts "Mocked/no-network cascade, source normalization, cache/dedup and aggregate telemetry coverage"
[6]: ../../server/providers.test.ts "Mocked/no-network four-role untrusted-source and conflict-guidance coverage"
[7]: ../../server/chat-stream.test.ts "Mocked/no-network public stream/persistence/replay metadata coverage"
[8]: ../../client/src/components/AIChatBox.test.tsx "Mocked UI public citation and honest grounding-status coverage"
[9]: ../../server/capacity-controller.test.ts "Mocked/no-network Controller V1 reservation and separate search admission coverage"
[10]: data/web-grounded-v1-live-source-success-recheck-2026-08-28.md "Sanitized single authenticated live request outcome"
