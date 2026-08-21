import { describe, expect, it } from "vitest";

const runLive = process.env.RUN_LIVE_PROVIDER_TESTS === "1";

const cases = [
  {
    name: "Serper.dev",
    key: "SERPER_API_KEY",
    request: (apiKey: string) => fetch("https://google.serper.dev/search", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-API-KEY": apiKey },
      body: JSON.stringify({ q: "web search API documentation", num: 1 }),
      signal: AbortSignal.timeout(15_000),
    }),
  },
  {
    name: "Exa AI",
    key: "EXA_API_KEY",
    request: (apiKey: string) => fetch("https://api.exa.ai/search", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": apiKey },
      body: JSON.stringify({ query: "web search API documentation", numResults: 1 }),
      signal: AbortSignal.timeout(15_000),
    }),
  },
  {
    name: "Firecrawl",
    key: "FIRECRAWL_API_KEY",
    request: (apiKey: string) => fetch("https://api.firecrawl.dev/v2/search", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ query: "web search API documentation", limit: 1 }),
      signal: AbortSignal.timeout(15_000),
    }),
  },
  {
    name: "Keirolabs",
    key: "KEIRO_API_KEY",
    request: (apiKey: string) => fetch("https://api.keirolabs.cloud/api/v2/search/fast", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ query: "web search API documentation", maxResults: 1, mode: "light" }),
      signal: AbortSignal.timeout(15_000),
    }),
  },
] as const;

describe.runIf(runLive)("v6-K server-side search secrets", () => {
  for (const candidate of cases) {
    it(`${candidate.name}: accepts the protected key`, async () => {
      const apiKey = process.env[candidate.key];
      expect(apiKey, `${candidate.key} must be available to this server-only test`).toBeTruthy();

      const response = await candidate.request(apiKey!);
      expect(response.status, `${candidate.name} must return HTTP 200 before active integration`).toBe(200);
    }, 20_000);
  }
});
