# WEB-GROUNDED MODEL RESPONSES V1 — implementation contract

## Scope and invariants

V1 extends only the existing `buildChatContext` → `searchWeb` → four-role provider → SSE path.  The public role set remains Flash (`fast`), Think (`smart`), Context (`context`) and Apex (`flagship`).  Existing provider chains, Provider Health/cooldowns, search order You → Serper → Exa → Tavily, Controller V1 generation policy and `MAX_ATTEMPTS=4` remain unchanged.

## Freshness and search states

The server derives one of three intents without a model-classification call: `NONE`, `PREFERRED`, or `REQUIRED`.  The classifier combines temporal language, externally verifiable entity/topic signals, question structure and explicit latest/current framing; it excludes Kairema self-identity and ordinary stable questions.  `REQUIRED` never permits the model to call a volatile fact verified when search is disabled, denied, empty, stale, unavailable or times out.  `PREFERRED` may continue with a clearly labelled non-current answer if no verified source exists.  Only server-generated query text and a bounded normalized request are supplied to the existing cascade.

## Provenance and public DTO

The server-only context names the `<АКТУАЛЬНАЯ ИНФОРМАЦИЯ>` block `WEB SOURCES` in a structured contract.  A verified result contains only normalized title, canonical HTTP(S) URL, domain, `publishedAt` when supplied and `retrievedAt`; snippets remain data, never instructions.  The SSE/public message DTO exposes a bounded `webGrounding` object with neutral state, intent and sanitized citations.  It contains no prompt, raw snippet, API/provider diagnostic, account/user identifier, cache key or internal source id.  The established legacy `searchStatus` and `sources` fields remain compatible.

## Bounds, admission and failure safety

Source count remains at most five and normalized evidence remains at most 550 characters per source.  Every real cascade provider request invokes the existing `beginCapacitySearch` lease before its network call and settles/releases its own attempt reservation afterwards.  One search lease retains local per-user concurrency across the cascade.  Admission denial, timeouts and unavailable sources skip downstream search layers and produce a truthful safe state; they never trigger an extra LLM/provider attempt.

## Cache, dedup and privacy

Only public, non-personal, current/search-eligible queries may use the in-process cache and concurrent in-flight dedup.  Private/personal contexts, attachments, memory-bearing formulations and authentication/account queries bypass both.  Cache keys are a server-side SHA-256 digest of normalized public query plus freshness-window policy, never logged or sent to clients.  Cache is bounded by a short TTL, small entry count and fixed eviction; it holds only normalized public search outcomes and no user identity/content.  A cache hit does not reserve search capacity or contact a provider.  This is explicitly per-instance opportunistic optimization, not shared/global storage.

## Quality and test contract

Tests must remain deterministic and no-network.  They cover `REQUIRED`/`PREFERRED` decisions, malicious prompt-like source data, undated/stale rejection, cache private-query bypass, TTL/eviction, concurrent dedup, per-attempt capacity reservation, denied admission, no citation fabrication, all four roles and SSE/persisted replay compatibility.  Runtime acceptance must remain one safe, short non-personal current question only after deterministic validation; it is not capacity/load/provider-quota evidence.
