import * as React from 'react'
import { Bot, FileArchive, Globe2, PencilLine, Upload } from 'lucide-react'
import { deriveSkillSlug } from '@craft-agent/shared/skills'
import type { CreateSkillResult, DiscoveredSkill } from '../../../shared/types'
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
import { SkillPicker, type RowStatus } from './SkillPicker'

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

// ── Shared phase type used by both Upload and Remote tabs ─────────────────────

type ImportPhase =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'single'; skill: DiscoveredSkill }
  | { kind: 'picker'; skills: DiscoveredSkill[] }
  | { kind: 'installing'; skills: DiscoveredSkill[]; statuses: Map<string, RowStatus> }
  | { kind: 'conflict'; skill: DiscoveredSkill; remaining: DiscoveredSkill[] }

export function SkillImportModal({
  open,
  onOpenChange,
  workspaceId,
  workspaceRootPath,
  onSkillInstalled,
}: SkillImportModalProps) {
  // ── Create tab state ──────────────────────────────────────────────────────
  const [name, setName] = React.useState('')
  const [description, setDescription] = React.useState('')
  const [content, setContent] = React.useState('')
  const [isSubmitting, setIsSubmitting] = React.useState(false)
  const [pendingOverwrite, setPendingOverwrite] = React.useState<PendingSkill | null>(null)
  const slug = deriveSkillSlug(name)
  const canSubmit = slug.length > 0 && description.trim().length > 0 && content.trim().length > 0

  // ── Upload tab state ──────────────────────────────────────────────────────
  const [uploadPhase, setUploadPhase] = React.useState<ImportPhase>({ kind: 'idle' })
  const [isDragOver, setIsDragOver] = React.useState(false)
  const fileInputRef = React.useRef<HTMLInputElement>(null)

  // ── Remote tab state ──────────────────────────────────────────────────────
  const [remoteInput, setRemoteInput] = React.useState('')
  const [remotePhase, setRemotePhase] = React.useState<ImportPhase>({ kind: 'idle' })

  const resetCreateForm = React.useCallback(() => {
    setName('')
    setDescription('')
    setContent('')
    setPendingOverwrite(null)
  }, [])

  const resetUpload = React.useCallback(() => {
    setUploadPhase({ kind: 'idle' })
    setIsDragOver(false)
  }, [])

  const resetRemote = React.useCallback(() => {
    setRemoteInput('')
    setRemotePhase({ kind: 'idle' })
  }, [])

  const closeModal = React.useCallback(() => {
    resetCreateForm()
    resetUpload()
    resetRemote()
    onOpenChange(false)
  }, [onOpenChange, resetCreateForm, resetUpload, resetRemote])

  const finishInstall = React.useCallback(async (installedSlug: string) => {
    closeModal()
    await onSkillInstalled(installedSlug)
  }, [closeModal, onSkillInstalled])

  // ── Create tab ────────────────────────────────────────────────────────────

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

  // ── Upload tab ────────────────────────────────────────────────────────────

  const installSingleSkill = React.useCallback(async (skill: DiscoveredSkill) => {
    const result: CreateSkillResult = await window.electronAPI.createSkill(
      workspaceId,
      skill.slug,
      skill.metadata,
      skill.content
    )
    if ('conflict' in result) {
      setUploadPhase({ kind: 'conflict', skill, remaining: [] })
      return
    }
    await finishInstall(skill.slug)
  }, [finishInstall, workspaceId])

  const processZipFile = React.useCallback(async (file: File) => {
    const filePath = window.electronAPI.getFilePath?.(file)
    if (!filePath) {
      setUploadPhase({ kind: 'error', message: 'Could not determine file path.' })
      return
    }

    setUploadPhase({ kind: 'loading' })
    try {
      const skills = await window.electronAPI.extractSkillsFromZip(filePath)
      if (skills.length === 0) {
        setUploadPhase({ kind: 'error', message: 'No skills found in this zip.' })
        return
      }
      if (skills.length === 1) {
        setUploadPhase({ kind: 'single', skill: skills[0] })
        await installSingleSkill(skills[0])
      } else {
        setUploadPhase({ kind: 'picker', skills })
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setUploadPhase({ kind: 'error', message })
    }
  }, [installSingleSkill])

  const runInstallPhase = React.useCallback(async (
    skills: DiscoveredSkill[],
    overwriteSlugs: Set<string>,
    preInstalled: Set<string>
  ) => {
    const statuses = new Map<string, RowStatus>(skills.map(s => [
      s.slug,
      preInstalled.has(s.slug) ? 'done' : 'pending',
    ]))
    setUploadPhase({ kind: 'installing', skills, statuses: new Map(statuses) })

    for (const skill of skills) {
      if (preInstalled.has(skill.slug)) continue
      statuses.set(skill.slug, 'installing')
      setUploadPhase({ kind: 'installing', skills, statuses: new Map(statuses) })
      try {
        if (overwriteSlugs.has(skill.slug)) {
          await window.electronAPI.forceWriteSkill(workspaceId, skill.slug, skill.metadata, skill.content)
        } else {
          await window.electronAPI.createSkill(workspaceId, skill.slug, skill.metadata, skill.content)
        }
        statuses.set(skill.slug, 'done')
      } catch {
        statuses.set(skill.slug, 'failed')
      }
      setUploadPhase({ kind: 'installing', skills, statuses: new Map(statuses) })
    }

    closeModal()
    await onSkillInstalled(skills[0].slug)
  }, [closeModal, onSkillInstalled, workspaceId])

  const handlePickerConfirm = React.useCallback(async (selected: DiscoveredSkill[]) => {
    if (selected.length === 0) return

    // Pre-check conflicts; createSkill installs non-conflicting skills as a side effect
    const conflicting: DiscoveredSkill[] = []
    const preInstalled = new Set<string>()
    for (const skill of selected) {
      const result: CreateSkillResult = await window.electronAPI.createSkill(
        workspaceId,
        skill.slug,
        skill.metadata,
        skill.content
      )
      if ('conflict' in result) {
        conflicting.push(skill)
      } else {
        preInstalled.add(skill.slug)
      }
    }

    if (conflicting.length > 0) {
      const [first, ...rest] = conflicting
      setUploadPhase({ kind: 'conflict', skill: first, remaining: rest })
      return
    }

    await runInstallPhase(selected, new Set(), preInstalled)
  }, [runInstallPhase, workspaceId])

  const handleConflictOverwrite = React.useCallback(async () => {
    if (uploadPhase.kind !== 'conflict') return
    const { skill, remaining } = uploadPhase
    await window.electronAPI.forceWriteSkill(workspaceId, skill.slug, skill.metadata, skill.content)
    if (remaining.length > 0) {
      const [next, ...rest] = remaining
      setUploadPhase({ kind: 'conflict', skill: next, remaining: rest })
    } else {
      closeModal()
      await onSkillInstalled(skill.slug)
    }
  }, [closeModal, onSkillInstalled, uploadPhase, workspaceId])

  const handleConflictSkip = React.useCallback(async () => {
    if (uploadPhase.kind !== 'conflict') return
    const { remaining } = uploadPhase
    if (remaining.length > 0) {
      const [next, ...rest] = remaining
      setUploadPhase({ kind: 'conflict', skill: next, remaining: rest })
    } else {
      closeModal()
    }
  }, [closeModal, uploadPhase])

  // ── Remote tab ────────────────────────────────────────────────────────────

  const installSingleRemoteSkill = React.useCallback(async (skill: DiscoveredSkill) => {
    const result: CreateSkillResult = await window.electronAPI.createSkill(
      workspaceId, skill.slug, skill.metadata, skill.content
    )
    if ('conflict' in result) {
      setRemotePhase({ kind: 'conflict', skill, remaining: [] })
      return
    }
    await finishInstall(skill.slug)
  }, [finishInstall, workspaceId])

  const runRemoteInstallPhase = React.useCallback(async (
    skills: DiscoveredSkill[],
    overwriteSlugs: Set<string>,
    preInstalled: Set<string>
  ) => {
    const statuses = new Map<string, RowStatus>(skills.map(s => [
      s.slug,
      preInstalled.has(s.slug) ? 'done' : 'pending',
    ]))
    setRemotePhase({ kind: 'installing', skills, statuses: new Map(statuses) })

    for (const skill of skills) {
      if (preInstalled.has(skill.slug)) continue
      statuses.set(skill.slug, 'installing')
      setRemotePhase({ kind: 'installing', skills, statuses: new Map(statuses) })
      try {
        if (overwriteSlugs.has(skill.slug)) {
          await window.electronAPI.forceWriteSkill(workspaceId, skill.slug, skill.metadata, skill.content)
        } else {
          await window.electronAPI.createSkill(workspaceId, skill.slug, skill.metadata, skill.content)
        }
        statuses.set(skill.slug, 'done')
      } catch {
        statuses.set(skill.slug, 'failed')
      }
      setRemotePhase({ kind: 'installing', skills, statuses: new Map(statuses) })
    }

    closeModal()
    await onSkillInstalled(skills[0].slug)
  }, [closeModal, onSkillInstalled, workspaceId])

  const handleRemotePickerConfirm = React.useCallback(async (selected: DiscoveredSkill[]) => {
    if (selected.length === 0) return

    const conflicting: DiscoveredSkill[] = []
    const preInstalled = new Set<string>()
    for (const skill of selected) {
      const result: CreateSkillResult = await window.electronAPI.createSkill(
        workspaceId, skill.slug, skill.metadata, skill.content
      )
      if ('conflict' in result) {
        conflicting.push(skill)
      } else {
        preInstalled.add(skill.slug)
      }
    }

    if (conflicting.length > 0) {
      const [first, ...rest] = conflicting
      setRemotePhase({ kind: 'conflict', skill: first, remaining: rest })
      return
    }

    await runRemoteInstallPhase(selected, new Set(), preInstalled)
  }, [runRemoteInstallPhase, workspaceId])

  const handleRemoteConflictOverwrite = React.useCallback(async () => {
    if (remotePhase.kind !== 'conflict') return
    const { skill, remaining } = remotePhase
    await window.electronAPI.forceWriteSkill(workspaceId, skill.slug, skill.metadata, skill.content)
    if (remaining.length > 0) {
      const [next, ...rest] = remaining
      setRemotePhase({ kind: 'conflict', skill: next, remaining: rest })
    } else {
      closeModal()
      await onSkillInstalled(skill.slug)
    }
  }, [closeModal, onSkillInstalled, remotePhase, workspaceId])

  const handleRemoteConflictSkip = React.useCallback(async () => {
    if (remotePhase.kind !== 'conflict') return
    const { remaining } = remotePhase
    if (remaining.length > 0) {
      const [next, ...rest] = remaining
      setRemotePhase({ kind: 'conflict', skill: next, remaining: rest })
    } else {
      closeModal()
    }
  }, [closeModal, remotePhase])

  const handleRemoteResolve = React.useCallback(async () => {
    const input = remoteInput.trim()
    if (!input) return

    setRemotePhase({ kind: 'loading' })
    try {
      const result = await window.electronAPI.resolveRemoteSkills(input)
      if ('error' in result) {
        setRemotePhase({ kind: 'error', message: result.error })
        return
      }
      if (result.length === 0) {
        setRemotePhase({ kind: 'error', message: 'No skills found in this repository.' })
        return
      }
      if (result.length === 1) {
        setRemotePhase({ kind: 'single', skill: result[0] })
        await installSingleRemoteSkill(result[0])
      } else {
        setRemotePhase({ kind: 'picker', skills: result })
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setRemotePhase({ kind: 'error', message })
    }
  }, [installSingleRemoteSkill, remoteInput])

  function handleFileInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) void processZipFile(file)
    e.target.value = ''
  }

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault()
    setIsDragOver(true)
  }

  function handleDragLeave() {
    setIsDragOver(false)
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    setIsDragOver(false)
    const file = e.dataTransfer.files[0]
    if (file) void processZipFile(file)
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <>
      <Dialog open={open} onOpenChange={(isOpen) => {
        if (!isOpen) {
          resetCreateForm()
          resetUpload()
          resetRemote()
        }
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
              <RemoteTabContent
                phase={remotePhase}
                input={remoteInput}
                onInputChange={setRemoteInput}
                onResolve={() => void handleRemoteResolve()}
                onPickerConfirm={handleRemotePickerConfirm}
                onPickerCancel={closeModal}
                onReset={resetRemote}
              />
            </TabsContent>

            <TabsContent value="upload" className="mt-4">
              <UploadTabContent
                phase={uploadPhase}
                isDragOver={isDragOver}
                fileInputRef={fileInputRef}
                onFileInputChange={handleFileInputChange}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                onPickerConfirm={handlePickerConfirm}
                onPickerCancel={closeModal}
                onReset={resetUpload}
              />
            </TabsContent>
          </Tabs>
        </DialogContent>
      </Dialog>

      {/* Create tab overwrite dialog */}
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

      {/* Upload tab conflict dialog */}
      <Dialog
        open={uploadPhase.kind === 'conflict'}
        onOpenChange={(isOpen) => { if (!isOpen) void handleConflictSkip() }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Overwrite skill?</DialogTitle>
            <DialogDescription>
              {uploadPhase.kind === 'conflict'
                ? `"${uploadPhase.skill.metadata.name}" already exists. Overwrite it?`
                : ''}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => void handleConflictSkip()}>Skip</Button>
            <Button variant="destructive" onClick={() => void handleConflictOverwrite()}>
              Overwrite
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Remote tab conflict dialog */}
      <Dialog
        open={remotePhase.kind === 'conflict'}
        onOpenChange={(isOpen) => { if (!isOpen) void handleRemoteConflictSkip() }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Overwrite skill?</DialogTitle>
            <DialogDescription>
              {remotePhase.kind === 'conflict'
                ? `"${remotePhase.skill.metadata.name}" already exists. Overwrite it?`
                : ''}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => void handleRemoteConflictSkip()}>Skip</Button>
            <Button variant="destructive" onClick={() => void handleRemoteConflictOverwrite()}>
              Overwrite
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

// ── Remote tab sub-component ─────────────────────────────────────────────────

interface RemoteTabContentProps {
  phase: ImportPhase
  input: string
  onInputChange: (value: string) => void
  onResolve: () => void
  onPickerConfirm: (selected: DiscoveredSkill[]) => void
  onPickerCancel: () => void
  onReset: () => void
}

function RemoteTabContent({
  phase,
  input,
  onInputChange,
  onResolve,
  onPickerConfirm,
  onPickerCancel,
  onReset,
}: RemoteTabContentProps) {
  if (phase.kind === 'picker') {
    return (
      <SkillPicker
        skills={phase.skills}
        onConfirm={onPickerConfirm}
        onCancel={onPickerCancel}
      />
    )
  }

  if (phase.kind === 'installing') {
    return (
      <SkillPicker
        skills={phase.skills}
        onConfirm={() => {}}
        onCancel={() => {}}
        installing
        rowStatuses={phase.statuses}
      />
    )
  }

  if (phase.kind === 'error') {
    return (
      <div className="flex flex-col items-center gap-3 rounded-md border border-dashed border-destructive/30 bg-destructive/5 p-6 text-center">
        <p className="text-sm text-destructive">{phase.message}</p>
        <Button variant="outline" size="sm" onClick={onReset}>Try again</Button>
      </div>
    )
  }

  if (phase.kind === 'loading' || phase.kind === 'single') {
    return (
      <div className="flex min-h-48 items-center justify-center rounded-md border border-dashed border-foreground/15 bg-foreground/[0.02] text-sm text-muted-foreground">
        Resolving…
      </div>
    )
  }

  // idle
  return (
    <div className="space-y-3">
      <div className="grid gap-2">
        <label className="text-sm font-medium" htmlFor="remote-url">
          GitHub shorthand, URL, or git remote
        </label>
        <div className="flex gap-2">
          <Input
            id="remote-url"
            value={input}
            onChange={(e) => onInputChange(e.target.value)}
            placeholder="owner/repo  or  https://github.com/owner/repo"
            onKeyDown={(e) => { if (e.key === 'Enter') onResolve() }}
          />
          <Button onClick={onResolve} disabled={!input.trim()}>
            Resolve
          </Button>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        Supports GitHub, GitLab, or any git remote (requires git for non-GitHub/GitLab URLs).
      </p>
    </div>
  )
}

// ── Upload tab sub-component ─────────────────────────────────────────────────

interface UploadTabContentProps {
  phase: ImportPhase
  isDragOver: boolean
  fileInputRef: React.RefObject<HTMLInputElement>
  onFileInputChange: (e: React.ChangeEvent<HTMLInputElement>) => void
  onDragOver: (e: React.DragEvent) => void
  onDragLeave: () => void
  onDrop: (e: React.DragEvent) => void
  onPickerConfirm: (selected: DiscoveredSkill[]) => void
  onPickerCancel: () => void
  onReset: () => void
}

function UploadTabContent({
  phase,
  isDragOver,
  fileInputRef,
  onFileInputChange,
  onDragOver,
  onDragLeave,
  onDrop,
  onPickerConfirm,
  onPickerCancel,
  onReset,
}: UploadTabContentProps) {
  if (phase.kind === 'picker') {
    return (
      <SkillPicker
        skills={phase.skills}
        onConfirm={onPickerConfirm}
        onCancel={onPickerCancel}
      />
    )
  }

  if (phase.kind === 'installing') {
    return (
      <SkillPicker
        skills={phase.skills}
        onConfirm={() => {}}
        onCancel={() => {}}
        installing
        rowStatuses={phase.statuses}
      />
    )
  }

  if (phase.kind === 'error') {
    return (
      <div className="flex flex-col items-center gap-3 rounded-md border border-dashed border-destructive/30 bg-destructive/5 p-6 text-center">
        <p className="text-sm text-destructive">{phase.message}</p>
        <Button variant="outline" size="sm" onClick={onReset}>Try again</Button>
      </div>
    )
  }

  if (phase.kind === 'loading' || phase.kind === 'single') {
    return (
      <div className="flex min-h-48 items-center justify-center rounded-md border border-dashed border-foreground/15 bg-foreground/[0.02] text-sm text-muted-foreground">
        Reading zip…
      </div>
    )
  }

  // idle
  return (
    <div
      className={`flex min-h-48 flex-col items-center justify-center gap-3 rounded-md border border-dashed transition-colors ${
        isDragOver
          ? 'border-foreground/40 bg-foreground/[0.04]'
          : 'border-foreground/15 bg-foreground/[0.02]'
      }`}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <Upload className="h-8 w-8 text-muted-foreground/50" />
      <p className="text-sm text-muted-foreground">
        Drag a <span className="font-medium">.zip</span> file here, or
      </p>
      <Button
        variant="outline"
        size="sm"
        onClick={() => fileInputRef.current?.click()}
      >
        Browse
      </Button>
      <input
        ref={fileInputRef}
        type="file"
        accept=".zip"
        className="sr-only"
        onChange={onFileInputChange}
      />
    </div>
  )
}
