import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { dirname, extname, isAbsolute, join } from 'node:path';
import type { RpcServer } from '@craft-agent/server-core/transport';
import type { CreateOutputToolInput, CreateOutputResult, VisualSurfaceStateCapture, VisualSurfaceStateToolResult } from '@craft-agent/session-tools-core';
import {
  createOutputBundle,
  deleteOutput,
  assertOutputAssetPath,
  getOutputDir,
  listOutputManifests,
  listOutputs,
  readOutput,
  resolveGeneratedHtmlPreviewTarget,
  resolveLocalWebPreviewTarget,
  summarizeOutputContent,
  writeOutputManifest,
  type OutputAsset,
  type OutputKind,
  type OutputManifest,
  type OutputSummary,
  type OutputOrigin,
} from '@craft-agent/shared/outputs';
import { OUTPUT_SHOW_IN_CANVAS_TAG } from '@craft-agent/shared/outputs/constants';
import {
  VISUAL_BOARD_ASSET_ID,
  VISUAL_BOARD_ASSET_PATH,
  VISUAL_BOARD_MAX_CARDS,
  VISUAL_BOARD_SESSION_TAG,
  VISUAL_BOARD_TAG,
  assertVisualBoardSnapshot,
  createEmptyVisualBoardSnapshot,
  parseVisualBoardSnapshot,
  summarizeVisualBoard,
  type VisualBoardSnapshot,
} from '@craft-agent/shared/visual-board';
import {
  VISUAL_SURFACE_EVENTS_ASSET_ID,
  VISUAL_SURFACE_EVENTS_ASSET_PATH,
  VISUAL_SURFACE_EVENTS_MIME_TYPE,
  normalizeVisualSurfaceEventInput,
  parseVisualSurfaceEventLines,
  type ApplyVisualSurfaceEventResult,
  type VisualSurfaceEventInput,
  type VisualSurfaceEventRecord,
  type VisualSurfaceEventSource,
} from '@craft-agent/shared/visual-surface-events';
import { readRun, writeRun, type WorkflowRunSnapshot, type WorkflowRunStep } from '@craft-agent/shared/workflows';
import { RPC_CHANNELS } from '@craft-agent/shared/protocol';

export interface OutputServiceDeps {
  getWorkspaceRootPath: (workspaceId: string) => string;
  emitOutputsUpdated?: (workspaceId: string) => void;
  emitWorkflowRunUpdated?: (run: WorkflowRunSnapshot) => void;
}

export interface RecordVisualCaptureInput {
  workspaceId: string;
  sessionId: string;
  outputId: string;
  captureVersion: string;
  reviewTriggerId?: string;
  source: 'canvas';
  dataUrl: string;
  width: number;
  height: number;
}

export interface RecordVisualCaptureResult {
  ok: boolean;
  outputId: string;
  assetId: string;
  path: string;
  capturedAt: string;
  reviewQueued?: boolean;
  reviewTriggerId?: string;
  skipped?: boolean;
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

  getVisualSurfaceState(workspaceId: string, sessionId: string): VisualSurfaceStateToolResult {
    const root = this.deps.getWorkspaceRootPath(workspaceId);
    const manifests = listOutputManifests(root).filter((manifest) => manifest.origin.sessionId === sessionId);
    const boardOutput = manifests.find((manifest) => manifest.tags?.includes(VISUAL_BOARD_TAG));
    const board = boardOutput ? this.readVisualBoardSnapshot(workspaceId, sessionId, boardOutput) : null;
    const outputs = manifests
      .filter((manifest) => !manifest.tags?.includes(VISUAL_BOARD_TAG))
      .map((manifest) => {
        const localWebPreview = resolveLocalWebPreviewTarget(manifest);
        const generatedHtmlPreview = resolveGeneratedHtmlPreviewTarget(manifest);
        const webPreviewTarget = localWebPreview ?? generatedHtmlPreview;
        const canOpenInCanvas = manifest.status !== 'failed' && manifest.status !== 'cancelled';
        const visualCapture = latestVisualCapture(manifest);
        const webPreview = webPreviewTarget ? {
          url: webPreviewTarget.url,
          displayHost: webPreviewTarget.displayHost,
          kind: localWebPreview ? 'local-web' as const : 'generated-html' as const,
        } : null;
        return {
          id: manifest.id,
          title: manifest.title,
          kind: manifest.kind,
          status: manifest.status,
          summary: manifest.summary,
          previewMode: manifest.preview?.mode,
          pinnable: canOpenInCanvas,
          canOpenInCanvas,
          canInspectInBrowserPane: Boolean(webPreview),
          previewSurface: webPreview ? 'browser-pane' as const : canOpenInCanvas ? 'canvas' as const : 'none' as const,
          ...(webPreview ? { webPreview } : {}),
          ...(visualCapture ? { visualCapture } : {}),
          ...(localWebPreview ? { localWebPreview } : {}),
        };
      });

    return {
      canvas: {
        exists: Boolean(boardOutput),
        outputId: boardOutput?.id,
        title: board?.title ?? boardOutput?.title,
        cardCount: board?.cards.length ?? 0,
        noteCount: board?.cards.filter((card) => card.type === 'note').length ?? 0,
        outputCardCount: board?.cards.filter((card) => card.type === 'output').length ?? 0,
        cards: board?.cards.map((card) => ({
          id: card.id,
          type: card.type,
          title: card.title,
          ...(card.type === 'output' ? {
            outputId: card.outputId,
            kind: card.kind,
            ...(card.summary ? { summary: card.summary } : {}),
          } : {}),
          createdAt: card.createdAt,
          updatedAt: card.updatedAt,
        })) ?? [],
        updatedAt: board?.updatedAt ?? boardOutput?.updatedAt,
      },
      outputs,
      webPreviews: outputs.filter((output) => Boolean(output.webPreview)),
      capabilities: {
        canOpenCanvas: true,
        canPinOutputs: outputs.some((output) => output.pinnable),
        canInspectWebConsole: false,
        canInspectWebPreviewsInBrowserPane: outputs.some((output) => output.canInspectInBrowserPane),
      },
    };
  }

  recordVisualCapture(input: RecordVisualCaptureInput): RecordVisualCaptureResult {
    const root = this.deps.getWorkspaceRootPath(input.workspaceId);
    const output = readOutput(root, input.outputId);
    if (!output) throw new Error(`Output not found: ${input.outputId}`);
    if (output.workspaceId !== input.workspaceId) throw new Error(`Output "${input.outputId}" is not in workspace "${input.workspaceId}".`);
    if (output.origin.sessionId !== input.sessionId) throw new Error(`Output "${input.outputId}" is not from session "${input.sessionId}".`);
    if (output.tags?.includes(VISUAL_BOARD_TAG)) throw new Error('Visual board outputs cannot receive visual captures.');

    const { buffer, mimeType } = decodePngDataUrl(input.dataUrl);
    if (buffer.length === 0) throw new Error('Visual capture is empty.');
    if (buffer.length > 8 * 1024 * 1024) throw new Error('Visual capture is too large.');

    const capturedAt = new Date().toISOString();
    const assetId = `visual-capture-${input.source}`;
    const version = slugifyCaptureVersion(input.captureVersion);
    const assetPath = `visual-captures/${input.source}-${version}.png`;
    const absolutePath = this.resolveAssetPath(input.workspaceId, input.outputId, assetPath);
    const existing = output.assets.find((asset) => asset.id === assetId && asset.path === assetPath);
    if (existing && existsSync(absolutePath)) {
      const reviewQueued = this.recordVisualReviewQueued(root, output, input.reviewTriggerId, {
        assetId,
        assetPath,
        captureVersion: input.captureVersion,
      });
      if (reviewQueued) this.emitUpdated(input.workspaceId);
      return {
        ok: true,
        outputId: output.id,
        assetId,
        path: assetPath,
        capturedAt: captureTimestampFromLabel(existing.label) ?? capturedAt,
        ...(input.reviewTriggerId ? { reviewTriggerId: input.reviewTriggerId } : {}),
        ...(reviewQueued ? { reviewQueued } : {}),
        skipped: true,
      };
    }

    mkdirSync(dirname(absolutePath), { recursive: true });
    writeFileSync(absolutePath, buffer);
    const sha256 = createHash('sha256').update(buffer).digest('hex');
    const asset: OutputAsset = {
      id: assetId,
      label: `Canvas capture ${capturedAt}`,
      role: 'thumbnail',
      path: assetPath,
      mimeType,
      sizeBytes: buffer.length,
      sha256,
    };
    const baseOutput: OutputManifest = {
      ...output,
      assets: [
        ...output.assets.filter((entry) => entry.id !== assetId),
        asset,
      ],
    };
    const reviewQueued = this.appendVisualReviewReceipt(baseOutput, input.reviewTriggerId, {
      assetId,
      assetPath,
      captureVersion: input.captureVersion,
    });
    const nextOutput = reviewQueued.output;
    writeOutputManifest(root, nextOutput);
    this.emitUpdated(input.workspaceId);
    return {
      ok: true,
      outputId: output.id,
      assetId,
      path: assetPath,
      capturedAt,
      ...(input.reviewTriggerId ? { reviewTriggerId: input.reviewTriggerId } : {}),
      ...(reviewQueued.queued ? { reviewQueued: true } : {}),
    };
  }

  private recordVisualReviewQueued(
    root: string,
    output: OutputManifest,
    reviewTriggerId: string | undefined,
    details: { assetId: string; assetPath: string; captureVersion: string },
  ): boolean {
    const result = this.appendVisualReviewReceipt(output, reviewTriggerId, details);
    if (!result.queued) return false;
    writeOutputManifest(root, result.output);
    return true;
  }

  private appendVisualReviewReceipt(
    output: OutputManifest,
    reviewTriggerId: string | undefined,
    details: { assetId: string; assetPath: string; captureVersion: string },
  ): { output: OutputManifest; queued: boolean } {
    if (!reviewTriggerId) return { output, queued: false };
    const externalId = `canvas-review:${reviewTriggerId}`;
    if (output.receipts.some((receipt) => receipt.provider === 'runner-canvas' && receipt.action === 'visual-review' && receipt.externalId === externalId)) {
      return { output, queued: false };
    }
    const receiptId = `visual-review-${createHash('sha256').update(reviewTriggerId).digest('hex').slice(0, 16)}`;
    return {
      output: {
        ...output,
        receipts: [
          ...output.receipts,
          {
            id: receiptId,
            provider: 'runner-canvas',
            action: 'visual-review',
            status: 'pending',
            occurredAt: new Date().toISOString(),
            externalId,
            displayText: 'Queued Canvas capture for agent visual review.',
            metadata: details,
          },
        ],
      },
      queued: true,
    };
  }

  getOrCreateVisualBoard(workspaceId: string, sessionId: string): { output: OutputManifest; board: VisualBoardSnapshot } {
    const root = this.deps.getWorkspaceRootPath(workspaceId);
    const existing = this.findVisualBoardManifest(workspaceId, sessionId);
    if (existing) {
      try {
        const content = readOutputAssetText(this.resolveAssetPath(workspaceId, existing.id, VISUAL_BOARD_ASSET_PATH));
        const board = parseVisualBoardSnapshot(content, { workspaceId, sessionId });
        if (board) return { output: existing, board };
      } catch {
        // Fall through and repair the existing board output below.
      }
      const replayed = this.replayVisualSurfaceEventsToBoard(workspaceId, sessionId, existing);
      const repaired = this.writeVisualBoardToOutput(
        workspaceId,
        existing,
        replayed ?? createEmptyVisualBoardSnapshot({ workspaceId, sessionId }),
      );
      this.emitUpdated(workspaceId);
      return repaired;
    }

    const board = createEmptyVisualBoardSnapshot({ workspaceId, sessionId });
    const output = createOutputBundle(root, {
      workspaceId,
      title: 'Session board',
      kind: 'other',
      status: 'published',
      summary: summarizeVisualBoard(board),
      origin: { source: 'session', sessionId },
      assets: [this.boardAsset()],
      tags: [VISUAL_BOARD_TAG, VISUAL_BOARD_SESSION_TAG],
      completedAt: board.createdAt,
    });
    const created = this.writeVisualBoardToOutput(workspaceId, output, board);
    this.emitUpdated(workspaceId);
    return created;
  }

  saveVisualBoard(workspaceId: string, sessionId: string, snapshot: VisualBoardSnapshot): { output: OutputManifest; board: VisualBoardSnapshot } {
    assertVisualBoardSnapshot(snapshot, { workspaceId, sessionId });
    this.assertVisualBoardOutputCards(workspaceId, sessionId, snapshot);
    const existing = this.findVisualBoardManifest(workspaceId, sessionId)
      ?? this.getOrCreateVisualBoard(workspaceId, sessionId).output;
    const saved = this.writeVisualBoardToOutput(workspaceId, existing, {
      ...snapshot,
      updatedAt: new Date().toISOString(),
    });
    this.emitUpdated(workspaceId);
    return saved;
  }

  applyVisualSurfaceEvent(
    workspaceId: string,
    sessionId: string,
    input: VisualSurfaceEventInput,
    source: VisualSurfaceEventSource = 'agent',
  ): ApplyVisualSurfaceEventResult {
    try {
      const payload = normalizeVisualSurfaceEventInput(input);
      const current = this.getOrCreateVisualBoard(workspaceId, sessionId);
      const now = new Date().toISOString();
      const event: VisualSurfaceEventRecord = {
        schemaVersion: 1,
        id: randomUUID(),
        workspaceId,
        sessionId,
        action: payload.action,
        payload,
        source,
        createdAt: now,
      };

      const applied = this.applyVisualEventToBoard(workspaceId, sessionId, current.board, event, now);
      const board = applied.board;
      assertVisualBoardSnapshot(board, { workspaceId, sessionId });
      this.assertVisualBoardOutputCards(workspaceId, sessionId, board);
      const saved = this.writeVisualBoardToOutput(workspaceId, current.output, board);
      try {
        this.appendVisualSurfaceEvent(workspaceId, saved.output, event);
      } catch (err) {
        this.writeVisualBoardToOutput(workspaceId, saved.output, current.board);
        throw err;
      }
      this.emitUpdated(workspaceId);
      return {
        ok: true,
        eventId: event.id,
        outputId: saved.output.id,
        board: saved.board,
        receipt: this.visualEventReceipt(event, saved.board, applied.applied),
      };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  listVisualSurfaceEvents(workspaceId: string, sessionId: string): VisualSurfaceEventRecord[] {
    const manifest = this.findVisualBoardManifest(workspaceId, sessionId);
    if (!manifest) return [];
    const path = this.resolveAssetPath(workspaceId, manifest.id, VISUAL_SURFACE_EVENTS_ASSET_PATH);
    if (!existsSync(path)) return [];
    return parseVisualSurfaceEventLines(readFileSync(path, 'utf-8'), { workspaceId, sessionId });
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

  private findVisualBoardManifest(workspaceId: string, sessionId: string): OutputManifest | null {
    const root = this.deps.getWorkspaceRootPath(workspaceId);
    return listOutputManifests(root).find((manifest) =>
      manifest.origin.sessionId === sessionId && manifest.tags?.includes(VISUAL_BOARD_TAG),
    ) ?? null;
  }

  private readVisualBoardSnapshot(workspaceId: string, sessionId: string, output: OutputManifest): VisualBoardSnapshot | null {
    try {
      const content = readOutputAssetText(this.resolveAssetPath(workspaceId, output.id, VISUAL_BOARD_ASSET_PATH));
      return parseVisualBoardSnapshot(content, { workspaceId, sessionId });
    } catch {
      return null;
    }
  }

  private applyVisualEventToBoard(
    workspaceId: string,
    sessionId: string,
    board: VisualBoardSnapshot,
    event: VisualSurfaceEventRecord,
    now: string,
  ): { board: VisualBoardSnapshot; applied: boolean } {
    if (event.action === 'open_board') {
      const title = event.payload.action === 'open_board' ? event.payload.title : undefined;
      return title
        ? { board: { ...board, title, updatedAt: now }, applied: true }
        : { board, applied: false };
    }

    if (event.action === 'add_note') {
      if (event.payload.action !== 'add_note') throw new Error('Invalid add_note event payload.');
      if (board.cards.length >= VISUAL_BOARD_MAX_CARDS) throw new Error(`Visual board already has the maximum ${VISUAL_BOARD_MAX_CARDS} cards.`);
      return {
        board: {
          ...board,
          cards: [
            {
              id: `note-${event.id}`,
              type: 'note',
              title: event.payload.title,
              body: event.payload.body ?? '',
              createdAt: now,
              updatedAt: now,
            },
            ...board.cards,
          ],
          updatedAt: now,
        },
        applied: true,
      };
    }

    if (event.action === 'pin_output' || event.action === 'add_image' || event.action === 'add_video') {
      if (!('outputId' in event.payload)) throw new Error(`Invalid ${event.action} event payload.`);
      const { outputId } = event.payload;
      const output = this.findPinnableSessionOutput(workspaceId, sessionId, outputId);
      if (!output) throw new Error(`Output is not pinnable in this session: ${outputId}`);
      this.assertVisualSurfaceOutputKind(event.action, output);
      if (board.cards.some((card) => card.type === 'output' && card.outputId === outputId)) {
        return { board: { ...board, updatedAt: now }, applied: false };
      }
      if (board.cards.length >= VISUAL_BOARD_MAX_CARDS) throw new Error(`Visual board already has the maximum ${VISUAL_BOARD_MAX_CARDS} cards.`);
      return {
        board: {
          ...board,
          cards: [
            {
              id: `output-${event.id}`,
              type: 'output',
              outputId: output.id,
              title: output.title,
              kind: output.kind,
              summary: output.summary,
              createdAt: now,
              updatedAt: now,
            },
            ...board.cards,
          ],
          updatedAt: now,
        },
        applied: true,
      };
    }

    throw new Error(`Unsupported visual surface action: ${event.action}`);
  }

  private findPinnableSessionOutput(workspaceId: string, sessionId: string, outputId: string): OutputManifest | null {
    const root = this.deps.getWorkspaceRootPath(workspaceId);
    const output = readOutput(root, outputId);
    if (!output) return null;
    if (output.origin.sessionId !== sessionId) return null;
    if (output.tags?.includes(VISUAL_BOARD_TAG)) return null;
    return output;
  }

  private assertVisualSurfaceOutputKind(action: VisualSurfaceEventRecord['action'], output: OutputManifest): void {
    if (action === 'add_image' && output.kind !== 'image') {
      throw new Error(`add_image requires an image output. Output ${output.id} is ${output.kind}.`);
    }
    if (action === 'add_video' && output.kind !== 'video') {
      throw new Error(`add_video requires a video output. Output ${output.id} is ${output.kind}.`);
    }
  }

  private replayVisualSurfaceEventsToBoard(
    workspaceId: string,
    sessionId: string,
    output: OutputManifest,
  ): VisualBoardSnapshot | null {
    const path = this.resolveAssetPath(workspaceId, output.id, VISUAL_SURFACE_EVENTS_ASSET_PATH);
    if (!existsSync(path)) return null;
    const events = parseVisualSurfaceEventLines(readFileSync(path, 'utf-8'), { workspaceId, sessionId });
    if (events.length === 0) return null;

    let board = createEmptyVisualBoardSnapshot({
      workspaceId,
      sessionId,
      now: events[0]?.createdAt,
    });
    let applied = 0;
    for (const event of events) {
      try {
        board = this.applyVisualEventToBoard(workspaceId, sessionId, board, event, event.createdAt).board;
        applied += 1;
      } catch {
        // Keep replay best-effort: one stale pin should not erase valid notes.
      }
    }
    return applied > 0 ? board : null;
  }

  private appendVisualSurfaceEvent(workspaceId: string, output: OutputManifest, event: VisualSurfaceEventRecord): OutputManifest {
    const root = this.deps.getWorkspaceRootPath(workspaceId);
    const outputDir = getOutputDir(root, output.id);
    const file = join(outputDir, VISUAL_SURFACE_EVENTS_ASSET_PATH);
    appendFileSync(file, JSON.stringify(event) + '\n', 'utf-8');
    const meta = {
      sizeBytes: statSync(file).size,
      sha256: createHash('sha256').update(readFileSync(file)).digest('hex'),
    };
    const eventAsset = this.visualSurfaceEventsAsset(meta);
    const nextOutput: OutputManifest = {
      ...output,
      assets: [
        ...output.assets.filter((asset) => asset.id !== VISUAL_SURFACE_EVENTS_ASSET_ID),
        eventAsset,
      ],
    };
    writeOutputManifest(root, nextOutput);
    return nextOutput;
  }

  private boardAsset(meta?: { sizeBytes: number; sha256: string }): OutputAsset {
    return {
      id: VISUAL_BOARD_ASSET_ID,
      label: 'Board',
      role: 'primary',
      path: VISUAL_BOARD_ASSET_PATH,
      mimeType: 'application/json',
      ...meta,
    };
  }

  private visualSurfaceEventsAsset(meta?: { sizeBytes: number; sha256: string }): OutputAsset {
    return {
      id: VISUAL_SURFACE_EVENTS_ASSET_ID,
      label: 'Visual surface events',
      role: 'supporting',
      path: VISUAL_SURFACE_EVENTS_ASSET_PATH,
      mimeType: VISUAL_SURFACE_EVENTS_MIME_TYPE,
      ...meta,
    };
  }

  private visualEventReceipt(event: VisualSurfaceEventRecord, board: VisualBoardSnapshot, applied: boolean): string {
    if (event.action === 'open_board') return `Opened Canvas board with ${board.cards.length} card${board.cards.length === 1 ? '' : 's'}.`;
    if (event.action === 'add_note' && event.payload.action === 'add_note') return `Added note "${event.payload.title}" to Canvas.`;
    if ((event.action === 'pin_output' || event.action === 'add_image' || event.action === 'add_video') && 'outputId' in event.payload) {
      const { outputId } = event.payload;
      if (event.action === 'add_image') return applied ? `Added image output ${outputId} to Canvas.` : `Output ${outputId} was already on Canvas.`;
      if (event.action === 'add_video') return applied ? `Added video output ${outputId} to Canvas.` : `Output ${outputId} was already on Canvas.`;
      return applied
        ? `Pinned output ${outputId} to Canvas.`
        : `Output ${outputId} was already pinned to Canvas.`;
    }
    return 'Updated Canvas.';
  }

  private assertVisualBoardOutputCards(workspaceId: string, sessionId: string, board: VisualBoardSnapshot): void {
    const outputCards = board.cards.filter((card) => card.type === 'output');
    if (outputCards.length === 0) return;

    const root = this.deps.getWorkspaceRootPath(workspaceId);
    const validOutputIds = new Set(
      listOutputManifests(root)
        .filter((manifest) =>
          manifest.origin.sessionId === sessionId && !manifest.tags?.includes(VISUAL_BOARD_TAG),
        )
        .map((manifest) => manifest.id),
    );

    for (const card of outputCards) {
      if (!validOutputIds.has(card.outputId)) {
        throw new Error(`Invalid visual board output card reference: ${card.outputId}`);
      }
    }
  }

  private writeVisualBoardToOutput(
    workspaceId: string,
    output: OutputManifest,
    board: VisualBoardSnapshot,
  ): { output: OutputManifest; board: VisualBoardSnapshot } {
    const root = this.deps.getWorkspaceRootPath(workspaceId);
    const outputDir = getOutputDir(root, output.id);
    const file = join(outputDir, VISUAL_BOARD_ASSET_PATH);
    const tmp = `${file}.${process.pid}.${randomUUID()}.tmp`;
    try {
      writeFileSync(tmp, JSON.stringify(board, null, 2) + '\n', 'utf-8');
      renameSync(tmp, file);
    } catch (err) {
      try { rmSync(tmp, { force: true }); } catch { /* ignore */ }
      throw err;
    }

    const meta = {
      sizeBytes: statSync(file).size,
      sha256: createHash('sha256').update(readFileSync(file)).digest('hex'),
    };
    const boardAsset = this.boardAsset(meta);
    const assets = [
      boardAsset,
      ...output.assets.filter((asset) => asset.id !== VISUAL_BOARD_ASSET_ID),
    ];
    const now = board.updatedAt;
    const nextOutput: OutputManifest = {
      ...output,
      title: output.title || 'Session board',
      kind: 'other',
      summary: summarizeVisualBoard(board),
      updatedAt: now,
      completedAt: output.completedAt ?? now,
      origin: { ...output.origin, source: 'session', sessionId: board.sessionId },
      assets,
      primary: boardAsset,
      preview: {
        mode: 'json',
        assetId: VISUAL_BOARD_ASSET_ID,
        inlineText: summarizeVisualBoard(board),
      },
      tags: [...new Set([...(output.tags ?? []), VISUAL_BOARD_TAG, VISUAL_BOARD_SESSION_TAG])],
    };
    writeOutputManifest(root, nextOutput);
    return { output: nextOutput, board };
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

    const tags = input.output.showInCanvas
      ? [...new Set([...(input.output.tags ?? []), OUTPUT_SHOW_IN_CANVAS_TAG])]
      : input.output.tags;

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
        ...fileAssetMetadata(file.path),
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
      tags,
      completedAt: now,
    });

    if (input.workflowRunId) {
      await this.attachOutputToWorkflowRun(input.workspaceId, input.workflowRunId, manifest.id);
    }
    let shownInCanvas = false;
    let canvasReceipt: string | undefined;
    if (input.output.showInCanvas) {
      const action = manifest.kind === 'image'
        ? 'add_image'
        : manifest.kind === 'video'
          ? 'add_video'
          : 'pin_output';
      const visualResult = this.applyVisualSurfaceEvent(
        input.workspaceId,
        input.sessionId,
        { action, outputId: manifest.id },
        'agent',
      );
      shownInCanvas = visualResult.ok;
      canvasReceipt = visualResult.receipt ?? visualResult.error;
    }
    this.emitUpdated(input.workspaceId);
    return {
      ok: true,
      outputId: manifest.id,
      route: `/outputs/${manifest.id}`,
      file: `${manifest.id}/output.json`,
      shownInCanvas,
      canvasReceipt,
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

function latestVisualCapture(output: OutputManifest): VisualSurfaceStateCapture | null {
  const asset = [...output.assets].reverse().find((entry) => entry.id === 'visual-capture-canvas' && entry.mimeType === 'image/png')
    ?? [...output.assets].reverse().find((entry) => entry.role === 'thumbnail' && entry.path.startsWith('visual-captures/') && entry.mimeType === 'image/png');
  if (!asset) return null;
  return {
    assetId: asset.id,
    path: asset.path,
    capturedAt: captureTimestampFromLabel(asset.label) ?? undefined,
  };
}

function fileAssetMetadata(path: string): Pick<OutputAsset, 'mimeType' | 'sizeBytes' | 'sha256'> {
  if (!isAbsolute(path) || !existsSync(path)) return {};
  const stat = statSync(path);
  if (!stat.isFile()) return {};
  const data = readFileSync(path);
  return {
    mimeType: mimeTypeForAssetPath(path),
    sizeBytes: stat.size,
    sha256: createHash('sha256').update(data).digest('hex'),
  };
}

function mimeTypeForAssetPath(path: string): string | undefined {
  const ext = extname(path).toLowerCase();
  if (ext === '.html' || ext === '.htm') return 'text/html';
  if (ext === '.md' || ext === '.markdown') return 'text/markdown';
  if (ext === '.txt') return 'text/plain';
  if (ext === '.json') return 'application/json';
  if (ext === '.png') return 'image/png';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.gif') return 'image/gif';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.svg') return 'image/svg+xml';
  if (ext === '.mp4' || ext === '.m4v') return 'video/mp4';
  if (ext === '.mov') return 'video/quicktime';
  if (ext === '.webm') return 'video/webm';
  if (ext === '.glb') return 'model/gltf-binary';
  if (ext === '.gltf') return 'model/gltf+json';
  if (ext === '.mp3') return 'audio/mpeg';
  if (ext === '.wav') return 'audio/wav';
  if (ext === '.m4a') return 'audio/mp4';
  return undefined;
}

function decodePngDataUrl(dataUrl: string): { buffer: Buffer; mimeType: 'image/png' } {
  const match = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl.trim());
  if (!match) throw new Error('Visual capture must be a PNG data URL.');
  return { buffer: Buffer.from(match[1], 'base64'), mimeType: 'image/png' };
}

function slugifyCaptureVersion(value: string): string {
  const trimmed = value.trim();
  const hash = createHash('sha256').update(trimmed || 'default').digest('hex').slice(0, 16);
  const label = trimmed.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  return label ? `${label}-${hash}` : hash;
}

function captureTimestampFromLabel(label: string): string | null {
  const match = /^Canvas capture (.+)$/.exec(label);
  return match?.[1] ?? null;
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
