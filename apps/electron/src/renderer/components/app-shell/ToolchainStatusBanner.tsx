/**
 * ToolchainStatusBanner
 *
 * App-top inline banner for the critical AI runtime tool (omp — the de-facto
 * default backend of the seeded rox-kimi connection). Surfaces first-run
 * runtime download/install progress and failure states at the top level of
 * the app, not only inside Settings → Toolchain.
 *
 * Visibility:
 * - hidden when the toolchain manager is unavailable (headless/remote server)
 * - hidden for `missing` (manager not started yet), `ready` and `outdated`
 *   (the runtime is usable; Settings → Runtime shows the toolchain state)
 * - shown for `downloading` (with percent + progress bar), `installing`,
 *   `error` and `offline` (failure phases add an "Open Runtime settings" shortcut)
 *
 * Visual language matches TransportConnectionBanner (tone-tinted top bar,
 * same paddings/button sizing); the shortcut opens Settings → Runtime (tools).
 *
 * Dismissal is scoped to the current phase in memory: closing the banner
 * hides it for that phase only — any later phase transition re-raises it.
 */

import { useEffect, useState } from 'react'
import i18n from 'i18next'
import { useTranslation } from 'react-i18next'
import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useToolchainStatus } from '@/hooks/useToolchainStatus'
import { navigate, routes } from '@/lib/navigate'
import { cn } from '@/lib/utils'
import type { ToolchainToolStatus } from '../../../shared/types'

type ToolPhase = ToolchainToolStatus['phase']
type BannerPhase = Extract<ToolPhase, 'downloading' | 'installing' | 'error' | 'offline'>

/** Critical tool the banner tracks — omp gates the default AI connection. */
const CRITICAL_TOOL_NAME = 'omp'

/** Phase surfaced at app level, or null when the banner renders nothing. */
export function getToolchainBannerPhase(tool: ToolchainToolStatus | undefined): BannerPhase | null {
  if (!tool) return null
  switch (tool.phase) {
    case 'downloading':
    case 'installing':
    case 'error':
    case 'offline':
      return tool.phase
    default:
      return null
  }
}

/** Download progress percentage 0–100, or undefined when indeterminate. */
export function toolchainBannerPercent(tool: ToolchainToolStatus): number | undefined {
  if (!tool.totalBytes || tool.totalBytes <= 0 || !tool.downloadedBytes) return undefined
  return Math.min(100, Math.max(0, Math.round((tool.downloadedBytes / tool.totalBytes) * 100)))
}

export interface ToolchainBannerCopy {
  text: string
  tone: 'info' | 'warning' | 'error'
  /** Render the thin progress bar under the text (downloading phase). */
  showProgress: boolean
  /** Bar width in percent; undefined renders the indeterminate full bar. */
  percent?: number
  /** Offer the Settings → Toolchain shortcut (error/offline phases). */
  showOpenToolchain: boolean
}

export function getToolchainBannerCopy(tool: ToolchainToolStatus): ToolchainBannerCopy | null {
  const phase = getToolchainBannerPhase(tool)
  if (!phase) return null

  if (phase === 'downloading') {
    const percent = toolchainBannerPercent(tool)
    return {
      text: percent != null
        ? i18n.t('settings.toolchain.banner.downloading', { percent })
        : i18n.t('settings.toolchain.banner.downloadingUnknown'),
      tone: 'info',
      showProgress: true,
      percent,
      showOpenToolchain: false,
    }
  }

  if (phase === 'installing') {
    return {
      text: i18n.t('settings.toolchain.banner.installing'),
      tone: 'info',
      showProgress: false,
      showOpenToolchain: false,
    }
  }

  return {
    text: i18n.t('settings.toolchain.banner.notReady', {
      phase: i18n.t(`settings.toolchain.status.${phase}`),
    }),
    tone: phase === 'error' ? 'error' : 'warning',
    showProgress: false,
    showOpenToolchain: true,
  }
}

export function ToolchainStatusBanner() {
  const { t } = useTranslation()
  const { available, getTool } = useToolchainStatus()

  const tool = available ? getTool(CRITICAL_TOOL_NAME) : undefined
  const phase = getToolchainBannerPhase(tool)

  // Dismissal resets on every phase transition: leaving a phase (even into
  // `ready`) clears the dismissal, so a later failure re-raises the banner.
  const [dismissedPhase, setDismissedPhase] = useState<ToolPhase | null>(null)
  useEffect(() => {
    setDismissedPhase(null)
  }, [phase])

  const copy = tool ? getToolchainBannerCopy(tool) : null
  if (!phase || !copy || phase === dismissedPhase) return null

  const toneClasses = copy.tone === 'error'
    ? 'border-destructive/30 bg-destructive/10 text-destructive'
    : copy.tone === 'warning'
      ? 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300'
      : 'border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-300'

  return (
    <div className={`shrink-0 border-b px-4 py-2 ${toneClasses}`}>
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium truncate">{copy.text}</p>
          {copy.showProgress && (
            <div className="mt-1.5 h-1.5 rounded-full bg-foreground/10 overflow-hidden">
              <div
                className={cn('h-full bg-foreground/60', copy.percent != null && 'transition-all')}
                style={{ width: `${copy.percent ?? 100}%` }}
              />
            </div>
          )}
        </div>
        {copy.showOpenToolchain && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => navigate(routes.view.settings('runtime'))}
            className="shrink-0 h-7"
          >
            {t('settings.toolchain.banner.openToolchain')}
          </Button>
        )}
        <button
          type="button"
          onClick={() => setDismissedPhase(phase)}
          aria-label={t('common.dismiss')}
          className="shrink-0 inline-flex items-center justify-center size-6 rounded-md transition-colors hover:bg-foreground/10 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          <X className="size-3.5" />
        </button>
      </div>
    </div>
  )
}
