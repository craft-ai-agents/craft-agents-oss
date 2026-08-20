/**
 * AccountsSettingsPage — profile, service connections, Notes, and security.
 *
 * The Notes section is the sole owner of its cloud connection. Generic service
 * connections deliberately exclude Notes providers so users never see the same
 * connection represented twice.
 */

import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import type { DetailsPageMeta } from '@/lib/navigation-registry'
import { SettingsCard, SettingsRow, SettingsSection } from '@/components/settings'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useActiveWorkspace } from '@/context/AppShellContext'
import type {
  CredentialHealthStatus,
  IdentityState,
  ServiceConnection,
  ServiceProvider,
} from '../../../shared/types'
import { navigate, routes } from '@/lib/navigate'

export const meta: DetailsPageMeta = {
  navigator: 'settings',
  slug: 'accounts',
}

const STATUS_TONE: Record<ServiceConnection['status'], string> = {
  connected: 'text-success',
  syncing: 'text-accent',
  expired: 'text-warning',
  error: 'text-destructive',
  disconnected: 'text-muted-foreground',
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function providerLabel(provider: ServiceProvider | string, t: (k: string) => string): string {
  const key = `settings.accounts.provider.${provider}`
  const translated = t(key)
  return translated === key ? String(provider) : translated
}


export default function AccountsSettingsPage() {
  const { t } = useTranslation()
  const activeWorkspace = useActiveWorkspace()
  const workspaceId = activeWorkspace?.id

  const [state, setState] = React.useState<IdentityState | null>(null)
  const [displayName, setDisplayName] = React.useState('')
  const [savingProfile, setSavingProfile] = React.useState(false)
  const [health, setHealth] = React.useState<CredentialHealthStatus | null>(null)
  const [checkingHealth, setCheckingHealth] = React.useState(false)
  const [connecting, setConnecting] = React.useState(false)
  const [cloudLabel, setCloudLabel] = React.useState('')
  const [cloudToken, setCloudToken] = React.useState('')
  const [cloudFormOpen, setCloudFormOpen] = React.useState(false)
  const [busyId, setBusyId] = React.useState<string | null>(null)

  const load = React.useCallback(async () => {
    try {
      const next = await window.electronAPI.identityGetState(
        workspaceId ? { workspaceId } : undefined,
      )
      setState(next)
      setDisplayName(next.profile.displayName)
    } catch (error) {
      toast.error(t('settings.accounts.loadFailed', { message: errorMessage(error) }))
    }
  }, [t, workspaceId])

  React.useEffect(() => {
    void load()
    const unsub = window.electronAPI.onIdentityChanged?.(() => {
      void load()
    })
    return () => {
      unsub?.()
    }
  }, [load])

  const runHealthCheck = React.useCallback(async () => {
    setCheckingHealth(true)
    try {
      const result = await window.electronAPI.getCredentialHealth()
      setHealth(result)
    } catch (error) {
      toast.error(t('settings.accounts.healthFailed', { message: errorMessage(error) }))
    } finally {
      setCheckingHealth(false)
    }
  }, [t])

  React.useEffect(() => {
    void runHealthCheck()
  }, [runHealthCheck])

  const handleSaveProfile = async () => {
    const trimmed = displayName.trim()
    if (!trimmed) return
    setSavingProfile(true)
    try {
      const next = await window.electronAPI.identityUpdateProfile({ displayName: trimmed })
      setState(next)
      toast.success(t('settings.accounts.profileSaved'))
    } catch (error) {
      toast.error(t('settings.accounts.profileSaveFailed', { message: errorMessage(error) }))
    } finally {
      setSavingProfile(false)
    }
  }

  const handleConnectCloud = async () => {
    if (!workspaceId) {
      toast.error(t('settings.accounts.noWorkspace'))
      return
    }
    const token = cloudToken.trim()
    if (!token) {
      toast.error(t('settings.accounts.tokenRequired'))
      return
    }
    setConnecting(true)
    try {
      const next = await window.electronAPI.identityConnect({
        provider: 'siyuan-cloud',
        workspaceId,
        accountLabel: cloudLabel.trim() || undefined,
        credentialValue: token,
        connectionId: 'svc-siyuan-cloud',
      })
      setState(next)
      setCloudToken('')
      setCloudFormOpen(false)
      toast.success(t('settings.accounts.connected'))
    } catch {
      setCloudToken('')
      toast.error(t('settings.accounts.connectFailed', { message: t('common.failed') }))
    } finally {
      setConnecting(false)
    }
  }

  const handleDisconnect = async (connectionId: string) => {
    setBusyId(connectionId)
    try {
      const next = await window.electronAPI.identityDisconnect({ connectionId })
      setState(next)
      toast.success(t('settings.accounts.disconnected'))
    } catch (error) {
      toast.error(t('settings.accounts.disconnectFailed', { message: errorMessage(error) }))
    } finally {
      setBusyId(null)
    }
  }

  const handleRefresh = async () => {
    try {
      const next = await window.electronAPI.identityRefreshStatus(
        workspaceId ? { workspaceId } : undefined,
      )
      setState(next)
    } catch (error) {
      toast.error(t('settings.accounts.refreshFailed', { message: errorMessage(error) }))
    }
  }

  const handleReset = async () => {
    try {
      const confirmed = await window.electronAPI.showLogoutConfirmation()
      if (!confirmed) return
      await window.electronAPI.logout()
      toast.success(t('settings.accounts.resetDone'))
      void load()
      void runHealthCheck()
    } catch (error) {
      toast.error(t('settings.accounts.resetFailed', { message: errorMessage(error) }))
    }
  }

  const connections = state?.connections ?? []
  const genericConnections = connections.filter(
    (connection) => connection.provider !== 'siyuan-cloud' && connection.provider !== 'siyuan-local',
  )
  const owned = genericConnections.filter((connection) => !connection.readOnly)
  const reflections = genericConnections.filter((connection) => connection.readOnly)
  const notesCloud = connections.find(
    (connection) => connection.provider === 'siyuan-cloud' && !connection.readOnly,
  )
  const notesLocal = connections.find((connection) => connection.provider === 'siyuan-local')
  const entitlement = state?.entitlements.find(
    (item) => item.provider === 'siyuan-cloud' && item.product === 'cloud-sync',
  )

  const healthOk = health ? health.healthy : null
  const issueCount = health?.issues?.length ?? 0

  return (
    <div className="flex h-full flex-col">
      <div className="px-6 py-4 border-b border-border/60">
        <h1 className="text-lg font-semibold">{t('settings.accounts.title')}</h1>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
        {/* PROFILE */}
        <SettingsSection title={t('settings.accounts.profileSection')}>
          <SettingsCard>
            <SettingsRow
              label={t('settings.accounts.displayName')}
            >
              <div className="flex items-center gap-2 min-w-[240px]">
                <Input
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  className="h-8"
                  aria-label={t('settings.accounts.displayName')}
                />
                <Button
                  size="sm"
                  onClick={() => void handleSaveProfile()}
                  disabled={savingProfile || !displayName.trim()}
                >
                  {t('common.save')}
                </Button>
              </div>
            </SettingsRow>
          </SettingsCard>
        </SettingsSection>

        {genericConnections.length > 0 && (
          <SettingsSection
            title={t('settings.accounts.connectionsSection')}
            action={
              <Button variant="ghost" size="sm" onClick={() => void handleRefresh()}>
                {t('settings.accounts.refresh')}
              </Button>
            }
          >
            <SettingsCard>
              {owned.map((conn) => (
                <SettingsRow
                  key={conn.id}
                  label={providerLabel(conn.provider, t)}
                  description={
                    conn.accountLabel
                      ? `${conn.accountLabel} · ${t(`settings.accounts.status.${conn.status}`)}`
                      : t(`settings.accounts.status.${conn.status}`)
                  }
                >
                  <div className="flex items-center gap-2">
                    <span className={`text-xs ${STATUS_TONE[conn.status]}`}>
                      {t(`settings.accounts.status.${conn.status}`)}
                    </span>
                    {conn.status !== 'disconnected' && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busyId === conn.id}
                        onClick={() => void handleDisconnect(conn.id)}
                      >
                        {t('settings.accounts.signOut')}
                      </Button>
                    )}
                  </div>
                </SettingsRow>
              ))}
              {reflections.map((conn) => {
                const managedLabel = t('settings.accounts.managedInAi')
                return (
                  <SettingsRow
                    key={conn.id}
                    label={providerLabel(conn.provider, t)}
                    description={
                      conn.accountLabel
                        ? `${conn.accountLabel} · ${managedLabel}`
                        : managedLabel
                    }
                  >
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => navigate(routes.view.settings('ai'))}
                    >
                      {t('settings.accounts.openAiSettings')}
                    </Button>
                  </SettingsRow>
                )
              })}
            </SettingsCard>
          </SettingsSection>
        )}

        {/* NOTES — sole owner of Notes connection presentation */}
        <SettingsSection title={t('sidebar.notes')}>
          <SettingsCard>
            {notesLocal && (
              <SettingsRow
                label={t('sidebar.notes')}
                description={
                  notesLocal.readOnly
                    ? t('settings.accounts.managedInKnowledge')
                    : t(`settings.accounts.status.${notesLocal.status}`)
                }
              >
                {notesLocal.readOnly ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => navigate(routes.view.settings('knowledge'))}
                  >
                    {t('settings.accounts.openKnowledgeSettings')}
                  </Button>
                ) : (
                  <div className="flex items-center gap-2">
                    <span className={`text-xs ${STATUS_TONE[notesLocal.status]}`}>
                      {t(`settings.accounts.status.${notesLocal.status}`)}
                    </span>
                    {notesLocal.status !== 'disconnected' && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busyId === notesLocal.id}
                        onClick={() => void handleDisconnect(notesLocal.id)}
                      >
                        {t('settings.accounts.signOut')}
                      </Button>
                    )}
                  </div>
                )}
              </SettingsRow>
            )}

            <SettingsRow label={t('settings.accounts.account')}>
              <span className="text-sm text-muted-foreground">
                {notesCloud?.accountLabel || t('settings.accounts.notConnected')}
              </span>
            </SettingsRow>

            <SettingsRow label={t('settings.accounts.syncStatus')}>
              <span
                className={`text-sm ${notesCloud ? STATUS_TONE[notesCloud.status] : 'text-muted-foreground'}`}
              >
                {notesCloud
                  ? t(`settings.accounts.status.${notesCloud.status}`)
                  : t('settings.accounts.status.disconnected')}
              </span>
            </SettingsRow>
            {entitlement && (
              <SettingsRow label={t('settings.accounts.subscription')}>
                <span className="text-sm text-muted-foreground">
                  {t(`settings.accounts.entitlement.${entitlement.status}`, {
                    product: entitlement.product,
                  })}
                </span>
              </SettingsRow>
            )}

            {(!notesCloud || notesCloud.status === 'disconnected' || cloudFormOpen) && (
              <div className="px-4 py-3 space-y-2 border-t border-border/40">
                <div className="text-xs font-medium text-muted-foreground">
                  {cloudFormOpen && notesCloud && notesCloud.status !== 'disconnected'
                    ? t('settings.accounts.reconnect')
                    : t('settings.accounts.connect')}
                </div>
                <Input
                  placeholder={t('settings.accounts.accountLabelPlaceholder')}
                  value={cloudLabel}
                  onChange={(e) => setCloudLabel(e.target.value)}
                  className="h-8"
                />
                <Input
                  placeholder={t('settings.accounts.tokenPlaceholder')}
                  value={cloudToken}
                  onChange={(e) => setCloudToken(e.target.value)}
                  type="password"
                  className="h-8"
                />
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    onClick={() => void handleConnectCloud()}
                    disabled={connecting || !workspaceId || !cloudToken.trim()}
                  >
                    {cloudFormOpen && notesCloud && notesCloud.status !== 'disconnected'
                      ? t('settings.accounts.reconnect')
                      : t('settings.accounts.connect')}
                  </Button>
                  {cloudFormOpen && notesCloud && notesCloud.status !== 'disconnected' && (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={connecting}
                      onClick={() => {
                        setCloudFormOpen(false)
                        setCloudToken('')
                      }}
                    >
                      {t('common.cancel')}
                    </Button>
                  )}
                </div>
              </div>
            )}

            {notesCloud && notesCloud.status !== 'disconnected' && !cloudFormOpen && (
              <div className="px-4 py-3 flex gap-2 border-t border-border/40">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setCloudLabel(notesCloud.accountLabel || '')
                    setCloudToken('')
                    setCloudFormOpen(true)
                  }}
                  disabled={connecting}
                >
                  {t('settings.accounts.reconnect')}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busyId === notesCloud.id}
                  onClick={() => void handleDisconnect(notesCloud.id)}
                >
                  {t('settings.accounts.signOut')}
                </Button>
              </div>
            )}
          </SettingsCard>
        </SettingsSection>

        {/* ACCOUNT & SECURITY */}
        <SettingsSection title={t('settings.accounts.securitySection')}>
          <SettingsCard>
            <SettingsRow
              label={t('settings.accounts.credentialHealth')}
              description={
                health
                  ? t('settings.accounts.healthSummary', {
                      status: healthOk ? t('settings.accounts.healthOk') : t('settings.accounts.healthIssues'),
                      count: issueCount,
                    })
                  : t('settings.accounts.healthUnknown')
              }
            >
              <Button
                size="sm"
                variant="outline"
                disabled={checkingHealth}
                onClick={() => void runHealthCheck()}
              >
                {t('settings.accounts.runHealthCheck')}
              </Button>
            </SettingsRow>
            <SettingsRow
              label={t('settings.accounts.resetAppData')}
              description={t('settings.accounts.resetAppDataDesc')}
            >
              <Button size="sm" variant="destructive" onClick={() => void handleReset()}>
                {t('settings.accounts.resetAppData')}
              </Button>
            </SettingsRow>
          </SettingsCard>
        </SettingsSection>
      </div>
    </div>
  )
}
