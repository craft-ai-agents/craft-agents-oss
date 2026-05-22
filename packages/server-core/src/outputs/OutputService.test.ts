import { describe, expect, it } from 'bun:test';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { OutputService } from './OutputService';
import { writeRun, type WorkflowRunSnapshot } from '@craft-agent/shared/workflows';
import { VISUAL_BOARD_ASSET_PATH, type VisualBoardSnapshot } from '@craft-agent/shared/visual-board';

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
});
