import { describe, expect, it } from 'bun:test';
import { mkdtempSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { OutputService } from './OutputService';
import { writeRun, type WorkflowRunSnapshot } from '@craft-agent/shared/workflows';

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
