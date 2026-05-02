import { resolve } from 'node:path';
import { RPC_CHANNELS } from '@craft-agent/shared/protocol';
import { getWorkspaceByNameOrId } from '@craft-agent/shared/config';
import type { OutputManifest, OutputSummary } from '@craft-agent/shared/outputs';
import type { RpcServer } from '@craft-agent/server-core/transport';
import { requestClientOpenPath, requestClientShowInFolder } from '@craft-agent/server-core/transport';
import { getWorkspaceAllowedDirs, validateFilePath } from '@craft-agent/server-core/handlers';
import type { HandlerDeps } from '../handler-deps';
import { OutputService, pushOutputsUpdated, pushWorkflowRunUpdated } from '../../outputs/OutputService';

export const HANDLED_CHANNELS = [
  RPC_CHANNELS.outputs.LIST,
  RPC_CHANNELS.outputs.GET,
  RPC_CHANNELS.outputs.DELETE,
  RPC_CHANNELS.outputs.OPEN_FILE,
  RPC_CHANNELS.outputs.SHOW_IN_FOLDER,
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
  return output.assets.find((asset) => asset.id === assetIdOrPath)?.path ?? assetIdOrPath;
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
}
