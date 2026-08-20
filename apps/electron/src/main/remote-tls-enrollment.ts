import { createHash, randomUUID, X509Certificate } from 'node:crypto'
import tls from 'node:tls'
import type { RemoteTlsTrust } from '@craft-agent/core/types'

export { peerTrustOptionsForRemote } from '../shared/remote-tls-client-options.ts'

export interface RemoteTlsEnrollmentResult {
  origin: string
  spkiSha256: string
  expiresAt: number
}

export type EnrollmentAction = 'accept' | 'reject' | 'confirm-rollover'

const sessions = new Map<string, { result: RemoteTlsEnrollmentResult; expiresAt: number }>()
const DEFAULT_TTL_MS = 60_000

export async function inspectRemoteTlsPeer(url: string): Promise<RemoteTlsEnrollmentResult> {
  const parsed = new URL(url)
  if (parsed.protocol !== 'wss:' && parsed.protocol !== 'https:') {
    throw new Error('TLS inspection requires wss:// or https://')
  }

  const port = parsed.port ? Number(parsed.port) : 443
  const host = parsed.hostname
  const originUrl = new URL(url)
  originUrl.protocol = 'wss:'

  return await new Promise((resolve, reject) => {
    const isIp = /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host) || host.includes(':')
    const socket = tls.connect({
      host,
      port,
      ...(isIp ? {} : { servername: host }),
      rejectUnauthorized: false,
    }, () => {
      try {
        const cert = socket.getPeerCertificate(true)
        if (!cert?.raw) throw new Error('Peer presented no certificate')
        const der = new X509Certificate(cert.raw).publicKey.export({ type: 'spki', format: 'der' })
        const spkiSha256 = createHash('sha256').update(der as Buffer).digest('base64')
        const validTo = Date.parse(cert.valid_to)
        socket.end()
        resolve({
          origin: originUrl.origin,
          spkiSha256,
          expiresAt: Number.isFinite(validTo) ? validTo : 0,
        })
      } catch (error) {
        socket.destroy()
        reject(error)
      }
    })
    socket.setTimeout(5_000, () => {
      socket.destroy()
      reject(new Error('TLS inspection timed out'))
    })
    socket.on('error', reject)
  })
}

export function beginEnrollment(
  result: RemoteTlsEnrollmentResult,
  now = Date.now(),
  ttlMs = DEFAULT_TTL_MS,
): string {
  const nonce = randomUUID()
  sessions.set(nonce, { result, expiresAt: now + ttlMs })
  return nonce
}

export function applyEnrollmentDecision(input: {
  nonce: string
  action: EnrollmentAction
  storedPin?: { origin: string; spkiSha256: string }
  now?: number
}): { persist: RemoteTlsTrust | null; requireSecondDecision?: boolean } {
  const now = input.now ?? Date.now()
  const session = sessions.get(input.nonce)
  if (!session || now > session.expiresAt) {
    throw new Error('Enrollment inspection expired')
  }

  if (input.action === 'reject') {
    sessions.delete(input.nonce)
    return { persist: null }
  }

  const persist: RemoteTlsTrust = {
    mode: 'spki-pin',
    origin: session.result.origin,
    spkiSha256: session.result.spkiSha256,
    enrolledAt: now,
  }

  if (
    input.action === 'accept'
    && input.storedPin
    && input.storedPin.spkiSha256 !== session.result.spkiSha256
  ) {
    return { persist: null, requireSecondDecision: true }
  }

  sessions.delete(input.nonce)
  return { persist }
}

