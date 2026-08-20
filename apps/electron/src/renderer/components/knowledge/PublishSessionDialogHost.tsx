/**
 * PublishSessionDialogHost — AppShell-level host so the publish dialog survives
 * context-menu / dropdown close (same pattern as MessagingDialogHost).
 */
import { useAtom } from 'jotai'
import { publishSessionDialogAtom } from '@/atoms/knowledge-publish'
import { PublishSessionDialog } from './PublishSessionDialog'

export function PublishSessionDialogHost() {
  const [state, setState] = useAtom(publishSessionDialogAtom)

  return (
    <PublishSessionDialog
      open={state.open}
      sessionId={state.open ? state.sessionId : ''}
      connectionId={state.open ? state.connectionId : undefined}
      runIds={state.open ? state.runIds : undefined}
      onOpenChange={(open) => {
        if (!open) setState({ open: false })
      }}
    />
  )
}
