import { describe, expect, it } from "vitest";

describe("Cerebras protected secret", () => {
  it("authorizes a lightweight server-side model-catalog request without exposing credentials", async () => {
    const key = process.env.CEREBRAS_API_KEY?.trim();
    expect(key, "CEREBRAS_API_KEY должен быть задан через защищённое поле").toBeTruthy();

    const response = await fetch("https://api.cerebras.ai/v1/models", {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(15_000),
    });

    expect(response.ok, `Cerebras GET /v1/models вернул HTTP ${response.status}`).toBe(true);
  }, 20_000);
});
