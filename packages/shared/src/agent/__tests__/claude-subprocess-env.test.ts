import { afterEach, describe, expect, it } from 'bun:test';
import { buildClaudeSubprocessEnv } from '../options.ts';

const original = {
  CLAUDE_CODE_ENABLE_TODO_TOOLS: process.env.CLAUDE_CODE_ENABLE_TODO_TOOLS,
  ANTHROPIC_BASE_URL: process.env.ANTHROPIC_BASE_URL,
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
});
