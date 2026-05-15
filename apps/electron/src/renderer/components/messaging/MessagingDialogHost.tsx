/**
 * MessagingDialogHost
 *
 * Global host that owns the messaging pairing/connect dialogs so they survive
 * the close of the triggering context menu or dropdown.
 *
 * Auto-dismiss: when the pairing dialog is showing a code and the user
 * completes `/pair <code>` in their bot, the gateway emits
 * `messaging:bindingChanged`. We watch that signal, fetch the latest
 * bindings, and close the dialog (with a success toast) if the dialog's
 * sessionId now has an active binding for the matching platform.
 */

import * as React from 'react'
import { useAtom } from 'jotai'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { messagingDialogAtom } from '@/atoms/messaging'
import { PairingCodeDialog } from './PairingCodeDialog'
import { WhatsAppConnectDialog } from './WhatsAppConnectDialog'

export function MessagingDialogHost() {
  const [state, setState] = useAtom(messagingDialogAtom)
  const { t } = useTranslation()

  const close = () => setState({ kind: 'closed' })

  // Subscribe to binding-changed pushes only while the user is waiting on
  // a pairing code. The check needs the *latest* state values, so we capture
  // them via a ref to keep the subscription effect stable.
  const stateRef = React.useRef(state)
  stateRef.current = state

  const isWaitingForPair = state.kind === 'pairing' && state.code !== null
  React.useEffect(() => {
    if (!isWaitingForPair) return
    const off = window.electronAPI.onMessagingBindingChanged(async () => {
      const current = stateRef.current
      if (current.kind !== 'pairing' || current.code === null) return
      try {
        const bindings = await window.electronAPI.getMessagingBindings()
        const bound = bindings.some(
          (b) =>
            b.enabled &&
            b.sessionId === current.sessionId &&
            b.platform === current.platform,
        )
        if (bound) {
          toast.success(t('toast.messagingPaired'))
          setState({ kind: 'closed' })
        }
      } catch {
        // If we can't verify, leave the dialog open — user can still close it.
      }
    })
    return off
  }, [isWaitingForPair, setState, t])

  const openPairing = async (sessionId: string, platform: 'telegram' | 'whatsapp') => {
    setState({
      kind: 'pairing',
      platform,
      sessionId,
      code: null,
      expiresAt: null,
    })
    try {
      const result = await window.electronAPI.generateMessagingPairingCode(sessionId, platform)
      setState({
        kind: 'pairing',
        platform,
        sessionId,
        code: result.code,
        expiresAt: result.expiresAt,
        botUsername: result.botUsername,
      })
    } catch (err) {
      setState({
        kind: 'pairing',
        platform,
        sessionId,
        code: null,
        expiresAt: null,
        error: classifyMessagingError(err),
      })
    }
  }

  const handleWhatsAppConnected = () => {
    if (state.kind === 'wa_connect' && state.continueToPairingSessionId) {
      void openPairing(state.continueToPairingSessionId, 'whatsapp')
      return
    }
    close()
  }

  return (
    <>
      <PairingCodeDialog
        open={state.kind === 'pairing'}
        onOpenChange={(o) => { if (!o) close() }}
        platform={state.kind === 'pairing' ? state.platform : 'telegram'}
        code={state.kind === 'pairing' ? state.code : null}
        expiresAt={state.kind === 'pairing' ? state.expiresAt : null}
        botUsername={state.kind === 'pairing' ? state.botUsername : undefined}
        error={state.kind === 'pairing' ? state.error : undefined}
      />
      <WhatsAppConnectDialog
        open={state.kind === 'wa_connect'}
        onOpenChange={(o) => { if (!o) close() }}
        onConnected={handleWhatsAppConnected}
      />
    </>
  )
}

function classifyMessagingError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err)
  if (/not connected/i.test(msg)) {
    return 'WhatsApp is not connected yet. Reconnect it in Settings → Messaging and try again.'
  }
  if (/rate.?limit/i.test(msg)) {
    return 'Too many pairing code requests. Please wait a moment and try again.'
  }
  return msg
}
