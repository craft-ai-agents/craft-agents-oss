import { describe, expect, it } from 'bun:test'
import {
  IMPORT_PLACEHOLDERS,
  consumersForConnection,
  cycleTab,
  errorMessage,
  firstPickedPath,
  formatConfirmTargets,
  isImportPanelVisible,
  matchesConnectSource,
  previewSourceForChip,
  removeCommittedPreview,
  testStatusFromError,
  testStatusFromResult,
} from '../connections-ui'

describe('CF-6 Connections UI helpers', () => {
  it('reads a cloned IPC error message without leaking extra fields', () => {
    const err = { message: 'preview failed', token: 'gho_super-secret' }
    expect(errorMessage(err)).toBe('preview failed')
    expect(errorMessage(err)).not.toContain('gho_super-secret')
    expect(errorMessage({ token: 'gho_super-secret' })).toBe('—')
    expect(errorMessage(new Error('  path not found  '))).toBe('path not found')
    expect(errorMessage('  discover failed  ')).toBe('discover failed')
    expect(errorMessage(null)).toBe('—')
  })

  it('names Connection, CredentialRef, and affected consumers on confirm', () => {
    const row = { id: 'c1', credentialRefId: 'cred_abc' }
    expect(formatConfirmTargets(row, [])).toBe('c1 cred_abc')
    expect(formatConfirmTargets(row, ['agent.github_user', 'workflow.deploy'])).toBe(
      'c1 cred_abc agent.github_user, workflow.deploy',
    )
    expect(consumersForConnection([
      { connectionId: 'c1', consumerId: 'agent.github_user' },
      { connectionId: 'c2', consumerId: 'other' },
      { connectionId: 'c1', consumerId: 'workflow.deploy' },
      { connectionId: 'c1', consumerId: 'agent.github_user' },
    ], 'c1')).toEqual(['agent.github_user', 'workflow.deploy'])
  })

  it('maps Connect chips onto preview sources and filters the candidate list', () => {
    expect(previewSourceForChip('github-env')).toBe('env')
    expect(previewSourceForChip('git-helper')).toBe('git-helper')
    const rows = [
      { candidateId: 'a', source: 'env' as const },
      { candidateId: 'b', source: 'keychain' as const },
    ]
    expect(matchesConnectSource(rows, null)).toEqual(rows)
    expect(matchesConnectSource(rows, 'github-env')).toEqual([{ candidateId: 'a', source: 'env' }])
    expect(matchesConnectSource(rows, 'keychain')).toEqual([{ candidateId: 'b', source: 'keychain' }])
    expect(matchesConnectSource(rows, 'adc')).toEqual([])
  })

  it('records test login metadata or a safe error status', () => {
    expect(testStatusFromResult({ login: 'octocat' })).toEqual({ kind: 'ok', login: 'octocat' })
    expect(testStatusFromError(new Error('login failed'))).toEqual({
      kind: 'error',
      message: 'login failed',
    })
    expect(JSON.stringify(testStatusFromError({ token: 'gho_x' }))).not.toContain('gho_x')
  })

  it('exposes HOME-relative import placeholders without calling host runners', () => {
    expect(IMPORT_PLACEHOLDERS.env).toBe('~/.env')
    expect(IMPORT_PLACEHOLDERS.gitConfig).toBe('~/.gitconfig')
    expect(IMPORT_PLACEHOLDERS.dockerConfig).toBe('~/.docker/config.json')
    expect(IMPORT_PLACEHOLDERS.awsCredentials).toBe('~/.aws/credentials')
    expect(IMPORT_PLACEHOLDERS.awsConfig).toBe('~/.aws/config')
    expect(IMPORT_PLACEHOLDERS.adc).toBe('~/.config/gcloud/application_default_credentials.json')
  })

  it('shows only the matching import panel for an active Connect chip', () => {
    expect(isImportPanelVisible('env', null)).toBe(true)
    expect(isImportPanelVisible('keychain', null)).toBe(true)
    expect(isImportPanelVisible('env', 'github-env')).toBe(true)
    expect(isImportPanelVisible('git-helper', 'github-env')).toBe(false)
    expect(isImportPanelVisible('keychain', 'keychain')).toBe(true)
    expect(isImportPanelVisible('ssh-agent', 'keychain')).toBe(false)
  })

  it('takes the first picked file path and ignores empty picks', () => {
    expect(firstPickedPath(['/tmp/.env', '/tmp/other'])).toBe('/tmp/.env')
    expect(firstPickedPath('/tmp/.gitconfig')).toBe('/tmp/.gitconfig')
    expect(firstPickedPath([])).toBe('')
    expect(firstPickedPath(null)).toBe('')
    expect(firstPickedPath(['  '])).toBe('')
  })

  it('drops a committed preview candidate without touching other sources', () => {
    const rows = [
      { candidateId: 'a', source: 'env' as const },
      { candidateId: 'b', source: 'env' as const },
      { candidateId: 'a', source: 'keychain' as const },
    ]
    expect(removeCommittedPreview(rows, { candidateId: 'a', source: 'env' })).toEqual([
      { candidateId: 'b', source: 'env' },
      { candidateId: 'a', source: 'keychain' },
    ])
  })

  it('cycles the five connection tabs without renaming them', () => {
    const tabs = ['services', 'credentials', 'imports', 'policies', 'audit'] as const
    expect(cycleTab(tabs, 'services', 1)).toBe('credentials')
    expect(cycleTab(tabs, 'audit', 1)).toBe('services')
    expect(cycleTab(tabs, 'services', -1)).toBe('audit')
    expect(cycleTab(tabs, 'imports', 0)).toBe('imports')
  })
})
