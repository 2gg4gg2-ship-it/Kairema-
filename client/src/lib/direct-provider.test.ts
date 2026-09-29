// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AUTH, CORS, PROVIDER_RATE_LIMIT } from "@shared/provider-failures";
import {
  DirectProviderError,
  assertBrowserDirectAllowed,
  directHeaders,
  runDirectChat,
} from "./direct-provider";
import { clearDirectKey, clearDirectKeys, describeDirectKey, directKeyFor, getDirectKey, hasDirectKey, setDirectKey } from "./direct-key-store";

const KEY_A = "sk-direct-user-a-000111";
const KEY_B = "sk-direct-user-b-000222";

const encoder = new TextEncoder();

function sseResponse(chunks: string[]) {
  return {
    ok: true, status: 200,
    headers: new Headers({ "content-type": "text/event-stream" }),
    body: new ReadableStream<Uint8Array>({
      start(controller) { for (const chunk of chunks) controller.enqueue(encoder.encode(chunk)); controller.close(); },
    }),
    json: async () => ({}), text: async () => "",
  } as unknown as Response;
}

function frame(content: string) {
  return `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`;
}

beforeEach(() => {
  clearDirectKeys();
  vi.restoreAllMocks();
});

describe("the direct key store", () => {
  it("keeps the key in memory only", () => {
    setDirectKey("openrouter", KEY_A);
    expect(getDirectKey("openrouter")).toBe(KEY_A);
    // Nothing durable: localStorage survives a browser restart and sessionStorage survives a tab
    // restore, and a key that survives either has left the "only in memory" guarantee.
    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
  });

  it("never writes the key to either web storage", () => {
    setDirectKey("openrouter", KEY_A);
    const dump = JSON.stringify({ ...window.localStorage, ...window.sessionStorage });
    expect(dump).not.toContain(KEY_A);
  });

  it("drops the previous provider's key when the user switches provider", () => {
    setDirectKey("openrouter", KEY_A);
    setDirectKey("anthropic", KEY_B);
    // The old key is gone: a later request that still names the old provider cannot be signed
    // with it, which is the whole point of binding a key to one provider id.
    expect(getDirectKey("openrouter")).toBeNull();
    expect(getDirectKey("anthropic")).toBe(KEY_B);
  });

  it("returns nothing for a provider that has no key rather than another provider's", () => {
    setDirectKey("openrouter", KEY_A);
    expect(directKeyFor("anthropic")).toBeNull();
    expect(directKeyFor("")).toBeNull();
    expect(directKeyFor("nope")).toBeNull();
  });

  it("clears every key on logout", () => {
    setDirectKey("openrouter", KEY_A);
    clearDirectKeys();
    expect(hasDirectKey("openrouter")).toBe(false);
    expect(getDirectKey("openrouter")).toBeNull();
  });

  it("clears a single provider's key on request", () => {
    setDirectKey("openrouter", KEY_A);
    clearDirectKey("openrouter");
    expect(getDirectKey("openrouter")).toBeNull();
  });

  it("describes a key without revealing any of it", () => {
    setDirectKey("openrouter", KEY_A);
    const described = describeDirectKey("openrouter");
    // Support needs to tell two users' keys apart; a length does that without the value being
    // recoverable from a log line.
    expect(described.present).toBe(true);
    expect(described.length).toBe(KEY_A.length);
    expect(JSON.stringify(described)).not.toContain(KEY_A.slice(-4));
  });
});

describe("direct execution gating", () => {
  it("refuses a provider whose CORS policy is not established as allowed", () => {
    // Anthropic answers direct calls only behind an opt-in header, and an organisation can have
    // CORS disabled entirely, so it is never a safe automatic direct call.
    expect(() => assertBrowserDirectAllowed("anthropic")).toThrow(DirectProviderError);
    expect(() => assertBrowserDirectAllowed("google")).toThrow(DirectProviderError);
  });

  it("refuses a search service and a cloud provider outright", () => {
    for (const id of ["serper", "tavily", "exa", "firecrawl", "aws"]) {
      expect(() => assertBrowserDirectAllowed(id), id).toThrow(DirectProviderError);
    }
  });

  it("refuses a provider it has never heard of", () => {
    expect(() => assertBrowserDirectAllowed("totally-made-up")).toThrow(DirectProviderError);
  });

  it("puts the key in a header, never in the URL", () => {
    const headers = directHeaders("openrouter", KEY_A, true);
    expect(headers.Authorization).toBe(`Bearer ${KEY_A}`);
    // A key in a query string ends up in history, referrers and proxy logs.
    expect(JSON.stringify(headers)).not.toContain("?");
  });

  it("sends a provider's own opt-in header only for that provider", () => {
    expect(directHeaders("anthropic", KEY_A, true)["anthropic-dangerous-direct-browser-access"]).toBe("true");
    expect(directHeaders("openrouter", KEY_A, true)["anthropic-dangerous-direct-browser-access"]).toBeUndefined();
  });

  it("uses the auth header the provider actually expects", () => {
    expect(directHeaders("anthropic", KEY_A, true)["x-api-key"]).toBe(KEY_A);
    expect(directHeaders("anthropic", KEY_A, true).Authorization).toBeUndefined();
    expect(directHeaders("google", KEY_A, true)["x-goog-api-key"]).toBe(KEY_A);
  });
});

describe("running a direct completion", () => {
  const runWith = (providerId: string, fetchImpl: typeof fetch, key = KEY_A) => {
    setDirectKey(providerId, key);
    return runDirectChat({ providerId, model: "vendor/model", messages: [{ role: "user", content: "hi" }], onDelta: () => {}, fetchImpl });
  };

  it("refuses to run for a provider that may not be called from a browser", async () => {
    await expect(runWith("anthropic", vi.fn() as unknown as typeof fetch)).rejects.toThrow(DirectProviderError);
  });

  it("refuses to run without a key in memory", async () => {
    await expect(
      runDirectChat({ providerId: "openrouter", model: "m", messages: [{ role: "user", content: "hi" }], onDelta: () => {}, fetchImpl: vi.fn() as unknown as typeof fetch }),
    ).rejects.toMatchObject({ failure: { kind: AUTH } });
  });

  it("sends the request to the provider, never to the Kairema server", async () => {
    // The direct path is defined by the prompt and the key never reaching our own backend.
    const fetchImpl = vi.fn(async () => sseResponse([frame("answer"), "data: [DONE]\n\n"])) as unknown as typeof fetch;
    const calls: string[] = [];
    const spy = vi.fn(async (url: RequestInfo | URL) => { calls.push(String(url)); return sseResponse([frame("answer"), "data: [DONE]\n\n"]); });
    await runDirectChat({ providerId: "openrouter", model: "m", messages: [{ role: "user", content: "hi" }], onDelta: () => {}, fetchImpl: spy as unknown as typeof fetch }).catch(() => undefined);
    void fetchImpl;
    for (const url of calls) {
      expect(url).not.toMatch(/\/api\//);
      expect(url).not.toMatch(/kairema/i);
    }
  });

  it("classifies a CORS-blocked fetch as CORS rather than as a network drop", async () => {
    // The browser reports a blocked cross-origin request as an opaque TypeError. Retrying that
    // would burn the budget on a request that can never succeed.
    const fetchImpl = vi.fn(async () => { throw new TypeError("Failed to fetch"); }) as unknown as typeof fetch;
    await expect(runWith("openrouter", fetchImpl)).rejects.toMatchObject({ failure: { kind: CORS } });
  });

  it("classifies a provider 429 as the provider's rate limit, not Kairema's", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: false, status: 429, headers: new Headers(), json: async () => ({ error: { message: "rate limited" } }), text: async () => "",
    })) as unknown as typeof fetch;
    await expect(runWith("openrouter", fetchImpl)).rejects.toMatchObject({ failure: { kind: PROVIDER_RATE_LIMIT } });
  });

  it("streams deltas in order and returns the joined answer", async () => {
    const deltas: string[] = [];
    setDirectKey("openrouter", KEY_A);
    const fetchImpl = vi.fn(async () => sseResponse([frame("Hello"), frame(" world"), "data: [DONE]\n\n"])) as unknown as typeof fetch;
    const result = await runDirectChat({ providerId: "openrouter", model: "m", messages: [{ role: "user", content: "hi" }], onDelta: (d) => deltas.push(d), fetchImpl });
    expect(deltas.join("")).toBe("Hello world");
    expect(result.content).toBe("Hello world");
  });

  it("never sends one user's key with another user's request", async () => {
    const seen: Array<string | null> = [];
    const spy = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      seen.push(new Headers(init?.headers as HeadersInit).get("authorization"));
      return sseResponse([frame("ok"), "data: [DONE]\n\n"]);
    });
    setDirectKey("openrouter", KEY_A);
    await runDirectChat({ providerId: "openrouter", model: "m", messages: [], onDelta: () => {}, fetchImpl: spy as unknown as typeof fetch });
    // Switching provider clears the first key, so the second request has none to send.
    await expect(
      runDirectChat({ providerId: "anthropic", model: "m", messages: [], onDelta: () => {}, fetchImpl: spy as unknown as typeof fetch }),
    ).rejects.toThrow();
    expect(seen).toEqual([`Bearer ${KEY_A}`]);
    expect(seen.join(",")).not.toContain(KEY_B);
  });
});
