import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const source = readFileSync(join(import.meta.dir, '..', 'SecuritySettingsPage.tsx'), 'utf8')
const snakeSource = readFileSync(join(import.meta.dir, '..', 'security', 'SecuritySnake.tsx'), 'utf8')

describe('SecuritySettingsPage source contracts', () => {
  it('uses only the safe data surface, retains a stale snapshot on refresh failure, and clears a known-empty latest result', () => {
    expect(source).toContain('runtimeApi.getStatus')
    expect(source).toContain('auditApi.getLatest')
    expect(source).toContain('window.electronAPI.securityAudit.run')
    expect(source).toContain('setAuditRunning(true)')
    expect(source).toContain('setSnapshotFreshness(\'stale\')')
    expect(source).toContain('setSnapshot(null)')
    expect(source).toContain("t('security.audit.refreshingLastSnapshot'")
    expect(source).toContain("t('security.audit.stale'")
    expect(source).not.toMatch(/error\.message|String\(error\)|raw stderr|secretDiagnostics/i)
  })

  it('renders truthful loading, unavailable, partial, and deep-not-requested states through current i18n key patterns', () => {
    for (const key of [
      'security.loading',
      'security.error.apiUnavailable',
      'security.coverage.notRequested',
    ]) {
      expect(source).toContain('t' + "('" + key + "')")
    }
    expect(source).toContain("t(`security.runtime.state.${displayedRuntime?.state ?? 'unavailable'}`)")
    expect(source).toContain('t(`security.coverage.${displayedSnapshot.coverage.craft}`)')
    expect(source).toContain('t(`security.coverage.${displayedSnapshot.coverage.openclaw}`)')
    expect(source).toContain("deepCoverage === 'not-requested' ? 'notRequested' : deepCoverage")
    expect(source).toContain('t(`security.coverage.${deepCoverageKey}`)')
    expect(snakeSource).toContain('security.snake.coverage.${coverage}')
  })
  it('labels snapshot freshness, finding acceptance status, and audit progress accessibly', () => {
    expect(source).toContain('role="status"')
    expect(source).toContain('aria-live="polite"')
    expect(source).toContain('aria-atomic="true"')
    expect(source).toContain('· {statusLabel}')
  })

  it('supplies every interpolation variable to the confirmation scope', () => {
    expect(source).toContain("t('security.confirm.scope', {")
    expect(source).toContain('action: t(confirmationActionKey),')
    expect(source).toContain("workspace: activeWorkspace?.name ?? t('security.confirm.currentWorkspace')")
  })

  it('shows HOST_ONLY and makes host controls conditional on the native-only bridge', () => {
    expect(source).toContain('window.openClawHostControl')
    expect(source).toContain('HOST_ONLY')
    expect(source).toContain("t('security.hostOnly.title')")
    expect(source).toContain('hostControl &&')
    expect(source).not.toContain('electronAPI.openControlUi')
    expect(source).not.toContain('electronAPI.copyGatewayTokenForSetup')
    expect(source).not.toContain('--fix')
  })

  it('puts every mutation behind a pending confirmation before it can invoke an API', () => {
    expect(source).toContain('setPendingAction')
    expect(source).toContain('runConfirmedSecurityAction(pendingAction')
    expect(source).toContain('onOpenChange={(open) => {')
    expect(source).toContain('if (!open) setPendingAction(null)')
    expect(source).toContain("case 'install':")
    expect(source).toContain("case 'provision':")
    expect(source).toContain("case 'start':")
    expect(source).toContain("case 'stop':")
    expect(source).toContain("case 'audit':")
    expect(source).toContain("case 'accept':")
    expect(source).toContain("case 'revoke':")
    expect(source).toContain("case 'openControlUi':")
    expect(source).toContain("case 'copySetupCredential':")
  })
})
