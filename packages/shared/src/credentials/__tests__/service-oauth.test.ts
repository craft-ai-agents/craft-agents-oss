import { describe, it, expect } from 'bun:test'
import { accountToCredentialId, credentialIdToAccount } from '../types.ts'

describe('service_oauth credential ids', () => {
  it('round-trips service_oauth::{workspaceId}::{name}', () => {
    const id = {
      type: 'service_oauth' as const,
      workspaceId: 'ws-abc',
      name: 'svc-siyuan-cloud',
    }
    const account = credentialIdToAccount(id)
    expect(account).toBe('service_oauth::ws-abc::svc-siyuan-cloud')
    expect(accountToCredentialId(account)).toEqual(id)
  })

  it('rejects malformed service_oauth accounts', () => {
    expect(accountToCredentialId('service_oauth::only-one')).toBeNull()
    expect(accountToCredentialId('service_oauth')).toBeNull()
  })
})
