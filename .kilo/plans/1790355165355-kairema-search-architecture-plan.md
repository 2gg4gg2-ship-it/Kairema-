# LIVE_VALUE pipeline — implementation plan

Read-only architectural audit + implementation plan. Base: branch `staging`, HEAD `d024b11` (clean tree). No source file was modified while producing this plan.

## Problem

`Какая сейчас погода в Одессе?` still answers *"Я не располагаю подтверждёнными данными"* even though `you` returned 5 relevant sources whose snippets carried `+19 °C` and `Мелкий дождь`. Cause is architectural, not prompt-level: **nothing in the pipeline checks that a returned page contains the value the user asked for.**

- `chat-context.ts:171-173` sets `requireDatedSources: false` for live-value asks, so any undated page becomes "verified" (`web-search.ts:410-421`, `qualifyingFreshResult`).
- `WebEvidence` (`providers.ts:16-25`) has no slot for "what this source answers"; `sourceSummary` (`web-search.ts:262-264`) emits raw snippets, so extraction, ranking and temporal reasoning are all delegated to the model — exactly the `d024b11` failure.
- A timezone page containing only `UTC+3` passes as a verified answer to "который сейчас час".
- One query only. There is no legitimate *value-shaped* second formulation (the 2ccdf02 ban applies to instruction wrappers, not to a value-shaped query).
- Telemetry has no "did we answer" signal: `search_quality_metrics` (`drizzle/schema.ts:175-184`) records outcome/verification only.

Target: first-class task kinds (GENERAL / RECENT / LIVE_VALUE) and a deterministic, offline-testable value layer that must prove a value exists before a live result is called confirmed. **No new provider, key, env var, LLM call, or paid service.**

## Decisions (already settled)

| # | Decision |
|---|---|
| D1 | Three task kinds replace the boolean `isLiveValueQuery` path. `LIVE_VALUE` = today's-ask + live-value topic + not publication-dated, i.e. exactly today's `isLiveValueQuery` logic (`chat-context.ts:76-79`), re-derived from the existing patterns only (`chat-context.ts:16,23,27,33,36,37`). `RECENT` keeps `freshnessSearchPolicy` (`:87-92`) unchanged. No new vocabulary. |
| D2 | The provider query in **pass 1** is the untouched user request (`buildGlobalDiscoveryQuery`, `web-search.ts:239-245`; test `web-search.test.ts:38-47`, `:64-82` must stay green). A **pass 2** is allowed only for LIVE_VALUE, only with a deterministic value-shaped query, and only with a *different* query string. |
| D3 | A LIVE_VALUE result is `confirmed` only when a value for the requested kind was extracted from a snippet **and** is temporally attributable. Otherwise the sources/evidence are still delivered with `valueStatus: "unconfirmed"` — `verificationStatus` stays `"verified"` for the pages themselves, so `chat-stream.ts:244` keeps emitting them. Only the value claim is withheld. |
| D4 | Attribution rule (evaluated in order): (1) explicit recency marker in the snippet (`сейчас`, `текущ…`, `на данный момент`); (2) explicit zone in the snippet (`UTC+3`, `GMT+3`, `MSK`) + label hour not in the future of `now` in that zone; (3) no explicit label at all + source `publishedAt`/`page_age` (`web-search.ts:273-278`, `youPageAgeAsUtc`) within 90 min of `now`; (4) an hour label with **unknown** zone ⇒ `unconfirmed`. This is what makes the `d024b11` case (`+19 °C` labelled `13:00` at local 12:34) fail closed instead of being reported as "now". |
| D5 | Network budget: 4 requests for GENERAL/RECENT, 6 for LIVE_VALUE, counted per `searchWeb` call across both passes. Pass 2 is skipped if the shared `AbortSignal` (`web-search.ts:429`) has under 25 % of `timeoutMs` left, so the fast role's `FLASH_WEB_RESEARCH_BUDGET_MS = 1500` (`chat-context.ts:11`) is not blown. |
| D6 | The value line is prepended to `summary` **inside `web-search`** (single place, covered by pipeline tests). `chat-context.ts` only adds the honest `freshnessWarning` for the unconfirmed case — no new prompt engineering. |
| D7 | Capacity is untouched: the search lease keys on `${requestKey}:search` (`capacity-controller.ts:396`), a second `reserve()` returns a **deduplicated** ticket (`:445-446`) and `settleCapacityReservation` is idempotent (`:479`). A second pass therefore costs no extra WCU. Known limitation (not fixed here): the first settle releases the inflight counters while pass 2 is still running, so search concurrency is under-counted by one for LIVE_VALUE turns. |
| D8 | Storage is additive and nullable: 3 nullable columns, no `mysqlEnum` change (a new enum value would need an `ALTER` on an existing enum). `verification` stays untouched. |
| D9 | `db.ts:832` clamps `attemptedLayerCount` to **3** while 4 layers exist; with a 6-request budget this must be widened to 6 or the owner panel silently saturates. Also `verifiedSourceCount` stays clamped to 5 (`SOURCE_LIMIT`, `web-search.ts:56`). |

## Implementation steps (ordered)

1. **`server/web-search-value.ts` (new, pure)** — no network, no db, no `Date.now()` (a `now` argument is passed in; this is what makes offline quality testing possible).
   - `SearchTaskKind = "GENERAL" | "RECENT" | "LIVE_VALUE" | "NONE"`, `LiveValueKind = "temperature" | "conditions" | "clock" | "rate"`.
   - `classifySearchTaskKind(query)`, `liveValueKinds(query)`, `liveValueEntity(query)` (returns `null` when no entity is resolvable — e.g. `Какая сейчас погода?` — so pass 2 is skipped, not guessed).
   - `buildValueTargetedQuery(query, kinds, entity)`: `temperature`+`conditions` → `current weather ${entity} temperature precipitation`; `clock` → `current time in ${entity}`; `rate` → `current exchange rate ${pair}` with a fixed token map (доллар→USD, евро→EUR, гривна→UAH, рубль→RUB) and **skip** when either side is unresolvable. ≤ ~90 chars, entity-preserving, imperative-free, must differ from the user query.
   - `extractValues(text, kind): ExtractedValue[]` (`{ raw, value, unit?, label? }`): `temperature` requires `°C`/`°С`/`градус(ов)` (this is what rejects SINOPTIK widget noise `"40 20 0 -20 -40"`) with range −90..+60; `clock` requires `HH:MM`/`ЧЧ:ММ`, rejected next to a 4-digit year, and required to co-occur with the entity or a zone token; `rate` requires 2–4 decimals next to a resolved pair token; `conditions` is lexicon presence (дождь/снег/гроза/ясно/облачно) — the condition is the value.
   - `validateValue(values, { now, entity, kind, source })` → `{ status, reason, asOf }` per D4.
   - `valueSummaryLine(status, values, source)` → `ИСКОМОЕ ЗНАЧЕНИЕ: +19 °C, осадки: мелкий дождь (SINOPTIK, на 13:00)` or `ИСКОМОЕ ЗНАЧЕНИЕ НЕ ПОДТВЕРЖДЕНО: найдены релевантные источники, но ни один не содержит значения, отвечающего на вопрос.`
2. **`server/web-search.ts`**
   - `SearchWebOptions` (`:38-48`) gains `taskKind?`, `targetedQuery?`, `maxNetworkRequests?`.
   - One shared budget object per `searchWeb` call; decrement in `requestSearch` (`:348-366`) call sites for both passes.
   - Pass 1 = existing cascade, unchanged. LIVE_VALUE + not confirmed + budget/time left ⇒ pass 2 = same layer order with `targetedQuery` (re-hitting a layer with a *different* query is allowed; the identical query must never be re-sent).
   - `evidenceFromEntries`/`sourceSummary` (`:246-264`) receive the value line; `WebEvidence.valueStatus` per entry. `runCascade` (`:425-481`) semantics for GENERAL/RECENT are byte-identical.
   - `publicCacheKey` (`:387`) gains `taskKind`; a LIVE_VALUE outcome is cached only when confirmed. Both `recordSearchQuality` call sites (`:452`, `:472`) gain `taskKind`, `valueConfirmed`, `targetedPass`.
3. **`server/chat-context.ts`** — call site at `:160-182` switches from `isLiveValueQuery` to `classifySearchTaskKind`, passes `taskKind`/`targetedQuery`; LIVE_VALUE + unconfirmed sets a new `LIVE_VALUE_UNCONFIRMED_PROMPT` next to `chat-context.ts:40-42` and sets `searchStatus.liveValue = { kind, status }` (kind/status only — never the raw value).
4. **`server/providers.ts`** — `WebEvidence.valueStatus?` (`:16-25`), `SafeSearchStatus.liveValue?` (`:28-40`), and **one** sentence in the `<АКТУАЛЬНАЯ ИНФОРМАЦИЯ>` header (`:295`) stating that the block's first line is the machine-checked value or the reason it is unconfirmed, and that it wins over the model's own inference. The two `d024b11` rules stay as-is. `WebGroundingState` (`:42`) is **not** extended.
5. **`server/chat-stream.ts:198-211`** — `publicSearchStatus` adds `liveValue` with enum validation (kind ∈ 4, status ∈ 3), nothing else crosses the boundary.
6. **Client** — `client/src/lib/chat-stream.ts:6`, `client/src/pages/Home.tsx:27,47-50` re-validate the new field; `client/src/components/AIChatBox.tsx:23,63-64,337` add one status line RU/EN («Значение подтверждено источниками» / «Значение не подтверждено»). Extracted values are never rendered.
7. **Telemetry** — `drizzle/schema.ts:175-184` + `drizzle/0044_live_value_quality.sql` (latest existing migration is `0043_recover_chat_exports.sql`): `taskKind varchar(16) NULL`, `valueConfirmed int NULL`, `targetedPass int NULL`. `server/db.ts:778-836` input + clamps (incl. D9), `getSearchQualityPanel` (`:848-861`) adds `liveValue: { sampleCount, confirmed, unconfirmed, notFound, confirmationRate }`. Privacy invariant and `search.quality-panel.test.ts:59,71` unchanged.

## Tests

- **Offline golden harness** `server/__fixtures__/search/*.json` (~15 scrubbed real provider payloads: value-in-snippet, value-in-description-only, relevant page with no value, future-hour label, timezone page without a clock reading, rate with/without pair, malformed `snippets`, value for a different entity, conflicting values, empty, 429/timeout) + `server/web-search-value.test.ts` (no fetch, no db): every value-bearing fixture ⇒ `confirmed` (or `unconfirmed` with a future `asOf`); every value-less fixture ⇒ never `confirmed`; **zero false confirmations is the hard gate**; extracted values never contain `[object Object]`, empty strings, or exceed the label cap.
- `server/web-search.test.ts` — two-pass order, budget cap, re-hit-same-layer-with-new-query allowed, identical query never re-sent, non-LIVE_VALUE output byte-identical to today; existing 35 cases (incl. `:38-47`, `:64-82`, `:115-119`) unchanged.
- `server/chat-context.test.ts`, `server/providers.test.ts` — task-kind matrix, unconfirmed warning text, value line placement, existing `d024b11` prompt rules intact.
- `server/chat-stream.test.ts`, `server/client-stream.test.ts`, `client/src/components/AIChatBox.test.tsx` — new field re-validated client-side; panel JSON still free of `https?://|query|userId|provider|model|source`.
- Optional live smoke, manual only: `describe.runIf(process.env.RUN_LIVE_PROVIDER_TESTS === "1")` mirroring `v6k-search-secrets.test.ts` — not in CI.

## Not needed / out of scope

No new provider, key, env var or endpoint (`FIRECRAWL_API_KEY` / `KEIRO_API_KEY` exist only in `v6k-search-secrets.test.ts` — do not wire them). No Google/Gemini grounding (`googleHttp` stays a null-only legacy field, `web-search.ts:16-17`). No LLM for extraction, rewriting, reranking or verification. No embeddings, vector store, chunking, crawler or page fetching (Exa already returns `contents.text`). No prompt band-aid beyond the single step-4 sentence. Do not change `SOURCE_LIMIT=5`, `SNIPPET_LIMIT=550`, `QUERY_LIMIT=8000`, the 4 roles, `MAX_ATTEMPTS=4`, memory, transcript window, streaming shape, secrets handling, `web_search_status`/`googleHttp`, or the public source/evidence allowlists. Unified memory, `knowledge.ts` (RSS corpus), capacity controller, owner screens and extracted values in the UI are out of scope.

## Risks / rollout

- **Migration order**: columns are nullable and metric writes are fire-and-forget, so an un-migrated DB degrades silently — run `pnpm db:push` **before** deploying the code.
- **Provider load**: a LIVE_VALUE turn may issue up to 6 search requests (search only; the 4-attempt LLM budget is untouched). Watch `search_outage_logs` for rate-limit growth; the 10-min per-layer cooldown still protects the weakest layer.
- **Flash latency**: a two-pass fast turn may hit `FLASH_WEB_RESEARCH_BUDGET_MS`; D5's 25 %-of-timeout rule makes pass 2 a no-op there rather than a hang.
- **False confidence**: extractors are deliberately narrow. A miss degrades to the honest "value not confirmed" state, never to a fabricated value. Widening a kind is a one-line registry change.
- **No staging access from this environment**: every step must be validated by offline tests plus a local live smoke run before push.

## Readiness criteria

1. `pnpm test` (or the repo's test command) green; new suites pass; no existing assertion edited except where a test explicitly asserted the old live-value behaviour.
2. Offline harness: 0 false confirmations; every kind meets its confirmation-rate floor on the fixtures.
3. `Какая сейчас погода в Одессе?` and `Который сейчас час в Одессе?` return `searchStatus.liveValue.status: "confirmed"` with a value line, or an explicit "not confirmed" line — never "sources verified" with no value claim.
4. A UTC-only page can no longer confirm a clock question; a `13:00`-labelled value can no longer be presented as "now".
5. Public boundary: `liveValue` carries kind/status only; no value, snippet, URL or provider name is exposed or persisted.
6. `pnpm db:push` applied before deploy; `getSearchQualityPanel().last24h.liveValue.confirmationRate` non-zero on staging.
