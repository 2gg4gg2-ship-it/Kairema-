# Cloudflare source ledger — combined decision — 2026-08

All findings below are **public-documentation evidence only**. No Cloudflare account, token, Worker, billing method, paid plan, inference request, or project integration was created or used.

| Area | Officially documented fact | Interpretation for Kairema |
|---|---|---|
| Workers AI free allocation | Workers AI documentation says Workers Free includes **10,000 Neurons per day at no charge**, resets at **00:00 UTC**, and usage above that requires Workers Paid. | A real independent Cloudflare account would have a bounded new quota domain, but the request-to-neuron conversion depends on model/input/output and cannot be treated as a fixed request quota. |
| Workers AI billing | Documentation lists **$0.011 per 1,000 Neurons** on Workers Paid and identifies several frontier models as paid-billing gated. | Automatic use would create spend risk; this combined stage leaves Cloudflare non-integrated and no billing-safe production route exists. |
| Text-generation rate | The documented default Workers AI text-generation rate is **300 RPM**; some listed models have separate rates and frontier limits are per account/per model. | Rate does not establish daily sustainable capacity and must not be converted to 10K/25K/50K readiness. |
| Representative compatible capability | The `@cf/meta/llama-3.1-8b-instruct-fast` model page documents text generation, multilingual dialogue, 128,000-token context, default `max_tokens` 256 and SSE streaming support. | It is a technically plausible future Flash-like feasibility candidate only; catalog presence does not verify Kairema account eligibility, regional availability, model permanence, account limits or quality. |
| Catalog | The Workers AI catalog enumerates Cloudflare-hosted text-generation models and labels capabilities per model. | The catalog is discovery evidence only, not an allowlist nor an admission to current Kairema routing. |
| Workers Free hosting | Workers docs state Free has **100,000 requests/day**, **10 ms CPU/request**, **128 MB memory/isolate**, 50 subrequests/request, and 6 simultaneous outgoing connections/request. | Current Express/Drizzle/Node architecture is not directly deployable unchanged; public backend replacement or migration would be a new architecture and is excluded. |
| Workers durability | Workers docs note no hard HTTP duration limit while a client remains connected, but CPU and memory are bounded; runtime updates offer a 30-second grace period for inflight requests. | SSE is technically part of a future migration feasibility discussion, but runtime behavior, databases, client protocol and multi-instance semantics remain unvalidated. |

## Source URLs

1. https://developers.cloudflare.com/workers-ai/platform/pricing/ — last observed 2026-08-26.
2. https://developers.cloudflare.com/workers-ai/platform/limits/ — last observed 2026-08-07.
3. https://developers.cloudflare.com/workers-ai/models/ — last observed 2026-08-12.
4. https://developers.cloudflare.com/workers-ai/models/llama-3.1-8b-instruct-fast/ — model capability page, observed 2026-08-27.
5. https://developers.cloudflare.com/workers/platform/pricing/ — last observed 2026-08-25.
6. https://developers.cloudflare.com/workers/platform/limits/ — last observed 2026-07-28.

## Explicit unknowns

The public sources do not verify a Kairema Cloudflare account, account-level remaining Neurons, reset state, token caps, shared-domain details with other account products, regional eligibility for the intended account, production/commercial permissions for a proposed route, latency, current model availability at deployment time, or a safe $0 migration path. These remain **UNKNOWN / OWNER INPUT REQUIRED** and must not be configured as controller limits.
