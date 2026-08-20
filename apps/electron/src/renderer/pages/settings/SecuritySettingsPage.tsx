import * as React from 'react'
import { useTranslation } from 'react-i18next'
import type {
  AuditMode,
  OpenClawRuntimeStatus,
  SecurityAuditSnapshot,
  SecurityDomain,
  SecurityFinding,
} from '@craft-agent/shared/openclaw'
import type { DetailsPageMeta } from '@/lib/navigation-registry'
import { useActiveWorkspace } from '@/context/AppShellContext'
import { SettingsCard, SettingsSection } from '@/components/settings'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { SecuritySnake, filterSecurityFindings } from './security/SecuritySnake'
import { runConfirmedSecurityAction } from './security/security-actions'
import {
  RISK_ACCEPTANCE_MAX_CODE_POINTS,
  getRiskAcceptanceDateLimits,
  validateRiskAcceptance,
} from './security/security-validation'

export const meta: DetailsPageMeta = {
  navigator: 'settings',
  slug: 'security',
}

type PendingSecurityAction =
  | { readonly kind: 'install' }
  | { readonly kind: 'provision' }
  | { readonly kind: 'start' }
  | { readonly kind: 'stop' }
  | { readonly kind: 'audit'; readonly mode: AuditMode }
  | {
      readonly kind: 'accept'
      readonly fingerprint: string
      readonly checkId: string
      readonly rationale: string
      readonly expiresAt: number
    }
  | { readonly kind: 'revoke'; readonly fingerprint: string; readonly checkId: string }
  | { readonly kind: 'openControlUi' }
  | { readonly kind: 'copySetupCredential' }

type LoadState = 'idle' | 'unavailable' | 'failed'

type SnapshotFreshness = 'unknown' | 'fresh' | 'stale'

const RUNTIME_ACTIONABLE_STATES: Partial<Record<OpenClawRuntimeStatus['state'], true>> = {
  provisioned: true,
  stopped: true,
  degraded: true,
  failed: true,
}

function updateFindingAcceptance(
  snapshot: SecurityAuditSnapshot | null,
  fingerprint: string,
  acceptance: SecurityFinding['acceptance'],
): SecurityAuditSnapshot | null {
  if (!snapshot) return snapshot
  return {
    ...snapshot,
    findings: snapshot.findings.map((finding) =>
      finding.fingerprint === fingerprint ? { ...finding, acceptance } : finding,
    ),
  }
}

export default function SecuritySettingsPage() {
  const { t, i18n } = useTranslation()
  const activeWorkspace = useActiveWorkspace()
  const workspaceId = activeWorkspace?.id
  const hostControl = window.openClawHostControl
  const [runtimeStatus, setRuntimeStatus] = React.useState<OpenClawRuntimeStatus | null>(null)
  const [snapshot, setSnapshot] = React.useState<SecurityAuditSnapshot | null>(null)
  const [snapshotFreshness, setSnapshotFreshness] = React.useState<SnapshotFreshness>('unknown')
  const [loading, setLoading] = React.useState(true)
  const [loadState, setLoadState] = React.useState<LoadState>('idle')
  const [actionError, setActionError] = React.useState(false)
  const [auditRunning, setAuditRunning] = React.useState(false)
  const [busyAction, setBusyAction] = React.useState<PendingSecurityAction['kind'] | null>(null)
  const [pendingAction, setPendingAction] = React.useState<PendingSecurityAction | null>(null)
  const [selectedDomain, setSelectedDomain] = React.useState<SecurityDomain | null>(null)
  const [selectedFingerprint, setSelectedFingerprint] = React.useState<string | null>(null)
  const [adviceFingerprint, setAdviceFingerprint] = React.useState<string | null>(null)
  const [acceptanceFinding, setAcceptanceFinding] = React.useState<SecurityFinding | null>(null)
  const [rationale, setRationale] = React.useState('')
  const [expiresOn, setExpiresOn] = React.useState('')

  const dateFormatter = React.useMemo(
    () => new Intl.DateTimeFormat(i18n.language || 'ru-RU', { dateStyle: 'medium', timeStyle: 'short' }),
    [i18n.language],
  )
  const dateLimits = getRiskAcceptanceDateLimits()
  const acceptanceValidation = validateRiskAcceptance({ rationale, expiresOn })
  const displayedRuntime = runtimeStatus?.workspaceId === workspaceId ? runtimeStatus : null
  const displayedSnapshot = snapshot?.workspaceId === workspaceId ? snapshot : null
  const apiAvailable =
    typeof window.electronAPI?.openclawRuntime?.getStatus === 'function' &&
    typeof window.electronAPI?.openclawRuntime?.install === 'function' &&
    typeof window.electronAPI?.openclawRuntime?.provision === 'function' &&
    typeof window.electronAPI?.openclawRuntime?.start === 'function' &&
    typeof window.electronAPI?.openclawRuntime?.stop === 'function' &&
    typeof window.electronAPI?.securityAudit?.run === 'function' &&
    typeof window.electronAPI?.securityAudit?.getLatest === 'function' &&
    typeof window.electronAPI?.securityAudit?.acceptRisk === 'function' &&
    typeof window.electronAPI?.securityAudit?.revokeRiskAcceptance === 'function'

  const refresh = React.useCallback(async () => {
    if (!workspaceId) {
      setLoading(false)
      return
    }

    const runtimeApi = window.electronAPI?.openclawRuntime
    const auditApi = window.electronAPI?.securityAudit
    if (!apiAvailable || !runtimeApi || !auditApi) {
      setLoadState('unavailable')
      setLoading(false)
      return
    }

    setLoading(true)
    setLoadState('idle')
    try {
      const [runtimeResult, latestResult] = await Promise.allSettled([
        runtimeApi.getStatus({ workspaceId }),
        auditApi.getLatest({ workspaceId }),
      ])

      if (runtimeResult.status === 'fulfilled') {
        setRuntimeStatus(runtimeResult.value)
      } else {
        setLoadState('failed')
      }
      if (latestResult.status === 'fulfilled') {
        const latest = latestResult.value
        if (latest !== null) {
          setSnapshot(latest)
          setSnapshotFreshness('fresh')
        } else {
          setSnapshot(null)
          setSnapshotFreshness('unknown')
        }
      } else {
        setSnapshotFreshness('stale')
        setLoadState('failed')
      }
    } catch {
      setLoadState('failed')
    } finally {
      setLoading(false)
    }
  }, [apiAvailable, workspaceId])

  React.useEffect(() => {
    void refresh()
  }, [refresh])

  React.useEffect(() => {
    setPendingAction(null)
    setAcceptanceFinding(null)
    setSnapshotFreshness('unknown')
  }, [workspaceId])

  const performPendingAction = React.useCallback(async (action: PendingSecurityAction) => {
    if (!workspaceId) return

    const runtimeApi = window.electronAPI?.openclawRuntime
    const auditApi = window.electronAPI?.securityAudit
    if (!apiAvailable || !runtimeApi || !auditApi) {
      setLoadState('unavailable')
      return
    }

    switch (action.kind) {
      case 'install':
        setRuntimeStatus(await window.electronAPI.openclawRuntime.install({ workspaceId }))
        break
      case 'provision':
        setRuntimeStatus(await window.electronAPI.openclawRuntime.provision({ workspaceId }))
        break
      case 'start':
        setRuntimeStatus(await window.electronAPI.openclawRuntime.start({ workspaceId }))
        break
      case 'stop':
        setRuntimeStatus(await window.electronAPI.openclawRuntime.stop({ workspaceId }))
        break
      case 'audit': {
        setAuditRunning(true)
        try {
          const nextSnapshot = await window.electronAPI.securityAudit.run({ workspaceId, mode: action.mode })
          setSnapshot(nextSnapshot)
          setRuntimeStatus(nextSnapshot.runtime)
          setSnapshotFreshness('fresh')
        } catch (error) {
          setSnapshotFreshness('stale')
          throw error
        } finally {
          setAuditRunning(false)
        }
        break
      }
      case 'accept':
        await window.electronAPI.securityAudit.acceptRisk({
          workspaceId,
          fingerprint: action.fingerprint,
          rationale: action.rationale,
          expiresAt: action.expiresAt,
        })
        setSnapshot((previous) =>
          updateFindingAcceptance(previous, action.fingerprint, {
            rationale: action.rationale,
            expiresAt: action.expiresAt,
            expired: false,
          }),
        )
        break
      case 'revoke':
        await window.electronAPI.securityAudit.revokeRiskAcceptance({ workspaceId, fingerprint: action.fingerprint })
        setSnapshot((previous) => updateFindingAcceptance(previous, action.fingerprint, undefined))
        break
      case 'openControlUi': {
        const nativeHostControl = window.openClawHostControl
        if (!nativeHostControl) return
        await nativeHostControl.openControlUi({ workspaceId })
        break
      }
      case 'copySetupCredential': {
        const nativeHostControl = window.openClawHostControl
        if (!nativeHostControl) return
        await nativeHostControl.copyGatewayTokenForSetup({ workspaceId })
        break
      }
    }
  }, [apiAvailable, workspaceId])

  const confirmPendingAction = React.useCallback(async () => {
    const action = pendingAction
    setPendingAction(null)
    if (!action) return

    setBusyAction(action.kind)
    setActionError(false)
    try {
      await runConfirmedSecurityAction(pendingAction, performPendingAction)
    } catch {
      setActionError(true)
    } finally {
      setBusyAction(null)
    }
  }, [pendingAction, performPendingAction])

  const findings = displayedSnapshot?.findings ?? []
  const filteredFindings = filterSecurityFindings(findings, selectedDomain)
  const acceptedCount = findings.filter((finding) => finding.acceptance && !finding.acceptance.expired).length
  const deepCoverage = displayedSnapshot?.coverage.deep ?? 'not-requested'
  const deepCoverageKey = deepCoverage === 'not-requested' ? 'notRequested' : deepCoverage
  const snapshotIsStale = displayedSnapshot !== null && snapshotFreshness === 'stale'
  const snapshotDate = displayedSnapshot ? dateFormatter.format(new Date(displayedSnapshot.completedAt)) : null
  const isBusy = busyAction !== null || auditRunning
  const runtimeState = displayedRuntime?.state
  const canProvision = !runtimeState || !['installing', 'starting', 'running'].includes(runtimeState)
  const canStart = runtimeState ? Boolean(RUNTIME_ACTIONABLE_STATES[runtimeState]) : false
  const canStop = runtimeState === 'running' || runtimeState === 'starting' || runtimeState === 'degraded'
  const confirmationActionKey =
    pendingAction?.kind === 'audit'
      ? pendingAction.mode === 'deep'
        ? 'security.action.deepAudit'
        : 'security.action.audit'
      : pendingAction
        ? {
            install: 'security.action.install',
            provision: 'security.action.provision',
            start: 'security.action.start',
            stop: 'security.action.stop',
            accept: 'security.finding.acceptRisk',
            revoke: 'security.finding.revokeRisk',
            openControlUi: 'security.action.openControlUi',
            copySetupCredential: 'security.action.copySetupCredential',
          }[pendingAction.kind]
        : 'security.action.audit'

  return (
    <div className="flex h-[calc(100dvh-3rem)] min-h-0 flex-col">
      <header className="flex shrink-0 flex-wrap items-start justify-between gap-3 border-b border-border/50 px-6 py-4">
        <div className="min-w-0">
          <h2 className="whitespace-normal break-words text-lg font-semibold">{t('settings.security.title')}</h2>
          <p className="mt-1 whitespace-normal break-words text-sm text-muted-foreground">
            {t('settings.security.description')}
          </p>
        </div>
        <Button size="sm" variant="outline" disabled={loading || !workspaceId || !apiAvailable} onClick={() => void refresh()}>
          {loading ? t('security.loading') : t('security.action.refresh')}
        </Button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div className="mx-auto w-full max-w-5xl space-y-8 px-6 py-5">
          {!workspaceId && (
            <div role="alert" className="rounded-md border border-border px-3 py-2 text-sm text-muted-foreground">
              {t('security.error.noWorkspace')}
            </div>
          )}
          {workspaceId && !apiAvailable && (
            <div role="alert" className="rounded-md border border-destructive/40 px-3 py-2 text-sm text-destructive">
              {t('security.error.apiUnavailable')}
            </div>
          )}
          {loadState === 'failed' && (
            <div role="alert" className="rounded-md border border-destructive/40 px-3 py-2 text-sm text-destructive">
              {t('security.error.loadFailed')}
            </div>
          )}
          {actionError && (
            <div role="alert" className="rounded-md border border-destructive/40 px-3 py-2 text-sm text-destructive">
              {t('security.error.actionFailed')}
            </div>
          )}

          <SettingsSection title={t('security.section.overview')}>
            <SettingsCard className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <div className="rounded-md border border-border/60 p-3">
                  <p className="text-xs text-muted-foreground">{t('security.runtime.label')}</p>
                  <p className="mt-1 text-sm font-medium" aria-live="polite">
                    {loading ? t('security.loading') : t(`security.runtime.state.${displayedRuntime?.state ?? 'unavailable'}`)}
                  </p>
                </div>
                <div className="rounded-md border border-border/60 p-3">
                  <p className="text-xs text-muted-foreground">{t('security.audit.lastRun')}</p>
                  <p className="mt-1 text-sm font-medium">
                    {displayedSnapshot ? dateFormatter.format(new Date(displayedSnapshot.completedAt)) : t('security.audit.none')}
                  </p>
                </div>
                <div className="rounded-md border border-border/60 p-3">
                  <p className="text-xs text-muted-foreground">{t('security.audit.status')}</p>
                  <p className="mt-1 text-sm font-medium" role="status" aria-live="polite" aria-atomic="true">
                    {auditRunning
                      ? t('security.audit.running')
                      : loading && snapshotDate
                        ? t('security.audit.refreshingLastSnapshot', { date: snapshotDate })
                        : snapshotIsStale && snapshotDate
                          ? t('security.audit.stale', { date: snapshotDate })
                          : displayedSnapshot
                            ? t('security.audit.ready')
                            : t('security.audit.none')}
                  </p>
                </div>
              </div>

              {displayedRuntime?.safeError && (
                <p role="alert" className="text-sm text-destructive">
                  {t('security.error.runtimeUnavailable')}
                </p>
              )}
              {displayedSnapshot?.safeError && (
                <p role="alert" className="text-sm text-destructive">
                  {t('security.error.auditUnavailable')}
                </p>
              )}

              <div className="flex flex-wrap gap-2" aria-label={t('security.section.controls')}>
                {(!runtimeState || runtimeState === 'unavailable' || runtimeState === 'unsupported') && (
                  <Button size="sm" disabled={isBusy || !workspaceId || !apiAvailable} onClick={() => setPendingAction({ kind: 'install' })}>
                    {t('security.action.install')}
                  </Button>
                )}
                {canProvision && (
                  <Button size="sm" variant="outline" disabled={isBusy || !workspaceId || !apiAvailable} onClick={() => setPendingAction({ kind: 'provision' })}>
                    {t('security.action.provision')}
                  </Button>
                )}
                {canStart && (
                  <Button size="sm" variant="outline" disabled={isBusy || !workspaceId || !apiAvailable} onClick={() => setPendingAction({ kind: 'start' })}>
                    {t('security.action.start')}
                  </Button>
                )}
                {canStop && (
                  <Button size="sm" variant="outline" disabled={isBusy || !workspaceId || !apiAvailable} onClick={() => setPendingAction({ kind: 'stop' })}>
                    {t('security.action.stop')}
                  </Button>
                )}
                <Button size="sm" variant="outline" disabled={isBusy || !workspaceId || !apiAvailable} onClick={() => setPendingAction({ kind: 'audit', mode: 'standard' })}>
                  {t('security.action.audit')}
                </Button>
                <Button size="sm" variant="outline" disabled={isBusy || !workspaceId || !apiAvailable} onClick={() => setPendingAction({ kind: 'audit', mode: 'deep' })}>
                  {t('security.action.deepAudit')}
                </Button>
              </div>
            </SettingsCard>
          </SettingsSection>

          <SettingsSection title={t('security.section.coverage')}>
            <SettingsCard>
              <dl className="grid gap-3 sm:grid-cols-3">
                <div>
                  <dt className="text-xs text-muted-foreground">{t('security.coverage.craft')}</dt>
                  <dd className="mt-1 text-sm font-medium">
                    {displayedSnapshot ? t(`security.coverage.${displayedSnapshot.coverage.craft}`) : t('security.coverage.notRequested')}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">{t('security.coverage.openclaw')}</dt>
                  <dd className="mt-1 text-sm font-medium">
                    {displayedSnapshot ? t(`security.coverage.${displayedSnapshot.coverage.openclaw}`) : t('security.coverage.notRequested')}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">{t('security.coverage.deep')}</dt>
                  <dd className="mt-1 text-sm font-medium">{t(`security.coverage.${deepCoverageKey}`)}</dd>
                </div>
              </dl>
            </SettingsCard>
          </SettingsSection>

          <SettingsSection title={t('security.section.summary')}>
            <SettingsCard>
              <dl className="grid grid-cols-2 gap-3 sm:grid-cols-5">
                <div><dt className="text-xs text-muted-foreground">{t('security.summary.critical')}</dt><dd className="text-lg font-semibold">{displayedSnapshot?.summary.critical ?? 0}</dd></div>
                <div><dt className="text-xs text-muted-foreground">{t('security.summary.warning')}</dt><dd className="text-lg font-semibold">{displayedSnapshot?.summary.warn ?? 0}</dd></div>
                <div><dt className="text-xs text-muted-foreground">{t('security.summary.info')}</dt><dd className="text-lg font-semibold">{displayedSnapshot?.summary.info ?? 0}</dd></div>
                <div><dt className="text-xs text-muted-foreground">{t('security.summary.accepted')}</dt><dd className="text-lg font-semibold">{acceptedCount}</dd></div>
                <div><dt className="text-xs text-muted-foreground">{t('security.summary.unavailable')}</dt><dd className="text-lg font-semibold">{displayedSnapshot?.summary.unavailable ?? 0}</dd></div>
              </dl>
            </SettingsCard>
          </SettingsSection>

          <SettingsCard className="p-4">
            <SecuritySnake
              domains={displayedSnapshot?.domains ?? []}
              selectedDomain={selectedDomain}
              onSelectDomain={(domain) => setSelectedDomain(domain)}
            />
          </SettingsCard>

          <SettingsSection title={t('security.section.findings')}>
            <SettingsCard className="space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                <label htmlFor="security-domain-filter" className="text-sm font-medium">{t('security.filter.label')}</label>
                <select
                  id="security-domain-filter"
                  className="h-8 rounded-md border border-border bg-background px-2 text-sm"
                  value={selectedDomain ?? 'all'}
                  onChange={(event) => setSelectedDomain(event.target.value === 'all' ? null : event.target.value as SecurityDomain)}
                >
                  <option value="all">{t('security.filter.all')}</option>
                  <option value="ingress">{t('security.snake.domain.ingress')}</option>
                  <option value="sessions">{t('security.snake.domain.sessions')}</option>
                  <option value="tools">{t('security.snake.domain.tools')}</option>
                  <option value="secrets">{t('security.snake.domain.secrets')}</option>
                  <option value="network">{t('security.snake.domain.network')}</option>
                  <option value="extensions">{t('security.snake.domain.extensions')}</option>
                  <option value="isolation">{t('security.snake.domain.isolation')}</option>
                  <option value="other">{t('security.filter.other')}</option>
                </select>
                {selectedDomain && (
                  <Button size="sm" variant="ghost" onClick={() => setSelectedDomain(null)}>
                    {t('security.action.clearFilter')}
                  </Button>
                )}
              </div>

              {!displayedSnapshot && (
                <p role="status" className="text-sm text-muted-foreground">
                  {loading ? t('security.loading') : t('security.audit.none')}
                </p>
              )}
              {displayedSnapshot && filteredFindings.length === 0 && (
                <p role="status" className="text-sm text-muted-foreground">{t('security.finding.empty')}</p>
              )}
              <div className="space-y-3">
                {filteredFindings.map((finding) => {
                  const isSelected = selectedFingerprint === finding.fingerprint
                  const isAdviceVisible = adviceFingerprint === finding.fingerprint
                  const domainLabel = finding.domain === 'other'
                    ? t('security.filter.other')
                    : t(`security.snake.domain.${finding.domain}`)
                  const severityLabel = t(`security.snake.status.${finding.severity}`)
                  const statusLabel = finding.acceptance?.expired
                    ? t('security.finding.statusExpired')
                    : finding.acceptance
                      ? t('security.finding.statusAccepted')
                      : finding.severity === 'unavailable'
                        ? t('security.finding.statusUnavailable')
                        : t('security.finding.statusOpen')

                  return (
                    <article key={finding.fingerprint} className="rounded-md border border-border/60 p-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                          <h3 className="break-words text-sm font-semibold">{finding.title}</h3>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {t('security.finding.check')}: {finding.checkId} · {t('security.finding.source')}: {finding.source === 'craft' ? t('security.finding.sourceCraft') : t('security.finding.sourceOpenClaw')} · {domainLabel} · {severityLabel} · {statusLabel}
                          </p>
                        </div>
                        <Button
                          size="sm"
                          variant="outline"
                          aria-expanded={isSelected}
                          onClick={() => setSelectedFingerprint(isSelected ? null : finding.fingerprint)}
                        >
                          {isSelected ? t('security.finding.hideDetails') : t('security.finding.showDetails')}
                        </Button>
                      </div>

                      {isSelected && (
                        <div className="mt-4 space-y-4 border-t border-border/60 pt-4">
                          <div>
                            <h4 className="text-sm font-medium">{t('security.finding.what')}</h4>
                            <p className="mt-1 whitespace-pre-wrap break-words text-sm text-muted-foreground">{finding.detail}</p>
                          </div>
                          <div>
                            <h4 className="text-sm font-medium">{t('security.finding.why')}</h4>
                            <p className="mt-1 text-sm text-muted-foreground">
                              {t('security.finding.whyDescription', { domain: domainLabel, severity: severityLabel })}
                            </p>
                          </div>
                          <div>
                            <h4 className="text-sm font-medium">{t('security.finding.whatToDo')}</h4>
                            <p className="mt-1 whitespace-pre-wrap break-words text-sm text-muted-foreground">
                              {finding.remediation ?? t('security.finding.fixAdvice')}
                            </p>
                          </div>
                          <p className="text-xs text-muted-foreground">
                            {t('security.finding.detected')}: {dateFormatter.format(new Date(finding.detectedAt))} · {statusLabel}
                            {finding.acceptance && !finding.acceptance.expired ? ` · ${t('security.finding.acceptedUntil', { date: dateFormatter.format(new Date(finding.acceptance.expiresAt)) })}` : ''}
                          </p>
                          {isAdviceVisible && (
                            <p className="rounded-md border border-border/60 bg-muted/30 p-3 text-sm text-muted-foreground">
                              {t('security.finding.fixAdvice')}
                            </p>
                          )}
                          <div className="flex flex-wrap gap-2">
                            <Button size="sm" variant="ghost" onClick={() => setSelectedFingerprint(null)}>
                              {t('security.finding.leave')}
                            </Button>
                            {!finding.acceptance || finding.acceptance.expired ? (
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={isBusy || !apiAvailable}
                                onClick={() => {
                                  setAcceptanceFinding(finding)
                                  setRationale('')
                                  setExpiresOn(getRiskAcceptanceDateLimits().min)
                                }}
                              >
                                {t('security.finding.acceptRisk')}
                              </Button>
                            ) : (
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={isBusy || !apiAvailable}
                                onClick={() => setPendingAction({ kind: 'revoke', fingerprint: finding.fingerprint, checkId: finding.checkId })}
                              >
                                {t('security.finding.revokeRisk')}
                              </Button>
                            )}
                            <Button size="sm" variant="outline" onClick={() => setAdviceFingerprint(isAdviceVisible ? null : finding.fingerprint)}>
                              {t('security.finding.fix')}
                            </Button>
                          </div>
                        </div>
                      )}
                    </article>
                  )
                })}
              </div>
            </SettingsCard>
          </SettingsSection>

          {hostControl && (
            <SettingsSection title={t('security.section.hostControls')}>
              <SettingsCard className="space-y-3">
                <p className="text-sm text-muted-foreground">{t('security.hostControls.description')}</p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={isBusy || !workspaceId || !displayedRuntime || displayedRuntime.state === 'unavailable'}
                    onClick={() => setPendingAction({ kind: 'openControlUi' })}
                  >
                    {t('security.action.openControlUi')}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={isBusy || !workspaceId || !displayedRuntime || displayedRuntime.state === 'unavailable'}
                    onClick={() => setPendingAction({ kind: 'copySetupCredential' })}
                  >
                    {t('security.action.copySetupCredential')}
                  </Button>
                </div>
              </SettingsCard>
            </SettingsSection>
          )}
          {!hostControl && (
            <div role="note" className="rounded-md border border-border px-3 py-3 text-sm text-muted-foreground">
              <p className="font-medium">HOST_ONLY · {t('security.hostOnly.title')}</p>
              <p className="mt-1">{t('security.hostOnly.description')}</p>
            </div>
          )}
        </div>
      </div>

      <Dialog
        open={acceptanceFinding !== null}
        onOpenChange={(open) => {
          if (!open) setAcceptanceFinding(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('security.acceptance.title')}</DialogTitle>
            <DialogDescription>{t('security.acceptance.description')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <label htmlFor="security-risk-rationale" className="text-sm font-medium">{t('security.acceptance.rationale')}</label>
              <Textarea
                id="security-risk-rationale"
                value={rationale}
                maxLength={RISK_ACCEPTANCE_MAX_CODE_POINTS * 2}
                onChange={(event) => setRationale(event.target.value)}
                aria-invalid={rationale.length > 0 && (acceptanceValidation.rationaleCodePoints < 10 || acceptanceValidation.rationaleCodePoints > 500)}
              />
              <p className="text-xs text-muted-foreground">
                {t('security.acceptance.rationaleHint', { count: acceptanceValidation.rationaleCodePoints })}
              </p>
            </div>
            <div className="space-y-2">
              <label htmlFor="security-risk-expiry" className="text-sm font-medium">{t('security.acceptance.expiry')}</label>
              <Input
                id="security-risk-expiry"
                type="date"
                min={dateLimits.min}
                max={dateLimits.max}
                value={expiresOn}
                onChange={(event) => setExpiresOn(event.target.value)}
                aria-invalid={expiresOn.length > 0 && acceptanceValidation.calendarDays === null}
              />
              <p className="text-xs text-muted-foreground">{t('security.acceptance.expiryHint')}</p>
              {acceptanceValidation.valid && acceptanceValidation.expiresAt !== null && (
                <p className="text-xs font-medium">{t('security.acceptance.expiresAt', { date: dateFormatter.format(new Date(acceptanceValidation.expiresAt)) })}</p>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAcceptanceFinding(null)}>{t('common.cancel')}</Button>
            <Button
              disabled={!acceptanceFinding || !acceptanceValidation.valid || acceptanceValidation.expiresAt === null}
              onClick={() => {
                if (!acceptanceFinding || !acceptanceValidation.valid || acceptanceValidation.expiresAt === null) return
                setPendingAction({
                  kind: 'accept',
                  fingerprint: acceptanceFinding.fingerprint,
                  checkId: acceptanceFinding.checkId,
                  rationale: acceptanceValidation.rationale,
                  expiresAt: acceptanceValidation.expiresAt,
                })
                setAcceptanceFinding(null)
              }}
            >
              {t('security.finding.acceptRisk')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={pendingAction !== null}
        onOpenChange={(open) => {
          if (!open) setPendingAction(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('security.confirm.title', { action: t(confirmationActionKey) })}</DialogTitle>
            <DialogDescription>
              {t('security.confirm.scope', {
                action: t(confirmationActionKey),
                workspace: activeWorkspace?.name ?? t('security.confirm.currentWorkspace'),
              })}
            </DialogDescription>
          </DialogHeader>
          {pendingAction?.kind === 'accept' && (
            <p className="text-sm text-muted-foreground">
              {t('security.confirm.expiry', { date: dateFormatter.format(new Date(pendingAction.expiresAt)) })}
            </p>
          )}
          {(pendingAction?.kind === 'accept' || pendingAction?.kind === 'revoke') && (
            <p className="text-sm text-muted-foreground">
              {t('security.confirm.finding', { checkId: pendingAction.checkId })}
            </p>
          )}
          {pendingAction?.kind === 'copySetupCredential' && (
            <p className="text-sm text-muted-foreground">{t('security.confirm.copySetupCredential')}</p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingAction(null)}>{t('common.cancel')}</Button>
            <Button disabled={busyAction !== null} onClick={() => void confirmPendingAction()}>
              {t(confirmationActionKey)}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
