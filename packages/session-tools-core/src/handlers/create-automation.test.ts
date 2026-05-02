import { describe, it, expect } from 'bun:test';
import type { SessionToolContext } from '../context.ts';
import {
  handleCreateAutomation,
  type CreateAutomationToolInput,
  type CreateAutomationResult,
} from './create-automation.ts';

function makeCtx(opts?: {
  createAutomation?: (input: CreateAutomationToolInput) => Promise<CreateAutomationResult>;
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
  if (opts?.createAutomation) ctx.createAutomation = opts.createAutomation;
  return ctx as SessionToolContext;
}

const VALID_SCHEDULER: CreateAutomationToolInput = {
  eventName: 'SchedulerTick',
  matcher: {
    name: 'morning-digest',
    cron: '0 8 * * *',
    actions: [{ type: 'prompt', prompt: 'Summarize the news.' }],
  },
};

const VALID_WEBHOOK: CreateAutomationToolInput = {
  eventName: 'WebhookReceive',
  matcher: {
    name: 'inbound-hook',
    slug: 'inbound-hook',
    allowUnauthenticated: true,
    actions: [{ type: 'prompt', prompt: 'Handle $CRAFT_BODY' }],
  },
};

describe('handleCreateAutomation', () => {
  it('errors when context capability is missing', async () => {
    const result = await handleCreateAutomation(makeCtx(), VALID_SCHEDULER);
    expect(result.isError).toBe(true);
    expect((result.content[0] as any).text).toContain('not available in this context');
  });

  it('rejects unsupported eventName', async () => {
    const ctx = makeCtx({ createAutomation: async () => ({ ok: true }) });
    const result = await handleCreateAutomation(ctx, {
      ...VALID_SCHEDULER,
      eventName: 'NotARealEvent' as never,
    });
    expect(result.isError).toBe(true);
    expect((result.content[0] as any).text).toContain('Unsupported eventName');
  });

  it('rejects missing eventName', async () => {
    const ctx = makeCtx({ createAutomation: async () => ({ ok: true }) });
    const result = await handleCreateAutomation(ctx, {
      ...VALID_SCHEDULER,
      eventName: undefined as never,
    });
    expect(result.isError).toBe(true);
    expect((result.content[0] as any).text).toContain('Unsupported eventName');
  });

  it('rejects SchedulerTick missing cron', async () => {
    const ctx = makeCtx({ createAutomation: async () => ({ ok: true }) });
    const result = await handleCreateAutomation(ctx, {
      eventName: 'SchedulerTick',
      matcher: {
        actions: [{ type: 'prompt', prompt: 'do it' }],
      },
    });
    expect(result.isError).toBe(true);
    expect((result.content[0] as any).text).toContain('cron');
  });

  it('rejects SchedulerTick with invalid cron', async () => {
    const ctx = makeCtx({ createAutomation: async () => ({ ok: true }) });
    const result = await handleCreateAutomation(ctx, {
      eventName: 'SchedulerTick',
      matcher: {
        cron: 'not-a-cron-expression-at-all',
        actions: [{ type: 'prompt', prompt: 'do it' }],
      },
    });
    expect(result.isError).toBe(true);
    expect((result.content[0] as any).text.toLowerCase()).toContain('cron');
  });

  it('rejects Croner aliases and non-5-field cron expressions', async () => {
    const ctx = makeCtx({ createAutomation: async () => ({ ok: true }) });
    for (const cron of ['@hourly', '0 0 1 1 1 1']) {
      const result = await handleCreateAutomation(ctx, {
        ...VALID_SCHEDULER,
        matcher: { ...VALID_SCHEDULER.matcher, cron },
      });
      expect(result.isError).toBe(true);
      expect((result.content[0] as any).text).toContain('5-field');
    }
  });

  it('rejects WebhookReceive missing slug', async () => {
    const ctx = makeCtx({ createAutomation: async () => ({ ok: true }) });
    const result = await handleCreateAutomation(ctx, {
      eventName: 'WebhookReceive',
      matcher: {
        actions: [{ type: 'prompt', prompt: 'handle' }],
      },
    });
    expect(result.isError).toBe(true);
    expect((result.content[0] as any).text).toContain('slug');
  });

  it('rejects WebhookReceive with invalid slug shape', async () => {
    const ctx = makeCtx({ createAutomation: async () => ({ ok: true }) });
    const result = await handleCreateAutomation(ctx, {
      eventName: 'WebhookReceive',
      matcher: {
        slug: 'NotKebab_Case',
        actions: [{ type: 'prompt', prompt: 'handle' }],
      },
    });
    expect(result.isError).toBe(true);
    expect((result.content[0] as any).text).toContain('Invalid webhook slug');
  });

  it('rejects WebhookReceive without secretEnv or explicit unauthenticated opt-in', async () => {
    const ctx = makeCtx({ createAutomation: async () => ({ ok: true }) });
    const result = await handleCreateAutomation(ctx, {
      eventName: 'WebhookReceive',
      matcher: {
        slug: 'needs-auth',
        actions: [{ type: 'prompt', prompt: 'handle' }],
      },
    });
    expect(result.isError).toBe(true);
    expect((result.content[0] as any).text).toContain('secretEnv');
  });

  it('accepts WebhookReceive with secretEnv instead of unauthenticated opt-in', async () => {
    const ctx = makeCtx({
      createAutomation: async (input) => ({
        ok: true,
        slug: input.matcher.slug,
        eventName: input.eventName,
      }),
    });
    const result = await handleCreateAutomation(ctx, {
      eventName: 'WebhookReceive',
      matcher: {
        slug: 'signed-hook',
        secretEnv: 'CRAFT_WH_SIGNED_HOOK_SECRET',
        actions: [{ type: 'prompt', prompt: 'handle' }],
      },
    });
    expect(result.isError).toBe(false);
  });

  it('rejects prompt actions with legacy create_automation thinkingLevel values', async () => {
    const ctx = makeCtx({ createAutomation: async () => ({ ok: true }) });
    const result = await handleCreateAutomation(ctx, {
      eventName: 'SchedulerTick',
      matcher: {
        cron: '* * * * *',
        actions: [{ type: 'prompt', prompt: 'do it', thinkingLevel: 'disabled' as never }],
      },
    });
    expect(result.isError).toBe(true);
    expect((result.content[0] as any).text).toContain('Invalid thinkingLevel');
  });

  it('rejects empty actions array', async () => {
    const ctx = makeCtx({ createAutomation: async () => ({ ok: true }) });
    const result = await handleCreateAutomation(ctx, {
      eventName: 'SchedulerTick',
      matcher: { cron: '* * * * *', actions: [] },
    });
    expect(result.isError).toBe(true);
    expect((result.content[0] as any).text).toContain('at least one action');
  });

  it('rejects empty prompt action', async () => {
    const ctx = makeCtx({ createAutomation: async () => ({ ok: true }) });
    const result = await handleCreateAutomation(ctx, {
      eventName: 'SchedulerTick',
      matcher: {
        cron: '* * * * *',
        actions: [{ type: 'prompt', prompt: '   ' }],
      },
    });
    expect(result.isError).toBe(true);
    expect((result.content[0] as any).text).toContain('non-empty');
  });

  it('surfaces slug-exists conflict from backend', async () => {
    const ctx = makeCtx({
      createAutomation: async () => ({
        ok: false,
        error: 'slug-exists: a webhook automation with slug "inbound-hook" already exists.',
      }),
    });
    const result = await handleCreateAutomation(ctx, VALID_WEBHOOK);
    expect(result.isError).toBe(true);
    expect((result.content[0] as any).text).toContain('slug-exists');
  });

  it('returns success with nextFireAt for SchedulerTick happy path', async () => {
    let captured: CreateAutomationToolInput | undefined;
    const ctx = makeCtx({
      createAutomation: async (input) => {
        captured = input;
        return {
          ok: true,
          slug: 'abc123',
          eventName: input.eventName,
          nextFireAt: '2026-05-01T08:00:00.000Z',
        };
      },
    });
    const result = await handleCreateAutomation(ctx, VALID_SCHEDULER);
    expect(result.isError).toBe(false);
    expect(captured?.eventName).toBe('SchedulerTick');
    const text = (result.content[0] as any).text as string;
    expect(text).toContain('SchedulerTick');
    expect(text).toContain('2026-05-01T08:00:00.000Z');
  });

  it('returns success for WebhookReceive happy path', async () => {
    const ctx = makeCtx({
      createAutomation: async (input) => ({
        ok: true,
        slug: input.matcher.slug,
        eventName: input.eventName,
      }),
    });
    const result = await handleCreateAutomation(ctx, VALID_WEBHOOK);
    expect(result.isError).toBe(false);
    expect((result.content[0] as any).text).toContain('WebhookReceive');
  });
});
