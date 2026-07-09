/**
 * DiscordConnectDialog — bot-token pairing flow for Discord.
 *
 * Same modal shape as `LarkConnectDialog`, but with a single secret field
 * (the bot token from the Developer Portal). The instructions call out the
 * privileged **Message Content Intent**, which must be enabled for the bot
 * to read message text — the #1 setup pitfall.
 */

import * as React from 'react'
import { Check, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Spinner } from '@craft-agent/ui'
import { SettingsSecretInput } from '@/components/settings'

interface DiscordConnectDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** When true, treat the flow as "replace existing credentials". */
  reconfigure?: boolean
  onSaved?: () => void
}

type TestResult =
  | { state: 'idle' }
  | { state: 'testing' }
  | { state: 'success' }
  | { state: 'error'; error: string }

export function DiscordConnectDialog({
  open,
  onOpenChange,
  reconfigure = false,
  onSaved,
}: DiscordConnectDialogProps) {
  const { t } = useTranslation()
  const [token, setToken] = React.useState('')
  const [saving, setSaving] = React.useState(false)
  const [test, setTest] = React.useState<TestResult>({ state: 'idle' })

  React.useEffect(() => {
    if (!open) {
      setToken('')
      setTest({ state: 'idle' })
      setSaving(false)
    }
  }, [open])

  const ready = token.trim().length > 0

  const handleTest = async () => {
    if (!ready) return
    setTest({ state: 'testing' })
    try {
      const result = await window.electronAPI.testDiscordCredentials({ token: token.trim() })
      if (result.success) {
        setTest({ state: 'success' })
      } else {
        setTest({ state: 'error', error: result.error ?? t('common.error') })
      }
    } catch (err) {
      setTest({ state: 'error', error: err instanceof Error ? err.message : t('common.error') })
    }
  }

  const handleSave = async () => {
    if (!ready) return
    setSaving(true)
    try {
      await window.electronAPI.saveDiscordCredentials({ token: token.trim() })
      toast.success(t('settings.messaging.discord.saved'))
      onSaved?.()
      onOpenChange(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('settings.messaging.discord.saveFailed'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>
            {reconfigure
              ? t('settings.messaging.discord.reconfigureTitle')
              : t('settings.messaging.discord.connectTitle')}
          </DialogTitle>
          <DialogDescription className="whitespace-pre-line">
            {t('settings.messaging.discord.instructions')}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <div>
            <div className="mb-1.5 text-xs text-muted-foreground">
              {t('settings.messaging.discord.tokenLabel')}
            </div>
            <SettingsSecretInput
              value={token}
              onChange={setToken}
              placeholder={t('settings.messaging.discord.tokenPlaceholder')}
              disabled={saving}
            />
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleTest}
              disabled={!ready || test.state === 'testing' || saving}
            >
              {test.state === 'testing' && <Spinner className="mr-1 text-[14px]" />}
              {t('settings.messaging.discord.testConnection')}
            </Button>

            {test.state === 'success' && (
              <span className="inline-flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400">
                <Check className="h-3.5 w-3.5" />
                {t('settings.messaging.discord.testOk')}
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

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} disabled={saving}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleSave}
            disabled={!ready || test.state !== 'success' || saving}
          >
            {saving && <Spinner className="mr-1 text-[14px]" />}
            {t('settings.messaging.discord.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
