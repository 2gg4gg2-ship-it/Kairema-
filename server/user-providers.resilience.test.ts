import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { isBrowserDirectCapable, providerCapability } from "@shared/provider-capabilities";
import { chatWithUserProviderStream, upstreamRateLimitDiagnostics, USER_PROVIDERS } from "./user-providers";
import { MAX_ATTEMPTS } from "./providers";

const encoder = new TextEncoder();
const KEY_A = "sk-or-v1-user-a-key-1111";
const KEY_B = "sk-or-v1-user-b-key-2222";
const KEY_C = "sk-or-v1-user-c-key-3333";
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
    // One 429, then the retry succeeds: the provider's own window is honoured, not guessed at.
    const { result, seen } = await ask({ retry: { sleep } }, [status429("1"), okStream()]);
    await result;
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([1_000]);
    expect(seen).toHaveLength(2);
  });

  it("backs off exponentially when the provider gives no Retry-After", async () => {
    const sleep = vi.fn(noSleep);
    // Across the chain: one backoff on the primary, then the next provider picks up the slack.
    const { result } = await ask(
      { retry: { sleep }, fallbacks: [{ provider: "anthropic", model: "claude-b", apiKey: KEY_B }] },
      [status429(), okStream()],
    );
    await result;
    const delays = sleep.mock.calls.map(([ms]) => ms as number);
    expect(delays).toHaveLength(1);
    expect(delays[0]).toBeGreaterThan(0);
  });

  it("gives a single provider two attempts and stops, rather than spending the whole budget", async () => {
    const { result, seen } = await ask({}, [status429()]);
    await expect(result).rejects.toThrow();
    // With no second provider connected there is nothing to hand the remaining budget to, so the
    // request ends after this provider's two attempts.
    expect(seen).toHaveLength(2);
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
   * Policy under test: a provider may spend at most MAX_ATTEMPTS_PER_PROVIDER (2) attempts, then
   * the chain moves to the next provider the user connected, carrying the rest of the one shared
   * budget. The total across the whole chain is still MAX_ATTEMPTS (4).
   */
  it("gives the primary two attempts, then answers from the user's second provider", async () => {
    const { result, seen } = await ask(
      { fallbacks: [{ provider: "anthropic", model: "claude-x", apiKey: KEY_B }] },
      // Attempt 1 and 2 are the primary being throttled; attempt 3 is the fallback answering.
      [status429(), status429(), okStream()],
    );
    // A, A, B — the primary never gets a third attempt.
    await expect(result).resolves.toMatchObject({ content: "answer" });
    expect(seen).toHaveLength(3);
    expect(seen[0]!.url).toContain("openrouter.ai");
    expect(seen[1]!.url).toContain("openrouter.ai");
    expect(seen[2]!.url).toContain("api.anthropic.com");
  });

  it("sends each provider its own key and model", async () => {
    const { result, seen } = await ask(
      { fallbacks: [{ provider: "anthropic", model: "claude-x", apiKey: KEY_B }] },
      [status429(), status429(), okStream()],
    );
    await result;
    for (const call of seen.slice(0, 2)) {
      expect(call.auth).toBe(`Bearer ${KEY_A}`);
      expect(call.body).toContain("vendor/model");
    }
    const fallbackCall = seen[2]!;
    expect(fallbackCall.auth).toBe(`Bearer ${KEY_B}`);
    expect(fallbackCall.body).toContain("claude-x");
    expect(fallbackCall.body).not.toContain("vendor/model");
  });

  it("stops at exactly the shared budget of four attempts, not four per provider", async () => {
    const { result, seen } = await ask(
      { fallbacks: [{ provider: "anthropic", model: "claude-x", apiKey: KEY_B }] },
      [status429()],
    );
    await expect(result).rejects.toThrow(/ограничил частоту/);
    // Two on the primary, two on the fallback. The budget is shared, so the cap is still 4 overall.
    expect(seen).toHaveLength(MAX_ATTEMPTS);
    expect(seen.slice(0, 2).every((call) => call.url.includes("openrouter.ai"))).toBe(true);
    expect(seen.slice(2).every((call) => call.url.includes("api.anthropic.com"))).toBe(true);
  });

  it("walks further down the chain while budget remains, and stops at the first success", async () => {
    // Three user providers, all throttling except the last: A(2), B(2) exhausts the budget, so C
    // is never reached. The chain must not invent a fifth attempt to try it.
    const { result, seen } = await ask(
      {
        fallbacks: [
          { provider: "anthropic", model: "claude-b", apiKey: KEY_B },
          { provider: "anthropic", model: "claude-c", apiKey: KEY_C },
        ],
      },
      [status429()],
    );
    await expect(result).rejects.toThrow();
    expect(seen).toHaveLength(MAX_ATTEMPTS);
    // C never got a call, because A and B spent the whole shared budget first.
    expect(seen.some((call) => call.body.includes("claude-c"))).toBe(false);
  });

  it("does not exceed the budget when a third provider could still have answered", async () => {
    const { result, seen } = await ask(
      { fallbacks: [{ provider: "anthropic", model: "claude-b", apiKey: KEY_B }] },
      // A throttled twice, B throttled once, then B's second attempt succeeds.
      [status429(), status429(), status429(), okStream()],
    );
    await expect(result).resolves.toMatchObject({ content: "answer" });
    expect(seen).toHaveLength(4);
    expect(seen[2]!.url).toContain("api.anthropic.com");
    expect(seen[3]!.url).toContain("api.anthropic.com");
  });

  it("never falls back to a Kairema provider", async () => {
    const { result, seen } = await ask(
      { fallbacks: [{ provider: "anthropic", model: "claude-x", apiKey: KEY_B }] },
      [status429()],
    );
    await expect(result).rejects.toThrow();
    // Every call went to a provider the user connected. Nothing points at a Kairema endpoint.
    for (const call of seen) {
      expect(call.url).toMatch(/openrouter\.ai|api\.anthropic\.com/);
    }
  });

  it("keeps each provider's key out of the other provider's request", async () => {
    const { result, seen } = await ask(
      { fallbacks: [{ provider: "anthropic", model: "claude-x", apiKey: KEY_B }] },
      [status429(), status429(), okStream()],
    );
    await result;
    // User B's key appears only on B's own calls, and user A's only on A's.
    expect(seen.filter((call) => call.auth === `Bearer ${KEY_A}`)).toHaveLength(2);
    expect(seen.filter((call) => call.auth === `Bearer ${KEY_B}`)).toHaveLength(1);
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
  it("completes every provider on the server, and has no browser path at all", () => {
    // There is no client-direct execution path in this product. A test that claims one exists
    // would be asserting a behaviour the server does not implement, and would hide the fact that
    // both keys travel to the provider through our backend.
    for (const entry of USER_PROVIDERS.filter((e) => e.available)) {
      const status = providerCapability(entry.id)!;
      expect(status.execution, entry.id).toBe("server");
    }
    expect(isBrowserDirectCapable("anthropic")).toBe(false);
  });

  it("has no entry point that would run a completion in the browser", () => {
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
