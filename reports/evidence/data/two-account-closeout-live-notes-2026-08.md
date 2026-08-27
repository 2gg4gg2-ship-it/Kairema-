# Controlled two-account closeout — live notes

**Scope.** Published `https://kairema-ai-gxujplkn.manus.space/`; browser session confirmed authenticated by the user. This log contains no account identifiers, prompts, response text, private chat content, attachments, export payloads, or secrets.

| UTC observation date | Controlled identity | Scenario | Status | Sanitized evidence |
|---|---|---|---|---|
| 2026-08-27 | First only | Published runtime load | PASS | Application rendered as authenticated chat UI with role selector, chat history navigation, Markdown/PDF controls, attachment controls and an explicit limited-services indicator. |
| 2026-08-27 | First only | Minimal single-message streaming flow | PASS | One non-personal controlled message was submitted once; streaming state appeared and then cleared; transcript UI contained user/assistant entries and the composer reset. UI identified the completed model as `GPT-OSS 20B`; no answer content is retained here. |
| 2026-08-27 | First only | Immediate history visibility | PASS | After the controlled message completed, its controlled chat title appeared as the current item in the authenticated sidebar history. No other title, message, metadata or identifier is retained in this log. |
| 2026-08-27 | First only | Markdown export initiation | PASS | The Markdown control for the single controlled chat returned to its normal state and the published UI displayed a successful export-history confirmation. No filename, downloaded bytes or transcript content is retained in this log. |
| 2026-08-27 | First only | Four public role labels | PASS | Existing published selector evidence retained: Flash, Think, Context and Apex are the only exposed public roles. |
| 2026-08-27 | Second identity | Cross-user isolation, foreign-resource denial, parallel mutation | BLOCKED | No second controlled identity or credentials were supplied; no real-user data or guessed identifiers were used. |
| 2026-08-27 | First only | Logout/re-login | UNVERIFIED | Not executed because it would require a further user takeover to restore the controlled session after logout. |
| 2026-08-27 | First only | Attachment upload/delete, export, pagination, draft persistence | UNVERIFIED | Not repeated in this closeout; prior evidence exists, but this controlled run did not mutate or read user data beyond its one neutral message. |

**Attachment-picker boundary.** The published composer exposed separate controls for choosing a photo or a file. After invoking the native picker, the automation session did not expose a selectable file-input element. The prepared non-personal fixture was therefore not uploaded, no existing attachment was opened, and upload/preview/removal remain **UNVERIFIED** rather than inferred.

**Visible truthful state.** The authenticated published UI retained the explicit `2/4` limited-services indicator and labelled the completed controlled Flash exchange with its displayed model. No status was treated as an account quota measurement, and no unrelated history title, response body, identifier or private metadata is retained.

**Settings/logout boundary.** The current published settings modal displayed account-scoped preference controls, an email-binding disclosure and a health-refresh selector. No explicit logout control was visible in the available modal content. No preference, email binding or provider setting was changed; logout/re-login remains **UNVERIFIED**.
