import { describe, it, expect } from 'bun:test';
import { handleListBackgroundTasks } from './list-background-tasks.ts';
import type { SessionToolContext, BackgroundTaskInfo } from '../context.ts';

function createCtx(tasks: BackgroundTaskInfo[] | undefined): SessionToolContext {
  return {
    sessionId: 'sess-1',
    listBackgroundTasks: tasks === undefined ? undefined : () => tasks,
  } as unknown as SessionToolContext;
}

describe('handleListBackgroundTasks', () => {
  it('errors when the context lacks the capability', async () => {
    const res = await handleListBackgroundTasks(createCtx(undefined), {});
    expect(res.isError).toBe(true);
  });

  it('reports "no background tasks" when the registry is empty', async () => {
    const res = await handleListBackgroundTasks(createCtx([]), {});
    expect(res.isError).toBeFalsy();
    const text = JSON.stringify(res);
    expect(text).toContain('No background tasks');
    expect(text).toContain('sess-1');
  });

  it('summarizes running / orphaned / finished counts and surfaces the orphan explanation', async () => {
    const tasks: BackgroundTaskInfo[] = [
      { taskId: 'a', status: 'running', startTime: 1000, elapsedSeconds: 12, intent: 'work A' },
      { taskId: 'b', status: 'orphaned', startTime: 900, elapsedSeconds: 30, completedAt: 2000 },
      { taskId: 'c', status: 'completed', startTime: 800, elapsedSeconds: 5, completedAt: 1500 },
    ];
    const res = await handleListBackgroundTasks(createCtx(tasks), {});
    expect(res.isError).toBeFalsy();
    const text = JSON.stringify(res);
    expect(text).toContain('1 running');
    expect(text).toContain('1 orphaned');
    expect(text).toContain('1 finished');
    // The orphan explanation must be present so the model doesn't invent a cause.
    expect(text.toLowerCase()).toContain('orphaned tasks were terminated');
    // The raw task data is included for the model to enumerate.
    expect(text).toContain('taskId');
    expect(text).toContain('work A');
  });
});
