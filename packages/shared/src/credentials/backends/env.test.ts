import { afterEach, describe, expect, test } from 'bun:test';
import { EnvironmentBackend } from './env.ts';

const ENV_KEYS = [
  'ANTHROPIC_API_KEY',
  'OPENROUTER_API_KEY',
  'RUNNER_LLM_DEEPSEEK_API_KEY',
  'YOUTUBE_API_KEY',
  'RUNNER_SOURCE_YOUTUBE_RESEARCH_API_KEY',
  'RUNNER_SOURCE_FOO_BEARER_TOKEN',
  'RUNNER_MESSAGING_TELEGRAM_TOKEN',
];

afterEach(() => {
  for (const key of ENV_KEYS) {
    delete process.env[key];
  }
});

describe('EnvironmentBackend', () => {
  test('is a read-only available fallback backend', async () => {
    const backend = new EnvironmentBackend();

    expect(await backend.isAvailable()).toBe(true);
    expect(backend.priority).toBeLessThan(100);
    await expect(backend.set({ type: 'anthropic_api_key' }, { value: 'x' })).rejects.toThrow('read-only');
  });

  test('resolves legacy Anthropic key', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test-anthropic';

    const credential = await new EnvironmentBackend().get({ type: 'anthropic_api_key' });

    expect(credential).toEqual({ value: 'sk-test-anthropic', source: 'environment' });
  });

  test('resolves LLM connection keys by runner prefix and provider alias', async () => {
    const backend = new EnvironmentBackend();
    process.env.RUNNER_LLM_DEEPSEEK_API_KEY = 'deepseek-runner-key';
    process.env.OPENROUTER_API_KEY = 'openrouter-key';

    await expect(backend.get({ type: 'llm_api_key', connectionSlug: 'deepseek' }))
      .resolves.toEqual({ value: 'deepseek-runner-key', source: 'environment' });
    await expect(backend.get({ type: 'llm_api_key', connectionSlug: 'openrouter-owl-alpha' }))
      .resolves.toEqual({ value: 'openrouter-key', source: 'environment' });
  });

  test('resolves source API keys from runner prefix before provider alias', async () => {
    process.env.RUNNER_SOURCE_YOUTUBE_RESEARCH_API_KEY = 'runner-youtube-key';
    process.env.YOUTUBE_API_KEY = 'legacy-youtube-key';

    const credential = await new EnvironmentBackend().get({
      type: 'source_apikey',
      workspaceId: 'ws',
      sourceId: 'youtube-research',
    });

    expect(credential).toEqual({ value: 'runner-youtube-key', source: 'environment' });
  });

  test('resolves source bearer and messaging tokens', async () => {
    const backend = new EnvironmentBackend();
    process.env.RUNNER_SOURCE_FOO_BEARER_TOKEN = 'source-token';
    process.env.RUNNER_MESSAGING_TELEGRAM_TOKEN = 'telegram-token';

    await expect(backend.get({ type: 'source_bearer', workspaceId: 'ws', sourceId: 'foo' }))
      .resolves.toEqual({ value: 'source-token', source: 'environment' });
    await expect(backend.get({ type: 'messaging_bearer', workspaceId: 'ws', name: 'telegram' }))
      .resolves.toEqual({ value: 'telegram-token', source: 'environment' });
  });
});
