import { describe, expect, it } from "vitest";

describe("OPENROUTER_API_KEY", () => {
  it("authorizes a lightweight server-side models request without exposing the key", async () => {
    const key = process.env.OPENROUTER_API_KEY;
    expect(key, "OPENROUTER_API_KEY должен быть задан как server-side секрет").toBeTruthy();

    const response = await fetch("https://openrouter.ai/api/v1/models", {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(15_000),
    });

    expect(response.status, "OpenRouter должен принять сохранённый ключ").toBe(200);
    const data = (await response.json()) as { data?: unknown[] };
    expect(Array.isArray(data.data)).toBe(true);
  }, 20_000);
});
