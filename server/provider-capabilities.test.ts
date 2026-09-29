import { describe, expect, it } from "vitest";

import {
  AUTH,
  CORS,
  EMPTY_RESPONSE,
  KAIREMA_RATE_LIMIT,
  MODEL,
  NETWORK,
  PROVIDER_RATE_LIMIT,
  PROVIDER_UNAVAILABLE,
  UNKNOWN,
  classifyProviderFailure,
  isRetryableFailure,
} from "@shared/provider-failures";
import {
  CUSTOM_PROVIDER_CAPABILITY,
  PROVIDER_CAPABILITIES,
  isBrowserDirectCapable,
  isOfferableUserProvider,
  offerableUserProviders,
  providerCapability,
} from "@shared/provider-capabilities";

/**
 * The registry is the one place a claim about a provider is made. These tests exist so that a row
 * added optimistically — or a search service quietly reclassified as a chat provider — fails here
 * rather than in a user's browser.
 */
describe("provider capability classification", () => {
  it("registers every service named in the product brief", () => {
    const required = [
      "google", "chatgpt", "anthropic", "perplexity", "qwen", "grok", "kimi", "serper", "tavily",
      "teamorouter", "tokenharbor", "you", "zenmux", "groq", "keiro", "mistral", "nararouter",
      "openrouter", "orcarouter", "sambanova", "aws", "bazaarlink", "cerebras", "cometapi", "exa",
      "firecrawl",
    ];
    for (const id of required) {
      expect(providerCapability(id), `${id} is not registered at all`).toBeDefined();
    }
  });

  it("never exposes an env var or API key variable as a display name", () => {
    // Users connect to services, not to configuration. A name like OPENROUTER_API_KEY in the UI
    // both looks broken and teaches the wrong model of where the key lives.
    for (const entry of PROVIDER_CAPABILITIES) {
      expect(entry.displayName, entry.id).not.toMatch(/api[_-]?key|token|secret|[A-Z]{3,}_/);
      expect(entry.displayName, entry.id).not.toMatch(/^[a-z0-9_]+$/);
    }
  });

  it("classifies search and tool services as non-LLM, so a key cannot buy a chat turn", () => {
    for (const id of ["serper", "tavily", "exa", "firecrawl"]) {
      const entry = providerCapability(id)!;
      expect(entry.kind, id).toBe("search");
      expect(entry.execution, id).toBe("none");
      expect(entry.streaming, id).toBe(false);
      // The decisive assertion: none of them can ever be offered in a chat flow.
      expect(isOfferableUserProvider(id), id).toBe(false);
    }
  });

  it("classifies AWS as infrastructure rather than an LLM provider", () => {
    const entry = providerCapability("aws")!;
    expect(entry.kind).toBe("cloud");
    expect(entry.execution).toBe("none");
    // SigV4 signing, not a bearer key: pasting an AWS access key into a chat provider field would
    // be a credential leak with no way to use it.
    expect(entry.auth).toBe("aws-sigv4");
    expect(isOfferableUserProvider("aws")).toBe(false);
  });

  it("offers only providers that are implemented, are LLMs, and have a known execution path", () => {
    const offered = offerableUserProviders().map((entry) => entry.id).sort();
    // Anything UNKNOWN is excluded: we would be guessing at its wire format.
    expect(offered).toEqual(["anthropic", "openrouter"]);
    for (const id of offered) {
      expect(providerCapability(id)!.status, id).toBe("implemented");
      expect(providerCapability(id)!.kind, id).toBe("llm");
    }
  });

  it("marks a provider it has not verified as UNKNOWN rather than guessing", () => {
    // The brief's default for an unverified service. Guessing OpenAI compatibility is how a
    // request gets built in the wrong shape and fails as a bad key.
    for (const id of ["perplexity", "grok", "qwen", "kimi", "groq", "mistral", "cerebras", "sambanova", "zenmux", "you"]) {
      const entry = providerCapability(id)!;
      expect(entry.status, id).toBe("unknown");
      expect(entry.openaiCompatible, id).toBeNull();
      expect(entry.streaming, id).toBeNull();
    }
  });

  it("refuses browser-direct for a provider whose CORS is conditional or unknown", () => {
    // Anthropic answers direct calls only with an opt-in header, and an organization can have CORS
    // switched off entirely — so "conditional" is a refusal, not a maybe.
    expect(isBrowserDirectCapable("anthropic")).toBe(false);
    expect(isBrowserDirectCapable("google")).toBe(false);
    expect(isBrowserDirectCapable("serper")).toBe(false);
    expect(isBrowserDirectCapable("aws")).toBe(false);
    expect(isBrowserDirectCapable("does-not-exist")).toBe(false);
  });

  it("keeps a user-defined endpoint server-side, never browser-direct", () => {
    expect(CUSTOM_PROVIDER_CAPABILITY.execution).toBe("server");
    expect(isBrowserDirectCapable("custom")).toBe(false);
  });

  it("records a reason for every row, so no claim is unexplained", () => {
    for (const entry of PROVIDER_CAPABILITIES) {
      expect(entry.notes.length, entry.id).toBeGreaterThan(20);
    }
  });

  it("records a direct endpoint only where CORS allows a browser call", () => {
    // A direct endpoint on a row whose CORS is blocked or unknown would be a key handed to a
    // request that cannot succeed, so the two facts are asserted together.
    for (const entry of PROVIDER_CAPABILITIES) {
      if (!entry.chatEndpoint) continue;
      expect(entry.cors, entry.id).toBe("allowed");
      expect(entry.kind, entry.id).toBe("llm");
      expect(entry.chatEndpoint, entry.id).toMatch(/^https:\/\//);
    }
  });

  it("gives the one established direct provider a real endpoint", () => {
    expect(providerCapability("openrouter")!.chatEndpoint).toBe("https://openrouter.ai/api/v1/chat/completions");
    // Anthropic is the other candidate and deliberately has none: its opt-in is per-organization.
    expect(providerCapability("anthropic")!.chatEndpoint).toBeUndefined();
  });
});

describe("failure classification", () => {
  it("names a provider 429 as the provider's rate limit, never Kairema's", () => {
    const failure = classifyProviderFailure({ http: 429, body: { error: { message: "rate limited" } } });
    expect(failure.kind).toBe(PROVIDER_RATE_LIMIT);
    expect(failure.kind).not.toBe(KAIREMA_RATE_LIMIT);
    expect(failure.retryable).toBe(true);
  });

  it("names Kairema's own spent budget separately, and never as a provider limit", () => {
    const failure = classifyProviderFailure({ http: 429, kairemaRateLimited: true });
    expect(failure.kind).toBe(KAIREMA_RATE_LIMIT);
    // Kairema's budget is not the provider's fault, so it is not worth spending another attempt.
    expect(failure.retryable).toBe(false);
  });

  it("does not let an upstream 429 read as a Kairema quota event", () => {
    // The two quotas are metered separately; conflating them drains the user's own budget because
    // of somebody else's rate limiter.
    expect(classifyProviderFailure({ http: 429 }).kind).not.toBe(KAIREMA_RATE_LIMIT);
  });

  it("treats a transient 5xx as a provider outage worth retrying", () => {
    for (const status of [500, 502, 503, 504, 408]) {
      const failure = classifyProviderFailure({ http: status, body: {} });
      expect(failure.kind, String(status)).toBe(PROVIDER_UNAVAILABLE);
      expect(failure.retryable, String(status)).toBe(true);
    }
  });

  it("treats a request that never completed as a retryable network error", () => {
    const failure = classifyProviderFailure({ http: null, body: "socket hang up" });
    expect(failure.kind).toBe(NETWORK);
    expect(failure.retryable).toBe(true);
  });

  it("never retries a bad key", () => {
    for (const status of [401, 403]) {
      const failure = classifyProviderFailure({ http: status, body: { error: { message: "invalid api key" } } });
      expect(failure.kind, String(status)).toBe(AUTH);
      expect(failure.retryable, String(status)).toBe(false);
    }
  });

  it("never retries an unknown model", () => {
    const failure = classifyProviderFailure({ http: 404, body: { error: { message: "model not found" } } });
    expect(failure.kind).toBe(MODEL);
    expect(failure.retryable).toBe(false);
  });

  it("never retries a malformed request", () => {
    for (const status of [400, 422]) {
      const failure = classifyProviderFailure({ http: status, body: { error: { message: "bad request" } } });
      expect(failure.retryable, String(status)).toBe(false);
    }
  });

  it("does not mistake a daily quota exhausted for a transient rate limit", () => {
    // A daily limit is permanent for the day; retrying through it burns the whole attempt budget
    // and still fails.
    const failure = classifyProviderFailure({ http: 429, body: { error: { message: "quota exceeded for today" } } });
    expect(failure.retryable).toBe(false);
  });

  it("classifies a CORS refusal as its own kind and never retries it", () => {
    const failure = classifyProviderFailure({ http: null, cors: true, body: "blocked by cors" });
    expect(failure.kind).toBe(CORS);
    expect(failure.retryable).toBe(false);
  });

  it("reads a CORS-shaped network error as CORS rather than as a dropped connection", () => {
    // The browser reports a blocked cross-origin request as an opaque TypeError. Treating that as
    // a network drop would retry a request that can never succeed.
    const failure = classifyProviderFailure({ http: null, body: "TypeError: Failed to fetch" });
    expect(failure.kind).toBe(CORS);
    expect(failure.retryable).toBe(false);
  });

  it("reports a 200 with nothing in it as an empty response, not a success", () => {
    const failure = classifyProviderFailure({ http: 200, body: {} });
    expect(failure.kind).toBe(EMPTY_RESPONSE);
  });

  it("exposes retryability through one predicate so two call sites cannot disagree", () => {
    expect(isRetryableFailure(classifyProviderFailure({ http: 503, body: {} }))).toBe(true);
    expect(isRetryableFailure(classifyProviderFailure({ http: 401, body: {} }))).toBe(false);
  });

  it("never puts an upstream body into the user-facing message", () => {
    const secretish = "sk-live-abcdef123456 model=gpt secret-token";
    for (const status of [400, 401, 429, 500, 503]) {
      const failure = classifyProviderFailure({ http: status, body: { error: { message: secretish } } });
      expect(failure.message, String(status)).not.toContain("sk-live");
      expect(failure.message, String(status)).not.toContain("secret-token");
    }
  });

  it("falls back to UNKNOWN rather than inventing a category", () => {
    expect(classifyProviderFailure({ http: 418, body: {} }).kind).toBe(UNKNOWN);
  });
});
