/**
 * WeChatConnectDialog — drives the iLink QR-scan login flow from the UI.
 *
 * Mirrors `WhatsAppConnectDialog`'s shape but with two key differences:
 *  - the iLink endpoint hands back an *image URL* (rendered with <img>),
 *    not a QR-payload string the renderer would have to encode itself
 *  - there's an extra `scaned` intermediate phase between "show QR" and
 *    "confirmed" — the user has scanned but still needs to tap "授权" in
 *    the WeChat app
 */

import * as React from 'react'
import { Check } from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import { useTranslation } from 'react-i18next'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Spinner } from '@craft-agent/ui'
import { useActiveWorkspace } from '@/context/AppShellContext'
import type { WeChatUiEvent } from '../../../shared/types'

interface WeChatConnectDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onConnected?: () => void
}

type Phase =
  | { kind: 'idle' }
  | { kind: 'starting' }
  | { kind: 'show_qr'; qr: string; refreshCount: number }
  | { kind: 'scaned' }
  | { kind: 'confirmed' }
  | { kind: 'error'; message: string }

export function WeChatConnectDialog({ open, onOpenChange, onConnected }: WeChatConnectDialogProps) {
  const { t } = useTranslation()
  const activeWorkspace = useActiveWorkspace()
  const activeWorkspaceId = activeWorkspace?.id
  const [phase, setPhase] = React.useState<Phase>({ kind: 'idle' })

  // Subscribe to backend events as soon as the dialog opens. Filter by
  // workspaceId so a parallel login in another workspace doesn't paint
  // here.
  React.useEffect(() => {
    if (!open || !activeWorkspaceId) return
    const off = window.electronAPI.onWeChatEvent(({ workspaceId, event }) => {
      if (workspaceId !== activeWorkspaceId) return
      handleEvent(event)
    })
    return off
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, activeWorkspaceId])

  // Kick off the login flow when the dialog opens.
  React.useEffect(() => {
    if (!open || phase.kind !== 'idle') return
    setPhase({ kind: 'starting' })
    window.electronAPI
      .startWeChatConnect()
      .catch((err) => setPhase({ kind: 'error', message: errorMsg(err) }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  // On close, cancel any in-flight login + reset to idle so a future open
  // re-runs cleanly.
  React.useEffect(() => {
    if (!open) {
      window.electronAPI.cancelWeChatConnect().catch(() => {
        // Backend logs the failure; nothing actionable here.
      })
      setPhase({ kind: 'idle' })
    }
  }, [open])

  const handleEvent = (event: WeChatUiEvent) => {
    switch (event.type) {
      case 'qr':
        setPhase({ kind: 'show_qr', qr: event.qr, refreshCount: event.refreshCount })
        return
      case 'scaned':
        setPhase({ kind: 'scaned' })
        return
      case 'confirmed':
        setPhase({ kind: 'confirmed' })
        // Match WhatsApp dialog's auto-close cadence so connection feedback feels uniform.
        setTimeout(() => {
          if (onConnected) {
            onConnected()
          } else {
            onOpenChange(false)
          }
        }, 1200)
        return
      case 'expired':
      case 'error':
        setPhase({ kind: 'error', message: event.message })
        return
      case 'cancelled':
        // Dialog already resets on close — ignore stray cancel event.
        return
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>{t('dialog.wechat.title', { defaultValue: 'Connect WeChat' })}</DialogTitle>
          <DialogDescription>
            {t('dialog.wechat.description', {
              defaultValue: 'Scan the QR code with WeChat on your phone, then tap 授权 to authorise.',
            })}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4 py-2">
          {phase.kind === 'starting' && (
            <StatusRow icon={<Spinner className="text-[16px]" />}>
              {t('dialog.wechat.starting', { defaultValue: 'Requesting QR code…' })}
            </StatusRow>
          )}

          {phase.kind === 'show_qr' && (
            <div className="flex flex-col items-center gap-3">
              <div className="rounded-lg bg-white p-4">
                <QRCodeSVG value={phase.qr} size={240} level="M" />
              </div>
              <p className="whitespace-pre-line text-center text-sm text-muted-foreground">
                {t('dialog.wechat.qrInstructions', {
                  defaultValue: 'Open WeChat → Scan, then tap "授权" in the in-app prompt.',
                })}
              </p>
              {phase.refreshCount > 0 && (
                <p className="text-xs text-muted-foreground">
                  {t('dialog.wechat.qrRefreshed', {
                    defaultValue: 'QR refreshed (attempt {{n}}). Please scan the new code.',
                    n: phase.refreshCount,
                  })}
                </p>
              )}
            </div>
          )}

          {phase.kind === 'scaned' && (
            <StatusRow icon={<Spinner className="text-[16px]" />}>
              {t('dialog.wechat.scaned', { defaultValue: 'Scanned. Waiting for authorisation in WeChat…' })}
            </StatusRow>
          )}

          {phase.kind === 'confirmed' && (
            <StatusRow icon={<Check className="h-4 w-4 text-emerald-500" />}>
              {t('dialog.wechat.confirmed', { defaultValue: 'Connected to WeChat.' })}
            </StatusRow>
          )}

          {phase.kind === 'error' && (
            <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
              {phase.message}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

function StatusRow({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 text-sm">
      {icon}
      <span>{children}</span>
    </div>
  )
}

function errorMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
