import { useTranslation } from 'react-i18next'
import { MousePointer2 } from 'lucide-react'
import { toast } from 'sonner'
import { useMenuComponents } from '@/components/ui/menu-context'
import { useOptionalAppShellContext } from '@/context/AppShellContext'
import { isCraftyTarget, useCraftyTarget } from '@/hooks/useCraftyTarget'

/**
 * "Send Crafty Here" in a session's menu (dropdown and right-click): Crafty's questions land in this
 * session until you stop it here, pick another one, or archive this one. Only while Crafty is on,
 * and only for a local workspace's session, the one kind main accepts (a remote session runs on
 * another machine and carries that server's workspace id, which matches no local workspace).
 */
export function SendCraftyHereMenuItem({ sessionId, workspaceId, isArchived }: {
  sessionId: string
  workspaceId: string | undefined
  isArchived: boolean
}) {
  const { t } = useTranslation()
  const { MenuItem } = useMenuComponents()
  const { available, target, setTarget } = useCraftyTarget({ refreshOnMount: true })
  const workspaces = useOptionalAppShellContext()?.workspaces
  const isLocal = !workspaces || workspaces.some(w => w.id === workspaceId && !w.remoteServer)
  if (!available || !workspaceId || isArchived || !isLocal) return null

  const isTarget = isCraftyTarget(target, workspaceId, sessionId)
  const toggle = () => {
    setTarget(isTarget ? null : { workspaceId, sessionId })
      .catch((error: unknown) => toast.error(error instanceof Error ? error.message : String(error)))
  }

  return (
    <MenuItem onClick={toggle}>
      <MousePointer2 className="h-3.5 w-3.5" />
      <span className="flex-1">{t(isTarget ? 'sessionMenu.stopSendingCraftyHere' : 'sessionMenu.sendCraftyHere')}</span>
    </MenuItem>
  )
}
