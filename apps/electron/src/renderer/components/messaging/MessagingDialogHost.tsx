/**
 * MessagingDialogHost
 *
 * Global host that owns the messaging pairing/connect dialogs so they survive
 * the close of the triggering context menu or dropdown.
 *
 * Mount once at AppShell level. State is driven by `messagingDialogAtom`.
 *
 * Why this exists:
 * Rendering <PairingCodeDialog> inside SessionMenu caused the dialog to be
 * unmounted together with the Radix ContextMenu subtree the moment the menu
 * closed after a click. The user experienced "nothing happens". Hoisting the
 * dialog out of that subtree is the root-cause fix.
 */

import { useAtom } from 'jotai'
import { messagingDialogAtom } from '@/atoms/messaging'
import { PairingCodeDialog } from './PairingCodeDialog'
import { WhatsAppConnectDialog } from './WhatsAppConnectDialog'

export function MessagingDialogHost() {
  const [state, setState] = useAtom(messagingDialogAtom)

  const close = () => setState({ kind: 'closed' })

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
      />
    </>
  )
}
