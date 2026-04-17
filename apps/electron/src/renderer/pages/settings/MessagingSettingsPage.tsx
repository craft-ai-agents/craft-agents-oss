/**
 * MessagingSettingsPage
 *
 * Configure messaging platform connections (Telegram, WhatsApp) and view
 * active session bindings. Platform cards show connection status with
 * test/save/disconnect actions. BindingsTable reads live data via
 * getMessagingBindings and reacts to messaging:bindingChanged events.
 */

import * as React from 'react'
import { useAtom } from 'jotai'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Check, X, Loader2 } from 'lucide-react'
import { PanelHeader } from '@/components/app-shell/PanelHeader'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Button } from '@/components/ui/button'
import { useActiveWorkspace } from '@/context/AppShellContext'
import {
  SettingsSection,
  SettingsCard,
  SettingsRow,
  SettingsSecretInput,
} from '@/components/settings'
import { messagingBindingsMapAtom, setMessagingBindingsAtom, type MessagingBinding } from '@/atoms/messaging'
import { WhatsAppConnectDialog } from '@/components/messaging/WhatsAppConnectDialog'
import type { DetailsPageMeta } from '@/lib/navigation-registry'

export const meta: DetailsPageMeta = {
  navigator: 'settings',
  slug: 'messaging',
}

export default function MessagingSettingsPage() {
  const { t } = useTranslation()
  const activeWorkspace = useActiveWorkspace()

  if (!activeWorkspace) return null

  return (
    <div className="flex h-full flex-col">
      <PanelHeader title={t('settings.messaging.title')} />
      <ScrollArea className="flex-1">
        <div className="space-y-6 p-6">
          <SettingsSection title={t('settings.messaging.title')}>
            <TelegramCard workspaceId={activeWorkspace.id} />
            <WhatsAppCard workspaceId={activeWorkspace.id} />
          </SettingsSection>

          <SettingsSection title={t('settings.messaging.bindings.title')}>
            <BindingsTable workspaceId={activeWorkspace.id} />
          </SettingsSection>
        </div>
      </ScrollArea>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Telegram Card
// ---------------------------------------------------------------------------

type TestResult =
  | { state: 'idle' }
  | { state: 'testing' }
  | { state: 'success'; botName?: string; botUsername?: string }
  | { state: 'error'; error: string }

function TelegramCard({ workspaceId }: { workspaceId: string }) {
  const { t } = useTranslation()
  const [token, setToken] = React.useState('')
  const [connected, setConnected] = React.useState(false)
  const [saving, setSaving] = React.useState(false)
  const [test, setTest] = React.useState<TestResult>({ state: 'idle' })

  // Load config on mount + subscribe to platform status changes
  React.useEffect(() => {
    let cancelled = false
    window.electronAPI.getMessagingConfig().then((cfg) => {
      if (cancelled) return
      setConnected(Boolean(cfg?.platforms.telegram?.enabled))
    })
    const off = window.electronAPI.onMessagingPlatformStatus((wsId, platform, isConnected) => {
      if (wsId !== workspaceId || platform !== 'telegram') return
      setConnected(isConnected)
    })
    return () => {
      cancelled = true
      off()
    }
  }, [workspaceId])

  const handleTest = async () => {
    const trimmed = token.trim()
    if (!trimmed) return
    setTest({ state: 'testing' })
    try {
      const result = await window.electronAPI.testTelegramToken(trimmed)
      if (result.success) {
        setTest({ state: 'success', botName: result.botName, botUsername: result.botUsername })
      } else {
        setTest({ state: 'error', error: result.error ?? t('common.error') })
      }
    } catch (err) {
      setTest({
        state: 'error',
        error: err instanceof Error ? err.message : t('common.error'),
      })
    }
  }

  const handleSave = async () => {
    const trimmed = token.trim()
    if (!trimmed) return
    setSaving(true)
    try {
      await window.electronAPI.saveTelegramToken(trimmed)
      toast.success(t('settings.messaging.telegram.saved'))
      setToken('')
      setTest({ state: 'idle' })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('settings.messaging.telegram.saveFailed'))
    } finally {
      setSaving(false)
    }
  }

  const handleDisconnect = async () => {
    try {
      await window.electronAPI.disconnectMessagingPlatform('telegram')
      toast.success(t('settings.messaging.telegram.disconnected'))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('common.error'))
    }
  }

  if (connected) {
    return (
      <SettingsCard>
        <SettingsRow
          label={t('settings.messaging.telegram.title')}
          description={t('settings.messaging.telegram.connected')}
        >
          <Button variant="outline" size="sm" onClick={handleDisconnect}>
            {t('settings.messaging.telegram.disconnect')}
          </Button>
        </SettingsRow>
      </SettingsCard>
    )
  }

  return (
    <SettingsCard>
      <div className="space-y-3 p-4">
        <div>
          <div className="text-sm font-medium">{t('settings.messaging.telegram.title')}</div>
          <div className="mt-1 whitespace-pre-line text-xs text-muted-foreground">
            {t('settings.messaging.telegram.instructions')}
          </div>
        </div>

        <SettingsSecretInput
          value={token}
          onChange={setToken}
          placeholder={t('settings.messaging.telegram.tokenPlaceholder')}
          disabled={saving}
        />

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleTest}
            disabled={!token.trim() || test.state === 'testing' || saving}
          >
            {test.state === 'testing' && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
            {t('settings.messaging.telegram.testConnection')}
          </Button>
          <Button
            size="sm"
            onClick={handleSave}
            disabled={!token.trim() || test.state !== 'success' || saving}
          >
            {saving && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
            {t('settings.messaging.telegram.save')}
          </Button>

          {test.state === 'success' && (
            <span className="inline-flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400">
              <Check className="h-3.5 w-3.5" />
              {test.botUsername
                ? t('settings.messaging.telegram.validBot', { username: test.botUsername })
                : t('settings.messaging.telegram.validBot', { username: test.botName ?? 'bot' })}
            </span>
          )}
          {test.state === 'error' && (
            <span className="inline-flex items-center gap-1 text-xs text-destructive">
              <X className="h-3.5 w-3.5" />
              {test.error}
            </span>
          )}
        </div>
      </div>
    </SettingsCard>
  )
}

// ---------------------------------------------------------------------------
// WhatsApp Card (Phase 3 placeholder — subprocess-based Baileys integration)
// ---------------------------------------------------------------------------

function WhatsAppCard({ workspaceId }: { workspaceId: string }) {
  const { t } = useTranslation()
  const [connected, setConnected] = React.useState(false)
  const [dialogOpen, setDialogOpen] = React.useState(false)

  React.useEffect(() => {
    let cancelled = false
    window.electronAPI.getMessagingConfig().then((cfg) => {
      if (cancelled) return
      setConnected(Boolean(cfg?.platforms.whatsapp?.enabled))
    })
    const off = window.electronAPI.onMessagingPlatformStatus((wsId, platform, isConnected) => {
      if (wsId !== workspaceId || platform !== 'whatsapp') return
      setConnected(isConnected)
    })
    return () => {
      cancelled = true
      off()
    }
  }, [workspaceId])

  const handleDisconnect = async () => {
    try {
      await window.electronAPI.disconnectMessagingPlatform('whatsapp')
      toast.success(t('settings.messaging.whatsapp.disconnected'))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('common.error'))
    }
  }

  return (
    <>
      <SettingsCard>
        <SettingsRow
          label={t('settings.messaging.whatsapp.title')}
          description={
            connected
              ? t('settings.messaging.whatsapp.connected')
              : t('settings.messaging.whatsapp.unofficialApiShort')
          }
        >
          {connected ? (
            <Button variant="outline" size="sm" onClick={handleDisconnect}>
              {t('settings.messaging.telegram.disconnect')}
            </Button>
          ) : (
            <Button variant="outline" size="sm" onClick={() => setDialogOpen(true)}>
              {t('settings.messaging.telegram.configure')}
            </Button>
          )}
        </SettingsRow>
      </SettingsCard>
      <WhatsAppConnectDialog open={dialogOpen} onOpenChange={setDialogOpen} />
    </>
  )
}

// ---------------------------------------------------------------------------
// Bindings Table
// ---------------------------------------------------------------------------

function BindingsTable({ workspaceId }: { workspaceId: string }) {
  const { t } = useTranslation()
  const [bindingsMap] = useAtom(messagingBindingsMapAtom)
  const [, setBindings] = useAtom(setMessagingBindingsAtom)

  // Initial load + subscribe to changes
  React.useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const rows = await window.electronAPI.getMessagingBindings()
        if (!cancelled) setBindings(rows as MessagingBinding[])
      } catch {
        // silent — toast on failure would be noisy on first load
      }
    }
    load()
    const off = window.electronAPI.onMessagingBindingChanged((wsId) => {
      if (wsId === workspaceId) load()
    })
    return () => {
      cancelled = true
      off()
    }
  }, [workspaceId, setBindings])

  const handleUnbind = async (binding: MessagingBinding) => {
    try {
      await window.electronAPI.unbindMessagingSession(binding.sessionId, binding.platform)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('common.error'))
    }
  }

  const bindings = Array.from(bindingsMap.values())

  if (bindings.length === 0) {
    return (
      <SettingsCard>
        <div className="px-4 py-6 text-center text-sm text-muted-foreground">
          {t('settings.messaging.bindings.empty')}
        </div>
      </SettingsCard>
    )
  }

  return (
    <SettingsCard>
      <div className="divide-y divide-border">
        {bindings.map((b) => (
          <div
            key={`${b.platform}:${b.sessionId}`}
            className="flex items-center justify-between px-4 py-3"
          >
            <div className="flex items-center gap-3">
              <span className="text-sm font-medium capitalize">{b.platform}</span>
              <span className="text-sm text-muted-foreground">
                {b.channelName || b.channelId}
              </span>
              <span className="font-mono text-xs text-muted-foreground">
                {b.sessionId.slice(0, 8)}
              </span>
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="text-destructive hover:text-destructive"
              onClick={() => handleUnbind(b)}
            >
              {t('settings.messaging.bindings.unbind')}
            </Button>
          </div>
        ))}
      </div>
    </SettingsCard>
  )
}
