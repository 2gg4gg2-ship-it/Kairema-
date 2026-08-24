# Runtime delivery audit

**Date:** 2026-08-24 UTC  
**Scope:** public, unauthenticated delivery only. No user sessions, history, memory, profile, attachments, OAuth parameters, or browser cookies were inspected or recorded.

| Endpoint | Observed public result | Delivery implication |
|---|---|---|
| `https://lkn.manus.space/` | Public page renders only **“Site under maintenance”**. No Kairema application shell or frontend asset version is available to inspect. | **BLOCKED BY PLATFORM DELIVERY** for canonical runtime comparison: this canonical domain currently does not deliver Kairema. |
| `https://kairema-ai-gxujplkn.manus.space/?welcome=1` | Kairema public guest shell renders with its standard sign-in entry. | Current project domain delivers an application runtime and is the only available public runtime for code/UI asset inspection. |

## Public asset fingerprint of the current project domain

The guest shell loaded the following public first-party asset filenames:

| Asset type | Filename |
|---|---|
| JavaScript | `index-MouuzhQK.js` |
| CSS | `index-BuJ1VYLR.css` |

The fetched JavaScript asset contains the shipped localized labels for **«Очистить всю историю»**, **«Очистить всю память»** and **«Да, удалить всё»**, plus the attachment-preview component marker. These are bundle-presence checks only; they do not replace an authenticated browser interaction test.

> This establishes a delivery mismatch, not evidence that the current project domain is stale. The canonical domain must exit maintenance or be mapped to the published project before it can be compared by version or hashed assets.

## HTTP delivery confirmation

The canonical public HTTP response returned **503**, `x-manus-original-status: 404`, `cache-control: no-cache, no-store, must-revalidate`, and a retry interval. This rules out a stale browser cache as the cause: the platform edge is not serving a Kairema deployment for this hostname. A project cache-bust or republish cannot alter that unbound/maintenance hostname from application code.
