import { describe, expect, it } from 'bun:test';
import { piDriver } from './pi.ts';
import '../../../../../tests/setup/register-pi-model-resolver.ts';
import { getDefaultModelForConnection, getDefaultModelsForConnection } from '../../../../config/llm-connections.ts';

describe('piDriver.buildRuntime custom endpoint models', () => {
  it('preserves explicit per-model supportsImages values', () => {
    const runtime = piDriver.buildRuntime({
      context: {
        provider: 'pi',
        authType: 'api_key',
        resolvedModel: 'vision-model',
        capabilities: { needsHttpPoolServer: false },
        connection: {
          slug: 'custom-endpoint',
          name: 'Custom Endpoint',
          providerType: 'pi',
          authType: 'api_key',
          baseUrl: 'http://127.0.0.1:11111/v1',
          customEndpoint: { api: 'anthropic-messages', supportsImages: true },
          models: [
            { id: 'vision-model', contextWindow: 262_144, supportsImages: true },
            { id: 'text-only-model', supportsImages: false },
            { id: 'plain-model' },
          ],
          createdAt: Date.now(),
        } as any,
      },
      coreConfig: {} as any,
      hostRuntime: {} as any,
      resolvedPaths: {
        piServerPath: '/tmp/pi-agent-server.js',
        interceptorBundlePath: '/tmp/interceptor.cjs',
        nodeRuntimePath: '/usr/bin/node',
      },
    });

    expect(runtime.customModels).toEqual([
      { id: 'vision-model', contextWindow: 262_144, supportsImages: true },
      { id: 'text-only-model', supportsImages: false },
      'plain-model',
    ]);
  });
});

describe('piDriver.fetchModels', () => {
  // The model refresh keeps a connection's default only while the list still has it, and
  // otherwise takes the first model. In the catalog's alphabetical order that was a mini
  // model: ChatGPT connections left on gpt-5.5 (dropped in Pi 1.4) moved to gpt-5.6-luna.
  it("lists a provider's models in Craft's preference order", async () => {
    const { models } = await piDriver.fetchModels!({
      connection: { slug: 'chatgpt', name: 'ChatGPT', providerType: 'pi', authType: 'oauth', piAuthProvider: 'openai-codex', defaultModel: 'pi/gpt-5.5', createdAt: 0 } as any,
      credentials: {},
      timeoutMs: 1_000,
      hostRuntime: {} as any,
      resolvedPaths: {} as any,
    });

    expect(models[0]!.id).toBe(getDefaultModelForConnection('pi', 'openai-codex'));
    expect(models.map(m => m.id)).toEqual(
      getDefaultModelsForConnection('pi', 'openai-codex').map(m => typeof m === 'string' ? m : m.id),
    );
  });
});
