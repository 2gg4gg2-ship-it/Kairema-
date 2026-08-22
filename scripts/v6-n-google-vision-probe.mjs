const apiKey = process.env.GEMINI_API_KEY?.trim();
const endpoint = "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";
const model = "gemini-flash-lite-latest";
const neutralPng = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9JZVYAAAAASUVORK5CYII=";

async function probe(kind, messages) {
  const startedAt = Date.now();
  if (!apiKey) return { kind, status: "not_configured", http: null, latencyMs: 0, answerPresent: false };
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model, messages, stream: false, max_tokens: 32 }),
      signal: AbortSignal.timeout(20_000),
    });
    const payload = await response.json().catch(() => null);
    const answerPresent = typeof payload?.choices?.[0]?.message?.content === "string" && payload.choices[0].message.content.trim().length > 0;
    return { kind, status: response.ok && answerPresent ? "pass" : "fail", http: response.status, latencyMs: Date.now() - startedAt, answerPresent };
  } catch (error) {
    return { kind, status: error?.name === "TimeoutError" ? "timeout" : "network_or_parse", http: null, latencyMs: Date.now() - startedAt, answerPresent: false };
  }
}

const text = await probe("text", [{ role: "user", content: "Ответь одним словом: готово" }]);
const image = await probe("neutral_png", [{
  role: "user",
  content: [
    { type: "text", text: "Опиши, есть ли прикреплённое изображение. Ответь одним коротким предложением." },
    { type: "image_url", image_url: { url: `data:image/png;base64,${neutralPng}` } },
  ],
}]);
console.log(JSON.stringify({ event: "v6-n.google-vision-probe", candidate: model, checkedAt: new Date().toISOString(), results: [text, image] }, null, 2));
