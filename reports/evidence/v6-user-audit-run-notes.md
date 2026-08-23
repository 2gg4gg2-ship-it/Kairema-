# v6 User Audit — Live Run Notes

## 2026-08-23 — Published authenticated memory recheck

| Scope | Result | Privacy-safe observation |
|---|---|---|
| Session boundary | PASS | A published authenticated session became available. Existing history was not opened for audit review. |
| Cross-chat memory, Flash | PASS (limited) | A fresh neutral fact was sent in an isolated chat; after a bounded extraction wait, a separate new chat recalled the test fact. The answer also reflected prior user-owned memory, so no claim of a clean empty-store exact-match test is made. |
| Cross-chat memory, Context | PASS (limited) | The same isolated recall was present through Context. No assistant text, historic record, attachment data, URLs or identifiers are retained here. |
| Think role | NOT VERIFIED | The published role card currently reported unavailable before any request was sent. No chain change or hidden fallback was attempted. |

This note is metadata-only. It does not reproduce prompts, replies, history, source data, attachment data, user IDs, provider error text, or browser-session material. Further role, attachment, live-search, settings and deletion checks remain in progress.

## 2026-08-23 — Published recheck after post-turn worker fix

| Scope | Result | Privacy-safe observation |
|---|---|---|
| Isolated fresh-fact write | PASS | A unique neutral audit marker was acknowledged in a newly created chat after the published fix. Existing history was not opened or used as test data. |
| Exact cross-chat recall | NOT VERIFIED | A follow-up clean-chat check did not produce a safely usable exact-marker assertion. Extraction-job health was later confirmed only in aggregate; no private record, prompt or reply is retained. A clean-store, exact-match browser scenario remains required. |

This addition remains metadata-only and does not retain the marker itself, prompt/reply text, prior history, attachment data, URLs, user IDs, provider error text, or browser-session material.

## 2026-08-23 — Memory worker and profile remediation

| Scope | Result | Privacy-safe observation |
|---|---|---|
| Post-turn durable processing | FIXED — code verified | The stream now emits its completion event before finishing response handling, while durable enqueue and the immediate, failure-isolated memory worker finish before stream close. The pre-existing bounded Heartbeat retry remains unchanged. |
| Automatic profile summary | FIXED — code verified | A read-only bounded summary refreshes only after a successful extracted fact/topic write and does not replace a non-empty manual profile. No new LLM call or schema migration was introduced. |
| Active dialog settings binding | PASS — regression verified | The user-flow dialog binds memory switches to the authoritative settings object. The obsolete legacy dialog is not rendered in the client flow. |
| Regression and type safety | PASS | Full suite: 40 files passed, 1 skipped; 186 tests passed, 4 skipped. TypeScript passed. |

These are code-level results. They do not convert the clean-store cross-chat recall, second-user isolation, attachment, all-role, live-search, or owner-only checks into browser PASS results.
