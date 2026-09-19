import "dotenv/config";

const ENDPOINTS: Record<string, string> = {
  openrouter: "https://openrouter.ai/api/v1/chat/completions",
  orcarouter: "https://api.orcarouter.ai/v1/chat/completions",
  zenmux: "https://zenmux.ai/api/v1/chat/completions",
  dots: "https://zenmux.ai/api/v1/chat/completions",
  google: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
  groq: "https://api.groq.com/openai/v1/chat/completions",
  sambanova: "https://api.sambanova.ai/v1/chat/completions",
  mistral: "https://api.mistral.ai/v1/chat/completions",
  cerebras: "https://api.cerebras.ai/v1/chat/completions",
  deepseek: "https://api.deepseek.com/chat/completions",
};

function secretFor(provider: string): string | undefined {
  const envName = provider === "openrouter"
    ? "OPENROUTER_API_KEY"
    : provider === "orcarouter"
      ? "ORCAROUTER_API_KEY"
      : provider === "zenmux"
        ? "ZENMUX_API_KEY"
      : provider === "dots"
        ? "API_KEY_DOTS3"
      : provider === "google"
      ? "GEMINI_API_KEY"
      : provider === "groq"
        ? "GROQ_API_KEY"
        : provider === "sambanova"
          ? "SAMBANOVA_API_KEY"
          : provider === "mistral"
            ? "MISTRAL_API_KEY"
            : provider === "cerebras"
              ? "CEREBRAS_API_KEY"
              : "DEEPSEEK_API_KEY";
  return process.env[envName]?.trim();
}

const MODEL_ROLES = [
  { key: "fast", label: "Kairema Flash", chain: [
    { provider: "openrouter", modelId: "minimax/minimax-m3:free", displayName: "MiniMax M3" },
    { provider: "orcarouter", modelId: "deepseek/deepseek-v4-flash-free", displayName: "DeepSeek V4 Flash" },
    { provider: "groq", modelId: "openai/gpt-oss-20b", displayName: "GPT-OSS 20B" },
    { provider: "google", modelId: "gemini-flash-lite-latest", displayName: "Gemini Flash Lite", vision: true, requiresWebResearch: true },
  ] },
  { key: "smart", label: "Kairema Think", chain: [
    { provider: "openrouter", modelId: "google/gemma-4-26b-a4b-it:free", displayName: "Gemma 4 26B" },
    { provider: "orcarouter", modelId: "tencent/hy3-free", displayName: "Tencent HY 3" },
    { provider: "google", modelId: "gemini-flash-lite-latest", displayName: "Gemini Flash Lite", vision: true, requiresWebResearch: true },
    { provider: "groq", modelId: "openai/gpt-oss-120b", displayName: "GPT-OSS 120B" },
  ] },
  { key: "context", label: "Kairema Context", chain: [
    { provider: "openrouter", modelId: "nvidia/nemotron-3-ultra-550b-a55b:free", displayName: "Nemotron 3 Ultra" },
    { provider: "orcarouter", modelId: "deepseek/deepseek-v4-flash-free", displayName: "DeepSeek V4 Flash" },
    { provider: "google", modelId: "gemini-flash-lite-latest", displayName: "Gemini Flash Lite", vision: true, requiresWebResearch: true },
    { provider: "groq", modelId: "openai/gpt-oss-120b", displayName: "GPT-OSS 120B" },
    { provider: "dots", modelId: "dots-studio/dots3-note-prev", displayName: "Dots Studio" },
  ] },
  { key: "flagship", label: "Kairema Apex", chain: [
    { provider: "openrouter", modelId: "google/gemma-4-31b-it:free", displayName: "Gemma 4 31B" },
    { provider: "orcarouter", modelId: "orcarouter/free", displayName: "OrcaRouter Free" },
    { provider: "google", modelId: "gemini-flash-lite-latest", displayName: "Gemini Flash Lite", vision: true, requiresWebResearch: true },
    { provider: "groq", modelId: "openai/gpt-oss-120b", displayName: "GPT-OSS 120B" },
  ] },
];

const PROBE_CANDIDATES = {
  openrouter: { provider: "openrouter", modelId: "openai/gpt-oss-20b:free", displayName: "health probe" },
  orcarouter: { provider: "orcarouter", modelId: "orcarouter/free", displayName: "diagnostic health probe" },
  zenmux: { provider: "zenmux", modelId: "z-ai/glm-4.7-flash-free", displayName: "diagnostic health probe" },
  dots: { provider: "dots", modelId: "dots-studio/dots3-note-prev", displayName: "diagnostic health probe" },
  google: { provider: "google", modelId: "gemini-flash-lite-latest", displayName: "health probe" },
  groq: { provider: "groq", modelId: "openai/gpt-oss-20b", displayName: "health probe" },
  sambanova: { provider: "sambanova", modelId: "Meta-Llama-3.3-70B-Instruct", displayName: "health probe" },
  mistral: { provider: "mistral", modelId: "codestral-2508", displayName: "health probe" },
  deepseek: { provider: "deepseek", modelId: "deepseek-chat", displayName: "health probe" },
  cerebras: { provider: "cerebras", modelId: "gpt-oss-120b", displayName: "health probe" },
};

async function testModel(provider: string, modelId: string, displayName: string, roleKey: string) {
  const key = secretFor(provider);
  if (!key) {
    return { provider, modelId, displayName, role: roleKey, configured: false, httpStatus: null, success: false, error: "API key not configured", latencyMs: 0 };
  }
  
  const headers: Record<string, string> = { Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
  if (provider === "openrouter") { headers["HTTP-Referer"] = "https://kairema.manus.space"; headers["X-Title"] = "Kairema"; }
  
  const startedAt = Date.now();
  try {
    const response = await fetch(ENDPOINTS[provider], {
      method: "POST",
      headers,
      body: JSON.stringify({ 
        model: modelId, 
        messages: [{ role: "user", content: "Ответь ровно одним словом: Готово" }],
        max_tokens: 10,
      }),
      signal: AbortSignal.timeout(25_000),
    });
    const latencyMs = Date.now() - startedAt;
    let body: unknown = null;
    try { body = await response.json(); } catch { body = { message: await response.text().catch(() => "") }; }
    
    if (response.ok) {
      const content = (body as any)?.choices?.[0]?.message?.content;
      return { provider, modelId, displayName, role: roleKey, configured: true, httpStatus: response.status, success: true, content: typeof content === "string" ? content.slice(0, 100) : null, latencyMs };
    } else {
      return { provider, modelId, displayName, role: roleKey, configured: true, httpStatus: response.status, success: false, error: JSON.stringify(body), latencyMs };
    }
  } catch (error) {
    const latencyMs = Date.now() - startedAt;
    return { provider, modelId, displayName, role: roleKey, configured: true, httpStatus: null, success: false, error: error instanceof Error ? error.message : String(error), latencyMs };
  }
}

async function runAllTests() {
  console.log("=== KAIREMA PROVIDER/MODEL LIVE TEST ===\n");
  
  // Test health probes
  console.log("--- HEALTH PROBES ---");
  for (const [provider, candidate] of Object.entries(PROBE_CANDIDATES)) {
    const result = await testModel(provider, candidate.modelId, candidate.displayName, "probe");
    console.log(JSON.stringify(result, null, 2));
  }
  
  // Test role chains
  console.log("\n--- ROLE CHAINS ---");
  for (const role of MODEL_ROLES) {
    console.log(`\n=== ${role.key.toUpperCase()} (${role.label}) ===`);
    for (const candidate of role.chain) {
      const result = await testModel(candidate.provider, candidate.modelId, candidate.displayName, role.key);
      console.log(JSON.stringify(result, null, 2));
    }
  }
  
  // Test web search
  console.log("\n--- WEB SEARCH ---");
  const searchLayers = [
    { name: "you", endpoint: "https://ydc-index.io/v1/search", key: process.env.YOU_API_KEY?.trim(), body: { query: "test query", count: 1 } },
    { name: "serper", endpoint: "https://google.serper.dev/search", key: process.env.SERPER_API_KEY?.trim(), body: { q: "test query", num: 1 } },
    { name: "exa", endpoint: "https://api.exa.ai/search", key: process.env.EXA_API_KEY?.trim(), body: { query: "test query", numResults: 1, contents: { text: { maxCharacters: 100 } } } },
    { name: "tavily", endpoint: "https://api.tavily.com/search", key: process.env.TAVILY_API_KEY?.trim(), body: { query: "test query", max_results: 1, search_depth: "basic" } },
  ];
  
  for (const layer of searchLayers) {
    if (!layer.key) {
      console.log(JSON.stringify({ provider: layer.name, configured: false, error: "API key not configured" }));
      continue;
    }
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (layer.name === "you") headers["X-API-Key"] = layer.key;
    else if (layer.name === "serper") headers["X-API-KEY"] = layer.key;
    else if (layer.name === "exa") headers["x-api-key"] = layer.key;
    else if (layer.name === "tavily") headers["Authorization"] = `Bearer ${layer.key}`;
    
    const startedAt = Date.now();
    try {
      const response = await fetch(layer.endpoint, { method: "POST", headers, body: JSON.stringify(layer.body), signal: AbortSignal.timeout(10_000) });
      const latencyMs = Date.now() - startedAt;
      let body: unknown = null;
      try { body = await response.json(); } catch { body = { message: await response.text().catch(() => "") }; }
      console.log(JSON.stringify({ provider: layer.name, configured: true, httpStatus: response.status, success: response.ok, latencyMs, resultCount: Array.isArray((body as any)?.results) ? (body as any).results.length : Array.isArray((body as any)?.organic) ? (body as any).organic.length : "unknown" }));
    } catch (error) {
      console.log(JSON.stringify({ provider: layer.name, configured: true, httpStatus: null, success: false, error: error instanceof Error ? error.message : String(error), latencyMs: Date.now() - startedAt }));
    }
  }
  
  // Test OpenRouter models endpoint
  console.log("\n--- OPENROUTER MODELS LIST ---");
  try {
    const response = await fetch("https://openrouter.ai/api/v1/models", {
      headers: { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}` },
      signal: AbortSignal.timeout(10_000),
    });
    const body = await response.json();
    const models = (body.data || []).map((m: any) => m.id).filter((id: string) => 
      id.includes("minimax") || id.includes("gemma-4") || id.includes("nemotron") || id.includes("glm") || id.includes("deepseek") || id.includes("qwen")
    );
    console.log("Available relevant models:", models.slice(0, 20));
  } catch (error) {
    console.log("Failed to fetch OpenRouter models:", error instanceof Error ? error.message : String(error));
  }
}

runAllTests().catch(console.error);