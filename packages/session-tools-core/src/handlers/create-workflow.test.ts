import { describe, it, expect } from 'bun:test';
import type { SessionToolContext } from '../context.ts';
import { handleCreateWorkflow, type CreateWorkflowResult, type CreateWorkflowToolInput } from './create-workflow.ts';

function makeCtx(opts?: {
  createWorkflow?: (input: CreateWorkflowToolInput) => Promise<CreateWorkflowResult>;
}): SessionToolContext {
  const ctx: Partial<SessionToolContext> = {
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
  };
  if (opts?.createWorkflow) ctx.createWorkflow = opts.createWorkflow;
  return ctx as SessionToolContext;
}

const VALID_INPUT: CreateWorkflowToolInput = {
  slug: 'feedback-digest',
  metadata: {
    name: 'Feedback Digest',
    description: 'Triage feedback and draft follow-up actions.',
    trigger: {
      type: 'manual',
      inputs: [{ name: 'feedback', type: 'string', required: true }],
    },
    steps: [
      {
        id: 'triage',
        agent: 'triager',
        input: 'Classify this feedback: {{trigger.feedback}}',
        outputSchema: { type: 'object', properties: { summary: { type: 'string' } } },
      },
      {
        id: 'write-plan',
        agent: 'writer',
        input: 'Write a plan from {{steps.triage.output.summary}}',
      },
    ],
  },
  body: '# Feedback Digest',
};

describe('handleCreateWorkflow', () => {
  it('errors when context capability is missing', async () => {
    const result = await handleCreateWorkflow(makeCtx(), VALID_INPUT);
    expect(result.isError).toBe(true);
    expect((result.content[0] as any).text).toContain('not available in this context');
  });

  it('rejects an invalid slug', async () => {
    const ctx = makeCtx({ createWorkflow: async () => ({ ok: true, slug: 'x' }) });
    const result = await handleCreateWorkflow(ctx, { ...VALID_INPUT, slug: 'NotKebab' });
    expect(result.isError).toBe(true);
    expect((result.content[0] as any).text).toContain('Invalid workflow slug');
  });

  it('rejects empty steps', async () => {
    const ctx = makeCtx({ createWorkflow: async () => ({ ok: true, slug: 'x' }) });
    const result = await handleCreateWorkflow(ctx, {
      ...VALID_INPUT,
      metadata: { ...VALID_INPUT.metadata, steps: [] },
    });
    expect(result.isError).toBe(true);
    expect((result.content[0] as any).text).toContain('steps');
  });

  it('surfaces slug conflicts with a suggested variant', async () => {
    const ctx = makeCtx({
      createWorkflow: async () => ({ ok: false, error: 'A workflow with slug "feedback-digest" already exists.', suggestedSlug: 'feedback-digest-v2' }),
    });
    const result = await handleCreateWorkflow(ctx, VALID_INPUT);
    expect(result.isError).toBe(true);
    const text = (result.content[0] as any).text as string;
    expect(text).toContain('already exists');
    expect(text).toContain('feedback-digest-v2');
  });

  it('surfaces backend validation and activation failures', async () => {
    const ctx = makeCtx({
      createWorkflow: async () => ({
        ok: false,
        slug: 'feedback-digest',
        error: 'Created workflow "feedback-digest" but failed to activate it in this workspace: disk denied',
      }),
    });
    const result = await handleCreateWorkflow(ctx, VALID_INPUT);
    expect(result.isError).toBe(true);
    expect((result.content[0] as any).text).toContain('failed to activate');
  });

  it('returns success with the workflow route on happy path', async () => {
    let captured: CreateWorkflowToolInput | undefined;
    const ctx = makeCtx({
      createWorkflow: async (input) => {
        captured = input;
        return { ok: true, slug: input.slug };
      },
    });
    const result = await handleCreateWorkflow(ctx, VALID_INPUT);
    expect(result.isError).toBe(false);
    expect(captured?.slug).toBe('feedback-digest');
    expect((result.content[0] as any).text).toContain('/workflows/feedback-digest');
  });
});
