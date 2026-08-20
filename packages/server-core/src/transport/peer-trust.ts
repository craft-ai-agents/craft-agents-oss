import { createHash, X509Certificate } from 'node:crypto'
import type { RemoteTlsTrust } from '@craft-agent/core/types'

export type PeerTrustVerifier = (input: {
  url: string
  socket: WebSocket
}) => Promise<void>

export interface PeerTrustVerifierHooks {
  extractSpkiSha256?: (socket: WebSocket) => string | null
  nodeRuntime?: boolean
}

export class PeerTrustError extends Error {
  readonly code: 'TLS_TRUST_REJECTED' | 'TLS_TRUST_UNSUPPORTED'

  constructor(code: PeerTrustError['code'], message: string) {
    super(message)
    this.name = 'PeerTrustError'
    this.code = code
  }
}

/** Public-CA and pinned remotes both keep Node TLS verification on. */
export function tlsSocketOptions(_trust?: RemoteTlsTrust): { rejectUnauthorized: true } {
  return { rejectUnauthorized: true }
}

export function extractPeerSpkiSha256(socket: WebSocket): string | null {
  const rawSocket = (socket as unknown as { _socket?: { getPeerCertificate?: (detailed: boolean) => { raw?: Buffer } } })._socket
  const cert = rawSocket?.getPeerCertificate?.(true)
  if (!cert?.raw) return null
  try {
    const der = new X509Certificate(cert.raw).publicKey.export({ type: 'spki', format: 'der' })
    return createHash('sha256').update(der as Buffer).digest('base64')
  } catch {
    return null
  }
}

export async function verifyPeerTrust(input: {
  url: string
  socket: WebSocket
  trust: RemoteTlsTrust
  extractSpkiSha256?: (socket: WebSocket) => string | null
  nodeRuntime?: boolean
}): Promise<void> {
  if (input.trust.mode === 'public-ca') return

  const nodeRuntime = input.nodeRuntime ?? (typeof process !== 'undefined' && Boolean(process.versions?.node))
  if (!nodeRuntime) {
    throw new PeerTrustError('TLS_TRUST_UNSUPPORTED', 'SPKI pin is not supported in this runtime')
  }

  const extract = input.extractSpkiSha256 ?? extractPeerSpkiSha256
  const digest = extract(input.socket)
  if (!digest || digest !== input.trust.spkiSha256) {
    throw new PeerTrustError('TLS_TRUST_REJECTED', 'Peer certificate does not match the enrolled SPKI pin')
  }
}

export function createPeerTrustVerifier(
  trust: RemoteTlsTrust,
  hooks: PeerTrustVerifierHooks = {},
): PeerTrustVerifier {
  return async (input) => {
    await verifyPeerTrust({
      url: input.url,
      socket: input.socket,
      trust,
      extractSpkiSha256: hooks.extractSpkiSha256,
      nodeRuntime: hooks.nodeRuntime,
    })
  }
}
