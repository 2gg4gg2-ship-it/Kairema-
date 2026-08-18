import { describe, expect, it } from "vitest";

describe("provider secret health checks", () => {
  it("accepts the configured DeepSeek credential without exposing it", async () => {
    const response = await fetch("https://api.deepseek.com/models", {
      headers: { Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY ?? ""}` },
    });

    expect(response.status).toBe(200);
  }, 20_000);

  it("accepts the configured Google AI Studio credential without exposing it", async () => {
    const key = process.env.GEMINI_API_KEY ?? "";
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}`,
    );

    expect(response.status).toBe(200);
  }, 20_000);
});
