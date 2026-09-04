import { expect, test } from 'bun:test'
import { restoreStoredDesktopSession } from '../desktop-account-session'

test('a first-login encrypted session is restored on the next desktop launch', () => {
  const restored = restoreStoredDesktopSession(JSON.stringify({
    serverUrl: 'https://v2.jonwork.com',
    encryptedToken: Buffer.from('ciphertext').toString('base64'),
    managed: { wsUrl: 'wss://v2.jonwork.com/ws', workspaceId: 'erp-account-workspace' },
  }), {
    normalizeServerUrl: value => value,
    decrypt: value => value.toString() === 'ciphertext' ? 'access-token' : '',
  })
  expect(restored).toEqual({
    serverUrl: 'https://v2.jonwork.com', token: 'access-token',
    managed: { wsUrl: 'wss://v2.jonwork.com/ws', workspaceId: 'erp-account-workspace' },
  })
})

test('corrupt or incomplete persisted sessions fail closed', () => {
  const deps = { normalizeServerUrl: (value: string) => value, decrypt: () => 'token' }
  for (const value of ['{}', '{', JSON.stringify({ serverUrl: 'https://v2.jonwork.com', encryptedToken: '' }),
    JSON.stringify({ serverUrl: 'https://v2.jonwork.com', encryptedToken: 'YQ==', managed: { wsUrl: '', workspaceId: 'x' } })]) {
    expect(() => restoreStoredDesktopSession(value, deps)).toThrow()
  }
})
