import "dotenv/config";

async function checkModels() {
  const response = await fetch('https://openrouter.ai/api/v1/models', {
    headers: { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}` },
  });
  const body = await response.json();
  const models = body.data || [];
  
  // Search for minimax variants
  const minimaxModels = models.filter((m: any) => m.id.toLowerCase().includes('minimax'));
  console.log("=== MINIMAX MODELS ===");
  for (const m of minimaxModels) {
    console.log(m.id, 'context=', m.context_length);
  }
  
  // Search for gpt-oss variants
  const gptOssModels = models.filter((m: any) => m.id.toLowerCase().includes('gpt-oss'));
  console.log("\n=== GPT-OSS MODELS ===");
  for (const m of gptOssModels) {
    console.log(m.id, 'context=', m.context_length);
  }
  
  // Search for gemma variants
  const gemmaModels = models.filter((m: any) => m.id.toLowerCase().includes('gemma'));
  console.log("\n=== GEMMA MODELS ===");
  for (const m of gemmaModels) {
    console.log(m.id, 'context=', m.context_length);
  }
}

checkModels().catch(console.error);