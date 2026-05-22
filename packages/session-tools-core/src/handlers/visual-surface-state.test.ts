import { describe, expect, it } from 'bun:test';
import type { SessionToolContext } from '../context.ts';
import { handleVisualSurfaceState, type VisualSurfaceStateToolResult } from './visual-surface-state.ts';

function makeCtx(getVisualSurfaceState?: () => Promise<VisualSurfaceStateToolResult>): SessionToolContext {
  const ctx: Partial<SessionToolContext> = {
    sessionId: 'session-1',
    workspacePath: '/tmp/workspace',
    plansFolderPath: '/tmp/workspace/plans',
    callbacks: {
      onPlanSubmitted: () => {},
      onAuthRequest: () => {},
    },
  };
  Object.defineProperty(ctx, 'sourcesPath', { get: () => '/tmp/workspace/sources' });
  Object.defineProperty(ctx, 'skillsPath', { get: () => '/tmp/workspace/skills' });
  if (getVisualSurfaceState) ctx.getVisualSurfaceState = getVisualSurfaceState;
  return ctx as SessionToolContext;
}

describe('visual_surface_state handler', () => {
  it('errors when context capability is missing', async () => {
    const result = await handleVisualSurfaceState(makeCtx());
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('not available');
  });

  it('returns structured visual surface state', async () => {
    const state: VisualSurfaceStateToolResult = {
      canvas: {
        exists: true,
        outputId: 'board-1',
        title: 'Session board',
        cardCount: 1,
        noteCount: 1,
        outputCardCount: 0,
        updatedAt: '2026-05-22T00:00:00.000Z',
      },
      outputs: [{
        id: 'web-1',
        title: 'Local app',
        kind: 'other',
        status: 'published',
        summary: 'Preview',
        previewMode: 'web',
        pinnable: true,
        localWebPreview: {
          url: 'http://localhost:4187/',
          displayHost: 'localhost:4187',
        },
      }],
      webPreviews: [{
        id: 'web-1',
        title: 'Local app',
        kind: 'other',
        status: 'published',
        summary: 'Preview',
        previewMode: 'web',
        pinnable: true,
        localWebPreview: {
          url: 'http://localhost:4187/',
          displayHost: 'localhost:4187',
        },
      }],
      capabilities: {
        canOpenCanvas: true,
        canPinOutputs: true,
        canInspectWebConsole: false,
      },
    };

    const result = await handleVisualSurfaceState(makeCtx(async () => state));
    expect(result.isError).toBe(false);
    expect(result.content[0]?.text).toContain('Canvas has 1 card');
    expect(result.structuredContent).toEqual({ ...state });
  });
});
