import { describe, expect, it } from "vitest";
import { MODEL_CONFIG, MODEL_IDS, buildOpenRouterMessages, classifyOpenRouterFailure, modelById, publicChatError, selectAutoModel, statusFromChatPayload, statusLabel, stripReasoningBlocks, toPublicModelView } from "./providers";

describe("OpenRouter model registry", () => {
  it("declares exactly five static cards independently of API responses", () => {
    expect(MODEL_CONFIG).toHaveLength(5);
    expect(MODEL_CONFIG.map((model) => model.modelId)).toEqual(MODEL_IDS);
    expect(MODEL_CONFIG.map((model) => model.label)).toEqual([
      "Kairema Ultra (Gemma 4)",
      "Kairema Code (North)",
      "Kairema Long-Context (Dots3)",
      "Kairema Express (GPT-OSS)",
      "Kairema Auto-Router",
    ]);
    expect(modelById("not-in-registry")).toBeUndefined();
  });

  it("uses catalog-confirmed live IDs for the corrected Gemma and North variants", () => {
    expect(MODEL_CONFIG[0]?.modelId).toBe("google/gemma-4-26b-a4b-it:free");
    expect(MODEL_CONFIG[1]?.modelId).toBe("cohere/north-mini-code:free");
  });

  it("maps every required status category to a human Russian status", () => {
    expect(statusLabel(null, "ready")).toBe("Готов");
    expect(statusLabel(null, "loading")).toBe("Проверка…");
    expect(statusLabel("QUOTA", "error")).toBe("Нет квоты (биллинг)");
    expect(statusLabel("RATE_LIMIT", "error")).toBe("Лимит запросов — восстановится");
    expect(statusLabel("AUTH", "error")).toBe("Ключ отклонён");
    expect(statusLabel("PROVIDER_UNAVAILABLE", "unavailable")).toBe("Временно недоступен");
    expect(statusLabel("MODEL", "error")).toBe("Неверная конфигурация провайдера");
  });

  it("classifies upstream evidence without guessing a reason", () => {
    expect(classifyOpenRouterFailure(401, { error: { message: "invalid api key" } }).category).toBe("AUTH");
    expect(classifyOpenRouterFailure(402, { error: { message: "no balance" } }).category).toBe("QUOTA");
    expect(classifyOpenRouterFailure(429, {}).category).toBe("RATE_LIMIT");
    expect(classifyOpenRouterFailure(429, { error: { message: "quota temporarily limited" } }).category).toBe("RATE_LIMIT");
    expect(classifyOpenRouterFailure(503, { error: { message: "high load" } }).category).toBe("PROVIDER_UNAVAILABLE");
    expect(classifyOpenRouterFailure(500, {}).confirmed).toBe("Причина пока не установлена.");
  });

  it("removes reasoning blocks before returning content to the browser", () => {
    expect(stripReasoningBlocks("<think>скрытая цепочка</think>Итог <reasoning>скрыто</reasoning>")).toBe("Итог");
  });

  it("marks a model ready only after a parsable non-empty chat response", () => {
    expect(statusFromChatPayload({ choices: [{ message: { content: "Готово" } }] }).state).toBe("ready");
    const broken = statusFromChatPayload({ choices: [{ message: { content: "<think>hidden</think>" } }] });
    expect(broken.category).toBe("PARSE");
    expect(broken.badge).toContain("Ошибка");
  });

  it("injects Kairema identity into every OpenRouter request", () => {
    for (const model of MODEL_CONFIG) {
      const payload = JSON.stringify(buildOpenRouterMessages(model, [{ role: "user", content: "Тест" }], { style: "steps" }));
      expect(payload).toContain("Ты Kairema, AI-ассистент.");
      expect(payload).toContain(model.label);
      expect(payload).toContain("Тест");
    }
  });

  it("makes Auto-Router choose the first ready direct model on the server", () => {
    const views = MODEL_CONFIG.map((model, index) => toPublicModelView(model, {
      state: index === 1 || index === 3 ? "ready" : "error",
      badge: index === 1 || index === 3 ? "Готов" : "Ошибка: UNKNOWN",
      category: index === 1 || index === 3 ? null : "UNKNOWN",
      http: 200,
      checkedAt: "2026-08-18T00:00:00.000Z",
      confirmed: "Тест",
    }));
    expect(selectAutoModel(views)?.modelId).toBe("cohere/north-mini-code:free");
  });

  it("does not expose any environment or transport fields through public model views", () => {
    const view = toPublicModelView(MODEL_CONFIG[0]!, { state: "ready", badge: "Готов", category: null, http: 200, checkedAt: "2026-08-18T00:00:00.000Z", confirmed: "Проверено" });
    expect(Object.keys(view).sort()).toEqual(["key", "label", "modelId", "role", "status"]);
    expect(JSON.stringify(view)).not.toMatch(/OPENROUTER_API_KEY|Authorization|Bearer/i);
  });

  it("returns a human-safe structured message without upstream JSON", () => {
    const message = publicChatError(MODEL_CONFIG[0]!.modelId, new Error("raw upstream json"));
    expect(message).toContain("Провайдер: OpenRouter");
    expect(message).not.toContain("raw upstream json");
  });
});
