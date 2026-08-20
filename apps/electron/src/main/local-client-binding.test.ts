import { describe, expect, it } from 'bun:test'

import { createLocalClientBindingRegistry } from './local-client-binding'

describe('local client binding registry', () => {
  it('derives scope from the live renderer binding rather than handshake fields', () => {
    const renderer = {}
    const registry = createLocalClientBindingRegistry()
    const proof = registry.issue(renderer)

    const binding = registry.resolve({
      workspaceId: 'forged_workspace',
      webContentsId: 41,
      localClientProof: proof,
    }, webContentsId => webContentsId === 41
      ? { webContentsId: 41, renderer, workspaceId: 'authoritative_workspace' }
      : null)

    expect(binding).toEqual({
      workspaceId: 'authoritative_workspace',
      webContentsId: 41,
    })
  })

  it('rejects missing, forged, and stale-renderer proofs', () => {
    const renderer = {}
    const replacementRenderer = {}
    const registry = createLocalClientBindingRegistry()
    const proof = registry.issue(renderer)
    const findWindow = () => ({
      webContentsId: 41,
      renderer: replacementRenderer,
      workspaceId: 'authoritative_workspace',
    })

    expect(registry.resolve({
      workspaceId: 'forged_workspace',
      webContentsId: 41,
      localClientProof: null,
    }, findWindow)).toBeNull()
    expect(registry.resolve({
      workspaceId: 'forged_workspace',
      webContentsId: 41,
      localClientProof: 'forged-proof',
    }, findWindow)).toBeNull()
    expect(registry.resolve({
      workspaceId: 'forged_workspace',
      webContentsId: 41,
      localClientProof: proof,
    }, findWindow)).toBeNull()
  })
})
