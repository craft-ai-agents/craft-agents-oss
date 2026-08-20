import { randomBytes, timingSafeEqual } from 'node:crypto'

import type {
  LocalClientBindingCandidate,
  TrustedLocalClientBinding,
} from '@craft-agent/server-core/transport'

export interface LocalWindowBinding {
  readonly webContentsId: number
  readonly renderer: object
  readonly workspaceId: string
}

export interface LocalClientBindingRegistry {
  issue(renderer: object): string
  resolve(
    candidate: LocalClientBindingCandidate,
    findWindow: (webContentsId: number) => LocalWindowBinding | null,
  ): TrustedLocalClientBinding | null
}

/**
 * Issues renderer-scoped, process-local proofs and resolves them only against
 * the live Electron window binding. A proof never authorizes an arbitrary
 * handshake workspace or a replacement renderer that reused an ID.
 */
export function createLocalClientBindingRegistry(): LocalClientBindingRegistry {
  const proofs = new WeakMap<object, string>()

  return {
    issue(renderer) {
      const existing = proofs.get(renderer)
      if (existing) return existing

      const proof = randomBytes(32).toString('base64url')
      proofs.set(renderer, proof)
      return proof
    },

    resolve(candidate, findWindow) {
      if (candidate.webContentsId === null || candidate.localClientProof === null) return null
      const binding = findWindow(candidate.webContentsId)
      if (!binding || binding.webContentsId !== candidate.webContentsId || !binding.workspaceId) return null

      const expectedProof = proofs.get(binding.renderer)
      if (!expectedProof || !proofsEqual(expectedProof, candidate.localClientProof)) return null

      return {
        workspaceId: binding.workspaceId,
        webContentsId: binding.webContentsId,
      }
    },
  }
}

function proofsEqual(expected: string, received: string): boolean {
  const expectedBytes = Buffer.from(expected)
  const receivedBytes = Buffer.from(received)
  return expectedBytes.length === receivedBytes.length && timingSafeEqual(expectedBytes, receivedBytes)
}
