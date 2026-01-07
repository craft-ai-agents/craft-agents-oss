/**
 * PreviewHeader - Unified header component for preview windows and overlays
 *
 * Works in two contexts:
 * - Electron windows: Traffic lights on left (handled by OS), badges centered
 * - Viewer overlays: Badges centered, close button on right
 *
 * Use `onClose` prop to show the close button on the right.
 */

import * as React from 'react'
import { X, type LucideIcon } from 'lucide-react'
import { cn } from '../../lib/utils'

/**
 * Badge variants using semantic colors
 */
export const PREVIEW_BADGE_VARIANTS = {
  // Semantic tool variants (use 6-color design system)
  edit: 'bg-info/15 text-info',
  write: 'bg-success/15 text-success',
  read: 'bg-background text-foreground/70',
  bash: 'bg-background text-foreground/70',
  grep: 'bg-background text-foreground/70',
  glob: 'bg-background text-foreground/70',

  // Color-based variants (for flexibility)
  blue: 'bg-blue-500/10 text-blue-600 dark:text-blue-400',
  amber: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
  orange: 'bg-orange-500/10 text-orange-600 dark:text-orange-400',
  green: 'bg-green-500/10 text-green-600 dark:text-green-400',
  purple: 'bg-purple-500/10 text-purple-600 dark:text-purple-400',
  gray: 'bg-gray-500/10 text-gray-600 dark:text-gray-400',

  // Default - white background (for file paths, metadata)
  default: 'bg-background text-foreground/70',
} as const

export type PreviewBadgeVariant = keyof typeof PREVIEW_BADGE_VARIANTS

export interface PreviewHeaderBadgeProps {
  /** Icon component to display */
  icon?: LucideIcon
  /** Badge label text */
  label: string
  /** Badge variant (default: 'default') */
  variant?: PreviewBadgeVariant
  /** Click handler (makes it a clickable link-style button) */
  onClick?: () => void
  /** Title for tooltip */
  title?: string
  /** Additional className */
  className?: string
  /** Allow badge to shrink (for long paths) - default: false */
  shrinkable?: boolean
}

/**
 * PreviewHeaderBadge - Badge component for preview headers
 *
 * Style specs:
 * - Height: 26px
 * - Padding: 10px horizontal
 * - Border radius: 6px
 * - Font: Sans-serif, 13px, medium weight
 * - Truncation: CSS truncate, shrink, stay 1 line
 * - Clickable: underline on hover, pointer cursor
 */
export function PreviewHeaderBadge({
  icon: Icon,
  label,
  variant = 'default',
  onClick,
  title,
  className,
  shrinkable = false,
}: PreviewHeaderBadgeProps) {
  const variantClasses = PREVIEW_BADGE_VARIANTS[variant]
  const baseClasses = cn(
    'flex items-center gap-1.5 h-[26px] px-2.5 rounded-[6px] font-sans text-[13px] font-medium shadow-minimal',
    variantClasses,
    className
  )

  if (onClick) {
    return (
      <button
        onClick={onClick}
        className={cn(baseClasses, 'min-w-0 cursor-pointer group')}
        title={title || label}
      >
        {Icon && <Icon className="w-3.5 h-3.5 shrink-0" />}
        <span className="truncate group-hover:underline">{label}</span>
      </button>
    )
  }

  return (
    <div className={cn(baseClasses, shrinkable ? 'min-w-0' : 'shrink-0')} title={title || label}>
      {Icon && <Icon className="w-3.5 h-3.5 shrink-0" />}
      <span className="truncate">{label}</span>
    </div>
  )
}

export interface PreviewHeaderProps {
  /** Badge elements to render in center */
  children?: React.ReactNode
  /** Close handler - when provided, shows X button on right */
  onClose?: () => void
  /** Height of the header (default: 50px for windows, 44px for overlays) */
  height?: number
  /** Additional className for the header */
  className?: string
  /** Inline styles */
  style?: React.CSSProperties
}

/**
 * PreviewHeader - Header/toolbar for preview windows and overlays
 *
 * Layout:
 * - Left: 70px spacer (for macOS traffic lights in Electron)
 * - Center: Badges row
 * - Right: Close button (if onClose provided) or 70px spacer
 */
export function PreviewHeader({
  children,
  onClose,
  height = 50,
  className,
  style,
}: PreviewHeaderProps) {
  return (
    <div
      className={cn(
        'shrink-0 flex items-center justify-between px-5 border-b border-foreground/5',
        'backdrop-blur-xl backdrop-saturate-150',
        'bg-white dark:bg-[#302f33]',
        className
      )}
      style={{ height, ...style }}
    >
      {/* Left side - space for traffic lights on macOS */}
      <div className="w-[70px] shrink-0" />

      {/* Center - badges row */}
      <div className="flex items-center gap-2 min-w-0">
        {children}
      </div>

      {/* Right side - close button or spacer */}
      {onClose ? (
        <div className="w-[76px] shrink-0 flex justify-end">
          <button
            onClick={onClose}
            className={cn(
              'p-1.5 rounded-[8px] transition-colors',
              'text-foreground/50 hover:text-foreground',
              'hover:bg-foreground/5',
              'focus:outline-none focus-visible:ring-1 focus-visible:ring-ring'
            )}
            title="Close (Esc)"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      ) : (
        <div className="w-[76px] shrink-0" />
      )}
    </div>
  )
}
