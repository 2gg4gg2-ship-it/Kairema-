import { describe, expect, it } from "vitest";

describe("ZenMux server-side credential", () => {
  it("authorizes the documented OpenAI-compatible model catalog without exposing the key", async () => {
    const apiKey = process.env.ZENMUX_API_KEY;
    expect(apiKey, "ZENMUX_API_KEY must be configured server-side").toBeTruthy();

    const response = await fetch("https://zenmux.ai/api/v1/models", {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(15_000),
    });

    expect(response.status).toBe(200);
    const payload = (await response.json()) as { data?: unknown[] };
    expect(Array.isArray(payload.data)).toBe(true);
  }, 20_000);
});
