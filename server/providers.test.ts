import { afterEach, describe, expect, it, vi } from "vitest";
import { ATTEMPT_TIMEOUT_MS, MODEL_CONFIG, MODEL_IDS, MODEL_ROLES, buildOpenRouterMessages, chatWithRoleStream, classifyOpenRouterFailure, createReasoningStreamFilter, dataFromSseBlock, modelById, openRouterStreamDelta, publicChatError, selectAutoModel, statusFromChatPayload, statusLabel, stripReasoningBlocks, toPublicModelView } from "./providers";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("Kairema v3 role registry", () => {
  it("declares exactly five always-visible roles", () => {
    expect(MODEL_CONFIG).toHaveLength(5);
    expect(MODEL_CONFIG.map((role) => role.modelId)).toEqual(MODEL_IDS);
    expect(MODEL_CONFIG.map((role) => role.label)).toEqual([
      "Kairema Быстрый", "Kairema Смекалистый", "Kairema Контекст", "Kairema Флагман", "Kairema Код",
    ]);
    expect(modelById("not-in-registry")).toBeUndefined();
  });

  it("keeps raw provider IDs inside server-only chains and limits each chain to four attempts", () => {
    for (const role of MODEL_ROLES) {
      expect(role.chain.length).toBeGreaterThan(1);
      expect(role.chain.length).toBeLessThanOrEqual(4);
      expect(role.chain.every((candidate) => candidate.modelId !== role.modelId)).toBe(true);
    }
    expect(MODEL_ROLES.find((role) => role.key === "fast")?.chain[0]?.provider).toBe("groq");
    expect(MODEL_ROLES.find((role) => role.key === "smart")?.chain[0]?.provider).toBe("google");
  });

  it("uses a 25-second budget for every provider attempt", () => {
    expect(ATTEMPT_TIMEOUT_MS).toBe(25_000);
  });

  it("maps role health into the fixed Russian badge set", () => {
    expect(statusLabel(null, "ready")).toBe("Готов");
    expect(statusLabel(null, "fallback")).toBe("Резерв активен");
    expect(statusLabel(null, "not_configured")).toBe("Не настроено");
    expect(statusLabel("RATE_LIMIT", "error")).toBe("Недоступно");
    expect(statusLabel("PROVIDER_UNAVAILABLE", "unavailable")).toBe("Недоступно");
  });

  it("classifies retry-worthy errors without exposing provider response bodies", () => {
    expect(classifyOpenRouterFailure(401, { error: { message: "invalid api key" } }).category).toBe("AUTH");
    expect(classifyOpenRouterFailure(429, { error: { message: "quota exhausted" } }).category).toBe("QUOTA");
    expect(classifyOpenRouterFailure(429, {}).category).toBe("RATE_LIMIT");
    expect(classifyOpenRouterFailure(503, { error: { message: "high load" } }).category).toBe("PROVIDER_UNAVAILABLE");
  });

  it("removes reasoning blocks before any response reaches the browser", () => {
    expect(stripReasoningBlocks("<think>скрытая цепочка</think>Итог <reasoning>скрыто</reasoning>")).toBe("Итог");
    expect(statusFromChatPayload({ choices: [{ message: { content: "<think>hidden</think>" } }] }).state).toBe("error");
  });

  it("injects the Kairema identity and selected role into all provider payloads", () => {
    for (const role of MODEL_CONFIG) {
      const payload = JSON.stringify(buildOpenRouterMessages(role, [{ role: "user", content: "Тест" }], { style: "steps" }));
      expect(payload).toContain("Ты Kairema, AI-ассистент.");
      expect(payload).toContain(role.label);
      expect(payload).toContain("Тест");
    }
  });

  it("selects the first ready role for automatic routing", () => {
    const views = MODEL_CONFIG.map((role, index) => toPublicModelView(role, {
      state: index === 1 || index === 3 ? "ready" : "error",
      badge: index === 1 || index === 3 ? "Готов" : "Недоступно",
      category: index === 1 || index === 3 ? null : "UNKNOWN",
      http: 200, checkedAt: "2026-08-19T00:00:00.000Z", confirmed: "Тест",
    }));
    expect(selectAutoModel(views)?.modelId).toBe("smart");
  });

  it("never serializes provider chains or auth transport in public role views", () => {
    const view = toPublicModelView(MODEL_CONFIG[0]!, { state: "ready", badge: "Готов", category: null, http: 200, checkedAt: "2026-08-19T00:00:00.000Z", confirmed: "Проверено" });
    expect(Object.keys(view).sort()).toEqual(["key", "label", "modelId", "role", "status"]);
    expect(JSON.stringify(view)).not.toMatch(/chain|OPENROUTER_API_KEY|Authorization|Bearer/i);
  });

  it("returns a human-safe error contract", () => {
    const message = publicChatError("fast", new Error("raw upstream json"));
    expect(message).toContain("Что произошло:");
    expect(message).not.toContain("raw upstream json");
  });

  it("parses SSE deltas and removes fragmented thinking sections", () => {
    const data = dataFromSseBlock("event: message\ndata: {\"choices\":[{\"delta\":{\"content\":\"Привет\"}}]}\n\n");
    expect(openRouterStreamDelta(JSON.parse(data))).toBe("Привет");
    const filter = createReasoningStreamFilter();
    expect(filter("Начало <thi")).toBe("Начало ");
    expect(filter("nk>скрыто")).toBe("");
    expect(filter("</think>Итог")).toBe("Итог");
  });

  it("does not mix answers by falling back after a visible stream delta", async () => {
    vi.stubEnv("GROQ_API_KEY", "test-groq-key");
    vi.stubEnv("OPENROUTER_API_KEY", "test-openrouter-key");
    const encoder = new TextEncoder();
    let pulls = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls += 1;
        if (pulls === 1) controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"Начало"}}]}\n\n'));
        else controller.error(new Error("upstream interrupted"));
      },
    });
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(body, { status: 200 }));

    await expect(chatWithRoleStream("fast", [{ role: "user", content: "Тест" }], undefined, vi.fn())).rejects.toThrow("upstream interrupted");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});
