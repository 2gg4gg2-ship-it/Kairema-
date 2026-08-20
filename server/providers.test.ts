import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./db", () => ({
  listProviderHealth: vi.fn().mockResolvedValue([]),
  upsertProviderHealth: vi.fn().mockResolvedValue(undefined),
  listRoleRuntimeStatus: vi.fn().mockResolvedValue([]),
  upsertRoleRuntimeStatus: vi.fn().mockResolvedValue(undefined),
  incrementProviderDailySuccess: vi.fn().mockResolvedValue(undefined),
  getProviderDailySuccess: vi.fn().mockResolvedValue(0),
}));

import { ATTEMPT_TIMEOUT_MS, DIAGNOSTIC_CANDIDATES, InvalidModelSelectionError, MODEL_CONFIG, MODEL_IDS, MODEL_ROLES, __resetProviderHealthForTests, buildOpenRouterMessages, chatWithRole, chatWithRoleStream, classifyOpenRouterFailure, createReasoningStreamFilter, dataFromSseBlock, getProviderHealthForTesting, isAllowedModelId, modelById, openRouterStreamDelta, publicChatError, statusFromChatPayload, statusLabel, stripReasoningBlocks, toPublicModelView, toRoleRuntimeView } from "./providers";

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  __resetProviderHealthForTests();
});

function success(content = "Готово") {
  return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200, headers: { "content-type": "application/json" } });
}

describe("Kairema v4 role registry", () => {
  it("declares exactly four always-visible public roles", () => {
    expect(MODEL_CONFIG).toHaveLength(4);
    expect(MODEL_CONFIG.map((role) => role.modelId)).toEqual(MODEL_IDS);
    expect(MODEL_CONFIG.map((role) => role.label)).toEqual([
      "Kairema Быстрый", "Kairema Смекалистый", "Kairema Контекст", "Kairema Флагман",
    ]);
    expect(modelById("code")).toBeUndefined();
  });

  it("keeps exactly four active candidates per role and the two inactive diagnostic candidates", () => {
    for (const role of MODEL_ROLES) {
      expect(role.chain).toHaveLength(4);
      expect(role.chain.every((candidate) => candidate.modelId !== role.modelId)).toBe(true);
      expect(role.chain.some((candidate) => candidate.modelId === "openrouter/free")).toBe(false);
    }
    expect(DIAGNOSTIC_CANDIDATES).toEqual([
      { provider: "openrouter", modelId: "openrouter/free", displayName: "OpenRouter Auto" },
      { provider: "orcarouter", modelId: "orcarouter/free", displayName: "OrcaRouter Auto" },
    ]);
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

  it("rejects any raw or unknown model ID before making a provider request", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    expect(isAllowedModelId("fast")).toBe(true);
    expect(isAllowedModelId("openai/gpt-oss-20b:free")).toBe(false);
    await expect(chatWithRole("openai/gpt-oss-20b:free", [{ role: "user", content: "Тест" }])).rejects.toBeInstanceOf(InvalidModelSelectionError);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("marks a quota-limited provider globally so another role skips it", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-openrouter-key");
    vi.stubEnv("ORCAROUTER_API_KEY", "");
    vi.stubEnv("GROQ_API_KEY", "test-groq-key");
    vi.stubEnv("GEMINI_API_KEY", "test-google-key");
    const fetchSpy = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: "quota exhausted" } }), { status: 429 }))
      .mockResolvedValueOnce(success("Резерв fast"))
      .mockResolvedValueOnce(success("Резерв context"));

    const fast = await chatWithRole("fast", [{ role: "user", content: "Первый" }]);
    const context = await chatWithRole("context", [{ role: "user", content: "Второй" }]);
    const health = await getProviderHealthForTesting();

    expect(fast).toMatchObject({ provider: "groq", fallbackUsed: true });
    expect(context).toMatchObject({ provider: "google", fallbackUsed: true });
    expect(fetchSpy).toHaveBeenCalledTimes(3);
    expect(String(fetchSpy.mock.calls[2]?.[0])).toContain("generativelanguage.googleapis.com");
    expect(health.find((item) => item.provider === "openrouter")).toMatchObject({ state: "unavailable", category: "QUOTA" });
  });

  it("globally skips OrcaRouter after its 429 and continues each later role with another provider", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-openrouter-key");
    vi.stubEnv("ORCAROUTER_API_KEY", "test-orcarouter-key");
    vi.stubEnv("GROQ_API_KEY", "test-groq-key");
    vi.stubEnv("GEMINI_API_KEY", "test-google-key");
    const fetchSpy = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: "unsupported model" } }), { status: 400 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: "rate limited" } }), { status: 429, headers: { "retry-after": "60" } }))
      .mockResolvedValueOnce(success("Резерв fast"))
      .mockResolvedValueOnce(success("Ответ context"));

    const fast = await chatWithRole("fast", [{ role: "user", content: "Первый" }]);
    const context = await chatWithRole("context", [{ role: "user", content: "Второй" }]);
    const orcaCalls = fetchSpy.mock.calls.filter(([url]) => String(url).includes("api.orcarouter.ai"));
    const health = await getProviderHealthForTesting();

    expect(fast).toMatchObject({ provider: "groq", fallbackUsed: true });
    expect(context).toMatchObject({ provider: "openrouter", fallbackUsed: false });
    expect(orcaCalls).toHaveLength(1);
    expect(fetchSpy).toHaveBeenCalledTimes(4);
    expect(health.find((item) => item.provider === "orcarouter")).toMatchObject({ state: "cooldown", category: "RATE_LIMIT" });
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

  it("never serializes provider chains or auth transport in public role views", () => {
    const view = toPublicModelView(MODEL_CONFIG[0]!, { state: "ready", badge: "Готов", category: null, http: 200, checkedAt: "2026-08-19T00:00:00.000Z", confirmed: "Проверено" });
    expect(Object.keys(view).sort()).toEqual(["key", "label", "modelId", "role", "runtime", "status"]);
    expect(view.runtime).toBeNull();
    expect(JSON.stringify(view)).not.toMatch(/chain|OPENROUTER_API_KEY|Authorization|Bearer/i);
  });

  it("publishes a safe runtime override after a real reserve answer", async () => {
    const runtime = toRoleRuntimeView("backup", "groq", "GPT-OSS 20B", new Date("2026-08-19T00:00:00.000Z"));

    expect(runtime).toEqual({ state: "backup", provider: "Groq", modelUsed: "GPT-OSS 20B", checkedAt: "2026-08-19T00:00:00.000Z" });
    expect(JSON.stringify(runtime)).not.toMatch(/openai\/gpt|openrouter\/|chain|Authorization|Bearer/i);
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
