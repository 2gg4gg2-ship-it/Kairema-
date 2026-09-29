/**
 * Provider capability registry.
 *
 * This is data, not integration. It records, per service, what we actually know about how the
 * service can be called, and — just as importantly — what we do not know. A service with no
 * verified entry is marked UNKNOWN and must not be offered in My API: an entry here is a claim,
 * and a wrong claim sends a user's key to an endpoint that will reject it, or worse, accepts it in
 * a shape we silently mis-parse.
 *
 * Two rules govern every row:
 *
 * 1. `displayName` is what a user reads. It is never an environment variable name, an API key
 *    variable, or an internal slug. Users connect to "OpenRouter", not to `OPENROUTER_API_KEY`.
 *
 * 2. `kind` separates services that answer a chat turn from services that do not. Search and tool
 *    services (Serper, Tavily, Exa, Firecrawl) and infrastructure (AWS) are real services with real
 *    keys, and none of them is an LLM chat provider. Having an API key for one is not a reason to
 *    offer it in a chat flow, so they are registered with `kind: "search" | "cloud"` and never
 *    become a My API candidate.
 *
 * Verification notes are kept terse and point at what the decision rested on. `UNKNOWN` means the
 * research was not conclusive, not that the service is small or unimportant.
 */

export type ProviderKind = "llm" | "search" | "cloud" | "unknown";

/** Where the completion call may legally run. "none" means the service is not a chat provider. */
export type ProviderExecution = "direct" | "server" | "none";

/**
 * How the provider refuses. `unknown` is a first-class value on purpose: guessing an auth scheme
 * produces a request that fails in a way that looks like a bad key, and the user then retypes a
 * perfectly good key.
 */
export type ProviderAuth =
  | "bearer"
  | "x-api-key"
  | "x-goog-api-key"
  | "query-param"
  | "aws-sigv4"
  | "unknown";

/** Whether the provider's own CORS policy allows a browser to call it. */
export type ProviderCors = "allowed" | "blocked" | "conditional" | "unknown";

export type ProviderStatus = "implemented" | "not_implemented" | "unknown";

export type ProviderCapability = {
  id: string;
  /** What the user sees in Settings. Never an env var or key variable. */
  displayName: string;
  kind: ProviderKind;
  status: ProviderStatus;
  execution: ProviderExecution;
  /** null = not established. Only true where the wire format is genuinely OpenAI-shaped. */
  openaiCompatible: boolean | null;
  /** null = not established. */
  streaming: boolean | null;
  auth: ProviderAuth;
  cors: ProviderCors;
  /** Header required *in addition* to the key when calling from a browser, if any. */
  directBrowserOptInHeader?: string;
  /**
   * The chat endpoint a browser may call directly, present only where one is established AND the
   * provider's CORS policy allows it.
   *
   * Kept separate from `execution`, which records where the product routes a turn *today*. A
   * provider can be server-routed today and still be safe to call from a browser later, and
   * enabling that is a data change rather than a code change. Absent means "no direct endpoint is
   * established", which the direct adapter treats as a refusal.
   */
  chatEndpoint?: string;
  /** Why this row says what it says, and what would change it. */
  notes: string;
};

const UNKNOWN_NOTES =
  "No verified public API contract was established for this service, so no request shape, auth " +
  "scheme or CORS behaviour is asserted here. Treated as not offerable in My API until verified.";

function llm(partial: Omit<ProviderCapability, "kind">): ProviderCapability {
  return { ...partial, kind: "llm" };
}
function notLlm(kind: Exclude<ProviderKind, "llm">, partial: Omit<ProviderCapability, "kind">): ProviderCapability {
  return { ...partial, kind };
}

/**
 * The registry. Order is the order Services are listed in the product brief and is not a ranking.
 */
export const PROVIDER_CAPABILITIES: readonly ProviderCapability[] = [
  // ── Implemented today ──────────────────────────────────────────────────────────────────────
  llm({
    id: "openrouter",
    displayName: "OpenRouter",
    status: "implemented",
    execution: "server",
    openaiCompatible: true,
    streaming: true,
    auth: "bearer",
    cors: "allowed",
    chatEndpoint: "https://openrouter.ai/api/v1/chat/completions",
    notes:
      "Served server-side today, and stays the default there. OpenAI-shaped chat completions with " +
      "SSE streaming, bearer auth, and a CORS policy that permits browser calls, so it is the one " +
      "service whose direct endpoint is established. Not used directly yet: the server path already " +
      "works and moving it would change where a user's prompt travels.",
  }),
  llm({
    id: "anthropic",
    displayName: "Anthropic",
    status: "implemented",
    execution: "server",
    openaiCompatible: false,
    streaming: true,
    auth: "x-api-key",
    cors: "conditional",
    directBrowserOptInHeader: "anthropic-dangerous-direct-browser-access",
    notes:
      "Native /v1/messages schema with delta.text frames, not OpenAI-shaped. Browser calls are " +
      "possible but only with the opt-in header, and the opt-in is per-organization: accounts with " +
      "CORS disabled answer 401. Treated as conditional, never as guaranteed.",
  }),

  // ── Real LLM services, not yet integrated ──────────────────────────────────────────────────
  llm({
    id: "google",
    displayName: "Google Gemini",
    status: "not_implemented",
    execution: "server",
    openaiCompatible: false,
    streaming: true,
    auth: "x-goog-api-key",
    cors: "blocked",
    notes:
      "Native contents/parts schema with a different streaming shape. CORS is unreliable for " +
      "browser calls: the endpoint omits Access-Control-Allow-Origin on several paths and error " +
      "responses in particular, so a browser request fails for reasons unrelated to the key. " +
      "Server-side only.",
  }),
  llm({
    id: "openai",
    displayName: "OpenAI",
    status: "not_implemented",
    execution: "server",
    openaiCompatible: true,
    streaming: true,
    auth: "bearer",
    cors: "conditional",
    notes:
      "OpenAI-shaped and streams SSE. The platform path already talks to a compatible gateway, but " +
      "no first-party endpoint is wired for My API and none is assumed here.",
  }),
  llm({
    id: "perplexity",
    displayName: "Perplexity",
    status: "unknown",
    execution: "server",
    openaiCompatible: null,
    streaming: null,
    auth: "bearer",
    cors: "unknown",
    notes:
      "A chat/search product. Whether the Sonar endpoints accept an OpenAI-shaped body and stream " +
      "SSE was not verified, and its search grounding changes the response contract, so both " +
      "fields stay null rather than being assumed.",
  }),
  llm({
    id: "grok",
    displayName: "Grok",
    status: "unknown",
    execution: "server",
    openaiCompatible: null,
    streaming: null,
    auth: "bearer",
    cors: "unknown",
    notes: "xAI-hosted chat models. No verified request/response contract was established for this build.",
  }),
  llm({
    id: "qwen",
    displayName: "Qwen",
    status: "unknown",
    execution: "server",
    openaiCompatible: null,
    streaming: null,
    auth: "bearer",
    cors: "unknown",
    notes:
      "Qwen Studio / DashScope. Regional endpoints and a bespoke streaming envelope are documented " +
      "variously; the exact contract for this build was not verified.",
  }),
  llm({
    id: "kimi",
    displayName: "Kimi",
    status: "unknown",
    execution: "server",
    openaiCompatible: null,
    streaming: null,
    auth: "bearer",
    cors: "unknown",
    notes: "Moonshot-hosted models. No verified contract established for this build.",
  }),
  llm({
    id: "groq",
    displayName: "Groq",
    status: "unknown",
    execution: "server",
    openaiCompatible: null,
    streaming: null,
    auth: "bearer",
    cors: "unknown",
    notes:
      "Appears on the platform provider list, which is a routing concern, not proof that the " +
      "first-party API contract is compatible. Left unknown until the endpoint is verified.",
  }),
  llm({
    id: "mistral",
    displayName: "Mistral",
    status: "unknown",
    execution: "server",
    openaiCompatible: null,
    streaming: null,
    auth: "bearer",
    cors: "unknown",
    notes: "Also on the platform list. First-party contract not verified for this build.",
  }),
  llm({
    id: "cerebras",
    status: "unknown",
    displayName: "Cerebras",
    execution: "server",
    openaiCompatible: null,
    streaming: null,
    auth: "bearer",
    cors: "unknown",
    notes: "Also on the platform list. First-party contract not verified for this build.",
  }),
  llm({
    id: "sambanova",
    displayName: "SambaNova",
    status: "unknown",
    execution: "server",
    openaiCompatible: null,
    streaming: null,
    auth: "bearer",
    cors: "unknown",
    notes: "Also on the platform list. First-party contract not verified for this build.",
  }),
  llm({
    id: "chatgpt",
    displayName: "ChatGPT",
    status: "not_implemented",
    execution: "none",
    openaiCompatible: null,
    streaming: null,
    auth: "unknown",
    cors: "unknown",
    notes:
      "ChatGPT is a product surface, not an API. A subscription does not grant an API key, and the " +
      "platform path already serves models. Not offerable as a BYOK provider.",
  }),
  llm({
    id: "claude",
    displayName: "Claude",
    status: "not_implemented",
    execution: "none",
    openaiCompatible: null,
    streaming: null,
    auth: "unknown",
    cors: "unknown",
    notes:
      "The consumer chat product, the same way ChatGPT is a product. The Anthropic API is the " +
      "integrable surface and is already registered under its own name.",
  }),

  // ── Gateways and routers ────────────────────────────────────────────────────────────────────
  llm({
    id: "zenmux",
    displayName: "ZenMux",
    status: "unknown",
    execution: "server",
    openaiCompatible: null,
    streaming: null,
    auth: "bearer",
    cors: "unknown",
    notes: "On the platform provider list. First-party contract not verified for this build.",
  }),
  llm({
    id: "orcarouter",
    displayName: "OrcaRouter",
    status: "unknown",
    execution: "server",
    openaiCompatible: null,
    streaming: null,
    auth: "bearer",
    cors: "unknown",
    notes: "On the platform provider list. First-party contract not verified for this build.",
  }),
  llm({
    id: "nararouter",
    displayName: "NaraRouter",
    status: "unknown",
    execution: "server",
    openaiCompatible: null,
    streaming: null,
    auth: "bearer",
    cors: "unknown",
    notes: "No verified contract established for this build.",
  }),
  llm({
    id: "teamorouter",
    displayName: "TeamORouter",
    status: "unknown",
    execution: "server",
    openaiCompatible: null,
    streaming: null,
    auth: "bearer",
    cors: "unknown",
    notes: "No verified contract established for this build.",
  }),
  llm({
    id: "tokenharbor",
    displayName: "Token Harbor",
    status: "unknown",
    execution: "server",
    openaiCompatible: null,
    streaming: null,
    auth: "bearer",
    cors: "unknown",
    notes: "No verified contract established for this build.",
  }),
  llm({
    id: "you",
    displayName: "You.com",
    status: "unknown",
    execution: "server",
    openaiCompatible: null,
    streaming: null,
    auth: "bearer",
    cors: "unknown",
    notes: "No verified contract established for this build.",
  }),
  llm({
    id: "bazaarlink",
    displayName: "BazaarLink",
    status: "unknown",
    execution: "server",
    openaiCompatible: null,
    streaming: null,
    auth: "bearer",
    cors: "unknown",
    notes: "No verified contract established for this build.",
  }),
  llm({
    id: "cometapi",
    displayName: "CometAPI",
    status: "unknown",
    execution: "server",
    openaiCompatible: null,
    streaming: null,
    auth: "bearer",
    cors: "unknown",
    notes: "No verified contract established for this build.",
  }),
  llm({
    id: "keiro",
    displayName: "Keiro Labs",
    status: "unknown",
    execution: "server",
    openaiCompatible: null,
    streaming: null,
    auth: "bearer",
    cors: "unknown",
    notes: "No verified contract established for this build.",
  }),

  // ── Search and tool services: real keys, not chat providers ─────────────────────────────────
  notLlm("search", {
    id: "serper",
    displayName: "Serper",
    status: "not_implemented",
    execution: "none",
    openaiCompatible: false,
    streaming: false,
    auth: "unknown",
    cors: "unknown",
    notes:
      "A search-results API. It returns SERP data, not chat completions, and has no streaming " +
      "chat endpoint. Deliberately excluded from My API despite being a real service with a key.",
  }),
  notLlm("search", {
    id: "tavily",
    displayName: "Tavily",
    status: "not_implemented",
    execution: "none",
    openaiCompatible: false,
    streaming: false,
    auth: "unknown",
    cors: "unknown",
    notes: "A search and extraction API, not a chat completion provider. Excluded from My API.",
  }),
  notLlm("search", {
    id: "exa",
    displayName: "Exa",
    status: "not_implemented",
    execution: "none",
    openaiCompatible: false,
    streaming: false,
    auth: "unknown",
    cors: "unknown",
    notes: "A search API. Not a chat completion provider. Excluded from My API.",
  }),
  notLlm("search", {
    id: "firecrawl",
    displayName: "Firecrawl",
    status: "not_implemented",
    execution: "none",
    openaiCompatible: false,
    streaming: false,
    auth: "unknown",
    cors: "unknown",
    notes: "A scraping and crawling API. Not a chat completion provider. Excluded from My API.",
  }),

  // ── Infrastructure ─────────────────────────────────────────────────────────────────────────
  notLlm("cloud", {
    id: "aws",
    displayName: "Amazon Web Services",
    status: "not_implemented",
    execution: "none",
    openaiCompatible: null,
    streaming: null,
    auth: "aws-sigv4",
    cors: "unknown",
    notes:
      "Cloud infrastructure. It hosts models on Bedrock but is not itself a chat provider, and its " +
      "auth is SigV4 request signing, not a bearer key. An AWS access key must never be pasted " +
      "into a chat provider field, so it is not offerable here.",
  }),
];

/** Custom (user-defined) OpenAI-compatible endpoints: the one path that needs no per-vendor row. */
export const CUSTOM_PROVIDER_CAPABILITY: ProviderCapability = {
  id: "custom",
  displayName: "Свой провайдер",
  kind: "llm",
  status: "implemented",
  execution: "server",
  openaiCompatible: true,
  streaming: true,
  auth: "bearer",
  cors: "blocked",
  notes:
    "A user-supplied OpenAI-compatible base URL, already end-to-end today. Never browser-direct: " +
    "the endpoint is arbitrary, so its CORS behaviour is unknown and a browser call would be a " +
    "leak attempt against a host we know nothing about.",
};

const BY_ID = new Map<string, ProviderCapability>([
  ...PROVIDER_CAPABILITIES.map((entry) => [entry.id, entry] as const),
  [CUSTOM_PROVIDER_CAPABILITY.id, CUSTOM_PROVIDER_CAPABILITY],
]);

export function providerCapability(id: string): ProviderCapability | undefined {
  return BY_ID.get(id);
}

/**
 * The providers a user may actually connect in My API.
 *
 * Requires all four: it is a chat provider, its contract is established, it is implemented, and
 * we know where the call may run. Search services and cloud providers are excluded by `kind`, and
 * anything still UNKNOWN is excluded for the same reason an unimplemented one is — we would be
 * guessing at the wire format.
 */
export function offerableUserProviders(): ProviderCapability[] {
  return PROVIDER_CAPABILITIES.filter(
    (entry) => entry.kind === "llm" && entry.status === "implemented" && entry.execution !== "none",
  );
}

export function isOfferableUserProvider(id: string): boolean {
  return offerableUserProviders().some((entry) => entry.id === id);
}

/**
 * A provider may only be called from the browser when its CORS behaviour is actually established
 * as allowed. "conditional" and "unknown" are both refusals: a conditional one can be switched off
 * for the account, and an unknown one may be blocked outright.
 */
export function isBrowserDirectCapable(id: string): boolean {
  const entry = BY_ID.get(id);
  return Boolean(entry && entry.kind === "llm" && entry.cors === "allowed" && entry.execution !== "none");
}

/**
 * Where a given turn for this provider may actually run, and why.
 *
 * This is the single decision point for execution mode. The application asks this and acts on the
 * answer; it never tests a provider id itself. A scattered `if (provider === "openrouter")` is how
 * a second provider quietly gets the wrong transport, and how Anthropic ends up sent through a
 * browser path its CORS policy may not permit for the account at hand.
 *
 * Direct is requested explicitly, never inferred. A provider whose CORS is merely `conditional` is
 * answered `server` even when direct is requested, because "conditional" means the opt-in is
 * per-organization and a wrong answer there is a key handed to a call that will be refused — or
 * worse, a CORS failure the user sees as an outage.
 */
export function resolveExecution(
  id: string,
  options: { preferDirect: boolean },
): { mode: "direct" | "server"; reason: string } {
  const entry = BY_ID.get(id);
  if (!entry) return { mode: "server", reason: "unknown provider" };
  if (entry.execution === "none") return { mode: "server", reason: `${entry.displayName} is not a chat provider` };
  if (!options.preferDirect) return { mode: "server", reason: "server execution requested" };
  if (entry.kind !== "llm") return { mode: "server", reason: `${entry.displayName} is not a chat provider` };
  if (entry.status !== "implemented") return { mode: "server", reason: `${entry.displayName} is not implemented` };
  if (entry.cors !== "allowed") {
    return { mode: "server", reason: `${entry.displayName} does not guarantee a direct browser call` };
  }
  if (!entry.chatEndpoint) return { mode: "server", reason: `${entry.displayName} has no established direct endpoint` };
  return { mode: "direct", reason: `${entry.displayName} allows a direct browser call` };
}

/** True when this provider's turn may run in the browser under an explicit direct preference. */
export function usesDirectExecution(id: string, preferDirect: boolean): boolean {
  return resolveExecution(id, { preferDirect }).mode === "direct";
}
