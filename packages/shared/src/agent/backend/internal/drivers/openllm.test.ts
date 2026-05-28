import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { openllmDriver } from './openllm.ts';

const savedOpenLlmHost = process.env.OPENLLM_HOST;

function buildRuntime(model: string) {
  return openllmDriver.buildRuntime({
    context: {
      provider: 'pi',
      authType: 'api_key',
      resolvedModel: model,
      capabilities: { needsHttpPoolServer: false },
      connection: {
        slug: 'openllm',
        name: 'OpenLLM',
        providerType: 'openllm',
        authType: 'api_key',
        defaultModel: model,
        createdAt: Date.now(),
      },
    },
    coreConfig: {} as any,
    hostRuntime: {} as any,
    resolvedPaths: {
      piServerPath: '/tmp/pi-agent-server.js',
      interceptorBundlePath: '/tmp/interceptor.cjs',
      nodeRuntimePath: '/usr/bin/node',
    },
  });
}

describe('openllmDriver.buildRuntime', () => {
  beforeEach(() => {
    process.env.OPENLLM_HOST = 'http://myserver:8000';
  });

  afterEach(() => {
    if (savedOpenLlmHost === undefined) delete process.env.OPENLLM_HOST;
    else process.env.OPENLLM_HOST = savedOpenLlmHost;
  });

  it('constructs baseUrl from OPENLLM_HOST using the unified /v1 endpoint', () => {
    expect(buildRuntime('llama-3').baseUrl).toBe('http://myserver:8000/v1');
  });

  it('uses the same baseUrl regardless of model (model is passed in request body)', () => {
    expect(buildRuntime('mistral-7b').baseUrl).toBe('http://myserver:8000/v1');
  });

  it('throws a clear error when OPENLLM_HOST is missing', () => {
    delete process.env.OPENLLM_HOST;

    expect(() => buildRuntime('llama-3')).toThrow(/OPENLLM_HOST/);
  });
});
