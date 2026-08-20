import { describe, expect, it } from 'bun:test';
import { filterSelectableCopilotModels, piDriver, type RawCopilotModel } from './pi.ts';

describe('filterSelectableCopilotModels', () => {
  const model = (overrides: Partial<RawCopilotModel> = {}): RawCopilotModel => ({
    id: 'gpt-5.6-sol',
    name: 'GPT-5.6 Sol',
    modelPickerEnabled: true,
    supportsToolCalls: true,
    ...overrides,
  });

  it('keeps picker-enabled models without an explicit policy state', () => {
    expect(filterSelectableCopilotModels([model()])).toEqual([model()]);
  });

  it('excludes models that are not picker-enabled, policy-disabled, or lack tool calls', () => {
    expect(filterSelectableCopilotModels([
      model({ id: 'missing-picker', modelPickerEnabled: undefined }),
      model({ id: 'picker-disabled', modelPickerEnabled: false }),
      model({ id: 'policy-disabled', policy: { state: 'disabled' } }),
      model({ id: 'no-tools', supportsToolCalls: false }),
    ])).toEqual([]);
  });
});

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
