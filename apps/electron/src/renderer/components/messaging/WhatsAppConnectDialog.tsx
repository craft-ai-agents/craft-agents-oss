/**
 * WhatsAppConnectDialog — drives the Baileys QR-scan pairing flow from the UI.
 */

import * as React from 'react'
import { AlertTriangle, Check } from 'lucide-react'
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
import type { WhatsAppUiEvent } from '../../../shared/types'

interface WhatsAppConnectDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onConnected?: () => void
}

type Phase =
  | { kind: 'idle' }
  | { kind: 'starting' }
  | { kind: 'show_qr'; qr: string }
  | { kind: 'connected'; name?: string }
  | { kind: 'error'; message: string }

export function WhatsAppConnectDialog({ open, onOpenChange, onConnected }: WhatsAppConnectDialogProps) {
  const { t } = useTranslation()
  const [phase, setPhase] = React.useState<Phase>({ kind: 'idle' })

  React.useEffect(() => {
    if (!open) return
    const off = window.electronAPI.onWhatsAppEvent(({ event }) => handleEvent(event))
    return off
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  React.useEffect(() => {
    if (!open || phase.kind !== 'idle') return
    setPhase({ kind: 'starting' })
    window.electronAPI
      .startWhatsAppConnect()
      .catch((err) => setPhase({ kind: 'error', message: errorMsg(err) }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

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
        setTimeout(() => {
          if (onConnected) {
            onConnected()
          } else {
            onOpenChange(false)
          }
        }, 1200)
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

        <div className="rounded-md border border-sky-500/30 bg-sky-500/10 p-3 text-xs text-sky-800 dark:text-sky-200">
          {t('dialog.whatsapp.selfChatHint')}
        </div>

        <div className="flex flex-col gap-4 py-2">
          {phase.kind === 'starting' && (
            <StatusRow icon={<Spinner className="text-[16px]" />}>
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
