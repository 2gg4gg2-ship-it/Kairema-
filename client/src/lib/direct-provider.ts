/**
 * Browser-direct provider execution.
 *
 * A completion call made from the page itself, for providers whose own CORS policy allows it. The
 * user's prompt and key stay on their machine: nothing here posts to the Kairema server, and the
 * key is read from the in-memory store and attached to the provider's own endpoint.
 *
 * This is deliberately a separate path from the server one rather than a shared request builder.
 * The two differ in ways that matter — the browser cannot set some headers, cannot see the
 * response status of a CORS-rejected request, and must not be trusted with an encrypted key at
 * all — and collapsing them would blur exactly the boundary that keeps a direct key off the
 * server. They do share the stream reader and the delta extractor, which is where the parsing
 * rules actually live.
 */

import { classifyProviderFailure, type ProviderFailure } from "@shared/provider-failures";
import { isBrowserDirectCapable, providerCapability } from "@shared/provider-capabilities";
import { createReasoningFilter, readEventStream, streamDelta, type StreamOutcome } from "@shared/provider-stream";
import { parseRetryAfter } from "@shared/upstream-retry";
import { directKeyFor } from "./direct-key-store";

export type DirectChatMessage = { role: "user" | "assistant"; content: string };

export type DirectRequest = {
  providerId: string;
  model: string;
  messages: DirectChatMessage[];
  onDelta: (delta: string) => void;
  signal?: AbortSignal;
  maxTokens?: number;
  /** Injected in tests; production uses fetch. */
  fetchImpl?: typeof fetch;
};

export type DirectResult = {
  content: string;
  model: string;
  providerId: string;
  outcome: StreamOutcome;
};

export class DirectProviderError extends Error {
  constructor(public readonly failure: ProviderFailure) {
    super(failure.message);
    this.name = "DirectProviderError";
  }
}

/**
 * Refuses to build a direct request for a provider that may not be called this way.
 *
 * The check is a hard gate rather than a warning: a browser call to a provider without CORS
 * support fails in a way the page cannot distinguish from a network outage, and the user's key
 * would have been handed to a request that was never going to work. `conditional` counts as a
 * refusal for the same reason — it can be switched off for a given account.
 */
export function assertBrowserDirectAllowed(providerId: string): void {
  const capability = providerCapability(providerId);
  if (!capability) {
    throw new DirectProviderError(classifyProviderFailure({ http: null, body: "unknown provider" }));
  }
  if (!isBrowserDirectCapable(providerId)) {
    throw new DirectProviderError(
      classifyProviderFailure({ http: null, cors: true, body: `direct not allowed for ${capability.displayName}` }),
    );
  }
}

/**
 * The established direct endpoint for a provider, resolved through the same gate as a direct turn.
 *
 * <p>Exposed so a caller that needs a different request shape — the tool loop, which cannot use the
 * streaming path because tool calls arrive in a non-streamed body — reaches the endpoint by the
 * capability registry instead of re-deriving it. Going around {@link assertBrowserDirectAllowed}
 * here would be the bug this prevents.
 */
export function directChatEndpoint(providerId: string): string {
  assertBrowserDirectAllowed(providerId);
  const capability = providerCapability(providerId);
  if (!capability) throw new DirectProviderError(classifyProviderFailure({ http: null, body: "unknown provider" }));
  // Endpoints live on the capability row only where a real one is established. Today the direct
  // path has none, because no row is both CORS-allowed and implemented for a browser call; the
  // value is kept in one place so enabling a provider is a data change, not a code change.
  const endpoint = (capability as { chatEndpoint?: string }).chatEndpoint;
  if (!endpoint) {
    throw new DirectProviderError(classifyProviderFailure({ http: null, cors: true, body: "no direct endpoint" }));
  }
  return endpoint;
}

/**
 * The headers a direct request needs.
 *
 * The key goes in a header, never in the query string: a URL is copied into history, referrers
 * and proxy logs, and a key in one of those is a key in a screenshot of someone's address bar.
 * The provider's own opt-in header is added when it declares one, and for no other provider.
 */
export function directHeaders(providerId: string, apiKey: string, stream: boolean): Record<string, string> {
  const capability = providerCapability(providerId);
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (stream) headers.Accept = "text/event-stream";
  switch (capability?.auth) {
    case "x-api-key":
      headers["x-api-key"] = apiKey;
      break;
    case "x-goog-api-key":
      headers["x-goog-api-key"] = apiKey;
      break;
    case "bearer":
    default:
      headers.Authorization = `Bearer ${apiKey}`;
      break;
  }
  if (capability?.directBrowserOptInHeader) {
    headers[capability.directBrowserOptInHeader] = "true";
  }
  return headers;
}

function requestBody(request: DirectRequest, stream: boolean) {
  const body: Record<string, unknown> = { model: request.model, messages: request.messages, stream };
  if (request.maxTokens) body.max_tokens = request.maxTokens;
  return JSON.stringify(body);
}

/**
 * Runs one direct completion and streams its deltas.
 *
 * The reasoning filter runs over every chunk before anything reaches `onDelta`, so a model's
 * thinking never reaches the transcript even when the provider streams it inline alongside the
 * answer. Whitespace passes through untouched, because a delta boundary in the middle of a
 * sentence is not a place to trim.
 */
export async function runDirectChat(request: DirectRequest): Promise<DirectResult> {
  assertBrowserDirectAllowed(request.providerId);
  const apiKey = directKeyFor(request.providerId);
  if (!apiKey) {
    throw new DirectProviderError(classifyProviderFailure({ http: 401, body: "no direct key in memory" }));
  }
  const doFetch = request.fetchImpl ?? fetch;
  const endpoint = directChatEndpoint(request.providerId);
  const reasoning = createReasoningFilter();
  const parts: string[] = [];

  let response: Response;
  try {
    response = await doFetch(endpoint, {
      method: "POST",
      headers: directHeaders(request.providerId, apiKey, true),
      body: requestBody(request, true),
      ...(request.signal ? { signal: request.signal } : {}),
    });
  } catch (error) {
    // A CORS rejection reaches the page as an opaque TypeError with no status, so it is
    // classified as such rather than as a generic network drop: the action is different.
    const cors = /failed to fetch|networkerror|load failed/i.test(error instanceof Error ? error.message : String(error));
    throw new DirectProviderError(classifyProviderFailure({ http: null, body: String(error), cors }));
  }

  if (!response.ok) {
    let body: unknown = null;
    try { body = await response.json(); } catch { body = null; }
    // The provider's own window travels with the failure. Dropping it would mean retrying inside
    // a limit the provider has not lifted yet, which is how its rate limit becomes ours.
    const retryAfterMs = parseRetryAfter(response.headers?.get?.("retry-after"));
    throw new DirectProviderError(classifyProviderFailure({ http: response.status, body, retryAfterMs }));
  }

  const contentType = response.headers?.get?.("content-type") ?? "";
  const isEventStream = contentType.toLowerCase().includes("text/event-stream");
  let outcome: StreamOutcome;

  if (isEventStream && response.body) {
    outcome = await readEventStream({
      body: response.body,
      ...(request.signal ? { signal: request.signal } : {}),
      onFrame: (payload) => {
        const visible = reasoning(streamDelta(payload), false);
        if (visible) { parts.push(visible); request.onDelta(visible); }
      },
    });
    // The final flush releases a partial tag the filter is still holding.
    const tail = reasoning("", true);
    if (tail) { parts.push(tail); request.onDelta(tail); }
  } else {
    // A provider that ignores `stream: true` answers with one document.
    outcome = { finishReason: null, usage: null, error: null };
    let text = "";
    try {
      const payload = await response.json();
      text = reasoning(streamDelta(payload), true);
      if (text) { parts.push(text); request.onDelta(text); }
    } catch {
      throw new DirectProviderError(classifyProviderFailure({ http: response.status, body: "unparseable body" }));
    }
  }

  if (outcome.error) {
    throw new DirectProviderError(
      classifyProviderFailure({ http: response.status, body: { error: { message: outcome.error.message, type: outcome.error.type } } }),
    );
  }

  const content = parts.join("");
  if (!content.trim()) {
    throw new DirectProviderError(classifyProviderFailure({ http: response.status, body: "empty" }));
  }
  return { content, model: request.model, providerId: request.providerId, outcome };
}
