const ORCA_URL = "https://api.orcarouter.ai/v1/chat/completions";
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

const fixedDocument = `Ниже приведён небольшой русский документ. Переведи его на английский, сохрани термины в кавычках, структуру и смысл. После перевода отдельной строкой объясни, почему «контекстное окно» важно для анализа длинных документов.

«Контекстное окно» определяет объём информации, который модель учитывает за один запрос. В договоре нельзя смешивать «срок действия» и «срок исполнения»: первое описывает период действия соглашения, второе — дедлайн конкретной обязанности.`;
const livePrompt = "Ответь ровно одним словом: Готово";

const orcaModels = [
  "deepseek/deepseek-v4-pro-free",
  "deepseek/deepseek-v4-flash-free",
  "tencent/hy3-free",
  "qwen/qwen3.8-27b-free",
];

function safeResult(label, requestedModel, response, elapsedMs, body) {
  const content = body?.choices?.[0]?.message?.content;
  return {
    label,
    requestedModel,
    modelUsed: typeof body?.model === "string" ? body.model : null,
    http: response.status,
    elapsedMs,
    contentCharacters: typeof content === "string" ? content.length : 0,
    preview: typeof content === "string" ? content.replace(/\s+/g, " ").slice(0, 240) : null,
    finishReason: typeof body?.choices?.[0]?.finish_reason === "string" ? body.choices[0].finish_reason : null,
    errorClass: response.ok ? null : "HTTP_ERROR",
  };
}

async function ask(label, url, key, requestedModel, prompt, maxTokens) {
  const started = performance.now();
  const response = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: requestedModel,
      temperature: 0.2,
      max_tokens: maxTokens,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  const elapsedMs = Math.round(performance.now() - started);
  let body = null;
  try { body = await response.json(); } catch { body = null; }
  return safeResult(label, requestedModel, response, elapsedMs, body);
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  const orcaKey = process.env.ORCAROUTER_API_KEY;
  const openRouterKey = process.env.OPENROUTER_API_KEY;
  if (!orcaKey || !openRouterKey) throw new Error("Required server-side provider key is unavailable.");

  const results = [];
  for (const model of orcaModels) results.push(await ask("orcarouter-live", ORCA_URL, orcaKey, model, livePrompt, 96));
  results.push(await ask("comparison-orcarouter", ORCA_URL, orcaKey, "deepseek/deepseek-v4-pro-free", fixedDocument, 1400));
  let gemma = await ask("comparison-openrouter", OPENROUTER_URL, openRouterKey, "google/gemma-4-31b-it:free", fixedDocument, 1400);
  if (gemma.http === 429) {
    await delay(61_000);
    gemma = { ...await ask("comparison-openrouter-retry", OPENROUTER_URL, openRouterKey, "google/gemma-4-31b-it:free", fixedDocument, 1400), retriedAfter429: true };
  }
  results.push(gemma);
  process.stdout.write(`${JSON.stringify({ checkedAt: new Date().toISOString(), parameters: { live: { temperature: 0.2, maxTokens: 96 }, comparison: { temperature: 0.2, maxTokens: 1400 } }, results }, null, 2)}\n`);
}

main().catch((error) => { console.error(error instanceof Error ? error.message : "Live verification failed."); process.exitCode = 1; });
