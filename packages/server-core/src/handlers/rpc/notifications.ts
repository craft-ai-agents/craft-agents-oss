import { RPC_CHANNELS } from '@craft-agent/shared/protocol';
import { getWorkspaceByNameOrId } from '@craft-agent/shared/config';
import type { NotificationEntry } from '@craft-agent/shared/notifications/types';
import type { RpcServer } from '@craft-agent/server-core/transport';
import type { HandlerDeps } from '../handler-deps';
import {
  NotificationService,
  pushNotificationsUpdated as pushNotificationsUpdatedImpl,
} from '../../notifications/NotificationService';

export const HANDLED_CHANNELS = [
  RPC_CHANNELS.notifications.LIST,
  RPC_CHANNELS.notifications.ACKNOWLEDGE,
  RPC_CHANNELS.notifications.CLEAR,
  RPC_CHANNELS.notifications.CLEAR_ALL,
  RPC_CHANNELS.notifications.RESPOND_TO_ASK,
] as const;

function resolveRootPath(workspaceId: string): string {
  const workspace = getWorkspaceByNameOrId(workspaceId);
  if (!workspace) throw new Error(`Workspace not found: ${workspaceId}`);
  return workspace.rootPath;
}

function serviceFor(server: RpcServer): NotificationService {
  return new NotificationService({
    getWorkspaceRootPath: resolveRootPath,
    emitUpdated: (workspaceId, entries) =>
      pushNotificationsUpdatedImpl(server, workspaceId, entries),
  });
}

export function registerNotificationsHandlers(server: RpcServer, _deps: HandlerDeps): void {
  server.handle(
    RPC_CHANNELS.notifications.LIST,
    async (_ctx, workspaceId: string): Promise<NotificationEntry[]> => {
      return serviceFor(server).list(workspaceId);
    },
  );

  server.handle(
    RPC_CHANNELS.notifications.ACKNOWLEDGE,
    async (_ctx, workspaceId: string, id: string): Promise<NotificationEntry | null> => {
      return serviceFor(server).acknowledge(workspaceId, id);
    },
  );

  server.handle(
    RPC_CHANNELS.notifications.CLEAR,
    async (_ctx, workspaceId: string, id: string): Promise<boolean> => {
      return serviceFor(server).clear(workspaceId, id);
    },
  );

  server.handle(
    RPC_CHANNELS.notifications.CLEAR_ALL,
    async (_ctx, workspaceId: string): Promise<number> => {
      return serviceFor(server).clearAll(workspaceId);
    },
  );

  server.handle(
    RPC_CHANNELS.notifications.RESPOND_TO_ASK,
    async (
      _ctx,
      workspaceId: string,
      id: string,
      response: string,
    ): Promise<NotificationEntry | null> => {
      return serviceFor(server).recordResponse(workspaceId, id, response);
    },
  );
}

/**
 * Re-export of the NotificationService broadcast helper. PulseExecutor
 * wiring (Lane B) and any other notification producer can call this after
 * mutating a workspace's bell state out-of-band.
 */
export function pushNotificationsUpdated(server: RpcServer, workspaceId: string): void {
  // Read current state via a fresh service so we always emit a consistent
  // snapshot — callers don't need to track state themselves.
  const svc = new NotificationService({ getWorkspaceRootPath: resolveRootPath });
  pushNotificationsUpdatedImpl(server, workspaceId, svc.list(workspaceId));
}
