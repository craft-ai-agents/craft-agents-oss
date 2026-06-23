import { describe, expect, test } from 'bun:test';
import { normalizeMessageAgentInput } from './validation.ts';

describe('agent messaging validation', () => {
  test('normalizes bounded delegation input', () => {
    const input = normalizeMessageAgentInput({
      agentSlug: 'code-reviewer',
      task: 'Review the diff.',
      sourceSlugs: ['exa', 'exa', 'github'],
      skillSlugs: ['fix'],
    }, { parentPermissionMode: 'ask' });

    expect(input.agentSlug).toBe('code-reviewer');
    expect(input.sourceSlugs).toEqual(['exa', 'github']);
    expect(input.skillSlugs).toEqual(['fix']);
    expect(input.permissionMode).toBe('ask');
    expect(input.timeoutSeconds).toBe(300);
    expect(input.maxTurns).toBe(1);
    expect(input.background).toBe(false);
  });

  test('normalizes background mode', () => {
    const input = normalizeMessageAgentInput({
      agentSlug: 'code-reviewer',
      task: 'Review the diff.',
      background: true,
    }, { parentPermissionMode: 'ask' });

    expect(input.background).toBe(true);
  });

  test('blocks permission escalation', () => {
    expect(() => normalizeMessageAgentInput({
      agentSlug: 'coder',
      task: 'Implement the fix.',
      permissionMode: 'allow-all',
    }, { parentPermissionMode: 'safe' })).toThrow('cannot escalate');
  });

  test('blocks recursive calls at max depth', () => {
    expect(() => normalizeMessageAgentInput({
      agentSlug: 'coder',
      task: 'Continue delegation.',
    }, { depth: 2, maxDepth: 2 })).toThrow('maximum delegation depth');
  });
});
