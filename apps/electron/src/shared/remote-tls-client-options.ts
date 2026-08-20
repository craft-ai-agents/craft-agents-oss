import type { RemoteServerConfig } from '@craft-agent/core/types'
import { createPeerTrustVerifier, type PeerTrustVerifier } from '@craft-agent/server-core/transport'
import { normalizeRemoteTlsTrust } from '@craft-agent/shared/config'

export function peerTrustOptionsForRemote(
  remote: Pick<RemoteServerConfig, 'url' | 'token' | 'remoteWorkspaceId' | 'tlsTrust' | 'sshHostId'>,
): { peerTrustVerifier?: PeerTrustVerifier } {
  if (remote.sshHostId) return {}
  return {
    peerTrustVerifier: createPeerTrustVerifier(normalizeRemoteTlsTrust({
      url: remote.url,
      token: remote.token,
      remoteWorkspaceId: remote.remoteWorkspaceId,
      tlsTrust: remote.tlsTrust,
    })),
  }
}
