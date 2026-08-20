import { writeFile } from "node:fs/promises";

const CANDIDATE_BASE_URLS = ["https://api.z.ai/v1", "https://zenmux.ai/api/v1"];
const targets = [
  {
    label: "Dots3-Note Preview",
    keyName: "API_KEY_DOTS3",
    candidates: ["dots-studio/dots3-note-prev", "dots3-note-preview"],
  },
  {
    label: "GLM 5.3",
    keyName: "API_KEY_GLM53",
    candidates: ["glm-5.3", "z-ai/glm-5.3"],
  },
  {
    label: "GLM 4.7 Flash",
    keyName: "API_KEY_GLM47",
    candidates: ["glm-4.7-flash", "z-ai/glm-4.7-flash"],
  },
  {
    label: "GLM 4.6V",
    keyName: "API_KEY_GLM46V",
    candidates: ["glm-4.6v", "z-ai/glm-4.6v", "glm-4.6v-flash"],
  },
];

const now = new Date().toISOString();
const fetchOptions = (apiKey) => ({
  headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
  signal: AbortSignal.timeout(18_000),
});

async function readCatalog(baseUrl, apiKey) {
  const response = await fetch(`${baseUrl}/models`, fetchOptions(apiKey));
  if (response.status !== 200) return { http: response.status, models: [] };
  const payload = await response.json();
  return { http: response.status, models: Array.isArray(payload.data) ? payload.data : [] };
}

function findExactModel(models, candidates) {
  for (const id of candidates) {
    const match = models.find((model) => model?.id === id);
    if (match) return match;
  }
  return null;
}

function publicPricing(model) {
  const pricing = model?.pricing;
  if (!pricing || typeof pricing !== "object") return null;
  const prompt = pricing.prompt ?? pricing.input ?? null;
  const completion = pricing.completion ?? pricing.output ?? null;
  return { prompt: String(prompt), completion: String(completion) };
}

async function probeCompletion(baseUrl, apiKey, modelId) {
  const started = performance.now();
  const response = await fetch(`${baseUrl}/chat/completions`, {
    ...fetchOptions(apiKey),
    method: "POST",
    body: JSON.stringify({
      model: modelId,
      messages: [{ role: "user", content: "Ответь одним словом: готово" }],
      max_tokens: 8,
      temperature: 0,
      stream: false,
    }),
  });
  const latencyMs = Math.round(performance.now() - started);
  let modelUsed = null;
  if (response.status === 200) {
    const payload = await response.json();
    modelUsed = typeof payload?.model === "string" ? payload.model : null;
  }
  return { http: response.status, latencyMs, modelUsed };
}

const results = [];
for (const target of targets) {
  const apiKey = process.env[target.keyName];
  if (!apiKey) {
    results.push({ model: target.label, endpoint: null, modelsHttp: null, completionHttp: null, status: "missing_key" });
    continue;
  }

  try {
    let baseUrl = null;
    let catalog = { http: null, models: [] };
    for (const candidateBaseUrl of CANDIDATE_BASE_URLS) {
      const candidateCatalog = await readCatalog(candidateBaseUrl, apiKey);
      if (candidateCatalog.http === 200) {
        baseUrl = candidateBaseUrl;
        catalog = candidateCatalog;
        break;
      }
      catalog = candidateCatalog;
    }
    const model = findExactModel(catalog.models, target.candidates);
    if (!model) {
      results.push({
        model: target.label,
        endpoint: baseUrl,
        modelsHttp: catalog.http,
        completionHttp: null,
        modelId: null,
        pricing: null,
        status: catalog.http === 200 ? "model_not_listed" : "catalog_unavailable",
      });
      continue;
    }

    const completion = await probeCompletion(baseUrl, apiKey, model.id);
    results.push({
      model: target.label,
      endpoint: baseUrl,
      modelId: model.id,
      modelsHttp: catalog.http,
      completionHttp: completion.http,
      latencyMs: completion.latencyMs,
      modelUsed: completion.modelUsed,
      pricing: publicPricing(model),
      status: completion.http === 200 ? "working" : completion.http === 429 ? "limited" : completion.http === 402 ? "paid" : "unavailable",
    });
  } catch {
    results.push({ model: target.label, endpoint: null, modelsHttp: null, completionHttp: null, status: "network_error" });
  }
}

await writeFile("/tmp/personal-model-keys-v6-a3-results.json", JSON.stringify({ checkedAt: now, results }, null, 2), { mode: 0o600 });
console.table(results.map(({ model, endpoint, modelId, modelsHttp, completionHttp, latencyMs, modelUsed, pricing, status }) => ({ model, endpoint, modelId, modelsHttp, completionHttp, latencyMs, modelUsed, pricing: pricing ? `${pricing.prompt}/${pricing.completion}` : null, status })));
