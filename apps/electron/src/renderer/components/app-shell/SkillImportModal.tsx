import * as React from 'react'
import { Bot, FileArchive, Globe2, PencilLine } from 'lucide-react'
import { deriveSkillSlug } from '@craft-agent/shared/skills'
import type { CreateSkillResult } from '../../../shared/types'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { EditPopover, getEditConfig } from '@/components/ui/EditPopover'

interface SkillImportModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  workspaceId: string
  workspaceRootPath: string
  onSkillInstalled: (slug: string) => void | Promise<void>
}

interface PendingSkill {
  slug: string
  name: string
  description: string
  content: string
}

function PlaceholderTab({ title }: { title: string }) {
  return (
    <div className="flex min-h-48 items-center justify-center rounded-md border border-dashed border-foreground/15 bg-foreground/[0.02] text-sm text-muted-foreground">
      {title} coming soon.
    </div>
  )
}

export function SkillImportModal({
  open,
  onOpenChange,
  workspaceId,
  workspaceRootPath,
  onSkillInstalled,
}: SkillImportModalProps) {
  const [name, setName] = React.useState('')
  const [description, setDescription] = React.useState('')
  const [content, setContent] = React.useState('')
  const [isSubmitting, setIsSubmitting] = React.useState(false)
  const [pendingOverwrite, setPendingOverwrite] = React.useState<PendingSkill | null>(null)
  const slug = deriveSkillSlug(name)
  const canSubmit = slug.length > 0 && description.trim().length > 0 && content.trim().length > 0

  const resetCreateForm = React.useCallback(() => {
    setName('')
    setDescription('')
    setContent('')
    setPendingOverwrite(null)
  }, [])

  const closeModal = React.useCallback(() => {
    resetCreateForm()
    onOpenChange(false)
  }, [onOpenChange, resetCreateForm])

  const finishInstall = React.useCallback(async (installedSlug: string) => {
    closeModal()
    await onSkillInstalled(installedSlug)
  }, [closeModal, onSkillInstalled])

  const submitCreate = React.useCallback(async () => {
    if (!canSubmit) return
    const nextSkill: PendingSkill = {
      slug,
      name: name.trim(),
      description: description.trim(),
      content: content.trim(),
    }

    setIsSubmitting(true)
    try {
      const result: CreateSkillResult = await window.electronAPI.createSkill(
        workspaceId,
        nextSkill.slug,
        {
          name: nextSkill.name,
          description: nextSkill.description,
        },
        nextSkill.content
      )
      if ('conflict' in result) {
        setPendingOverwrite(nextSkill)
        return
      }
      await finishInstall(nextSkill.slug)
    } finally {
      setIsSubmitting(false)
    }
  }, [canSubmit, content, description, finishInstall, name, slug, workspaceId])

  const confirmOverwrite = React.useCallback(async () => {
    if (!pendingOverwrite) return
    setIsSubmitting(true)
    try {
      await window.electronAPI.forceWriteSkill(
        workspaceId,
        pendingOverwrite.slug,
        {
          name: pendingOverwrite.name,
          description: pendingOverwrite.description,
        },
        pendingOverwrite.content
      )
      await finishInstall(pendingOverwrite.slug)
    } finally {
      setIsSubmitting(false)
    }
  }, [finishInstall, pendingOverwrite, workspaceId])

  return (
    <>
      <Dialog open={open} onOpenChange={(isOpen) => {
        if (!isOpen) resetCreateForm()
        onOpenChange(isOpen)
      }}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Import skill</DialogTitle>
            <DialogDescription>
              Create a workspace skill or use AI assistance.
            </DialogDescription>
          </DialogHeader>

          <Tabs defaultValue="create" className="w-full">
            <TabsList className="grid w-full grid-cols-4">
              <TabsTrigger value="create" className="gap-1.5">
                <PencilLine className="h-3.5 w-3.5" />
                Create
              </TabsTrigger>
              <TabsTrigger value="ai" className="gap-1.5">
                <Bot className="h-3.5 w-3.5" />
                AI Assist
              </TabsTrigger>
              <TabsTrigger value="remote" className="gap-1.5">
                <Globe2 className="h-3.5 w-3.5" />
                Remote
              </TabsTrigger>
              <TabsTrigger value="upload" className="gap-1.5">
                <FileArchive className="h-3.5 w-3.5" />
                Upload
              </TabsTrigger>
            </TabsList>

            <TabsContent value="create" className="mt-4 space-y-4">
              <div className="grid gap-2">
                <label className="text-sm font-medium" htmlFor="skill-name">Name</label>
                <Input
                  id="skill-name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Code Reviewer"
                />
              </div>
              <div className="grid gap-2">
                <label className="text-sm font-medium" htmlFor="skill-description">Description</label>
                <Input
                  id="skill-description"
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  placeholder="Reviews code for correctness"
                />
              </div>
              <div className="grid gap-2">
                <label className="text-sm font-medium" htmlFor="skill-content">Instructions</label>
                <textarea
                  id="skill-content"
                  value={content}
                  onChange={(event) => setContent(event.target.value)}
                  className="min-h-40 w-full resize-y rounded-md border border-foreground/15 bg-transparent px-3 py-2 text-sm outline-none transition-colors placeholder:text-muted-foreground focus-visible:ring-1 focus-visible:ring-foreground/30"
                  placeholder="Write the behavior, workflow, and constraints this skill should add."
                />
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={closeModal}>Cancel</Button>
                <Button onClick={submitCreate} disabled={!canSubmit || isSubmitting}>
                  Create skill
                </Button>
              </DialogFooter>
            </TabsContent>

            <TabsContent value="ai" className="mt-4">
              <div className="flex min-h-48 items-center justify-center rounded-md border border-foreground/10 bg-foreground/[0.02]">
                <EditPopover
                  modal={true}
                  trigger={<Button><Bot className="h-4 w-4" /> Open AI Assist</Button>}
                  {...getEditConfig('add-skill', workspaceRootPath)}
                />
              </div>
            </TabsContent>

            <TabsContent value="remote" className="mt-4">
              <PlaceholderTab title="Remote import" />
            </TabsContent>

            <TabsContent value="upload" className="mt-4">
              <PlaceholderTab title="Upload import" />
            </TabsContent>
          </Tabs>
        </DialogContent>
      </Dialog>

      <Dialog open={pendingOverwrite !== null} onOpenChange={(isOpen) => {
        if (!isOpen) setPendingOverwrite(null)
      }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Overwrite skill?</DialogTitle>
            <DialogDescription>
              A skill with this name already exists. Overwriting replaces its SKILL.md file.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingOverwrite(null)}>Cancel</Button>
            <Button variant="destructive" onClick={confirmOverwrite} disabled={isSubmitting}>
              Overwrite
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
