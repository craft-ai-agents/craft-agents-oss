/**
 * EscapeInterruptOverlay
 *
 * Overlay shown on first Esc press during processing.
 * Displays "Press Esc again to interrupt" message over the bottom toolbar.
 * Auto-dismisses after 2 seconds (handled by EscapeInterruptContext).
 *
 * Uses the same styling as the context limit warning badge (bg-info/10 with tinted text).
 */

import * as React from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { cn } from '@/lib/utils'
import { Kbd } from '@/components/ui/kbd'
import { useTranslation } from '@/i18n'

interface EscapeInterruptOverlayProps {
  /** Whether the overlay should be visible */
  isVisible: boolean
  /** Additional className for positioning context */
  className?: string
}

export function EscapeInterruptOverlay({
  isVisible,
  className,
}: EscapeInterruptOverlayProps) {
  const { t } = useTranslation()

  return (
    <AnimatePresence>
      {isVisible && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          className={cn(
            // Position absolutely to cover the bottom toolbar
            "absolute inset-0 z-10",
            // Match the toolbar's border radius
            "rounded-b-[12px]",
            // Tinted shadow for subtle glow effect
            "shadow-tinted",
            // Center the text
            "flex items-center justify-center",
            // Pointer events to prevent clicks through
            "pointer-events-auto",
            className
          )}
          // Solid background using color-mix to interpolate info with background (not opacity)
          // Text color matching context limit badge style
          style={{
            '--shadow-color': 'var(--info-rgb)',
            backgroundColor: 'color-mix(in srgb, var(--info) 10%, var(--background))',
            color: 'color-mix(in oklab, var(--info) 30%, var(--foreground))',
          } as React.CSSProperties}
        >
          <span className="text-sm font-medium flex items-center gap-1.5">
            {t('interruptAndContinue' as any)} <Kbd className="text-inherit bg-current/10">Esc</Kbd>
          </span>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
