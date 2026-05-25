import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { RPC_CHANNELS } from '@craft-agent/shared/protocol';
import { getWorkspaceByNameOrId } from '@craft-agent/shared/config';
import type { OutputManifest, OutputSummary } from '@craft-agent/shared/outputs';
import type { VisualBoardSnapshot } from '@craft-agent/shared/visual-board';
import type { ApplyVisualSurfaceEventResult, VisualSurfaceEventInput, VisualSurfaceEventRecord } from '@craft-agent/shared/visual-surface-events';
import type { RpcServer } from '@craft-agent/server-core/transport';
import { requestClientOpenPath, requestClientShowInFolder } from '@craft-agent/server-core/transport';
import { getWorkspaceAllowedDirs, validateFilePath } from '@craft-agent/server-core/handlers';
import type { HandlerDeps } from '../handler-deps';
import { OutputService, pushOutputsUpdated, pushWorkflowRunUpdated } from '../../outputs/OutputService';

export const HANDLED_CHANNELS = [
  RPC_CHANNELS.outputs.LIST,
  RPC_CHANNELS.outputs.GET,
  RPC_CHANNELS.outputs.DELETE,
  RPC_CHANNELS.outputs.GET_VISUAL_BOARD,
  RPC_CHANNELS.outputs.SAVE_VISUAL_BOARD,
  RPC_CHANNELS.outputs.APPLY_VISUAL_SURFACE_EVENT,
  RPC_CHANNELS.outputs.LIST_VISUAL_SURFACE_EVENTS,
  RPC_CHANNELS.outputs.RECORD_VISUAL_CAPTURE,
  RPC_CHANNELS.outputs.OPEN_FILE,
  RPC_CHANNELS.outputs.SHOW_IN_FOLDER,
  RPC_CHANNELS.outputs.READ_ASSET_TEXT,
  RPC_CHANNELS.outputs.READ_ASSET_DATA_URL,
] as const;

function resolveRootPath(workspaceId: string): string {
  const workspace = getWorkspaceByNameOrId(workspaceId);
  if (!workspace) throw new Error(`Workspace not found: ${workspaceId}`);
  return workspace.rootPath;
}

function assertLocalWorkspace(workspaceId: string, action: string): void {
  const workspace = getWorkspaceByNameOrId(workspaceId);
  if (workspace?.remoteServer) throw new Error(`${action} is not available for remote workspaces`);
}

function serviceFor(server: RpcServer): OutputService {
  return new OutputService({
    getWorkspaceRootPath: resolveRootPath,
    emitOutputsUpdated: (workspaceId) => pushOutputsUpdated(server, workspaceId),
    emitWorkflowRunUpdated: (run) => pushWorkflowRunUpdated(server, run),
  });
}

function selectAssetPath(output: OutputManifest, assetIdOrPath?: string): string {
  if (!assetIdOrPath) {
    const path = output.primary?.path ?? output.assets[0]?.path;
    if (!path) throw new Error(`Output "${output.id}" has no file asset to open.`);
    return path;
  }
  // Reject unknown ids outright. Falling back to treating an unmatched
  // identifier as a literal path lets callers smuggle paths through this
  // surface — a confused-deputy attack against the downstream
  // workspace-root validator.
  const asset = output.assets.find((a) => a.id === assetIdOrPath);
  if (!asset) throw new Error(`Output "${output.id}" has no asset with id "${assetIdOrPath}".`);
  return asset.path;
}

async function resolveSafeOutputAssetPath(
  workspaceId: string,
  outputId: string,
  assetIdOrPath: string | undefined,
  service: OutputService,
): Promise<string> {
  const output = service.get(workspaceId, outputId);
  if (!output) throw new Error(`Output not found: ${outputId}`);
  const assetPath = selectAssetPath(output, assetIdOrPath);
  const absolutePath = resolve(service.resolveAssetPath(workspaceId, outputId, assetPath));
  return validateFilePath(absolutePath, getWorkspaceAllowedDirs(workspaceId));
}

function mimeTypeForPath(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  const mimeMap: Record<string, string> = {
    avif: 'image/avif',
    bmp: 'image/bmp',
    gif: 'image/gif',
    ico: 'image/x-icon',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    svg: 'image/svg+xml',
    webp: 'image/webp',
    excalidraw: 'application/vnd.excalidraw+json',
    m4v: 'video/mp4',
    mov: 'video/quicktime',
    mp4: 'video/mp4',
    webm: 'video/webm',
    aac: 'audio/aac',
    flac: 'audio/flac',
    m4a: 'audio/mp4',
    mp3: 'audio/mpeg',
    ogg: 'audio/ogg',
    wav: 'audio/wav',
    json: 'application/json',
    md: 'text/markdown',
    markdown: 'text/markdown',
    pdf: 'application/pdf',
    txt: 'text/plain',
  };
  return mimeMap[ext] ?? 'application/octet-stream';
}

export function registerOutputsHandlers(server: RpcServer, _deps: HandlerDeps): void {
  server.handle(
    RPC_CHANNELS.outputs.LIST,
    async (_ctx, workspaceId: string): Promise<OutputSummary[]> => {
      return serviceFor(server).list(workspaceId);
    },
  );

  server.handle(
    RPC_CHANNELS.outputs.GET,
    async (_ctx, workspaceId: string, outputId: string): Promise<OutputManifest | null> => {
      return serviceFor(server).get(workspaceId, outputId);
    },
  );

  server.handle(
    RPC_CHANNELS.outputs.DELETE,
    async (_ctx, workspaceId: string, outputId: string): Promise<boolean> => {
      return serviceFor(server).delete(workspaceId, outputId);
    },
  );

  server.handle(
    RPC_CHANNELS.outputs.GET_VISUAL_BOARD,
    async (_ctx, workspaceId: string, sessionId: string): Promise<{ output: OutputManifest; board: VisualBoardSnapshot }> => {
      assertLocalWorkspace(workspaceId, 'Get visual board');
      return serviceFor(server).getOrCreateVisualBoard(workspaceId, sessionId);
    },
  );

  server.handle(
    RPC_CHANNELS.outputs.SAVE_VISUAL_BOARD,
    async (
      _ctx,
      workspaceId: string,
      sessionId: string,
      snapshot: VisualBoardSnapshot,
    ): Promise<{ output: OutputManifest; board: VisualBoardSnapshot }> => {
      assertLocalWorkspace(workspaceId, 'Save visual board');
      return serviceFor(server).saveVisualBoard(workspaceId, sessionId, snapshot);
    },
  );

  server.handle(
    RPC_CHANNELS.outputs.APPLY_VISUAL_SURFACE_EVENT,
    async (
      _ctx,
      workspaceId: string,
      sessionId: string,
      input: VisualSurfaceEventInput,
    ): Promise<ApplyVisualSurfaceEventResult> => {
      assertLocalWorkspace(workspaceId, 'Apply visual surface event');
      return serviceFor(server).applyVisualSurfaceEvent(workspaceId, sessionId, input, 'user');
    },
  );

  server.handle(
    RPC_CHANNELS.outputs.LIST_VISUAL_SURFACE_EVENTS,
    async (_ctx, workspaceId: string, sessionId: string): Promise<VisualSurfaceEventRecord[]> => {
      assertLocalWorkspace(workspaceId, 'List visual surface events');
      return serviceFor(server).listVisualSurfaceEvents(workspaceId, sessionId);
    },
  );

  server.handle(
    RPC_CHANNELS.outputs.RECORD_VISUAL_CAPTURE,
    async (_ctx, input: Parameters<OutputService['recordVisualCapture']>[0]): Promise<ReturnType<OutputService['recordVisualCapture']>> => {
      assertLocalWorkspace(input.workspaceId, 'Record visual capture');
      return serviceFor(server).recordVisualCapture(input);
    },
  );

  server.handle(
    RPC_CHANNELS.outputs.OPEN_FILE,
    async (ctx, workspaceId: string, outputId: string, assetIdOrPath?: string): Promise<void> => {
      assertLocalWorkspace(workspaceId, 'Open output file');
      const safePath = await resolveSafeOutputAssetPath(workspaceId, outputId, assetIdOrPath, serviceFor(server));
      const result = await requestClientOpenPath(server, ctx.clientId, safePath);
      if (result.error) throw new Error(result.error);
    },
  );

  server.handle(
    RPC_CHANNELS.outputs.SHOW_IN_FOLDER,
    async (ctx, workspaceId: string, outputId: string, assetIdOrPath?: string): Promise<void> => {
      assertLocalWorkspace(workspaceId, 'Show output in folder');
      const safePath = await resolveSafeOutputAssetPath(workspaceId, outputId, assetIdOrPath, serviceFor(server));
      await requestClientShowInFolder(server, ctx.clientId, safePath);
    },
  );

  server.handle(
    RPC_CHANNELS.outputs.READ_ASSET_TEXT,
    async (_ctx, workspaceId: string, outputId: string, assetId?: string): Promise<string> => {
      assertLocalWorkspace(workspaceId, 'Read output asset');
      const safePath = await resolveSafeOutputAssetPath(workspaceId, outputId, assetId, serviceFor(server));
      return readFile(safePath, 'utf-8');
    },
  );

  server.handle(
    RPC_CHANNELS.outputs.READ_ASSET_DATA_URL,
    async (_ctx, workspaceId: string, outputId: string, assetId?: string): Promise<string> => {
      assertLocalWorkspace(workspaceId, 'Read output asset');
      const safePath = await resolveSafeOutputAssetPath(workspaceId, outputId, assetId, serviceFor(server));
      const buffer = await readFile(safePath);
      return `data:${mimeTypeForPath(safePath)};base64,${buffer.toString('base64')}`;
    },
  );
}
