import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const capacity = vi.hoisted(() => ({
  beginCapacityGeneration: vi.fn(),
  settleCapacityReservation: vi.fn(),
}));
vi.mock("./capacity-controller", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./capacity-controller")>()),
  ...capacity,
}));

import { chatWithUserProviderStream, customUserProviderTarget, listUserProviderModels, publicUserProviderError, readyUserProvider, UserProviderError, UserProviderGuestNotAllowedError, UserProviderNotImplementedError, verifyUserProviderKey } from "./user-providers";
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
  return { ok: true, status: 200, body, json: async () => ({}), text: async () => "" } as unknown as Response;
}

function jsonResponse(status: number, payload: unknown) {
  return { ok: false, status, body: null, json: async () => payload, text: async () => JSON.stringify(payload) } as unknown as Response;
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
        { id: "live/one", name: "Live One", architecture: { modality: { input: "text" } } },
        { id: "live/two", name: "Live Two", architecture: { modality: { input: "text,image" } } },
      ] }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const models = await listUserProviderModels("openrouter", KEY);
    expect(models).toEqual([{ id: "live/one", name: "Live One" }, { id: "live/two", name: "Live Two" }]);
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe("https://openrouter.ai/api/v1/models");
  });

  it("filters out models that cannot accept text", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true, status: 200,
      json: async () => ({ data: [
        { id: "text/ok", name: "Text", architecture: { modality: { input: "text" } } },
        { id: "image/only", name: "Image", architecture: { modality: { input: "image" } } },
        { id: "no/modality", name: "Unknown" },
      ] }),
    }));
    const models = await listUserProviderModels("openrouter", KEY);
    expect(models.map((model) => model.id)).toEqual(["text/ok", "no/modality"]);
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
    expect(() => readyUserProvider("anthropic")).toThrow(UserProviderNotImplementedError);
    expect(() => readyUserProvider("openai")).toThrow(UserProviderNotImplementedError);
    expect(() => readyUserProvider("google")).toThrow(UserProviderNotImplementedError);
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
