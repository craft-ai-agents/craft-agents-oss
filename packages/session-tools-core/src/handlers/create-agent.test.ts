import { describe, it, expect } from 'bun:test';
import type { SessionToolContext } from '../context.ts';
import { handleCreateAgent, type CreateAgentResult, type CreateAgentToolInput } from './create-agent.ts';

function makeCtx(opts?: {
  createAgent?: (input: CreateAgentToolInput) => Promise<CreateAgentResult>;
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
  if (opts?.createAgent) ctx.createAgent = opts.createAgent;
  return ctx as SessionToolContext;
}

const VALID_INPUT: CreateAgentToolInput = {
  slug: 'sales-call-prep',
  metadata: { name: 'Sales Call Prep', description: 'Talking points + objections.' },
  systemPrompt: 'You are a sales call prep specialist.',
};

describe('handleCreateAgent', () => {
  it('errors when context capability is missing', async () => {
    const result = await handleCreateAgent(makeCtx(), VALID_INPUT);
    expect(result.isError).toBe(true);
    expect((result.content[0] as any).text).toContain('not available in this context');
  });

  it('rejects an invalid slug', async () => {
    const ctx = makeCtx({ createAgent: async () => ({ ok: true, slug: 'x' }) });
    const result = await handleCreateAgent(ctx, { ...VALID_INPUT, slug: 'NotKebab' });
    expect(result.isError).toBe(true);
    expect((result.content[0] as any).text).toContain('Invalid agent slug');
  });

  it('refuses built-in slug clash', async () => {
    const ctx = makeCtx({ createAgent: async () => ({ ok: true, slug: 'concierge' }) });
    const result = await handleCreateAgent(ctx, { ...VALID_INPUT, slug: 'concierge' });
    expect(result.isError).toBe(true);
    expect((result.content[0] as any).text).toContain('built-in');
  });

  it('refuses empty system prompt', async () => {
    const ctx = makeCtx({ createAgent: async () => ({ ok: true, slug: 'x' }) });
    const result = await handleCreateAgent(ctx, { ...VALID_INPUT, systemPrompt: '   ' });
    expect(result.isError).toBe(true);
    expect((result.content[0] as any).text).toContain('systemPrompt');
  });

  it('surfaces slug-exists conflict with the suggested variant', async () => {
    const ctx = makeCtx({
      createAgent: async () => ({ ok: false, error: 'An agent with slug "sales-call-prep" already exists.', suggestedSlug: 'sales-call-prep-v2' }),
    });
    const result = await handleCreateAgent(ctx, VALID_INPUT);
    expect(result.isError).toBe(true);
    const text = (result.content[0] as any).text as string;
    expect(text).toContain('already exists');
    expect(text).toContain('sales-call-prep-v2');
  });

  it('returns success with the agent route on happy path', async () => {
    let captured: CreateAgentToolInput | undefined;
    const ctx = makeCtx({
      createAgent: async (input) => {
        captured = input;
        return { ok: true, slug: input.slug };
      },
    });
    const result = await handleCreateAgent(ctx, VALID_INPUT);
    expect(result.isError).toBe(false);
    expect(captured?.slug).toBe('sales-call-prep');
    expect((result.content[0] as any).text).toContain('/agents/agent/sales-call-prep');
  });
});
