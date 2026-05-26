import * as React from 'react'
import { useAtom, useAtomValue } from 'jotai'
import { toast } from 'sonner'
import { sessionMetaMapAtom } from '@/atoms/sessions'
import { sessionProjectDialogAtom } from '@/atoms/session-project-dialog'
import { RenameDialog } from '@/components/ui/rename-dialog'
import { setSessionProjectLabel, slugifyProjectName } from '@/utils/session-project'

interface SessionProjectDialogHostProps {
  onLabelsChange: (sessionId: string, labels: string[]) => void
}

export function SessionProjectDialogHost({ onLabelsChange }: SessionProjectDialogHostProps) {
  const [state, setState] = useAtom(sessionProjectDialogAtom)
  const sessionMetaMap = useAtomValue(sessionMetaMapAtom)
  const [projectName, setProjectName] = React.useState('')

  const open = state.kind === 'new_project'
  const session = open ? sessionMetaMap.get(state.sessionId) : undefined

  React.useEffect(() => {
    if (open) setProjectName('')
  }, [open])

  const close = React.useCallback(() => {
    setState({ kind: 'closed' })
  }, [setState])

  const handleSubmit = React.useCallback(() => {
    if (!session || state.kind !== 'new_project') return
    const slug = slugifyProjectName(projectName)
    if (!slug) {
      toast.error('Project name needs at least one letter or number.')
      return
    }
    onLabelsChange(state.sessionId, setSessionProjectLabel(session.labels ?? [], slug))
    close()
  }, [close, onLabelsChange, projectName, session, state])

  return (
    <RenameDialog
      open={open}
      onOpenChange={(nextOpen) => { if (!nextOpen) close() }}
      title="New Project"
      value={projectName}
      onValueChange={setProjectName}
      onSubmit={handleSubmit}
      placeholder="Project name"
    />
  )
}
