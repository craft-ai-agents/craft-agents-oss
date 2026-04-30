import { describe, expect, test } from 'bun:test';
import { buildEnvFromPayload, buildPromptEnvFromPayload, buildWebhookEnv } from './utils.ts';
import type { WebhookReceivePayload, FileWatchPayload, PollUrlPayload } from './event-bus.ts';

describe('env-var expansion for external triggers', () => {
  test('prompt env for external events excludes arbitrary process env and keeps CRAFT_WH allowlist', () => {
    const oldOpenAi = process.env.OPENAI_API_KEY;
    const oldAllowed = process.env.CRAFT_WH_ALLOWED;
    const oldCraftSecret = process.env.CRAFT_SECRET_INTERNAL;
    process.env.OPENAI_API_KEY = 'sk-secret';
    process.env.CRAFT_WH_ALLOWED = 'allowed-secret';
    process.env.CRAFT_SECRET_INTERNAL = 'not-allowed';

    try {
      const payload: WebhookReceivePayload = {
        workspaceId: 'ws-1',
        timestamp: 0,
        slug: 'github-push',
        method: 'POST',
        headers: { 'x-github-event': 'push' },
        query: {},
        body: { ok: true },
        bodyRaw: '{"ok":true}',
        remoteIp: '127.0.0.1',
      };

      const env = buildPromptEnvFromPayload('WebhookReceive', payload);

      expect(env.OPENAI_API_KEY).toBeUndefined();
      expect(env.CRAFT_SECRET_INTERNAL).toBeUndefined();
      expect(env.CRAFT_WH_ALLOWED).toBe('allowed-secret');
      expect(env.CRAFT_EVENT).toBe('WebhookReceive');
      expect(env.CRAFT_BODY_RAW).toBe('{"ok":true}');
      expect(env.CRAFT_HEADER_X_GITHUB_EVENT).toBe('push');
    } finally {
      if (oldOpenAi === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = oldOpenAi;
      if (oldAllowed === undefined) delete process.env.CRAFT_WH_ALLOWED;
      else process.env.CRAFT_WH_ALLOWED = oldAllowed;
      if (oldCraftSecret === undefined) delete process.env.CRAFT_SECRET_INTERNAL;
      else process.env.CRAFT_SECRET_INTERNAL = oldCraftSecret;
    }
  });

  test('prompt env for internal events preserves legacy process env expansion', () => {
    const oldInternal = process.env.CRAFT_INTERNAL_COMPAT;
    process.env.CRAFT_INTERNAL_COMPAT = 'legacy-value';

    try {
      const env = buildPromptEnvFromPayload('LabelAdd', {
        workspaceId: 'ws-1',
        timestamp: 0,
        label: 'urgent',
      });

      expect(env.CRAFT_INTERNAL_COMPAT).toBe('legacy-value');
      expect(env.CRAFT_LABEL).toBe('urgent');
    } finally {
      if (oldInternal === undefined) delete process.env.CRAFT_INTERNAL_COMPAT;
      else process.env.CRAFT_INTERNAL_COMPAT = oldInternal;
    }
  });

  test('WebhookReceive — explodes headers and query params', () => {
    const payload: WebhookReceivePayload = {
      workspaceId: 'ws-1',
      timestamp: 0,
      slug: 'github-push',
      method: 'POST',
      headers: {
        'x-github-event': 'push',
        'content-type': 'application/json',
        'x-github-delivery': 'abc-123',
      },
      query: { ref: 'refs/heads/main', force: 'false' },
      body: { ref: 'refs/heads/main' },
      bodyRaw: '{"ref":"refs/heads/main"}',
      remoteIp: '140.82.112.3',
    };

    const env = buildWebhookEnv('WebhookReceive', payload);

    // Standard vars
    expect(env.CRAFT_SLUG).toBe('github-push');
    expect(env.CRAFT_METHOD).toBe('POST');
    expect(env.CRAFT_REMOTE_IP).toBe('140.82.112.3');

    // Per-header convenience vars (lowercased name → uppercased + sanitized)
    expect(env.CRAFT_HEADER_X_GITHUB_EVENT).toBe('push');
    expect(env.CRAFT_HEADER_CONTENT_TYPE).toBe('application/json');
    expect(env.CRAFT_HEADER_X_GITHUB_DELIVERY).toBe('abc-123');

    // Per-query convenience vars
    expect(env.CRAFT_QUERY_REF).toBe('refs/heads/main');
    expect(env.CRAFT_QUERY_FORCE).toBe('false');

    // Body still available as JSON via $CRAFT_BODY (not "[object Object]")
    expect(env.CRAFT_BODY).toBe('{"ref":"refs/heads/main"}');
    expect(env.CRAFT_BODY_RAW).toBe('{"ref":"refs/heads/main"}');

    // Headers as JSON aggregate
    expect(JSON.parse(env.CRAFT_HEADERS!)).toEqual(payload.headers);
  });

  test('FileWatch — flat payload renders cleanly', () => {
    const payload: FileWatchPayload = {
      workspaceId: 'ws-1',
      timestamp: 0,
      matcherId: 'fw-1',
      path: '/Users/me/Inbox/note.md',
      relativePath: 'note.md',
      changeType: 'add',
      size: 1024,
      isDirectory: false,
    };
    const env = buildEnvFromPayload('FileWatch', payload);

    expect(env.CRAFT_PATH).toBe('/Users/me/Inbox/note.md');
    expect(env.CRAFT_RELATIVE_PATH).toBe('note.md');
    expect(env.CRAFT_CHANGE_TYPE).toBe('add');
    expect(env.CRAFT_SIZE).toBe('1024');
    expect(env.CRAFT_IS_DIRECTORY).toBe('false');
  });

  test('PollUrl — body is JSON, previousFingerprint null becomes empty', () => {
    const payload: PollUrlPayload = {
      workspaceId: 'ws-1',
      timestamp: 0,
      matcherId: 'p-1',
      url: 'https://api.example.com/health',
      status: 503,
      fingerprintKind: 'status',
      fingerprint: '503',
      previousFingerprint: null,
      body: null,
      headers: { 'content-type': 'application/json' },
    };
    const env = buildEnvFromPayload('PollUrl', payload);

    expect(env.CRAFT_URL).toBe('https://api.example.com/health');
    expect(env.CRAFT_STATUS).toBe('503');
    expect(env.CRAFT_FINGERPRINT_KIND).toBe('status');
    expect(env.CRAFT_FINGERPRINT).toBe('503');
    expect(env.CRAFT_PREVIOUS_FINGERPRINT).toBe(''); // null → empty (not "null")
    expect(env.CRAFT_BODY).toBe(''); // null → empty
    // Headers serialize as JSON, not "[object Object]"
    expect(env.CRAFT_HEADERS).toBe('{"content-type":"application/json"}');
  });

  test('regression: object payload fields never become "[object Object]"', () => {
    const payload: WebhookReceivePayload = {
      workspaceId: 'ws-1',
      timestamp: 0,
      slug: 's',
      method: 'POST',
      headers: { a: '1' },
      query: {},
      body: { nested: { deep: 42 } },
      bodyRaw: '{}',
      remoteIp: '127.0.0.1',
    };
    const env = buildEnvFromPayload('WebhookReceive', payload);

    for (const [k, v] of Object.entries(env)) {
      if (k.startsWith('CRAFT_')) {
        expect(v).not.toBe('[object Object]');
      }
    }

    // And the body specifically should be valid JSON
    expect(JSON.parse(env.CRAFT_BODY!)).toEqual({ nested: { deep: 42 } });
  });
});
