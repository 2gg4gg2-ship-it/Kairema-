const key = process.env.ORCAROUTER_API_KEY;
if (!key) throw new Error("ORCAROUTER_API_KEY is unavailable.");
const started = performance.now();
const response = await fetch("https://api.orcarouter.ai/v1/chat/completions", {
  method: "POST",
  headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
  body: JSON.stringify({
    model: "tencent/hy3-free",
    temperature: 0.2,
    max_tokens: 800,
    messages: [{ role: "user", content: "Ответь ровно одним словом: Готово" }],
  }),
});
const elapsedMs = Math.round(performance.now() - started);
let body = null;
try { body = await response.json(); } catch { body = null; }
const content = body?.choices?.[0]?.message?.content;
process.stdout.write(`${JSON.stringify({
  checkedAt: new Date().toISOString(),
  requestedModel: "tencent/hy3-free",
  modelUsed: typeof body?.model === "string" ? body.model : null,
  http: response.status,
  elapsedMs,
  contentCharacters: typeof content === "string" ? content.length : 0,
  preview: typeof content === "string" ? content.replace(/\s+/g, " ").slice(0, 120) : null,
  finishReason: typeof body?.choices?.[0]?.finish_reason === "string" ? body.choices[0].finish_reason : null,
}, null, 2)}\n`);
