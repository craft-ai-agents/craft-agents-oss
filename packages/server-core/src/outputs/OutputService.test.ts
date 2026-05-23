import { describe, expect, it } from 'bun:test';
import { chmodSync, existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { OutputService } from './OutputService';
import { writeRun, type WorkflowRunSnapshot } from '@craft-agent/shared/workflows';
import { OUTPUT_SHOW_IN_CANVAS_TAG } from '@craft-agent/shared/outputs/constants';
import { VISUAL_BOARD_ASSET_PATH, type VisualBoardSnapshot } from '@craft-agent/shared/visual-board';
import { VISUAL_SURFACE_EVENTS_ASSET_PATH } from '@craft-agent/shared/visual-surface-events';

function makeRunSnapshot(runId: string, workspaceId: string): WorkflowRunSnapshot {
  const now = new Date().toISOString();
  return {
    id: runId,
    workspaceId,
    workflowSlug: 'wf',
    workflowSnapshot: {
      metadata: { name: 'wf', steps: [] } as any,
      body: '',
    } as any,
    state: 'running',
    steps: [],
    trigger: { type: 'manual', inputs: {}, firedAt: now } as any,
    createdAt: now,
    updatedAt: now,
  } as WorkflowRunSnapshot;
}

describe('OutputService run mutex', () => {
  it('serializes concurrent attaches so both outputIds land', async () => {
    const root = mkdtempSync(join(tmpdir(), 'osvc-mutex-'));
    mkdirSync(join(root, 'outputs'), { recursive: true });

    const runId = randomUUID();
    writeRun(root, makeRunSnapshot(runId, 'ws'));

    const service = new OutputService({
      getWorkspaceRootPath: () => root,
    });

    const callOnce = (title: string) =>
      service.createFromSessionTool({
        workspaceId: 'ws',
        sessionId: 's',
        workflowRunId: runId,
        workflowSlug: 'wf',
        workflowName: 'wf',
        output: {
          title,
          kind: 'report',
          summary: 'x',
          content: '# x',
          contentMimeType: 'text/markdown',
        },
      });

    const [a, b] = await Promise.all([callOnce('A'), callOnce('B')]);
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);

    const runJsonPath = join(root, 'runs', runId, 'run.json');
    const written = JSON.parse(readFileSync(runJsonPath, 'utf-8')) as WorkflowRunSnapshot;
    const ids = written.outputIds ?? [];
    expect(ids).toContain(a.outputId!);
    expect(ids).toContain(b.outputId!);
    expect(ids.length).toBe(2);
  });
});

describe('OutputService visual boards', () => {
  it('marks and pins showInCanvas session outputs', async () => {
    const root = mkdtempSync(join(tmpdir(), 'osvc-show-canvas-'));
    mkdirSync(join(root, 'outputs'), { recursive: true });
    const service = new OutputService({
      getWorkspaceRootPath: () => root,
    });

    const result = await service.createFromSessionTool({
      workspaceId: 'ws',
      sessionId: 'session-1',
      output: {
        title: 'Canvas brief',
        kind: 'report',
        summary: 'Show this beside chat.',
        content: '# Canvas brief',
        contentMimeType: 'text/markdown',
        showInCanvas: true,
      },
    });

    expect(result.ok).toBe(true);
    expect(result.shownInCanvas).toBe(true);
    expect(result.canvasReceipt).toContain('Pinned output');

    const output = service.get('ws', result.outputId!);
    expect(output?.tags).toContain(OUTPUT_SHOW_IN_CANVAS_TAG);

    const state = service.getVisualSurfaceState('ws', 'session-1');
    expect(state.canvas.exists).toBe(true);
    expect(state.canvas.outputCardCount).toBe(1);
    expect(state.canvas.cardCount).toBe(1);
    expect(state.canvas.cards[0]).toMatchObject({
      type: 'output',
      outputId: result.outputId,
      title: 'Canvas brief',
      kind: 'report',
    });
  });

  it('reports visual surface state with board cards and Browser Pane preview candidates', async () => {
    const root = mkdtempSync(join(tmpdir(), 'osvc-visual-state-'));
    mkdirSync(join(root, 'outputs'), { recursive: true });
    const service = new OutputService({
      getWorkspaceRootPath: () => root,
    });

    const empty = service.getVisualSurfaceState('ws', 'session-1');
    expect(empty.canvas.exists).toBe(false);
    expect(empty.outputs).toEqual([]);
    expect(empty.capabilities.canInspectWebConsole).toBe(false);
    expect(empty.capabilities.canInspectWebPreviewsInBrowserPane).toBe(false);

    service.applyVisualSurfaceEvent('ws', 'session-1', {
      action: 'add_note',
      title: 'Direction',
      body: 'Show local web preview.',
    }, 'agent');

    const local = await service.createFromSessionTool({
      workspaceId: 'ws',
      sessionId: 'session-1',
      output: {
        title: 'Local app',
        kind: 'other',
        summary: 'Loopback preview',
        links: [{ label: 'Preview', url: 'http://localhost:4187/report.html', role: 'primary' }],
      },
    });
    const generated = await service.createFromSessionTool({
      workspaceId: 'ws',
      sessionId: 'session-1',
      output: {
        title: 'Generated HTML',
        kind: 'code',
        summary: 'Generated web artifact',
        files: [{ label: 'index.html', path: 'index.html', role: 'primary' }],
      },
    });
    const remote = await service.createFromSessionTool({
      workspaceId: 'ws',
      sessionId: 'session-1',
      output: {
        title: 'Remote app',
        kind: 'other',
        summary: 'Remote preview',
        links: [{ label: 'Remote', url: 'https://example.com/report.html', role: 'primary' }],
      },
    });

    expect(local.ok).toBe(true);
    expect(generated.ok).toBe(true);
    expect(remote.ok).toBe(true);
    const state = service.getVisualSurfaceState('ws', 'session-1');
    expect(state.canvas.exists).toBe(true);
    expect(state.canvas.cardCount).toBe(1);
    expect(state.canvas.noteCount).toBe(1);
    expect(state.canvas.cards[0]).toMatchObject({
      type: 'note',
      title: 'Direction',
    });
    expect(state.outputs.map((output) => output.id)).toContain(local.outputId!);
    expect(state.outputs.map((output) => output.id)).toContain(generated.outputId!);
    expect(state.outputs.map((output) => output.id)).toContain(remote.outputId!);
    expect(state.webPreviews).toHaveLength(2);
    expect(state.capabilities.canInspectWebPreviewsInBrowserPane).toBe(true);
    expect(state.webPreviews.find((output) => output.id === local.outputId)).toMatchObject({
      id: local.outputId!,
      canInspectInBrowserPane: true,
      previewSurface: 'browser-pane',
      webPreview: {
        url: 'http://localhost:4187/report.html',
        displayHost: 'localhost:4187',
        kind: 'local-web',
      },
      localWebPreview: {
        url: 'http://localhost:4187/report.html',
        displayHost: 'localhost:4187',
      },
    });
    expect(state.webPreviews.find((output) => output.id === generated.outputId)).toMatchObject({
      id: generated.outputId!,
      canInspectInBrowserPane: true,
      previewSurface: 'browser-pane',
      webPreview: {
        url: `runner-output://asset/ws/${generated.outputId}/index.html`,
        displayHost: 'generated output',
        kind: 'generated-html',
      },
    });
    expect(state.outputs.find((output) => output.id === remote.outputId)).toMatchObject({
      canInspectInBrowserPane: false,
      previewSurface: 'canvas',
    });
  });

  it('records one visual capture asset per output version and reports it in visual state', async () => {
    const root = mkdtempSync(join(tmpdir(), 'osvc-visual-capture-'));
    mkdirSync(join(root, 'outputs'), { recursive: true });
    const emitted: string[] = [];
    const service = new OutputService({
      getWorkspaceRootPath: () => root,
      emitOutputsUpdated: (workspaceId) => emitted.push(workspaceId),
    });

    const output = await service.createFromSessionTool({
      workspaceId: 'ws',
      sessionId: 'session-1',
      output: {
        title: 'Capture me',
        kind: 'report',
        summary: 'Visible artifact',
        content: '# capture me',
        contentMimeType: 'text/markdown',
      },
    });
    expect(output.ok).toBe(true);

    const dataUrl = `data:image/png;base64,${Buffer.from('png-data').toString('base64')}`;
    const first = service.recordVisualCapture({
      workspaceId: 'ws',
      sessionId: 'session-1',
      outputId: output.outputId!,
      source: 'canvas',
      captureVersion: 'version-1',
      dataUrl,
      width: 640,
      height: 360,
    });
    const second = service.recordVisualCapture({
      workspaceId: 'ws',
      sessionId: 'session-1',
      outputId: output.outputId!,
      source: 'canvas',
      captureVersion: 'version-1',
      dataUrl,
      width: 640,
      height: 360,
    });

    expect(first.ok).toBe(true);
    expect(second.skipped).toBe(true);
    expect(existsSync(join(root, 'outputs', output.outputId!, first.path))).toBe(true);
    const manifest = service.get('ws', output.outputId!);
    expect(manifest?.assets.filter((asset) => asset.id === 'visual-capture-canvas')).toHaveLength(1);
    const state = service.getVisualSurfaceState('ws', 'session-1');
    expect(state.outputs.find((entry) => entry.id === output.outputId)).toMatchObject({
      visualCapture: {
        assetId: 'visual-capture-canvas',
        path: first.path,
      },
    });
    expect(emitted).toEqual(['ws', 'ws']);
  });

  it('records size and hash metadata for file-backed outputs', async () => {
    const root = mkdtempSync(join(tmpdir(), 'osvc-file-output-meta-'));
    mkdirSync(join(root, 'outputs'), { recursive: true });
    const dataDir = join(root, 'sessions', 'session-1', 'data');
    mkdirSync(dataDir, { recursive: true });
    const filePath = join(dataDir, 'preview.html');
    writeFileSync(filePath, '<!doctype html><h1>Preview</h1>', 'utf-8');
    const service = new OutputService({
      getWorkspaceRootPath: () => root,
    });

    const output = await service.createFromSessionTool({
      workspaceId: 'ws',
      sessionId: 'session-1',
      output: {
        title: 'Preview HTML',
        kind: 'code',
        summary: 'HTML preview',
        files: [{ path: filePath, role: 'primary' }],
      },
    });

    expect(output.ok).toBe(true);
    const manifest = service.get('ws', output.outputId!);
    expect(manifest?.primary).toMatchObject({
      mimeType: 'text/html',
      sizeBytes: Buffer.byteLength('<!doctype html><h1>Preview</h1>'),
    });
    expect(manifest?.primary?.sha256).toBeDefined();
  });

  it('creates, reads, and saves one output-backed board per session', () => {
    const root = mkdtempSync(join(tmpdir(), 'osvc-board-'));
    mkdirSync(join(root, 'outputs'), { recursive: true });
    const emitted: string[] = [];
    const service = new OutputService({
      getWorkspaceRootPath: () => root,
      emitOutputsUpdated: (workspaceId) => emitted.push(workspaceId),
    });

    const first = service.getOrCreateVisualBoard('ws', 'session-1');
    expect(first.board.cards).toEqual([]);
    expect(first.output.tags).toContain('visual-board');
    expect(first.output.primary?.path).toBe(VISUAL_BOARD_ASSET_PATH);

    const now = new Date().toISOString();
    const nextBoard: VisualBoardSnapshot = {
      ...first.board,
      cards: [{
        id: 'note-1',
        type: 'note',
        title: 'Decision',
        body: 'Use structured board cards.',
        createdAt: now,
        updatedAt: now,
      }],
      updatedAt: now,
    };
    const saved = service.saveVisualBoard('ws', 'session-1', nextBoard);
    expect(saved.output.id).toBe(first.output.id);
    expect(saved.output.summary).toBe('1 card: 1 note, 0 outputs');

    const loaded = service.getOrCreateVisualBoard('ws', 'session-1');
    expect(loaded.output.id).toBe(first.output.id);
    expect(loaded.board.cards[0]?.title).toBe('Decision');
    expect(emitted).toContain('ws');
  });

  it('repairs a corrupt board asset without creating a duplicate board output', () => {
    const root = mkdtempSync(join(tmpdir(), 'osvc-board-repair-'));
    mkdirSync(join(root, 'outputs'), { recursive: true });
    const service = new OutputService({
      getWorkspaceRootPath: () => root,
    });

    const first = service.getOrCreateVisualBoard('ws', 'session-1');
    writeFileSync(join(root, 'outputs', first.output.id, VISUAL_BOARD_ASSET_PATH), '{not json', 'utf-8');

    const repaired = service.getOrCreateVisualBoard('ws', 'session-1');
    expect(repaired.output.id).toBe(first.output.id);
    expect(repaired.board.cards).toEqual([]);
    expect(repaired.output.summary).toBe('Empty visual board');
  });

  it('only saves output cards that reference outputs from the same session', async () => {
    const root = mkdtempSync(join(tmpdir(), 'osvc-board-output-card-'));
    mkdirSync(join(root, 'outputs'), { recursive: true });
    const service = new OutputService({
      getWorkspaceRootPath: () => root,
    });

    const validOutput = await service.createFromSessionTool({
      workspaceId: 'ws',
      sessionId: 'session-1',
      output: {
        title: 'Valid output',
        kind: 'report',
        summary: 'Session output',
        content: '# valid',
        contentMimeType: 'text/markdown',
      },
    });
    const otherSessionOutput = await service.createFromSessionTool({
      workspaceId: 'ws',
      sessionId: 'session-2',
      output: {
        title: 'Wrong session',
        kind: 'report',
        summary: 'Wrong session output',
        content: '# invalid',
        contentMimeType: 'text/markdown',
      },
    });
    expect(validOutput.ok).toBe(true);
    expect(otherSessionOutput.ok).toBe(true);

    const first = service.getOrCreateVisualBoard('ws', 'session-1');
    const now = new Date().toISOString();
    const validBoard: VisualBoardSnapshot = {
      ...first.board,
      cards: [{
        id: 'out-1',
        type: 'output',
        outputId: validOutput.outputId!,
        title: 'Valid output',
        kind: 'report',
        createdAt: now,
        updatedAt: now,
      }],
      updatedAt: now,
    };
    expect(service.saveVisualBoard('ws', 'session-1', validBoard).board.cards[0]?.type).toBe('output');

    const invalidBoard: VisualBoardSnapshot = {
      ...validBoard,
      cards: [{
        id: 'out-2',
        type: 'output',
        outputId: otherSessionOutput.outputId!,
        title: 'Wrong session',
        kind: 'report',
        createdAt: now,
        updatedAt: now,
      }],
    };
    expect(() => service.saveVisualBoard('ws', 'session-1', invalidBoard)).toThrow('Invalid visual board output card reference');
  });

  it('applies visual surface events and persists append-only history', async () => {
    const root = mkdtempSync(join(tmpdir(), 'osvc-visual-events-'));
    mkdirSync(join(root, 'outputs'), { recursive: true });
    const emitted: string[] = [];
    const service = new OutputService({
      getWorkspaceRootPath: () => root,
      emitOutputsUpdated: (workspaceId) => emitted.push(workspaceId),
    });

    const opened = service.applyVisualSurfaceEvent('ws', 'session-1', { action: 'open_board' }, 'agent');
    expect(opened.ok).toBe(true);
    expect(opened.board?.cards).toEqual([]);

    const noted = service.applyVisualSurfaceEvent('ws', 'session-1', {
      action: 'add_note',
      title: 'Decision',
      body: 'Use event-backed cards.',
    }, 'agent');
    expect(noted.ok).toBe(true);
    expect(noted.board?.cards[0]).toMatchObject({
      type: 'note',
      title: 'Decision',
      body: 'Use event-backed cards.',
    });

    const output = await service.createFromSessionTool({
      workspaceId: 'ws',
      sessionId: 'session-1',
      output: {
        title: 'Preview',
        kind: 'report',
        summary: 'Pinned output',
        content: '# preview',
        contentMimeType: 'text/markdown',
      },
    });
    const pinned = service.applyVisualSurfaceEvent('ws', 'session-1', {
      action: 'pin_output',
      outputId: output.outputId!,
    }, 'agent');
    expect(pinned.ok).toBe(true);
    expect(pinned.board?.cards[0]).toMatchObject({
      type: 'output',
      outputId: output.outputId,
      title: 'Preview',
    });

    const duplicate = service.applyVisualSurfaceEvent('ws', 'session-1', {
      action: 'pin_output',
      outputId: output.outputId!,
    }, 'agent');
    expect(duplicate.ok).toBe(true);
    expect(duplicate.receipt).toContain('already pinned');
    expect(duplicate.board?.cards.filter((card) => card.type === 'output')).toHaveLength(1);

    const boardOutputId = pinned.outputId!;
    const historyPath = join(root, 'outputs', boardOutputId, VISUAL_SURFACE_EVENTS_ASSET_PATH);
    expect(existsSync(historyPath)).toBe(true);
    expect(service.listVisualSurfaceEvents('ws', 'session-1').map((event) => event.action)).toEqual([
      'open_board',
      'add_note',
      'pin_output',
      'pin_output',
    ]);
    expect(readFileSync(historyPath, 'utf-8').trim().split('\n')).toHaveLength(4);
    expect(emitted).toContain('ws');
  });

  it('replays visual surface events to repair a corrupt board asset', () => {
    const root = mkdtempSync(join(tmpdir(), 'osvc-visual-replay-'));
    mkdirSync(join(root, 'outputs'), { recursive: true });
    const service = new OutputService({
      getWorkspaceRootPath: () => root,
    });

    const noted = service.applyVisualSurfaceEvent('ws', 'session-1', {
      action: 'add_note',
      title: 'Recovered',
      body: 'From event history.',
    }, 'agent');
    expect(noted.ok).toBe(true);
    const boardOutputId = noted.outputId!;

    writeFileSync(join(root, 'outputs', boardOutputId, VISUAL_BOARD_ASSET_PATH), '{broken', 'utf-8');

    const repaired = service.getOrCreateVisualBoard('ws', 'session-1');
    expect(repaired.output.id).toBe(boardOutputId);
    expect(repaired.board.cards[0]).toMatchObject({
      type: 'note',
      title: 'Recovered',
      body: 'From event history.',
    });
  });

  it('rolls back board changes when appending event history fails', () => {
    const root = mkdtempSync(join(tmpdir(), 'osvc-visual-append-fail-'));
    mkdirSync(join(root, 'outputs'), { recursive: true });
    const service = new OutputService({
      getWorkspaceRootPath: () => root,
    });

    const first = service.applyVisualSurfaceEvent('ws', 'session-1', {
      action: 'add_note',
      title: 'Kept',
      body: 'This survives.',
    }, 'agent');
    expect(first.ok).toBe(true);
    const boardOutputId = first.outputId!;
    const historyPath = join(root, 'outputs', boardOutputId, VISUAL_SURFACE_EVENTS_ASSET_PATH);
    chmodSync(historyPath, 0o444);

    try {
      const failed = service.applyVisualSurfaceEvent('ws', 'session-1', {
        action: 'add_note',
        title: 'Rolled back',
        body: 'This should not persist.',
      }, 'agent');
      expect(failed.ok).toBe(false);

      const loaded = service.getOrCreateVisualBoard('ws', 'session-1');
      expect(loaded.board.cards).toHaveLength(1);
      expect(loaded.board.cards[0]).toMatchObject({ type: 'note', title: 'Kept' });
    } finally {
      chmodSync(historyPath, 0o644);
    }
  });

  it('rejects visual surface pins outside the current session', async () => {
    const root = mkdtempSync(join(tmpdir(), 'osvc-visual-pin-'));
    mkdirSync(join(root, 'outputs'), { recursive: true });
    const service = new OutputService({
      getWorkspaceRootPath: () => root,
    });

    const other = await service.createFromSessionTool({
      workspaceId: 'ws',
      sessionId: 'session-2',
      output: {
        title: 'Wrong session',
        kind: 'report',
        summary: 'Nope',
        content: '# nope',
        contentMimeType: 'text/markdown',
      },
    });
    const result = service.applyVisualSurfaceEvent('ws', 'session-1', {
      action: 'pin_output',
      outputId: other.outputId!,
    }, 'agent');
    expect(result.ok).toBe(false);
    expect(result.error).toContain('not pinnable');
  });

  it('adds only matching image and video outputs through media actions', async () => {
    const root = mkdtempSync(join(tmpdir(), 'osvc-visual-media-'));
    mkdirSync(join(root, 'outputs'), { recursive: true });
    const service = new OutputService({
      getWorkspaceRootPath: () => root,
    });

    const image = await service.createFromSessionTool({
      workspaceId: 'ws',
      sessionId: 'session-1',
      output: {
        title: 'Generated image',
        kind: 'image',
        summary: 'Image output',
      },
    });
    const video = await service.createFromSessionTool({
      workspaceId: 'ws',
      sessionId: 'session-1',
      output: {
        title: 'Generated video',
        kind: 'video',
        summary: 'Video output',
      },
    });
    const report = await service.createFromSessionTool({
      workspaceId: 'ws',
      sessionId: 'session-1',
      output: {
        title: 'Report',
        kind: 'report',
        summary: 'Not media',
      },
    });

    const imageResult = service.applyVisualSurfaceEvent('ws', 'session-1', {
      action: 'add_image',
      outputId: image.outputId!,
    }, 'agent');
    const videoResult = service.applyVisualSurfaceEvent('ws', 'session-1', {
      action: 'add_video',
      outputId: video.outputId!,
    }, 'agent');
    const wrongKind = service.applyVisualSurfaceEvent('ws', 'session-1', {
      action: 'add_image',
      outputId: report.outputId!,
    }, 'agent');
    const wrongVideoKind = service.applyVisualSurfaceEvent('ws', 'session-1', {
      action: 'add_video',
      outputId: report.outputId!,
    }, 'agent');
    const duplicateImage = service.applyVisualSurfaceEvent('ws', 'session-1', {
      action: 'add_image',
      outputId: image.outputId!,
    }, 'agent');
    const duplicateWrongKind = service.applyVisualSurfaceEvent('ws', 'session-1', {
      action: 'add_video',
      outputId: image.outputId!,
    }, 'agent');

    expect(imageResult.ok).toBe(true);
    expect(imageResult.receipt).toContain('Added image');
    expect(videoResult.ok).toBe(true);
    expect(videoResult.receipt).toContain('Added video');
    expect(wrongKind.ok).toBe(false);
    expect(wrongKind.error).toContain('requires an image output');
    expect(wrongVideoKind.ok).toBe(false);
    expect(wrongVideoKind.error).toContain('requires a video output');
    expect(duplicateImage.ok).toBe(true);
    expect(duplicateImage.receipt).toContain('already on Canvas');
    expect(duplicateImage.board?.cards.filter((card) => card.type === 'output')).toHaveLength(2);
    expect(duplicateWrongKind.ok).toBe(false);
    expect(duplicateWrongKind.error).toContain('requires a video output');
  });
});
