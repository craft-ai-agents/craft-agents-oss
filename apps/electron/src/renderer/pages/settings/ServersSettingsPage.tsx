import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertCircle, CheckCircle2, Plus, ServerCrash, Trash2 } from 'lucide-react'
import { PanelHeader } from '@/components/app-shell/PanelHeader'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Button } from '@/components/ui/button'
import { HeaderMenu } from '@/components/ui/HeaderMenu'
import { routes } from '@/lib/navigate'
import type { DetailsPageMeta } from '@/lib/navigation-registry'
import type { RemoteServerProfile, RemoteServerRuntimeState } from '../../../shared/types'
import {
  SettingsSection,
  SettingsCard,
  SettingsCardContent,
  SettingsCardFooter,
  SettingsInput,
  SettingsSecretInput,
  SettingsToggle,
} from '@/components/settings'

export const meta: DetailsPageMeta = {
  navigator: 'settings',
  slug: 'servers',
}

interface ServerDraft {
  id?: string
  name: string
  url: string
  enabled: boolean
  allowInsecureWs: boolean
  token: string
  clearToken: boolean
}

const EMPTY_DRAFT: ServerDraft = {
  name: '',
  url: '',
  enabled: true,
  allowInsecureWs: false,
  token: '',
  clearToken: false,
}

function isLocalhostHostname(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1'
}

function requiresInsecureWsOptIn(url: string): boolean {
  try {
    const parsed = new URL(url.trim())
    return parsed.protocol === 'ws:' && !isLocalhostHostname(parsed.hostname)
  } catch {
    return false
  }
}

function validateServerUrl(url: string): string | undefined {
  const trimmed = url.trim()
  if (!trimmed) return 'Server URL is required'

  try {
    const parsed = new URL(trimmed)
    if (parsed.protocol !== 'ws:' && parsed.protocol !== 'wss:') {
      return 'Use ws:// or wss://'
    }
  } catch {
    return 'Invalid URL format'
  }

  return undefined
}

function StatusBadge({ runtime }: { runtime?: RemoteServerRuntimeState }) {
  const status = runtime?.status ?? 'idle'
  const cls = status === 'connected'
    ? 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-300'
    : status === 'connecting' || status === 'reconnecting'
      ? 'bg-blue-500/12 text-blue-700 dark:text-blue-300'
      : status === 'failed' || status === 'disconnected'
        ? 'bg-destructive/12 text-destructive'
        : 'bg-muted text-muted-foreground'

  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}>
      {status}
    </span>
  )
}

function RemoteServerCard({
  title,
  profile,
  runtime,
  isNew = false,
  onSaved,
  onDeleted,
  onCancelNew,
}: {
  title: string
  profile?: RemoteServerProfile
  runtime?: RemoteServerRuntimeState
  isNew?: boolean
  onSaved: () => Promise<void>
  onDeleted?: () => Promise<void>
  onCancelNew?: () => void
}) {
  const [draft, setDraft] = useState<ServerDraft>(() => ({
    id: profile?.id,
    name: profile?.name ?? '',
    url: profile?.url ?? '',
    enabled: profile?.enabled ?? true,
    allowInsecureWs: profile?.allowInsecureWs ?? false,
    token: '',
    clearToken: false,
  }))
  const [isSaving, setIsSaving] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [error, setError] = useState<string | undefined>()

  useEffect(() => {
    setDraft({
      id: profile?.id,
      name: profile?.name ?? '',
      url: profile?.url ?? '',
      enabled: profile?.enabled ?? true,
      allowInsecureWs: profile?.allowInsecureWs ?? false,
      token: '',
      clearToken: false,
    })
  }, [profile?.id, profile?.name, profile?.url, profile?.enabled, profile?.allowInsecureWs])

  const urlError = useMemo(() => validateServerUrl(draft.url), [draft.url])
  const needsInsecureWsOptIn = useMemo(
    () => requiresInsecureWsOptIn(draft.url),
    [draft.url],
  )
  const canSave = draft.name.trim().length > 0 && !urlError && (!needsInsecureWsOptIn || draft.allowInsecureWs)

  const handleSave = useCallback(async () => {
    if (!canSave) {
      setError(urlError ?? 'Server name is required')
      return
    }

    setIsSaving(true)
    setError(undefined)
    try {
      const saved = await window.electronAPI.saveRemoteServerProfile({
        id: draft.id,
        name: draft.name.trim(),
        url: draft.url.trim(),
        enabled: draft.enabled,
        allowInsecureWs: draft.allowInsecureWs,
      })

      if (draft.clearToken && saved.hasToken) {
        await window.electronAPI.clearRemoteServerToken(saved.id)
      }
      if (draft.token.trim()) {
        await window.electronAPI.saveRemoteServerToken(saved.id, draft.token.trim())
      }

      await onSaved()
      if (isNew) {
        setDraft(EMPTY_DRAFT)
        onCancelNew?.()
      } else {
        setDraft((prev) => ({ ...prev, id: saved.id, token: '', clearToken: false }))
      }
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Failed to save server')
    } finally {
      setIsSaving(false)
    }
  }, [canSave, draft, isNew, onCancelNew, onSaved, urlError])

  const handleDelete = useCallback(async () => {
    if (!profile?.id || !onDeleted) return
    setIsDeleting(true)
    setError(undefined)
    try {
      await window.electronAPI.deleteRemoteServerProfile(profile.id)
      await onDeleted()
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : 'Failed to delete server')
    } finally {
      setIsDeleting(false)
    }
  }, [onDeleted, profile?.id])

  return (
    <SettingsCard divided={false}>
      <SettingsCardContent className="space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-medium">{title}</h3>
              {!isNew && <StatusBadge runtime={runtime} />}
            </div>
            {!isNew && (
              <p className="mt-1 text-xs text-muted-foreground">
                {runtime?.workspaceCount ?? 0} remote workspaces
                {profile?.hasToken ? ' • token saved' : ' • token missing'}
              </p>
            )}
          </div>
          {!isNew && onDeleted && (
            <Button variant="ghost" size="sm" onClick={handleDelete} disabled={isDeleting || isSaving}>
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
        </div>

        <SettingsInput
          label="Display Name"
          value={draft.name}
          onChange={(value) => setDraft(prev => ({ ...prev, name: value }))}
          placeholder="Production Server"
        />

        <SettingsInput
          label="WebSocket URL"
          description="Headless server URL from the server startup output."
          value={draft.url}
          onChange={(value) => setDraft(prev => ({ ...prev, url: value }))}
          placeholder="wss://example.com:9100"
          type="url"
          error={draft.url ? urlError : undefined}
        />

        {needsInsecureWsOptIn && (
          <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-900 dark:text-amber-200">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <div className="space-y-2">
              <p>
                This server uses `ws://` over a non-localhost network. Your auth token and traffic are unencrypted unless you enable TLS with `wss://`.
              </p>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={draft.allowInsecureWs}
                  onChange={(e) => setDraft(prev => ({ ...prev, allowInsecureWs: e.target.checked }))}
                />
                Allow insecure `ws://` for this server
              </label>
            </div>
          </div>
        )}

        <SettingsSecretInput
          label={profile?.hasToken ? 'Replace Token' : 'Auth Token'}
          description={profile?.hasToken ? 'Leave blank to keep the existing token.' : 'Bearer token printed by the headless server.'}
          value={draft.token}
          onChange={(value) => setDraft(prev => ({ ...prev, token: value, clearToken: false }))}
          placeholder={profile?.hasToken ? 'Enter a new token to replace the saved one' : 'Paste server token'}
        />

        {!!profile?.hasToken && (
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            <input
              type="checkbox"
              checked={draft.clearToken}
              onChange={(e) => setDraft(prev => ({ ...prev, clearToken: e.target.checked, token: '' }))}
            />
            Clear saved token on next save
          </label>
        )}

        <SettingsToggle
          label="Enabled"
          description="Enabled servers are connected automatically and their workspaces appear in the workspace switcher."
          checked={draft.enabled}
          onCheckedChange={(enabled) => setDraft(prev => ({ ...prev, enabled }))}
        />

        {runtime?.error && (
          <div className="flex items-start gap-2 rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{runtime.error}</span>
          </div>
        )}

        {error && (
          <div className="flex items-start gap-2 rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            <ServerCrash className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}
      </SettingsCardContent>
      <SettingsCardFooter className="justify-between">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {runtime?.status === 'connected'
            ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
            : <AlertCircle className="h-3.5 w-3.5" />}
          <span>{runtime?.status === 'connected' ? 'Connected' : 'Not connected yet'}</span>
        </div>
        <div className="flex items-center gap-2">
          {isNew && onCancelNew && (
            <Button variant="ghost" size="sm" onClick={onCancelNew} disabled={isSaving}>
              Cancel
            </Button>
          )}
          <Button size="sm" onClick={handleSave} disabled={!canSave || isSaving || isDeleting}>
            {isSaving ? 'Saving...' : isNew ? 'Add Server' : 'Save Changes'}
          </Button>
        </div>
      </SettingsCardFooter>
    </SettingsCard>
  )
}

export default function ServersSettingsPage() {
  const [profiles, setProfiles] = useState<RemoteServerProfile[]>([])
  const [runtimeStates, setRuntimeStates] = useState<Record<string, RemoteServerRuntimeState>>({})
  const [showNewCard, setShowNewCard] = useState(false)

  const load = useCallback(async () => {
    const getRuntimeStates = typeof (window.electronAPI as any).getRemoteServerRuntimeStates === 'function'
      ? () => window.electronAPI.getRemoteServerRuntimeStates()
      : async () => ({})

    const [nextProfiles, nextRuntimeStates] = await Promise.all([
      window.electronAPI.listRemoteServers(),
      getRuntimeStates(),
    ])
    setProfiles(nextProfiles)
    setRuntimeStates(nextRuntimeStates)
  }, [])

  useEffect(() => {
    void load()
    const unsubscribe = window.electronAPI.onRemoteServersChanged?.(() => {
      void load()
    })
    return () => {
      unsubscribe?.()
    }
  }, [load])

  return (
    <div className="h-full flex flex-col">
      <PanelHeader title="Servers" actions={<HeaderMenu route={routes.view.settings('servers')} />} />
      <div className="flex-1 min-h-0 mask-fade-y">
        <ScrollArea className="h-full">
          <div className="px-5 py-7 max-w-3xl mx-auto">
            <div className="space-y-8">
              <SettingsSection title="Remote Headless Servers">
                <div className="space-y-4">
                  <SettingsCard divided={false}>
                    <SettingsCardContent className="flex items-start justify-between gap-4">
                      <div>
                        <h3 className="text-sm font-medium">Workspace federation</h3>
                        <p className="mt-1 text-sm text-muted-foreground">
                          Add remote Craft headless servers here. Enabled servers connect automatically and their workspaces appear in the workspace switcher beside local workspaces.
                        </p>
                      </div>
                      <Button size="sm" onClick={() => setShowNewCard(true)} disabled={showNewCard}>
                        <Plus className="h-4 w-4" />
                        Add Server
                      </Button>
                    </SettingsCardContent>
                  </SettingsCard>

                  {showNewCard && (
                    <RemoteServerCard
                      title="New Remote Server"
                      isNew
                      onSaved={load}
                      onCancelNew={() => setShowNewCard(false)}
                    />
                  )}

                  {profiles.map((profile) => (
                    <RemoteServerCard
                      key={profile.id}
                      title={profile.name}
                      profile={profile}
                      runtime={runtimeStates[profile.id]}
                      onSaved={load}
                      onDeleted={load}
                    />
                  ))}

                  {profiles.length === 0 && !showNewCard && (
                    <SettingsCard divided={false}>
                      <SettingsCardContent className="py-8 text-center">
                        <p className="text-sm text-muted-foreground">
                          No remote servers configured yet.
                        </p>
                      </SettingsCardContent>
                    </SettingsCard>
                  )}
                </div>
              </SettingsSection>
            </div>
          </div>
        </ScrollArea>
      </div>
    </div>
  )
}
