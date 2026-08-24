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

### Published-delivery follow-up

The checkpoint delivery was rechecked through the canonical published endpoint using cache-busting navigation and an asset-level signature test only. At the time of check, the page continued to serve an earlier frontend asset that did not contain the current sidebar-collapse signatures. Therefore the local visual evidence is **not** promoted to a published PASS. No sidebar item, history title, message content, account data, source data, attachment data, provider secret or raw error was recorded. The production sidebar criterion remains **NOT VERIFIED pending current asset delivery**.

### Browser isolation safeguard

During a later published navigation, browser session state changed after the element map had been obtained and the side navigation unexpectedly re-rendered. To protect privacy, no further browser interaction, history inspection, copying, export, deletion verification, or published authenticated acceptance action will be performed from that session. This observation records neither chat text, titles, identifiers, account/session data, sources, attachments, provider details, raw errors nor secrets. It is a **browser-automation isolation limitation**, not an application failure determination.

## 2026-08-23 — Role/search code-level revalidation

| Scope | Result | Privacy-safe observation |
|---|---|---|
| Four-role context policy | PASS | The focused context regression completed with the configured role-policy and memory/search boundary coverage. |
| Citation/source redaction | PASS | The focused provider safety regression completed, including streaming-safe technical reference filtering. |
| Regression command | PASS | `server/chat-context.test.ts` and `server/providers-v5.5.test.ts` completed 28 tests successfully. |
| Published live matrix | NOT VERIFIED | Flash/Think have earlier limited evidence; Context/Apex fresh neutral live-search checks are not repeated because the browser session no longer provides a safe isolated authenticated state. |

No model reply, prompt, URL, source title/snippet, provider trace, account/session data, attachment metadata, raw error or secret was recorded.

## 2026-08-23 — UI shell and settings evidence consolidation

| Scope | Result | Privacy-safe observation |
|---|---|---|
| Focused UI regression | PASS | The Home integration suite covers settings save/rollback, switches, role dropdown and Escape behaviour, full role descriptions, profile Save control, theme/language/high-contrast controls and responsive shell state. |
| Confirmed UI defects | FIXED | The rejected theme-save rollback and desktop sidebar-collapse defects remain regression-covered. |
| Mobile unauthenticated shell | PASS | At the narrow mobile viewport, dark-default top controls, role selection, new-chat control, export controls and composer were visible without clipping. No history or account data appeared. |
| Memory-profile persistence | NOT VERIFIED | This evidence covers the UI control and its contract only; it does not inspect or claim existing-profile content or persistence. |

### Sidebar delivery confirmation follow-up

An unauthenticated, cache-busted public asset scan inspected only the declared page assets and the presence of the application’s new sidebar-collapse signature. The canonical endpoint still did **not** serve that signature. This confirms the pending state is a **publication-delivery limitation**, not an inferred UI failure or a reason to perform further history interaction. The desktop sidebar production criterion stays **NOT VERIFIED**. No user, session, chat, source, attachment, provider or secret data was accessed or recorded.

## 2026-08-23 — Mobile shell visibility recheck

| Scope | Result | Privacy-safe observation |
|---|---|---|
| 375×812 unauthenticated shell | PASS | Dark-default mobile shell showed the language, theme, role, settings, menu, new-chat, attachment and send controls without visible clipping. |
| Content boundary | PASS | The check used the signed-out shell and showed no user history, conversation, account data, source metadata, attachment selection or secret. |
| Settings persistence and interactions | NOT VERIFIED | Existing integration coverage remains valid, but live settings actions are not repeated while a safe isolated authenticated session is unavailable. |

No screenshot is used as evidence of an authenticated feature flow.

### Focused UI regression follow-up

The focused Home integration suite completed **29/29** tests. It covers the four public roles, full role descriptions, sidebar control state, owned temporary attachment rendering, explicit profile save and bounded memory filter, URL-free RAG rendering, streaming/copy/regenerate/stop behavior, settings rollback, independent switches, accessible dropdowns, and restricted non-owner/owner UI boundaries. This is **code-level PASS**, not a replacement for unavailable authenticated browser acceptance. No user content, account data, source record, attachment metadata or secret was used by the test evidence.

## 2026-08-23 — Final binary sidebar confirmation and browser-isolation stop

The later canonical published page exposed the current sidebar contract. After invoking the standard close control, the binary state was **collapsed**: the navigation region had no desktop width and the visible control offered to show the sidebar. This confirms the published sidebar-collapse fix without retaining a screenshot or any content of the navigation region.

During that interaction, browser session state rehydrated unexpectedly. The sidebar was closed immediately and no record was selected, copied, exported, quoted or used as audit input. All further published browser interactions are stopped in this session. No history title, message content, account/session identifier, attachment detail, source data, provider detail, raw error or secret is retained in this evidence.

## 2026-08-23 — Current local regression and bundle audit

| Check | Result | Privacy-safe observation |
|---|---|---|
| Full `pnpm test` | PASS | 40 test files passed, 1 skipped; 193 tests passed, 4 skipped. This is a new successful run; earlier remote provider authorization failures remain historical observations and were not masked by code or configuration changes. |
| `pnpm check` | PASS | TypeScript completed without diagnostics. |
| `pnpm build` | PASS | Production assets and server bundle completed. The bundler emitted only a size advisory, not a build error. |
| Server-secret-name bundle audit | PASS | A non-printing scan found none of the designated server-secret variable names in `dist/public`. No secret value or matching source was printed. |

These checks are code/bundle evidence only and do not replace the paused authenticated browser acceptance flows.

## 2026-08-23 — Primary-account neutral acceptance stop

The user authorized neutral scenarios in the primary account. The workflow began by selecting a public role, but a top navigation control unexpectedly expanded the sidebar before a new chat could be created. The scenario was stopped immediately. No prior record was selected, opened, copied, exported, quoted, evaluated or used as acceptance input.

No history title, message content, prompt, reply, account/session identifier, attachment detail, source data, provider detail, raw error or secret is retained in this evidence. Memory/profile, picker/PDF, and Context/Apex live-search browser criteria remain **NOT VERIFIED**; no defect is inferred from this isolation failure.

## 2026-08-23 — Authorized neutral Context/Apex and picker recheck

| Scope | Result | Privacy-safe observation |
|---|---|---|
| Context live-search scenario | PASS, limited | A newly created neutral chat completed under Context. The UI exposed only the approved search-status/count/date metadata and no raw link or recognized technical citation pattern. |
| Apex live-search scenario | PASS, limited | The same isolated chat completed under Apex with the approved search-status/count/date metadata and no raw link or recognized technical citation pattern. The UI also honestly showed a limited-service aggregate indicator. |
| Citation and raw-link control | PASS for both new outputs | The visible current-message region contained no raw HTTP(S) URL and no recognized opaque technical citation-list form. |
| Browser attachment picker binding | NOT VERIFIED — automation limitation | The composer contains one enabled native file input, but the browser automation exposes the visible trigger rather than the hidden input; upload targeting therefore fails before app upload logic. This is not classified as an application defect. |
| Memory profile and PDF preview | NOT VERIFIED | These flows were not opened because they could expose existing personal profile/memory data, and no safe reversible empty-state route was available. |

No prompt, reply, history title, account/session identifier, attachment filename/content/size/URL, source URL/title/snippet, provider internals, raw error or secret is retained in this evidence.

## 2026-08-23 — Four-role neutral matrix completion

| Scope | Result | Privacy-safe observation |
|---|---|---|
| Flash and Think | PASS, limited | Both roles completed only in a newly created neutral audit chat. The capability selector remained limited to the four public roles. |
| Context and Apex | PASS, limited | The earlier isolated Context/Apex checks remained consistent with the subsequent matrix. |
| Search and citation rendering | PASS with honest availability limitation | The current assistant regions showed only approved aggregate search-state/count/date metadata; no raw HTTP(S) link or recognized opaque technical citation-list form was visible. The UI honestly signalled partial live-service availability. |
| Attempt-budget contract | PASS in code regression | Current server regressions preserve the configured four-role policy and maximum four upstream attempts; no chain or health semantics changed. |

Browser actions were stopped immediately after the role-selector observation. No query/reply text, history title, account/session identifier, source record, attachment detail, raw provider error or secret is retained in this evidence.

## 2026-08-23 — Temporary memory-marker acceptance safety stop

| Scope | Result | Privacy-safe observation |
|---|---|---|
| New-chat isolation boundary | NOT VERIFIED | The approved temporary-marker flow began with the side navigation already collapsed. After the neutral message was submitted, the visible session rendered an existing conversation rather than a confirmably new isolated conversation. The scenario was stopped at that point. |
| Cross-chat recall | NOT VERIFIED | No second new chat was created and no recall query was sent after the boundary failure. |
| Profile Save and memory search/filter | NOT VERIFIED | The settings and memory dialog were not opened, so existing profile, fact or topic entries were not displayed or used. |
| Controlled deletion and post-delete check | NOT VERIFIED | No search, filter, deletion or clear action was attempted because the temporary entry could not be safely and unambiguously isolated. |

No marker value, prompt, reply, history title, account/session identifier, profile content, memory entry, attachment data, source data, raw error or secret is retained. This is a privacy-isolation limitation, not an application-defect determination.

## 2026-08-23 — v6-P targeted memory cleanup (in progress)

| Scope | Result | Privacy-safe observation |
|---|---|---|
| Exact-match fact deletion | PASS | One explicitly user-authorized test fact was filtered to one visible match, deleted once, and the same filter then returned no match. Fact count decreased by one. |
| Exact-match topic deletions | PASS | Two explicitly user-authorized test topics were each filtered to one visible match, deleted once, and their individual filters then returned no match. Topic count decreased by two. |
| Other requested test items | PENDING | Not yet actioned in this run. No unfiltered deletion or clear action was used. |

### Continuation after published recheck

| Scope | Result | Privacy-safe observation |
|---|---|---|
| Further individual topic deletions | PASS | Two further individually isolated, user-authorized test-topic deletions completed through the visible user-scoped dialog; each removal was confirmed by a subsequent empty result for the same narrow filter. Cumulative confirmed topic deletions in this run: four. |
| First remaining exact fact marker | NOT FOUND | The exact, user-authorized search term returned no match. No deletion was attempted and no broadened query was used. |

No additional entry text, profile content, conversation material, attachment detail, source data, raw error, identifier or secret is retained.

No non-target entry was selected, deleted, copied, or recorded. The exact user-authorized values remain in the user instruction rather than this evidence journal.

| Batch safety check | STOPPED | A scripted multi-term filter could not prove a one-to-one visible delete target for each term. It was not used again. The dialog’s aggregate counters after the attempt were 15 facts and 40 topics; per-entry attribution is therefore not claimed until each remaining term is rechecked individually. |

## 2026-08-23 — v6-P authorized targeted memory cleanup: paused

| Scope | Result | Privacy-safe observation |
|---|---|---|
| Explicitly authorized test-record cleanup | PARTIAL / PAUSED | A user-authorized exact-match UI cleanup began without using the broad “clear all” control and without changing the manual profile. The visible memory count decreased from 30 to 16. |
| Guarded deletion confirmation | NOT VERIFIED | A later deletion did not disappear from the UI within the bounded confirmation wait. Further delete actions were stopped rather than retrying blindly. |
| Remaining target categories | NOT VERIFIED | Because the final deletion confirmation was incomplete, no claim is made that all user-listed test facts/topics are removed. |

No record text, title, prompt, reply, profile value, identifier, attachment data, source data, raw error or secret is retained in this evidence. The next action is a code-level inspection of the delete mutation/revalidation path before any further user-data mutation.

## 2026-08-23 — v6-P memory/freshness remediation and validation

| Scope | Result | Privacy-safe observation |
|---|---|---|
| Auto-memory eligibility | PASS — code/regression | Service/test markers and transient live-search turns are rejected before durable auto-extraction. No user memory content was read for this verification. |
| User-scoped topic cleanup and FIFO | PASS — code/regression | Owned-chat deletion cascades only related dialog topics; bounded fact/topic storage retains FIFO behavior. Manual profile and unrelated users remain outside the operation. |
| Capacity UX | PASS — code/regression | The memory dialog now warns near the configured capacity and blocks only manual additions at the hard limit; the UI does not reveal additional entry data. |
| Attachment preview/retry | PASS — code/regression | Local image preview, safe object-URL disposal and a bounded Russian retry state are covered without changing temporary server-side ownership/lifecycle. Fresh native-picker browser acceptance remains NOT VERIFIED. |
| Switch end position | PASS — code/regression | The checked thumb uses corrected transform-only positioning, covered by UI regression. Authenticated live settings acceptance remains NOT VERIFIED. |
| Freshness fallback | PASS — code/regression | Freshness-dependent requests now receive a truthful limitation when permitted live search is disabled, empty, degraded or unavailable rather than an unverified current answer. No sources or response text are retained. |
| Full regression | EXTERNAL AVAILABILITY BLOCKER | 39 test files passed, one failed, one skipped; 196 tests passed, one failed, four skipped. The sole failure was a server-side external SambaNova health-probe connection timeout. Provider routing, fallback and health semantics were not changed or masked. |
| TypeScript and production build | PASS | `pnpm check` and `pnpm build` completed after the final freshness change; the build produced only a chunk-size advisory. |

This entry does not promote pending authenticated browser flows or the partial authorized memory cleanup to PASS. It contains no record values, conversation data, account/session material, source data, attachment data, raw external error detail or secret.

## 2026-08-24 — Browser rehydration safety stop

| Scope | Result | Privacy-safe observation |
|---|---|---|
| Canonical-session recheck | STOPPED | A canonical navigation unexpectedly rehydrated an existing conversation after the page initially presented a guest shell. The browser was closed immediately. |
| Further memory operations | NOT PERFORMED | No further search, filter, deletion, export, copy, chat selection or settings action was run after the rehydration. |
| Browser evidence | NOT VERIFIED | This session cannot be used for remaining authenticated acceptance until a stable, same-window OAuth session is established. |

No conversation content, title, memory value, account/session identifier, source data, attachment data, raw error or secret is retained in this evidence. This is an automation/session-isolation limitation, not a new application-defect finding.

## 2026-08-24 — Guest-mode official OAuth control

| Scope | Result | Privacy-safe observation |
|---|---|---|
| Persistent guest entry point | PASS — code/regression | A labelled topbar control remains available whenever the session is unauthenticated, including the empty guest shell; the existing sidebar fallback remains available. |
| Official login launch | PASS — code/regression | Clicking the control invokes the existing event-driven `startLogin()` path exactly once. That path creates a fresh one-time state cookie and returns to the same canonical origin; no reusable OAuth URL or state value is exposed. |
| Phone layout | PASS — local visual/regression | The control is styled as a visible 44px touch target and preserved through mobile responsive rules. No user data or history was shown in the local shell check. |

The published recheck requires the current frontend delivery. No OAuth credentials, cookies, account/session identifiers, conversation data or direct login URL are retained in this evidence.

## 2026-08-24 — Guest-mode official OAuth control delivery

| Scope | Result | Privacy-safe observation |
|---|---|---|
| Guest entry control | PASS — code/regression | The canonical UI has a permanent labelled guest-mode entry point in the topbar and retains the existing sidebar fallback. |
| OAuth safety | PASS — code/regression | The visible control invokes only the existing event-driven login start; it does not expose a reusable OAuth URL, state, cookie or credential. |
| Remaining published acceptance | NOT VERIFIED | A same-window authenticated session is still required before any user-scoped memory or settings acceptance resumes. |

No session material, account identifier, conversation data, memory entry, source, attachment detail, raw error or secret is retained.

## 2026-08-24 — Canonical guest-control recheck safety stop

| Scope | Result | Privacy-safe observation |
|---|---|---|
| Canonical guest-control visibility | NOT VERIFIED | The canonical page initially rendered a guest shell whose available action map did not expose the labelled entry control. A binary DOM check was started without launching OAuth. Before a deterministic visual result could be established, the session unexpectedly rehydrated. |
| Authenticated state handling | PASS — safety | The recheck stopped immediately after the unexpected rehydration. No history, conversation, profile, memory entry, attachment, source or account/session value was opened, copied or retained. |

The code-level guest-control regression remains PASS. Published visibility remains open until it can be checked in a stable guest session without triggering or inspecting authenticated content.

## 2026-08-24 — Canonical guest-route pre-auth diagnosis

| Scope | Result | Privacy-safe observation |
|---|---|---|
| Local guest topbar | PASS — code/regression | The Home route renders the labelled control whenever `useAuth()` is unauthenticated; the focused guest/mobile regression covers its visibility and one event-driven official login invocation. No OAuth state, cookie or user data was inspected. |
| Canonical anonymous route | BLOCKED BY PLATFORM | An unauthenticated HTTP route check received a platform-level sign-in redirect before the React application bundle was served. The public response therefore belongs to the platform sign-in surface rather than Kairema’s guest shell. |
| Render/CSS source defect | NOT FOUND | The control has no source-level auth branch beyond the unauthenticated state and no mobile CSS concealment rule was found. This does not convert the canonical visible-control requirement into PASS because the application does not load for an anonymous request. |

No browser OAuth action was launched. No conversation, history, profile, memory record, attachment, source, account/session identifier, raw response payload, cookie or secret was opened, copied or retained. The next step is an explicit user decision about changing the platform visibility/access policy; no static OAuth URL is safe or introduced.

## 2026-08-24 — Canonical guest-control browser FAIL (supersedes route inference)

| Scope | Result | Privacy-safe observation |
|---|---|---|
| Canonical guest shell | FAIL | The canonical browser rendered Kairema’s empty guest shell, including a visible empty-state sign-in message and disabled-by-state chat surface, but no labelled topbar entry control. |
| Guest-control DOM | FAIL | A binary DOM check found no `.kairema-guest-login` element and no guest-control label in the document body. It did not inspect history, profile, memory, account/session values, cookies or network payloads. |
| Prior HTTP route inference | SUPERSEDED | A non-browser anonymous HTTP redirect does not explain the browser-rendered Kairema guest shell. The current acceptance fact is a published guest-DOM mismatch with the locally verified source/regression. |

The browser displayed no conversation content and no sidebar item was opened. No OAuth action was launched. The required next step is to compare canonical asset delivery with the current local build and fix only a confirmed delivery or render-version cause.

## 2026-08-24 — Independent phone-only welcome route (local verification)

| Scope | Result | Privacy-safe observation |
|---|---|---|
| `/welcome` route | PASS — local | The route contains no history, memory, attachment, settings, provider or user-data query. It renders one Russian-labelled mobile-first entry button. |
| OAuth entry | PASS — local | The button invokes only the existing event-driven `startLogin()` handler. No reusable OAuth URL, state, cookie or token is created, shown or retained. |
| Regression and visual checks | PASS — local | Welcome/Home focused regressions completed 32 tests; TypeScript and production build passed. Desktop and 375px mobile visual checks showed the same visible high-contrast button. |

Canonical acceptance remains pending publication. No browser login was launched, and no account, conversation, history, profile, memory entry, attachment, source, cookie, token or secret was accessed.

## 2026-08-24 — Gateway-safe phone link remediation (local verification)

| Scope | Result | Privacy-safe observation |
|---|---|---|
| Direct `/welcome` on canonical | FAIL — platform route | The platform returned a public 404 before the SPA server fallback could handle the path. This path is not presented as the phone-only link. |
| Canonical-root query entry | PASS — local | The equivalent data-free screen is selected at `/?welcome=1`, keeping the request on the canonical root where the application shell is served. |
| Regression and visual check | PASS — local | App routing and Welcome focused regressions passed (2 tests); TypeScript and production build passed. A 375px local root-query screenshot showed the single visible touch-friendly button. |

The root-query route still invokes only the existing event-driven login handler. No OAuth transaction was launched, and no personal data, session detail, cookie, token or secret was inspected or retained.

## 2026-08-24 — Canonical root-query welcome check

| Scope | Result | Privacy-safe observation |
|---|---|---|
| Canonical root query arrival | PASS | The canonical root accepted `?welcome=1` and rendered the Kairema guest shell rather than the platform 404. |
| Published welcome branch | FAIL | The visible guest shell was Home’s empty-state rather than the data-free welcome screen. A binary runtime check confirmed the query parameter was present while welcome-only copy was absent. |
| Published asset | FAIL — stale/runtime mismatch | The public main asset currently served to the guest shell does not contain the new welcome signature. Local tests and build therefore do not establish canonical delivery. |

No button was pressed and no OAuth flow was launched. The guest surface did not expose conversation text, memory, profile, attachment, cookies, account/session values, raw network payloads, secrets or other private data. Further work is limited to publishing/delivery diagnosis.

## 2026-08-24 — Canonical root-query propagation recheck safe-stop

After a short propagation wait, the canonical root-query retry still did not show the data-free welcome screen or its entry control. The shell mode then differed from the immediately preceding guest state. The verification was stopped at once; no user interface control was pressed and no conversation, history, profile, memory, attachment, account/session material, cookie, network payload, source or secret was opened, copied or retained.

This confirms **published runtime/delivery mismatch remains FAIL**. It is not evidence that the user’s login, OAuth protocol or local implementation failed.

## 2026-08-24 — User-confirmed platform blocker disposition

The user explicitly directed that the canonical stale-runtime/delivery mismatch be recorded as **BLOCKED BY PLATFORM** and that work continue only on safe non-owner v6-P tasks. Browser verification is deferred until the platform serves the current runtime. No history, memory, conversation, attachment, profile, account/session material, cookie, OAuth state, source or secret was opened or retained.

## 2026-08-24 — Canonical asset delivery comparison

| Comparison | Result | Privacy-safe conclusion |
|---|---|---|
| Current local production asset | Contains guest-control label and guest-control CSS-class signature | The local build corresponds to the guest-login implementation covered by focused regression. |
| Asset loaded by canonical guest browser | Contains neither signature | The published browser is loading a distinct, older frontend asset from the local production build. |

This is a **canonical delivery/version mismatch**, not a browser-authentication result and not a reason to alter OAuth, cookies, user data, provider configuration or access policy. Only public static asset signatures were compared; no user-related page data, request payload or session material was read.

## 2026-08-24 — Guest empty-state entry remediation (local)

| Scope | Result | Verification |
|---|---|---|
| Visible mobile fallback | PASS — local code | The empty guest screen now has a second labelled, 44px-minimum entry control in addition to the topbar action. It is not displayed for an authenticated chat state. |
| OAuth safety | PASS — code/regression | Both entry controls only invoke the existing event-driven `startLogin()` call. No reusable callback, state value, cookie manipulation or direct OAuth URL was added. |
| Focused client regression | PASS | Home integration: 31 tests passed, including both independent entry points and a single login invocation. AIChatBox: 12 tests passed. |
| Type/build | PASS | TypeScript check passed. Production build passed with the existing chunk-size warning only. |

Canonical publication remains **NOT VERIFIED** until the new release is served and the guest DOM can be inspected without invoking OAuth.

## 2026-08-24 — Canonical guest-control recheck after release `131c54b8`

| Scope | Result | Privacy-safe observation |
|---|---|---|
| Guest-shell load | PASS | Canonical Kairema loaded an unauthenticated empty chat shell without any OAuth action, sidebar interaction, history access, memory access or attachment interaction. |
| Topbar and empty-state guest controls | FAIL | The labelled guest entry was absent from the visible canonical page. A binary DOM check found zero control elements for both the topbar and the new empty-state fallback and no control label. |
| Current release delivery | NOT VERIFIED | The release-specific cache-busting navigation did not yet produce the current frontend signature in the canonical guest DOM. This keeps the delivery/version mismatch open; it does not justify changing OAuth, cookies, access policy or user data. |

No conversation content, profile, memory record, attachment, source, account/session identifier, cookie, raw network payload, secret or OAuth state was opened, copied or retained.

## 2026-08-24 — Canonical asset/runtime distinction

| Scope | Result | Privacy-safe observation |
|---|---|---|
| Current canonical main asset | PASS — static signature | A no-store fetch inside the guest shell returned JavaScript and contained the guest-login label. The direct unauthenticated HTTP request is not a reliable static-asset probe because platform pre-auth intercepts it. |
| Current rendered guest DOM | FAIL | The same page’s rendered DOM still contained zero guest entry controls and no label. |
| Diagnosis direction | OPEN | The mismatch is now narrowed to runtime auth/render-state or a distinct stale sub-bundle, rather than a simple absence of the label from the served main asset. |

The checks used only public asset metadata and boolean signatures. No history, profile, memory, attachments, user/session values, cookies, sources, raw payloads, secrets or OAuth state was read.

## 2026-08-24 — Guest recheck safe stop after session rehydration

After a cache-refresh attempt, the browser rendered an authenticated application state. The guest-mode acceptance flow was stopped immediately. No sidebar item, conversation, message, profile, memory record, attachment, export, source, account/session value, cookie, raw response or OAuth material was selected, copied, recorded or used. This is a browser-isolation limitation, not a new product verdict. Canonical guest-control acceptance remains **NOT VERIFIED** until a stable guest-only browser context is available.

## 2026-08-24 — Local attachment recovery remediation

| Scope | Result | Privacy-safe observation |
|---|---|---|
| Failed upload preview | PASS — local | A transient upload failure now preserves the local preview instead of silently losing the selected file. |
| Recovery controls | PASS — local | The composer presents a Russian failure status and retry action that resubmits the same local file; the user can also remove it explicitly. Sending remains blocked until the failed item is retried or removed. |
| Lifecycle and accessibility | PASS — local | Existing temporary object-URL cleanup remains covered. Preview-dialog accessibility warning is removed without changing the request-only server lifecycle. |
| Validation | PASS — local | `AIChatBox` focused regression: 13 tests passed; TypeScript and production build passed. |

No real file picker, attachment, conversation, profile, memory entry, history, network payload, cookie, account/session material, source, secret or OAuth flow was accessed. Native browser picker, sent-bubble/PDF and vision acceptance remain **NOT VERIFIED**.

## 2026-08-24 — Full local v6-P regression refresh

| Scope | Result | Privacy-safe observation |
|---|---|---|
| Full test suite | PASS | `pnpm test` completed with 43 test files passed and 1 intentionally skipped file; 203 tests passed and 4 intentionally skipped tests. |
| Prior external probe result | Resolved in this run | The earlier external health-probe timeout did not recur. No provider chain, health policy, retry limit or provider semantics was weakened or changed. |
| Browser acceptance | Unchanged | This run does not substitute for intentionally open native picker, sent-bubble/PDF, vision, settings, freshness, memory-cleanup or second-user browser criteria. |

The run processed no browser session, user history, message, memory entry, profile, attachment, source, cookie, account identifier or secret.

## 2026-08-24 — Canonical current welcome runtime: desktop PASS

| Scope | Result | Privacy-safe observation |
|---|---|---|
| Canonical root-query welcome | PASS — desktop | The canonical root query rendered the data-free welcome screen rather than Home or a platform 404. |
| Visible entry action | PASS — desktop | Exactly one visible labelled `Войти для истории` action was present. The screen states that history, memory and attachments remain unavailable before the same-window secure entry. |
| OAuth and data boundary | Preserved | No action was pressed. No authenticated UI, history, conversation, memory, settings, attachment, cookie, token, account/session detail, source or secret was accessed. |

The earlier stale runtime blocker is resolved for the desktop welcome route. A local 375px visual check had already passed; **real canonical mobile viewport acceptance remains NOT VERIFIED** because the privacy-safe browser context cannot switch viewport dimensions. No mobile assertion is inferred from the desktop check.

## 2026-08-24 — Canonical current main guest shell: desktop PASS

| Scope | Result | Privacy-safe observation |
|---|---|---|
| Main guest topbar | PASS — desktop | The current canonical guest shell displayed a labelled `Войти для истории` action in the topbar. |
| Main guest empty state | PASS — desktop | A second labelled `Войти для истории` action was visible in the empty state, providing an independent entry point. |
| Data/OAuth boundary | Preserved | No action was pressed. The page remained a pre-auth empty state; no history item, conversation, memory, profile, setting, attachment, cookie, account/session value, source, network payload or secret was opened or retained. |

The original published guest-control visibility defect is resolved on canonical desktop. Real canonical mobile viewport acceptance remains **NOT VERIFIED**.

## 2026-08-24 — Canonical welcome: mobile visibility PASS (user confirmation)

The user confirmed that the labelled entry button is visible on the canonical mobile welcome page. No OAuth action was requested or launched, and no history, memory, conversation, profile, setting, attachment, account/session value, cookie, source, raw payload or secret was accessed. This completes the canonical visibility acceptance for the safe root-query phone entry.

## 2026-08-24 — Switch CSS regression hardening

| Scope | Result | Privacy-safe observation |
|---|---|---|
| Focused switch regression | PASS | Two focused tests cover the existing root/thumb data-state contract and the stylesheet’s zero-position thumb transform, checked-state `1.25rem` travel and reduced-motion fallback. |
| TypeScript and production build | PASS | `pnpm check` and the production build completed successfully after the test-only change. |
| Authenticated settings visual acceptance | NOT VERIFIED | No authenticated settings page was opened; no user-scoped preference or other private data was read or changed. |

No browser user content or runtime setting was accessed.

## 2026-08-24 — Authorized settings-only check: safe stop

| Scope | Result | Privacy-safe observation |
|---|---|---|
| Entry boundary | SAFE STOP | The user explicitly authorized a settings-only check. Settings was opened from an empty shell, but an existing conversation rendered in the background unexpectedly. |
| Settings interaction | NOT VERIFIED | No switch, Save control, dropdown or self-diagnostic control was operated; no preference was read or changed. |
| Data boundary | Preserved after detection | The check stopped immediately. No history item, conversation, memory, profile, attachment, export, source, account/session value, cookie, raw payload, OAuth material or secret was selected, copied, retained or used. |

This is an isolation limitation, not a product failure or an authenticated-settings acceptance PASS. Future browser work requires a reliably data-free settings context.

## 2026-08-24 — Local data-free switch visual acceptance

| Scope | Result | Privacy-safe observation |
|---|---|---|
| Isolated test surface | PASS — local | A standalone development-only fixture initializes no OAuth, history, memory, profile, attachment or account-setting queries. It is excluded from the production route and bundle. |
| Mobile visual states | PASS — local | At a 375px viewport, the screen displayed independent unchecked and checked switch positions with touch-friendly control rows and no content-bearing application surface. |
| State and motion regression | PASS — local | Focused standalone switch and existing stylesheet geometry/reduced-motion coverage passed: 4 tests total. TypeScript and production build passed; a production asset scan confirmed the fixture text is absent from the bundle. |

This local-only acceptance does not access or change a user preference and does not convert authenticated switch persistence or profile-save browser criteria into PASS.

## 2026-08-24 — Authorized native attachment check: safe stop

| Scope | Result | Privacy-safe observation |
|---|---|---|
| Guest preflight | PASS — limited | An empty application shell exposed the expected native attachment control. |
| Native upload automation | NOT VERIFIED | The browser automation could not locate the hidden native file input for the permitted temporary fixture. No file was accepted or sent. |
| Data boundary | SAFE STOP | After the failed native-upload attempt, the page unexpectedly restored an existing conversation. The check stopped immediately, without selecting, reading, copying, recording or using any existing conversation, memory, profile, attachment, export, source, account/session material, cookie, raw payload, OAuth material or secret. |
| Test material cleanup | PASS | The single locally created neutral temporary fixture was removed. No server-side test material was created. |

Composer preview, removal, sent-bubble, document card and vision remain **NOT VERIFIED** in the browser. This is an automation/isolation limitation, not an application acceptance PASS or a finding about existing user content.

## 2026-08-24 — Native attachment input accessibility

| Scope | Result | Privacy-safe observation |
|---|---|---|
| Accessible input contract | PASS — local | The hidden native file input now has its own localized accessible name, distinct from the visible attachment trigger. The accepted file-type contract is unchanged. |
| Regression | PASS — local | Focused AIChatBox component regression passed 14 tests, including the explicit input semantic check; TypeScript and production build passed. |
| Browser acceptance | NOT VERIFIED | No further browser interaction was attempted. This change does not prove native picker, upload, sent-bubble, document-card or vision behavior. |

No upload lifecycle, storage policy, server attachment policy, user data, attachment content or URL was changed or accessed.

## 2026-08-24 — Full regression refresh after attachment accessibility

| Scope | Result | Privacy-safe observation |
|---|---|---|
| Full suite | PASS | `pnpm test` completed with 43 test files passed and 1 intentionally skipped file; 204 tests passed and 4 intentionally skipped tests. |

This run performed no browser interaction and did not access or change user data, attachments, OAuth/session material, provider policy, schema, schedules or owner configuration.

## 2026-08-24 — Authorized settings switch check (in progress)

| Scope | Observation |
|---|---|
| Reversible control | The high-contrast switch was initially unchecked, changed to checked through its settings control, and showed the matching semantic state after the interaction. |
| Persistence and rollback | PASS | The settings dialog was closed and reopened; the switch retained the checked semantic state. The same control then returned to the original unchecked semantic state. |

No messages, memories, attachment contents, secrets, raw network payloads or identifying values are included in this note.

## 2026-08-24 — Authorized default-role dropdown check

| Scope | Result | Privacy-safe observation |
|---|---|---|
| Closed control | PASS | The control displayed its selected public role. |
| Open list | PASS | The list exposed exactly the four public roles with full visible descriptions. |
| Reversible exit | PASS | Escape closed the list without changing the selected role. |

No conversation content, user setting values beyond the selected public role, memory, attachment data, identifiers, raw payloads or secrets are retained in this note.

## 2026-08-24 — Authorized acceptance session boundary

| Scope | Result | Privacy-safe observation |
|---|---|---|
| Current session | Authorized | The user granted ongoing authorization for user-facing acceptance checks in the current account. Existing data may be used only as necessary; no real content is deleted without need. |
| Settings check | PASS | Reversible switch persistence and default-role dropdown behavior completed without changing the selected role or leaving the switch altered. |
| Attachment check status | Pending | No temporary message, server-side attachment or deletion has yet been created in the resumed session. |

Evidence continues to omit conversation text, memory values, profile data, attachment content, identifiers, raw errors, URLs, cookies and secrets.

### Native-input preparation

The existing native input was found with the expected accepted public file-type contract and its localized accessible name. For this one authorized browser check only, its rendered style was temporarily adjusted in the active page so the browser upload control can target it. No upload, message, server-side object or user-data change occurred during preparation; page reload will remove the temporary DOM-only presentation adjustment.

### Authorized composer attachment check

The neutral temporary text fixture was selected successfully through the native input. The composer displayed a named preview control and a distinct remove control before any message was sent. This verifies local selection/preview only; no server-side object, sent message, preview bubble, document card or vision result has been created. The fixture text and existing conversation content are not recorded here.

The distinct remove control cleared the temporary composer preview. The native input returned to its empty state, and no message or server-side object was created from this first selection.

## 2026-08-24 — Authorized temporary attachment and export acceptance

| Scope | Result | Privacy-safe observation |
|---|---|---|
| Temporary chat boundary | PASS | One separate neutral test chat was created. Existing conversations were not modified. |
| Native text attachment | PASS | A permitted neutral text fixture uploaded, completed its composer preview, and appeared as a sent document chip after a single bounded test turn. |
| Sent attachment presentation | PASS | The test turn displayed the document chip with a formatted size; neither content nor attachment URL is recorded here. |
| Markdown export | PASS | The temporary chat created one local Markdown download. |
| PDF export | PASS | The same temporary chat created one local PDF download. |
| Cleanup status | Pending | Only the created test chat, locally created fixture and the two associated local downloads are eligible for removal; no existing account data is eligible. |

This entry intentionally excludes the temporary chat text, reply text, document name, document bytes, source details, history labels, profile/memory values, account identifiers, session/cookie material, raw errors, URLs and secrets.

## 2026-08-24 — Temporary attachment cleanup blocker

| Scope | Result | Privacy-safe observation |
|---|---|---|
| Composer and sent attachment | PASS — browser | In the separately created neutral test chat, native selection, composer preview/removal, sent document presentation and bounded temporary turn completed. No content, name, bytes, URL or identifier is retained. |
| Immediate exports | PASS — browser | Markdown and PDF exports of that temporary chat each produced a local download. Their contents were not opened or retained. |
| Test-chat cleanup | BLOCKED BY PLATFORM/BROWSER | Two attempts to delete only the created test chat timed out and left the browser in an empty tab. A subsequent confirmed OAuth attempt returned to the guest shell, so the test-chat deletion result cannot be safely confirmed. No other history entry was selected, changed or deleted. |
| Eligible cleanup scope | Preserved | Only the created test chat, its neutral local fixture and its two local downloads remain eligible for cleanup. |

PDF document-card and vision acceptance remain **NOT VERIFIED**. This record deliberately excludes chat text, file content, history labels, profile/memory values, account/session values, cookies, raw errors, URLs, OAuth material and secrets.

## 2026-08-24 — Delete confirmation hardening and cleanup diagnosis

| Scope | Result | Privacy-safe observation |
|---|---|---|
| Server deletion boundary | PASS — source review | The protected delete procedure remains user-scoped and delegates only to the owned-session deletion helper. No server-side auth, cookie, OAuth or navigation behavior was changed. |
| Confirmation UI | PASS — local | The browser-native confirmation was replaced with the existing controlled accessible application dialog. The generic dialog does not display a chat title or other user content. |
| Explicit-action regression | PASS — local | Focused Home integration regression passed 31 tests: opening the delete control does not call the mutation, cancel does not call it, and only explicit in-app confirmation invokes the existing delete contract with the selected fixture session. TypeScript and production build passed. |
| Browser cleanup status | BLOCKED BY PLATFORM/BROWSER | This client-only hardening is not proof that the created temporary chat was deleted. A stable authorized browser context is still required before attempting removal of only that test material again. |

No conversation text, history labels, identifiers, attachment details, session/cookie values, raw errors, URLs, OAuth material or secrets are recorded in this entry.
