import { writeFile } from "node:fs/promises";

const baseUrl = "https://zenmux.ai/api/v1";
const apiKey = process.env.ZENMUX_API_KEY?.trim();
const requested = [
  { label: "z-ai/glm-5.3", expectedId: "z-ai/glm-5.3-free", officialZeroPrice: true },
  { label: "z-ai/glm-4.7-flash", expectedId: "z-ai/glm-4.7-flash-free", officialZeroPrice: true },
  { label: "dots-studio/dots3-note-prev", expectedId: "dots-studio/dots3-note-prev", officialZeroPrice: true },
];

function isZero(value) {
  return value === 0 || value === "0" || value === "0.0" || value === "0.000000";
}

function errorClass(http) {
  if (http === 401 || http === 403) return "AUTH";
  if (http === 429) return "RATE_LIMIT";
  if (http && http >= 500) return "PROVIDER_UNAVAILABLE";
  if (http) return "HTTP_ERROR";
  return "NETWORK";
}

const checkedAt = new Date().toISOString();
const results = { checkedAt, catalogHttp: null, models: [] };

if (!apiKey) {
  results.catalogHttp = 0;
  results.models = requested.map(({ label }) => ({ label, modelId: null, zeroPrice: false, http: null, latencyMs: null, status: "not_configured", errorClass: "CONFIG" }));
} else {
  try {
    const catalogResponse = await fetch(`${baseUrl}/models`, { headers: { Authorization: `Bearer ${apiKey}` }, signal: AbortSignal.timeout(20_000) });
    results.catalogHttp = catalogResponse.status;
    const catalog = catalogResponse.ok ? await catalogResponse.json() : { data: [] };
    const entries = Array.isArray(catalog?.data) ? catalog.data : [];

    for (const candidate of requested) {
      const model = entries.find((item) => item?.id === candidate.expectedId);
      const pricing = model?.pricing && typeof model.pricing === "object" ? model.pricing : {};
      const inputPrice = model ? String(pricing.prompt ?? pricing.input ?? "unknown") : null;
      const outputPrice = model ? String(pricing.completion ?? pricing.output ?? "unknown") : null;
      const pricingFields = model ? Object.keys(pricing).sort() : [];
      const catalogProvidesPricing = pricingFields.length > 0;
      const zeroPrice = Boolean(model) && (catalogProvidesPricing ? isZero(pricing.prompt ?? pricing.input) && isZero(pricing.completion ?? pricing.output) : candidate.officialZeroPrice);
      const zeroPriceSource = catalogProvidesPricing ? "catalog" : candidate.officialZeroPrice ? "official-models-page" : "unconfirmed";
      const row = { label: candidate.label, modelId: model?.id ?? null, inputPrice, outputPrice, pricingFields, zeroPrice, zeroPriceSource, http: null, latencyMs: null, status: "not_tested", errorClass: null };

      if (!catalogResponse.ok) {
        row.status = "catalog_error";
        row.errorClass = errorClass(catalogResponse.status);
      } else if (!model) {
        row.status = "not_in_catalog";
        row.errorClass = "MODEL";
      } else if (!zeroPrice) {
        row.status = "not_zero_priced";
        row.errorClass = "PRICING";
      } else {
        const start = performance.now();
        try {
          const completion = await fetch(`${baseUrl}/chat/completions`, {
            method: "POST",
            headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
            body: JSON.stringify({ model: model.id, messages: [{ role: "user", content: "Ответь одним словом: готово" }], max_tokens: 8, temperature: 0 }),
            signal: AbortSignal.timeout(30_000),
          });
          row.http = completion.status;
          row.latencyMs = Math.round(performance.now() - start);
          row.status = completion.ok ? "ready" : "completion_error";
          row.errorClass = completion.ok ? null : errorClass(completion.status);
          await completion.arrayBuffer();
        } catch {
          row.latencyMs = Math.round(performance.now() - start);
          row.status = "completion_error";
          row.errorClass = "NETWORK";
        }
      }
      results.models.push(row);
    }
  } catch {
    results.catalogHttp = 0;
    results.models = requested.map(({ label }) => ({ label, modelId: null, inputPrice: null, outputPrice: null, pricingFields: [], zeroPrice: false, http: null, latencyMs: null, status: "catalog_error", errorClass: "NETWORK" }));
  }
}

await writeFile("/tmp/zenmux-v6-a1-live-results.json", `${JSON.stringify(results, null, 2)}\n`, { mode: 0o600 });
for (const row of results.models) console.log([row.label, row.modelId ?? "—", `in:${row.inputPrice ?? "—"}`, `out:${row.outputPrice ?? "—"}`, `fields:${row.pricingFields.join(",") || "—"}`, row.zeroPrice ? "$0" : "not-$0", row.http ?? "—", row.latencyMs ?? "—", row.status].join(" | "));
