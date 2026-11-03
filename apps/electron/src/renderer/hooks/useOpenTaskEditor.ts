import * as React from 'react'
import { useSetAtom } from 'jotai'
import { kanbanEditorTargetAtom } from '@/atoms/kanban'
import { navigate, routes } from '@/lib/navigate'

/**
 * Opens the board's full-pane Task editor on a task session, prefilled from its task.yaml
 * (the chat header's Edit button and the task brief).
 */
export function useOpenTaskEditor() {
  const setKanbanEditorTarget = useSetAtom(kanbanEditorTargetAtom)
  return React.useCallback(
    (sessionId: string, taskSlug: string, title?: string) => {
      setKanbanEditorTarget({ mode: 'edit', sessionId, taskSlug, initialTitle: title })
      navigate(routes.view.board())
    },
    [setKanbanEditorTarget],
  )
}
