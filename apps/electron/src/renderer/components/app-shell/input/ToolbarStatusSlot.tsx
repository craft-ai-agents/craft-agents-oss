/**
 * ToolbarStatusSlot
 *
 * Priority-based overlay slot for the input toolbar bottom row.
 * Shows contextual status indicators — escape-to-interrupt hint (highest priority),
 * browser session state, or future status types.
 *
 * Positioned absolute inset-0 over the toolbar's relative container.
 * Uses AnimatePresence for smooth fade transitions between states.
 */

import * as React from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { Globe } from 'lucide-react'
import { Spinner } from '@craft-agent/ui'
import { cn } from '@/lib/utils'
import { Kbd } from '@/components/ui/kbd'
import { getHostname, getThemeLuminance } from '@/components/browser/utils'
import type { BrowserInstanceInfo } from '../../../../shared/types'

interface ToolbarStatusSlotProps {
  /** Whether the escape interrupt overlay should be visible (highest priority) */
  showEscapeOverlay: boolean
  /** Browser instance bound to this session (shown when agent control is active) */
  browserInstance: BrowserInstanceInfo | null
  /** Callback when the browser status bar is clicked */
  onBrowserClick?: (instanceId: string) => void
}

export function ToolbarStatusSlot({
  showEscapeOverlay,
  browserInstance,
  onBrowserClick,
}: ToolbarStatusSlotProps) {
  // Priority resolution: escape interrupt > browser status
  const showBrowser = !showEscapeOverlay && browserInstance?.agentControlActive

  return (
    <AnimatePresence>
      {showEscapeOverlay && (
        <motion.div
          key="escape"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          className={cn(
            "absolute inset-0 z-10",
            "rounded-b-[12px]",
            "shadow-tinted",
            "flex items-center justify-center",
            "pointer-events-auto",
          )}
          style={{
            '--shadow-color': 'var(--info-rgb)',
            backgroundColor: 'color-mix(in srgb, var(--info) 10%, var(--background))',
            color: 'color-mix(in oklab, var(--info) 30%, var(--foreground))',
          } as React.CSSProperties}
        >
          <span className="text-sm font-medium flex items-center gap-1.5">
            Press <Kbd className="text-inherit bg-current/10">Esc</Kbd> again to interrupt
          </span>
        </motion.div>
      )}

      {showBrowser && browserInstance && (
        <BrowserStatusBar
          key="browser"
          instance={browserInstance}
          onClick={() => onBrowserClick?.(browserInstance.id)}
        />
      )}
    </AnimatePresence>
  )
}

/**
 * Browser status bar — shows when the agent is actively using a browser window.
 * Uses the site's theme color as background with luminance-based text contrast.
 */
function BrowserStatusBar({
  instance,
  onClick,
}: {
  instance: BrowserInstanceInfo
  onClick: () => void
}) {
  const hostname = getHostname(instance.url)
  const themeColor = instance.themeColor
  const themeLuminance = themeColor ? getThemeLuminance(themeColor) : null
  const isDarkTheme = themeLuminance !== null && themeLuminance < 0.42

  // Compute styles based on whether we have a theme color
  const backgroundStyle = themeColor
    ? { backgroundColor: themeColor }
    : { backgroundColor: 'color-mix(in srgb, var(--accent) 15%, var(--background))' }

  const textColorClass = themeColor
    ? (isDarkTheme ? 'text-white/90' : 'text-foreground/90')
    : ''

  return (
    <motion.button
      type="button"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.15 }}
      className={cn(
        "absolute inset-0 z-10",
        "rounded-b-[12px]",
        "flex items-center justify-center gap-2",
        "pointer-events-auto cursor-pointer",
        "transition-[background-color] duration-200",
        textColorClass,
      )}
      style={{
        ...backgroundStyle,
      } as React.CSSProperties}
      onClick={onClick}
    >
      <span className="shrink-0 h-3.5 w-3.5 flex items-center justify-center">
        {instance.isLoading ? (
          <Spinner className="text-[10px] leading-none" />
        ) : instance.favicon ? (
          <img src={instance.favicon} alt="" className="h-3.5 w-3.5 rounded-sm block" />
        ) : (
          <Globe className="h-3.5 w-3.5" />
        )}
      </span>
      <span className="text-sm font-medium truncate max-w-[200px]">
        Using {hostname}
      </span>
    </motion.button>
  )
}
