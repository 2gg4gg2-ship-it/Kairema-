import { describe, expect, it } from "vitest";

const SAFE_CATALOG_ENDPOINTS = [
  "https://api.z.ai/v1/models",
  "https://zenmux.ai/api/v1/models",
] as const;

const requestedKeys = [
  "API_KEY_DOTS3",
  "API_KEY_GLM53",
  "API_KEY_GLM47",
  "API_KEY_GLM46V",
] as const;

async function isAuthorizedForCatalog(apiKey: string): Promise<boolean> {
  for (const endpoint of SAFE_CATALOG_ENDPOINTS) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const response = await fetch(endpoint, {
          headers: { Authorization: `Bearer ${apiKey}` },
          signal: AbortSignal.timeout(12_000),
        });

        if (response.status === 200) {
          const payload = (await response.json()) as { data?: unknown };
          return Array.isArray(payload.data);
        }
        break;
      } catch {
        // A transient socket failure must not prevent checking the second approved catalog.
        if (attempt === 1) break;
      }
    }
  }
  return false;
}

describe("Personal model credentials", () => {
  for (const keyName of requestedKeys) {
    it(`${keyName} authorizes at least one approved model catalog without exposing its value`, async () => {
      const apiKey = process.env[keyName];
      expect(apiKey, `${keyName} must be configured server-side`).toBeTruthy();
      expect(await isAuthorizedForCatalog(apiKey!)).toBe(true);
    }, 30_000);
  }
});
