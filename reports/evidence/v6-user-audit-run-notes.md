# v6 User Audit — Live Run Notes

## 2026-08-23 — Published authenticated memory recheck

| Scope | Result | Privacy-safe observation |
|---|---|---|
| Session boundary | PASS | A published authenticated session became available. Existing history was not opened for audit review. |
| Cross-chat memory, Flash | PASS (limited) | A fresh neutral fact was sent in an isolated chat; after a bounded extraction wait, a separate new chat recalled the test fact. The answer also reflected prior user-owned memory, so no claim of a clean empty-store exact-match test is made. |
| Cross-chat memory, Context | PASS (limited) | The same isolated recall was present through Context. No assistant text, historic record, attachment data, URLs or identifiers are retained here. |
| Think role | NOT VERIFIED | The published role card currently reported unavailable before any request was sent. No chain change or hidden fallback was attempted. |

This note is metadata-only. It does not reproduce prompts, replies, history, source data, attachment data, user IDs, provider error text, or browser-session material. Further role, attachment, live-search, settings and deletion checks remain in progress.
