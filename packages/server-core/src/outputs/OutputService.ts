import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import type { RpcServer } from '@craft-agent/server-core/transport';
import type { CreateOutputToolInput, CreateOutputResult } from '@craft-agent/session-tools-core';
import {
  createOutputBundle,
  deleteOutput,
  assertOutputAssetPath,
  listOutputs,
  readOutput,
  summarizeOutputContent,
  type OutputKind,
  type OutputManifest,
  type OutputSummary,
  type OutputOrigin,
} from '@craft-agent/shared/outputs';
import { readRun, writeRun, type WorkflowRunSnapshot, type WorkflowRunStep } from '@craft-agent/shared/workflows';
import { RPC_CHANNELS } from '@craft-agent/shared/protocol';

export interface OutputServiceDeps {
  getWorkspaceRootPath: (workspaceId: string) => string;
  emitOutputsUpdated?: (workspaceId: string) => void;
  emitWorkflowRunUpdated?: (run: WorkflowRunSnapshot) => void;
}

export class OutputService {
  // Per-run mutex serializing read-modify-write of run.json from this service.
  // IMPORTANT: this is intra-service only. The WorkflowRunner writes run.json
  // from a different code path with no shared lock; coordinated correctness
  // there would require a process-level (filesystem) lock, which is out of
  // scope here. The renderer's workflow-run UPDATED broadcast is the
  // reconciliation backstop when those writers race.
  private readonly runMutexes = new Map<string, Promise<void>>();

  constructor(private readonly deps: OutputServiceDeps) {}

  list(workspaceId: string): OutputSummary[] {
    return listOutputs(this.deps.getWorkspaceRootPath(workspaceId));
  }

  get(workspaceId: string, outputId: string): OutputManifest | null {
    return readOutput(this.deps.getWorkspaceRootPath(workspaceId), outputId);
  }

  async delete(workspaceId: string, outputId: string): Promise<boolean> {
    const root = this.deps.getWorkspaceRootPath(workspaceId);
    const manifest = readOutput(root, outputId);
    const deleted = deleteOutput(root, outputId);
    if (deleted) {
      await this.detachDeletedOutputFromWorkflowRun(workspaceId, outputId, manifest);
      this.emitUpdated(workspaceId);
    }
    return deleted;
  }

  private withRunMutex<T>(workspaceId: string, runId: string, fn: () => Promise<T>): Promise<T> {
    const key = `${workspaceId}::${runId}`;
    const prev = this.runMutexes.get(key) ?? Promise.resolve();
    const next = prev.then(fn, fn);
    this.runMutexes.set(key, next.then(() => {}, () => {}));
    return next;
  }

  resolveAssetPath(workspaceId: string, outputId: string, assetPath: string): string {
    return assertOutputAssetPath(this.deps.getWorkspaceRootPath(workspaceId), outputId, assetPath);
  }

  async createFromSessionTool(input: {
    workspaceId: string;
    sessionId: string;
    agentSlug?: string;
    agentName?: string;
    workflowRunId?: string;
    workflowSlug?: string;
    workflowName?: string;
    stepId?: string;
    output: CreateOutputToolInput;
  }): Promise<CreateOutputResult> {
    const now = new Date().toISOString();
    const origin: OutputOrigin = input.workflowRunId
      ? {
          source: 'workflow',
          workflowRunId: input.workflowRunId,
          workflowSlug: input.workflowSlug,
          workflowName: input.workflowName,
          stepId: input.stepId,
          sessionId: input.sessionId,
          agentSlug: input.agentSlug,
          agentName: input.agentName,
        }
      : {
          source: 'session',
          sessionId: input.sessionId,
          agentSlug: input.agentSlug,
          agentName: input.agentName,
        };

    const manifest = createOutputBundle(this.deps.getWorkspaceRootPath(input.workspaceId), {
      workspaceId: input.workspaceId,
      title: input.output.title,
      kind: input.output.kind,
      summary: input.output.summary,
      origin,
      content: input.output.content,
      contentMimeType: input.output.contentMimeType,
      assets: (input.output.files ?? []).map((file, index) => ({
        id: `file-${index + 1}`,
        label: file.label?.trim() || file.path.split(/[\\/]/).pop() || `File ${index + 1}`,
        role: file.role ?? (index === 0 && !input.output.content ? 'primary' : 'attachment'),
        path: file.path,
      })),
      links: (input.output.links ?? []).map((link, index) => ({
        id: `link-${index + 1}`,
        label: link.label,
        url: link.url,
        role: link.role,
      })),
      receipts: (input.output.receipts ?? []).map((receipt, index) => ({
        id: `receipt-${index + 1}`,
        provider: receipt.provider,
        action: receipt.action,
        status: receipt.status,
        occurredAt: receipt.occurredAt ?? now,
        externalId: receipt.externalId,
        url: receipt.url,
        displayText: receipt.displayText,
        metadata: receipt.metadata,
      })),
      tags: input.output.tags,
      completedAt: now,
    });

    if (input.workflowRunId) {
      await this.attachOutputToWorkflowRun(input.workspaceId, input.workflowRunId, manifest.id);
    }
    this.emitUpdated(input.workspaceId);
    return {
      ok: true,
      outputId: manifest.id,
      route: `/outputs/${manifest.id}`,
      file: `${manifest.id}/output.json`,
    };
  }

  createDefaultWorkflowOutput(run: WorkflowRunSnapshot): WorkflowRunSnapshot {
    if (run.finalOutputId || (run.outputIds?.length ?? 0) > 0) return run;
    if (run.state !== 'succeeded') return run;
    const outputMode = run.workflowSnapshot.metadata.outputs?.mode ?? 'final-step';
    if (outputMode !== 'final-step') return run;

    const finalStep = this.findFinalSucceededStep(run);
    if (!finalStep) return run;

    const content = finalStep.output;
    const normalized = this.normalizeStepOutput(content);
    const workflowName = run.workflowSnapshot.metadata.name || run.workflowSlug;
    const manifest = createOutputBundle(this.deps.getWorkspaceRootPath(run.workspaceId), {
      id: randomUUID(),
      workspaceId: run.workspaceId,
      title: `${workflowName} output`,
      kind: this.defaultKind(run),
      summary: normalized.summary,
      origin: {
        source: 'workflow',
        workflowRunId: run.id,
        workflowSlug: run.workflowSlug,
        workflowName,
        stepId: finalStep.id,
        sessionId: finalStep.sessionId,
        agentSlug: this.agentSlugForStep(run, finalStep.id),
        agentName: finalStep.executionReceipt?.agent.name,
      },
      content: normalized.content,
      contentMimeType: normalized.mimeType,
      completedAt: run.completedAt,
    });

    const next: WorkflowRunSnapshot = {
      ...run,
      outputIds: [...(run.outputIds ?? []), manifest.id],
      finalOutputId: manifest.id,
      outputError: undefined,
      updatedAt: new Date().toISOString(),
    };
    writeRun(this.deps.getWorkspaceRootPath(run.workspaceId), next);
    this.emitUpdated(run.workspaceId);
    return next;
  }

  markWorkflowOutputError(run: WorkflowRunSnapshot, error: unknown): WorkflowRunSnapshot {
    const next: WorkflowRunSnapshot = {
      ...run,
      outputError: error instanceof Error ? error.message : String(error),
      updatedAt: new Date().toISOString(),
    };
    writeRun(this.deps.getWorkspaceRootPath(run.workspaceId), next);
    return next;
  }

  private findFinalSucceededStep(run: WorkflowRunSnapshot): WorkflowRunStep | undefined {
    for (let i = run.steps.length - 1; i >= 0; i--) {
      const step = run.steps[i]!;
      if (step.state === 'succeeded' && step.output !== undefined) return step;
    }
    return undefined;
  }

  private normalizeStepOutput(output: unknown): {
    content: string;
    mimeType: 'text/markdown' | 'text/plain' | 'application/json';
    summary: string;
  } {
    if (typeof output === 'string') {
      return {
        content: output,
        mimeType: output.trimStart().startsWith('#') ? 'text/markdown' : 'text/plain',
        summary: summarizeOutputContent(output),
      };
    }
    const content = JSON.stringify(output, null, 2);
    return {
      content,
      mimeType: 'application/json',
      summary: summarizeOutputContent(content),
    };
  }

  private defaultKind(run: WorkflowRunSnapshot): OutputKind {
    return run.workflowSnapshot.metadata.outputs?.kind ?? 'report';
  }

  private agentSlugForStep(run: WorkflowRunSnapshot, stepId: string): string | undefined {
    return run.workflowSnapshot.metadata.steps.find((step) => step.id === stepId)?.agent;
  }

  private emitUpdated(workspaceId: string): void {
    this.deps.emitOutputsUpdated?.(workspaceId);
  }

  private async detachDeletedOutputFromWorkflowRun(
    workspaceId: string,
    outputId: string,
    manifest: OutputManifest | null,
  ): Promise<void> {
    const runId = manifest?.origin.source === 'workflow' ? manifest.origin.workflowRunId : undefined;
    if (!runId) return;
    await this.withRunMutex(workspaceId, runId, async () => {
      const root = this.deps.getWorkspaceRootPath(workspaceId);
      const run = readRun(root, runId);
      if (!run) return;
      const outputIds = (run.outputIds ?? []).filter((id) => id !== outputId);
      const next: WorkflowRunSnapshot = {
        ...run,
        outputIds: outputIds.length > 0 ? outputIds : undefined,
        finalOutputId: run.finalOutputId === outputId ? undefined : run.finalOutputId,
        updatedAt: new Date().toISOString(),
      };
      writeRun(root, next);
      this.deps.emitWorkflowRunUpdated?.(next);
    });
  }

  private async attachOutputToWorkflowRun(workspaceId: string, runId: string, outputId: string): Promise<void> {
    await this.withRunMutex(workspaceId, runId, async () => {
      const root = this.deps.getWorkspaceRootPath(workspaceId);
      const run = readRun(root, runId);
      if (!run) return;
      if ((run.outputIds ?? []).includes(outputId)) return;
      const outputIds = [...(run.outputIds ?? []), outputId];
      const next: WorkflowRunSnapshot = {
        ...run,
        outputIds,
        finalOutputId: run.finalOutputId ?? outputId,
        updatedAt: new Date().toISOString(),
      };
      writeRun(root, next);
      this.deps.emitWorkflowRunUpdated?.(next);
    });
  }
}

export function readOutputAssetText(path: string): string {
  return readFileSync(path, 'utf-8');
}

export function pushOutputsUpdated(server: RpcServer, workspaceId: string): void {
  server.push(RPC_CHANNELS.outputs.UPDATED, { to: 'workspace', workspaceId }, workspaceId);
}

export function pushWorkflowRunUpdated(server: RpcServer, run: WorkflowRunSnapshot): void {
  server.push(
    RPC_CHANNELS.workflowRuns.UPDATED,
    { to: 'workspace', workspaceId: run.workspaceId },
    run.workspaceId,
    run,
    'updated',
  );
}
