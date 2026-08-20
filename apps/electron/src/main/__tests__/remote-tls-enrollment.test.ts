import { afterEach, describe, expect, it } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import tls from 'node:tls'
import { createHash, X509Certificate } from 'node:crypto'
import {
  applyEnrollmentDecision,
  beginEnrollment,
  inspectRemoteTlsPeer,
  peerTrustOptionsForRemote,
} from '../remote-tls-enrollment.ts'
import type { RemoteServerConfig } from '@craft-agent/core/types'

const PIN_A = Buffer.alloc(32, 7).toString('base64')
const PIN_B = Buffer.alloc(32, 9).toString('base64')

describe('applyEnrollmentDecision', () => {
  it('persists the inspected origin and pin on accept', () => {
    const nonce = beginEnrollment({
      origin: 'wss://remote.example.test:8443',
      spkiSha256: PIN_A,
      expiresAt: 1_800_000_000_000,
    }, 1_000)
    expect(applyEnrollmentDecision({ nonce, action: 'accept', now: 1_000 })).toEqual({
      persist: {
        mode: 'spki-pin',
        origin: 'wss://remote.example.test:8443',
        spkiSha256: PIN_A,
        enrolledAt: 1_000,
      },
    })
  })

  it('persists nothing on reject', () => {
    const nonce = beginEnrollment({
      origin: 'wss://remote.example.test:8443',
      spkiSha256: PIN_A,
      expiresAt: 1_800_000_000_000,
    }, 1_000)
    expect(applyEnrollmentDecision({ nonce, action: 'reject', now: 1_000 })).toEqual({
      persist: null,
    })
  })

  it('requires a second explicit decision when the pin changed', () => {
    const nonce = beginEnrollment({
      origin: 'wss://remote.example.test:8443',
      spkiSha256: PIN_B,
      expiresAt: 1_800_000_000_000,
    }, 1_000)
    expect(applyEnrollmentDecision({
      nonce,
      action: 'accept',
      storedPin: { origin: 'wss://remote.example.test:8443', spkiSha256: PIN_A },
      now: 1_000,
    })).toEqual({ persist: null, requireSecondDecision: true })

    expect(applyEnrollmentDecision({
      nonce,
      action: 'confirm-rollover',
      storedPin: { origin: 'wss://remote.example.test:8443', spkiSha256: PIN_A },
      now: 2_000,
    })).toEqual({
      persist: {
        mode: 'spki-pin',
        origin: 'wss://remote.example.test:8443',
        spkiSha256: PIN_B,
        enrolledAt: 2_000,
      },
    })
  })
})

describe('peerTrustOptionsForRemote', () => {
  it('does not attach a verifier for SSH-backed remotes', () => {
    const remote: RemoteServerConfig = {
      url: 'ws://127.0.0.1:9100',
      token: 't',
      remoteWorkspaceId: 'ws',
      sshHostId: 'host-1',
    }
    expect(peerTrustOptionsForRemote(remote).peerTrustVerifier).toBeUndefined()
  })
})

describe('inspectRemoteTlsPeer', () => {
  const dirs: string[] = []
  const servers: tls.Server[] = []

  afterEach(() => {
    for (const server of servers.splice(0)) {
      server.close()
    }
    for (const dir of dirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('reads the peer pin without sending an RPC handshake token', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rox-tls-enroll-'))
    dirs.push(dir)
    execFileSync('openssl', [
      'req', '-x509', '-newkey', 'rsa:2048',
      '-keyout', join(dir, 'key.pem'),
      '-out', join(dir, 'cert.pem'),
      '-days', '1', '-nodes',
      '-subj', '/CN=127.0.0.1',
    ], { stdio: 'pipe' })
    const key = readFileSync(join(dir, 'key.pem'))
    const cert = readFileSync(join(dir, 'cert.pem'))
    const expected = createHash('sha256')
      .update(new X509Certificate(cert).publicKey.export({ type: 'spki', format: 'der' }) as Buffer)
      .digest('base64')

    let appData = Buffer.alloc(0)
    const server = tls.createServer({ key, cert }, (socket) => {
      socket.on('data', (chunk) => {
        appData = Buffer.concat([appData, chunk])
      })
    })
    servers.push(server)
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const port = (server.address() as { port: number }).port

    const inspected = await inspectRemoteTlsPeer(`wss://127.0.0.1:${port}`)
    expect(inspected.origin).toBe(`wss://127.0.0.1:${port}`)
    expect(inspected.spkiSha256).toBe(expected)
    expect(appData.toString()).not.toContain('handshake')
    expect(appData.toString()).not.toContain('token')
    expect(appData.length).toBe(0)
  })
})
