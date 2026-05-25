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
import { ChevronDown, ChevronRight, Eye } from 'lucide-react'
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
  visualAgent: boolean
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
  const groupedSkills = React.useMemo(
    () => groupBundleOptions(skills.map((s) => ({
      slug: s.slug,
      label: s.metadata.name,
      description: s.metadata.description,
      category: inferSkillCategory(s.slug, s.metadata.name, s.metadata.description, s.metadata.category),
    }))),
    [skills],
  )
  const groupedSources = React.useMemo(
    () => groupBundleOptions(sources.map((s) => ({
      slug: s.config.slug,
      label: s.config.name,
      description: s.config.type ?? '',
      category: inferSourceCategory(s.config.slug, s.config.name, s.config.type ?? ''),
    }))),
    [sources],
  )

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
  const [bundlePicker, setBundlePicker] = React.useState<'skills' | 'sources' | null>(null)
  const [promptEditorOpen, setPromptEditorOpen] = React.useState(false)

  // Reset state every time the dialog opens fresh.
  React.useEffect(() => {
    if (open) {
      setForm(initial)
      setSlugDirty(isEditing) // edits never touch the slug; treat as user-controlled
      setPromptEditorOpen(false)
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
      visualAgent: form.visualAgent || undefined,
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
      <DialogContent className="max-h-[88vh] max-w-3xl overflow-hidden !rounded-[18px] !border !border-white/[0.08] !bg-[#09090c] p-0 !text-white !shadow-modal-small">
        <DialogHeader className="border-b border-white/[0.06] bg-[radial-gradient(circle_at_18%_0%,rgba(249,115,22,0.20),transparent_34%),#0b0b0f] px-5 pb-3 pt-4">
          <DialogTitle className="text-[20px] font-semibold leading-tight text-white">
            {isEditing ? `Edit ${agent!.metadata.name}` : 'New agent'}
          </DialogTitle>
          <DialogDescription className="max-w-2xl text-sm leading-5 text-white/52">
            {isEditing
              ? 'Update this agent without touching internal routing names.'
              : 'Build a saved operator with a prompt, runtime, skills, tools, context, and memory.'}
          </DialogDescription>
        </DialogHeader>

        <div className="flex max-h-[calc(88vh-132px)] flex-col gap-3 overflow-y-auto px-5 pb-4 pt-2">
          {/* Identity */}
          <FormSection title="Identity">
            <Field label="Name *">
              <input
                type="text"
                value={form.name}
                onChange={(e) => handleNameChange(e.target.value)}
                className="form-input"
                autoFocus
              />
              {slugConflict && (
                <p className="mt-1 text-xs text-amber-300">{slugConflict}</p>
              )}
            </Field>
            <Field label="Description *">
              <input
                type="text"
                value={form.description}
                onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
                className="form-input"
              />
            </Field>
          </FormSection>

          {/* Behavior — system prompt + greeting */}
          <FormSection title="Behavior">
            <VisualAgentToggle
              checked={form.visualAgent}
              onChange={(checked) => setForm((p) => ({ ...p, visualAgent: checked }))}
            />
            <PromptEditorPanel
              value={form.systemPrompt}
              open={promptEditorOpen}
              onOpenChange={setPromptEditorOpen}
              onChange={(value) => setForm((p) => ({ ...p, systemPrompt: value }))}
            />
          </FormSection>

          {/* Bundles — skills + sources */}
          <FormSection title="Bundles" hint="auto-activated with this agent">
            <div className="grid gap-3 md:grid-cols-2">
              <BundleSummaryButton
                title="Skills"
                count={form.skills.length}
                onClick={() => setBundlePicker('skills')}
              />
              <BundleSummaryButton
                title="Tools"
                count={form.sources.length}
                onClick={() => setBundlePicker('sources')}
              />
            </div>
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
            <div className="grid gap-3 md:grid-cols-2">
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

        <DialogFooter className="sticky bottom-0 z-10 border-t border-white/[0.06] bg-[#09090c]/95 px-5 py-2.5 backdrop-blur">
          <Button
            type="button"
            variant="outline"
            className="h-7 rounded-[8px] border-white/[0.10] bg-transparent px-2.5 text-[11px] text-white/70 hover:bg-white/[0.06]"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button
            type="button"
            className="h-7 rounded-[8px] bg-[#f97316] px-2.5 text-[11px] text-white hover:bg-[#fb923c]"
            onClick={handleSave}
            disabled={saving}
          >
            {saving ? 'Saving...' : isEditing ? 'Save' : 'Create agent'}
          </Button>
        </DialogFooter>

        <BundlePickerDialog
          open={bundlePicker !== null}
          title={bundlePicker === 'skills' ? 'Skills' : 'Tools'}
          empty={bundlePicker === 'skills' ? 'No skills installed in this workspace.' : 'No tools configured in this workspace.'}
          groups={bundlePicker === 'skills' ? groupedSkills : groupedSources}
          selected={bundlePicker === 'skills' ? form.skills : form.sources}
          onToggle={(slug) => handleToggleArrayMember(bundlePicker === 'skills' ? 'skills' : 'sources', slug)}
          onOpenChange={(nextOpen) => {
            if (!nextOpen) setBundlePicker(null)
          }}
        />

        <style>{`
          .form-input {
            display: block;
            width: 100%;
            min-height: 2.5rem;
            padding: 0.48rem 0.7rem;
            font-size: 13px;
            background: rgba(255,255,255,0.045);
            border: 1px solid rgba(255,255,255,0.09);
            border-radius: 10px;
            color: rgba(255,255,255,0.88);
            outline: none;
          }
          .form-input:focus {
            border-color: rgba(251,146,60,0.55);
          }
          .form-input:disabled {
            opacity: 0.5;
            cursor: not-allowed;
          }
          .form-input::placeholder {
            color: rgba(255,255,255,0.28);
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
      visualAgent: false,
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
    visualAgent: agent.metadata.visualAgent === true,
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
    <section className="flex flex-col gap-3 rounded-[14px] border border-white/[0.07] bg-white/[0.035] p-3">
      <div>
        <h3 className="text-xs font-semibold uppercase tracking-[0.16em] text-white/42">{title}</h3>
        {hint && <p className="mt-0.5 text-[11px] text-white/34">{hint}</p>}
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
    <section className="flex flex-col gap-3 rounded-[14px] border border-white/[0.07] bg-white/[0.035] p-3">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-start gap-2 text-left transition-colors hover:text-white"
      >
        {open ? <ChevronDown className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#fdba74]" /> : <ChevronRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#fdba74]" />}
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-[0.16em] text-white/42">{title}</h3>
          {hint && <p className="mt-0.5 text-[11px] text-white/34">{hint}</p>}
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
      <span className="text-xs font-medium text-white/72">
        {label}
        {hint && <span className="ml-1.5 text-[10px] font-normal text-white/34">- {hint}</span>}
      </span>
      {children}
    </label>
  )
}

function VisualAgentToggle({
  checked,
  onChange,
}: {
  checked: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex w-full items-center justify-between gap-3 rounded-[13px] border border-white/[0.065] bg-black/20 px-3 py-3 text-left transition-colors hover:border-[#38bdf8]/30 hover:bg-white/[0.045]"
    >
      <span className="flex min-w-0 items-start gap-3">
        <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] border border-white/[0.08] bg-white/[0.045] text-[#7dd3fc]">
          <Eye className="h-3.5 w-3.5" />
        </span>
        <span className="min-w-0">
          <span className="block text-sm font-medium text-white/82">Visual agent</span>
          <span className="mt-0.5 block text-xs leading-5 text-white/40">
            Automatically uses Canvas for visual, web, media, and document outputs.
          </span>
        </span>
      </span>
      <span
        className={`relative h-5 w-9 shrink-0 rounded-full border transition-colors ${
          checked
            ? 'border-[#38bdf8]/55 bg-[#0ea5e9]/35'
            : 'border-white/[0.10] bg-white/[0.04]'
        }`}
      >
        <span
          className={`absolute top-0.5 h-4 w-4 rounded-full bg-white/82 transition-transform ${
            checked ? 'translate-x-4' : 'translate-x-0.5'
          }`}
        />
      </span>
    </button>
  )
}

function BundleSummaryButton({
  title,
  count,
  onClick,
}: {
  title: string
  count: number
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center justify-between gap-3 rounded-[13px] border border-white/[0.065] bg-black/20 px-3 py-3 text-left transition-colors hover:border-[#fb923c]/30 hover:bg-white/[0.045]"
    >
      <div>
        <div className="text-sm font-medium text-white/82">{title}</div>
        <div className="mt-0.5 text-xs text-white/34">
          {count === 0 ? 'None selected' : `${count} selected`}
        </div>
      </div>
      <div className="rounded-full border border-white/[0.08] bg-white/[0.045] px-2 py-1 text-[11px] text-white/54">
        Open
      </div>
    </button>
  )
}

function PromptEditorPanel({
  value,
  open,
  onOpenChange,
  onChange,
}: {
  value: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onChange: (value: string) => void
}) {
  const cleaned = cleanDisplayText(value)
  return (
    <div className="overflow-hidden rounded-[13px] border border-white/[0.065] bg-black/20">
      <button
        type="button"
        onClick={() => onOpenChange(!open)}
        className="flex w-full items-center justify-between gap-4 px-3 py-3 text-left transition-colors hover:bg-white/[0.035]"
      >
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium text-white/82">System prompt</div>
          {!open && (
            <div className="mt-1 line-clamp-2 text-xs leading-5 text-white/38">
              {cleaned || 'Empty'}
            </div>
          )}
        </div>
        <ChevronDown className={`h-4 w-4 shrink-0 text-[#fdba74] transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="border-t border-white/[0.06] p-3">
          <textarea
            value={value}
            onChange={(event) => onChange(event.target.value)}
            placeholder="Write the agent system prompt..."
            className="h-[min(34vh,360px)] min-h-[220px] w-full resize-y rounded-[12px] border border-white/[0.09] bg-black/30 p-3 font-mono text-[13px] leading-6 text-white/84 outline-none transition-colors placeholder:text-white/24 focus:border-[#fb923c]/55"
            autoFocus
          />
        </div>
      )}
    </div>
  )
}

function BundlePickerDialog({
  open,
  title,
  empty,
  groups,
  selected,
  onToggle,
  onOpenChange,
}: {
  open: boolean
  title: string
  empty: string
  groups: BundleGroup[]
  selected: string[]
  onToggle: (slug: string) => void
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[76vh] max-w-2xl overflow-hidden !rounded-[16px] !border !border-white/[0.08] !bg-[#09090c] p-0 !text-white !shadow-modal-small">
        <DialogHeader className="border-b border-white/[0.06] bg-[#0b0b0f] px-5 py-4">
          <DialogTitle className="text-lg font-semibold text-white">{title}</DialogTitle>
          <DialogDescription className="text-sm text-white/48">
            Choose what this agent carries into new sessions.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[52vh] overflow-y-auto px-5 py-4">
          <CategorizedCheckboxList
            title={title}
            empty={empty}
            groups={groups}
            selected={selected}
            onToggle={onToggle}
            fullWidth
          />
        </div>

        <DialogFooter className="border-t border-white/[0.06] px-5 py-4">
          <Button
            type="button"
            className="h-8 rounded-[9px] bg-[#f97316] px-3 text-xs text-white hover:bg-[#fb923c]"
            onClick={() => onOpenChange(false)}
          >
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

interface CheckboxListItem {
  slug: string
  label: string
  description?: string
  category: string
}

interface BundleGroup {
  category: string
  items: CheckboxListItem[]
}

interface CategorizedCheckboxListProps {
  title: string
  empty: string
  groups: BundleGroup[]
  selected: string[]
  onToggle: (slug: string) => void
  fullWidth?: boolean
}

function CategorizedCheckboxList({ title, empty, groups, selected, onToggle, fullWidth }: CategorizedCheckboxListProps) {
  const selectedSet = new Set(selected)
  const [openGroups, setOpenGroups] = React.useState<Set<string>>(new Set())
  const toggleGroup = (category: string) => {
    setOpenGroups((prev) => {
      const next = new Set(prev)
      if (next.has(category)) next.delete(category)
      else next.add(category)
      return next
    })
  }

  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="text-xs font-medium text-white/72">{title}</div>
        <div className="text-[11px] text-white/32">{selected.length} selected</div>
      </div>
      {groups.length === 0 ? (
        <div className="rounded-[12px] border border-dashed border-white/[0.10] p-4 text-center text-xs text-white/38">
          {empty}
        </div>
      ) : (
        <div className={`${fullWidth ? 'space-y-2' : 'max-h-[280px] space-y-2 overflow-y-auto'}`}>
          {groups.map((group) => {
            const isOpen = openGroups.has(group.category)
            const selectedCount = group.items.filter((item) => selectedSet.has(item.slug)).length
            return (
              <div key={group.category} className="overflow-hidden rounded-[13px] border border-white/[0.065] bg-black/20">
                <button
                  type="button"
                  onClick={() => toggleGroup(group.category)}
                  className="flex w-full items-center justify-between gap-3 px-3 py-3 text-left transition-colors hover:bg-white/[0.04]"
                >
                  <span className="text-xs font-semibold uppercase tracking-[0.16em] text-white/48">
                    {group.category}
                  </span>
                  <span className="flex items-center gap-2 text-[11px] text-white/32">
                    {selectedCount > 0 ? `${selectedCount} selected` : group.items.length}
                    <ChevronDown className={`h-3.5 w-3.5 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                  </span>
                </button>
                {isOpen ? (
                  <div className="space-y-1.5 border-t border-white/[0.055] p-2">
                    {group.items.map((item) => (
                      <label
                        key={item.slug}
                        className="flex cursor-pointer items-start gap-3 rounded-[10px] px-3 py-2.5 transition-colors hover:bg-white/[0.045]"
                      >
                        <input
                          type="checkbox"
                          checked={selectedSet.has(item.slug)}
                          onChange={() => onToggle(item.slug)}
                          className="mt-0.5 h-3.5 w-3.5 cursor-pointer accent-[#fb923c]"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-medium text-white">{cleanDisplayText(item.label)}</div>
                          {item.description ? (
                            <div className="mt-0.5 truncate text-xs text-white/40">{cleanDisplayText(item.description)}</div>
                          ) : null}
                        </div>
                      </label>
                    ))}
                  </div>
                ) : null}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function groupBundleOptions(options: CheckboxListItem[]): BundleGroup[] {
  const groups = new Map<string, CheckboxListItem[]>()
  for (const option of options) {
    const items = groups.get(option.category) ?? []
    items.push(option)
    groups.set(option.category, items)
  }

  return Array.from(groups.entries())
    .map(([category, items]) => ({
      category,
      items: items.sort((a, b) => a.label.localeCompare(b.label)),
    }))
    .sort((a, b) => bundleCategoryRank(a.category) - bundleCategoryRank(b.category) || a.category.localeCompare(b.category))
}

function bundleCategoryRank(category: string) {
  const order = [
    'Core operations',
    'Founder',
    'Research & analysis',
    'Content & marketing',
    'Creative production',
    'Development',
    'Local tools',
    'MCP tools',
    'Data & APIs',
    'Other',
  ]
  const index = order.indexOf(category)
  return index === -1 ? order.length : index
}

function inferSkillCategory(slug: string, name: string, description?: string, category?: string) {
  if (category === 'founder') return 'Founder'
  if (category === 'content-generation' || category === 'marketing') return 'Content & marketing'
  const text = `${slug} ${name} ${description ?? ''}`.toLowerCase()
  if (matchesAny(text, ['100m-', 'blue-ocean-strategy', 'crossing-the-chasm', 'four-steps', 'lean-startup', 'mom-test', 'monetizing-innovation', 'obviously-awesome', 'spin-selling', 'storybrand', 'traction'])) return 'Founder'
  if (matchesAny(text, ['research', 'competitor', 'customer', 'profile', 'analyze', 'analysis', 'audit', 'spy', 'perspective'])) return 'Research & analysis'
  if (matchesAny(text, ['meta ads', 'meta-ads', 'facebook ads'])) return 'Content & marketing'
  if (matchesAny(text, ['marketing', 'content', 'copy', 'ads', 'seo', 'viral', 'twitter', 'tweet', 'x-', 'pricing', 'lead'])) return 'Content & marketing'
  if (matchesAny(text, ['creative', 'video', 'image', '3d', 'design', 'brand', 'visual', 'hyperframes'])) return 'Creative production'
  if (matchesAny(text, ['code', 'api', 'database', 'dev', 'react', 'typescript', 'debug', 'test', 'deploy', 'github'])) return 'Development'
  if (matchesAny(text, ['runneros', 'workflow', 'automation', 'source', 'orchestration', 'routing'])) return 'Core operations'
  return 'Other'
}

function inferSourceCategory(slug: string, name: string, type: string) {
  const text = `${slug} ${name} ${type}`.toLowerCase()
  if (type.toLowerCase() === 'local' || matchesAny(text, ['local', 'filesystem', 'bash', 'computer'])) return 'Local tools'
  if (type.toLowerCase() === 'mcp' || text.includes('mcp')) return 'MCP tools'
  if (matchesAny(text, ['api', 'exa', 'search', 'ads', 'data'])) return 'Data & APIs'
  return 'Other'
}

function matchesAny(value: string, needles: string[]) {
  return needles.some((needle) => value.includes(needle))
}

function cleanDisplayText(value: string) {
  return value
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
}
