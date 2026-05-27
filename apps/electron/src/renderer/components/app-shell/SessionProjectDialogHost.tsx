import * as React from 'react'
import { useAtom, useAtomValue } from 'jotai'
import { toast } from 'sonner'
import { sessionMetaMapAtom } from '@/atoms/sessions'
import { sessionProjectDialogAtom } from '@/atoms/session-project-dialog'
import { RenameDialog } from '@/components/ui/rename-dialog'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { getSessionProjectInfo, setSessionProjectLabel, slugifyProjectName } from '@/utils/session-project'

interface SessionProjectDialogHostProps {
  onLabelsChange: (sessionId: string, labels: string[]) => Promise<boolean>
}

export function SessionProjectDialogHost({ onLabelsChange }: SessionProjectDialogHostProps) {
  const [state, setState] = useAtom(sessionProjectDialogAtom)
  const sessionMetaMap = useAtomValue(sessionMetaMapAtom)
  const [projectName, setProjectName] = React.useState('')

  const renameOpen = state.kind === 'rename_project'
  const createOpen = state.kind === 'new_project'
  const deleteOpen = state.kind === 'delete_project'
  const session = createOpen ? sessionMetaMap.get(state.sessionId) : undefined

  React.useEffect(() => {
    if (createOpen) setProjectName('')
    if (renameOpen) setProjectName(state.projectLabel)
  }, [createOpen, renameOpen, state])

  const close = React.useCallback(() => {
    setState({ kind: 'closed' })
  }, [setState])

  const handleSubmit = React.useCallback(async () => {
    if (!session || state.kind !== 'new_project') return
    const slug = slugifyProjectName(projectName)
    if (!slug) {
      toast.error('Project name needs at least one letter or number.')
      return
    }
    const ok = await onLabelsChange(state.sessionId, setSessionProjectLabel(session.labels ?? [], slug))
    if (ok) close()
    else toast.error('Failed to create project.')
  }, [close, onLabelsChange, projectName, session, state])

  const handleRenameProject = React.useCallback(async () => {
    if (state.kind !== 'rename_project') return
    const nextSlug = slugifyProjectName(projectName)
    if (!nextSlug) {
      toast.error('Project name needs at least one letter or number.')
      return
    }

    const updates: Array<Promise<boolean>> = []
    for (const item of sessionMetaMap.values()) {
      const project = getSessionProjectInfo(item)
      if (project.key !== state.projectKey) continue
      updates.push(onLabelsChange(item.id, setSessionProjectLabel(item.labels ?? [], nextSlug)))
    }
    if (updates.length === 0) {
      toast.error('No sessions found for this project.')
      close()
      return
    }

    const results = await Promise.all(updates)
    const changed = results.filter(Boolean).length
    const failed = results.length - changed
    if (failed > 0) {
      toast.error('Project rename incomplete.', { description: `${changed} moved, ${failed} failed.` })
      return
    }

    toast.success('Renamed project', { description: `${changed} session${changed === 1 ? '' : 's'} moved.` })
    if (changed > 0) close()
  }, [close, onLabelsChange, projectName, sessionMetaMap, state])

  const handleDeleteProject = React.useCallback(async () => {
    if (state.kind !== 'delete_project') return

    const updates: Array<Promise<boolean>> = []
    for (const item of sessionMetaMap.values()) {
      const project = getSessionProjectInfo(item)
      if (project.key !== state.projectKey) continue
      updates.push(onLabelsChange(item.id, setSessionProjectLabel(item.labels ?? [], undefined)))
    }
    if (updates.length === 0) {
      toast.error('No sessions found for this project.')
      close()
      return
    }

    const results = await Promise.all(updates)
    const changed = results.filter(Boolean).length
    const failed = results.length - changed
    if (failed > 0) {
      toast.error('Project delete incomplete.', { description: `${changed} moved, ${failed} failed.` })
      return
    }

    toast.success('Deleted project', { description: `${changed} session${changed === 1 ? '' : 's'} moved to General.` })
    if (changed > 0) close()
  }, [close, onLabelsChange, sessionMetaMap, state])

  return (
    <>
      <RenameDialog
        open={createOpen}
        onOpenChange={(nextOpen) => { if (!nextOpen) close() }}
        title="New Project"
        value={projectName}
        onValueChange={setProjectName}
        onSubmit={handleSubmit}
        placeholder="Project name"
      />
      <RenameDialog
        open={renameOpen}
        onOpenChange={(nextOpen) => { if (!nextOpen) close() }}
        title="Rename Project"
        value={projectName}
        onValueChange={setProjectName}
        onSubmit={handleRenameProject}
        placeholder="Project name"
      />
      <Dialog open={deleteOpen} onOpenChange={(nextOpen) => { if (!nextOpen) close() }}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle>Delete Project</DialogTitle>
            <DialogDescription>
              Move every session in {state.kind === 'delete_project' ? state.projectLabel : 'this project'} back to General.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={close}>Cancel</Button>
            <Button variant="destructive" onClick={handleDeleteProject}>Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
