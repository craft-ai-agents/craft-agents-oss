/**
 * WhatsAppConnectDialog — drives the Baileys QR-scan pairing flow from the UI.
 *
 * Flow:
 *   1. User opens dialog → renderer calls `startWhatsAppConnect`
 *   2. Worker emits `qr` event → dialog displays the QR as a scannable SVG
 *   3. User scans with WhatsApp → Settings → Linked Devices → Link a Device
 *   4. Worker emits `connected` → dialog closes
 *
 * QR is rendered via `qrcode.react` (<QRCodeSVG>).
 *
 * Unofficial-API disclaimer: Baileys is not sanctioned by WhatsApp/Meta and
 * may stop working or lead to account bans. This is shown to the user below.
 */

import * as React from 'react'
import { AlertTriangle, Loader2, Check } from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import { useTranslation } from 'react-i18next'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import type { WhatsAppUiEvent } from '../../../shared/types'

interface WhatsAppConnectDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

type Phase =
  | { kind: 'idle' }
  | { kind: 'starting' }
  | { kind: 'show_qr'; qr: string }
  | { kind: 'connected'; name?: string }
  | { kind: 'error'; message: string }

export function WhatsAppConnectDialog({ open, onOpenChange }: WhatsAppConnectDialogProps) {
  const { t } = useTranslation()
  const [phase, setPhase] = React.useState<Phase>({ kind: 'idle' })

  // Subscribe to WA events whenever the dialog is open.
  React.useEffect(() => {
    if (!open) return
    const off = window.electronAPI.onWhatsAppEvent(({ event }) => handleEvent(event))
    return off
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  // Start the worker when the dialog opens. We stay in the `starting` phase
  // until the worker emits the first `qr` event.
  React.useEffect(() => {
    if (!open || phase.kind !== 'idle') return
    setPhase({ kind: 'starting' })
    window.electronAPI
      .startWhatsAppConnect()
      .catch((err) => setPhase({ kind: 'error', message: errorMsg(err) }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  // Reset when closed so the next open starts fresh.
  React.useEffect(() => {
    if (!open) {
      setPhase({ kind: 'idle' })
    }
  }, [open])

  const handleEvent = (event: WhatsAppUiEvent) => {
    switch (event.type) {
      case 'qr':
        setPhase({ kind: 'show_qr', qr: event.qr })
        return
      case 'connected':
        setPhase({ kind: 'connected', name: event.name })
        setTimeout(() => onOpenChange(false), 1500)
        return
      case 'disconnected':
        if (event.loggedOut) {
          setPhase({ kind: 'error', message: t('dialog.whatsapp.loggedOut') })
        }
        return
      case 'unavailable':
        setPhase({ kind: 'error', message: event.message })
        return
      case 'error':
        setPhase({ kind: 'error', message: event.message })
        return
      // `pairing_code` is ignored: pairingMode is 'qr' in this build.
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>{t('dialog.whatsapp.title')}</DialogTitle>
          <DialogDescription>{t('dialog.whatsapp.description')}</DialogDescription>
        </DialogHeader>

        <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-800 dark:text-amber-200">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <div>{t('dialog.whatsapp.unofficialApi')}</div>
          </div>
        </div>

        <div className="flex flex-col gap-4 py-2">
          {phase.kind === 'starting' && (
            <StatusRow icon={<Loader2 className="h-4 w-4 animate-spin" />}>
              {t('dialog.whatsapp.starting')}
            </StatusRow>
          )}

          {phase.kind === 'show_qr' && (
            <div className="flex flex-col items-center gap-3">
              <div className="rounded-lg bg-white p-4">
                <QRCodeSVG value={phase.qr} size={240} level="M" />
              </div>
              <p className="whitespace-pre-line text-center text-sm text-muted-foreground">
                {t('dialog.whatsapp.qrInstructions')}
              </p>
            </div>
          )}

          {phase.kind === 'connected' && (
            <StatusRow icon={<Check className="h-4 w-4 text-emerald-500" />}>
              {phase.name
                ? t('dialog.whatsapp.connectedAs', { name: phase.name })
                : t('dialog.whatsapp.connected')}
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
