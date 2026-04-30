/**
 * AgentEditDialog
 *
 * Form-based create + edit for saved Agents. Replaces "open AGENT.md in
 * Finder and edit YAML by hand" as the primary authoring path. Raw-file
 * edit still works (and is still surfaced on AgentInfoPage as "Edit raw");
 * this dialog is the on-ramp.
 *
 * One scrollable column, four sections:
 *   1. Identity     (name, slug, avatar, description)
 *   2. Behavior     (system prompt, greeting)
 *   3. Bundles      (skills + sources multi-select)
 *   4. Runtime      (LLM, model, permission, thinking)
 *   + Capabilities  (inputs, outputs, tags) — collapsed by default
 *
 * Slug is auto-derived from the name on create and locked on edit. Renaming
 * an existing agent is currently a deliberate non-feature (would create a
 * fresh AGENT.md and break activation references); the user opens the raw
 * file if they truly need to rename.
 */

import * as React from 'react'
import { useAtomValue } from 'jotai'
import { toast } from 'sonner'
import { ChevronDown, ChevronRight } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { useAgents } from '@/hooks/useAgents'
import { skillsAtom } from '@/atoms/skills'
import { sourcesAtom } from '@/atoms/sources'
import type {
  AgentDefinitionDTO,
  AgentDefinitionMetadataDTO,
  PermissionMode,
  ThinkingLevel,
  LlmConnection,
} from '../../../shared/types'
import { THINKING_LEVELS } from '../../../shared/types'

// ----------------------------------------------------------------------------
// Types
// ----------------------------------------------------------------------------

interface AgentEditDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /**
   * When `agent` is provided, the dialog edits that agent (slug locked).
   * When omitted, the dialog creates a new agent (slug auto-derived from name,
   * editable until save).
   */
  agent?: AgentDefinitionDTO
  workspaceId: string | null | undefined
}

// Local form state mirrors AgentDefinitionMetadataDTO + systemPrompt + slug.
// Empty strings → undefined on save, so optional fields stay omitted from
// the YAML frontmatter when the user leaves them blank.
interface FormState {
  slug: string
  name: string
  description: string
  avatar: string
  systemPrompt: string
  greeting: string
  llmConnection: string
  model: string
  permissionMode: PermissionMode | ''
  thinkingLevel: ThinkingLevel | ''
  skills: string[]
  sources: string[]
  inputs: string
  outputs: string
  tagsCsv: string
}

const PERMISSION_MODES: PermissionMode[] = ['safe', 'ask', 'allow-all']

const PERMISSION_DESCRIPTIONS: Record<PermissionMode, string> = {
  safe: 'Explore — read-only operations only',
  ask: 'Ask — confirm before write operations',
  'allow-all': 'Auto — write/run anything without prompts',
}

// ----------------------------------------------------------------------------
// Slug derivation
// ----------------------------------------------------------------------------

function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/['"`]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
}

// ----------------------------------------------------------------------------
// Form
// ----------------------------------------------------------------------------

export function AgentEditDialog({ open, onOpenChange, agent, workspaceId }: AgentEditDialogProps) {
  const isEditing = !!agent
  const { upsert, allAgents } = useAgents(workspaceId)
  const skills = useAtomValue(skillsAtom)
  const sources = useAtomValue(sourcesAtom)

  // Connections list comes from a one-shot RPC fetch — no global atom for it
  // in this codebase. Refetch on every open so the dropdown is fresh; this
  // is cheap (just a list).
  const [connections, setConnections] = React.useState<LlmConnection[]>([])
  React.useEffect(() => {
    if (!open) return
    let cancelled = false
    window.electronAPI
      .listLlmConnectionsWithStatus()
      .then((rows) => {
        if (!cancelled) setConnections(rows)
      })
      .catch(() => {
        if (!cancelled) setConnections([])
      })
    return () => { cancelled = true }
  }, [open])

  // Initial state, recomputed when the dialog opens or the agent changes.
  const initial = React.useMemo<FormState>(() => buildInitialState(agent), [agent])
  const [form, setForm] = React.useState<FormState>(initial)
  const [slugDirty, setSlugDirty] = React.useState(false)
  const [saving, setSaving] = React.useState(false)

  // Reset state every time the dialog opens fresh.
  React.useEffect(() => {
    if (open) {
      setForm(initial)
      setSlugDirty(isEditing) // edits never touch the slug; treat as user-controlled
    }
  }, [open, initial, isEditing])

  // Auto-derive slug from name while the user hasn't manually edited it
  // (and we're creating, not editing).
  const handleNameChange = (value: string) => {
    setForm((prev) => ({
      ...prev,
      name: value,
      ...(slugDirty || isEditing ? {} : { slug: slugify(value) }),
    }))
  }

  const handleSlugChange = (value: string) => {
    setSlugDirty(true)
    setForm((prev) => ({ ...prev, slug: value }))
  }

  const handleToggleArrayMember = (key: 'skills' | 'sources', slug: string) => {
    setForm((prev) => {
      const set = new Set(prev[key])
      if (set.has(slug)) set.delete(slug)
      else set.add(slug)
      return { ...prev, [key]: [...set] }
    })
  }

  const slugConflict = React.useMemo(() => {
    if (isEditing) return null
    const trimmed = form.slug.trim()
    if (!trimmed) return null
    if (allAgents.some((a) => a.slug === trimmed)) {
      return `An agent with slug "${trimmed}" already exists in the global library.`
    }
    return null
  }, [allAgents, form.slug, isEditing])

  const handleSave = async () => {
    const trimmedName = form.name.trim()
    const trimmedSlug = form.slug.trim()
    const trimmedDescription = form.description.trim()
    if (!trimmedName) {
      toast.error('Agent needs a name')
      return
    }
    if (!trimmedSlug) {
      toast.error('Agent needs a slug')
      return
    }
    if (!trimmedDescription) {
      toast.error('Agent needs a one-sentence description')
      return
    }
    if (slugConflict) {
      toast.error(slugConflict)
      return
    }

    const tags = form.tagsCsv
      .split(',')
      .map((t) => t.trim().toLowerCase())
      .filter(Boolean)

    const metadata: AgentDefinitionMetadataDTO = {
      name: trimmedName,
      description: trimmedDescription,
      avatar: form.avatar.trim() || undefined,
      llmConnection: form.llmConnection.trim() || undefined,
      model: form.model.trim() || undefined,
      permissionMode: (form.permissionMode || undefined) as PermissionMode | undefined,
      thinkingLevel: (form.thinkingLevel || undefined) as ThinkingLevel | undefined,
      skills: form.skills.length > 0 ? form.skills : undefined,
      sources: form.sources.length > 0 ? form.sources : undefined,
      greeting: form.greeting.trim() || undefined,
      inputs: form.inputs.trim() || undefined,
      outputs: form.outputs.trim() || undefined,
      tags: tags.length > 0 ? tags : undefined,
    }

    setSaving(true)
    try {
      await upsert({
        slug: trimmedSlug,
        metadata,
        systemPrompt: form.systemPrompt,
      })
      toast.success(isEditing ? `Saved "${trimmedName}"` : `Created "${trimmedName}"`)
      onOpenChange(false)
    } catch (err) {
      toast.error(isEditing ? 'Failed to save agent' : 'Failed to create agent', {
        description: err instanceof Error ? err.message : String(err),
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{isEditing ? `Edit ${agent!.metadata.name}` : 'New Agent'}</DialogTitle>
          <DialogDescription>
            {isEditing
              ? 'Edit this agent\'s configuration. Saved to ~/.agents/agents/<slug>/AGENT.md.'
              : 'Build a saved persona — LLM, prompt, skills, and tools bundled together. Activates in this workspace automatically.'}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-5 max-h-[70vh] overflow-y-auto pr-1 py-2">
          {/* Identity */}
          <FormSection title="Identity">
            <div className="grid grid-cols-[1fr_auto] gap-3 items-start">
              <Field label="Name *">
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => handleNameChange(e.target.value)}
                  placeholder="Researcher"
                  className="form-input"
                  autoFocus
                />
              </Field>
              <Field label="Avatar" hint="emoji">
                <input
                  type="text"
                  value={form.avatar}
                  onChange={(e) => setForm((p) => ({ ...p, avatar: e.target.value }))}
                  placeholder="🔬"
                  className="form-input w-16 text-center"
                  maxLength={4}
                />
              </Field>
            </div>
            <Field label="Slug *" hint={isEditing ? 'locked when editing' : 'auto-derived from name; URL-safe'}>
              <input
                type="text"
                value={form.slug}
                onChange={(e) => handleSlugChange(e.target.value)}
                placeholder="researcher"
                className="form-input font-mono"
                disabled={isEditing}
              />
              {slugConflict && (
                <p className="text-xs text-amber-500 mt-1">{slugConflict}</p>
              )}
            </Field>
            <Field label="Description *" hint="one sentence shown in pickers">
              <input
                type="text"
                value={form.description}
                onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
                placeholder="Investigates topics deeply and returns cited summaries."
                className="form-input"
              />
            </Field>
          </FormSection>

          {/* Behavior — system prompt + greeting */}
          <FormSection title="Behavior">
            <Field label="System prompt" hint="the instructions the agent sees at session start">
              <textarea
                value={form.systemPrompt}
                onChange={(e) => setForm((p) => ({ ...p, systemPrompt: e.target.value }))}
                placeholder="You are a research specialist…"
                className="form-input font-mono text-xs min-h-[160px] resize-y"
              />
            </Field>
            <Field label="Greeting" hint="prefilled into the composer when summoned (optional)">
              <input
                type="text"
                value={form.greeting}
                onChange={(e) => setForm((p) => ({ ...p, greeting: e.target.value }))}
                placeholder="Give me a topic and the depth you want."
                className="form-input"
              />
            </Field>
          </FormSection>

          {/* Bundles — skills + sources */}
          <FormSection title="Bundles" hint="auto-activated with this agent">
            <Field label="Skills">
              {skills.length === 0 ? (
                <p className="text-xs text-foreground/50">No skills installed in this workspace.</p>
              ) : (
                <CheckboxList
                  items={skills.map((s) => ({ slug: s.slug, label: s.metadata.name, description: s.metadata.description }))}
                  selected={form.skills}
                  onToggle={(slug) => handleToggleArrayMember('skills', slug)}
                />
              )}
            </Field>
            <Field label="Sources">
              {sources.length === 0 ? (
                <p className="text-xs text-foreground/50">No sources configured in this workspace.</p>
              ) : (
                <CheckboxList
                  items={sources.map((s) => ({
                    slug: s.config.slug,
                    label: s.config.name,
                    description: s.config.type ?? '',
                  }))}
                  selected={form.sources}
                  onToggle={(slug) => handleToggleArrayMember('sources', slug)}
                />
              )}
            </Field>
          </FormSection>

          {/* Runtime */}
          <FormSection title="Runtime" hint="leave blank to use workspace defaults">
            <Field label="LLM connection">
              <select
                value={form.llmConnection}
                onChange={(e) => setForm((p) => ({ ...p, llmConnection: e.target.value }))}
                className="form-input"
              >
                <option value="">(workspace default)</option>
                {connections.map((c) => (
                  <option key={c.slug} value={c.slug}>
                    {c.name} — {c.providerType}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Model" hint="provider model ID; provider default when blank">
              <input
                type="text"
                value={form.model}
                onChange={(e) => setForm((p) => ({ ...p, model: e.target.value }))}
                placeholder="claude-opus-4-7"
                className="form-input font-mono"
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Permission mode">
                <select
                  value={form.permissionMode}
                  onChange={(e) => setForm((p) => ({ ...p, permissionMode: e.target.value as PermissionMode | '' }))}
                  className="form-input"
                >
                  <option value="">ask (default)</option>
                  {PERMISSION_MODES.map((mode) => (
                    <option key={mode} value={mode}>
                      {mode} — {PERMISSION_DESCRIPTIONS[mode]}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Thinking level">
                <select
                  value={form.thinkingLevel}
                  onChange={(e) => setForm((p) => ({ ...p, thinkingLevel: e.target.value as ThinkingLevel | '' }))}
                  className="form-input"
                >
                  <option value="">(workspace default)</option>
                  {THINKING_LEVELS.map((lvl) => (
                    <option key={lvl.id} value={lvl.id}>
                      {lvl.id}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
          </FormSection>

          {/* Capabilities — collapsible because most users won't fill these on first try */}
          <CollapsibleSection title="Capabilities (for orchestration)" hint="lets the Orchestrator route to this agent intelligently">
            <Field label="Takes" hint="one sentence describing input">
              <input
                type="text"
                value={form.inputs}
                onChange={(e) => setForm((p) => ({ ...p, inputs: e.target.value }))}
                placeholder="A topic and the depth you want."
                className="form-input"
              />
            </Field>
            <Field label="Produces" hint="one sentence describing output">
              <input
                type="text"
                value={form.outputs}
                onChange={(e) => setForm((p) => ({ ...p, outputs: e.target.value }))}
                placeholder="A cited summary with TL;DR and open questions."
                className="form-input"
              />
            </Field>
            <Field label="Tags" hint="comma-separated, lowercase, hyphenable; up to 8">
              <input
                type="text"
                value={form.tagsCsv}
                onChange={(e) => setForm((p) => ({ ...p, tagsCsv: e.target.value }))}
                placeholder="research, summarize, cite"
                className="form-input"
              />
            </Field>
          </CollapsibleSection>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button type="button" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : isEditing ? 'Save' : 'Create agent'}
          </Button>
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

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

function buildInitialState(agent: AgentDefinitionDTO | undefined): FormState {
  if (!agent) {
    return {
      slug: '',
      name: '',
      description: '',
      avatar: '',
      systemPrompt: '',
      greeting: '',
      llmConnection: '',
      model: '',
      permissionMode: '',
      thinkingLevel: '',
      skills: [],
      sources: [],
      inputs: '',
      outputs: '',
      tagsCsv: '',
    }
  }
  return {
    slug: agent.slug,
    name: agent.metadata.name,
    description: agent.metadata.description,
    avatar: agent.metadata.avatar ?? '',
    systemPrompt: agent.systemPrompt,
    greeting: agent.metadata.greeting ?? '',
    llmConnection: agent.metadata.llmConnection ?? '',
    model: agent.metadata.model ?? '',
    permissionMode: agent.metadata.permissionMode ?? '',
    thinkingLevel: agent.metadata.thinkingLevel ?? '',
    skills: agent.metadata.skills ?? [],
    sources: agent.metadata.sources ?? [],
    inputs: agent.metadata.inputs ?? '',
    outputs: agent.metadata.outputs ?? '',
    tagsCsv: (agent.metadata.tags ?? []).join(', '),
  }
}

interface FormSectionProps {
  title: string
  hint?: string
  children: React.ReactNode
}

function FormSection({ title, hint, children }: FormSectionProps) {
  return (
    <section className="flex flex-col gap-3">
      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wider text-foreground/60">{title}</h3>
        {hint && <p className="text-[11px] text-foreground/50 mt-0.5">{hint}</p>}
      </div>
      {children}
    </section>
  )
}

interface CollapsibleSectionProps {
  title: string
  hint?: string
  children: React.ReactNode
}

function CollapsibleSection({ title, hint, children }: CollapsibleSectionProps) {
  const [open, setOpen] = React.useState(false)
  return (
    <section className="flex flex-col gap-3">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-start gap-2 text-left hover:text-foreground/80"
      >
        {open ? <ChevronDown className="h-3.5 w-3.5 mt-0.5 shrink-0" /> : <ChevronRight className="h-3.5 w-3.5 mt-0.5 shrink-0" />}
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wider text-foreground/60">{title}</h3>
          {hint && <p className="text-[11px] text-foreground/50 mt-0.5">{hint}</p>}
        </div>
      </button>
      {open && <div className="flex flex-col gap-3 pl-5">{children}</div>}
    </section>
  )
}

interface FieldProps {
  label: string
  hint?: string
  children: React.ReactNode
}

function Field({ label, hint, children }: FieldProps) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium text-foreground/80">
        {label}
        {hint && <span className="text-[10px] text-foreground/45 font-normal ml-1.5">— {hint}</span>}
      </span>
      {children}
    </label>
  )
}

interface CheckboxListItem {
  slug: string
  label: string
  description?: string
}

interface CheckboxListProps {
  items: CheckboxListItem[]
  selected: string[]
  onToggle: (slug: string) => void
}

function CheckboxList({ items, selected, onToggle }: CheckboxListProps) {
  const set = new Set(selected)
  return (
    <div className="flex flex-col gap-1 max-h-40 overflow-y-auto border border-border/30 rounded-md p-2">
      {items.map((item) => (
        <label
          key={item.slug}
          className="flex items-start gap-2 px-1.5 py-1 rounded-md hover:bg-foreground/5 cursor-pointer"
        >
          <input
            type="checkbox"
            checked={set.has(item.slug)}
            onChange={() => onToggle(item.slug)}
            className="h-3.5 w-3.5 mt-0.5 cursor-pointer"
          />
          <div className="flex-1 min-w-0">
            <div className="text-sm">{item.label}</div>
            {item.description && (
              <div className="text-[11px] text-foreground/50 truncate">{item.description}</div>
            )}
          </div>
        </label>
      ))}
    </div>
  )
}
