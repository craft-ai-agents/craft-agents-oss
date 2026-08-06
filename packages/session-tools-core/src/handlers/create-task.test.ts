import { describe, it, expect } from 'bun:test';
import { handleCreateTask } from './create-task.ts';
import type { SessionToolContext, CreateTaskInput, CreateTaskResult } from '../context.ts';

function createCtx(result?: Partial<CreateTaskResult>): {
  ctx: SessionToolContext;
  calls: CreateTaskInput[];
} {
  const calls: CreateTaskInput[] = [];
  const ctx = {
    createTask: async (input: CreateTaskInput) => {
      calls.push(input);
      return {
        slug: 'my-task',
        orchestratorSessionId: 'sess-1',
        warnings: [],
        ...result,
      } satisfies CreateTaskResult;
    },
  } as unknown as SessionToolContext;
  return { ctx, calls };
}

describe('handleCreateTask', () => {
  it('creates a task and returns the structured result as JSON', async () => {
    const { ctx, calls } = createCtx({ taskLabelId: 'label-1' });
    const result = await handleCreateTask(ctx, {
      title: 'Fix login flow',
      description: 'Investigate and fix the OAuth redirect loop',
      acceptanceCriteria: 'Login succeeds on first attempt',
      sources: ['github'],
    });

    expect(result.isError).toBeFalsy();
    expect(calls).toHaveLength(1);
    expect(calls[0].title).toBe('Fix login flow');
    expect(calls[0].acceptanceCriteria).toBe('Login succeeds on first attempt');

    const payload = JSON.parse(result.content[0].text);
    expect(payload).toEqual({
      slug: 'my-task',
      orchestratorSessionId: 'sess-1',
      taskLabelId: 'label-1',
      warnings: [],
    });
  });

  it('surfaces backend warnings in the result', async () => {
    const { ctx } = createCtx({ warnings: ['Unknown sources: nope'] });
    const result = await handleCreateTask(ctx, { title: 'T', description: 'D' });

    expect(result.isError).toBeFalsy();
    expect(JSON.parse(result.content[0].text).warnings).toEqual(['Unknown sources: nope']);
  });

  it('errors when the callback is not available (e.g. Codex MCP subprocess)', async () => {
    const ctx = {} as unknown as SessionToolContext;
    const result = await handleCreateTask(ctx, { title: 'T', description: 'D' });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('not available');
  });

  it('rejects a missing title or description without calling the backend', async () => {
    const { ctx, calls } = createCtx();

    const noTitle = await handleCreateTask(ctx, { title: '  ', description: 'D' });
    expect(noTitle.isError).toBe(true);
    expect(noTitle.content[0].text).toContain('title');

    const noDescription = await handleCreateTask(ctx, { title: 'T', description: '' });
    expect(noDescription.isError).toBe(true);
    expect(noDescription.content[0].text).toContain('description');

    expect(calls).toHaveLength(0);
  });

  it('wraps backend failures as tool errors', async () => {
    const ctx = {
      createTask: async () => {
        throw new Error('Invalid task spec: goal required');
      },
    } as unknown as SessionToolContext;

    const result = await handleCreateTask(ctx, { title: 'T', description: 'D' });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Invalid task spec');
  });
});
