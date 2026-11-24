import { afterEach, describe, expect, it } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildClaudeSubprocessEnv, CLAUDE_AUTH_ENV_KEYS } from '../options.ts';

const original = {
  CLAUDE_CODE_ENABLE_TODO_TOOLS: process.env.CLAUDE_CODE_ENABLE_TODO_TOOLS,
  ANTHROPIC_BASE_URL: process.env.ANTHROPIC_BASE_URL,
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
  CLAUDE_CODE_OAUTH_TOKEN: process.env.CLAUDE_CODE_OAUTH_TOKEN,
  ANTHROPIC_AUTH_TOKEN: process.env.ANTHROPIC_AUTH_TOKEN,
  CLAUDE_CODE_USE_VERTEX: process.env.CLAUDE_CODE_USE_VERTEX,
  CLAUDE_CODE_USE_FOUNDRY: process.env.CLAUDE_CODE_USE_FOUNDRY,
  CLAUDE_CODE_USE_ANTHROPIC_AWS: process.env.CLAUDE_CODE_USE_ANTHROPIC_AWS,
  CLAUDE_CODE_USE_GATEWAY: process.env.CLAUDE_CODE_USE_GATEWAY,
  CLAUDE_CODE_USE_POWERSHELL_TOOL: process.env.CLAUDE_CODE_USE_POWERSHELL_TOOL,
  ENABLE_TOOL_SEARCH: process.env.ENABLE_TOOL_SEARCH,
  CLAUDE_CODE_DISABLE_REFUSAL_FALLBACK: process.env.CLAUDE_CODE_DISABLE_REFUSAL_FALLBACK,
};

afterEach(() => {
  for (const [key, value] of Object.entries(original)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe('buildClaudeSubprocessEnv', () => {
  it('keeps the task-tracking tools available on every model (SDK 0.3.268 default change)', () => {
    delete process.env.CLAUDE_CODE_ENABLE_TODO_TOOLS;
    expect(buildClaudeSubprocessEnv().CLAUDE_CODE_ENABLE_TODO_TOOLS).toBe('1');
  });

  it('respects an explicit opt-out from the process environment', () => {
    process.env.CLAUDE_CODE_ENABLE_TODO_TOOLS = '0';
    expect(buildClaudeSubprocessEnv().CLAUDE_CODE_ENABLE_TODO_TOOLS).toBe('0');
  });

  it('respects a per-session override', () => {
    delete process.env.CLAUDE_CODE_ENABLE_TODO_TOOLS;
    expect(buildClaudeSubprocessEnv({ CLAUDE_CODE_ENABLE_TODO_TOOLS: '0' }).CLAUDE_CODE_ENABLE_TODO_TOOLS).toBe('0');
  });

  // Claude Code 2.1.304 turned tool search on behind a custom base URL; an Anthropic-compatible
  // gateway may refuse it (three refused requests per process) or drop the tools it defers.
  it('keeps tool search off behind a third-party base URL, as before Claude Code 2.1.304', () => {
    delete process.env.ANTHROPIC_BASE_URL;
    delete process.env.ENABLE_TOOL_SEARCH;
    expect(buildClaudeSubprocessEnv().ENABLE_TOOL_SEARCH).toBeUndefined();
    expect(buildClaudeSubprocessEnv({ ANTHROPIC_BASE_URL: 'https://api.anthropic.com' }).ENABLE_TOOL_SEARCH).toBeUndefined();
    expect(buildClaudeSubprocessEnv({ ANTHROPIC_BASE_URL: 'https://openrouter.ai/api' }).ENABLE_TOOL_SEARCH).toBe('false');
    expect(buildClaudeSubprocessEnv({ ANTHROPIC_BASE_URL: 'http://localhost:11434' }).ENABLE_TOOL_SEARCH).toBe('false');
    expect(buildClaudeSubprocessEnv({ ANTHROPIC_BASE_URL: 'https://anthropic.com.example.net' }).ENABLE_TOOL_SEARCH).toBe('false');
  });

  it('leaves an explicit tool search setting alone', () => {
    process.env.ENABLE_TOOL_SEARCH = 'true';
    expect(buildClaudeSubprocessEnv({ ANTHROPIC_BASE_URL: 'https://openrouter.ai/api' }).ENABLE_TOOL_SEARCH).toBe('true');
    delete process.env.ENABLE_TOOL_SEARCH;
    expect(buildClaudeSubprocessEnv({ ANTHROPIC_BASE_URL: 'https://gateway.example.com', ENABLE_TOOL_SEARCH: 'auto' }).ENABLE_TOOL_SEARCH).toBe('auto');
  });

  // Claude Code 2.1.316 answers a reply its safeguards keep stopping on a fallback model and keeps the
  // session on it; behind a gateway that is `claude-opus-4-8` whatever the connection's model is called.
  it('ends a refused turn instead of switching to a fallback model behind a third-party base URL', () => {
    delete process.env.ANTHROPIC_BASE_URL;
    delete process.env.CLAUDE_CODE_DISABLE_REFUSAL_FALLBACK;
    expect(buildClaudeSubprocessEnv().CLAUDE_CODE_DISABLE_REFUSAL_FALLBACK).toBeUndefined();
    expect(buildClaudeSubprocessEnv({ ANTHROPIC_BASE_URL: 'https://api.anthropic.com' }).CLAUDE_CODE_DISABLE_REFUSAL_FALLBACK).toBeUndefined();
    expect(buildClaudeSubprocessEnv({ ANTHROPIC_BASE_URL: 'https://openrouter.ai/api' }).CLAUDE_CODE_DISABLE_REFUSAL_FALLBACK).toBe('1');
    expect(buildClaudeSubprocessEnv({ ANTHROPIC_BASE_URL: 'https://gateway.example.com', CLAUDE_CODE_DISABLE_REFUSAL_FALLBACK: '0' }).CLAUDE_CODE_DISABLE_REFUSAL_FALLBACK).toBe('0');
  });

  // Each session's postInit writes its connection into the shared process.env, where the next
  // session's postInit overwrites it (craft-agents-oss#1129).
  it("starts the CLI with the session's own connection, not one another session left in process.env", () => {
    process.env.CLAUDE_CODE_OAUTH_TOKEN = 'other-account';
    process.env.ANTHROPIC_API_KEY = 'other-key';
    process.env.ANTHROPIC_BASE_URL = 'https://gateway.example.com';
    delete process.env.ENABLE_TOOL_SEARCH;
    delete process.env.CLAUDE_CODE_DISABLE_REFUSAL_FALLBACK;

    const oauth = buildClaudeSubprocessEnv({ CRAFT_WORKSPACE_PATH: '/ws' }, { CLAUDE_CODE_OAUTH_TOKEN: 'own-account' });
    expect(oauth.CLAUDE_CODE_OAUTH_TOKEN).toBe('own-account');
    expect(oauth.ANTHROPIC_API_KEY).toBeUndefined();
    expect(oauth.ANTHROPIC_BASE_URL).toBeUndefined();
    expect(oauth.CRAFT_WORKSPACE_PATH).toBe('/ws');
    // Settings that follow the endpoint follow the session's own one.
    expect(oauth.ENABLE_TOOL_SEARCH).toBeUndefined();
    expect(oauth.CLAUDE_CODE_DISABLE_REFUSAL_FALLBACK).toBeUndefined();

    const gateway = buildClaudeSubprocessEnv(undefined, { ANTHROPIC_API_KEY: 'own-key', ANTHROPIC_BASE_URL: 'https://openrouter.ai/api' });
    expect(gateway.CLAUDE_CODE_OAUTH_TOKEN).toBeUndefined();
    expect(gateway.ANTHROPIC_API_KEY).toBe('own-key');
    expect(gateway.ENABLE_TOOL_SEARCH).toBe('false');

    // Callers without a resolved connection inherit the process environment, as before.
    expect(buildClaudeSubprocessEnv().CLAUDE_CODE_OAUTH_TOKEN).toBe('other-account');
  });

  // The CLI prefers provider routing and ANTHROPIC_AUTH_TOKEN to the connection's own key or token,
  // and the packaged app imports the login shell's environment.
  it("drops the shell's Claude credentials and provider routing for a session's connection", () => {
    process.env.ANTHROPIC_AUTH_TOKEN = 'shell-gateway-token';
    process.env.CLAUDE_CODE_USE_VERTEX = '1';
    process.env.CLAUDE_CODE_USE_FOUNDRY = '1';
    process.env.CLAUDE_CODE_USE_ANTHROPIC_AWS = '1';
    process.env.CLAUDE_CODE_USE_GATEWAY = '1';
    process.env.CLAUDE_CODE_USE_POWERSHELL_TOOL = '1';

    const env = buildClaudeSubprocessEnv(undefined, { CLAUDE_CODE_OAUTH_TOKEN: 'own-account' });
    expect(env.ANTHROPIC_AUTH_TOKEN).toBeUndefined();
    expect(env.CLAUDE_CODE_USE_VERTEX).toBeUndefined();
    expect(env.CLAUDE_CODE_USE_FOUNDRY).toBeUndefined();
    expect(env.CLAUDE_CODE_USE_ANTHROPIC_AWS).toBeUndefined();
    expect(env.CLAUDE_CODE_USE_GATEWAY).toBeUndefined();
    expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBe('own-account');
    // A feature flag sharing the prefix is not routing.
    expect(env.CLAUDE_CODE_USE_POWERSHELL_TOOL).toBe('1');
  });

  // The CLI picks a provider other than the first-party API when any of its provider switches is set
  // (its list holds every `CLAUDE_CODE_USE_*` name but these feature flags). A switch a new SDK adds
  // fails this test until it joins CLAUDE_AUTH_ENV_KEYS, or a feature flag until it joins this list.
  const CLI_FEATURE_FLAGS = ['CLAUDE_CODE_USE_POWERSHELL_TOOL', 'CLAUDE_CODE_USE_COWORK_PLUGINS', 'CLAUDE_CODE_USE_CCR_V2', 'CLAUDE_CODE_USE_NATIVE_FILE_SEARCH'];
  const cliBinary = join(import.meta.dir, '../../../../../node_modules/@anthropic-ai',
    `claude-agent-sdk-${process.platform}-${process.arch === 'arm64' ? 'arm64' : 'x64'}`,
    process.platform === 'win32' ? 'claude.exe' : 'claude');
  it.skipIf(!existsSync(cliBinary))('drops every provider switch the bundled Claude CLI checks', () => {
    const bytes = readFileSync(cliBinary);
    const prefix = Buffer.from('CLAUDE_CODE_USE_');
    const isNameByte = (b: number) => (b >= 65 && b <= 90) || (b >= 48 && b <= 57) || b === 95;
    const names = new Set<string>();
    for (let at = bytes.indexOf(prefix); at !== -1; at = bytes.indexOf(prefix, at + prefix.length)) {
      let end = at + prefix.length;
      while (end < bytes.length && isNameByte(bytes[end]!)) end++;
      if (end > at + prefix.length) names.add(bytes.toString('latin1', at, end));
    }
    const switches = [...names].filter((name) => !CLI_FEATURE_FLAGS.includes(name));
    expect(switches).toContain('CLAUDE_CODE_USE_BEDROCK');
    expect(switches.filter((name) => !(CLAUDE_AUTH_ENV_KEYS as readonly string[]).includes(name))).toEqual([]);
  });
});
