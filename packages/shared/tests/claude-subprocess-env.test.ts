/**
 * Tests for buildClaudeSubprocessEnv in agent/options.ts
 *
 * Guards the environment contract for the spawned Claude Code CLI:
 * - CLAUDECODE is stripped so the CLI does not refuse to start when the host
 *   process is itself running inside a Claude Code session.
 * - Claude-specific Bedrock routing vars are stripped so Bedrock is never
 *   routed through the Claude SDK path.
 */
import { describe, it, expect, afterEach } from 'bun:test';
import { buildClaudeSubprocessEnv } from '../src/agent/options.ts';

const TOUCHED_VARS = [
  'CLAUDECODE',
  'CLAUDE_CODE_USE_BEDROCK',
  'AWS_BEARER_TOKEN_BEDROCK',
  'ANTHROPIC_BEDROCK_BASE_URL',
] as const;

const saved: Record<string, string | undefined> = {};
for (const key of TOUCHED_VARS) saved[key] = process.env[key];

afterEach(() => {
  for (const key of TOUCHED_VARS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

describe('buildClaudeSubprocessEnv', () => {
  it('strips CLAUDECODE from the subprocess env', () => {
    process.env.CLAUDECODE = '1';
    const env = buildClaudeSubprocessEnv();
    expect(env.CLAUDECODE).toBeUndefined();
  });

  it('strips Claude-specific Bedrock routing vars', () => {
    process.env.CLAUDE_CODE_USE_BEDROCK = '1';
    process.env.AWS_BEARER_TOKEN_BEDROCK = 'token';
    process.env.ANTHROPIC_BEDROCK_BASE_URL = 'https://bedrock.example';
    const env = buildClaudeSubprocessEnv();
    expect(env.CLAUDE_CODE_USE_BEDROCK).toBeUndefined();
    expect(env.AWS_BEARER_TOKEN_BEDROCK).toBeUndefined();
    expect(env.ANTHROPIC_BEDROCK_BASE_URL).toBeUndefined();
  });

  it('preserves unrelated environment variables', () => {
    const env = buildClaudeSubprocessEnv({ ANTHROPIC_BASE_URL: 'https://example.test' });
    expect(env.ANTHROPIC_BASE_URL).toBe('https://example.test');
  });
});
