/**
 * MessagingSettingsPage
 *
 * Configure messaging platform connections (Telegram, WhatsApp) and view
 * active session bindings. Platform cards show runtime connection status.
 */

import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Check, X } from 'lucide-react'
import { useAtomValue, useSetAtom } from 'jotai'
import { PanelHeader } from '@/components/app-shell/PanelHeader'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Button } from '@/components/ui/button'
import { Spinner } from '@craft-agent/ui'
import { useActiveWorkspace } from '@/context/AppShellContext'
import {
  SettingsSection,
  SettingsCard,
  SettingsRow,
  SettingsSecretInput,
} from '@/components/settings'
import {
  messagingBindingsAtom,
  setMessagingBindingsAtom,
  type MessagingBinding,
} from '@/atoms/messaging'
import { WhatsAppConnectDialog } from '@/components/messaging/WhatsAppConnectDialog'
import { sessionMetaMapAtom } from '@/atoms/sessions'
import { getSessionTitle } from '@/utils/session'
import type { DetailsPageMeta } from '@/lib/navigation-registry'
import type { MessagingPlatformRuntimeInfo } from '../../../shared/types'

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
  const [runtime, setRuntime] = React.useState<MessagingPlatformRuntimeInfo>(() => defaultRuntime('telegram'))
  const [saving, setSaving] = React.useState(false)
  const [test, setTest] = React.useState<TestResult>({ state: 'idle' })

  React.useEffect(() => {
    let cancelled = false
    window.electronAPI.getMessagingConfig().then((cfg) => {
      if (cancelled) return
      setRuntime((cfg?.runtime.telegram ?? defaultRuntime('telegram')) as MessagingPlatformRuntimeInfo)
    })
    const off = window.electronAPI.onMessagingPlatformStatus((wsId, platform, status) => {
      if (wsId !== workspaceId || platform !== 'telegram') return
      setRuntime(status)
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

  if (runtime.connected) {
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
            {runtime.state === 'error' && runtime.lastError
              ? runtime.lastError
              : t('settings.messaging.telegram.instructions')}
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
            {test.state === 'testing' && <Spinner className="mr-1 text-[14px]" />}
            {t('settings.messaging.telegram.testConnection')}
          </Button>
          <Button
            size="sm"
            onClick={handleSave}
            disabled={!token.trim() || test.state !== 'success' || saving}
          >
            {saving && <Spinner className="mr-1 text-[14px]" />}
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
// WhatsApp Card
// ---------------------------------------------------------------------------

function WhatsAppCard({ workspaceId }: { workspaceId: string }) {
  const { t } = useTranslation()
  const [runtime, setRuntime] = React.useState<MessagingPlatformRuntimeInfo>(() => defaultRuntime('whatsapp'))
  const [dialogOpen, setDialogOpen] = React.useState(false)

  React.useEffect(() => {
    let cancelled = false
    window.electronAPI.getMessagingConfig().then((cfg) => {
      if (cancelled) return
      setRuntime((cfg?.runtime.whatsapp ?? defaultRuntime('whatsapp')) as MessagingPlatformRuntimeInfo)
    })
    const off = window.electronAPI.onMessagingPlatformStatus((wsId, platform, status) => {
      if (wsId !== workspaceId || platform !== 'whatsapp') return
      setRuntime(status)
    })
    return () => {
      cancelled = true
      off()
    }
  }, [workspaceId])

  const handleDisable = async () => {
    try {
      await window.electronAPI.disconnectMessagingPlatform('whatsapp')
      toast.success(t('settings.messaging.whatsapp.disconnected'))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('common.error'))
    }
  }

  const handleForget = async () => {
    try {
      await window.electronAPI.forgetMessagingPlatform('whatsapp')
      toast.success(t('settings.messaging.whatsapp.disconnected'))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('common.error'))
    }
  }

  const description = runtime.connected
    ? (runtime.identity
      ? t('dialog.whatsapp.connectedAs', { name: runtime.identity })
      : t('settings.messaging.whatsapp.connected'))
    : runtime.state === 'connecting'
      ? t('dialog.whatsapp.starting')
      : runtime.lastError || t('settings.messaging.whatsapp.unofficialApiShort')

  return (
    <>
      <SettingsCard>
        <div className="space-y-3 p-4">
          <SettingsRow
            label={t('settings.messaging.whatsapp.title')}
            description={description}
          >
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => setDialogOpen(true)}>
                {runtime.connected || runtime.configured
                  ? t('settings.messaging.whatsapp.reconnect')
                  : t('settings.messaging.telegram.configure')}
              </Button>
              {runtime.configured && (
                <>
                  <Button variant="outline" size="sm" onClick={handleDisable}>
                    {t('settings.messaging.whatsapp.disable')}
                  </Button>
                  <Button variant="outline" size="sm" onClick={handleForget}>
                    {t('settings.messaging.whatsapp.forget')}
                  </Button>
                </>
              )}
            </div>
          </SettingsRow>
          <p className="text-xs text-muted-foreground">
            {t('settings.messaging.whatsapp.desktopApprovalsOnly')}
          </p>
        </div>
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
  const bindings = useAtomValue(messagingBindingsAtom)
  const setBindings = useSetAtom(setMessagingBindingsAtom)
  const sessionMetaMap = useAtomValue(sessionMetaMapAtom)

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
      await window.electronAPI.unbindMessagingBinding(binding.id)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('common.error'))
    }
  }

  if (bindings.length === 0) {
    return (
      <SettingsCard>
        <div className="px-4 py-6 text-center text-sm text-muted-foreground">
          {t('settings.messaging.bindings.empty')}
        </div>
      </SettingsCard>
    )
  }

  const sorted = [...bindings].sort((a, b) => b.createdAt - a.createdAt)

  return (
    <SettingsCard>
      <div className="divide-y divide-border">
        {sorted.map((binding) => {
          const sessionMeta = sessionMetaMap.get(binding.sessionId)
          const sessionTitle = sessionMeta ? getSessionTitle(sessionMeta) : binding.sessionId.slice(0, 8)
          return (
            <div
              key={binding.id}
              className="flex items-center justify-between gap-4 px-4 py-3"
            >
              <div className="min-w-0 space-y-1">
                <div className="flex items-center gap-2 text-sm">
                  <span className="font-medium capitalize">{binding.platform}</span>
                  <span className="truncate text-muted-foreground">
                    {binding.channelName || binding.channelId}
                  </span>
                </div>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span className="truncate">{sessionTitle}</span>
                  <span className="font-mono">{binding.sessionId.slice(0, 8)}</span>
                </div>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="text-destructive hover:text-destructive"
                onClick={() => handleUnbind(binding)}
              >
                {t('settings.messaging.bindings.unbind')}
              </Button>
            </div>
          )
        })}
      </div>
    </SettingsCard>
  )
}

function defaultRuntime(platform: 'telegram' | 'whatsapp'): MessagingPlatformRuntimeInfo {
  return {
    platform,
    configured: false,
    connected: false,
    state: 'disconnected',
    updatedAt: Date.now(),
  }
}
