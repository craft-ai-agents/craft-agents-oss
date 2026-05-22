import { describe, expect, it } from 'bun:test';
import type { SessionToolContext } from '../context.ts';
import {
  handleVisualSurface,
  type VisualSurfaceToolInput,
  type VisualSurfaceToolResult,
} from './visual-surface.ts';

function makeCtx(opts?: {
  applyVisualSurfaceEvent?: (input: VisualSurfaceToolInput) => Promise<VisualSurfaceToolResult>;
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
  if (opts?.applyVisualSurfaceEvent) ctx.applyVisualSurfaceEvent = opts.applyVisualSurfaceEvent;
  return ctx as SessionToolContext;
}

describe('visual_surface handler', () => {
  it('errors when context capability is missing', async () => {
    const result = await handleVisualSurface(makeCtx(), { action: 'open_board' });
    expect(result.isError).toBe(true);
    expect((result.content[0] as any).text).toContain('not available');
  });

  it('validates required action payload before calling capability', async () => {
    let called = false;
    const ctx = makeCtx({
      applyVisualSurfaceEvent: async () => {
        called = true;
        return { ok: true };
      },
    });

    const missingTitle = await handleVisualSurface(ctx, { action: 'add_note', title: '' });
    const missingOutput = await handleVisualSurface(ctx, { action: 'pin_output', outputId: '' });
    const missingImage = await handleVisualSurface(ctx, { action: 'add_image', outputId: '' });

    expect(missingTitle.isError).toBe(true);
    expect(missingOutput.isError).toBe(true);
    expect(missingImage.isError).toBe(true);
    expect(called).toBe(false);
  });

  it('normalizes input and returns a structured receipt', async () => {
    let captured: VisualSurfaceToolInput | undefined;
    const ctx = makeCtx({
      applyVisualSurfaceEvent: async (input) => {
        captured = input;
        return {
          ok: true,
          eventId: 'evt-1',
          outputId: 'board-1',
          receipt: 'Added note "Decision" to Canvas.',
          board: { title: 'Session board', cards: [{ id: 'note-1' }], updatedAt: '2026-05-22T00:00:00.000Z' },
        };
      },
    });

    const result = await handleVisualSurface(ctx, {
      action: 'add_note',
      title: ' Decision ',
      body: ' Body ',
    });

    expect(result.isError).toBe(false);
    expect(captured).toEqual({ action: 'add_note', title: 'Decision', body: 'Body' });
    expect((result.content[0] as any).text).toContain('Added note');
    expect(result.structuredContent).toEqual({
      ok: true,
      eventId: 'evt-1',
      outputId: 'board-1',
      receipt: 'Added note "Decision" to Canvas.',
      board: {
        title: 'Session board',
        cardCount: 1,
        updatedAt: '2026-05-22T00:00:00.000Z',
      },
    });
  });

  it('surfaces backend errors', async () => {
    const result = await handleVisualSurface(makeCtx({
      applyVisualSurfaceEvent: async () => ({ ok: false, error: 'Output is not pinnable' }),
    }), {
      action: 'pin_output',
      outputId: 'out-1',
    });
    expect(result.isError).toBe(true);
    expect((result.content[0] as any).text).toContain('not pinnable');
  });
});
