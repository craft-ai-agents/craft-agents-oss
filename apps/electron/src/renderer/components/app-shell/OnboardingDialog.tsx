/**
 * Y4: first-run memory onboarding.
 *
 * Shown once ever: when the memory stores hold zero lessons (global +
 * workspace) and the server-side marker ({configDir}/memory/.onboarded) is
 * absent. Offers pre-translated seed lessons (global scope, prefilled
 * categories) so a fresh install starts with a working memory instead of an
 * empty panel. Any close path — Skip, backdrop, Esc — stamps the marker,
 * best-effort: a read-only config dir degrades to "dialog may reappear once"
 * rather than an error.
 */

import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import type { LessonCategory } from '@craft-agent/shared/memory/types'

interface SeedLesson {
  key: 'memory.seed1' | 'memory.seed2' | 'memory.seed3'
  category: LessonCategory
  negative?: boolean
}

const SEEDS: SeedLesson[] = [
  { key: 'memory.seed1', category: 'workflow' },
  { key: 'memory.seed2', category: 'correction', negative: true },
  { key: 'memory.seed3', category: 'preference' },
]

export interface OnboardingDialogProps {
  workspaceId?: string
}

export function OnboardingDialog({ workspaceId }: OnboardingDialogProps) {
  const { t } = useTranslation()
  const [open, setOpen] = React.useState(false)
  const [checked, setChecked] = React.useState<boolean[]>(() => SEEDS.map(() => true))
  const [busy, setBusy] = React.useState(false)
  // Re-entrancy guard: the marker write is idempotent, but a second toast
  // burst or double-close should never fire twice.
  const finishingRef = React.useRef(false)

  React.useEffect(() => {
    let cancelled = false
    window.electronAPI
      .listInsights(workspaceId)
      .then((insights) => {
        if (!cancelled && !insights.onboarded && insights.totalLessons === 0) setOpen(true)
      })
      .catch(() => {
        // Insights read is best-effort: offline/remote failures skip onboarding.
      })
    return () => { cancelled = true }
  }, [workspaceId])

  const stampOnboarded = React.useCallback(() => {
    try {
      const result = window.electronAPI.markMemoryOnboarded?.()
      void result?.catch(() => {})
    } catch {
      // Offline close must not throw — the marker re-check next launch retries.
    }
  }, [])

  const finish = React.useCallback(() => {
    if (finishingRef.current) return
    finishingRef.current = true
    stampOnboarded()
    setOpen(false)
  }, [stampOnboarded])

  const handleAdd = async () => {
    setBusy(true)
    const chosen = SEEDS.filter((_, i) => checked[i])
    try {
      for (const seed of chosen) {
        await window.electronAPI.addMemoryLesson(null, {
          rule: t(seed.key),
          category: seed.category,
          scope: 'global',
          ...(seed.negative ? { negative: true } : {}),
        })
      }
      if (chosen.length > 0) toast.success(t('memory.lessonAdded'))
    } catch (err) {
      toast.error(t('memory.lessonAddFailed'), {
        description: err instanceof Error ? err.message : String(err),
      })
    } finally {
      setBusy(false)
      finish()
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) finish() }}>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>{t('memory.onboardingTitle')}</DialogTitle>
          <DialogDescription>{t('memory.onboardingBody')}</DialogDescription>
        </DialogHeader>
        <ul className="space-y-2 py-1">
          {SEEDS.map((seed, i) => (
            <li key={seed.key}>
              <label className="flex items-start gap-2 text-sm text-foreground">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={checked[i] ?? false}
                  disabled={busy}
                  onChange={(e) =>
                    setChecked((prev) => prev.map((v, idx) => (idx === i ? e.target.checked : v)))
                  }
                />
                <span>{t(seed.key)}</span>
                {seed.negative && (
                  <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded-full bg-destructive/15 text-destructive">
                    {t('memory.negativeBadge')}
                  </span>
                )}
              </label>
            </li>
          ))}
        </ul>
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={finish}>
            {t('memory.onboardingSkip')}
          </Button>
          <Button disabled={busy || checked.every((v) => !v)} onClick={() => void handleAdd()}>
            {t('memory.onboardingAdd')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
