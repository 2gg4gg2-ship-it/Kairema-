const QUERY = "latest GPT model release 2026";
const TIMEOUT_MS = 12_000;

function errorClass(status) {
  if (status === 401 || status === 403) return "auth";
  if (status === 429) return "rate_limited";
  if (status === 404) return "not_found";
  if (status !== null && status >= 400) return "http_error";
  return "network_or_parse";
}

function summarizeSourceDates(values) {
  const parsed = values
    .filter((value) => typeof value === "string" || typeof value === "number")
    .map((value) => new Date(value))
    .filter((date) => !Number.isNaN(date.getTime()))
    .map((date) => date.toISOString().slice(0, 10))
    .sort();

  return {
    sourceDateMin: parsed[0] ?? null,
    sourceDateMax: parsed.at(-1) ?? null,
  };
}

async function request(name, configured, makeRequest, countSources, sourceDates = () => []) {
  if (!configured) {
    return {
      layer: name,
      status: "not_configured",
      http: null,
      latencyMs: 0,
      sourceCount: 0,
      reason: "missing_server_secret",
      retryAfter: false,
      sourceDateMin: null,
      sourceDateMax: null,
    };
  }

  const startedAt = Date.now();
  try {
    const response = await makeRequest(AbortSignal.timeout(TIMEOUT_MS));
    const payload = await response.json().catch(() => null);
    const sourceCount = response.ok ? countSources(payload) : 0;
    return {
      layer: name,
      status: response.ok && sourceCount > 0 ? "found" : response.ok ? "empty" : "unavailable",
      http: response.status,
      latencyMs: Date.now() - startedAt,
      sourceCount,
      reason: response.ok ? (sourceCount > 0 ? "sources_returned" : "no_usable_sources") : errorClass(response.status),
      retryAfter: Boolean(response.headers.get("retry-after")),
      ...(response.ok ? summarizeSourceDates(sourceDates(payload)) : { sourceDateMin: null, sourceDateMax: null }),
    };
  } catch (error) {
    return {
      layer: name,
      status: "unavailable",
      http: null,
      latencyMs: Date.now() - startedAt,
      sourceCount: 0,
      reason: error?.name === "TimeoutError" ? "timeout" : "network_or_parse",
      retryAfter: false,
      sourceDateMin: null,
      sourceDateMax: null,
    };
  }
}

const youKey = process.env.YOU_API_KEY?.trim();
const serperKey = process.env.SERPER_API_KEY?.trim();
const exaKey = process.env.EXA_API_KEY?.trim();
const tavilyKey = process.env.TAVILY_API_KEY?.trim();
const geminiKey = process.env.GEMINI_API_KEY?.trim();
const openrouterKey = process.env.OPENROUTER_API_KEY?.trim();

const results = [];
results.push(await request("you", Boolean(youKey), (signal) => fetch("https://ydc-index.io/v1/search", {
  method: "POST", signal, headers: { "Content-Type": "application/json", "X-API-Key": youKey }, body: JSON.stringify({ query: QUERY, count: 5, safesearch: "moderate" }),
}), (payload) => (payload?.results?.web?.length ?? 0) + (payload?.results?.news?.length ?? 0), (payload) => [...(payload?.results?.web ?? []), ...(payload?.results?.news ?? [])].map((item) => item?.published_date ?? item?.publishedAt ?? item?.date)));

results.push(await request("serper", Boolean(serperKey), (signal) => fetch("https://google.serper.dev/search", {
  method: "POST", signal, headers: { "Content-Type": "application/json", "X-API-KEY": serperKey }, body: JSON.stringify({ q: QUERY, num: 5 }),
}), (payload) => payload?.organic?.length ?? 0, (payload) => (payload?.organic ?? []).map((item) => item?.date ?? item?.publishedDate)));

results.push(await request("exa", Boolean(exaKey), (signal) => fetch("https://api.exa.ai/search", {
  method: "POST", signal, headers: { "Content-Type": "application/json", "x-api-key": exaKey }, body: JSON.stringify({ query: QUERY, numResults: 5, contents: { text: { maxCharacters: 500 } } }),
}), (payload) => payload?.results?.length ?? 0, (payload) => (payload?.results ?? []).map((item) => item?.publishedDate ?? item?.published_date)));

results.push(await request("tavily", Boolean(tavilyKey), (signal) => fetch("https://api.tavily.com/search", {
  method: "POST", signal, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ api_key: tavilyKey, query: QUERY, search_depth: "basic", max_results: 5, topic: "general" }),
}), (payload) => payload?.results?.length ?? 0, (payload) => (payload?.results ?? []).map((item) => item?.published_date ?? item?.publishedDate ?? item?.date)));

results.push(await request("google", Boolean(geminiKey), (signal) => fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent", {
  method: "POST", signal, headers: { "Content-Type": "application/json", "x-goog-api-key": geminiKey }, body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: `Find authoritative, current sources only for: ${QUERY}. Return a terse answer.` }] }], tools: [{ google_search: {} }] }),
}), (payload) => payload?.candidates?.[0]?.groundingMetadata?.groundingChunks?.length ?? 0));

results.push(await request("openrouter_online_catalog", Boolean(openrouterKey), (signal) => fetch("https://openrouter.ai/api/v1/models", {
  method: "GET", signal, headers: { Authorization: `Bearer ${openrouterKey}` },
}), (payload) => Array.isArray(payload?.data) ? payload.data.filter((item) => typeof item?.id === "string" && /:online$/i.test(item.id)).length : 0));

console.log(JSON.stringify({
  event: "v6-n.live-search-diagnostics",
  queryClass: "provided_current_release_query",
  checkedAt: new Date().toISOString(),
  results,
}, null, 2));
