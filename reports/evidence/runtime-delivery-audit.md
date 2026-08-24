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

## v6-R recheck after published checkpoint `08945dc2`

After the v6-R checkpoint was auto-published, the canonical endpoint was rechecked through a fresh public browser navigation and a no-cache HTTP request. It still rendered **“Site under maintenance”** and still returned **503** with the same platform-origin **404** indicator and no-cache headers. Therefore no Kairema frontend hash exists on `lkn.manus.space` to compare.

The available project domain was also loaded without authentication. It continued to reference JavaScript `index-MouuzhQK.js` and stylesheet `index-BuJ1VYLR.css`. A reload fetch of that public JavaScript did **not** contain v6-R markers `freshnessBlocked`, `Живой поиск недоступен`, `Удалить вложение`, or the compact attachment CSS class. This is evidence that the public project runtime had not propagated the checkpoint at the time of recheck; it is not a browser-cache finding.

| Delivery target | v6-R public result | Status |
|---|---|---|
| `lkn.manus.space` | Maintenance page, HTTP 503 / platform-origin 404, no Kairema asset fingerprint available | **BLOCKED BY PLATFORM DELIVERY** |
| `kairema-ai-gxujplkn.manus.space` | Guest shell available, but it still serves the previous public asset fingerprint after checkpoint `08945dc2` | **BLOCKED BY PLATFORM DELIVERY** for v6-R propagation |
