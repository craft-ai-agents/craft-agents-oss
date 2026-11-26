import { useTranslation } from 'react-i18next'
import { MousePointer2 } from 'lucide-react'
import { toast } from 'sonner'
import { useMenuComponents } from '@/components/ui/menu-context'
import { useOptionalAppShellContext } from '@/context/AppShellContext'
import { isCraftyTarget, useCraftyTarget } from '@/hooks/useCraftyTarget'
import { ipcErrorMessage } from '@/lib/ipc-error'

/**
 * "Send Crafty Here" in a session's menu (dropdown and right-click): Crafty's questions land in this
 * session until you stop it here, pick another one, or archive this one. Only while Crafty is on.
 * The target names the window's workspace, local or remote: a remote session carries its server's
 * workspace id, which matches no workspace in this app. `workspaceId`, the session's, is only the
 * fallback where there's no window shell.
 */
export function SendCraftyHereMenuItem({ sessionId, workspaceId, isArchived }: {
  sessionId: string
  workspaceId: string | undefined
  isArchived: boolean
}) {
  const { t } = useTranslation()
  const { MenuItem } = useMenuComponents()
  const { available, target, setTarget } = useCraftyTarget({ refreshOnMount: true })
  const targetWorkspaceId = useOptionalAppShellContext()?.activeWorkspaceId ?? workspaceId
  if (!available || !targetWorkspaceId || isArchived) return null

  const isTarget = isCraftyTarget(target, targetWorkspaceId, sessionId)
  const toggle = () => {
    setTarget(isTarget ? null : { workspaceId: targetWorkspaceId, sessionId })
      .catch((error: unknown) => toast.error(ipcErrorMessage(error)))
  }

  return (
    <MenuItem onClick={toggle}>
      <MousePointer2 className="h-3.5 w-3.5" />
      <span className="flex-1">{t(isTarget ? 'sessionMenu.stopSendingCraftyHere' : 'sessionMenu.sendCraftyHere')}</span>
    </MenuItem>
  )
}
