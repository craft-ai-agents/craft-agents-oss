import { describe, expect, it } from 'bun:test';
import type { ModelRegistry } from '@earendil-works/pi-coding-agent';
import { validateTitle } from '../../shared/src/utils/title-generator.ts';
import { queryMiniModel } from './mini-model-query.ts';

function registry(providers: Record<string, string[]>): ModelRegistry {
  const models = Object.entries(providers).flatMap(([provider, ids]) =>
    ids.map(id => ({ id, name: id, provider })),
  );
  return {
    find: (provider: string, id: string) => models.find(m => m.provider === provider && m.id === id),
    getAll: () => models,
  } as unknown as ModelRegistry;
}

function rejection(model: string): Error {
  return new Error(`Codex error: The '${model.replace(/^pi\//, '')}' model is not supported when using Codex with a ChatGPT account.`);
}

const codexOptions = {
  model: 'pi/gpt-5.4-mini',
  miniModel: 'pi/gpt-5.4-mini',
  sessionModel: 'pi/gpt-5.4',
  authProvider: 'openai-codex',
  modelRegistry: registry({
    'openai-codex': ['gpt-5.4-mini', 'gpt-5.4', 'gpt-5.5'],
    openai: ['gpt-5-mini'],
    anthropic: ['claude-haiku-4-5'],
  }),
  customEndpointOnly: false,
};

describe('queryMiniModel', () => {
  it('regenerates a title with the session model when ChatGPT rejects the configured mini', async () => {
    const tried: string[] = [];
    const result = await queryMiniModel(codexOptions, async model => {
      tried.push(model);
      if (model === 'pi/gpt-5.4-mini') throw rejection(model);
      return 'Fix ChatGPT Title Regeneration';
    });

    expect(tried).toEqual(['pi/gpt-5.4-mini', 'pi/gpt-5.4']);
    expect(result.model).toBe('pi/gpt-5.4');
    expect(validateTitle(result.text)).toBe('Fix ChatGPT Title Regeneration');
  });

  it('keeps a working mini model, including on accounts that support it', async () => {
    const tried: string[] = [];
    const result = await queryMiniModel(codexOptions, async model => {
      tried.push(model);
      return 'A Title';
    });
    expect(tried).toEqual(['pi/gpt-5.4-mini']);
    expect(result).toEqual({ text: 'A Title', model: 'pi/gpt-5.4-mini' });
  });

  it('tries provider catalog alternatives when the session model is also rejected', async () => {
    const tried: string[] = [];
    const result = await queryMiniModel(codexOptions, async model => {
      tried.push(model);
      if (model !== 'gpt-5.5') throw rejection(model);
      return 'Recovered';
    });
    expect(tried).toEqual(['pi/gpt-5.4-mini', 'pi/gpt-5.4', 'gpt-5.5']);
    expect(result.model).toBe('gpt-5.5');
  });

  it('continues past a catalog model that resolves locally but is unavailable to the account', async () => {
    const tried: string[] = [];
    const result = await queryMiniModel({
      ...codexOptions,
      sessionModel: undefined,
      modelRegistry: registry({ 'openai-codex': ['gpt-5.4-mini', 'gpt-6-astra', 'gpt-5.5'] }),
    }, async model => {
      tried.push(model);
      if (model !== 'gpt-5.5') throw rejection(model);
      return 'Recovered';
    });
    expect(tried).toEqual(['pi/gpt-5.4-mini', 'gpt-6-astra', 'gpt-5.5']);
    expect(result.model).toBe('gpt-5.5');
  });

  it('never retries the same model through prefixed and bare aliases', async () => {
    const tried: string[] = [];
    const error = rejection('gpt-5.5');
    await expect(queryMiniModel({
      ...codexOptions,
      model: 'pi/gpt-5.5',
      miniModel: 'gpt-5.5',
      sessionModel: 'pi/gpt-5.5',
      modelRegistry: registry({ 'openai-codex': ['gpt-5.5'] }),
    }, async model => {
      tried.push(model);
      throw error;
    })).rejects.toBe(error);
    expect(tried).toEqual(['pi/gpt-5.5']);
  });

  it.each([
    'HTTP 401: Unauthorized',
    'rate limit exceeded',
    'Ephemeral query cancelled',
    "The 'temperature' parameter is not supported",
  ])('does not switch models for unrelated errors: %s', async message => {
    const tried: string[] = [];
    const error = new Error(message);
    await expect(queryMiniModel(codexOptions, async model => {
      tried.push(model);
      throw error;
    })).rejects.toBe(error);
    expect(tried).toEqual(['pi/gpt-5.4-mini']);
  });

  it('does not send OAuth utility requests to OpenAI API-key or Anthropic models', async () => {
    const tried: string[] = [];
    const error = rejection('gpt-5.4-mini');
    await expect(queryMiniModel({
      ...codexOptions,
      sessionModel: 'pi/gpt-5.5',
      modelRegistry: registry({
        'openai-codex': ['gpt-5.4-mini'],
        openai: ['gpt-5-mini', 'gpt-5.5', 'gpt-6-astra'],
        anthropic: ['claude-haiku-4-5'],
      }),
    }, async model => {
      tried.push(model);
      throw error;
    })).rejects.toBe(error);
    expect(tried).toEqual(['pi/gpt-5.4-mini']);
  });

  it('skips known denied Codex mini fallbacks even if they resolve in the registry', async () => {
    const tried: string[] = [];
    const result = await queryMiniModel({
      ...codexOptions,
      sessionModel: 'pi/gpt-5.1-codex-mini',
      modelRegistry: registry({ 'openai-codex': ['gpt-5.4-mini', 'gpt-5.1-codex-mini', 'gpt-5.5'] }),
    }, async model => {
      tried.push(model);
      if (model === 'pi/gpt-5.4-mini') throw rejection(model);
      return 'Recovered';
    });
    expect(tried).toEqual(['pi/gpt-5.4-mini', 'gpt-5.5']);
    expect(result.model).toBe('gpt-5.5');
  });

  it('preserves the cheap OpenAI API-key fallback before trying a larger session model', async () => {
    const tried: string[] = [];
    const result = await queryMiniModel({
      ...codexOptions,
      authProvider: 'openai',
      modelRegistry: registry({ openai: ['gpt-5.4-mini', 'gpt-5-mini', 'gpt-5.4'] }),
    }, async model => {
      tried.push(model);
      if (model === 'pi/gpt-5.4-mini') throw new Error('model_not_found');
      return 'API Title';
    });
    expect(tried).toEqual(['pi/gpt-5.4-mini', 'pi/gpt-5-mini']);
    expect(result.model).toBe('pi/gpt-5-mini');
  });

  it('retries a model a custom endpoint rejects on the endpoint\'s own models only', async () => {
    const tried: string[] = [];
    const rejectedEverywhere = rejection('endpoint-mini');
    await expect(queryMiniModel({
      model: 'endpoint-mini',
      miniModel: 'endpoint-mini',
      sessionModel: 'endpoint-model',
      authProvider: 'openai',
      // The built-in OpenAI models match every fallback candidate ('pi/gpt-5-mini', the
      // OpenAI defaults): before the endpoint was isolated, a retry went to api.openai.com.
      modelRegistry: registry({
        'custom-endpoint': ['endpoint-model', 'endpoint-mini'],
        openai: ['gpt-5-mini', 'gpt-6-astra', 'gpt-5.5'],
      }),
      customEndpointOnly: true,
    }, async model => {
      tried.push(model);
      throw model === 'endpoint-mini' ? rejectedEverywhere : rejection(model);
    })).rejects.toThrow();
    expect(tried).toEqual(['endpoint-mini', 'endpoint-model']);
  });

  it('respects custom-endpoint precedence when resolving fallback candidates', async () => {
    const result = await queryMiniModel({
      ...codexOptions,
      sessionModel: 'private-model',
      modelRegistry: registry({ 'custom-endpoint': ['private-model'] }),
      customEndpointOnly: true,
    }, async model => {
      if (model === 'pi/gpt-5.4-mini') throw rejection(model);
      return 'Private Title';
    });
    expect(result.model).toBe('private-model');
  });
});
