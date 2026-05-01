import * as React from 'react'
import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'
import { Save, X, AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useNavigation } from '@/contexts/NavigationContext'
import { routes } from '../../shared/routes'
import { useWorkflows } from '@/hooks/useWorkflows'
import { parseWorkflowFile, serializeWorkflow } from '@craft-agent/shared/workflows'
import type { WorkflowDTO } from '../../shared/types'

interface Props {
  workflowSlug: string
  workspaceId: string
}

/**
 * Raw WORKFLOW.md editor. Phase 1 ships source-mode only — round-trips
 * through `parseWorkflowFile` + `serializeWorkflow` so users can edit the
 * full file as text and save back through the existing upsert RPC.
 */
export default function WorkflowEditPage({ workflowSlug, workspaceId }: Props) {
  const { t } = useTranslation()
  const { navigate } = useNavigation()
  const { upsert } = useWorkflows(workspaceId)
  const [text, setText] = React.useState<string>('')
  const [originalSlug, setOriginalSlug] = React.useState<string>('')
  const [parseError, setParseError] = React.useState<string | null>(null)
  const [saving, setSaving] = React.useState(false)
  const [loading, setLoading] = React.useState(true)
  const [loadError, setLoadError] = React.useState<string | null>(null)

  React.useEffect(() => {
    let mounted = true
    const load = async () => {
      try {
        const loaded: WorkflowDTO | null = await window.electronAPI.getWorkflow(workflowSlug)
        if (!mounted) return
        if (!loaded) {
          setLoadError(t('workflows.info.notFound', { slug: workflowSlug }))
          setLoading(false)
          return
        }
        setText(serializeWorkflow(loaded.metadata, loaded.body))
        setOriginalSlug(loaded.slug)
        setLoading(false)
      } catch (err) {
        if (!mounted) return
        setLoadError(err instanceof Error ? err.message : String(err))
        setLoading(false)
      }
    }
    load()
    return () => { mounted = false }
  }, [workflowSlug, t])

  // Live parse so the Save button can disable the moment the file is broken.
  const parsed = React.useMemo(() => {
    if (!text) return null
    return parseWorkflowFile(text)
  }, [text])

  React.useEffect(() => {
    if (!text) { setParseError(null); return }
    setParseError(parsed ? null : t('workflows.editor.parseError'))
  }, [parsed, text, t])

  const handleSave = async () => {
    if (!parsed) {
      toast.error(t('workflows.editor.parseError'))
      return
    }
    setSaving(true)
    try {
      await upsert({
        slug: originalSlug,
        metadata: parsed.metadata,
        body: parsed.body,
      })
      toast.success(t('workflows.editor.saved'))
      navigate(routes.view.workflow(originalSlug))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return <div className="flex h-full items-center justify-center text-sm text-muted-foreground">{t('common.loading')}</div>
  }
  if (loadError) {
    return (
      <div className="m-5 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive flex items-center gap-2">
        <AlertTriangle className="h-4 w-4" />
        <span>{loadError}</span>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full min-h-0 bg-background">
      <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-border/30">
        <div className="min-w-0">
          <h1 className="text-base font-semibold truncate">{t('workflows.editor.title')}</h1>
          <p className="text-xs text-muted-foreground mt-1 font-mono truncate">{originalSlug}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => navigate(routes.view.workflow(originalSlug))} disabled={saving}>
            <X className="h-3.5 w-3.5 mr-1.5" />
            {t('common.cancel')}
          </Button>
          <Button size="sm" onClick={handleSave} disabled={saving || !!parseError}>
            <Save className="h-3.5 w-3.5 mr-1.5" />
            {saving ? t('workflows.editor.saving') : t('common.save')}
          </Button>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-auto p-4 flex flex-col gap-3">
        {parseError && (
          <div className="rounded-md border border-destructive/30 bg-destructive/5 p-2 text-xs text-destructive flex items-center gap-2">
            <AlertTriangle className="h-3.5 w-3.5" />
            <span>{parseError}</span>
          </div>
        )}
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          spellCheck={false}
          className="w-full flex-1 min-h-[400px] resize-none font-mono text-xs rounded-md border border-border/40 bg-background p-3 outline-none focus:border-primary/40"
        />

        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer select-none hover:text-foreground">
            {t('workflows.editor.templatingHelpTitle')}
          </summary>
          <div className="mt-2 rounded-md border border-border/40 bg-foreground/[0.02] p-3 font-mono text-[11px] leading-relaxed">
            <p className="mb-1">{t('workflows.editor.templatingHelpBody')}</p>
            <pre className="whitespace-pre-wrap">{`{{trigger.<input-name>}}     # any declared trigger input
{{steps.<step-id>.output}}    # output of an earlier step (string)`}</pre>
          </div>
        </details>
      </div>
    </div>
  )
}
