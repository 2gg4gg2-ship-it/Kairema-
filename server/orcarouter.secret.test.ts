import { describe, expect, it } from "vitest";

describe("OrcaRouter credential", () => {
  it("authorizes the server-side models catalog request", async () => {
    const apiKey = process.env.ORCAROUTER_API_KEY;
    expect(apiKey).toBeTruthy();

    const response = await fetch("https://api.orcarouter.ai/v1/models", {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(15_000),
    });

    expect(response.ok).toBe(true);
    const body = (await response.json()) as { data?: unknown[] };
    expect(Array.isArray(body.data)).toBe(true);
  }, 20_000);
});
