/**
 * CloudSyncSettingsPage
 *
 * Push/pull workspace data to/from Cloudflare R2.
 * Uses a sync token for credential-free cross-device sync.
 *
 * States:
 * - Disconnected: generate or import token
 * - Token just generated: show raw token with copy button
 * - Connected: push/pull buttons, timestamps, disconnect
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { PanelHeader } from '@/components/app-shell/PanelHeader'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Button } from '@/components/ui/button'
import { HeaderMenu } from '@/components/ui/HeaderMenu'
import { routes } from '@/lib/navigate'
import { useAppShellContext } from '@/context/AppShellContext'
import { useLocale } from '@/context/LocaleContext'
import type { DetailsPageMeta } from '@/lib/navigation-registry'
import type { SyncStatus, SyncProgress, SyncResult, PullPreview } from '@g4os/shared/cloud-sync'

import {
  SettingsSection,
  SettingsCard,
  SettingsRow,
} from '@/components/settings'

export const meta: DetailsPageMeta = {
  navigator: 'settings',
  slug: 'sync',
}

function formatDate(ts: number | null, neverLabel: string = 'Never'): string {
  if (!ts) return neverLabel
  return new Date(ts).toLocaleString()
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export default function CloudSyncSettingsPage() {
  const appShellContext = useAppShellContext()
  const { t } = useLocale()
  const activeWorkspaceId = appShellContext.activeWorkspaceId

  // State
  const [status, setStatus] = useState<SyncStatus | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [newToken, setNewToken] = useState<string | null>(null)
  const [importToken, setImportToken] = useState('')
  const [importError, setImportError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [progress, setProgress] = useState<SyncProgress | null>(null)
  const [pullPreview, setPullPreview] = useState<PullPreview | null>(null)
  const [lastResult, setLastResult] = useState<SyncResult | null>(null)
  const cleanupRef = useRef<(() => void) | null>(null)

  // Load sync status
  const loadStatus = useCallback(async () => {
    if (!window.electronAPI || !activeWorkspaceId) {
      setIsLoading(false)
      return
    }
    setIsLoading(true)
    try {
      const s = await window.electronAPI.getSyncStatus(activeWorkspaceId)
      setStatus(s)
    } catch (err) {
      console.error('Failed to load sync status:', err)
    } finally {
      setIsLoading(false)
    }
  }, [activeWorkspaceId])

  useEffect(() => {
    loadStatus()
  }, [loadStatus])

  // Listen for progress events
  useEffect(() => {
    if (!window.electronAPI) return
    const cleanup = window.electronAPI.onSyncProgress((p: SyncProgress) => {
      setProgress(p)
      if (p.phase === 'done' || p.phase === 'error') {
        // Clear progress after a delay
        setTimeout(() => setProgress(null), 2000)
      }
    })
    cleanupRef.current = cleanup
    return () => { cleanup() }
  }, [])

  // Generate token
  const handleGenerateToken = useCallback(async () => {
    if (!window.electronAPI || !activeWorkspaceId) return
    try {
      const token = await window.electronAPI.generateSyncToken(activeWorkspaceId)
      setNewToken(token)
      await loadStatus()
    } catch (err) {
      console.error('Failed to generate token:', err)
    }
  }, [activeWorkspaceId, loadStatus])

  // Import token
  const handleImportToken = useCallback(async () => {
    if (!window.electronAPI || !activeWorkspaceId || !importToken.trim()) return
    setImportError(null)
    try {
      const result = await window.electronAPI.setSyncToken(activeWorkspaceId, importToken.trim())
      if (result.success) {
        setImportToken('')
        await loadStatus()
      } else {
        setImportError(result.error || 'Failed to import token')
      }
    } catch (err) {
      setImportError(err instanceof Error ? err.message : String(err))
    }
  }, [activeWorkspaceId, importToken, loadStatus])

  // Disconnect
  const handleDisconnect = useCallback(async () => {
    if (!window.electronAPI || !activeWorkspaceId) return
    try {
      await window.electronAPI.disconnectSync(activeWorkspaceId)
      setNewToken(null)
      setLastResult(null)
      setPullPreview(null)
      await loadStatus()
    } catch (err) {
      console.error('Failed to disconnect:', err)
    }
  }, [activeWorkspaceId, loadStatus])

  // Push
  const handlePush = useCallback(async () => {
    if (!window.electronAPI || !activeWorkspaceId) return
    setLastResult(null)
    try {
      const result = await window.electronAPI.pushSync(activeWorkspaceId)
      setLastResult(result)
      await loadStatus()
    } catch (err) {
      setLastResult({ success: false, error: err instanceof Error ? err.message : String(err), filesTransferred: 0, filesDeleted: 0, bytesTransferred: 0, durationMs: 0 })
    }
  }, [activeWorkspaceId, loadStatus])

  // Pull preview
  const handlePullPreview = useCallback(async () => {
    if (!window.electronAPI || !activeWorkspaceId) return
    setPullPreview(null)
    try {
      const preview = await window.electronAPI.getPullPreview(activeWorkspaceId)
      setPullPreview(preview)
    } catch (err) {
      setLastResult({ success: false, error: err instanceof Error ? err.message : String(err), filesTransferred: 0, filesDeleted: 0, bytesTransferred: 0, durationMs: 0 })
    }
  }, [activeWorkspaceId])

  // Pull (confirmed)
  const handlePull = useCallback(async () => {
    if (!window.electronAPI || !activeWorkspaceId) return
    setPullPreview(null)
    setLastResult(null)
    try {
      const result = await window.electronAPI.pullSync(activeWorkspaceId)
      setLastResult(result)
      await loadStatus()
    } catch (err) {
      setLastResult({ success: false, error: err instanceof Error ? err.message : String(err), filesTransferred: 0, filesDeleted: 0, bytesTransferred: 0, durationMs: 0 })
    }
  }, [activeWorkspaceId, loadStatus])

  // Copy token
  const handleCopy = useCallback(async () => {
    if (!newToken) return
    await navigator.clipboard.writeText(newToken)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }, [newToken])

  // No workspace
  if (!activeWorkspaceId) {
    return (
      <div className="flex flex-col h-full">
        <PanelHeader title={t('settings.sync.title')} actions={<HeaderMenu route={routes.view.settings('sync')} />} />
        <div className="flex items-center justify-center flex-1">
          <p className="text-sm text-muted-foreground">{t('settings.sync.noWorkspace')}</p>
        </div>
      </div>
    )
  }

  const isSyncing = progress && progress.phase !== 'done' && progress.phase !== 'error'

  return (
    <div className="flex flex-col h-full">
      <PanelHeader title={t('settings.sync.title')} actions={<HeaderMenu route={routes.view.settings('sync')} />} />
      <ScrollArea className="flex-1">
        <div className="p-6 space-y-6 max-w-xl">

          {/* Token just generated - show it */}
          {newToken && (
            <SettingsSection title={t('settings.sync.section.yourToken')}>
              <SettingsCard>
                <div className="p-4 space-y-3">
                  <p className="text-xs text-amber-500 font-medium">
                    {t('settings.sync.tokenWarning')}
                  </p>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 text-xs bg-muted px-3 py-2 rounded font-mono break-all select-all">
                      {newToken}
                    </code>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={handleCopy}
                    >
                      {copied ? t('settings.sync.copied') : t('settings.sync.copy')}
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {t('settings.sync.tokenHint')}
                  </p>
                  <Button size="sm" variant="ghost" onClick={() => setNewToken(null)}>
                    {t('settings.sync.dismiss')}
                  </Button>
                </div>
              </SettingsCard>
            </SettingsSection>
          )}

          {/* Progress indicator */}
          {isSyncing && progress && (
            <SettingsSection title={t('settings.sync.syncing')}>
              <SettingsCard>
                <div className="p-4 space-y-2">
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span className="capitalize">{progress.phase}</span>
                    <span>
                      {progress.processedFiles}/{progress.totalFiles} files
                    </span>
                  </div>
                  <div className="w-full h-1.5 bg-muted rounded-full overflow-hidden">
                    <div
                      className="h-full bg-accent transition-all duration-300"
                      style={{
                        width: progress.totalFiles > 0
                          ? `${(progress.processedFiles / progress.totalFiles) * 100}%`
                          : '0%',
                      }}
                    />
                  </div>
                  {progress.currentFile && (
                    <p className="text-xs text-muted-foreground truncate">{progress.currentFile}</p>
                  )}
                </div>
              </SettingsCard>
            </SettingsSection>
          )}

          {/* Result toast */}
          {lastResult && (
            <SettingsSection title={lastResult.success ? t('settings.sync.syncComplete') : t('settings.sync.syncFailed')}>
              <SettingsCard>
                <div className="p-4">
                  {lastResult.success ? (
                    <p className="text-xs text-muted-foreground">
                      {lastResult.filesTransferred} files transferred ({formatBytes(lastResult.bytesTransferred)})
                      {lastResult.filesDeleted > 0 && `, ${lastResult.filesDeleted} deleted`}
                      {' '}in {(lastResult.durationMs / 1000).toFixed(1)}s
                    </p>
                  ) : (
                    <p className="text-xs text-destructive">{lastResult.error}</p>
                  )}
                </div>
              </SettingsCard>
            </SettingsSection>
          )}

          {/* Pull preview confirmation */}
          {pullPreview && (
            <SettingsSection title={t('settings.sync.pullPreview')}>
              <SettingsCard>
                <div className="p-4 space-y-3">
                  <p className="text-xs text-muted-foreground">
                    From <strong>{pullPreview.remotePushedFrom}</strong> on {formatDate(pullPreview.remotePushedAt, t('settings.sync.never'))}
                  </p>
                  <div className="text-xs space-y-1">
                    {pullPreview.added > 0 && <p className="text-green-500">{pullPreview.added} {t('settings.sync.newFiles')}</p>}
                    {pullPreview.modified > 0 && <p className="text-amber-500">{pullPreview.modified} {t('settings.sync.modifiedFiles')}</p>}
                    {pullPreview.deleted > 0 && <p className="text-destructive">{pullPreview.deleted} {t('settings.sync.filesToDelete')}</p>}
                    {pullPreview.added === 0 && pullPreview.modified === 0 && pullPreview.deleted === 0 && (
                      <p>{t('settings.sync.upToDate')}</p>
                    )}
                  </div>
                  {(pullPreview.added > 0 || pullPreview.modified > 0 || pullPreview.deleted > 0) && (
                    <>
                      <p className="text-xs text-amber-500">{t('settings.sync.overwriteWarning')}</p>
                      <div className="flex gap-2">
                        <Button size="sm" variant="default" onClick={handlePull} disabled={!!isSyncing}>
                          {t('settings.sync.confirmPull')}
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setPullPreview(null)}>
                          {t('settings.sync.cancel')}
                        </Button>
                      </div>
                    </>
                  )}
                </div>
              </SettingsCard>
            </SettingsSection>
          )}

          {/* Main section: Disconnected or Connected */}
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <p className="text-sm text-muted-foreground">{t('settings.sync.loading')}</p>
            </div>
          ) : !status?.connected ? (
            // Disconnected state
            <SettingsSection title={t('settings.sync.section.connect')} description={t('settings.sync.section.connect.description')}>
              <SettingsCard>
                <div className="p-4 space-y-4">
                  <Button onClick={handleGenerateToken} size="sm" variant="default">
                    {t('settings.sync.generateToken')}
                  </Button>

                  <div className="border-t border-border pt-4 space-y-2">
                    <p className="text-xs text-muted-foreground">{t('settings.sync.importHint')}</p>
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        value={importToken}
                        onChange={e => { setImportToken(e.target.value); setImportError(null) }}
                        placeholder="g4sync_..."
                        className="flex-1 text-xs bg-muted px-3 py-2 rounded font-mono border border-border focus:outline-none focus:ring-1 focus:ring-accent"
                      />
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={handleImportToken}
                        disabled={!importToken.trim()}
                      >
                        {t('settings.sync.import')}
                      </Button>
                    </div>
                    {importError && (
                      <p className="text-xs text-destructive">{importError}</p>
                    )}
                  </div>
                </div>
              </SettingsCard>
            </SettingsSection>
          ) : (
            // Connected state
            <>
              <SettingsSection title={t('settings.sync.section.status')}>
                <SettingsCard>
                  <SettingsRow label={t('settings.sync.token')} description={`g4sync_${'*'.repeat(28)}`} />
                  <SettingsRow label={t('settings.sync.lastPushed')}>
                    <span className="text-xs">{formatDate(status.lastPushedAt, t('settings.sync.never'))}</span>
                  </SettingsRow>
                  <SettingsRow label={t('settings.sync.lastPulled')}>
                    <span className="text-xs">{formatDate(status.lastPulledAt, t('settings.sync.never'))}</span>
                  </SettingsRow>
                </SettingsCard>
              </SettingsSection>

              <SettingsSection title={t('settings.sync.section.actions')}>
                <SettingsCard>
                  <div className="p-4 flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant="default"
                      onClick={handlePush}
                      disabled={!!isSyncing}
                    >
                      {t('settings.sync.pushToCloud')}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={handlePullPreview}
                      disabled={!!isSyncing}
                    >
                      {t('settings.sync.pullFromCloud')}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-destructive"
                      onClick={handleDisconnect}
                      disabled={!!isSyncing}
                    >
                      {t('settings.sync.disconnect')}
                    </Button>
                  </div>
                </SettingsCard>
              </SettingsSection>
            </>
          )}

          {/* Info section */}
          <SettingsSection title={t('settings.sync.section.about')}>
            <SettingsCard>
              <div className="p-4 space-y-2 text-xs text-muted-foreground">
                <p>{t('settings.sync.aboutLine1')}</p>
                <p>{t('settings.sync.aboutLine2')}</p>
                <p>{t('settings.sync.aboutLine3')}</p>
              </div>
            </SettingsCard>
          </SettingsSection>

        </div>
      </ScrollArea>
    </div>
  )
}
