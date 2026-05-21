import * as React from 'react'
import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { useNavigation } from '@/contexts/NavigationContext'
import { routes } from '../../shared/routes'
import { useWorkflowRuns } from '@/hooks/useWorkflowRuns'
import type { WorkflowDTO } from '../../shared/types'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  workflow: WorkflowDTO
  workspaceId: string
  /** Pre-fill form fields (used by the Rerun button on the Run page). */
  initialInputs?: Record<string, unknown>
}

export function WorkflowRunInputDialog({ open, onOpenChange, workflow, workspaceId, initialInputs }: Props) {
  const { t } = useTranslation()
  const { navigate } = useNavigation()
  const { start } = useWorkflowRuns(workspaceId)
  const inputs = React.useMemo(() => workflow.metadata.trigger.inputs ?? [], [workflow.metadata.trigger.inputs])

  const buildInitialFormValues = React.useCallback(() => {
    const values: Record<string, string | number | boolean> = {}
    for (const i of inputs) {
      const fromPrior = initialInputs?.[i.name]
      const seed = fromPrior !== undefined ? fromPrior : i.default
      if (i.type === 'boolean') {
        values[i.name] = Boolean(seed ?? false)
      } else if (i.type === 'number') {
        values[i.name] = typeof seed === 'number' ? seed : (seed != null && !Number.isNaN(Number(seed)) ? Number(seed) : '')
      } else {
        values[i.name] = seed != null ? String(seed) : ''
      }
    }
    return values
  }, [inputs, initialInputs])

  const [values, setValues] = React.useState<Record<string, string | number | boolean>>(buildInitialFormValues)
  const [submitting, setSubmitting] = React.useState(false)

  React.useEffect(() => {
    if (open) {
      setValues(buildInitialFormValues())
      setSubmitting(false)
    }
  }, [open, buildInitialFormValues])

  const handleSubmit = async () => {
    // Required-field check; coerce strings/numbers to their declared types.
    for (const i of inputs) {
      if (i.required && (values[i.name] === '' || values[i.name] == null)) {
        toast.error(t('workflows.run.requiredField', { name: i.name }))
        return
      }
    }
    setSubmitting(true)
    try {
      const payload: Record<string, unknown> = {}
      for (const i of inputs) {
        const value = values[i.name]
        if (!i.required && (value === '' || value == null)) continue
        payload[i.name] = value
      }
      const created = await start(workflow.slug, payload)
      onOpenChange(false)
      navigate(routes.view.workflowRun(created.id))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-white">{t('workflows.run.title', { name: workflow.metadata.name })}</DialogTitle>
          <DialogDescription className="text-white/48">{workflow.metadata.description}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          {inputs.length === 0 && (
            <p className="runneros-card px-3 py-2 text-xs text-white/48">{t('workflows.run.noInputs')}</p>
          )}
          {inputs.map((i) => (
            <label key={i.name} className="flex flex-col gap-1">
              <span className="text-xs font-medium text-white/72">
                {i.name}
                {i.required && <span className="text-destructive ml-0.5">*</span>}
                <span className="ml-2 text-[11px] font-normal text-white/38">{i.type}</span>
              </span>
              {i.description && (
                <span className="text-[11px] text-white/42">{i.description}</span>
              )}
              {i.type === 'boolean' ? (
                <input
                  type="checkbox"
                  checked={Boolean(values[i.name])}
                  onChange={(e) => setValues((p) => ({ ...p, [i.name]: e.target.checked }))}
                  className="h-4 w-4"
                />
              ) : i.type === 'number' ? (
                <input
                  type="number"
                  value={values[i.name] as number | ''}
                  onChange={(e) => setValues((p) => ({ ...p, [i.name]: e.target.value === '' ? '' : Number(e.target.value) }))}
                  className="runneros-form-input"
                />
              ) : (
                <textarea
                  value={values[i.name] as string}
                  onChange={(e) => setValues((p) => ({ ...p, [i.name]: e.target.value }))}
                  className="runneros-form-input min-h-[64px] font-mono text-xs"
                  rows={3}
                />
              )}
            </label>
          ))}
        </div>

        <DialogFooter>
          <Button variant="outline" className="border-white/[0.08] bg-white/[0.045] text-white/72 hover:bg-white/[0.08] hover:text-white" onClick={() => onOpenChange(false)} disabled={submitting}>
            {t('common.cancel')}
          </Button>
          <Button className="border border-[#fb923c]/25 bg-[#f97316]/18 text-white/90 hover:bg-[#f97316]/26" onClick={handleSubmit} disabled={submitting}>
            {submitting ? t('workflows.run.starting') : t('workflows.run.run')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
