/**
 * LabelIcon - Renders a colored circle representing a label.
 *
 * Labels are color-only (no icons/emoji). The circle size scales
 * with the icon size variant for consistent inline display.
 */

import type { IconSize } from '@craft-agent/shared/icons'
import type { EntityColor } from '@craft-agent/shared/colors'
import { resolveEntityColor } from '@craft-agent/shared/colors'
import { useTheme } from '@/context/ThemeContext'
import { cn } from '@/lib/utils'

interface LabelIconProps {
  /** Label configuration (matches LabelConfig from @craft-agent/shared/labels) */
  label: {
    id: string
    /** EntityColor: system color string or custom color object */
    color?: EntityColor
  }
  /** Size variant (default: 'sm' - labels are typically small inline elements) */
  size?: IconSize
  /** When true, renders an inner circle (radio-button style) to indicate nested children */
  hasChildren?: boolean
  /** Additional className */
  className?: string
}

/** Circle diameter in pixels for each icon size */
const CIRCLE_SIZES: Record<IconSize, number> = {
  xs: 6,
  sm: 8,
  md: 10,
  lg: 12,
  xl: 14,
}

export function LabelIcon({ label, size = 'sm', hasChildren, className }: LabelIconProps) {
  const { isDark } = useTheme()

  // Resolve the label's color for inline styling
  const resolvedColor = label.color
    ? resolveEntityColor(label.color, isDark)
    : undefined

  // Parent labels get a slightly larger circle to accommodate the inner dot
  const diameter = CIRCLE_SIZES[size] + (hasChildren ? 2 : 0)
  return (
    <span
      className={cn('inline-flex items-center justify-center shrink-0', className)}
      style={{ width: diameter, height: diameter }}
    >
      <span
        className="relative rounded-full w-full h-full flex items-center justify-center"
        style={{
          backgroundColor: resolvedColor || 'currentColor',
          opacity: resolvedColor ? 1 : 0.4,
        }}
      >
        {/* Inner dot signals this label has nested children (radio-button style).
            Color is 85% background + 15% label color via color-mix. */}
        {hasChildren && (
          <span
            className="rounded-full shadow-minimal"
            style={{
              width: 4,
              height: 4,
              backgroundColor: `color-mix(in srgb, var(--background) 85%, ${resolvedColor || 'currentColor'} 15%)`,
            }}
          />
        )}
      </span>
    </span>
  )
}
