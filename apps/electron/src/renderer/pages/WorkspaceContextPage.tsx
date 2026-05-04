import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { DatabaseZap, FileText, GitBranch, Plus, Pencil, Trash2, Upload } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { useWorkspaceContext } from '@/hooks/useWorkspaceContext'
import { useAgents } from '@/hooks/useAgents'
import { useDirectoryPicker } from '@/hooks/useDirectoryPicker'
import { UserProfileDialog } from '@/components/agents/UserProfileDialog'
import { ServerDirectoryBrowser } from '@/components/ServerDirectoryBrowser'
import { cn } from '@/lib/utils'
import type { ContextDocDTO, ContextDocMetadata, SelfEditTargetInfo, WorkspaceSettings } from '../../shared/types'

type GoalStatus = 'active' | 'blocked' | 'paused' | 'done'
type GoalPriority = 'low' | 'normal' | 'high'

type ContextFilter = 'all' | 'goals'

interface WorkspaceContextPageProps {
  workspaceId: string
}

interface FormState {
  slug: string
  name: string
  description: string
  body: string
  routingMode: 'broadcast' | 'targeted'
  agents: string[]
  enabled: boolean
  goalEnabled: boolean
  status: GoalStatus
  priority: GoalPriority | ''
  deadline: string
}

interface ImportDraft {
  slug: string
  name: string
  description: string
  body: string
}

export default function WorkspaceContextPage({ workspaceId }: WorkspaceContextPageProps) {
  const { t } = useTranslation()
  const { docs, loading, error, upsert, remove } = useWorkspaceContext(workspaceId)
  const { activeAgents } = useAgents(workspaceId)
  const [editingDoc, setEditingDoc] = React.useState<ContextDocDTO | null>(null)
  const [importDraft, setImportDraft] = React.useState<ImportDraft | null>(null)
  const [dialogOpen, setDialogOpen] = React.useState(false)
  const fileInputRef = React.useRef<HTMLInputElement | null>(null)
  const [profileOpen, setProfileOpen] = React.useState(false)
  const [filter, setFilter] = React.useState<ContextFilter>('all')
  const [workingDirectory, setWorkingDirectory] = React.useState('')
  const [gitBranch, setGitBranch] = React.useState<string | null>(null)
  const [selfEditTarget, setSelfEditTarget] = React.useState<SelfEditTargetInfo | null>(null)

  React.useEffect(() => {
    let cancelled = false
    if (!workspaceId) return
    window.electronAPI.getWorkspaceSettings(workspaceId).then((settings) => {
      if (cancelled) return
      setWorkingDirectory(settings?.workingDirectory || '')
    }).catch(() => {
      if (!cancelled) setWorkingDirectory('')
    })
    return () => {
      cancelled = true
    }
  }, [workspaceId])

  React.useEffect(() => {
    let cancelled = false
    if (!workspaceId) return
    if (typeof window.electronAPI.getSelfEditTarget !== 'function') {
      setSelfEditTarget(null)
      return
    }
    window.electronAPI.getSelfEditTarget(workspaceId).then((target) => {
      if (!cancelled) setSelfEditTarget(target)
    }).catch(() => {
      if (!cancelled) setSelfEditTarget(null)
    })
    return () => {
      cancelled = true
    }
  }, [workspaceId])

  React.useEffect(() => {
    let cancelled = false
    if (!workingDirectory) {
      setGitBranch(null)
      return
    }
    window.electronAPI.getGitBranch(workingDirectory).then((branch) => {
      if (!cancelled) setGitBranch(branch)
    }).catch(() => {
      if (!cancelled) setGitBranch(null)
    })
    return () => {
      cancelled = true
    }
  }, [workingDirectory])

  const updateWorkspaceSetting = React.useCallback(
    async <K extends keyof WorkspaceSettings>(key: K, value: WorkspaceSettings[K]) => {
      if (!workspaceId) return false
      try {
        await window.electronAPI.updateWorkspaceSetting(workspaceId, key, value)
        return true
      } catch (err) {
        toast.error('Failed to update workspace setting', {
          description: err instanceof Error ? err.message : String(err),
        })
        return false
      }
    },
    [workspaceId],
  )

  const handleWorkingDirectorySelected = React.useCallback(async (path: string) => {
    const saved = await updateWorkspaceSetting('workingDirectory', path)
    if (saved) {
      setWorkingDirectory(path)
      toast.success('Connected workspace repo')
    }
  }, [updateWorkspaceSetting])

  const {
    pickDirectory: pickWorkingDirectory,
    showServerBrowser,
    serverBrowserMode,
    cancelServerBrowser,
    confirmServerBrowser,
  } = useDirectoryPicker(handleWorkingDirectorySelected)

  const clearWorkingDirectory = React.useCallback(async () => {
    const saved = await updateWorkspaceSetting('workingDirectory', undefined)
    if (saved) {
      setWorkingDirectory('')
      setGitBranch(null)
    }
  }, [updateWorkspaceSetting])

  const enabledChars = React.useMemo(() => (
    docs.filter((doc) => doc.metadata.enabled).reduce((sum, doc) => sum + doc.body.length, 0)
  ), [docs])
  const approxTokens = Math.ceil(enabledChars / 4)
  const tokenTone = approxTokens > 16000 ? 'red' : approxTokens > 8000 ? 'amber' : 'neutral'

  const visibleDocs = React.useMemo(() => {
    if (filter === 'goals') {
      return docs.filter((d) => Boolean((d.metadata as ContextDocMetadata).status))
    }
    return docs
  }, [docs, filter])

  const handleNew = () => {
    setEditingDoc(null)
    setImportDraft(null)
    setDialogOpen(true)
  }

  const handleEdit = (doc: ContextDocDTO) => {
    setEditingDoc(doc)
    setImportDraft(null)
    setDialogOpen(true)
  }

  const handleImportFile = async (file: File | undefined) => {
    if (!file) return
    const ext = file.name.split('.').pop()?.toLowerCase()
    if (!ext || !['md', 'markdown', 'txt'].includes(ext)) {
      toast.error('Use a markdown or text file')
      return
    }
    if (file.size > 2 * 1024 * 1024) {
      toast.error('Context file is too large', {
        description: 'Keep context imports under 2 MB so prompts stay usable.',
      })
      return
    }
    try {
      const body = await file.text()
      const baseName = file.name.replace(/\.[^/.]+$/, '').trim() || 'Imported context'
      const baseSlug = slugify(baseName) || 'imported-context'
      const existingSlugs = new Set(docs.map((doc) => doc.slug))
      let slug = baseSlug
      let index = 2
      while (existingSlugs.has(slug)) {
        slug = `${baseSlug}-${index}`
        index += 1
      }
      setEditingDoc(null)
      setImportDraft({
        slug,
        name: baseName,
        description: `Imported from ${file.name}`,
        body,
      })
      setDialogOpen(true)
    } catch (err) {
      toast.error('Failed to import context file', {
        description: err instanceof Error ? err.message : String(err),
      })
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const handleDelete = async (doc: ContextDocDTO) => {
    if (!confirm(`Delete "${doc.metadata.name}" from this workspace?`)) return
    try {
      const ok = await remove(doc.slug)
      if (ok) toast.success(`Deleted "${doc.metadata.name}"`)
    } catch (err) {
      toast.error('Failed to delete context doc', {
        description: err instanceof Error ? err.message : String(err),
      })
    }
  }

  return (
    <div className="flex flex-col h-full min-h-0 bg-background">
      <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-border/30">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <FileText className="h-4 w-4 text-muted-foreground" />
            <h1 className="text-base font-semibold">Workspace Context</h1>
            <TokenBadge tokens={approxTokens} tone={tokenTone} />
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            Markdown notes injected into agent prompts by routing rules.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button size="sm" variant="outline" onClick={() => setProfileOpen(true)}>
            <DatabaseZap className="h-3.5 w-3.5 mr-1.5" />
            Memory & Profile
          </Button>
          <Button size="sm" variant="outline" onClick={() => fileInputRef.current?.click()}>
            <Upload className="h-3.5 w-3.5 mr-1.5" />
            Import
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".md,.markdown,.txt,text/markdown,text/plain"
            className="hidden"
            onChange={(event) => void handleImportFile(event.target.files?.[0])}
          />
          <Button size="sm" onClick={handleNew}>
            <Plus className="h-3.5 w-3.5 mr-1.5" />
            New
          </Button>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-auto">
        {loading ? (
          <div className="h-full flex items-center justify-center text-sm text-muted-foreground">Loading context...</div>
        ) : error ? (
          <div className="m-5 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{error}</div>
        ) : docs.length === 0 ? (
          <div className="p-4 flex min-h-full flex-col">
            <div className="min-h-[360px] flex flex-col items-center justify-center gap-3 text-center text-muted-foreground">
              <FileText className="h-8 w-8 opacity-50" />
              <div>
                <p className="text-sm font-medium text-foreground">No workspace context yet</p>
                <p className="text-xs mt-1">Add project facts, preferences, or operating rules agents should know.</p>
              </div>
              <Button size="sm" onClick={handleNew}>Create context doc</Button>
            </div>
            <ConnectedRepoCard
              workingDirectory={workingDirectory}
              gitBranch={gitBranch}
              selfEditTarget={selfEditTarget}
              onConnect={pickWorkingDirectory}
              onClear={clearWorkingDirectory}
            />
          </div>
        ) : (
          <div className="p-4 flex min-h-full flex-col">
            <div className="mb-3 flex items-center gap-1.5">
              {(['all', 'goals'] as const).map((kind) => (
                <button
                  key={kind}
                  type="button"
                  onClick={() => setFilter(kind)}
                  className={cn(
                    'px-2.5 py-1 text-xs rounded-md border',
                    filter === kind
                      ? 'border-foreground/30 bg-foreground/5 text-foreground'
                      : 'border-border/40 text-foreground/60 hover:bg-foreground/5',
                  )}
                >
                  {kind === 'all'
                    ? t('workspaceContextPage.filterAll')
                    : t('workspaceContextPage.filterGoalsOnly')}
                </button>
              ))}
            </div>
            <div className="overflow-hidden rounded-md border border-border/40">
              <table className="w-full text-sm">
                <thead className="bg-foreground/[0.03] text-xs text-muted-foreground">
                  <tr>
                    <th className="text-left font-medium px-3 py-2">Name</th>
                    <th className="text-left font-medium px-3 py-2">Routing</th>
                    <th className="text-left font-medium px-3 py-2 w-28">Enabled</th>
                    <th className="text-right font-medium px-3 py-2 w-24">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleDocs.map((doc) => (
                    <tr key={doc.slug} className="border-t border-border/30">
                      <td className="px-3 py-2 min-w-0">
                        <div className="font-medium truncate">{doc.metadata.name}</div>
                        <div className="text-xs text-muted-foreground truncate">
                          <span className="font-mono">{doc.slug}</span>
                          {doc.metadata.description ? ` - ${doc.metadata.description}` : ''}
                        </div>
                        {filter === 'goals' && doc.metadata.status && (
                          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px]">
                            <span className="px-1.5 py-0.5 rounded bg-foreground/8 text-foreground/70">
                              {t(`workspaceContextPage.status${capitalize(doc.metadata.status)}`)}
                            </span>
                            {doc.metadata.priority && (
                              <span className="px-1.5 py-0.5 rounded bg-foreground/8 text-foreground/70">
                                {t(`workspaceContextPage.priority${capitalize(doc.metadata.priority)}`)}
                              </span>
                            )}
                            {doc.metadata.deadline && (
                              <span className="text-foreground/50">{doc.metadata.deadline}</span>
                            )}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">{routingSummary(doc)}</td>
                      <td className="px-3 py-2">
                        <input
                          type="checkbox"
                          checked={doc.metadata.enabled}
                          onChange={(event) => {
                            void upsert({
                              slug: doc.slug,
                              metadata: { ...doc.metadata, enabled: event.target.checked },
                              body: doc.body,
                            })
                          }}
                          className="h-4 w-4"
                          aria-label={`Toggle ${doc.metadata.name}`}
                        />
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            type="button"
                            onClick={() => handleEdit(doc)}
                            className="h-7 w-7 inline-flex items-center justify-center rounded-md hover:bg-foreground/5"
                            aria-label={`Edit ${doc.metadata.name}`}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleDelete(doc)}
                            className="h-7 w-7 inline-flex items-center justify-center rounded-md hover:bg-foreground/5 text-destructive"
                            aria-label={`Delete ${doc.metadata.name}`}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <ConnectedRepoCard
              workingDirectory={workingDirectory}
              gitBranch={gitBranch}
              selfEditTarget={selfEditTarget}
              onConnect={pickWorkingDirectory}
              onClear={clearWorkingDirectory}
            />
          </div>
        )}
      </div>

      <WorkspaceContextEditDialog
        open={dialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open)
          if (!open) setImportDraft(null)
        }}
        doc={editingDoc}
        importDraft={importDraft}
        activeAgents={activeAgents}
        onSave={async (input) => {
          await upsert(input)
          setImportDraft(null)
          setDialogOpen(false)
        }}
      />
      <UserProfileDialog open={profileOpen} onOpenChange={setProfileOpen} />
      <ServerDirectoryBrowser
        open={showServerBrowser}
        mode={serverBrowserMode}
        onSelect={confirmServerBrowser}
        onCancel={cancelServerBrowser}
        initialPath={workingDirectory || undefined}
      />
    </div>
  )
}

function ConnectedRepoCard({
  workingDirectory,
  gitBranch,
  selfEditTarget,
  onConnect,
  onClear,
}: {
  workingDirectory: string
  gitBranch: string | null
  selfEditTarget: SelfEditTargetInfo | null
  onConnect: () => void
  onClear: () => void
}) {
  const selfEditStatus = getSelfEditStatus(selfEditTarget)
  return (
    <div className="mt-auto flex items-stretch justify-between gap-3 rounded-md border border-border/40 bg-foreground/[0.02] px-3 py-2.5">
      <div className="grid min-w-0 flex-1 gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm font-medium">
            <GitBranch className="h-3.5 w-3.5 text-muted-foreground" />
            Workspace folder
            {gitBranch ? (
              <span className="rounded bg-foreground/8 px-1.5 py-0.5 text-[11px] font-normal text-muted-foreground">
                {gitBranch}
              </span>
            ) : null}
          </div>
          <div className="mt-1 truncate text-xs text-muted-foreground">
            {workingDirectory || 'No default working folder connected for this workspace.'}
          </div>
        </div>
        <div className="min-w-0 border-t border-border/30 pt-2">
          <div className="flex items-center gap-2 text-sm font-medium">
            <DatabaseZap className="h-3.5 w-3.5 text-muted-foreground" />
            Self-edit target
            <span className={cn(
              'rounded px-1.5 py-0.5 text-[11px] font-normal',
              selfEditStatus.good ? 'bg-emerald-500/10 text-emerald-600' : 'bg-amber-500/10 text-amber-600',
            )}>
              {selfEditStatus.label}
            </span>
          </div>
          <div className="mt-1 truncate text-xs text-muted-foreground">
            {selfEditTarget?.repoPath || 'No RunnerOS self-edit repo configured.'}
          </div>
          {selfEditStatus.detail ? (
            <div className="mt-0.5 truncate text-[11px] text-muted-foreground/80">{selfEditStatus.detail}</div>
          ) : null}
        </div>
      </div>
      <div className="flex shrink-0 items-start gap-2">
        {workingDirectory ? (
          <Button size="sm" variant="ghost" onClick={onClear}>Clear</Button>
        ) : null}
        <Button size="sm" variant="outline" onClick={onConnect}>
          {workingDirectory ? 'Change' : 'Connect'}
        </Button>
      </div>
    </div>
  )
}

function getSelfEditStatus(target: SelfEditTargetInfo | null): { label: string; detail: string; good: boolean } {
  if (!target) return { label: 'Unknown', detail: '', good: false }
  if (target.source === 'none') return { label: 'Not set', detail: 'HNIC cannot safely edit RunnerOS until this is configured.', good: false }
  if (!target.enabled) return { label: 'Disabled', detail: `${target.source} config found, but self-edit is off.`, good: false }
  if (!target.validation.valid) {
    return {
      label: 'Invalid',
      detail: target.validation.errors[0] || 'Configured path does not validate as RunnerOS.',
      good: false,
    }
  }
  return { label: target.source === 'workspace' ? 'Workspace' : 'Global', detail: 'This is where RunnerOS self-edit changes will be made.', good: true }
}

function TokenBadge({ tokens, tone }: { tokens: number; tone: 'neutral' | 'amber' | 'red' }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium',
        tone === 'neutral' && 'bg-foreground/5 text-muted-foreground',
        tone === 'amber' && 'bg-amber-500/10 text-amber-600',
        tone === 'red' && 'bg-red-500/10 text-red-600',
      )}
    >
      ~{tokens.toLocaleString()} tokens
    </span>
  )
}

function routingSummary(doc: ContextDocDTO): string {
  if (doc.metadata.routing.mode === 'broadcast') return 'All agents'
  return doc.metadata.routing.agents.join(', ') || 'All agents'
}

function WorkspaceContextEditDialog({
  open,
  onOpenChange,
  doc,
  importDraft,
  activeAgents,
  onSave,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  doc: ContextDocDTO | null
  importDraft: ImportDraft | null
  activeAgents: Array<{ slug: string; metadata: { name: string; description: string } }>
  onSave: (input: { slug: string; metadata: ContextDocMetadata; body: string }) => Promise<void>
}) {
  const { t } = useTranslation()
  const isEditing = !!doc
  const [form, setForm] = React.useState<FormState>(() => buildInitialState(doc, importDraft))
  const [slugDirty, setSlugDirty] = React.useState(false)
  const [saving, setSaving] = React.useState(false)
  const [goalSectionOpen, setGoalSectionOpen] = React.useState(() => Boolean(doc?.metadata.status))

  React.useEffect(() => {
    if (!open) return
    setForm(buildInitialState(doc, importDraft))
    setSlugDirty(false)
    setSaving(false)
    setGoalSectionOpen(Boolean(doc?.metadata.status))
  }, [doc, importDraft, open])

  const handleNameChange = (name: string) => {
    setForm((prev) => ({
      ...prev,
      name,
      slug: !isEditing && !slugDirty ? slugify(name) : prev.slug,
    }))
  }

  const handleSave = async () => {
    const name = form.name.trim()
    const slug = form.slug.trim()
    if (!slug || !name) {
      toast.error('Slug and name are required')
      return
    }
    const metadata: ContextDocMetadata = {
      name,
      description: form.description.trim() || undefined,
      enabled: form.enabled,
      routing: form.routingMode === 'broadcast'
        ? { mode: 'broadcast' }
        : { mode: 'targeted', agents: form.agents },
    }
    if (form.goalEnabled) {
      const deadline = form.deadline.trim()
      if (deadline) {
        const parsed = Date.parse(deadline)
        if (Number.isNaN(parsed)) {
          toast.error(t('workspaceContextPage.invalidDeadline'))
          return
        }
        metadata.deadline = deadline
      }
      metadata.status = form.status
      if (form.priority) metadata.priority = form.priority
    }
    setSaving(true)
    try {
      await onSave({ slug, metadata, body: form.body })
    } catch (err) {
      toast.error('Failed to save context doc', {
        description: err instanceof Error ? err.message : String(err),
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[88vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEditing ? 'Edit context doc' : 'New context doc'}</DialogTitle>
          <DialogDescription>
            Context docs are injected into matching agent prompts at session start.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Name">
              <input
                value={form.name}
                onChange={(event) => handleNameChange(event.target.value)}
                className="form-input"
                placeholder="Project brief"
              />
            </Field>
            <Field label="Slug">
              <input
                value={form.slug}
                onChange={(event) => {
                  setSlugDirty(true)
                  setForm((prev) => ({ ...prev, slug: slugify(event.target.value) }))
                }}
                className="form-input font-mono"
                placeholder="project-brief"
                disabled={isEditing}
              />
            </Field>
          </div>

          <Field label="Description">
            <input
              value={form.description}
              onChange={(event) => setForm((prev) => ({ ...prev, description: event.target.value }))}
              className="form-input"
              placeholder="Short note shown in the list"
            />
          </Field>

          <Field label="Body">
            <textarea
              value={form.body}
              onChange={(event) => setForm((prev) => ({ ...prev, body: event.target.value }))}
              className="form-input min-h-[220px] font-mono text-xs resize-y"
              placeholder="Write markdown context here..."
            />
          </Field>

          <div className="flex flex-col gap-2">
            <span className="text-xs font-medium text-foreground/80">Routing</span>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                checked={form.routingMode === 'broadcast'}
                onChange={() => setForm((prev) => ({ ...prev, routingMode: 'broadcast' }))}
              />
              All agents
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                checked={form.routingMode === 'targeted'}
                onChange={() => setForm((prev) => ({ ...prev, routingMode: 'targeted' }))}
              />
              Specific agents
            </label>
            {form.routingMode === 'targeted' && (
              <div className="max-h-44 overflow-y-auto rounded-md border border-border/30 p-2">
                {activeAgents.length === 0 ? (
                  <p className="text-xs text-muted-foreground px-1 py-1">No active agents in this workspace.</p>
                ) : activeAgents.map((agent) => (
                  <label key={agent.slug} className="flex items-start gap-2 rounded-md px-1.5 py-1 hover:bg-foreground/5">
                    <input
                      type="checkbox"
                      checked={form.agents.includes(agent.slug)}
                      onChange={() => {
                        setForm((prev) => ({
                          ...prev,
                          agents: prev.agents.includes(agent.slug)
                            ? prev.agents.filter((slug) => slug !== agent.slug)
                            : [...prev.agents, agent.slug],
                        }))
                      }}
                      className="h-3.5 w-3.5 mt-0.5"
                    />
                    <span className="min-w-0">
                      <span className="block text-sm">{agent.metadata.name}</span>
                      <span className="block text-[11px] text-muted-foreground truncate">{agent.slug}</span>
                    </span>
                  </label>
                ))}
              </div>
            )}
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.enabled}
              onChange={(event) => setForm((prev) => ({ ...prev, enabled: event.target.checked }))}
            />
            Enabled
          </label>

          <div className="rounded-md border border-border/30">
            <button
              type="button"
              onClick={() => setGoalSectionOpen((v) => !v)}
              className="flex w-full items-center justify-between px-3 py-2 text-xs font-medium text-foreground/80 hover:bg-foreground/5"
            >
              <span>{t('workspaceContextPage.goalSection')}</span>
              <span className="text-foreground/50">{goalSectionOpen ? '−' : '+'}</span>
            </button>
            {goalSectionOpen && (
              <div className="border-t border-border/20 px-3 py-2 flex flex-col gap-2">
                <Field label={t('workspaceContextPage.status')}>
                  <select
                    value={form.goalEnabled ? form.status : ''}
                    onChange={(event) => {
                      const v = event.target.value
                      if (!v) {
                        setForm((prev) => ({ ...prev, goalEnabled: false }))
                      } else {
                        setForm((prev) => ({ ...prev, goalEnabled: true, status: v as GoalStatus }))
                      }
                    }}
                    className="form-input"
                  >
                    <option value="">{t('workspaceContextPage.statusNone')}</option>
                    <option value="active">{t('workspaceContextPage.statusActive')}</option>
                    <option value="blocked">{t('workspaceContextPage.statusBlocked')}</option>
                    <option value="paused">{t('workspaceContextPage.statusPaused')}</option>
                    <option value="done">{t('workspaceContextPage.statusDone')}</option>
                  </select>
                </Field>
                <Field label={t('workspaceContextPage.priority')}>
                  <select
                    value={form.priority}
                    disabled={!form.goalEnabled}
                    onChange={(event) =>
                      setForm((prev) => ({ ...prev, priority: event.target.value as GoalPriority | '' }))
                    }
                    className="form-input"
                  >
                    <option value="">{t('workspaceContextPage.statusNone')}</option>
                    <option value="low">{t('workspaceContextPage.priorityLow')}</option>
                    <option value="normal">{t('workspaceContextPage.priorityNormal')}</option>
                    <option value="high">{t('workspaceContextPage.priorityHigh')}</option>
                  </select>
                </Field>
                <Field label={t('workspaceContextPage.deadline')}>
                  <input
                    type="date"
                    value={form.deadline}
                    disabled={!form.goalEnabled}
                    onChange={(event) =>
                      setForm((prev) => ({ ...prev, deadline: event.target.value }))
                    }
                    className="form-input"
                  />
                </Field>
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving}>{saving ? 'Saving...' : 'Save'}</Button>
        </DialogFooter>

        <style>{`
          .form-input {
            display: block;
            width: 100%;
            padding: 0.4rem 0.6rem;
            font-size: 13px;
            background: rgba(0,0,0,0);
            border: 1px solid rgba(125,125,125,0.25);
            border-radius: 6px;
            color: inherit;
            outline: none;
          }
          .form-input:focus {
            border-color: rgba(80,160,250,0.6);
          }
          .form-input:disabled {
            opacity: 0.5;
            cursor: not-allowed;
          }
        `}</style>
      </DialogContent>
    </Dialog>
  )
}

function buildInitialState(doc: ContextDocDTO | null, importDraft?: ImportDraft | null): FormState {
  if (importDraft) {
    return {
      slug: importDraft.slug,
      name: importDraft.name,
      description: importDraft.description,
      body: importDraft.body,
      routingMode: 'broadcast',
      agents: [],
      enabled: true,
      goalEnabled: false,
      status: 'active',
      priority: '',
      deadline: '',
    }
  }
  if (!doc) {
    return {
      slug: '',
      name: '',
      description: '',
      body: '',
      routingMode: 'broadcast',
      agents: [],
      enabled: true,
      goalEnabled: false,
      status: 'active',
      priority: '',
      deadline: '',
    }
  }
  return {
    slug: doc.slug,
    name: doc.metadata.name,
    description: doc.metadata.description ?? '',
    body: doc.body,
    routingMode: doc.metadata.routing.mode,
    agents: doc.metadata.routing.mode === 'targeted' ? doc.metadata.routing.agents : [],
    enabled: doc.metadata.enabled,
    goalEnabled: Boolean(doc.metadata.status),
    status: (doc.metadata.status ?? 'active') as GoalStatus,
    priority: (doc.metadata.priority ?? '') as GoalPriority | '',
    deadline: doc.metadata.deadline ?? '',
  }
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/['"`]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium text-foreground/80">{label}</span>
      {children}
    </label>
  )
}
