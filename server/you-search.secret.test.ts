import { describe, expect, it } from "vitest";

describe("You.com Search server secret", () => {
  it("авторизует минимальный server-side Search API запрос", async () => {
    const apiKey = process.env.YOU_API_KEY;
    expect(apiKey, "YOU_API_KEY must be available only to the server test runtime").toBeTruthy();

    const response = await fetch("https://ydc-index.io/v1/search", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": apiKey!,
      },
      body: JSON.stringify({
        query: "You.com Search API documentation",
        count: 1,
        safesearch: "moderate",
      }),
      signal: AbortSignal.timeout(15_000),
    });

    expect(response.status, "You.com Search must authorize the configured server key").toBe(200);
    const payload = await response.json() as { results?: { web?: unknown[]; news?: unknown[] } };
    expect(Array.isArray(payload.results?.web) || Array.isArray(payload.results?.news)).toBe(true);
  }, 20_000);
});
