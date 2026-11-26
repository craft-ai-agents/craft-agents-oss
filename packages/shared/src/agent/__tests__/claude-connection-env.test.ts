/**
 * Each Claude session's CLI starts with its own connection's credentials (craft-agents-oss#1129).
 *
 * postInit() used to write them to the shared process.env too, where the next session's postInit
 * overwrote them: a CLI started from process.env ran on whichever account was set up last, and every
 * other process the app started (the Pi subprocess and the commands its agent runs) got them.
 * Config, credential store and token refresh are stubbed; the agents are built with Object.create.
 */
import { afterEach, describe, expect, it, mock, spyOn } from 'bun:test';
import { ClaudeAgent } from '../claude-agent.ts';
import * as options from '../options.ts';
import { buildClaudeSubprocessEnv } from '../options.ts';
import { testBackendConnection } from '../backend/factory.ts';
import { validateAnthropicConnection } from '../../config/llm-validation.ts';
import * as storage from '../../config/storage.ts';
import * as credentials from '../../credentials/index.ts';
import * as authState from '../../auth/state.ts';

const ENV_KEYS = ['ANTHROPIC_API_KEY', 'CLAUDE_CODE_OAUTH_TOKEN', 'ANTHROPIC_BASE_URL', 'CLAUDE_CODE_USE_BEDROCK', 'AWS_BEARER_TOKEN_BEDROCK', 'ANTHROPIC_BEDROCK_BASE_URL', 'ANTHROPIC_DEFAULT_HAIKU_MODEL'];
const originalEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));

afterEach(() => {
  mock.restore();
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

function agentFor(connectionSlug: string) {
  const agent = Object.create(ClaudeAgent.prototype) as any;
  agent.config = { connectionSlug, envOverrides: { CRAFT_WORKSPACE_PATH: '/ws' } };
  agent.authFailure = null;
  agent.connectionEnv = null;
  return agent;
}

/** Records what a completion's CLI would start with, then stops before starting it. */
function captureCompletionEnv() {
  const calls: Array<{ envOverrides?: Record<string, string>; connectionEnv?: Record<string, string> }> = [];
  spyOn(options, 'getTextCompletionOptions').mockImplementation(((envOverrides?: Record<string, string>, connectionEnv?: Record<string, string>) => {
    calls.push({ envOverrides, connectionEnv });
    throw new Error('stopped before the CLI');
  }) as any);
  return calls;
}

describe('ClaudeAgent connection env', () => {
  it("keeps each session's own connection for its CLI, whichever postInit ran last", async () => {
    spyOn(storage, 'getLlmConnection').mockImplementation(((slug: string) => slug === 'gateway'
      ? { slug, name: slug, providerType: 'anthropic', authType: 'api_key', baseUrl: 'https://openrouter.ai/api' }
      : { slug, name: slug, providerType: 'anthropic', authType: 'oauth' }) as any);
    spyOn(credentials, 'getCredentialManager').mockReturnValue({
      getLlmApiKey: async (slug: string) => `key-${slug}`,
    } as any);
    spyOn(authState, 'getValidClaudeOAuthToken').mockImplementation((async (slug: string) => ({ accessToken: `token-${slug}` })) as any);

    const work = agentFor('work');
    work.config.miniModel = 'claude-haiku-5-5';
    const personal = agentFor('personal');
    const gateway = agentFor('gateway');
    expect((await work.postInit()).authInjected).toBe(true);
    expect((await personal.postInit()).authInjected).toBe(true);
    expect((await gateway.postInit()).authInjected).toBe(true);
    // The shared environment holds no connection's credentials or mini model.
    for (const key of ENV_KEYS) {
      expect(process.env[key]).toBe(originalEnv[key]);
    }

    const workEnv = buildClaudeSubprocessEnv(work.config.envOverrides, work.connectionEnv);
    expect(workEnv.CLAUDE_CODE_OAUTH_TOKEN).toBe('token-work');
    expect(workEnv.ANTHROPIC_API_KEY).toBeUndefined();
    expect(workEnv.ANTHROPIC_BASE_URL).toBeUndefined();
    expect(buildClaudeSubprocessEnv(personal.config.envOverrides, personal.connectionEnv).CLAUDE_CODE_OAUTH_TOKEN).toBe('token-personal');
    const gatewayEnv = buildClaudeSubprocessEnv(gateway.config.envOverrides, gateway.connectionEnv);
    expect(gatewayEnv.ANTHROPIC_API_KEY).toBe('key-gateway');
    expect(gatewayEnv.ANTHROPIC_BASE_URL).toBe('https://openrouter.ai/api');
    expect(gatewayEnv.CLAUDE_CODE_OAUTH_TOKEN).toBeUndefined();
  });

  it('starts call_llm and mini completions with its own connection', async () => {
    const calls = captureCompletionEnv();
    const work = agentFor('work');
    work.config.miniModel = 'claude-haiku-5-5';
    work.connectionEnv = { CLAUDE_CODE_OAUTH_TOKEN: 'token-work' };

    await expect(work.queryLlm({ prompt: 'Say ok' })).rejects.toThrow('stopped before the CLI');
    await expect(work.runMiniCompletion('Say ok')).rejects.toThrow('stopped before the CLI');
    expect(calls).toEqual([
      { envOverrides: { CRAFT_WORKSPACE_PATH: '/ws' }, connectionEnv: { CLAUDE_CODE_OAUTH_TOKEN: 'token-work' } },
      { envOverrides: { CRAFT_WORKSPACE_PATH: '/ws' }, connectionEnv: { CLAUDE_CODE_OAUTH_TOKEN: 'token-work' } },
    ]);
  });

  it('drops the connection env when postInit fails', async () => {
    spyOn(storage, 'getLlmConnection').mockReturnValue({ slug: 'work', name: 'work', providerType: 'anthropic', authType: 'oauth' } as any);
    spyOn(credentials, 'getCredentialManager').mockReturnValue({} as any);
    const token = spyOn(authState, 'getValidClaudeOAuthToken').mockImplementation((async () => ({ accessToken: 'token-work' })) as any);

    const work = agentFor('work');
    await work.postInit();
    expect(work.connectionEnv).toEqual({ CLAUDE_CODE_OAUTH_TOKEN: 'token-work' });

    token.mockImplementation((async () => ({ accessToken: null })) as any);
    expect((await work.postInit()).authInjected).toBe(false);
    expect(work.connectionEnv).toBeNull();
  });

  it('fails closed when resolving the credentials throws', async () => {
    spyOn(storage, 'getLlmConnection').mockReturnValue({ slug: 'work', name: 'work', providerType: 'anthropic', authType: 'oauth' } as any);
    spyOn(credentials, 'getCredentialManager').mockReturnValue({} as any);
    spyOn(authState, 'getValidClaudeOAuthToken').mockImplementation((async () => {
      throw new Error('No writable credential backend available');
    }) as any);

    const work = agentFor('work');
    work.config.authType = 'oauth';
    work.config.miniModel = 'claude-haiku-5-5';
    work.connectionEnv = { CLAUDE_CODE_OAUTH_TOKEN: 'token-work' };

    expect((await work.postInit()).authInjected).toBe(false);
    expect(work.authFailure.kind).toBe('unavailable');
    expect(work.authFailure.warning).toContain('No writable credential backend available');
    expect(work.connectionEnv).toBeNull();
    // A completion tries once more, then refuses instead of starting the CLI on process.env.
    await expect(work.runMiniCompletion('Say ok')).rejects.toThrow('No writable credential backend available');
  });
});

describe('connection checks', () => {
  it('tests a Claude key with only that key, whatever another session left in process.env', async () => {
    process.env.ANTHROPIC_BASE_URL = 'https://gateway.example.com';
    spyOn(credentials, 'getCredentialManager').mockReturnValue({
      setLlmApiKey: async () => {},
      deleteLlmApiKey: async () => {},
    } as any);
    const calls = captureCompletionEnv();

    const result = await testBackendConnection({
      provider: 'anthropic',
      apiKey: 'sk-under-test',
      model: 'claude-haiku-5-5',
      hostRuntime: { appRootPath: process.cwd(), isPackaged: false },
    });

    expect(result.success).toBe(false);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.connectionEnv).toEqual({ ANTHROPIC_API_KEY: 'sk-under-test' });
    expect(buildClaudeSubprocessEnv(calls[0]!.envOverrides, calls[0]!.connectionEnv).ANTHROPIC_BASE_URL).toBeUndefined();
  });

  it('validates stored credentials with only those credentials', async () => {
    process.env.ANTHROPIC_BASE_URL = 'https://gateway.example.com';
    process.env.CLAUDE_CODE_OAUTH_TOKEN = 'another-account';
    const calls = captureCompletionEnv();

    expect((await validateAnthropicConnection({ model: 'claude-haiku-5-5', apiKey: 'sk-stored' })).success).toBe(false);
    expect(calls[0]!.connectionEnv).toEqual({ ANTHROPIC_API_KEY: 'sk-stored' });
    const env = buildClaudeSubprocessEnv(calls[0]!.envOverrides, calls[0]!.connectionEnv);
    expect(env.ANTHROPIC_BASE_URL).toBeUndefined();
    expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBeUndefined();
    expect(process.env.CLAUDE_CODE_OAUTH_TOKEN).toBe('another-account');

    // Without credentials the CLI would sign in with the user's own Claude Code login.
    expect(await validateAnthropicConnection({ model: 'claude-haiku-5-5' }))
      .toEqual({ success: false, error: 'No API key or OAuth token to validate' });
    expect(calls).toHaveLength(1);
  });
});
