# Support platform checks — sanitized evidence

## 1. Canonical runtime

At 2026-08-28 06:16:56 UTC, `https://lkn.manus.space` returned a page titled `Site under maintenance` with the visible maintenance message. No Kairema application surface, version marker, asset hash, login screen, or private/user-scoped content was observed. Therefore the current lkn runtime comparison is UNVERIFIED; the safe observed result is a platform maintenance page, not an observable old/new Kairema frontend.

## Canonical Kairema runtime and safe auth metadata

At 2026-08-28 06:17:18 UTC, `https://kairema-ai-gxujplkn.manus.space/` rendered the Kairema application surface with the four-role UI and no guest login screen. The published document exposed main asset filename `index-CAdg-tZI.js` (safe filename metadata only). A same-origin `auth.me` request returned HTTP 200 and a boolean authenticated result; no identity, claims or user payload was retained. The public `__manus__/version.json` fetch returned a non-JSON response and was recorded only as `SyntaxError`; no version claim is inferred.

This establishes an available authenticated controlled session for safe checks, but does not by itself prove OAuth callback execution or refresh persistence.

## Provider/search health

At 2026-08-28 06:18:28 UTC, the existing owner-gated `webSearch.probe` was invoked once from the authenticated canonical session. It returned HTTP 403 with an error response and no provider HTTP sub-statuses. Because the server rejected the existing health procedure at its owner guard, no provider-by-provider result is inferred and no additional probe or fallback request was sent. This is recorded as an authorization/access error class, not as a provider outage diagnosis.

## OAuth/session persistence observation

At 2026-08-28 06:18:40 UTC, navigating back to the canonical root rendered the Kairema application surface again. This is a return/refresh observation of the existing session; it is not proof that a new OAuth login and callback were executed in this run.

## Safe HTTP metadata

At 2026-08-28 06:19 UTC, a no-cookie metadata-only request to `https://lkn.manus.space/` returned HTTP 503 with HTML content type, consistent with the observed maintenance page. A no-cookie request to the canonical published domain returned HTTP 200 HTML after redirecting to the Manus auth portal; this does not override the browser session observation.

After the canonical root refresh, same-origin `auth.me` returned HTTP 200 with `authenticated=true` and only the response key `result` retained. This proves persistence of the already-existing browser session across root navigation/refresh, but not a newly executed OAuth callback in this run.

# Support-ready four-check summary

| # | REPRODUCED | EXACT ACTION | SAFE OBSERVED RESULT | HTTP STATUS/ERROR CLASS | CHECK TIME |
|---|---|---|---|---|---|
| 1. `lkn.manus.space` runtime | YES — platform maintenance condition | Opened `https://lkn.manus.space/` and performed metadata-only HTTP check. | Maintenance page, no Kairema runtime, no old/new frontend marker. A current-vs-old runtime comparison is therefore UNVERIFIED; the platform delivery/availability condition is reproduced. | Browser page: maintenance; metadata-only HTTP **503**, HTML. | 2026-08-28 06:16:56 UTC / HTTP check 06:19 UTC |
| 2. `OWNER_OPEN_ID` availability | NO for a missing-config defect; published binding remains UNVERIFIED | Performed a boolean-only server environment check; did not print the value. Also observed the existing owner-gated health procedure from the authenticated browser session. | `OWNER_OPEN_ID_PRESENT=YES` in the current project server environment. The published owner-gated procedure returned forbidden, so no claim is made about the value, owner identity, or deployed claim mapping. | Environment check: **N/A**. Existing owner-gated probe: **HTTP 403 / authorization error class**. | 2026-08-28 06:17:58 UTC / probe 06:18:28 UTC |
| 3. OAuth callback/session persistence | UNVERIFIED for a newly executed login→callback; NO fresh login was initiated | Returned to the canonical Kairema root in the existing browser session and checked same-origin `auth.me` using only boolean result, then refreshed/root-navigated once. | Kairema UI loaded and the existing session remained authenticated (`auth.me` HTTP 200, boolean true). A new OAuth login, callback execution and callback-to-root redirect were not observed in this run, so they are not claimed. | `auth.me`: **HTTP 200**. Fresh callback: **UNVERIFIED**, no error inferred. | 2026-08-28 06:18:40–06:18:58 UTC |
| 4. Existing production search/provider health | YES — access/authorization failure at existing health gate; provider health itself UNVERIFIED | Invoked the existing owner-gated `webSearch.probe` exactly once; no chat request, retry, or per-provider experiment followed. | The existing probe was rejected before provider sub-statuses were returned. No provider outage, quota, or source-success conclusion is inferred. | **HTTP 403 / authorization error class**; provider HTTP statuses unavailable. | 2026-08-28 06:18:28 UTC |

Overall Support conclusion: the lkn maintenance/503 condition and the existing health endpoint 403 are reproduced. Canonical Kairema itself loaded in the browser with an existing authenticated session that persisted across root refresh. A newly executed OAuth callback and independent deployed `OWNER_OPEN_ID` claim mapping remain UNVERIFIED. No Stytch Magic Link operation, routing/provider change, billing action, schema/infrastructure change, or extra live request was performed.
