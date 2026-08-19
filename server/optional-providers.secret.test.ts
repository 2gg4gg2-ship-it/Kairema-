import { describe, expect, it } from "vitest";

type HealthCheck = { name: string; endpoint: string; response: Response };

async function checkOptionalProviderSecrets(): Promise<HealthCheck[]> {
  const tavilyKey = process.env.TAVILY_API_KEY?.trim();
  const sambaNovaKey = process.env.SAMBANOVA_API_KEY?.trim();
  const mistralKey = process.env.MISTRAL_API_KEY?.trim();

  expect(tavilyKey, "TAVILY_API_KEY должен быть задан через защищённое поле").toBeTruthy();
  expect(sambaNovaKey, "SAMBANOVA_API_KEY должен быть задан через защищённое поле").toBeTruthy();
  expect(mistralKey, "MISTRAL_API_KEY должен быть задан через защищённое поле").toBeTruthy();

  return Promise.all([
    fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { Authorization: `Bearer ${tavilyKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query: "Kairema health check", search_depth: "basic", max_results: 1 }),
      signal: AbortSignal.timeout(15_000),
    }).then((response) => ({ name: "Tavily", endpoint: "POST /search", response })),
    fetch("https://api.sambanova.ai/v1/models", {
      headers: { Authorization: `Bearer ${sambaNovaKey}` },
      signal: AbortSignal.timeout(15_000),
    }).then((response) => ({ name: "SambaNova", endpoint: "GET /v1/models", response })),
    fetch("https://api.mistral.ai/v1/models", {
      headers: { Authorization: `Bearer ${mistralKey}` },
      signal: AbortSignal.timeout(15_000),
    }).then((response) => ({ name: "Mistral", endpoint: "GET /v1/models", response })),
  ]);
}

describe("optional provider secrets", () => {
  it("accepts lightweight server-side health checks without exposing credentials", async () => {
    const checks = await checkOptionalProviderSecrets();
    for (const check of checks) {
      expect(check.response.ok, `${check.name} ${check.endpoint} вернул HTTP ${check.response.status}`).toBe(true);
    }
  }, 30_000);
});
