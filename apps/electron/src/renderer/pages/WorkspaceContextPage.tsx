import * as React from 'react'
import { toast } from 'sonner'
import { FileText, Plus, Pencil, Trash2 } from 'lucide-react'
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
import { cn } from '@/lib/utils'
import type { ContextDocDTO, ContextDocMetadata } from '../../shared/types'

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
}

export default function WorkspaceContextPage({ workspaceId }: WorkspaceContextPageProps) {
  const { docs, loading, error, upsert, remove } = useWorkspaceContext(workspaceId)
  const { activeAgents } = useAgents(workspaceId)
  const [editingDoc, setEditingDoc] = React.useState<ContextDocDTO | null>(null)
  const [dialogOpen, setDialogOpen] = React.useState(false)

  const enabledChars = React.useMemo(() => (
    docs.filter((doc) => doc.metadata.enabled).reduce((sum, doc) => sum + doc.body.length, 0)
  ), [docs])
  const approxTokens = Math.ceil(enabledChars / 4)
  const tokenTone = approxTokens > 16000 ? 'red' : approxTokens > 8000 ? 'amber' : 'neutral'

  const handleNew = () => {
    setEditingDoc(null)
    setDialogOpen(true)
  }

  const handleEdit = (doc: ContextDocDTO) => {
    setEditingDoc(doc)
    setDialogOpen(true)
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
        <Button size="sm" onClick={handleNew}>
          <Plus className="h-3.5 w-3.5 mr-1.5" />
          New
        </Button>
      </div>

      <div className="flex-1 min-h-0 overflow-auto">
        {loading ? (
          <div className="h-full flex items-center justify-center text-sm text-muted-foreground">Loading context...</div>
        ) : error ? (
          <div className="m-5 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{error}</div>
        ) : docs.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center gap-3 text-center text-muted-foreground">
            <FileText className="h-8 w-8 opacity-50" />
            <div>
              <p className="text-sm font-medium text-foreground">No workspace context yet</p>
              <p className="text-xs mt-1">Add project facts, preferences, or operating rules agents should know.</p>
            </div>
            <Button size="sm" onClick={handleNew}>Create context doc</Button>
          </div>
        ) : (
          <div className="p-4">
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
                  {docs.map((doc) => (
                    <tr key={doc.slug} className="border-t border-border/30">
                      <td className="px-3 py-2 min-w-0">
                        <div className="font-medium truncate">{doc.metadata.name}</div>
                        <div className="text-xs text-muted-foreground truncate">
                          <span className="font-mono">{doc.slug}</span>
                          {doc.metadata.description ? ` - ${doc.metadata.description}` : ''}
                        </div>
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
          </div>
        )}
      </div>

      <WorkspaceContextEditDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        doc={editingDoc}
        activeAgents={activeAgents}
        onSave={async (input) => {
          await upsert(input)
          setDialogOpen(false)
        }}
      />
    </div>
  )
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
  activeAgents,
  onSave,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  doc: ContextDocDTO | null
  activeAgents: Array<{ slug: string; metadata: { name: string; description: string } }>
  onSave: (input: { slug: string; metadata: ContextDocMetadata; body: string }) => Promise<void>
}) {
  const isEditing = !!doc
  const [form, setForm] = React.useState<FormState>(() => buildInitialState(doc))
  const [slugDirty, setSlugDirty] = React.useState(false)
  const [saving, setSaving] = React.useState(false)

  React.useEffect(() => {
    if (!open) return
    setForm(buildInitialState(doc))
    setSlugDirty(false)
    setSaving(false)
  }, [doc, open])

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

function buildInitialState(doc: ContextDocDTO | null): FormState {
  if (!doc) {
    return {
      slug: '',
      name: '',
      description: '',
      body: '',
      routingMode: 'broadcast',
      agents: [],
      enabled: true,
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
  }
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
