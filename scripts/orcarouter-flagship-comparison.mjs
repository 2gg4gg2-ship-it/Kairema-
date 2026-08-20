const orcaKey = process.env.ORCAROUTER_API_KEY;
const geminiKey = process.env.GEMINI_API_KEY;
if (!orcaKey || !geminiKey) throw new Error("Required server-side comparison key is unavailable.");
const documentText = `Ниже приведён небольшой русский документ. Переведи его на английский, сохрани термины в кавычках, структуру и смысл. После перевода отдельной строкой объясни, почему «контекстное окно» важно для анализа длинных документов.

«Контекстное окно» определяет объём информации, который модель учитывает за один запрос. В договоре нельзя смешивать «срок действия» и «срок исполнения»: первое описывает период действия соглашения, второе — дедлайн конкретной обязанности.`;

async function deepSeekV4Pro() {
  const started = performance.now();
  const response = await fetch("https://api.orcarouter.ai/v1/chat/completions", {
    method: "POST", headers: { Authorization: `Bearer ${orcaKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "deepseek/deepseek-v4-pro-free", temperature: 0.2, max_tokens: 1400, messages: [{ role: "user", content: documentText }] }),
  });
  const body = await response.json();
  return { provider: "OrcaRouter", requestedModel: "deepseek/deepseek-v4-pro-free", modelUsed: body?.model ?? null, http: response.status, elapsedMs: Math.round(performance.now() - started), finishReason: body?.choices?.[0]?.finish_reason ?? null, content: body?.choices?.[0]?.message?.content ?? null };
}

async function gemma31b() {
  const started = performance.now();
  const response = await fetch("https://generativelanguage.googleapis.com/v1beta/models/gemma-4-31b-it:generateContent", {
    method: "POST", headers: { "x-goog-api-key": geminiKey, "Content-Type": "application/json" },
    body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: documentText }] }], generationConfig: { temperature: 0.2, maxOutputTokens: 1400 } }),
  });
  const body = await response.json();
  return { provider: "Google AI Studio", requestedModel: "gemma-4-31b-it", modelUsed: "gemma-4-31b-it", http: response.status, elapsedMs: Math.round(performance.now() - started), finishReason: body?.candidates?.[0]?.finishReason ?? null, content: body?.candidates?.[0]?.content?.parts?.map((part) => part?.text ?? "").join("") ?? null };
}

const results = [await deepSeekV4Pro(), await gemma31b()];
process.stdout.write(`${JSON.stringify({ checkedAt: new Date().toISOString(), parameters: { temperature: 0.2, maxTokens: 1400 }, results }, null, 2)}\n`);
