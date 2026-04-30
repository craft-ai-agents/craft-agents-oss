/**
 * TemplatesGalleryDialog
 *
 * One-click "Add automation from template" picker. Drops a fully-formed
 * matcher into automations.json via the createAutomationFromTemplate RPC.
 *
 * Three categories of templates today:
 *   - Inbound webhooks (WebhookReceive)
 *   - File watchers   (FileWatch)
 *   - URL polling     (PollUrl)
 *
 * Templates are defined in templates.ts. Adding a new template = appending
 * one entry there.
 */

import * as React from 'react'
import { toast } from 'sonner'
import { Plus, Sparkles } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogTrigger,
} from '@/components/ui/dialog'
import { useActiveWorkspace } from '@/context/AppShellContext'
import {
  AUTOMATION_TEMPLATES,
  TEMPLATE_CATEGORY_LABELS,
  type AutomationTemplate,
} from './templates'

interface TemplatesGalleryDialogProps {
  /** Optional custom trigger element. Defaults to a "+ From template" button. */
  trigger?: React.ReactNode
}

export function TemplatesGalleryDialog({ trigger }: TemplatesGalleryDialogProps) {
  const [open, setOpen] = React.useState(false)
  const [pending, setPending] = React.useState<string | null>(null)
  const workspace = useActiveWorkspace()

  const handlePick = React.useCallback(async (template: AutomationTemplate) => {
    if (!workspace?.id) return
    setPending(template.id)
    try {
      await window.electronAPI.createAutomationFromTemplate(
        workspace.id,
        template.event,
        template.matcher,
      )
      toast.success(`Added: ${template.title}`, {
        description: template.setupHint,
      })
      setOpen(false)
    } catch (err) {
      toast.error('Failed to add template', {
        description: err instanceof Error ? err.message : String(err),
      })
    } finally {
      setPending(null)
    }
  }, [workspace?.id])

  const groups = React.useMemo(() => {
    const byCategory: Record<AutomationTemplate['category'], AutomationTemplate[]> = {
      webhook: [],
      file: [],
      poll: [],
    }
    for (const t of AUTOMATION_TEMPLATES) byCategory[t.category].push(t)
    return byCategory
  }, [])

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <button
            type="button"
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-md border border-border/40 hover:bg-foreground/5"
          >
            <Sparkles className="h-3.5 w-3.5" />
            From template
          </button>
        )}
      </DialogTrigger>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Add automation from template</DialogTitle>
          <DialogDescription>
            One click to drop a working starter into <code className="font-mono">automations.json</code>.
            Edit the prompt and any details from there.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-6 max-h-[60vh] overflow-y-auto pr-1">
          {(Object.keys(groups) as Array<AutomationTemplate['category']>).map((cat) => {
            const items = groups[cat]
            if (items.length === 0) return null
            return (
              <div key={cat} className="flex flex-col gap-2">
                <div className="text-xs font-semibold uppercase tracking-wider text-foreground/60">
                  {TEMPLATE_CATEGORY_LABELS[cat]}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {items.map((t) => (
                    <TemplateCard
                      key={t.id}
                      template={t}
                      pending={pending === t.id}
                      disabled={pending !== null && pending !== t.id}
                      onPick={() => handlePick(t)}
                    />
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      </DialogContent>
    </Dialog>
  )
}

interface TemplateCardProps {
  template: AutomationTemplate
  pending: boolean
  disabled: boolean
  onPick: () => void
}

function TemplateCard({ template, pending, disabled, onPick }: TemplateCardProps) {
  return (
    <button
      type="button"
      onClick={onPick}
      disabled={disabled || pending}
      className="text-left flex flex-col gap-1 p-3 rounded-md border border-border/40 hover:border-border/80 hover:bg-foreground/5 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          {template.glyph && <span className="text-base leading-none">{template.glyph}</span>}
          <span className="font-medium text-sm">{template.title}</span>
        </div>
        {pending ? (
          <span className="text-[10px] text-foreground/50">adding…</span>
        ) : (
          <Plus className="h-3.5 w-3.5 text-foreground/40" />
        )}
      </div>
      <p className="text-xs text-foreground/60 leading-snug">{template.description}</p>
      {template.setupHint && (
        <p className="text-[11px] text-foreground/50 italic mt-0.5 leading-snug">
          {template.setupHint}
        </p>
      )}
    </button>
  )
}
