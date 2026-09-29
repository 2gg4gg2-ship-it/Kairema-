// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { clearDirectKey, clearDirectKeys, getDirectKey, hasDirectKey, setDirectKey } from "./direct-key-store";
import { buildCandidateChain, runMyApiTurn, ProviderUnavailableError, type TurnCandidate } from "./my-api-turn";
import { MAX_ATTEMPTS_PER_PROVIDER, MAX_TOTAL_ATTEMPTS } from "@shared/upstream-retry";
import { resolveExecution, usesDirectExecution, providerCapability } from "@shared/provider-capabilities";
import { PROVIDER_RATE_LIMIT, KAIREMA_RATE_LIMIT, AUTH, CORS, PROVIDER_UNAVAILABLE } from "@shared/provider-failures";

const KEY_DIRECT = "sk-or-v1-direct-key-aaaa";
const KEY_SERVER_B = "sk-ant-server-key-bbbb";
const encoder = new TextEncoder();
const noSleep = async () => undefined;

/** An OpenAI-shaped SSE stream, in the exact shape OpenRouter sends. */
function openRouterStream(chunks: string[]) {
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
        controller.close();
      },
    }),
    { status: 200, headers: { "content-type": "text/event-stream" } },
  );
}
const answerStream = () =>
  openRouterStream([
    `data: ${JSON.stringify({ choices: [{ delta: { content: "Привет" } }] })}\n\n`,
    "data: [DONE]\n\n",
  ]);

function httpError(status: number, headers: Record<string, string> = {}, body: unknown = { error: { message: "upstream detail" } }) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

/** A Kairema-side stream, in the SSE shape `/api/chat/stream` emits. */
function kairemaStream(content: string) {
  const body = `event: delta\ndata: ${JSON.stringify({ content })}\n\nevent: done\ndata: ${JSON.stringify({ content, modelUsed: "vendor/model", label: "OpenRouter" })}\n\n`;
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}

const openrouter: TurnCandidate = { provider: "openrouter", displayName: "OpenRouter", model: "vendor/model", hasStoredCredential: true };
const anthropic: TurnCandidate = { provider: "anthropic", displayName: "Anthropic", model: "claude-b", hasStoredCredential: true };

function harness() {
  const calls: Array<{ url: string; headers: Record<string, string>; body: string }> = [];
  const queue: Array<() => Response> = [];
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const headers: Record<string, string> = {};
    new Headers(init?.headers as HeadersInit).forEach((value, key) => { headers[key.toLowerCase()] = value; });
    calls.push({ url: String(input), headers, body: String(init?.body ?? "") });
    const next = queue.shift();
    return next ? next() : httpError(429);
  });
  return { calls, queue, fetchImpl };
}

function request(overrides: Partial<Parameters<typeof runMyApiTurn>[0]> = {}) {
  return {
    sessionId: "11111111-1111-4111-8111-111111111111",
    content: "вопрос",
    modelId: "fast",
    settings: {},
    clientMessageId: "22222222-2222-4222-8222-222222222222",
    primary: openrouter,
    others: [],
    preferDirect: true,
    onDelta: () => {},
    sleep: noSleep,
    ...overrides,
  };
}

beforeEach(() => {
  vi.spyOn(console, "info").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  clearDirectKeys();
});
afterEach(() => { vi.restoreAllMocks(); clearDirectKeys(); });

describe("the registry decides execution, not the call site", () => {
  it("runs OpenRouter in the browser only when direct is explicitly asked for", () => {
    expect(resolveExecution("openrouter", { preferDirect: true }).mode).toBe("direct");
    expect(resolveExecution("openrouter", { preferDirect: false }).mode).toBe("server");
  });

  it("keeps Anthropic on the server even when direct is requested", () => {
    // Its CORS opt-in is per-organization, so a direct answer here would be a guess about the
    // caller's account. The registry refuses it, and every caller inherits that refusal.
    expect(resolveExecution("anthropic", { preferDirect: true }).mode).toBe("server");
    expect(usesDirectExecution("anthropic", true)).toBe(false);
    expect(providerCapability("anthropic")!.cors).toBe("conditional");
  });

  it("keeps every other provider server-side and unknown ones unresolvable", () => {
    for (const id of ["google", "openai", "serper", "aws", "custom-abc", "", "nope"]) {
      expect(resolveExecution(id, { preferDirect: true }).mode, id).toBe("server");
    }
  });

  it("never grants direct to a provider with no established endpoint", () => {
    for (const entry of providerCapability("openrouter")! ? [providerCapability("openrouter")!] : []) {
      if (entry.chatEndpoint) expect(resolveExecution(entry.id, { preferDirect: true }).mode).toBe("direct");
      else expect(resolveExecution(entry.id, { preferDirect: true }).mode).toBe("server");
    }
  });
});

describe("a direct turn is reachable from the production flow", () => {
  it("calls the provider itself and never the Kairema server", async () => {
    setDirectKey("openrouter", KEY_DIRECT);
    const h = harness();
    h.queue.push(() => answerStream());
    const result = await runMyApiTurn(request({ fetchImpl: h.fetchImpl as unknown as typeof fetch }));
    expect(result.execution).toBe("direct");
    expect(result.content).toBe("Привет");
    expect(h.calls).toHaveLength(1);
    expect(h.calls[0]!.url).toBe("https://openrouter.ai/api/v1/chat/completions");
    // A direct key that touches any /api path is not a direct key.
    expect(h.calls.some((call) => call.url.startsWith("/api/") || call.url.includes("kairema") || call.url.includes("manus.space"))).toBe(false);
  });

  it("signs the provider request with the key from memory", async () => {
    setDirectKey("openrouter", KEY_DIRECT);
    const h = harness();
    h.queue.push(() => answerStream());
    await runMyApiTurn(request({ fetchImpl: h.fetchImpl as unknown as typeof fetch }));
    expect(h.calls[0]!.headers.authorization).toBe(`Bearer ${KEY_DIRECT}`);
    expect(h.calls[0]!.url).not.toContain(KEY_DIRECT);
  });

  it("refuses a direct turn when no key is in memory, rather than asking the server for one", async () => {
    const h = harness();
    await expect(runMyApiTurn(request({ fetchImpl: h.fetchImpl as unknown as typeof fetch }))).rejects.toThrow(ProviderUnavailableError);
    expect(h.calls).toHaveLength(0);
  });
});

describe("the direct key never leaves the page", () => {
  const dump = (store: Storage) => {
    const parts: string[] = [];
    for (let i = 0; i < store.length; i += 1) {
      const key = store.key(i);
      if (key) parts.push(`${key}=${store.getItem(key)}`);
    }
    return parts.join("|");
  };
  const readStorage = () => ({ local: dump(localStorage), session: dump(sessionStorage) });

  it("writes nothing to either web storage", () => {
    setDirectKey("openrouter", KEY_DIRECT);
    expect(readStorage().local).not.toContain(KEY_DIRECT);
    expect(readStorage().session).not.toContain(KEY_DIRECT);
  });

  it("appears in no log line, whatever the failure", async () => {
    const lines: string[] = [];
    vi.spyOn(console, "info").mockImplementation((...args: unknown[]) => { lines.push(args.map(String).join(" ")); });
    vi.spyOn(console, "warn").mockImplementation((...args: unknown[]) => { lines.push(args.map(String).join(" ")); });
    setDirectKey("openrouter", KEY_DIRECT);
    const h = harness();
    h.queue.push(() => httpError(500));
    await runMyApiTurn(request({ fetchImpl: h.fetchImpl as unknown as typeof fetch, others: [anthropic] })).catch(() => undefined);
    expect(lines.join("\n")).not.toContain(KEY_DIRECT);
  });

  it("is not put in the request body", async () => {
    setDirectKey("openrouter", KEY_DIRECT);
    const h = harness();
    h.queue.push(() => answerStream());
    await runMyApiTurn(request({ fetchImpl: h.fetchImpl as unknown as typeof fetch }));
    expect(h.calls[0]!.body).not.toContain(KEY_DIRECT);
  });
});

describe("keys stay isolated between users and providers", () => {
  it("drops the previous provider's key when the user switches provider", () => {
    setDirectKey("openrouter", KEY_DIRECT);
    setDirectKey("anthropic", KEY_SERVER_B);
    expect(getDirectKey("openrouter")).toBeNull();
    expect(getDirectKey("anthropic")).toBe(KEY_SERVER_B);
  });

  it("returns nothing for a provider that has no key instead of another one's", () => {
    setDirectKey("openrouter", KEY_DIRECT);
    expect(getDirectKey("anthropic")).toBeNull();
  });

  it("keeps concurrent turns from sharing a key", async () => {
    setDirectKey("openrouter", KEY_DIRECT);
    const a = harness(); a.queue.push(() => answerStream());
    const b = harness(); b.queue.push(() => answerStream());
    await Promise.all([
      runMyApiTurn(request({ fetchImpl: a.fetchImpl as unknown as typeof fetch })),
      runMyApiTurn(request({ fetchImpl: b.fetchImpl as unknown as typeof fetch })),
    ]);
    expect(a.calls[0]!.headers.authorization).toBe(`Bearer ${KEY_DIRECT}`);
    expect(b.calls[0]!.headers.authorization).toBe(`Bearer ${KEY_DIRECT}`);
  });

  it("clears every key on logout", () => {
    setDirectKey("openrouter", KEY_DIRECT);
    clearDirectKeys();
    expect(hasDirectKey("openrouter")).toBe(false);
  });

  it("gives each provider its own model and never the previous one's", async () => {
    setDirectKey("openrouter", KEY_DIRECT);
    const h = harness();
    h.queue.push(() => httpError(429, { "retry-after": "0" }), () => httpError(429, { "retry-after": "0" }), () => kairemaStream("ответ B"));
    await runMyApiTurn(request({ fetchImpl: h.fetchImpl as unknown as typeof fetch, others: [anthropic] }));
    const serverCall = h.calls.find((call) => call.url.includes("/api/chat/stream"))!;
    // The failed provider is named so the server does not try it again, and no key travels there.
    expect(serverCall.body).toContain("openrouter");
    expect(serverCall.body).not.toContain(KEY_DIRECT);
  });
});

describe("streaming from the page", () => {
  const collect = async (chunks: string[], body: string) => {
    setDirectKey("openrouter", KEY_DIRECT);
    const h = harness();
    h.queue.push(() => openRouterStream(chunks));
    const deltas: string[] = [];
    const result = await runMyApiTurn(request({ fetchImpl: h.fetchImpl as unknown as typeof fetch, onDelta: (delta) => deltas.push(delta) }));
    return { result, deltas, body };
  };
  const frame = (text: string) => `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`;

  it("publishes deltas in order and joins them into the answer", async () => {
    const { result, deltas } = await collect([frame("При"), frame("вет"), "data: [DONE]\n\n"], "x");
    expect(deltas).toEqual(["При", "вет"]);
    expect(result.content).toBe("Привет");
  });

  it("reassembles a frame split across two reads", async () => {
    const full = frame("разбито");
    const { result } = await collect([full.slice(0, 20), full.slice(20), "data: [DONE]\n\n"], "x");
    expect(result.content).toBe("разбито");
  });

  it("handles a missing final terminator after [DONE]", async () => {
    const { result } = await collect([frame("хвост"), "data: [DONE]\n\n"], "x");
    expect(result.content).toBe("хвост");
  });

  it("preserves the whitespace the provider sent", async () => {
    const { result } = await collect([frame("a "), frame(" b\n\n  c | d |"), "data: [DONE]\n\n"], "x");
    expect(result.content).toBe("a  b\n\n  c | d |");
  });

  it("keeps a GFM table intact across frames", async () => {
    const table = ["| a | b |", "| --- | --- |", "| 1 | 2 |"].join("\n");
    const { result } = await collect([frame("| a | b |\n"), frame("| --- | --- |\n"), frame("| 1 | 2 |"), "data: [DONE]\n\n"], "x");
    expect(result.content).toBe(table);
  });

  it("never publishes a model's reasoning as answer text", async () => {
    const reasoningFrame = `data: ${JSON.stringify({ choices: [{ delta: { reasoning_content: "секретные размышления" } }] })}\n\n`;
    const { result, deltas } = await collect([reasoningFrame, frame("ответ"), "data: [DONE]\n\n"], "x");
    expect(result.content).toBe("ответ");
    expect(deltas.join("")).not.toContain("секретные размышления");
  });

  it("stops when the caller aborts", async () => {
    setDirectKey("openrouter", KEY_DIRECT);
    const controller = new AbortController();
    const h = harness();
    h.queue.push(() => answerStream());
    controller.abort();
    await expect(runMyApiTurn(request({ fetchImpl: h.fetchImpl as unknown as typeof fetch, signal: controller.signal }))).rejects.toThrow();
  });
});

describe("classifying what the page saw", () => {
  const failureFor = async (response: () => Response, candidates: TurnCandidate[] = [], queue?: Array<() => Response>) => {
    setDirectKey("openrouter", KEY_DIRECT);
    const h = harness();
    for (const entry of queue ?? [response, response]) h.queue.push(entry);
    try {
      await runMyApiTurn(request({ fetchImpl: h.fetchImpl as unknown as typeof fetch, others: candidates }));
      return null;
    } catch (error) {
      return error instanceof ProviderUnavailableError ? error.failure : null;
    }
  };

  it("names an upstream 429 as the provider's limit, never Kairema's", async () => {
    const failure = await failureFor(() => httpError(429, { "retry-after": "1" }));
    expect(failure!.kind).toBe(PROVIDER_RATE_LIMIT);
    expect(failure!.kind).not.toBe(KAIREMA_RATE_LIMIT);
  });

  it("names Kairema's own quota separately when the server refuses the turn", async () => {
    const kairema = () => httpError(429, {}, { error: "Лимит My API", myApiRateLimited: true });
    const failure = await failureFor(kairema, [anthropic], [() => httpError(429, { "retry-after": "0" }), () => httpError(429, { "retry-after": "0" }), kairema]);
    expect(failure!.kind).toBe(KAIREMA_RATE_LIMIT);
  });

  it("treats a transient 5xx as a provider outage", async () => {
    const failure = await failureFor(() => httpError(503), [], [() => httpError(503), () => httpError(503)]);
    expect(failure!.kind).toBe(PROVIDER_UNAVAILABLE);
  });

  it("treats a rejected key as the user's own configuration problem", async () => {
    const failure = await failureFor(() => httpError(401));
    expect(failure!.kind).toBe(AUTH);
    expect(failure!.retryable).toBe(false);
  });

  it("treats a blocked cross-origin call as CORS, not as a network drop", async () => {
    const h = harness();
    setDirectKey("openrouter", KEY_DIRECT);
    h.fetchImpl = vi.fn(async () => { throw new TypeError("Failed to fetch"); }) as unknown as typeof fetch;
    try {
      await runMyApiTurn(request({ fetchImpl: h.fetchImpl }));
      expect.unreachable("a CORS block must surface as a failure");
    } catch (error) {
      expect((error as ProviderUnavailableError).failure.kind).toBe(CORS);
      expect((error as ProviderUnavailableError).failure.retryable).toBe(false);
    }
  });

  it("never puts an upstream body in the reason the user reads", async () => {
    const failure = await failureFor(() => httpError(400, {}, { error: { message: "internal-detail-leak" } }));
    expect(failure!.message).not.toContain("internal-detail-leak");
    expect(failure!.message).not.toMatch(/authorization|sk-|API_KEY/);
  });
});

describe("retrying only what is worth retrying", () => {
  it("spends two attempts on a throttled provider and then stops", async () => {
    setDirectKey("openrouter", KEY_DIRECT);
    const h = harness();
    h.queue.push(() => httpError(429, { "retry-after": "0" }));
    await runMyApiTurn(request({ fetchImpl: h.fetchImpl as unknown as typeof fetch })).catch(() => undefined);
    expect(h.calls).toHaveLength(MAX_ATTEMPTS_PER_PROVIDER);
  });

  it("waits for the window the provider named", async () => {
    setDirectKey("openrouter", KEY_DIRECT);
    const h = harness();
    h.queue.push(() => httpError(429, { "retry-after": "2" }));
    const sleep = vi.fn(noSleep);
    await runMyApiTurn(request({ fetchImpl: h.fetchImpl as unknown as typeof fetch, sleep })).catch(() => undefined);
    // Retrying before the window closes would turn the provider's own limit into a self-inflicted one.
    expect(sleep).toHaveBeenCalledWith(2_000);
  });

  it("does not retry a rejected key", async () => {
    setDirectKey("openrouter", KEY_DIRECT);
    const h = harness();
    h.queue.push(() => httpError(401));
    await runMyApiTurn(request({ fetchImpl: h.fetchImpl as unknown as typeof fetch })).catch(() => undefined);
    expect(h.calls).toHaveLength(1);
  });

  it("does not retry an unknown model or a malformed request", async () => {
    for (const status of [400, 404, 422]) {
      setDirectKey("openrouter", KEY_DIRECT);
      const h = harness();
      h.queue.push(() => httpError(status));
      await runMyApiTurn(request({ fetchImpl: h.fetchImpl as unknown as typeof fetch })).catch(() => undefined);
      expect(h.calls, String(status)).toHaveLength(1);
    }
  });

  it("retries a transient outage once before giving up on the provider", async () => {
    setDirectKey("openrouter", KEY_DIRECT);
    const h = harness();
    h.queue.push(() => httpError(503), () => answerStream());
    const result = await runMyApiTurn(request({ fetchImpl: h.fetchImpl as unknown as typeof fetch }));
    expect(result.content).toBe("Привет");
    expect(h.calls).toHaveLength(2);
  });
});

describe("the shared budget across the whole turn", () => {
  it("never exceeds four upstream calls, however long the chain is", async () => {
    setDirectKey("openrouter", KEY_DIRECT);
    const h = harness();
    h.queue.push(() => httpError(429, { "retry-after": "0" }));
    await runMyApiTurn(request({ fetchImpl: h.fetchImpl as unknown as typeof fetch, others: [anthropic, { ...anthropic, model: "claude-c" }] })).catch(() => undefined);
    expect(h.calls.length).toBeLessThanOrEqual(MAX_TOTAL_ATTEMPTS);
    expect(MAX_TOTAL_ATTEMPTS).toBe(4);
  });

  it("moves from a throttled direct provider to the user's next one", async () => {
    setDirectKey("openrouter", KEY_DIRECT);
    const h = harness();
    h.queue.push(() => httpError(429, { "retry-after": "0" }), () => httpError(429, { "retry-after": "0" }), () => kairemaStream("ответ B"));
    const switched: string[] = [];
    const result = await runMyApiTurn(request({ fetchImpl: h.fetchImpl as unknown as typeof fetch, others: [anthropic], onProviderSwitch: ({ to }) => switched.push(to.provider) }));
    expect(result.content).toBe("ответ B");
    expect(result.execution).toBe("server");
    expect(switched).toEqual(["anthropic"]);
  });

  it("does not hand over to another provider when the key itself was rejected", async () => {
    setDirectKey("openrouter", KEY_DIRECT);
    const h = harness();
    h.queue.push(() => httpError(401));
    await runMyApiTurn(request({ fetchImpl: h.fetchImpl as unknown as typeof fetch, others: [anthropic] })).catch(() => undefined);
    // The user's other providers would reject the same mistake identically.
    expect(h.calls).toHaveLength(1);
  });

  it("never falls back to a Kairema system provider", async () => {
    setDirectKey("openrouter", KEY_DIRECT);
    const h = harness();
    h.queue.push(() => httpError(429, { "retry-after": "0" }));
    await runMyApiTurn(request({ fetchImpl: h.fetchImpl as unknown as typeof fetch, others: [anthropic] })).catch(() => undefined);
    // Every call is either the user's own provider or the user's own server turn.
    for (const call of h.calls) expect(call.url).toMatch(/openrouter\.ai|api\.anthropic\.com|\/api\/chat\/stream/);
  });
});

describe("when nothing can answer", () => {
  it("reports that no fallback remains instead of retrying forever", async () => {
    setDirectKey("openrouter", KEY_DIRECT);
    const h = harness();
    h.queue.push(() => httpError(429, { "retry-after": "0" }));
    let failure: ProviderUnavailableError | null = null;
    try {
      await runMyApiTurn(request({ fetchImpl: h.fetchImpl as unknown as typeof fetch }));
    } catch (error) { failure = error as ProviderUnavailableError; }
    expect(failure).toBeInstanceOf(ProviderUnavailableError);
    expect(failure!.hasFallback).toBe(false);
    expect(h.calls.length).toBeLessThanOrEqual(MAX_TOTAL_ATTEMPTS);
  });

  it("stops immediately rather than looping when no provider is connected at all", async () => {
    const h = harness();
    const before = h.calls.length;
    await expect(runMyApiTurn(request({ fetchImpl: h.fetchImpl as unknown as typeof fetch, primary: { ...openrouter, hasStoredCredential: false }, others: [] }))).rejects.toThrow(ProviderUnavailableError);
    expect(h.calls.length).toBe(before);
  });
});

describe("ordering the chain the user connected", () => {
  const configs = [
    { provider: "anthropic", displayName: "Anthropic", activeModel: "claude-a" },
    { provider: "openrouter", displayName: "OpenRouter", activeModel: "vendor/model" },
  ];

  it("tries the provider the user selected first", () => {
    // Answering from a provider the user did not pick would bill them for a model they did not
    // choose, so the selection has to win over the order the rows happen to be listed in.
    expect(buildCandidateChain(configs, "openrouter").map((entry) => entry.provider)).toEqual(["openrouter", "anthropic"]);
    expect(buildCandidateChain(configs, "anthropic").map((entry) => entry.provider)).toEqual(["anthropic", "openrouter"]);
  });

  it("keeps each provider's own model rather than the selected one", () => {
    const chain = buildCandidateChain(configs, "openrouter");
    expect(chain[0]!.model).toBe("vendor/model");
    expect(chain[1]!.model).toBe("claude-a");
  });

  it("lists a provider with no model only once, and never twice", () => {
    const duplicated = [...configs, { provider: "openrouter", displayName: "OpenRouter", activeModel: "other/model" }];
    const chain = buildCandidateChain(duplicated, "openrouter");
    expect(chain.filter((entry) => entry.provider === "openrouter")).toHaveLength(1);
  });

  it("omits a connected provider that has no usable model", () => {
    const chain = buildCandidateChain([...configs, { provider: "empty", displayName: "Empty", activeModel: null }], "openrouter");
    expect(chain.some((entry) => entry.provider === "empty")).toBe(false);
  });

  it("returns nothing when the user has not chosen a provider", () => {
    expect(buildCandidateChain(configs, null)).toEqual([]);
  });
});
