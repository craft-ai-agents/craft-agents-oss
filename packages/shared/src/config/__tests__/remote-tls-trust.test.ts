import { describe, expect, it } from 'bun:test'
import type { RemoteServerConfig } from '@craft-agent/core/types'
import { normalizeRemoteTlsTrust } from '../remote-tls-trust.ts'

const SPKI_SHA256 = Buffer.alloc(32, 7).toString('base64')

function remoteServer(overrides: Partial<RemoteServerConfig> = {}): RemoteServerConfig {
  return {
    url: 'wss://remote.example.test:8443',
    token: 'remote-token',
    remoteWorkspaceId: 'remote-workspace',
    ...overrides,
  }
}

describe('normalizeRemoteTlsTrust', () => {
  it('normalizes legacy wss records to public CA trust', () => {
    expect(normalizeRemoteTlsTrust(remoteServer())).toEqual({ mode: 'public-ca' })
  })

  it('accepts a canonical matching wss SPKI pin', () => {
    expect(
      normalizeRemoteTlsTrust(
        remoteServer({
          tlsTrust: {
            mode: 'spki-pin',
            origin: 'wss://remote.example.test:8443',
            spkiSha256: SPKI_SHA256,
            enrolledAt: 1_725_000_000_000,
          },
        }),
      ),
    ).toEqual({
      mode: 'spki-pin',
      origin: 'wss://remote.example.test:8443',
      spkiSha256: SPKI_SHA256,
      enrolledAt: 1_725_000_000_000,
    })
  })

  it('rejects an SPKI pin whose origin does not match the remote URL', () => {
    expect(() =>
      normalizeRemoteTlsTrust(
        remoteServer({
          tlsTrust: {
            mode: 'spki-pin',
            origin: 'wss://other.example.test:8443',
            spkiSha256: SPKI_SHA256,
            enrolledAt: 1_725_000_000_000,
          },
        }),
      ),
    ).toThrow('origin must match')
  })

  it('rejects non-wss and malformed SPKI pin records', () => {
    expect(() =>
      normalizeRemoteTlsTrust(
        remoteServer({
          url: 'ws://127.0.0.1:9100',
          tlsTrust: {
            mode: 'spki-pin',
            origin: 'ws://127.0.0.1:9100',
            spkiSha256: SPKI_SHA256,
            enrolledAt: 1_725_000_000_000,
          },
        }),
      ),
    ).toThrow('requires a wss:// remote URL')

    expect(() =>
      normalizeRemoteTlsTrust(
        remoteServer({
          tlsTrust: {
            mode: 'spki-pin',
            origin: 'wss://remote.example.test:8443',
            spkiSha256: 'not-base64',
            enrolledAt: 1_725_000_000_000,
          },
        }),
      ),
    ).toThrow('base64-encoded SHA-256 digest')
  })
})
