import { MODEL_IDS, chatWithRole, publicChatError } from "../server/providers";

const prompts: Record<(typeof MODEL_IDS)[number], string> = {
  fast: "Кратко назови один полезный факт о безопасной работе с паролями.",
  smart: "Что такое закон Ома? Ответь одним предложением.",
  context: "Суммируй в двух предложениях: в команде важно фиксировать решения, уважать сроки и заранее сообщать о рисках.",
  flagship: "Назови один практический принцип проверки фактов перед публикацией ответа.",
};

const results = await Promise.all(MODEL_IDS.map(async (role) => {
  try {
    const result = await chatWithRole(role, [{ role: "user", content: prompts[role] }], { style: "concise" });
    return { role, http: 200, modelUsed: result.modelUsed, status: result.fallbackUsed ? "Резерв активен" : "Готов", provider: result.provider, chars: result.content.length };
  } catch (error) {
    return { role, http: 503, modelUsed: null, status: publicChatError(role, error), provider: null, chars: 0 };
  }
}));

console.log(JSON.stringify(results, null, 2));
