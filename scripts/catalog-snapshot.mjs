import { mkdirSync, writeFileSync } from "node:fs";

const catalogRequests = [
  {
    provider: "openrouter",
    url: "https://openrouter.ai/api/v1/models",
    headers: { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}` },
    pick: (payload) =>
      (payload.data ?? []).map((model) => ({
        id: model.id,
        name: model.name,
        contextLength: model.context_length,
        inputModalities: model.architecture?.input_modalities,
      })),
  },
  {
    provider: "google",
    url: `https://generativelanguage.googleapis.com/v1beta/models?key=${process.env.GEMINI_API_KEY}`,
    headers: {},
    pick: (payload) =>
      (payload.models ?? [])
        .filter((model) => model.supportedGenerationMethods?.includes("generateContent"))
        .map((model) => ({
          id: model.name?.replace(/^models\//, ""),
          name: model.displayName,
          contextLength: model.inputTokenLimit,
          methods: model.supportedGenerationMethods,
        })),
  },
  {
    provider: "groq",
    url: "https://api.groq.com/openai/v1/models",
    headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}` },
    pick: (payload) =>
      (payload.data ?? []).map((model) => ({
        id: model.id,
        name: model.id,
        contextLength: model.context_window,
      })),
  },
];

const output = [];
for (const request of catalogRequests) {
  const response = await fetch(request.url, {
    headers: request.headers,
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) {
    throw new Error(`${request.provider}: catalog returned HTTP ${response.status}`);
  }
  const payload = await response.json();
  output.push({ provider: request.provider, models: request.pick(payload) });
}

mkdirSync("reports", { recursive: true });
writeFileSync("reports/provider-catalog-snapshot.json", JSON.stringify(output, null, 2));
console.log(
  output.map(({ provider, models }) => `${provider}: ${models.length} chat-capable models`).join("\n"),
);
