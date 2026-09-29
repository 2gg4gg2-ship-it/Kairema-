import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const capacity = vi.hoisted(() => ({
  beginCapacityGeneration: vi.fn(),
  settleCapacityReservation: vi.fn(),
}));
vi.mock("./capacity-controller", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./capacity-controller")>()),
  ...capacity,
}));

import { openRouterStreamDelta } from "./providers";
import { chatWithUserProviderStream, customUserProviderTarget, listUserProviderModels, publicUserProviderError, readyUserProvider, sanitizeStreamDelta, UserProviderError, UserProviderGuestNotAllowedError, UserProviderNotImplementedError, verifyUserProviderKey } from "./user-providers";
import { UserProviderNotConfiguredError } from "./user-providers";

const KEY = "sk-or-v1-user-secret-1234";
const MODEL = "vendor/model-a";

function sse(chunks: string[]) {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  return { ok: true, status: 200, body, headers: new Headers({ "content-type": "text/event-stream" }), json: async () => ({}), text: async () => "" } as unknown as Response;
}

/** A provider that ignored "stream": true and answered with one JSON document. */
function wholeJsonResponse(payload: unknown, raw?: string) {
  return { ok: true, status: 200, body: null, headers: new Headers({ "content-type": "application/json" }), json: async () => payload, text: async () => raw ?? JSON.stringify(payload) } as unknown as Response;
}

function jsonResponse(status: number, payload: unknown) {
  return { ok: false, status, body: null, headers: new Headers({ "content-type": "application/json" }), json: async () => payload, text: async () => JSON.stringify(payload) } as unknown as Response;
}

let lease: { reserveAttempt: ReturnType<typeof vi.fn>; release: ReturnType<typeof vi.fn> };

beforeEach(() => {
  lease = { reserveAttempt: vi.fn().mockResolvedValue({ id: "r1" }), release: vi.fn() };
  capacity.beginCapacityGeneration.mockReset().mockResolvedValue(lease);
  capacity.settleCapacityReservation.mockReset().mockResolvedValue(undefined);
  vi.spyOn(console, "info").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("openrouter connection test", () => {
  it("uses the documented key endpoint and performs no inference", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ data: { label: "kairema-test" } }) });
    vi.stubGlobal("fetch", fetchMock);
    const result = await verifyUserProviderKey("openrouter", KEY);
    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://openrouter.ai/api/v1/key");
    expect(init.method).toBe("GET");
    expect(JSON.stringify(init)).not.toContain("chat/completions");
    expect(JSON.stringify(init)).not.toContain("model");
    // OpenRouter nests the key name under `data`, so the probe has to read it from there.
    expect(result.ok ? result.label : "").toBe("kairema-test");
  });

  it("reads a flat label too and never invents one when the provider sends none", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ label: "flat" }) }));
    expect(await verifyUserProviderKey("openrouter", KEY)).toEqual({ ok: true, label: "flat" });

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ data: {} }) }));
    expect(await verifyUserProviderKey("openrouter", KEY)).toEqual({ ok: true, label: "" });
  });

  it("classifies an invalid key without echoing any upstream payload", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(401, { error: { message: "Invalid API key", code: 401, meta: { token: "sk-or-v1-leaked" } } })));
    const result = await verifyUserProviderKey("openrouter", KEY);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.category).toBe("AUTH");
    expect(JSON.stringify(result)).not.toContain("sk-or-v1-leaked");
    expect(JSON.stringify(result)).not.toContain(KEY);
  });

  it("separates insufficient credits from a rate limit", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(402, { error: { message: "Insufficient credits" } })));
    const credits = await verifyUserProviderKey("openrouter", KEY);
    expect(credits.ok).toBe(false);
    if (credits.ok) throw new Error("unreachable");
    expect(credits.category).toBe("CREDITS");

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(429, { error: { message: "Rate limit exceeded" } })));
    const limited = await verifyUserProviderKey("openrouter", KEY);
    if (limited.ok) throw new Error("unreachable");
    expect(limited.category).toBe("RATE_LIMIT");
  });

  it("maps a network failure to a safe message", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED sk-or-v1-leaked")));
    const result = await verifyUserProviderKey("openrouter", KEY);
    if (result.ok) throw new Error("unreachable");
    expect(result.category).toBe("PROVIDER_UNAVAILABLE");
    expect(JSON.stringify(result)).not.toContain("sk-or-v1-leaked");
  });
});

describe("openrouter model catalog", () => {
  it("returns the provider's live catalog and contains no hardcoded models", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true, status: 200,
      json: async () => ({ data: [
        { id: "live/one", name: "Live One", architecture: { modality: "text->text", input_modalities: ["text"], output_modalities: ["text"] } },
        { id: "live/two", name: "Live Two", architecture: { modality: "text+image->text", input_modalities: ["text", "image"], output_modalities: ["text"] }, context_length: 8192 },
      ] }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const models = await listUserProviderModels("openrouter", KEY);
    expect(models).toEqual([
      { id: "live/one", name: "Live One", displayName: "Live One", isFree: false, acceptsImage: false, contextLength: null },
      { id: "live/two", name: "Live Two", displayName: "Live Two", isFree: false, acceptsImage: true, contextLength: 8192 },
    ]);
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe("https://openrouter.ai/api/v1/models");
  });

  it("drops specialized endpoints a chat turn cannot use, by their own declared modalities", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true, status: 200,
      json: async () => ({ data: [
        { id: "chat/ok", name: "Chat", architecture: { modality: "text->text", input_modalities: ["text"], output_modalities: ["text"] } },
        { id: "embed/vl", name: "Embed VL", architecture: { modality: "text+image->embeddings", input_modalities: ["text", "image"], output_modalities: ["embeddings"] } },
        { id: "rerank/vl", name: "Rerank VL", architecture: { modality: "text+image->rerank", input_modalities: ["text", "image"], output_modalities: ["rerank"] } },
        { id: "tts/flux", name: "Flux TTS", architecture: { modality: "text->speech", input_modalities: ["text"], output_modalities: ["speech"] } },
        { id: "safety/decisions", name: "Span", architecture: { modality: "text->decisions", input_modalities: ["text"], output_modalities: ["decisions"] } },
        { id: "audio/only", name: "Audio Only", architecture: { modality: "audio->audio", input_modalities: ["audio"], output_modalities: ["audio"] } },
      ] }),
    }));
    const models = await listUserProviderModels("openrouter", KEY);
    // Text in and text out is the whole contract: embedding, rerank, TTS, decision and audio-only
    // endpoints are out, and none of it is decided by reading a word of the model's name.
    expect(models.map((model) => model.id)).toEqual(["chat/ok"]);
  });

  it("keeps a catalog entry that declares no capabilities at all", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true, status: 200,
      json: async () => ({ data: [
        { id: "text/ok", name: "Text", architecture: { modality: "text->text" } },
        { id: "plain/one", name: "Plain One" },
      ] }),
    }));
    const models = await listUserProviderModels("openrouter", KEY);
    // Nothing is known about a bare OpenAI-compatible entry, so it is not ruled out.
    expect(models.map((model) => model.id)).toEqual(["text/ok", "plain/one"]);
  });

  it("reads free from the catalog's own pricing, not from a list of known models", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true, status: 200,
      json: async () => ({ data: [
        { id: "vendor/model-b", name: "B", architecture: { modality: "text->text" }, pricing: { prompt: "0.0000006", completion: "0.0000024" } },
        { id: "vendor/zero-priced", name: "Zero", architecture: { modality: "text->text" }, pricing: { prompt: "0", completion: "0" } },
        { id: "vendor/zero-priced-no-suffix", name: "Zero As Well", architecture: { modality: "text->text" }, pricing: { prompt: "0", completion: "0" } },
        { id: "vendor/sante:free", name: "Suffix", architecture: { modality: "text->text" } },
        { id: "vendor/free-in-the-name", name: "Free Model", architecture: { modality: "text->text" } },
        { id: "vendor/dynamic-router", name: "Router", architecture: { modality: "text->text" }, pricing: { prompt: "-1", completion: "-1" } },
      ] }),
    }));
    const models = await listUserProviderModels("openrouter", KEY);
    // Zero input and output pricing is the signal; a ":free" id is only the fallback for a
    // catalog that reports no pricing, a dynamic price is not free, and the word "free" in a
    // model name is not a signal at all.
    expect(models.map((model) => [model.id, model.isFree])).toEqual([
      ["vendor/model-b", false],
      ["vendor/zero-priced", true],
      ["vendor/zero-priced-no-suffix", true],
      ["vendor/sante:free", true],
      ["vendor/free-in-the-name", false],
      ["vendor/dynamic-router", false],
    ]);
  });

  it("shows a model without its author prefix while the real id is kept for the request", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true, status: 200,
      json: async () => ({ data: [
        { id: "nvidia/nemotron-3-ultra-550b-a55b", name: "NVIDIA: Nemotron 3 Ultra", architecture: { modality: "text->text" }, pricing: { prompt: "0.0000006", completion: "0.0000024" } },
        { id: "inclusionai/ling-3.0-flash-sante:free", name: "inclusionAI: Ling 3.0 Flash Sante (free)", architecture: { modality: "text->text" }, pricing: { prompt: "0", completion: "0" } },
        { id: "google/gemma-4-26b-a4b-it", name: "Google: Gemma 4 26B A4B ", architecture: { modality: "text+image+video->text" }, pricing: { prompt: "0.00000009", completion: "0.0000003" } },
        { id: "bare/id", architecture: { modality: "text->text" } },
      ] }),
    }));
    const models = await listUserProviderModels("openrouter", KEY);
    expect(models.map((model) => [model.id, model.displayName, model.isFree])).toEqual([
      ["nvidia/nemotron-3-ultra-550b-a55b", "Nemotron 3 Ultra", false],
      ["inclusionai/ling-3.0-flash-sante:free", "Ling 3.0 Flash Sante", true],
      ["google/gemma-4-26b-a4b-it", "Gemma 4 26B A4B", false],
      ["bare/id", "bare/id", false],
    ]);
    // The provider's own name is still available, so nothing about the upstream entry is lost.
    expect(models[0]!.name).toBe("NVIDIA: Nemotron 3 Ultra");
  });

  it("never returns the key it was given", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ data: [{ id: "a/b", name: "B" }] }) }));
    const models = await listUserProviderModels("openrouter", KEY);
    expect(JSON.stringify(models)).not.toContain(KEY);
  });

  it("surfaces a sanitized error when the catalog is refused", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(401, { error: { message: "Invalid API key sk-or-v1-leaked" } })));
    await expect(listUserProviderModels("openrouter", KEY)).rejects.toMatchObject({ category: "AUTH" });
    await listUserProviderModels("openrouter", KEY).catch((error: UserProviderError) => {
      expect(error.message).not.toContain("sk-or-v1-leaked");
      expect(error.message).not.toContain(KEY);
    });
  });
});

describe("provider availability", () => {
  it("exposes working endpoints only for an implemented provider", () => {
    const openrouter = readyUserProvider("openrouter");
    expect(openrouter.available).toBe(true);
    expect(openrouter.chatEndpoint).toContain("chat/completions");
  });

  it("refuses a provider whose adapter is not implemented, with no endpoint behind it", () => {
    // Anthropic is no longer in this group: it is reached from the browser, so the server has a
    // real endpoint for it. The providers that are still unimplemented must keep refusing.
    expect(() => readyUserProvider("openai")).toThrow(UserProviderNotImplementedError);
    expect(() => readyUserProvider("google")).toThrow(UserProviderNotImplementedError);
  });

  it("has a real endpoint for the providers it serves, and none for the ones it does not", () => {
    expect(readyUserProvider("openrouter").chatEndpoint).toMatch(/openrouter\.ai/);
    expect(readyUserProvider("anthropic").chatEndpoint).toMatch(/api\.anthropic\.com/);
  });

  it("refuses an unknown provider id", () => {
    expect(() => readyUserProvider("my-own-proxy")).toThrow(UserProviderError);
  });
});

describe("user provider streaming", () => {
  const actor = { userId: 7, requestKey: "k" };

  it("streams from the user's model and never calls a system provider", async () => {
    const fetchMock = vi.fn().mockResolvedValue(sse([
      `data: ${JSON.stringify({ choices: [{ delta: { content: "При" } }] })}\n\n`,
      `data: ${JSON.stringify({ choices: [{ delta: { content: "вет" } }] })}\n\n`,
      "data: [DONE]\n\n",
    ]));
    vi.stubGlobal("fetch", fetchMock);
    const deltas: string[] = [];
    const result = await chatWithUserProviderStream({ provider: "openrouter", model: MODEL, modelLabel: "Моя модель", apiKey: KEY, history: [{ role: "user", content: "Привет" }], roleId: "fast", onDelta: (delta) => deltas.push(delta), actor });
    expect(deltas).toEqual(["При", "вет"]);
    expect(result.content).toBe("Привет");
    expect(result.modelUsed).toBe("Моя модель");
    expect(result.fallbackUsed).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  // A provider streams tokens, not words: the space between two words usually arrives as the
  // first character of the next delta. Trimming each delta on its own published "Helloworldhowareyou?",
  // which is why the user's own model looked like it had lost its spacing.
  async function streamChunks(chunks: string[]) {
    const frames = [...chunks.map((chunk) => `data: ${JSON.stringify({ choices: [{ delta: { content: chunk } }] })}\n\n`), "data: [DONE]\n\n"];
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(sse(frames)));
    const deltas: string[] = [];
    const result = await chatWithUserProviderStream({ provider: "openrouter", model: MODEL, modelLabel: "L", apiKey: KEY, history: [{ role: "user", content: "hi" }], roleId: "fast", onDelta: (delta) => deltas.push(delta), actor });
    return { content: result.content, deltas };
  }

  it("keeps the spaces the provider sent between word deltas", async () => {
    const { content, deltas } = await streamChunks(["Hello", " world", " how", " are", " you?"]);
    expect(content).toBe("Hello world how are you?");
    // The browser receives the same spacing, so the answer is identical live and after reload.
    expect(deltas.join("")).toBe("Hello world how are you?");
  });

  it("keeps punctuation attached to the word it follows", async () => {
    const { content } = await streamChunks(["Hello", " world", "!"]);
    expect(content).toBe("Hello world!");
  });

  it("does not invent a space the provider never sent", async () => {
    // The raw stream really is two glued fragments. Adding a separator here would fabricate text,
    // so the answer stays exactly what the provider produced.
    const { content } = await streamChunks(["Hello", "world"]);
    expect(content).toBe("Helloworld");
  });

  it("preserves newlines a streamed answer is broken by", async () => {
    expect((await streamChunks(["one\ntwo", "\nthree"])).content).toBe("one\ntwo\nthree");
    expect((await streamChunks(["a\n", "b\n", "c"])).content).toBe("a\nb\nc");
  });

  it("keeps indentation inside a fenced block", async () => {
    const { content } = await streamChunks(["```\n", "  const a = 1;", "\n", "```"]);
    expect(content).toContain("  const a = 1;");
  });

  it("sends the Kairema context, the whole conversation and the user's own settings", async () => {
    const fetchMock = vi.fn().mockResolvedValue(sse([`data: ${JSON.stringify({ choices: [{ delta: { content: "ok" } }] })}\n\n`, "data: [DONE]\n\n"]));
    vi.stubGlobal("fetch", fetchMock);
    await chatWithUserProviderStream({
      provider: "openrouter", model: MODEL, modelLabel: "Моя модель", apiKey: KEY,
      history: [{ role: "user", content: "первый" }, { role: "assistant", content: "ответ" }, { role: "user", content: "второй" }],
      settings: { style: "professional", responseLength: "detailed", effort: "high", thinking: true, askClarifyingQuestions: true } as never,
      roleId: "fast", onDelta: () => undefined, actor,
    });
    const body = JSON.parse(String(fetchMock.mock.calls[0]![1]!.body)) as { messages: Array<{ role: string; content: unknown }> };
    // The system prompt comes first, then the conversation in order with its real roles, so the
    // user's own model sees the same dialogue the user sees.
    expect(body.messages.map((message) => message.role)).toEqual(["system", "user", "assistant", "user"]);
    expect(body.messages.slice(1).map((message) => message.content)).toEqual(["первый", "ответ", "второй"]);
    const system = body.messages[0]!.content as string;
    expect(system).toContain("Моя модель");
    // The settings the user picked in the interface reach their model; ignoring them is what made
    // a detailed or professional request look like it had been dropped.
    expect(system).toContain("Сохраняй профессиональный, ясный тон.");
    expect(system).toContain("Дай подробный, хорошо структурированный ответ.");
    expect(system).toContain("задай один уточняющий вопрос");
    // Nothing tells the model it is user-provided: it is only told who it is and how to answer.
    expect(system.toLowerCase()).not.toContain("пользовательск");
    expect(system.toLowerCase()).not.toContain("byok");
  });

  it("keeps the Kairema system prompt usable when no settings were changed", async () => {
    const fetchMock = vi.fn().mockResolvedValue(sse([`data: ${JSON.stringify({ choices: [{ delta: { content: "ok" } }] })}\n\n`, "data: [DONE]\n\n"]));
    vi.stubGlobal("fetch", fetchMock);
    await chatWithUserProviderStream({ provider: "openrouter", model: MODEL, modelLabel: "L", apiKey: KEY, history: [{ role: "user", content: "hi" }], roleId: "fast", onDelta: () => undefined, actor });
    const body = JSON.parse(String(fetchMock.mock.calls[0]![1]!.body)) as { messages: Array<{ content: unknown }> };
    const system = body.messages[0]!.content as string;
    expect(system.startsWith("Ты Kairema")).toBe(true);
    expect(system).toContain("Сохраняй сбалансированную длину ответа.");
  });

  it("sends exactly one request for one user turn and performs no retry", async () => {
    const fetchMock = vi.fn().mockResolvedValue(sse([`data: ${JSON.stringify({ choices: [{ delta: { content: "ok" } }] })}\n\n`, "data: [DONE]\n\n"]));
    vi.stubGlobal("fetch", fetchMock);
    await chatWithUserProviderStream({ provider: "openrouter", model: MODEL, modelLabel: "L", apiKey: KEY, history: [{ role: "user", content: "hi" }], roleId: "fast", onDelta: () => undefined, actor });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not fall back to a system provider when the user's provider fails", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(401, { error: { message: "Invalid API key" } }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(chatWithUserProviderStream({ provider: "openrouter", model: MODEL, modelLabel: "L", apiKey: KEY, history: [{ role: "user", content: "hi" }], roleId: "fast", onDelta: () => undefined, actor })).rejects.toBeInstanceOf(UserProviderError);
    // One attempt only: a failure never becomes a second, differently-billed request.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("never puts the key in a request body, a log line or a returned error", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(400, { error: { message: "bad request", headers: { authorization: `Bearer ${KEY}` } } }));
    vi.stubGlobal("fetch", fetchMock);
    const logs: string[] = [];
    vi.spyOn(console, "info").mockImplementation((...args: unknown[]) => { logs.push(args.map(String).join(" ")); });
    await chatWithUserProviderStream({ provider: "openrouter", model: MODEL, modelLabel: "L", apiKey: KEY, history: [{ role: "user", content: "hi" }], roleId: "fast", onDelta: () => undefined, actor }).catch((error: UserProviderError) => {
      expect(error.message).not.toContain(KEY);
    });
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(String(init.body)).not.toContain(KEY);
    expect(logs.join("\n")).not.toContain(KEY);
  });

  it("goes through the capacity controller and reserves the real upstream provider", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(sse([`data: ${JSON.stringify({ choices: [{ delta: { content: "ok" } }] })}\n\n`, "data: [DONE]\n\n"])));
    await chatWithUserProviderStream({ provider: "openrouter", model: MODEL, modelLabel: "L", apiKey: KEY, history: [{ role: "user", content: "hi" }], roleId: "fast", onDelta: () => undefined, actor });
    expect(capacity.beginCapacityGeneration).toHaveBeenCalledTimes(1);
    expect(lease.reserveAttempt).toHaveBeenCalledTimes(1);
    expect(lease.reserveAttempt).toHaveBeenCalledWith({ provider: "openrouter", modelId: MODEL }, 1);
    expect(capacity.settleCapacityReservation).toHaveBeenCalledTimes(1);
    expect(lease.release).toHaveBeenCalledTimes(1);
  });

  it("releases the lease and makes no fetch when admission is denied", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    lease.reserveAttempt.mockRejectedValue(new Error("capacity admission denied"));
    await expect(chatWithUserProviderStream({ provider: "openrouter", model: MODEL, modelLabel: "L", apiKey: KEY, history: [{ role: "user", content: "hi" }], roleId: "fast", onDelta: () => undefined, actor })).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(lease.release).toHaveBeenCalledTimes(1);
  });

  it("does not open a capacity lease when no actor is supplied", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(sse([`data: ${JSON.stringify({ choices: [{ delta: { content: "ok" } }] })}\n\n`, "data: [DONE]\n\n"])));
    await chatWithUserProviderStream({ provider: "openrouter", model: MODEL, modelLabel: "L", apiKey: KEY, history: [{ role: "user", content: "hi" }], roleId: "fast", onDelta: () => undefined });
    expect(capacity.beginCapacityGeneration).not.toHaveBeenCalled();
  });

  it("does not send the key to the chat prompt", async () => {
    const fetchMock = vi.fn().mockResolvedValue(sse([`data: ${JSON.stringify({ choices: [{ delta: { content: "ok" } }] })}\n\n`, "data: [DONE]\n\n"]));
    vi.stubGlobal("fetch", fetchMock);
    await chatWithUserProviderStream({ provider: "openrouter", model: MODEL, modelLabel: "L", apiKey: KEY, history: [{ role: "user", content: "hi" }], roleId: "fast", onDelta: () => undefined, actor });
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(init.body)) as { messages: Array<{ content: unknown }> };
    expect(JSON.stringify(body.messages)).not.toContain(KEY);
  });
});

describe("upstream body never reaches the user", () => {
  // A provider is free to echo credentials back in an error; none of it may survive.
  const LEAK = "sk-or-v1-leaked";
  const hostileBody = {
    error: {
      message: `Invalid request. Authorization: Bearer ${LEAK}`,
      code: 400,
      metadata: { api_key: LEAK, upstream_token: LEAK, headers: { authorization: `Bearer ${LEAK}`, "x-api-key": LEAK } },
      url: `https://openrouter.ai/api/v1/chat/completions?key=${LEAK}`,
    },
  };

  it("keeps a leaked credential out of the connection-test verdict and its log", async () => {
    const logs: string[] = [];
    vi.spyOn(console, "info").mockImplementation((...args: unknown[]) => { logs.push(args.map(String).join(" ")); });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(400, hostileBody)));
    const result = await verifyUserProviderKey("openrouter", KEY);
    expect(result.ok).toBe(false);
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(LEAK);
    expect(serialized).not.toContain(KEY);
    expect(logs.join("\n")).not.toContain(LEAK);
  });

  it("keeps a leaked credential out of the catalog error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(500, hostileBody)));
    await listUserProviderModels("openrouter", KEY).catch((error: UserProviderError) => {
      expect(error.message).not.toContain(LEAK);
      expect(error.message).not.toContain("Bearer");
      expect(error.message).not.toContain("http");
    });
  });

  it("keeps a leaked credential out of the streaming error", async () => {
    const logs: string[] = [];
    vi.spyOn(console, "info").mockImplementation((...args: unknown[]) => { logs.push(args.map(String).join(" ")); });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(401, hostileBody)));
    await chatWithUserProviderStream({ provider: "openrouter", model: MODEL, modelLabel: "L", apiKey: KEY, history: [{ role: "user", content: "hi" }], roleId: "fast", onDelta: () => undefined, actor: { userId: 1, requestKey: "k" } }).catch((error: UserProviderError) => {
      const text = publicUserProviderError(error);
      expect(text).not.toContain(LEAK);
      expect(text).not.toContain(KEY);
      expect(text).not.toContain(hostileBody.error.url);
    });
    expect(logs.join("\n")).not.toContain(LEAK);
  });

  it("maps every upstream 5xx to a provider availability problem", async () => {
    for (const status of [500, 502, 503, 504, 599]) {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(status, hostileBody)));
      const result = await verifyUserProviderKey("openrouter", KEY);
      if (result.ok) throw new Error(`expected ${status} to fail`);
      expect(result.category).toBe("PROVIDER_UNAVAILABLE");
    }
  });
});

describe("public error text", () => {  it("explains a missing configuration instead of blaming the provider", () => {
    const text = publicUserProviderError(new UserProviderNotConfiguredError());
    expect(text).toContain("не настроен");
    expect(text).not.toMatch(/null|undefined/);
  });

  it("explains that a guest session cannot use My API", () => {
    expect(publicUserProviderError(new UserProviderGuestNotAllowedError())).toContain("гостев");
  });

  it("uses only the sanitized message of a provider error", () => {
    const text = publicUserProviderError(new UserProviderError("CREDITS", "На счёте провайдера недостаточно средств.", 402));
    expect(text).toContain("недостаточно средств");
    // The public status vocabulary stays the platform's; the credit case maps onto QUOTA.
    expect(text).toContain("QUOTA");
  });

  it("never leaks a raw provider body for an unclassified error", () => {
    const text = publicUserProviderError(new Error("upstream said: {\"api_key\":\"sk-or-v1-leaked\"}"));
    expect(text).not.toContain("sk-or-v1-leaked");
  });
});

describe("answer label for a user-defined provider", () => {
  it("UX-2: is attributed to the provider's own name, not to the built-in one", async () => {
    const fetchMock = vi.fn().mockResolvedValue(sse([`data: ${JSON.stringify({ choices: [{ delta: { content: "вет" } }] })}\n\n`, "data: [DONE]\n\n"]));
    vi.stubGlobal("fetch", fetchMock);
    const target = customUserProviderTarget({ id: "custom-abc123", displayName: "Мой провайдер", baseUrl: "https://api.example.com/v1" });
    const actor = { userId: 7, requestKey: "k" };
    const result = await chatWithUserProviderStream({
      provider: target,
      model: "vendor/model-b",
      modelLabel: "vendor/model-b",
      apiKey: "sk-custom-9999",
      history: [{ role: "user", content: "Привет" }],
      roleId: "flagship",
      onDelta: () => undefined,
      actor,
    });
    // The request still went to the user's own endpoint, not to a built-in provider.
    expect(fetchMock.mock.calls[0]![0]).toBe("https://api.example.com/v1/chat/completions");
    expect(result.label).toBe("Мой провайдер · vendor/model-b");
    expect(result.modelUsed).toBe("vendor/model-b");
    expect(result.fallbackUsed).toBe(false);
  });
});

describe("streamed delta sanitizing keeps the provider's spacing", () => {
  it("passes a delta whose whitespace is the separator through untouched", () => {
    expect(sanitizeStreamDelta(" world")).toBe(" world");
    expect(sanitizeStreamDelta(" how")).toBe(" how");
    expect(sanitizeStreamDelta(" ")).toBe(" ");
    expect(sanitizeStreamDelta("\n")).toBe("\n");
  });

  it("never inserts a space of its own", () => {
    expect(sanitizeStreamDelta("Hello")).toBe("Hello");
    expect(sanitizeStreamDelta("world")).toBe("world");
    expect(sanitizeStreamDelta("")).toBe("");
  });

  it("still strips the citation markers the sanitizer exists for", () => {
    // The reference is removed; the space that separated it from the word before it is the
    // chunk's own trailing whitespace, so it is the provider's to have sent and is kept.
    expect(sanitizeStreamDelta("text [source](https://example.com)")).toBe("text");
    expect(sanitizeStreamDelta(" [1]")).toBe(" [1]");
    expect(sanitizeStreamDelta("https://example.com/a")).toBe("");
  });
});

describe("the answer a user provider actually returned", () => {
  const ask = async (response: unknown) => {
    const deltas: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (...a: unknown[]) => { const r = await (response as { json: () => Promise<unknown> }).json(); console.log("STATUS_SEEN", (response as {status:number}).status, JSON.stringify(r).slice(0,60)); return response; }));
    const result = await chatWithUserProviderStream({
      provider: "openrouter",
      model: MODEL,
      modelLabel: "Моя модель",
      apiKey: KEY,
      history: [{ role: "user", content: "Привет" }],
      roleId: "fast",
      onDelta: (delta) => deltas.push(delta),
    });
    return { result, deltas, joined: deltas.join("") };
  };

  const frame = (payload: unknown) => `data: ${JSON.stringify(payload)}\n\n`;

  it("reads a plain string delta", async () => {
    const { result } = await ask(sse([frame({ choices: [{ delta: { content: "Hello" } }] }), frame({ choices: [{ delta: { content: " world" } }] }), "data: [DONE]\n\n"]));
    expect(result.content).toBe("Hello world");
  });

  it("reads an array of content parts", async () => {
    const { result } = await ask(sse([frame({ choices: [{ delta: { content: [{ type: "text", text: "Hello" }] } }] }), frame({ choices: [{ delta: { content: [{ type: "text", text: " world" }] } }] }), "data: [DONE]\n\n"]));
    expect(result.content).toBe("Hello world");
  });

  it("reads the whole array when a frame carries every part at once", async () => {
    const { result } = await ask(sse([frame({ choices: [{ delta: { content: [{ type: "text", text: "A" }, { type: "text", text: "B" }] } }] }), "data: [DONE]\n\n"]));
    expect(result.content).toBe("AB");
  });

  it("reads a non-stream JSON answer whose content is a string", async () => {
    const { result } = await ask(wholeJsonResponse({ choices: [{ message: { content: "Whole answer" } }] }));
    expect(result.content).toBe("Whole answer");
  });

  it("reads a non-stream JSON answer whose content is an array of parts", async () => {
    const { result } = await ask(wholeJsonResponse({ message: { content: [{ type: "text", text: "Part one " }, { type: "text", text: "part two" }] } }));
    expect(result.content).toBe("Part one part two");
  });

  it("reads a pretty-printed non-stream answer that spans several lines", async () => {
    // Without the content-type branch this document is split at every blank line and each fragment
    // fails to parse, which the user sees as "the provider returned an empty answer".
    const pretty = `{\n  "choices": [\n    {\n      "message": {\n        "content": "Pretty printed"\n      }\n    }\n  ]\n}`;
    const { result } = await ask(wholeJsonResponse({ choices: [{ message: { content: "Pretty printed" } }] }, pretty));
    expect(result.content).toBe("Pretty printed");
  });

  it("reads the legacy choices[0].text field", async () => {
    const { result } = await ask(sse([frame({ choices: [{ text: "Legacy" }] }), "data: [DONE]\n\n"]));
    expect(result.content).toBe("Legacy");
  });

  it("still reads a stream that arrived labelled as JSON", async () => {
    const mislabelled = sse([frame({ choices: [{ delta: { content: "SSE body" } }] }), "data: [DONE]\n\n"]);
    (mislabelled as { headers: Headers }).headers = new Headers({ "content-type": "application/json" });
    const { result } = await ask(mislabelled);
    expect(result.content).toBe("SSE body");
  });

  it("never publishes the reasoning channel as answer text", async () => {
    const { result, joined } = await ask(sse([frame({ choices: [{ delta: { reasoning: "internal chain of thought" } }] }), frame({ choices: [{ delta: { content: "answer" } }] }), frame({ choices: [{ delta: { reasoning_content: "more private text" } }] }), "data: [DONE]\n\n"]));
    expect(joined).toBe("answer");
    expect(result.content).toBe("answer");
    expect(result.content).not.toContain("chain of thought");
  });

  it("ignores non-text content parts", async () => {
    const { result } = await ask(sse([frame({ choices: [{ delta: { content: [{ type: "image", text: "not prose" }, { type: "text", text: "kept" }] } }] }), "data: [DONE]\n\n"]));
    expect(result.content).toBe("kept");
  });

  it("preserves the spacing between chunks instead of welding them together", async () => {
    const { deltas, joined } = await ask(sse([frame({ choices: [{ delta: { content: "Hello" } }] }), frame({ choices: [{ delta: { content: " world" } }] }), frame({ choices: [{ delta: { content: " how" } }] }), frame({ choices: [{ delta: { content: " are you?" } }] }), "data: [DONE]\n\n"]));
    expect(joined).toBe("Hello world how are you?");
    expect(deltas.every((delta) => delta.length > 0)).toBe(true);
  });

  it("reassembles a frame split across two reads", async () => {
    const whole = frame({ choices: [{ delta: { content: "Split frame" } }] });
    const { result } = await ask(sse([whole.slice(0, 12), whole.slice(12), "data: [DONE]\n\n"]));
    expect(result.content).toBe("Split frame");
  });

  it("handles CRLF frames, keep-alive comments and a missing final terminator", async () => {
    const { result } = await ask(sse([": keep-alive\r\n\r\n", frame({ choices: [{ delta: { content: "CRLF" } }] }).replace(/\n/g, "\r\n"), "data: [DONE]\r\n\r\n", frame({ choices: [{ delta: { content: " tail" } }] }).replace(/\n/g, "\r\n")]));
    expect(result.content).toBe("CRLF tail");
  });

  it("reports an empty answer as an error rather than returning nothing", async () => {
    await expect(ask(sse([frame({ choices: [{ delta: { content: "" } }] }), "data: [DONE]\n\n"]))).rejects.toThrow(/пустой ответ/i);
    await expect(ask(wholeJsonResponse({ choices: [{ message: { content: "" } }] }))).rejects.toThrow(/пустой ответ/i);
  });

  it("keeps a markdown table intact across streamed parts", async () => {
    const { result } = await ask(sse([frame({ choices: [{ delta: { content: "| a | b |\n| --- | --- |\n" } }] }), frame({ choices: [{ delta: { content: "| 1 | 2 |" } }] }), "data: [DONE]\n\n"]));
    expect(result.content).toContain("| a | b |");
    expect(result.content).toContain("| 1 | 2 |");
  });

  it("attributes the answer to the configured model and never falls back to a system provider", async () => {
    const { result } = await ask(sse([frame({ choices: [{ delta: { content: "Answer" } }] }), "data: [DONE]\n\n"]));
    expect(result.label).toBe("Моя модель");
    expect(result.fallbackUsed).toBe(false);
    expect(result.provider).toBe("openrouter");
  });

  it.each([
    [400, "Провайдер отклонил запрос"],
    [401, "Провайдер отклонил API-ключ"],
    [429, "Ваш провайдер ограничил частоту запросов по вашему API-ключу"],
    [500, "Провайдер временно недоступен"],
  ])("surfaces HTTP %i as its own actionable message instead of an empty answer", async (status, expected) => {
    const failure = await ask(jsonResponse(status, { error: { message: `raw upstream detail for ${status}` } })).catch((error: Error) => error);
    expect(failure).toBeInstanceOf(UserProviderError);
    expect((failure as Error).message).toContain(expected);
    // The upstream payload is the provider's to show its operator, not the user's to debug with.
    expect((failure as Error).message).not.toContain("raw upstream detail");
    expect((failure as Error).stack).not.toContain("raw upstream detail");
  });

  it("gives each HTTP status a different message so the user knows what to change", async () => {
    const messageFor = async (status: number) => (await ask(jsonResponse(status, { error: { message: "x" } })).catch((error: Error) => error)) as Error;
    // Sequential on purpose: each ask installs its own fetch stub, so running them together would
    // let the last one win and every call would be answered with the same response.
    const messages: Error[] = [];
    for (const status of [400, 401, 429, 500]) messages.push(await messageFor(status));
    console.log("MSGS", JSON.stringify(messages.map((e) => e.message), null, 1));
    expect(new Set(messages.map((error) => error.message)).size).toBe(4);
  });
});

describe("openRouterStreamDelta frame shapes", () => {
  it("returns the visible text of every supported shape", () => {
    expect(openRouterStreamDelta({ choices: [{ delta: { content: "a" } }] })).toBe("a");
    expect(openRouterStreamDelta({ delta: { text: "b" } })).toBe("b");
    expect(openRouterStreamDelta({ message: { content: "c" } })).toBe("c");
    expect(openRouterStreamDelta({ choices: [{ text: "d" }] })).toBe("d");
    expect(openRouterStreamDelta({ content: [{ type: "text", text: "e" }] })).toBe("e");
  });

  it("returns an empty string for a frame with nothing visible", () => {
    expect(openRouterStreamDelta({})).toBe("");
    expect(openRouterStreamDelta(null)).toBe("");
    expect(openRouterStreamDelta({ choices: [{ delta: { content: null } }] })).toBe("");
  });
});
