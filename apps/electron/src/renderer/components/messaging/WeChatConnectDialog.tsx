/**
 * WeChatConnectDialog — drives the WeChat (微信) iLink QR-scan login flow from
 * the UI. Mirrors WhatsAppConnectDialog, plus a verify-code step (WeChat may
 * ask the user to type a number shown on their phone).
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
import { Button } from '@/components/ui/button'
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
  | { kind: 'show_qr'; qr: string }
  | { kind: 'verify' }
  | { kind: 'connected' }
  | { kind: 'error'; message: string }

export function WeChatConnectDialog({ open, onOpenChange, onConnected }: WeChatConnectDialogProps) {
  const { t } = useTranslation()
  const activeWorkspace = useActiveWorkspace()
  const activeWorkspaceId = activeWorkspace?.id
  const [phase, setPhase] = React.useState<Phase>({ kind: 'idle' })
  const [code, setCode] = React.useState('')

  React.useEffect(() => {
    if (!open || !activeWorkspaceId) return
    // The main process broadcasts WeChat UI events to every renderer; filter by
    // workspaceId at the dialog boundary (same pattern as WhatsApp).
    const off = window.electronAPI.onWeChatEvent(({ workspaceId, event }) => {
      if (workspaceId !== activeWorkspaceId) return
      handleEvent(event)
    })
    return off
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, activeWorkspaceId])

  React.useEffect(() => {
    if (!open || phase.kind !== 'idle') return
    setPhase({ kind: 'starting' })
    window.electronAPI
      .startWeChatConnect()
      .catch((err) => setPhase({ kind: 'error', message: errorMsg(err) }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  React.useEffect(() => {
    if (!open) {
      setPhase({ kind: 'idle' })
      setCode('')
    }
  }, [open])

  const handleEvent = (event: WeChatUiEvent) => {
    switch (event.type) {
      case 'qr':
        setPhase({ kind: 'show_qr', qr: event.qr })
        return
      case 'need_verifycode':
        setPhase({ kind: 'verify' })
        return
      case 'connected':
        setPhase({ kind: 'connected' })
        setTimeout(() => {
          if (onConnected) onConnected()
          else onOpenChange(false)
        }, 1200)
        return
      case 'error':
        setPhase({ kind: 'error', message: event.message })
        return
      // 'scanned' is informational — keep showing the current step.
    }
  }

  const submitCode = () => {
    const trimmed = code.trim()
    if (!trimmed) return
    window.electronAPI.submitWeChatVerifyCode(trimmed).catch(() => {})
    setCode('')
    setPhase({ kind: 'starting' })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>{t('dialog.wechat.title')}</DialogTitle>
          <DialogDescription>{t('dialog.wechat.description')}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4 py-2">
          {phase.kind === 'starting' && (
            <StatusRow icon={<Spinner className="text-[16px]" />}>
              {t('dialog.wechat.starting')}
            </StatusRow>
          )}

          {phase.kind === 'show_qr' && (
            <div className="flex flex-col items-center gap-3">
              <div className="rounded-lg bg-white p-4">
                <QRCodeSVG value={phase.qr} size={240} level="M" />
              </div>
              <p className="whitespace-pre-line text-center text-sm text-muted-foreground">
                {t('dialog.wechat.qrInstructions')}
              </p>
            </div>
          )}

          {phase.kind === 'verify' && (
            <div className="flex flex-col gap-3">
              <p className="text-sm text-muted-foreground">{t('dialog.wechat.verifyPrompt')}</p>
              <div className="flex items-center gap-2">
                <input
                  autoFocus
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') submitCode()
                  }}
                  placeholder={t('dialog.wechat.verifyPlaceholder')}
                  className="flex-1 rounded-md border border-input bg-transparent px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring"
                />
                <Button size="sm" onClick={submitCode} disabled={!code.trim()}>
                  {t('dialog.wechat.submit')}
                </Button>
              </div>
            </div>
          )}

          {phase.kind === 'connected' && (
            <StatusRow icon={<Check className="h-4 w-4 text-emerald-500" />}>
              {t('dialog.wechat.connected')}
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
