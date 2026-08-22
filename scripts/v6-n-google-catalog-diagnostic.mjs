const apiKey = process.env.GEMINI_API_KEY?.trim();
const timeoutMs = 12_000;

if (!apiKey) {
  console.log(JSON.stringify({ event: "v6-n.google-catalog", status: "not_configured", http: null, candidates: [] }, null, 2));
  process.exit(0);
}

const startedAt = Date.now();
try {
  const response = await fetch("https://generativelanguage.googleapis.com/v1beta/models", {
    headers: { "x-goog-api-key": apiKey },
    signal: AbortSignal.timeout(timeoutMs),
  });
  const payload = await response.json().catch(() => null);
  const candidates = response.ok && Array.isArray(payload?.models)
    ? payload.models
      .filter((model) => typeof model?.name === "string" && Array.isArray(model?.supportedGenerationMethods) && model.supportedGenerationMethods.includes("generateContent"))
      .map((model) => model.name.replace(/^models\//, ""))
      .filter((name) => /gemini.*(?:flash|pro)/i.test(name))
      .slice(0, 20)
    : [];
  console.log(JSON.stringify({
    event: "v6-n.google-catalog",
    status: response.ok ? "ok" : "unavailable",
    http: response.status,
    latencyMs: Date.now() - startedAt,
    candidates,
  }, null, 2));
} catch (error) {
  console.log(JSON.stringify({
    event: "v6-n.google-catalog",
    status: error?.name === "TimeoutError" ? "timeout" : "network_or_parse",
    http: null,
    latencyMs: Date.now() - startedAt,
    candidates: [],
  }, null, 2));
}
