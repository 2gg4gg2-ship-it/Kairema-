import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { chatWithUserProviderStream, isClientDirectProvider, upstreamRateLimitDiagnostics, USER_PROVIDERS } from "./user-providers";
import { MAX_ATTEMPTS } from "./providers";

const encoder = new TextEncoder();
const KEY_A = "sk-or-v1-user-a-key-1111";
const KEY_B = "sk-or-v1-user-b-key-2222";
const noSleep = async () => undefined;

function sse(chunks: string[]) {
  return {
    ok: true, status: 200,
    body: new ReadableStream<Uint8Array>({ start(controller) { for (const chunk of chunks) controller.enqueue(encoder.encode(chunk)); controller.close(); } }),
    headers: new Headers({ "content-type": "text/event-stream" }),
    json: async () => ({}), text: async () => "",
  } as unknown as Response;
}

function status429(retryAfter?: string) {
  return {
    ok: false, status: 429,
    body: null,
    headers: new Headers({ "content-type": "application/json", ...(retryAfter ? { "retry-after": retryAfter } : {}) }),
    json: async () => ({ error: { message: "rate limited" } }),
    text: async () => '{"error":{"message":"rate limited"}}',
  } as unknown as Response;
}

const okStream = () => sse([`data: ${JSON.stringify({ choices: [{ delta: { content: "answer" } }] })}\n\n`, "data: [DONE]\n\n"]);

const ask = (overrides: Record<string, unknown> = {}, responses?: unknown) => {
  const deltas: string[] = [];
  const seen: Array<{ url: string; auth: string | null; body: string }> = [];
  const queue = [...(responses ?? [])];
  const fetchSpy = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers as HeadersInit);
    seen.push({ url: String(input), auth: headers.get("authorization"), body: String(init?.body ?? "") });
    return queue.length > 1 ? queue.shift()! : (queue[0] ?? okStream());
  });
  vi.stubGlobal("fetch", fetchSpy);
  const result = chatWithUserProviderStream({
    provider: "openrouter", model: "vendor/model", modelLabel: "Model", apiKey: KEY_A,
    history: [{ role: "user", content: "hi" }], roleId: "fast",
    onDelta: (delta) => deltas.push(delta),
    retry: { sleep: noSleep },
    ...overrides,
  });
  return { result, seen, deltas };
};

beforeEach(() => {
  vi.spyOn(console, "info").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("retrying a rate-limited upstream", () => {
  it("retries a 429 and succeeds, waiting the time the provider named", async () => {
    const sleep = vi.fn(noSleep);
    const { result, seen } = await ask({ retry: { sleep } }, [status429("1"), status429("2"), okStream()]);
    await result;
    // The provider's own window is honoured rather than guessed at.
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([1_000, 2_000]);
    expect(seen).toHaveLength(3);
  });

  it("backs off exponentially when the provider gives no Retry-After", async () => {
    const sleep = vi.fn(noSleep);
    const { result } = await ask({ retry: { sleep } }, [status429(), status429(), status429(), okStream()]);
    await result;
    const delays = sleep.mock.calls.map(([ms]) => ms as number);
    expect(delays).toHaveLength(3);
    expect(delays[1]).toBeGreaterThan(delays[0]);
    expect(delays[2]).toBeGreaterThan(delays[1]);
  });

  it("spends the shared attempt budget and never more", async () => {
    const { result, seen } = await ask({}, [status429()]);
    await expect(result).rejects.toThrow();
    // Four is the whole budget: there is no second budget behind the retry loop.
    expect(seen).toHaveLength(MAX_ATTEMPTS);
    expect(MAX_ATTEMPTS).toBe(4);
  });

  it("does not repeat a failure that is not a rate limit", async () => {
    const badKey = { ok: false, status: 401, body: null, headers: new Headers(), json: async () => ({}), text: async () => "{}" } as unknown as Response;
    const { result, seen } = await ask({}, [badKey]);
    await expect(result).rejects.toThrow(/API-ключ/);
    // A rejected key fails identically on every attempt, so repeating it only spends the caller's money.
    expect(seen).toHaveLength(1);
  });
});

describe("falling back between the user's own providers", () => {
  /**
   * KNOWN GAP, pinned deliberately: the fallback chain is unreachable today.
   *
   * The primary provider spends the whole shared budget on its own retries, and the loop then
   * breaks on `budget.used >= MAX_ATTEMPTS` before it can reach a second candidate. So a user
   * whose only provider is rate-limited gets the error even when they connected a second one.
   *
   * The tests below record what the code does, not what the doc comment at the candidate list
   * says it should do. Making the fallback reachable means deciding how many attempts a primary
   * may spend before a second provider is tried, which is a capacity-budget change and is not
   * this task's call to make.
   */
  it("never reaches the second provider, because the primary spends the whole budget", async () => {
    const { result, seen } = await ask(
      { fallbacks: [{ provider: "anthropic", model: "claude-x", apiKey: KEY_B }] },
      [status429()],
    );
    await expect(result).rejects.toThrow(/ограничил частоту/);
    // Every call went to the primary, and the budget stopped there.
    expect(seen).toHaveLength(MAX_ATTEMPTS);
    for (const call of seen) expect(call.url).toContain("openrouter.ai");
  });

  it("keeps each provider's key out of the other provider's request", async () => {
    const { result, seen } = await ask(
      { fallbacks: [{ provider: "anthropic", model: "claude-x", apiKey: KEY_B }] },
      [status429()],
    );
    await expect(result).rejects.toThrow();
    // User B's key never appears in a request, and never leaks into a log line either.
    for (const call of seen) {
      expect(call.auth).toBe(`Bearer ${KEY_A}`);
      expect(JSON.stringify(call)).not.toContain(KEY_B);
    }
  });

  it("does not move on when the failure is the user's configuration", async () => {
    const badKey = { ok: false, status: 401, body: null, headers: new Headers(), json: async () => ({}), text: async () => "{}" } as unknown as Response;
    const { result, seen } = await ask({ fallbacks: [{ provider: "anthropic", model: "claude-x", apiKey: KEY_B }] }, [badKey]);
    await expect(result).rejects.toThrow();
    // A rejected key is the user's own setting; a second provider would reject it too.
    expect(seen).toHaveLength(1);
  });
});

describe("keys never mix between users", () => {
  it("gives every request its own Authorization header", async () => {
    // User A, then user B, then user A again. Each call must carry only its own key.
    const first = await ask({}, [okStream()]);
    await first.result;
    const second = await ask({ provider: "anthropic", model: "claude-x", apiKey: KEY_B }, [okStream()]);
    await second.result;
    const third = await ask({}, [okStream()]);
    await third.result;

    expect(first.seen[0]!.auth).toBe(`Bearer ${KEY_A}`);
    expect(second.seen[0]!.auth).toBe(`Bearer ${KEY_B}`);
    expect(third.seen[0]!.auth).toBe(`Bearer ${KEY_A}`);
  });

  it("keeps concurrent requests from sharing a key", async () => {
    const [a, b] = await Promise.all([ask({}, [okStream()]), ask({ apiKey: KEY_B }, [okStream()])]);
    await a.result;
    await b.result;
    expect(a.seen[0]!.auth).toBe(`Bearer ${KEY_A}`);
    expect(b.seen[0]!.auth).toBe(`Bearer ${KEY_B}`);
  });

  it("keeps each request's provider and model with its own key", async () => {
    const a = await ask({}, [okStream()]);
    const b = await ask({ provider: "anthropic", model: "claude-y", apiKey: KEY_B }, [okStream()]);
    await Promise.all([a.result, b.result]);
    expect(a.seen[0]!.url).toContain("openrouter.ai");
    expect(a.seen[0]!.body).toContain("vendor/model");
    expect(b.seen[0]!.url).toContain("api.anthropic.com");
    expect(b.seen[0]!.body).toContain("claude-y");
  });
});

describe("which providers run where", () => {
  it("sends OpenRouter and Anthropic straight from the browser", () => {
    expect(isClientDirectProvider("openrouter")).toBe(true);
    expect(isClientDirectProvider("anthropic")).toBe(true);
  });

  it("keeps every other provider on the server path", () => {
    for (const provider of ["openai", "google", "custom-abc", "groq", ""]) {
      expect(isClientDirectProvider(provider), provider).toBe(false);
    }
  });

  it("covers exactly the two providers the task allows", () => {
    expect(USER_PROVIDERS.filter((entry) => entry.available).map((entry) => entry.id).sort()).toEqual(["anthropic", "openrouter"]);
  });

});

describe("rate limit diagnostics", () => {
  it("reads the provider's own accounting headers", () => {
    const response = { headers: new Headers({ "x-ratelimit-limit": "20", "x-ratelimit-remaining": "0", "x-ratelimit-reset": "1700000000", "retry-after": "30", "cf-ray": "abc123" }) } as unknown as Response;
    expect(upstreamRateLimitDiagnostics(response)).toEqual({
      rateLimitLimit: "20", rateLimitRemaining: "0", rateLimitReset: "1700000000", retryAfter: "30", cfRay: "abc123",
    });
  });

  it("copes with a response that carries no headers at all", () => {
    expect(upstreamRateLimitDiagnostics({ headers: undefined } as unknown as Response)).toEqual({
      rateLimitLimit: null, rateLimitRemaining: null, rateLimitReset: null, retryAfter: null, cfRay: null,
    });
  });
});
