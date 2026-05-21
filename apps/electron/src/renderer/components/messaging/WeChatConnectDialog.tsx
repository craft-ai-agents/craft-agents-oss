/**
 * WeChatConnectDialog — WeChat iLink Bot QR-code login flow.
 *
 * Flow:
 * 1. On open, request a QR code from the backend (qrContent + qrcode token)
 * 2. Render the QR code with qrcode.react — user scans with WeChat
 * 3. Poll the backend every 1.5 s for scan status
 * 4. On confirmed, the backend saves bot_token automatically and starts the adapter
 */

import * as React from 'react'
import { RefreshCw } from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
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

interface WeChatConnectDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** When true, treat the flow as replacing an existing binding (re-scan). */
  reconfigure?: boolean
  onSaved?: () => void
}

/** Discriminated union representing each phase of the QR login flow. */
type QRPhase =
  | { phase: 'loading' }
  | { phase: 'waiting'; qrContent: string; qrcode: string }
  | { phase: 'scanned'; qrContent: string; qrcode: string }
  | { phase: 'expired'; qrcode: string }
  | { phase: 'confirmed' }
  | { phase: 'error'; message: string }

export function WeChatConnectDialog({
  open,
  onOpenChange,
  reconfigure = false,
  onSaved,
}: WeChatConnectDialogProps) {
  const { t } = useTranslation()
  const [state, setState] = React.useState<QRPhase>({ phase: 'loading' })
  const pollRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const activeRef = React.useRef(false)

  /** Cancel any pending poll timer. */
  const stopPoll = () => {
    if (pollRef.current) {
      clearTimeout(pollRef.current)
      pollRef.current = null
    }
  }

  /** Fetch a fresh QR code from the backend and start polling. */
  const loadQR = React.useCallback(async () => {
    stopPoll()
    setState({ phase: 'loading' })
    activeRef.current = true
    try {
      const { qrContent, qrcode } = await window.electronAPI.startWeChatQRLogin()
      if (!activeRef.current) return
      setState({ phase: 'waiting', qrContent, qrcode })
      schedulePoll(qrcode)
    } catch (err) {
      if (!activeRef.current) return
      setState({
        phase: 'error',
        message: err instanceof Error ? err.message : t('common.error'),
      })
    }
  }, [t])

  /** Schedule the next poll tick. */
  const schedulePoll = (qrcode: string) => {
    pollRef.current = setTimeout(() => doPoll(qrcode), 1_500)
  }

  /** Ask the backend for the current scan status. */
  const doPoll = async (qrcode: string) => {
    if (!activeRef.current) return
    try {
      const { status } = await window.electronAPI.pollWeChatQRStatus(qrcode)
      if (!activeRef.current) return

      switch (status) {
        case 'waiting':
          setState((prev) => (prev.phase === 'scanned' ? prev : { phase: 'waiting', qrContent: getQrContent(prev), qrcode }))
          schedulePoll(qrcode)
          break
        case 'scanned':
          setState((prev) => ({ phase: 'scanned', qrContent: getQrContent(prev), qrcode }))
          schedulePoll(qrcode)
          break
        case 'expired':
          setState({ phase: 'expired', qrcode })
          break
        case 'confirmed':
          setState({ phase: 'confirmed' })
          toast.success(t('settings.messaging.wechat.saved'))
          onSaved?.()
          onOpenChange(false)
          break
      }
    } catch (err) {
      if (!activeRef.current) return
      setState({
        phase: 'error',
        message: err instanceof Error ? err.message : t('common.error'),
      })
    }
  }

  /** Extract the qrContent URL from the current phase (keeps the image visible during transitions). */
  const getQrContent = (prev: QRPhase): string => {
    if (prev.phase === 'waiting' || prev.phase === 'scanned') return prev.qrContent
    return ''
  }

  // Trigger QR load when the dialog opens; clean up when it closes.
  React.useEffect(() => {
    if (open) {
      void loadQR()
    } else {
      activeRef.current = false
      stopPoll()
      setState({ phase: 'loading' })
    }
  }, [open, loadQR])

  // Clean up on unmount.
  React.useEffect(() => {
    return () => {
      activeRef.current = false
      stopPoll()
    }
  }, [])

  const title = reconfigure
    ? t('settings.messaging.wechat.reconfigureTitle')
    : t('settings.messaging.wechat.connectTitle')

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[400px]">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {state.phase === 'waiting' || state.phase === 'scanned' ? (
            <DialogDescription>{t('settings.messaging.wechat.qrInstructions')}</DialogDescription>
          ) : null}
        </DialogHeader>

        {/* QR code area */}
        <div className="flex flex-col items-center justify-center py-4 gap-3">
          {state.phase === 'loading' && (
            <div className="flex flex-col items-center gap-2 text-muted-foreground text-sm">
              <Spinner className="text-[20px]" />
              <span>{t('settings.messaging.wechat.qrLoading')}</span>
            </div>
          )}

          {(state.phase === 'waiting' || state.phase === 'scanned') && (
            <>
              <div className={state.phase === 'scanned' ? 'opacity-40' : ''}>
                <QRCodeSVG value={state.qrContent} size={220} level="M" />
              </div>
              {state.phase === 'scanned' && (
                <p className="text-sm text-muted-foreground text-center">
                  {t('settings.messaging.wechat.qrScanned')}
                </p>
              )}
            </>
          )}

          {state.phase === 'expired' && (
            <div className="flex flex-col items-center gap-3">
              <p className="text-sm text-muted-foreground">
                {t('settings.messaging.wechat.qrExpired')}
              </p>
              <Button variant="outline" size="sm" onClick={() => void loadQR()}>
                <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                {t('settings.messaging.wechat.qrRefresh')}
              </Button>
            </div>
          )}

          {state.phase === 'confirmed' && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Spinner className="text-[16px]" />
              <span>{t('common.loading')}</span>
            </div>
          )}

          {state.phase === 'error' && (
            <div className="flex flex-col items-center gap-3">
              <p className="text-sm text-destructive text-center">
                {t('settings.messaging.wechat.qrError')}
              </p>
              <Button variant="outline" size="sm" onClick={() => void loadQR()}>
                <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                {t('settings.messaging.wechat.qrRefresh')}
              </Button>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
