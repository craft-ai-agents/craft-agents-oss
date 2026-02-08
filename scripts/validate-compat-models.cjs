#!/usr/bin/env node
// Validate Anthropic-compatible and OpenAI-compatible models against OpenRouter + Vercel AI Gateway.
// Requires OPENROUTER_API_KEY and VERCEL_AI_KEY in environment.

const Anthropic = require('@anthropic-ai/sdk');

const anthropicModels = ['anthropic/claude-opus-4.6', 'anthropic/claude-sonnet-4.5', 'anthropic/claude-haiku-4.5'];
const openAiModels = ['openai/gpt-5.2-codex', 'openai/gpt-5.1-codex-mini'];
const endpoints = [
  {
    name: 'openrouter',
    anthropicUrl: 'https://openrouter.ai/api',
    openaiUrl: 'https://openrouter.ai/api/v1',
    key: process.env.OPENROUTER_API_KEY,
  },
  {
    name: 'vercel',
    anthropicUrl: 'https://ai-gateway.vercel.sh',
    openaiUrl: 'https://ai-gateway.vercel.sh/v1',
    key: process.env.VERCEL_AI_KEY,
  },
];

const missing = endpoints.filter(e => !e.key);
if (missing.length > 0) {
  console.error(`Missing API keys: ${missing.map(e => e.name).join(', ')}`);
  process.exit(1);
}

(async () => {
  for (const { name, anthropicUrl, openaiUrl, key } of endpoints) {
    const client = new Anthropic({ baseURL: anthropicUrl, authToken: key, apiKey: null });
    for (const model of anthropicModels) {
      try {
        await client.messages.create({
          model,
          max_tokens: 16,
          messages: [{ role: 'user', content: 'hi' }],
          tools: [{
            name: 'test_tool',
            description: 'Test tool',
            input_schema: { type: 'object', properties: {} },
          }],
        });
        console.log(`compat-validate ${name}: ${model} OK`);
      } catch (err) {
        console.error(`compat-validate ${name}: ${model} FAIL: ${err?.message || err}`);
        process.exitCode = 1;
      }
    }

    try {
      const response = await fetch(`${openaiUrl}/models`, {
        headers: { Authorization: `Bearer ${key}` },
      });
      if (!response.ok) {
        console.error(`compat-validate ${name}: /v1/models failed (${response.status})`);
        process.exitCode = 1;
        continue;
      }
      const payload = await response.json();
      const available = new Set((payload?.data ?? []).map(item => item.id).filter(Boolean));
      for (const model of openAiModels) {
        if (available.has(model)) {
          console.log(`compat-validate ${name}: ${model} OK`);
        } else {
          console.error(`compat-validate ${name}: ${model} FAIL: model not found`);
          process.exitCode = 1;
        }
      }
    } catch (err) {
      console.error(`compat-validate ${name}: /v1/models error: ${err?.message || err}`);
      process.exitCode = 1;
    }
  }
})();
