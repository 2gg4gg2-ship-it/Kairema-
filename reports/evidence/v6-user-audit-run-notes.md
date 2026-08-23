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

## 2026-08-23 — Published URL and public role-card availability

| Scope | Result | Privacy-safe observation |
|---|---|---|
| User-supplied `https://lkn.manus.space` | NOT AVAILABLE | The URL returned the public platform maintenance screen, so it is not a usable Kairema acceptance target at this time. |
| Current Kairema published domain | PASS | `https://kairema-ai-gxujplkn.manus.space/` was reachable and displayed exactly four public role cards: Flash, Think, Context and Apex. |
| Public availability presentation | PASS (display only) | Every role card showed the public backup-active status and public checked timestamp. This is not evidence that each role completed a new audit request. |

This observation contains no history, prompts, replies, identifiers, sources, attachment data, or secrets.

## 2026-08-23 — Think role neutral memory recheck

| Scope | Result | Privacy-safe observation |
|---|---|---|
| Think availability | PASS (limited) | The published Think role accepted a neutral audit query while its card presented the public backup-active state. |
| Think cross-chat recall | PASS (limited) | In an isolated audit chat, Think returned the exact value of the prior neutral audit marker. No prompt, reply, marker value, history item, source data or identifier is retained in these notes. |

This is evidence for one isolated fresh-marker path only. It does not substitute for a clean-store test, all-role memory coverage, second-user isolation, attachment acceptance, live-search freshness or owner-only gates.

## 2026-08-23 — Apex selection and audit privacy boundary

| Scope | Result | Privacy-safe observation |
|---|---|---|
| Apex role selection | PASS (display/control) | The canonical published UI switched a new empty audit chat to Apex and retained an enabled composer. No request was sent in this observation. |
| Existing-history boundary | PROTECTED | The authenticated browser surfaces the account's own history in its sidebar. Audit steps do not open, reproduce, export, or use those entries as test data; only new neutral chats are eligible for controlled tests. |

This entry deliberately excludes all visible history labels, message data, identifiers, source data, attachment data and session material.

## 2026-08-23 — Public role selector recheck

| Scope | Result | Privacy-safe observation |
|---|---|---|
| Four-role selector | PASS | In an empty audit chat, the canonical published selector exposed exactly Flash, Think, Context and Apex. Each entry retained its public capability description and backup-active label. |
| Status summary | PASS (display only) | The canonical header reported a public aggregate availability state. This does not imply a new upstream request or replace individual role smoke tests. |

This entry contains no messages, history labels, prompts, replies, source data, attachments, identifiers, secrets or provider error details.

## 2026-08-23 — Flash role control recheck

| Scope | Result | Privacy-safe observation |
|---|---|---|
| Flash selection | PASS (display/control) | In an empty audit chat, the canonical published selector switched to Flash and preserved an enabled composer. No message content or prior history was used in this control check. |

| Flash neutral smoke test | PASS | A newly created, history-free audit chat completed a deterministic arithmetic prompt with the expected result. The assistant bubble presented a user-facing model label and completed state. Prompt/reply text and technical provider details are intentionally excluded. |

## 2026-08-23 — Context role neutral smoke recheck

| Scope | Result | Privacy-safe observation |
|---|---|---|
| Context selection and completion | PASS | In the active neutral audit chat, Context completed a bounded deterministic response with the expected result. The user-facing response indicated an available fallback. |
| Cross-chat memory capability | PASS (limited) | A prior isolated fresh-marker check through Context was successful. It does not replace the separately outstanding clean-store exact-match acceptance criterion. |

This entry contains no prompt/reply payload, history data, source metadata, attachment data, identifiers, secrets or provider technical error details.

## 2026-08-23 — PDF/document card remediation

| Scope | Result | Privacy-safe observation |
|---|---|---|
| Composer document chip | FIXED — code verified | A compact formatted size now appears with the document filename, while the existing remove control and image-preview branch remain separate. |
| Sent-bubble document chip | FIXED — code verified | The sent attachment chip now displays the same formatted size without rendering an attachment URL or file bytes. |
| Regression and type safety | PASS | Focused component coverage, full suite and TypeScript passed after the UI-only change. |

This code-level entry does not retain any attachment filename, size, MIME type, URL, file bytes, prompt/reply payload, user identifier or session material. A controlled browser upload remains a separate acceptance item.
