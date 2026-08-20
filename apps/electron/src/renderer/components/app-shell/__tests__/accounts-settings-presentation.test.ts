import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const accountsSettingsPath = join(__dirname, '../../../pages/settings/AccountsSettingsPage.tsx')

describe('AccountsSettingsPage presentation', () => {
  const src = readFileSync(accountsSettingsPath, 'utf8')

  it('does not display raw profile IDs or modes', () => {
    expect(src).not.toContain('settings.accounts.profileMeta')
    expect(src).not.toContain('profile.id')
    expect(src).not.toContain('profile.mode')
  })

  it('gives the Notes section sole ownership of its cloud connection', () => {
    expect(src).toContain("connection.provider !== 'siyuan-cloud'")
    expect(src).toContain("connection.provider !== 'siyuan-local'")
    expect(src).toContain("<SettingsSection title={t('sidebar.notes')}>")
    expect(src).toContain("const notesLocal = connections.find((connection) => connection.provider === 'siyuan-local')")
    expect(src).toContain("routes.view.settings('knowledge')")
    expect(src).not.toContain('settings.accounts.siyuanCloud')
    expect(src).not.toContain('settings.accounts.connectCloud')
    expect(src).not.toContain('settings.accounts.description')
  })

  it('keeps the credential value hidden while passing it through the existing identity API', () => {
    const connectHandler = src.slice(
      src.indexOf('const handleConnectCloud'),
      src.indexOf('const handleDisconnect'),
    )

    expect(src).toContain('type="password"')
    expect(connectHandler).toContain('credentialValue: token')
    expect(connectHandler).toContain("setCloudToken('')")
    expect(connectHandler).toContain("connectFailed', { message: t('common.failed')")
    expect(connectHandler).not.toContain('errorMessage(error)')
    expect(src).not.toContain('value={token}')
  })
})
