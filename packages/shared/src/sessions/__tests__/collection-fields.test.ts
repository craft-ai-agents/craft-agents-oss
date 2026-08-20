import { describe, expect, it } from 'bun:test';
import { SESSION_PERSISTENT_FIELDS } from '../types.ts';
import { pickSessionFields } from '../utils.ts';

describe('session persistence: collection linear-view fields', () => {
  it('includes rank, priority, and dueDate in SESSION_PERSISTENT_FIELDS', () => {
    expect(SESSION_PERSISTENT_FIELDS).toContain('rank');
    expect(SESSION_PERSISTENT_FIELDS).toContain('priority');
    expect(SESSION_PERSISTENT_FIELDS).toContain('dueDate');
  });

  it('pickSessionFields preserves rank, priority, and dueDate when present', () => {
    const source = {
      id: 's1',
      workspaceRootPath: '/tmp/ws',
      rank: '0|i00000:',
      priority: 'high',
      dueDate: 1_720_000_000_000,
      createdAt: 1,
      lastUsedAt: 2,
      ignoredRuntimeField: 'nope',
    } as const;

    const picked = pickSessionFields(source);
    expect(picked.rank).toBe('0|i00000:');
    expect(picked.priority).toBe('high');
    expect(picked.dueDate).toBe(1_720_000_000_000);
    expect((picked as Record<string, unknown>).ignoredRuntimeField).toBeUndefined();
  });

  it('pickSessionFields preserves dueDate null', () => {
    const source = {
      id: 's2',
      workspaceRootPath: '/tmp/ws',
      dueDate: null,
      createdAt: 1,
      lastUsedAt: 2,
    } as const;

    const picked = pickSessionFields(source);
    expect(picked.dueDate).toBeNull();
  });
});
