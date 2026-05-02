import { describe, expect, it } from 'bun:test';
import type { SessionToolContext } from '../context.ts';
import {
  handleCancelWorkflowRun,
  handleGetWorkflow,
  handleGetWorkflowRun,
  handleListWorkflows,
  handleStartWorkflow,
} from './workflows.ts';

function makeCtx(overrides?: Partial<SessionToolContext>): SessionToolContext {
  return {
    sessionId: 't',
    workspacePath: '/tmp',
    plansFolderPath: '/tmp/plans',
    callbacks: { onPlanSubmitted: () => {}, onAuthRequest: () => {} },
    fs: {
      exists: () => false,
      readFile: () => '',
      readFileBuffer: () => Buffer.from(''),
      writeFile: () => {},
      isDirectory: () => false,
      readdir: () => [],
      stat: () => ({ size: 0, isDirectory: () => false }),
    },
    loadSourceConfig: () => null,
    get sourcesPath() { return '/tmp/sources'; },
    get skillsPath() { return '/tmp/skills'; },
    ...overrides,
  } as SessionToolContext;
}

function text(result: { content: Array<{ text?: string }> }): string {
  return result.content[0]?.text ?? '';
}

describe('workflow session tools', () => {
  const RUN_ID = '11111111-1111-4111-8111-111111111111';

  it('list_workflows errors when context capability is missing', async () => {
    const result = await handleListWorkflows(makeCtx(), {});
    expect(result.isError).toBe(true);
    expect(text(result)).toContain('not available');
  });

  it('list_workflows returns JSON from context', async () => {
    const result = await handleListWorkflows(makeCtx({
      listWorkflows: () => ({
        total: 1,
        returned: 1,
        workflows: [{
          slug: 'pitch',
          name: 'Pitch',
          description: 'Draft pitch.',
          active: true,
          triggerType: 'manual',
          triggerInputs: [],
          steps: [],
        }],
      }),
    }), { activeOnly: true });
    expect(result.isError).toBe(false);
    expect(JSON.parse(text(result)).workflows[0].slug).toBe('pitch');
  });

  it('get_workflow returns not found cleanly', async () => {
    const result = await handleGetWorkflow(makeCtx({ getWorkflow: () => null }), { slug: 'missing' });
    expect(result.isError).toBe(true);
    expect(text(result)).toContain('Workflow not found');
  });

  it('start_workflow returns the run snapshot', async () => {
    const result = await handleStartWorkflow(makeCtx({
      startWorkflow: async (slug, triggerInputs) => ({ id: RUN_ID, workflowSlug: slug, triggerInputs }),
    }), { slug: 'pitch', triggerInputs: { company: 'Acme' } });
    expect(result.isError).toBe(false);
    expect(JSON.parse(text(result)).id).toBe(RUN_ID);
  });

  it('get_workflow_run returns not found cleanly', async () => {
    const result = await handleGetWorkflowRun(makeCtx({ getWorkflowRun: () => null }), { runId: 'run-missing' });
    expect(result.isError).toBe(true);
    expect(text(result)).toContain('Workflow run not found');
  });

  it('cancel_workflow_run confirms cancellation', async () => {
    let cancelled = '';
    const result = await handleCancelWorkflowRun(makeCtx({
      cancelWorkflowRun: async (runId) => { cancelled = runId; },
    }), { runId: RUN_ID });
    expect(result.isError).toBe(false);
    expect(cancelled).toBe(RUN_ID);
    expect(text(result)).toContain(`Cancelled workflow run ${RUN_ID}`);
  });

  it('cancel_workflow_run returns structured cancel details when available', async () => {
    const result = await handleCancelWorkflowRun(makeCtx({
      cancelWorkflowRun: (async () => ({ id: RUN_ID, state: 'cancelled' })) as unknown as SessionToolContext['cancelWorkflowRun'],
    }), { runId: RUN_ID });
    expect(result.isError).toBe(false);
    expect(JSON.parse(text(result))).toEqual({ id: RUN_ID, state: 'cancelled' });
  });
});
