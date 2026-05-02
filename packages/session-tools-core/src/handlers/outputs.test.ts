import { describe, expect, it } from 'bun:test';
import type { SessionToolContext } from '../context.ts';
import {
  handleCreateOutput,
  type CreateOutputResult,
  type CreateOutputToolInput,
} from './outputs.ts';

function makeCtx(opts?: {
  createOutput?: (input: CreateOutputToolInput) => Promise<CreateOutputResult>;
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
  if (opts?.createOutput) ctx.createOutput = opts.createOutput;
  return ctx as SessionToolContext;
}

describe('output handlers', () => {
  it('create_output errors when context capability is missing', async () => {
    const result = await handleCreateOutput(makeCtx(), {
      title: 'Research brief',
      kind: 'report',
      summary: 'A short research brief.',
    });

    expect(result.isError).toBe(true);
    expect((result.content[0] as any).text).toContain('not available in this context');
  });

  it('create_output validates title, summary, kind, content JSON, and URLs before calling capability', async () => {
    let called = false;
    const ctx = makeCtx({
      createOutput: async () => {
        called = true;
        return { ok: true };
      },
    });

    const emptyTitle = await handleCreateOutput(ctx, {
      title: ' ',
      kind: 'report',
      summary: 'x',
    });
    const emptySummary = await handleCreateOutput(ctx, {
      title: 'x',
      kind: 'report',
      summary: ' ',
    });
    const badKind = await handleCreateOutput(ctx, {
      title: 'x',
      kind: 'nonsense' as never,
      summary: 'x',
    });
    const badJson = await handleCreateOutput(ctx, {
      title: 'x',
      kind: 'report',
      summary: 'x',
      content: '{',
      contentMimeType: 'application/json',
    });
    const badLink = await handleCreateOutput(ctx, {
      title: 'x',
      kind: 'report',
      summary: 'x',
      links: [{ label: 'result', url: 'file:///tmp/result' }],
    });

    expect(emptyTitle.isError).toBe(true);
    expect(emptySummary.isError).toBe(true);
    expect(badKind.isError).toBe(true);
    expect(badJson.isError).toBe(true);
    expect(badLink.isError).toBe(true);
    expect(called).toBe(false);
  });

  it('create_output returns structured success payload', async () => {
    let captured: CreateOutputToolInput | undefined;
    const ctx = makeCtx({
      createOutput: async (input) => {
        captured = input;
        return {
          ok: true,
          outputId: '11111111-1111-4111-8111-111111111111',
          route: '/outputs/11111111-1111-4111-8111-111111111111',
          file: '/tmp/outputs/output.json',
        };
      },
    });

    const result = await handleCreateOutput(ctx, {
      title: ' Research brief ',
      kind: 'report',
      summary: ' A short research brief. ',
      content: '# Brief',
      contentMimeType: 'text/markdown',
    });

    expect(result.isError).toBe(false);
    expect(captured?.title).toBe('Research brief');
    expect(captured?.summary).toBe('A short research brief.');
    expect(result.structuredContent).toEqual({
      ok: true,
      outputId: '11111111-1111-4111-8111-111111111111',
      route: '/outputs/11111111-1111-4111-8111-111111111111',
      file: '/tmp/outputs/output.json',
    });
    expect((result.content[0] as any).text).toContain('Created output "Research brief"');
  });

  it('create_output surfaces backend errors', async () => {
    const result = await handleCreateOutput(makeCtx({
      createOutput: async () => ({ ok: false, error: 'path escaped workspace' }),
    }), {
      title: 'Research brief',
      kind: 'report',
      summary: 'A short research brief.',
    });

    expect(result.isError).toBe(true);
    expect((result.content[0] as any).text).toContain('path escaped workspace');
  });
});
