import { describe, expect, it } from 'bun:test'
import {
  CONNECTION_INSPECTOR_FIELD_IDS,
  projectConnectionInspector,
} from '../connection-inspector-model'

const ROW = {
  id: 'c1',
  workspaceId: 'workspace_a',
  integrationId: 'github',
  credentialRefId: 'cred_123e4567-e89b-12d3-a456-426614174000',
  storageMode: 'copy',
  scopes: ['repo', 'read:org'],
}

describe('CF-6.4 connection inspector projection', () => {
  it('projects provider, storage mode, credential ref, and scopes only', () => {
    const fields = projectConnectionInspector(ROW)
    expect(fields).toEqual({
      provider: 'github',
      storageMode: 'copy',
      credentialRef: ROW.credentialRefId,
      scopes: 'repo, read:org',
    })
    expect(CONNECTION_INSPECTOR_FIELD_IDS).toEqual([
      'provider',
      'storageMode',
      'credentialRef',
      'scopes',
    ])
    expect(JSON.stringify(fields)).not.toMatch(/value|payload|secret|token|refreshToken/)
  })

  it('rejects secret fields and empty scopes stay a dash', () => {
    expect(() => projectConnectionInspector({
      ...ROW,
      token: 'gho_super-secret',
    })).toThrow(/token/)
    expect(projectConnectionInspector({ ...ROW, scopes: [] }).scopes).toBe('—')
  })
})
