import { useAtom } from 'jotai'
import { useCallback, useMemo, useState } from 'react'
import type { Workspace } from '../../shared/types'
import { windowWorkspaceIdAtom } from '../atoms/sessions'

export function useWorkspaceController() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [activeWorkspaceId, setActiveWorkspaceId] = useAtom(windowWorkspaceIdAtom)

  const activeWorkspaceSlug = useMemo(() => {
    if (!activeWorkspaceId) return null
    return workspaces.find(workspace => workspace.id === activeWorkspaceId)?.slug ?? activeWorkspaceId
  }, [activeWorkspaceId, workspaces])

  const remoteWorkspaceId = useMemo(() => {
    if (!activeWorkspaceId) return null
    return workspaces.find(workspace => workspace.id === activeWorkspaceId)?.remoteServer?.remoteWorkspaceId ?? null
  }, [activeWorkspaceId, workspaces])

  const refreshWorkspaces = useCallback(async () => {
    const nextWorkspaces = await window.electronAPI.getWorkspaces()
    setWorkspaces(nextWorkspaces)
    return nextWorkspaces
  }, [])

  const selectWorkspace = useCallback(async (
    workspaceId: string,
    options: {
      openInNewWindow?: boolean
      onCurrentWindowSwitch?: () => void
    } = {},
  ) => {
    if (workspaceId === activeWorkspaceId) return false

    if (options.openInNewWindow) {
      window.electronAPI.openWorkspace(workspaceId)
      return true
    }

    await window.electronAPI.switchWorkspace(workspaceId)
    setActiveWorkspaceId(workspaceId)
    options.onCurrentWindowSwitch?.()
    return true
  }, [activeWorkspaceId, setActiveWorkspaceId])

  const selectWorkspaceBySlug = useCallback((
    slug: string,
    onCurrentWindowSwitch?: () => void,
  ) => {
    const target = workspaces.find(workspace => workspace.slug === slug)
    if (target) void selectWorkspace(target.id, { onCurrentWindowSwitch })
  }, [selectWorkspace, workspaces])

  return {
    activeWorkspaceId,
    activeWorkspaceSlug,
    refreshWorkspaces,
    remoteWorkspaceId,
    selectWorkspace,
    selectWorkspaceBySlug,
    setActiveWorkspaceId,
    setWorkspaces,
    workspaces,
  }
}
