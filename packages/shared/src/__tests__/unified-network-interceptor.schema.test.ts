import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import { writeFileSync, unlinkSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

let injectMetadataIntoToolSchema: typeof import('../unified-network-interceptor.ts').injectMetadataIntoToolSchema;
let sanitizeEmptyTextCacheControl: typeof import('../unified-network-interceptor.ts').sanitizeEmptyTextCacheControl;
let upgradePromptCacheTtl: typeof import('../unified-network-interceptor.ts').upgradePromptCacheTtl;
let _resetConfigCacheForTesting: typeof import('../interceptor-common.ts')._resetConfigCacheForTesting;

describe('unified-network-interceptor schema metadata injection', () => {
  beforeAll(async () => {
    process.env.CRAFT_INTERCEPTOR_DISABLE_AUTO_INSTALL = '1';
    ({ injectMetadataIntoToolSchema, sanitizeEmptyTextCacheControl, upgradePromptCacheTtl } = await import('../unified-network-interceptor.ts'));
    ({ _resetConfigCacheForTesting } = await import('../interceptor-common.ts'));
  });

  it('injects metadata fields into empty/zero-arg schemas', () => {
    const schema = { type: 'object' };
    const result = injectMetadataIntoToolSchema(schema);

    expect(result.properties._displayName).toBeDefined();
    expect(result.properties._intent).toBeDefined();
    expect(result.required).toContain('_displayName');
    expect(result.required).toContain('_intent');
  });

  it('preserves existing properties and required keys while prepending metadata keys', () => {
    const schema = {
      type: 'object',
      properties: {
        url: { type: 'string' },
      },
      required: ['url'],
    };

    const result = injectMetadataIntoToolSchema(schema);

    expect(result.properties.url).toEqual({ type: 'string' });
    expect(result.required).toEqual(['_displayName', '_intent', 'url']);
  });

  it('does not duplicate metadata keys when already present in required', () => {
    const schema = {
      properties: {
        _displayName: { type: 'string', description: 'custom display name schema' },
        _intent: { type: 'string', description: 'custom intent schema' },
      },
      required: ['_intent', '_displayName'],
    };

    const result = injectMetadataIntoToolSchema(schema);

    expect(result.required).toEqual(['_displayName', '_intent']);
    expect(result.properties._displayName).toEqual({ type: 'string', description: 'custom display name schema' });
    expect(result.properties._intent).toEqual({ type: 'string', description: 'custom intent schema' });
  });
});

describe('sanitizeEmptyTextCacheControl', () => {
  it('strips cache_control from empty text blocks', () => {
    const body = {
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: '', cache_control: { type: 'ephemeral' } },
          { type: 'text', text: 'hello', cache_control: { type: 'ephemeral' } },
        ],
      }],
    };

    const stripped = sanitizeEmptyTextCacheControl(body);

    expect(stripped).toBe(1);
    expect((body.messages[0]!.content as any[])[0].cache_control).toBeUndefined();
    expect((body.messages[0]!.content as any[])[1].cache_control).toEqual({ type: 'ephemeral' });
  });

  it('strips cache_control from whitespace-only text blocks', () => {
    const body = {
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: '   \n\t  ', cache_control: { type: 'ephemeral' } },
        ],
      }],
    };

    const stripped = sanitizeEmptyTextCacheControl(body);

    expect(stripped).toBe(1);
    expect((body.messages[0]!.content as any[])[0].cache_control).toBeUndefined();
  });

  it('leaves non-text blocks untouched', () => {
    const body = {
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: {}, cache_control: { type: 'ephemeral' } },
        ],
      }],
    };

    const stripped = sanitizeEmptyTextCacheControl(body);

    expect(stripped).toBe(0);
    expect((body.messages[0]!.content as any[])[0].cache_control).toEqual({ type: 'ephemeral' });
  });

  it('handles messages without content arrays', () => {
    const body = {
      messages: [{ role: 'user', content: 'plain string' }],
    };

    const stripped = sanitizeEmptyTextCacheControl(body);
    expect(stripped).toBe(0);
  });

  it('returns 0 when no messages present', () => {
    expect(sanitizeEmptyTextCacheControl({})).toBe(0);
  });
});

describe('upgradePromptCacheTtl', () => {
  const configFile = join(homedir(), '.craft-agent', 'config.json');
  let originalConfig: string | null = null;

  beforeEach(() => {
    // Save original config if it exists
    try {
      originalConfig = require('node:fs').readFileSync(configFile, 'utf-8');
    } catch {
      originalConfig = null;
    }
  });

  afterEach(() => {
    // Restore original config
    if (originalConfig !== null) {
      writeFileSync(configFile, originalConfig);
    } else {
      try { unlinkSync(configFile); } catch { /* ignore */ }
    }
    _resetConfigCacheForTesting();
  });

  function enableExtendedCache() {
    const dir = join(homedir(), '.craft-agent');
    mkdirSync(dir, { recursive: true });
    const existing = originalConfig ? JSON.parse(originalConfig) : {};
    writeFileSync(configFile, JSON.stringify({ ...existing, extendedPromptCache: true }));
    _resetConfigCacheForTesting();
  }

  function disableExtendedCache() {
    const dir = join(homedir(), '.craft-agent');
    mkdirSync(dir, { recursive: true });
    const existing = originalConfig ? JSON.parse(originalConfig) : {};
    writeFileSync(configFile, JSON.stringify({ ...existing, extendedPromptCache: false }));
    _resetConfigCacheForTesting();
  }

  it('leaves blocks without ttl untouched when disabled', () => {
    disableExtendedCache();
    const body = {
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: 'hello', cache_control: { type: 'ephemeral' } },
        ],
      }],
    };

    const result = upgradePromptCacheTtl(body);

    expect(result).toBe(0);
    expect((body.messages[0]!.content as any[])[0].cache_control).toEqual({ type: 'ephemeral' });
  });

  it('strips ttl from message content when disabled', () => {
    disableExtendedCache();
    const body = {
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: 'hello', cache_control: { type: 'ephemeral', ttl: '1h' } },
          { type: 'text', text: 'world', cache_control: { type: 'ephemeral', ttl: '1h' } },
        ],
      }],
    };

    const stripped = upgradePromptCacheTtl(body);

    expect(stripped).toBe(2);
    expect((body.messages[0]!.content as any[])[0].cache_control).toEqual({ type: 'ephemeral' });
    expect((body.messages[0]!.content as any[])[1].cache_control).toEqual({ type: 'ephemeral' });
  });

  it('strips ttl from system prompt when disabled', () => {
    disableExtendedCache();
    const body = {
      system: [
        { type: 'text', text: 'You are helpful', cache_control: { type: 'ephemeral', ttl: '1h' } },
      ],
      messages: [],
    };

    const stripped = upgradePromptCacheTtl(body);

    expect(stripped).toBe(1);
    expect((body.system as any[])[0].cache_control).toEqual({ type: 'ephemeral' });
  });

  it('strips ttl from top-level cache_control when disabled', () => {
    disableExtendedCache();
    const body = {
      cache_control: { type: 'ephemeral', ttl: '1h' },
      messages: [],
    };

    const stripped = upgradePromptCacheTtl(body);

    expect(stripped).toBe(1);
    expect(body.cache_control as any).toEqual({ type: 'ephemeral' });
  });

  it('upgrades message content cache_control to 1h when enabled', () => {
    enableExtendedCache();
    const body = {
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: 'hello', cache_control: { type: 'ephemeral' } },
          { type: 'text', text: 'world', cache_control: { type: 'ephemeral' } },
        ],
      }],
    };

    const upgraded = upgradePromptCacheTtl(body);

    expect(upgraded).toBe(2);
    expect((body.messages[0]!.content as any[])[0].cache_control).toEqual({ type: 'ephemeral', ttl: '1h' });
    expect((body.messages[0]!.content as any[])[1].cache_control).toEqual({ type: 'ephemeral', ttl: '1h' });
  });

  it('upgrades system prompt cache_control to 1h when enabled', () => {
    enableExtendedCache();
    const body = {
      system: [
        { type: 'text', text: 'You are helpful', cache_control: { type: 'ephemeral' } },
      ],
      messages: [],
    };

    const upgraded = upgradePromptCacheTtl(body);

    expect(upgraded).toBe(1);
    expect((body.system as any[])[0].cache_control).toEqual({ type: 'ephemeral', ttl: '1h' });
  });

  it('upgrades top-level cache_control (auto-caching mode) when enabled', () => {
    enableExtendedCache();
    const body = {
      cache_control: { type: 'ephemeral' },
      messages: [],
    };

    const upgraded = upgradePromptCacheTtl(body);

    expect(upgraded).toBe(1);
    expect(body.cache_control as any).toEqual({ type: 'ephemeral', ttl: '1h' });
  });

  it('leaves blocks without cache_control untouched', () => {
    enableExtendedCache();
    const body = {
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: 'no cache' },
        ],
      }],
    };

    const upgraded = upgradePromptCacheTtl(body);

    expect(upgraded).toBe(0);
    expect((body.messages[0]!.content as any[])[0].cache_control).toBeUndefined();
  });

  it('does not upgrade blocks that already have 1h TTL', () => {
    enableExtendedCache();
    const body = {
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: 'already cached', cache_control: { type: 'ephemeral', ttl: '1h' } },
        ],
      }],
    };

    const upgraded = upgradePromptCacheTtl(body);

    // Still counts as upgraded (idempotent set), but that's fine
    expect(upgraded).toBe(1);
    expect((body.messages[0]!.content as any[])[0].cache_control).toEqual({ type: 'ephemeral', ttl: '1h' });
  });

  it('returns 0 when no messages or system prompt', () => {
    enableExtendedCache();
    expect(upgradePromptCacheTtl({})).toBe(0);
  });
});
