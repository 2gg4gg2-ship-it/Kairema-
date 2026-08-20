const key = process.env.GEMINI_API_KEY;
if (!key) throw new Error("GEMINI_API_KEY is unavailable.");
const fixedDocument = `Ниже приведён небольшой русский документ. Переведи его на английский, сохрани термины в кавычках, структуру и смысл. После перевода отдельной строкой объясни, почему «контекстное окно» важно для анализа длинных документов.

«Контекстное окно» определяет объём информации, который модель учитывает за один запрос. В договоре нельзя смешивать «срок действия» и «срок исполнения»: первое описывает период действия соглашения, второе — дедлайн конкретной обязанности.`;
const started = performance.now();
const response = await fetch("https://generativelanguage.googleapis.com/v1beta/models/gemma-4-31b-it:generateContent", {
  method: "POST",
  headers: { "x-goog-api-key": key, "Content-Type": "application/json" },
  body: JSON.stringify({
    contents: [{ role: "user", parts: [{ text: fixedDocument }] }],
    generationConfig: { temperature: 0.2, maxOutputTokens: 1400 },
  }),
});
const elapsedMs = Math.round(performance.now() - started);
let body = null;
try { body = await response.json(); } catch { body = null; }
const content = body?.candidates?.[0]?.content?.parts?.map((part) => part?.text ?? "").join("");
process.stdout.write(`${JSON.stringify({
  checkedAt: new Date().toISOString(),
  provider: "Google AI Studio",
  requestedModel: "gemma-4-31b-it",
  http: response.status,
  elapsedMs,
  contentCharacters: typeof content === "string" ? content.length : 0,
  preview: typeof content === "string" ? content.replace(/\s+/g, " ").slice(0, 240) : null,
  finishReason: body?.candidates?.[0]?.finishReason ?? null,
}, null, 2)}\n`);
