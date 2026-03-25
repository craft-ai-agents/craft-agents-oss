import { describe, expect, it } from 'bun:test'
import { accountToCredentialId, credentialIdToAccount } from '../types.ts'

describe('credential account encoding', () => {
  it('serializes and parses remote server token ids', () => {
    const account = credentialIdToAccount({ type: 'remote_server_token', serverId: 'server-1' })

    expect(account).toBe('remote_server_token::server-1')
    expect(accountToCredentialId(account)).toEqual({
      type: 'remote_server_token',
      serverId: 'server-1',
    })
  })

  it('rejects malformed remote server token ids', () => {
    expect(accountToCredentialId('remote_server_token')).toBeNull()
    expect(accountToCredentialId('remote_server_token::')).toBeNull()
  })
})
