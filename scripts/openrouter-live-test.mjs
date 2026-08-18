const models = [
  "google/gemma-4-26b-a4b-it:free",
  "cohere/north-mini-code:free",
  "dots-studio/dots-3-note-preview:free",
  "openai/gpt-oss-20b:free",
  "openrouter/free",
];

const key = process.env.OPENROUTER_API_KEY;
if (!key) throw new Error("OPENROUTER_API_KEY is not configured");

const selectedModels = process.env.ONLY_MODEL ? models.filter((model) => model === process.env.ONLY_MODEL) : models;
if (selectedModels.length === 0) throw new Error("ONLY_MODEL is not included in the Kairema static registry");

const results = [];
for (const model of selectedModels) {
  const started = Date.now();
  try {
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "X-Title": "Kairema live test" },
      body: JSON.stringify({ model, stream: false, messages: [{ role: "user", content: "Ответь ровно одним словом: Готово" }] }),
      signal: AbortSignal.timeout(25_000),
    });
    let body = null;
    try { body = await response.json(); } catch { body = { error: { message: "parse_error" } }; }
    const content = body?.choices?.[0]?.message?.content;
    results.push({ model, http: response.status, jsonParsed: typeof body === "object", hasText: typeof content === "string" && content.trim().length > 0, category: body?.error?.code ?? body?.error?.metadata?.code ?? null, elapsedMs: Date.now() - started });
  } catch (error) {
    results.push({ model, http: null, jsonParsed: false, hasText: false, category: error instanceof DOMException && error.name === "TimeoutError" ? "TIMEOUT" : "NETWORK", elapsedMs: Date.now() - started });
  }
}

console.log(JSON.stringify(results, null, 2));
