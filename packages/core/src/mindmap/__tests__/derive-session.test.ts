import { describe, expect, test } from 'bun:test';
import { deriveSessionMindMap } from '../derive-session.ts';

describe('deriveSessionMindMap', () => {
  test('builds turn tree with user, assistant, tools', () => {
    const graph = deriveSessionMindMap({
      sessionId: 's1',
      title: 'Plan launch',
      messages: [
        { id: 'u1', type: 'user', content: 'Ship the feature\nmore detail' },
        {
          id: 'a1',
          type: 'assistant',
          content: 'Sure, starting work',
          turnId: 't1',
        },
        {
          id: 't-read',
          type: 'tool',
          content: 'ok',
          toolName: 'Read',
          toolUseId: 'tu1',
          turnId: 't1',
        },
        {
          id: 't-edit',
          type: 'tool',
          content: 'ok',
          toolName: 'Edit',
          toolUseId: 'tu2',
          parentToolUseId: 'tu1',
          turnId: 't1',
        },
        { id: 'u2', type: 'user', content: 'Also fix tests' },
        {
          id: 'a2',
          type: 'assistant',
          content: 'Done',
        },
        { id: 'st1', type: 'status', content: 'compacting…' },
      ],
    });

    expect(graph.entity).toEqual({ type: 'session', sessionId: 's1' });
    expect(graph.derivation).toBe('session');
    expect(graph.nodes.root!.label).toBe('Plan launch');
    expect(graph.nodes.root!.children).toEqual(['turn:u1', 'turn:u2']);

    expect(graph.nodes['turn:u1']!.children).toContain('msg:u1');
    expect(graph.nodes['turn:u1']!.children).toContain('msg:a1');
    expect(graph.nodes['msg:u1']!.kind).toBe('user');
    expect(graph.nodes['msg:u1']!.label).toBe('Ship the feature');
    expect(graph.nodes['msg:a1']!.kind).toBe('assistant');

    // Tools nest under last assistant (or parentToolUseId).
    expect(graph.nodes['msg:a1']!.children).toContain('tool:tu1');
    expect(graph.nodes['tool:tu1']!.label).toBe('Read');
    expect(graph.nodes['tool:tu1']!.children).toContain('tool:tu2');
    expect(graph.nodes['tool:tu2']!.label).toBe('Edit');

    // status skipped
    expect(graph.nodes['msg:st1']).toBeUndefined();

    expect(graph.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(graph.derivedAt).toBeGreaterThan(0);
  });

  test('truncates to last maxTurns and sets meta.truncated', () => {
    const graph = deriveSessionMindMap({
      sessionId: 's2',
      title: '',
      maxTurns: 1,
      messages: [
        { id: 'u1', type: 'user', content: 'first' },
        { id: 'a1', type: 'assistant', content: 'ok1' },
        { id: 'u2', type: 'user', content: 'second' },
        { id: 'a2', type: 'assistant', content: 'ok2' },
      ],
    });

    expect(graph.nodes.root!.label).toBe('Session');
    expect(graph.nodes.root!.children).toEqual(['turn:u2']);
    expect(graph.nodes.root!.meta?.truncated).toBe(true);
    expect(graph.nodes.root!.meta?.totalTurns).toBe(2);
    expect(graph.nodes['turn:u1']).toBeUndefined();
    expect(graph.nodes['msg:u2']!.label).toBe('second');
  });

  test('stable ids across re-derive', () => {
    const input = {
      sessionId: 's3',
      title: 'T',
      messages: [
        { id: 'u1', type: 'user', content: 'hi' },
        { id: 'a1', type: 'assistant', content: 'yo' },
      ],
    };
    const a = deriveSessionMindMap(input);
    const b = deriveSessionMindMap(input);
    expect(a.contentHash).toBe(b.contentHash);
    expect(Object.keys(a.nodes).sort()).toEqual(Object.keys(b.nodes).sort());
  });
});
