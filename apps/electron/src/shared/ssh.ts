import type { RemoteServerConfig } from '@craft-agent/core/types'

/** True when this remote config is reached over SSH (durable, not port-derived). */
export function isSshBacked(
  remote: RemoteServerConfig | null | undefined,
): remote is RemoteServerConfig & { sshHostId: string } {
  return !!remote && typeof remote.sshHostId === 'string' && remote.sshHostId.length > 0
}

/** True when a workspace's remote binding is SSH-backed. */
export function isSshBackedWorkspace(
  workspace: { remoteServer?: RemoteServerConfig | null } | null | undefined,
): boolean {
  return isSshBacked(workspace?.remoteServer)
}
