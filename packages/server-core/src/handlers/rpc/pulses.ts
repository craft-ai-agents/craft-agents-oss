import { RPC_CHANNELS } from '@craft-agent/shared/protocol';
import { getWorkspaceByNameOrId } from '@craft-agent/shared/config';
import { readPulseTicks, type PulseTickEntry } from '@craft-agent/shared/pulses';
import type { RpcServer } from '@craft-agent/server-core/transport';
import type { HandlerDeps } from '../handler-deps';
import { pushPulseTick as pushPulseTickImpl } from '../../notifications/NotificationService';

export const HANDLED_CHANNELS = [RPC_CHANNELS.pulses.LIST_TICKS] as const;

function resolveRootPath(workspaceId: string): string {
  const workspace = getWorkspaceByNameOrId(workspaceId);
  if (!workspace) throw new Error(`Workspace not found: ${workspaceId}`);
  return workspace.rootPath;
}

export function registerPulsesHandlers(server: RpcServer, _deps: HandlerDeps): void {
  server.handle(
    RPC_CHANNELS.pulses.LIST_TICKS,
    async (_ctx, workspaceId: string, pulseId: string, limit?: number): Promise<PulseTickEntry[]> => {
      const rootPath = resolveRootPath(workspaceId);
      return readPulseTicks(rootPath, pulseId, { limit });
    },
  );
}

export function pushPulseTick(server: RpcServer, workspaceId: string, tick: PulseTickEntry): void {
  pushPulseTickImpl(server, workspaceId, tick);
}
