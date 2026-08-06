import { describe, it, expect } from 'bun:test';
import {
  matchesLabelFilter,
  findTaskLabel,
  findTaskItemLabelId,
  resolveTaskScopeLabelId,
} from '../filter.ts';
import type { LabelConfig } from '../types.ts';

const TREE: LabelConfig[] = [
  {
    id: 'task',
    name: 'Task',
    children: [{ id: 'task-fix-login-1', name: 'TASK-fix-login-1' }],
  },
  { id: 'area', name: 'Area', children: [{ id: 'area-ui', name: 'UI' }] },
];

describe('matchesLabelFilter', () => {
  it('matches valued entries by base id', () => {
    expect(matchesLabelFilter({ labels: ['task::3'] }, { labelId: 'task' }, TREE)).toBe(true);
    expect(matchesLabelFilter({ labels: ['bug'] }, { labelId: 'task' }, TREE)).toBe(false);
  });

  it('matches descendants through the tree', () => {
    expect(matchesLabelFilter({ labels: ['area-ui'] }, { labelId: 'area' }, TREE)).toBe(true);
    expect(matchesLabelFilter({ labels: ['area-ui'] }, { labelId: 'area' }, [])).toBe(false);
  });

  it("'__all__' matches any labeled session, never unlabeled ones", () => {
    expect(matchesLabelFilter({ labels: ['bug'] }, { labelId: '__all__' }, TREE)).toBe(true);
    expect(matchesLabelFilter({ labels: [] }, { labelId: '__all__' }, TREE)).toBe(false);
    expect(matchesLabelFilter({}, { labelId: '__all__' }, TREE)).toBe(false);
  });

  it('projectId scopes matches (including __all__)', () => {
    const session = { labels: ['task::1'], projectId: 'p1' };
    expect(matchesLabelFilter(session, { labelId: 'task', projectId: 'p1' }, TREE)).toBe(true);
    expect(matchesLabelFilter(session, { labelId: 'task', projectId: 'p2' }, TREE)).toBe(false);
    expect(matchesLabelFilter({ labels: ['bug'] }, { labelId: '__all__', projectId: 'p1' }, TREE)).toBe(false);
  });
});

describe('findTaskLabel', () => {
  it('resolves the root by id or case-insensitive name, regardless of valueType', () => {
    expect(findTaskLabel([{ id: 'task', name: 'Task' }])?.id).toBe('task');
    expect(findTaskLabel([{ id: 'task-2', name: ' TASK ' }])?.id).toBe('task-2');
    // A legacy reserved root from the numbered scheme still matches (converged by ensureTaskLabel).
    expect(findTaskLabel([{ id: 'task', name: 'Task', valueType: 'number' }])?.id).toBe('task');
    expect(findTaskLabel([{ id: 'tasks', name: 'My Tasks' }])).toBeUndefined();
    expect(findTaskLabel([])).toBeUndefined();
  });
});

describe('findTaskItemLabelId / resolveTaskScopeLabelId', () => {
  it('finds the per-task item label (a descendant of the root), never the root itself', () => {
    expect(findTaskItemLabelId(['bug', 'task-fix-login-1'], TREE)).toBe('task-fix-login-1');
    expect(findTaskItemLabelId(['task'], TREE)).toBeUndefined();
    expect(findTaskItemLabelId(['area-ui'], TREE)).toBeUndefined();
    expect(findTaskItemLabelId(undefined, TREE)).toBeUndefined();
  });

  it('scope prefers the item label, falls back to the root for legacy sessions, else undefined', () => {
    expect(resolveTaskScopeLabelId(['task-fix-login-1'], TREE)).toBe('task-fix-login-1');
    // Legacy `task::N` valued entries resolve to the root by base id.
    expect(resolveTaskScopeLabelId(['task::3'], TREE)).toBe('task');
    expect(resolveTaskScopeLabelId(['bug'], TREE)).toBeUndefined();
  });
});
