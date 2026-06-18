import { beforeAll, describe, expect, it } from 'bun:test';

let resolveAdapterNameFromPiApiHint: typeof import('../unified-network-interceptor.ts').resolveAdapterNameFromPiApiHint;

describe('unified-network-interceptor Pi API hint mapping', () => {
  beforeAll(async () => {
    process.env.CRAFT_INTERCEPTOR_DISABLE_AUTO_INSTALL = '1';
    ({ resolveAdapterNameFromPiApiHint } = await import('../unified-network-interceptor.ts'));
  });

  it('maps anthropic-messages to anthropic adapter', () => {
    expect(resolveAdapterNameFromPiApiHint('anthropic-messages')).toBe('anthropic');
  });

  it('maps openai-completions to openai adapter', () => {
    expect(resolveAdapterNameFromPiApiHint('openai-completions')).toBe('openai');
  });

  it('maps responses-family APIs to responses adapter', () => {
    expect(resolveAdapterNameFromPiApiHint('openai-responses')).toBe('openai-responses');
    expect(resolveAdapterNameFromPiApiHint('azure-openai-responses')).toBe('openai-responses');
    expect(resolveAdapterNameFromPiApiHint('openai-codex-responses')).toBe('openai-responses');
  });

  it('returns undefined for unknown/empty hints', () => {
    expect(resolveAdapterNameFromPiApiHint(undefined)).toBeUndefined();
    expect(resolveAdapterNameFromPiApiHint('')).toBeUndefined();
    expect(resolveAdapterNameFromPiApiHint('google-generative-ai')).toBeUndefined();
  });
});
