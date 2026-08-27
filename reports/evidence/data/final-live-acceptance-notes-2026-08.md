# Final live acceptance notes — 2026-08

## Session and initial UI

- **PASS (live):** the already-authenticated browser session reached the published Kairema application rather than the sign-in view.
- **PASS (live):** the initial new-chat interface presents one selected public role, `Kairema Flash`, and indicates the four-role contract in its UI copy.
- **PASS (live):** the composer exposes separate photo and generic-file attachment controls; no file was selected or uploaded in this observation.
- **PASS (live):** user-facing Markdown and PDF export controls are visible.
- **OBSERVED (live):** the UI displays a limited/unavailable-services indicator of `3/4`; this is a truthful status surface, not evidence of a particular provider failure cause.

## Role-selector acceptance

**PASS (live):** opening the selector exposed exactly four public choices—Kairema Flash, Kairema Think, Kairema Context and Kairema Apex—with their distinct user-facing purposes. The check did not send a prompt or invoke any generation provider. A stale-element automation response occurred after the first selector transition, so the assertion relies on the fresh observed selector DOM rather than claiming a selection mutation from that stale action.

## Settings and identity-control boundary

**PASS (live):** the authenticated account opens a settings modal exposing account-scoped response preferences, privacy-preserving self-diagnostics, Web Search opt-in, and an explicitly optional email-linking path. The visible disclosure says that email-address equality does not auto-merge accounts and that Kairema does not store passwords, delivery messages, reset links or tokens. No switch, selector, email field or confirmation action was changed. The settings modal did not expose a logout control in the observable content; live logout/re-login therefore remains **UNVERIFIED** in this browser session rather than inferred from code evidence.

## Privacy and test boundary

No user identifier, email address, prompt, response, attachment, memory item, export, private chat data, token, secret or provider request was captured in these notes. Subsequent browser checks remain limited to controlled test interactions and observable UI state.
