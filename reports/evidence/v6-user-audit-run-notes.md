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

## 2026-08-23 — Role-description visual remediation

| Scope | Result | Privacy-safe observation |
|---|---|---|
| Open role selector descriptions | FIXED — visual verified | The open selector now wraps the full public descriptions for Flash, Think, Context and Apex instead of visually truncating them. |
| Four-role invariant | PASS | The selector still exposes exactly four public roles; their identifiers and configured chains were not changed. |
| Regression coverage | PASS | Focused client regression and a desktop visual recheck passed after the CSS-only correction. |

This entry retains no chat content, history, attachment data, source data, identifiers, secrets or provider technical details.

## 2026-08-23 — Published settings dialog recheck

| Scope | Result | Privacy-safe observation |
|---|---|---|
| Settings dialog and self-diagnostics | PASS | The canonical published dialog opened and its diagnostics rendered only the current theme and contrast state, with an explicit safe-reset action. No chat, history, keys, routes, identifiers or technical payloads were displayed in the isolated audit viewport. |
| Default-role dropdown | PASS | The closed control showed its current value. The opened list exposed exactly the four public roles with complete, wrapped capability descriptions; Escape closed the list without choosing or persisting a new value. |
| High-contrast switch | PASS | A reversible published interaction reached the semantic checked state and returned to its original unchecked state. The original account preference was restored after the observation. |

This is a focused settings-dialog result. It does not yet substitute for the remaining profile-save, theme/language, responsive-control, clean-store memory, attachment, live-search or owner-only acceptance criteria. No prompt/reply text, history item, source metadata, attachment data, user ID, session material, secret, raw error or technical provider data is retained.

| Theme and language controls | PASS | Reversible published interactions changed the semantic theme and language states, then restored the original dark Russian interface. No content-bearing area was included in this validation. |
| Focused Home regression | PASS | `client/src/pages/Home.integration.test.tsx` completed: 27 passed. Coverage includes explicit profile-save UI, independent switch state during a pending save, light/dark switch visual states, named dropdown controls, closed/open role-dropdown behavior, and absence of internal routing details in settings. |

The profile-save result above remains component/integration-level evidence. A new browser write is intentionally not performed against an unknown existing user profile because the audit may not read its current value and cannot safely restore it without disclosing private data.

## 2026-08-23 — Settings-save rollback remediation

| Scope | Result | Privacy-safe observation |
|---|---|---|
| Theme save failure | FIXED — regression verified | A failed settings mutation previously cleared the optimistic persisted settings override but could leave the locally toggled theme visually changed. The failure handler now applies the compensating theme toggle before clearing the override. |
| Focused regression | PASS | The Home integration test simulates a rejected theme save and verifies both the initial user-facing switch and the compensating rollback. |
| Full regression and type safety | PASS | Full `pnpm test`: 40 files passed, 1 skipped; 189 tests passed, 4 skipped. `pnpm check` passed. |

The remediation does not alter the four roles, provider chains, attempt budget, memory extraction schedule, attachment lifecycle, owner guard, schema or `chat_exports`. It contains no user content, identifiers, secrets, URLs, raw errors or technical provider data.

## 2026-08-23 — Context exact-recall recheck

| Scope | Result | Privacy-safe observation |
|---|---|---|
| Context cross-chat exact recall | PASS (limited) | In a newly created, isolated audit chat, Context returned the exact value from a prior neutral marker chat. The test used no historic conversation as input and retained no prompt, marker, reply, attachment, source, identifier or provider-detail data. |
| Flash cross-chat exact recall | PASS (limited) | In a newly created, isolated audit chat, Flash returned the exact value from the same prior neutral marker chat. The test used no historic conversation as input and retained no prompt, marker, reply, attachment, source, identifier or provider-detail data. |

This confirms fresh-marker routes through Context and Flash. It does not replace the clean-store, all-role, second-user-isolation, attachment, live-search or owner-only acceptance criteria.

## 2026-08-23 — Apex exact-recall recheck

| Scope | Result | Privacy-safe observation |
|---|---|---|
| Apex cross-chat exact recall | PASS (limited) | In a newly created, isolated audit chat, Apex returned the exact value from the prior neutral marker chat. The check used no historic conversation as input and retains no prompt, marker, reply, attachment, source, identifier or provider-detail data. |

This proves one fresh-marker route through Apex only. It does not convert the separate clean-store, second-user-isolation, attachment, live-search or owner-only criteria into PASS.

## 2026-08-23 — Authoritative web-search preference remediation

| Scope | Result | Privacy-safe observation |
|---|---|---|
| Saved web-search preference | FIXED — regression verified | The active server-side context builder now checks the saved web-search preference before any live-research call. An enabled preference retains the existing role-specific live-search path; a disabled preference performs no live-research call. Optional RAG retrieval and its existing metadata-only privacy contract remain separate. |
| Focused server regression | PASS | `server/chat-context.test.ts` completed: 23 passed, covering both enabled and disabled web-search preference semantics alongside existing memory, attachment, RAG and freshness scenarios. |
| Type safety and production build | PASS | `pnpm check` and `pnpm build` completed successfully. |
| Full suite | EXTERNAL AVAILABILITY BLOCKER | The suite completed with 38 files passed, 1 skipped, 188 tests passed, 4 skipped, and 2 external credential-health checks rejected by their remote services. This does not affect the focused deterministic regression, but it is not reported as a full-suite PASS and no provider state, chain, fallback or health semantics was changed to mask it. |

This remediation does not expose or retain prompts, replies, source links, titles, snippets, attachment data, user/session identifiers, provider internals, raw errors or secrets. Published browser validation of the new authoritative setting remains required after deployment; the broader live-search criterion is still open.

## 2026-08-23 — Privacy-fix publication delivery check

| Scope | Result | Privacy-safe observation |
|---|---|---|
| Local remediation | PASS — code verified | The second escaped opaque citation-ID regression is covered in the shared server/client sanitizers, focused tests, TypeScript and production build. |
| Published frontend delivery | PASS — current asset delivered | A subsequent publication refresh and cache-busting navigation loaded a new frontend asset that contains the current narrow sanitizer signature. No message content, history data or identifier values were inspected for this asset-level check. |
| Fresh neutral reply recheck | NOT VERIFIED — public session | The browser is currently signed out and therefore cannot create the required new neutral chat. The prior rendered replay is not reopened or used as test data. |
| Browser privacy boundary | PROTECTED | No history entry was opened, copied, exported or used as input. The audit retained neither response content, opaque IDs, source data, attachment data, account/session identifiers nor raw errors. |

The citation-replay criterion remains open until a newly created neutral chat confirms absence in an authenticated session. No provider chain, owner guard, schedule, schema, attachment lifecycle or `chat_exports` was changed.

## 2026-08-23 — Published web-search control persistence recheck

| Scope | Result | Privacy-safe observation |
|---|---|---|
| Published settings control | PASS | The labelled web-search switch was available in the published settings dialog. A reversible toggle reached the disabled state, preserved that state after a published reload, and was restored to the original enabled state. No message, history title, source, account identifier or response content was retained. |
| Server-side effect | CODE-LEVEL PASS | The deterministic server regression remains the authoritative proof that the persisted preference gates live research. The browser recheck confirms the user-facing switch and persistence path; it does not claim a fresh-source answer where external layer availability may vary. |
| Broader live-search acceptance | OPEN | Safe count/date/unavailable UI and honest external availability still require a separate neutral request check. Raw URLs, source titles, snippets and provider internals remain excluded from UI evidence. |

## 2026-08-23 — Published neutral live-search acceptance

| Scope | Result | Privacy-safe observation |
|---|---|---|
| Enabled-preference current-data scenario | PASS | A new isolated audit chat completed a neutral current-data request with the restored enabled preference. The rendered status reported a verified search outcome, positive safe count and a normalized source-date range. |
| Stream completion and safe response metadata | PASS | The completion control disappeared before observation finished. The assistant region exposed no visible link. The audit retained only the status category and boolean count/date/link checks. |
| Raw-source redaction | PASS | The rendered assistant region had zero visible anchor links. No raw source URL, title, snippet, prompt, reply, provider internals, identifier, attachment data or secret was recorded. |

This verifies one neutral published Flash search route. The separate all-role search matrix, RAG-only stale badge, attachment-browser criterion, second-user isolation and owner-gated criteria remain open.

## 2026-08-23 — Controlled attachment browser-path availability

| Scope | Result | Privacy-safe observation |
|---|---|---|
| Neutral upload preparation | READY | A neutral non-user image asset was available outside the project repository. The published composer exposed its attach control and a disabled=false file input with the supported image/document accept policy. |
| Browser picker injection | NOT VERIFIED — automation binding | Two browser automation routes could not bind to the hidden file input: direct injection did not locate the input, while the visible attach control was correctly rejected as a non-input control. No file was uploaded, no chat was sent, and no attachment, URL, name, size, bytes or user data was retained. |
| Product verdict | NOT A REPRODUCED APP DEFECT | This limitation is in the available browser automation binding, not evidence of an application upload failure. Composer preview, protected deletion, sent-bubble preview and vision remain governed by their prior separately evidenced checks; a fresh live upload remains unverified. |

The controlled attachment browser criterion stays open. No user history, source data, prompts, replies, identifiers, secrets or provider details were read or stored.

## 2026-08-23 — Published role-specific live-search smoke checks

| Role | Result | Privacy-safe observation |
|---|---|---|
| Think | PASS — bounded freshness status | A clean neutral current-data chat completed with the safe source-count/date indicators and without user-facing source links. The response explicitly handled current-data limits rather than asserting unsupported fresh facts. |
| Flash | PASS — bounded freshness status | A separate clean neutral current-data chat completed with the safe source-count/date indicators and without user-facing source links. The response indicated live-search unavailability rather than presenting unverified current information as confirmed. |

Both checks used disposable audit chats and recorded no message text, source URL/title/snippet, provider chain, attachment, session identity or raw provider error. Context and Apex still require a separately isolated live-search smoke check; this table does not claim that the real live-search backend was available for every query.

## 2026-08-23 — Technical citation redaction remediation

| Scope | Result | Privacy-safe observation |
|---|---|---|
| Published finding | FIXED IN CODE — published recheck pending | A neutral Context live-search scenario revealed opaque technical citation markers in visible assistant text. The test value and response content were not retained. |
| Shared server-side boundary | FIXED | The assistant sanitizer now removes recognized opaque source/citation reference blocks before streamed deltas reach the UI and before final content is retained. Existing safe source count/date status stays available; raw source URLs, titles, snippets, identifiers and provider internals remain excluded. |
| Deterministic regression | PASS | `server/providers-v5.5.test.ts` completed 5/5, covering line-buffered and fragmented streamed content, technical citation-block redaction and preservation of ordinary numeric arrays. |
| Type safety and production build | PASS | `pnpm check` and `pnpm build` completed successfully. |
| Full suite | EXTERNAL AVAILABILITY BLOCKER | The suite completed with 38 files passed, 1 skipped, 189 tests passed, 4 skipped, and 2 remote credential-health checks rejected externally. This is not reported as a full-suite PASS; no provider chain, fallback, status semantics or secret was changed to mask it. |

The narrow remediation does not retain prompts, replies, source strings, attachment data, account/session identifiers, raw provider errors or secrets. Fresh published confirmation of citation-marker absence is still required before the broader all-role live-search criterion can be closed.

## 2026-08-23 — Mobile shell recheck and current browser-session limitation

| Scope | Result | Privacy-safe observation |
|---|---|---|
| Phone viewport shell | PASS | A fresh 375×812 dark-default Russian UI screenshot renders the role selector, menu controls, new-conversation header, export controls and composer without clipping or overlap. No authenticated history, message body or account data was visible. |
| Published authenticated recheck | NOT VERIFIED — current session public | A fresh visit to the canonical published URL presents the signed-out shell. No existing history or account state was opened, copied or changed. The citation-marker absence and authenticated attachment/live-search paths cannot be rechecked in this browser state and remain open rather than inferred from code tests. |

This does not alter the deterministic citation regression result or prior metadata-only acceptance evidence. It simply records the current browser-session boundary honestly.

## 2026-08-23 — Legacy assistant replay redaction remediation

| Scope | Result | Privacy-safe observation |
|---|---|---|
| Existing-record display gap | FIXED IN CODE — published recheck pending | A pre-existing assistant record created before the server-side citation fix could still show opaque technical reference markers when replayed. Its content, identifiers and conversation metadata were not copied into evidence. |
| Client display and copy boundary | FIXED | A pure client-side defense-in-depth sanitizer now redacts recognized technical source/citation reference blocks before assistant markdown display and before the copy action. It does not mutate, export or otherwise alter historical records. |
| Component regression | PASS | `client/src/components/AIChatBox.test.tsx` completed 11/11. The new deterministic legacy-record scenario confirms technical reference markers are absent from rendered and copied content while ordinary in-sentence numeric arrays remain visible. |
| Type safety and production build | PASS | `pnpm check` and `pnpm build` completed successfully. |
| Full suite | EXTERNAL AVAILABILITY BLOCKER | The suite completed with 38 files passed, 1 skipped, 190 tests passed, 4 skipped, and 2 remote credential-health checks rejected externally. The result is not represented as a full-suite PASS; no provider routing, fallback, health semantics or secret was changed. |

The code fix does not retain or reveal historical message text, source data, attachment data, account/session identifiers, raw provider errors or secrets. A fresh published verification in an authenticated context remains required before this criterion is considered browser-confirmed.

## 2026-08-23 — Escaped opaque citation-ID remediation

| Scope | Result | Privacy-safe observation |
|---|---|---|
| Published finding | FIXED IN CODE — published recheck pending | An authenticated published replay exposed a previously unhandled escaped bracketed multi-identifier citation form. The record content, identifiers, history metadata and session material were not copied into this evidence. |
| Shared redaction boundary | FIXED | Server streaming/final persistence and client replay/copy now remove only escaped multi-item opaque hexadecimal identifier lists. Ordinary numeric arrays remain visible. |
| Focused regression | PASS | The server safety and client component suites completed 16 tests across the two targeted files, including final streaming and legacy replay/copy coverage. |
| Type safety and production build | PASS | `pnpm check` and `pnpm build` completed successfully. |
| Full suite | EXTERNAL AVAILABILITY BLOCKER | The suite completed with 38 files passed, 1 skipped, 190 tests passed, 4 skipped, and 2 external credential-health checks rejected remotely. This is not reported as a full-suite PASS; no provider chain, fallback, health semantics or secret was changed. |

The fresh browser confirmation will use only a newly created neutral chat after deployment. No prompt, reply, source URL/title/snippet, opaque identifier, attachment data, account/session identifier, raw error or secret is retained here.

## 2026-08-23 — Escaped citation replay published recheck

| Scope | Result | Privacy-safe observation |
|---|---|---|
| Current frontend delivery | PASS | The canonical published page loaded the current frontend asset after the publication refresh. |
| Isolated neutral request | PASS | A newly created audit chat completed a current-data request without opening, selecting, exporting or using prior history. |
| Escaped opaque citation form | PASS | The current assistant-message region contained no recognized single- or double-escaped multi-identifier technical citation-list pattern. |
| Raw-link rendering | PASS | The same current assistant-message region exposed no raw HTTP(S) URL. The completion control had cleared before the observation. |

This is a binary verification only. It retains no query or reply text, identifier value, history title, source URL/title/snippet, attachment data, account/session material, provider detail, raw error or secret. The broader all-role live-search matrix remains open.

## 2026-08-23 — Desktop sidebar privacy and navigation remediation

| Scope | Result | Privacy-safe observation |
|---|---|---|
| Confirmed desktop control defect | FIXED | The header sidebar control previously changed state without collapsing the fixed-width desktop layout. The sidebar therefore remained visually exposed. |
| State, accessibility and motion | PASS | A collapsed desktop sidebar now has no layout width, is `inert`, exposes a contextual open/close control, and honours reduced-motion. The existing mobile drawer rules are unchanged. |
| Automated regression | PASS | Focused Home integration completed 29 tests; full suite completed 40 files passed, 1 skipped, 193 tests passed and 4 skipped. TypeScript and production build passed. |
| Neutral visual recheck | PASS | An unauthenticated dark-default desktop shell showed no expanded sidebar width and a visible open-sidebar control. No user history, message content, account data, source data or secret appeared in the observation. |

This result does not change the remaining authenticated-only memory, attachment, all-role search, isolation, or platform-blocked criteria.
