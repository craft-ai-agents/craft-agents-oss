/**
 * TelegramSupergroupPairingDialog — workspace-level pairing for a Telegram
 * supergroup ("forum"). Sibling of PairingCodeDialog but with different
 * copy and a polling loop that detects when the user has typed the code
 * inside the group.
 *
 * Why polling: there's no dedicated broadcast for "supergroup paired" yet,
 * and adding one adds protocol surface for a flow that runs at most once
 * per workspace setup. We poll `getMessagingSupergroup()` every second
 * while the dialog is open; on first non-null response we close + toast.
 */

import * as React from 'react'
import { Copy, ExternalLink } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Bot username (without @) — enables the "Open bot" deep link. */
  botUsername?: string
  /** Fired once the supergroup has been paired (parent re-fetches state). */
  onPaired?: () => void
}

export function TelegramSupergroupPairingDialog({ open, onOpenChange, botUsername, onPaired }: Props) {
  const { t } = useTranslation()
  const [code, setCode] = React.useState<string | null>(null)
  const [expiresAt, setExpiresAt] = React.useState<number | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [secondsLeft, setSecondsLeft] = React.useState(0)
  const onPairedRef = React.useRef(onPaired)
  onPairedRef.current = onPaired

  // Generate a fresh code each time the dialog opens. Closing then re-opening
  // produces a new code rather than recycling — that matches user expectation
  // and avoids racing the previous code's TTL.
  React.useEffect(() => {
    if (!open) {
      setCode(null)
      setExpiresAt(null)
      setError(null)
      return
    }
    let cancelled = false
    window.electronAPI
      .generateMessagingSupergroupCode('telegram')
      .then((res) => {
        if (cancelled) return
        setCode(res.code)
        setExpiresAt(res.expiresAt)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : t('common.error'))
      })
    return () => { cancelled = true }
  }, [open, t])

  // Countdown
  React.useEffect(() => {
    if (!expiresAt) return
    const update = () => setSecondsLeft(Math.max(0, Math.floor((expiresAt - Date.now()) / 1000)))
    update()
    const timer = setInterval(update, 1000)
    return () => clearInterval(timer)
  }, [expiresAt])

  // Poll for completion. Stop on close, on success, or when the code expires.
  React.useEffect(() => {
    if (!open || !code) return
    let cancelled = false
    const tick = async () => {
      try {
        const sg = await window.electronAPI.getMessagingSupergroup()
        if (cancelled) return
        if (sg) {
          toast.success(
            t('settings.messaging.telegram.supergroup.pairedToast', {
              defaultValue: 'Supergroup paired',
            }),
          )
          onPairedRef.current?.()
          onOpenChange(false)
        }
      } catch {
        // best-effort; keep polling
      }
    }
    const interval = setInterval(tick, 1500)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [open, code, t, onOpenChange])

  const minutes = Math.floor(secondsLeft / 60)
  const seconds = secondsLeft % 60
  const pairCommand = code ? `/pair ${code}` : ''
  const botLink = botUsername ? `https://t.me/${botUsername}` : null

  const handleCopy = async () => {
    if (!pairCommand) return
    try {
      await navigator.clipboard.writeText(pairCommand)
      toast.success(t('toast.copied'))
    } catch {
      toast.error(t('toast.copyFailed'))
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>
            {t('settings.messaging.telegram.supergroup.dialogTitle', {
              defaultValue: 'Pair Telegram supergroup',
            })}
          </DialogTitle>
          <DialogDescription>
            {t('settings.messaging.telegram.supergroup.dialogDescription', {
              defaultValue:
                'Add the bot to your supergroup, then type the command in any topic. The bot needs privacy mode disabled (BotFather → /setprivacy → Disable) or admin rights to read non-command messages.',
            })}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col items-center gap-4 py-4">
          {error ? (
            <p className="text-sm text-destructive text-center">{error}</p>
          ) : code ? (
            <>
              <div className="rounded-lg bg-muted px-6 py-4 font-mono text-3xl font-bold tracking-[0.3em]">
                {code}
              </div>

              <div className="flex items-center gap-2 text-sm">
                <code className="rounded bg-muted px-2 py-1 font-mono">{pairCommand}</code>
                <button
                  type="button"
                  onClick={handleCopy}
                  className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs hover:bg-accent"
                  title={t('common.copy')}
                >
                  <Copy className="h-3.5 w-3.5" />
                </button>
              </div>

              <p className="text-center text-sm text-muted-foreground">
                {t('settings.messaging.telegram.supergroup.dialogSendHint', {
                  defaultValue:
                    'Send this command from any topic in your supergroup. The dialog closes once paired.',
                })}
              </p>

              {botLink && (
                <a
                  href={botLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  @{botUsername}
                </a>
              )}

              {secondsLeft > 0 && (
                <p className="text-center text-xs text-muted-foreground">
                  {t('dialog.pairingCode.expiresIn', {
                    minutes,
                    seconds: String(seconds).padStart(2, '0'),
                  })}
                </p>
              )}
            </>
          ) : (
            <p className="text-sm text-muted-foreground">{t('common.loading', { defaultValue: 'Loading…' })}</p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
