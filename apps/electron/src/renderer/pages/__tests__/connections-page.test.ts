import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const page = readFileSync(join(__dirname, '../ConnectionsPage.tsx'), 'utf8')

describe('CF-6.2 ConnectionsPage', () => {
  it('exposes the five native tabs and no iframe or secret fields', () => {
    expect(page).toContain("'services'")
    expect(page).toContain("'credentials'")
    expect(page).toContain("'imports'")
    expect(page).toContain("'policies'")
    expect(page).toContain("'audit'")
    expect(page.toLowerCase()).not.toContain('<iframe')
    expect(page.toLowerCase()).not.toContain('infisical')
    expect(page).not.toMatch(/\bpayload\b|\bsecret\b|\brefreshToken\b/)
  })

  it('loads the workgraph connection list for the active workspace', () => {
    expect(page).toContain('listConnections')
    expect(page).toContain('sanitizeConnectionRows')
  })

  it('exposes a masked GitHub env import on the Imports tab', () => {
    expect(page).toContain('previewGithubEnv')
    expect(page).toContain('importGithubEnv')
    expect(page).toContain('maskedSummary')
    expect(page.toLowerCase()).not.toContain('infisical')
  })

  it('exposes a masked git-credential-helper import on the Imports tab', () => {
    expect(page).toContain('previewGitHelper')
    expect(page).toContain('importGitHelper')
    expect(page).toContain('gitConfigPath')
    expect(page.toLowerCase()).not.toContain('infisical')
  })

  it('revokes a listed connection without exposing secret fields', () => {
    expect(page).toContain('revokeConnection')
    expect(page).toContain('connections.revoke')
    expect(page.toLowerCase()).not.toContain('infisical')
  })

  it('confirms before revoking a connection', () => {
    expect(page).toContain('connections.revokeConfirm')
    expect(page).toContain('connections.revokeCancel')
    expect(page).toContain('confirmingId')
  })

  it('renders credential and policy metadata from listed connections', () => {
    expect(page).toContain("tab === 'credentials'")
    expect(page).toContain("tab === 'policies'")
    expect(page).toContain('row.scopes')
    expect(page).toContain('row.credentialRefId')
  })

  it('selects a service row for the inspector host', () => {
    expect(page).toContain('selectedConnectionAtom')
    expect(page).toContain('aria-selected')
    expect(page).toContain('data-testid="connections-row"')
  })

  it('tests a listed GitHub connection without exposing secret fields', () => {
    expect(page).toContain('testConnection')
    expect(page).toContain('connections.test')
    expect(page.toLowerCase()).not.toContain('infisical')
  })

  it('rotates a listed connection with confirm', () => {
    expect(page).toContain('rotateConnection')
    expect(page).toContain('connections.rotateConfirm')
  })

  it('repairs a listed connection', () => {
    expect(page).toContain('repairConnection')
    expect(page).toContain('connections.repair')
  })

  it('exposes a native Connect control that lists import sources', () => {
    expect(page).toContain('connections.connect')
    expect(page).toContain('CONNECT_SOURCES')
    expect(page).toContain("'keychain'")
    expect(page).toContain("'adc'")
    expect(page).toContain("'ssh-agent'")
    expect(page.toLowerCase()).not.toContain('<iframe')
  })

  it('loads metadata-only connection audit on the Audit tab', () => {
    expect(page).toContain('listConnectionAudit')
    expect(page).toContain("tab === 'audit'")
    expect(page).toContain('payloadDigest')
    expect(page).toContain('sanitizeConnectionAuditRows')
    expect(page).toContain('occurredAt')
    expect(page).toContain('actorId')
    expect(page).toContain('row.action')
  })

  it('names Connection and CredentialRef on revoke confirm', () => {
    expect(page).toContain('connections-confirm-target')
    expect(page).toContain('row.credentialRefId')
  })

  it('converts a copy connection to reference with confirm', () => {
    expect(page).toContain('convertConnection')
    expect(page).toContain('connections.convertConfirm')
    expect(page).toContain("row.storageMode === 'copy'")
  })

  it('lists and unbinds connection grants on the Policies tab', () => {
    expect(page).toContain('listConnectionBindings')
    expect(page).toContain('revokeConnectionBinding')
    expect(page).toContain('connections.unbind')
  })

  it('exposes masked docker, aws, keychain, adc, and ssh-agent imports', () => {
    expect(page).toContain('previewDockerHelper')
    expect(page).toContain('importDockerHelper')
    expect(page).toContain('dockerConfigPath')
    expect(page).toContain('previewAwsProfiles')
    expect(page).toContain('importAwsProfile')
    expect(page).toContain('previewKeychain')
    expect(page).toContain('importKeychain')
    expect(page).toContain('previewAdc')
    expect(page).toContain('importAdc')
    expect(page).toContain('previewSshAgent')
    expect(page).toContain('importSshAgent')
    expect(page.toLowerCase()).not.toContain('infisical')
  })

  it('keeps the five tab ids unchanged', () => {
    expect(page).toContain("const TABS = ['services', 'credentials', 'imports', 'policies', 'audit']")
  })

  it('surfaces import and list errors without secret fields', () => {
    expect(page).toContain('importError')
    expect(page).toContain('listError')
    expect(page).toContain('connections-import-error')
    expect(page).toContain('connections-list-error')
    expect(page).toContain('errorMessage')
    expect(page.toLowerCase()).not.toContain('infisical')
    expect(page).not.toMatch(/\bpayload\b|\bsecret\b|\brefreshToken\b/)
  })

  it('shows test outcome on the services list', () => {
    expect(page).toContain('testStatusFromResult')
    expect(page).toContain('testStatusFromError')
    expect(page).toContain('connections-test-status')
  })

  it('filters import previews from Connect source chips', () => {
    expect(page).toContain('activeSource')
    expect(page).toContain('matchesConnectSource')
    expect(page).toContain('connections-source-chip')
    expect(page).toContain('aria-pressed')
  })

  it('names affected consumers on revoke confirm', () => {
    expect(page).toContain('consumersForConnection')
    expect(page).toContain('formatConfirmTargets')
  })

  it('fills import path placeholders', () => {
    expect(page).toContain('IMPORT_PLACEHOLDERS')
    expect(page).toContain('placeholder={placeholder}')
    expect(page).toContain('IMPORT_PLACEHOLDERS.env')
    expect(page).toContain('IMPORT_PLACEHOLDERS.gitConfig')
    expect(page).toContain('IMPORT_PLACEHOLDERS.dockerConfig')
    expect(page).toContain('IMPORT_PLACEHOLDERS.adc')
  })

  it('names affected consumers on rotate confirm', () => {
    expect(page).toContain('connections-rotate-confirm-target')
    expect(page).toContain('formatConfirmTargets')
  })

  it('scopes import forms to the active Connect chip', () => {
    expect(page).toContain('isImportPanelVisible')
    expect(page).toContain('connections-import-panel')
    expect(page).toContain('data-source')
  })

  it('picks an import path through the existing file dialog', () => {
    expect(page).toContain('openFileDialog')
    expect(page).toContain('firstPickedPath')
    expect(page).toContain('connections-pick-path')
    expect(page.toLowerCase()).not.toContain('infisical')
  })

  it('drops a committed import candidate from the preview list', () => {
    expect(page).toContain('removeCommittedPreview')
  })

  it('keeps audit load errors off the services empty state', () => {
    expect(page).toContain('auditError')
    expect(page).toContain('connections-audit-error')
    expect(page).toContain('setAuditError')
  })

  it('marks tab panels and cycles tabs with arrows', () => {
    expect(page).toContain('role="tabpanel"')
    expect(page).toContain('aria-controls')
    expect(page).toContain('cycleTab')
    expect(page).toContain('ArrowRight')
    expect(page).toContain('ArrowLeft')
    expect(page).toContain("const TABS = ['services', 'credentials', 'imports', 'policies', 'audit']")
  })

  it('does not treat a pending list load as the empty state', () => {
    expect(page).toContain('connections-loading')
    expect(page).toContain('aria-busy')
  })

  it('renders audit time, actor, and action metadata', () => {
    expect(page).toContain('occurredAt')
    expect(page).toContain('actorId')
    expect(page).toContain('row.action')
  })

  it('creates a metadata-only connection from the Services tab', () => {
    expect(page).toContain('createConnection')
    expect(page).toContain('connections.create')
    expect(page).toContain('connections-create-form')
    expect(page).toContain('createCredentialRef')
    expect(page.toLowerCase()).not.toContain('infisical')
    expect(page).not.toMatch(/\bpayload\b|\bsecret\b|\brefreshToken\b/)
  })

  it('grants a named consumer on the Policies tab', () => {
    expect(page).toContain('grantConnection')
    expect(page).toContain('connections.grant')
    expect(page).toContain('connections-grant-form')
    expect(page).toContain('grantConsumer')
    expect(page.toLowerCase()).not.toContain('infisical')
    expect(page).not.toMatch(/\bpayload\b|\bsecret\b|\brefreshToken\b/)
  })
})



