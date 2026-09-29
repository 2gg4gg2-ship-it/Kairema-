import "dotenv/config";

async function checkModels() {
  const response = await fetch('https://openrouter.ai/api/v1/models', {
    headers: { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}` },
  });
  const body = await response.json();
  const models = body.data || [];
  const targets = [
    'minimax/minimax-m3:free',
    'google/gemma-4-26b-a4b-it:free',
    'nvidia/nemotron-3-ultra-550b-a55b:free',
    'google/gemma-4-31b-it:free',
    'openai/gpt-oss-20b:free',
  ];
  for (const target of targets) {
    const found = models.find((m: any) => m.id === target);
    console.log(target, found ? 'EXISTS' : 'NOT FOUND', found ? 'context_length=' + (found.context_length || 'unknown') : '');
  }
}

checkModels().catch(console.error);