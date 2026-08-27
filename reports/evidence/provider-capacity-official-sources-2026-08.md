# Official Provider Capacity Sources — 2026-08

## Google Gemini Developer API

Source: <https://ai.google.dev/gemini-api/docs/rate-limits> (official page, extracted 2026-08-27; page last updated 2026-08-18 UTC).

> Gemini API rate limits are evaluated on RPM, input TPM and RPD; exceeding any dimension is rate limited. Quotas are **per project, not per API key**, and RPD resets at midnight Pacific time. Limits vary by model and tier, experimental/preview models are more restricted, and specified limits are not guaranteed.

The page identifies Free as an active project/free trial; higher tiers require billing/spend. It directs operators to AI Studio for the account's active model-specific limits. Therefore numeric limits for Kairema's configured `gemini-flash-lite-latest` are **UNKNOWN** without reading its AI Studio quota view; this audit performs no authenticated quota inspection or provider request.

Source: <https://ai.google.dev/gemini-api/docs/pricing> (official page, extracted 2026-08-27).

> The official pricing page classifies Free as limited access to certain models with free input/output tokens and says Paid is for production applications requiring higher volumes and advanced features. The free tier uses submitted content to improve products; paid does not. The current page also shows some product-wide shared quotas, for example Google Search grounding requests shared across Gemini 3.x models in paid pricing entries.

Audit implication: changing Google model ID is not proof of a new independent quota pool. Project-level quota scope is verified; the precise sharing relation for Kairema's configured model and any candidate must remain **UNKNOWN** unless official model-specific quota views/documentation state it.

## GroqCloud

Source: <https://console.groq.com/docs/rate-limits> (official page, extracted 2026-08-27).

> Groq documents RPM, RPD, TPM, TPD, input/output token dimensions and says limits apply at the **organization** level, not to individual end users; hitting any dimension first limits the request. Its table identifies the current Free-plan base limits for `openai/gpt-oss-120b` and `openai/gpt-oss-20b` as 30 RPM, 1,000 RPD, 8K TPM and 200K TPD. Groq says the account limits page is authoritative because exceptions exist; a 429 includes `retry-after` only when limited.

Source: <https://console.groq.com/docs/models> (official page, extracted 2026-08-27).

> The current models page labels `openai/gpt-oss-120b` and `openai/gpt-oss-20b` as production models, lists a 131,072-token context window and 65,536-token maximum completion for each, and labels preview models evaluation-only rather than production-ready.

Source: <https://console.groq.com/docs/billing-faqs> (official page, extracted 2026-08-27).

> Groq states that Developer tier requires a valid payment method and provides higher rate limits for production workloads; Free and Developer differ in capacity and billing semantics. The account dashboard is the authoritative current usage view.

Audit implication: an additional Groq model ID is **not verified** as additional free capacity, because quota is organization-scoped and the documentation does not establish model-pool independence for the Kairema organization. The documented free base limits above are **VERIFIED public defaults**, while Kairema-specific current remaining quota and eligibility are **UNKNOWN** because this audit does not authenticate to the provider or issue a request.

## OpenRouter

Source: <https://openrouter.ai/docs/api_reference/limits> (official page, extracted 2026-08-27).

> OpenRouter documents a free-model allowance of **50 requests/day** for accounts with fewer than 10 credits purchased and **1,000 requests/day** once that purchase threshold is met. The page says this allowance is shared across all `:free` models and that free-model users are limited to **20 RPM**. OpenRouter additionally applies a platform-level limit of 200 requests/second per user; higher limits are based on credits purchased.

Source: <https://openrouter.ai/docs/faq> (official page, extracted 2026-08-27).

> OpenRouter describes `:free` models as availability-dependent and does not guarantee that a particular free model remains available. Its usage limits and available model catalog are platform-managed.

Audit implication: different `:free` model IDs on the same OpenRouter account do **not** create independent free capacity; their public free allowance and RPM are explicitly shared. Kairema's actual remaining OpenRouter allowance, model availability and whether the account has reached the purchase threshold are **UNKNOWN** because no authenticated model, usage or completion request is made.

## DeepSeek API

Source: <https://api-docs.deepseek.com/quick_start/pricing/> (official page, extracted 2026-08-27).

> DeepSeek lists its V4 Flash, V4 Pro and V4 Flash Vision API models with per-million input/output token prices and says charges are deducted from topped-up or granted balance. It lists context length of **1M**, maximum output of **384K** and default concurrency limits of **2,500** for Flash/Flash Vision and **500** for Pro.

Source: <https://api-docs.deepseek.com/quick_start/rate_limit/> (official page, extracted 2026-08-27).

> Concurrency is calculated at the **account level regardless of API key**; requests over the limit receive HTTP 429. The page offers capacity expansion based on business needs and states that ordinary `user_id` values are still combined for account-level concurrency calculation. It documents `user_id` only as an application-side safety/cache/scheduling isolation control.

Audit implication: the official API documentation exposes paid/token-balance billing rather than a public free API quota. Kairema's direct DeepSeek key, if enabled, is therefore **not a verified free-capacity domain**. Model IDs inside the same account are not evidence of independent concurrency capacity, and actual balance, account tier, regional eligibility and remaining quota are **UNKNOWN** without prohibited authenticated inspection.

## Cerebras

Source: <https://inference-docs.cerebras.ai/support/rate-limits> (official page, extracted 2026-08-27).

> Cerebras applies RPM/TPM/TPH/TPD limits at the **organization** level. Its published Free Trial limits for both `gpt-oss-120b` and `gemma-4-31b` are **5 RPM**, **30K TPM**, **1M TPH**, and **1M TPD**. Both uncached and total-token buckets apply independently, and token-bucket replenishment is continuous rather than a fixed daily reset.

The same official documentation states that a new account receives **$5** in Free Trial credits only after adding a verified payment method; those credits expire in **30 days**. It explicitly states there is no permanently free tier or per-model always-free allowance. API access stops when credits expire or are spent until a purchase is made.

Source: <https://www.cerebras.ai/pricing> (official page, extracted 2026-08-27).

> Cerebras positions the Developer tier as payment-enabled and Enterprise as its highest-throughput production tier; preview models are evaluation-only rather than intended for production.

Audit implication: Cerebras is an independent provider domain, but its Free Trial is time- and credit-bounded rather than renewable free capacity. It is excluded from sustainable free-pool arithmetic. Its actual account status, eligible models, remaining credits, regional eligibility and applicable limits remain **UNKNOWN** because this audit did not create an account, provide billing information, inspect a dashboard or call the API.

## SambaNova

Source: <https://docs.sambanova.ai/docs/en/models/rate-limits> (official page, extracted 2026-08-27).

> SambaNova labels API limits per user. Its currently published Free Tier tables show 20 RPM, 20 RPD and 200,000 TPD for each listed production and preview model. A request is constrained as soon as it reaches either applicable limit. The same page expressly calls the paid Developer Tier 20M TPD across all models.

Source: <https://docs.sambanova.ai/docs/en/models/sambacloud-models> (official page, extracted 2026-08-27).

> Production `gpt-oss-120b`, `DeepSeek-V3.1` and `Meta-Llama-3.3-70B-Instruct` each list a 128K-token context window. Preview `gemma-4-31B-it` lists 128K context, but the documentation says preview models are evaluation/developer-experimentation only and should not be used in production.

Source: <https://cloud.sambanova.ai/plans> (official page, extracted 2026-08-27).

> The plans page says Free requires adding a payment method and purchasing credits to run first requests; Developer is pay-as-you-go and Enterprise is subscription based.

Audit implication: SambaNova is a potentially independent provider domain, but the reviewed Free Tier text does not establish whether its published per-model limits are independently additive or share an undisclosed account bucket. Account eligibility is also **UNKNOWN** without prohibited dashboard inspection. It is a conditional candidate for future evidence-only review, not verified sustainable free capacity and not an integration recommendation in this stage.

## OrcaRouter

Source: <https://docs.orcarouter.ai/operations/rate-limits> (official page, extracted 2026-08-27).

> OrcaRouter places limits at the **workspace** scope: all API keys in a workspace use the same rate-limit bucket. The documentation uses fixed minute/day windows and notes that some limits can also constrain prompt size. It does not publish a numerical allowance for its free `-free` identifiers on the reviewed page.

Sources: <https://docs.orcarouter.ai/routing/free-models>, <https://docs.orcarouter.ai/getting-started/get-api-key>, and <https://www.orcarouter.ai/terms.html> (official pages, extracted 2026-08-27).

> The free-model routing documentation describes `-free` identifiers as best-effort primary routing rather than a guaranteed-capacity contract. Availability and terms may change. The reviewed documentation contains no public numeric, renewable free production pool that can safely be used in request-per-day arithmetic.

Audit implication: OrcaRouter is one independent **workspace** quota domain, not an allowance per model ID or key. Additional OrcaRouter `-free` identifiers are **not** evidence of additive capacity. Kairema-specific workspace plan, remaining allowance, enabled models, regional eligibility, context/output limits and production/commercial rights are **UNKNOWN** because this audit makes no dashboard, model-list or completion request.

## ZenMux

Source: <https://zenmux.ai/docs/guide/subscription.html> (official page, extracted 2026-08-27).

> ZenMux documents its Free plan as Studio Chat-only with no API-request access. Builder plans list 10–15 RPM with rolling five-hour and seven-day quota windows, but are prohibited for live production, commercial or end-user-facing use and for sharing an account between multiple users.

Source: <https://zenmux.ai/docs/guide/pay-as-you-go.html> and <https://zenmux.ai/models> (official pages, extracted 2026-08-27).

> ZenMux documents pay-as-you-go as a separate production API-key and prepaid-balance path with configurable per-key RPM, TPM, spend and model limits. Its catalog is dynamic and labels can distinguish Free, Rate Limit and PAYG-only entries.

Audit implication: ZenMux Free is **VERIFIED** as not an API capacity pool. Builder-plan numeric constraints are **VERIFIED** as public plan semantics but are not eligible Kairema production capacity because of their stated end-user/commercial restrictions. Pay-as-you-go is **VERIFIED** as paid only. Current plan/key authorization, remaining allowance, model access, regional eligibility, context/output ceilings and any shared quota detail are **UNKNOWN** without prohibited authenticated inspection; extra ZenMux model IDs must not be counted as independent capacity.

## Mistral AI

Source: <https://docs.mistral.ai/admin/billing-usage/usage-limits> (official page, extracted 2026-08-27).

> Mistral documents API rate limits as Organization traffic limits, with per-model tokens-per-minute and requests-per-second values shown in the authenticated Limits dashboard. Free mode permits API keys and included monthly usage within those account-specific limits; pay-as-you-go extends usage. Organization and workspace spending limits can suspend access after a monthly ceiling is reached.

Audit implication: Mistral is a potentially independent provider domain with a documented free API mode, but its numeric monthly allowance, per-model RPS/TPM, reset semantics, production eligibility, regional availability and account authorization are **UNKNOWN** without prohibited dashboard inspection. The provider can be a later evidence-only candidate, but it is not included in renewable free-pool arithmetic now.

## Cloudflare Workers AI

Source: <https://developers.cloudflare.com/workers-ai/platform/pricing/> (official page, extracted 2026-08-27; page last updated 2026-08-26 UTC).

> Workers AI grants each account a total **10,000 Neurons per day**, reset at **00:00 UTC**. Usage above that requires the Workers Paid plan; some listed frontier models additionally require paid billing or prepaid AI Gateway credits. The published price table makes Neuron consumption model- and input/output-token-dependent.

Audit implication: Cloudflare is an independent provider/account domain with a renewable public allocation. It is **VERIFIED** as a possible separate quota domain, but requests-to-turn capacity is **ILLUSTRATIVE**, not fixed: it depends on the selected model, input/output lengths and whether a model is free-plan eligible. It would also require a new integration, so it is not a current Kairema pool or a runtime recommendation.

## Cohere

Source: <https://docs.cohere.com/docs/rate-limits> (official page, extracted 2026-08-27).

> Cohere identifies evaluation keys as free but limited, and production keys as paid. Trial keys are limited to **1,000 API calls per month**; listed Chat trial limits are **20 requests/minute**. The documentation frames trial use as evaluation and directs production-requirement operators toward production/sales paths.

Audit implication: Cohere is an independent provider domain but its reviewed free allowance is evaluation/trial rather than verified commercial/end-user production capacity. It is excluded from sustainable Kairema free-pool arithmetic and should not be integrated as a production fallback on this evidence alone.

## Current Kairema search providers

### Tavily

Source: <https://docs.tavily.com/documentation/api-credits> (official page, extracted 2026-08-27).

> Tavily provides **1,000 free API credits per month** without a credit card. A basic search consumes one credit; advanced search consumes two credits. Other features consume credits according to documented result/page counts.

Audit implication: Tavily is a separate search-provider account domain. Its monthly public allocation is **VERIFIED**, but Kairema's remaining account credits, active key eligibility, request rate limits, regional access and any account sharing are **UNKNOWN** without prohibited authenticated inspection or requests.

### Exa

Source: <https://exa.ai/docs/reference/billing> (official page, extracted 2026-08-27; page last modified 2026-07-24).

> Exa gives new accounts **$20** in signup credits and Free Tier accounts **$10** in credits each month, without a payment method. It is credit-priced by endpoint; requests stop when the balance runs out. Higher-volume planning requires preload/auto-recharge, while balance itself does not increase rate limits.

Audit implication: Exa is a separate search-provider account domain with a **VERIFIED** renewable free monthly credit amount. Queries-per-month, rate limits, current account balance, commercial eligibility and sharing relations remain **UNKNOWN** without a dashboard inspection or API request.

### Serper

Source: <https://serper.dev/> (official page, extracted 2026-08-27).

> Serper publicly advertises **2,500 free queries** without a credit card. Its paid packages are credit top-ups with published QPS values and six-month credit validity.

Audit implication: Serper is a separate search-provider account domain. The one-time/free-credit renewal semantics, account-level rate limits, commercial eligibility, remaining account balance and sharing scope are **UNKNOWN** from the reviewed public page; its public figure must not be treated as a monthly renewable capacity claim.
