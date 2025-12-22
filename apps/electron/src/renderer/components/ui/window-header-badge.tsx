import * as React from 'react'
import type { LucideIcon } from 'lucide-react'

/**
 * Pre-defined badge configs for common tool types
 */
export const BADGE_CONFIGS = {
  read: {
    bgColor: 'rgba(59, 130, 246, 0.12)',
    textColor: 'rgb(59, 130, 246)',
  },
  write: {
    bgColor: 'rgba(34, 197, 94, 0.12)',
    textColor: 'rgb(34, 197, 94)',
  },
  edit: {
    bgColor: 'rgba(249, 115, 22, 0.12)',
    textColor: 'rgb(249, 115, 22)',
  },
  bash: {
    bgColor: 'rgba(255, 255, 255, 0.1)',
    textColor: 'rgb(228, 228, 228)',
  },
  grep: {
    bgColor: 'rgba(168, 85, 247, 0.15)',
    textColor: 'rgb(168, 85, 247)',
  },
  glob: {
    bgColor: 'rgba(6, 182, 212, 0.15)',
    textColor: 'rgb(6, 182, 212)',
  },
  // Neutral badges for paths, info, etc.
  neutralDark: {
    bgColor: 'rgba(255, 255, 255, 0.08)',
    textColor: 'rgba(255, 255, 255, 0.7)',
  },
  neutralLight: {
    bgColor: 'rgba(0, 0, 0, 0.05)',
    textColor: 'rgba(0, 0, 0, 0.6)',
  },
  // Dimmed neutral for secondary info
  dimmedDark: {
    bgColor: 'rgba(255, 255, 255, 0.05)',
    textColor: 'rgba(255, 255, 255, 0.4)',
  },
  dimmedLight: {
    bgColor: 'rgba(0, 0, 0, 0.03)',
    textColor: 'rgba(0, 0, 0, 0.4)',
  },
} as const

export type BadgeType = keyof typeof BADGE_CONFIGS

interface WindowHeaderBadgeProps {
  /** Icon component to display */
  Icon?: LucideIcon
  /** Badge label text */
  label: string
  /** Background color */
  bgColor: string
  /** Text color */
  textColor: string
  /** Click handler (makes it a clickable link-style button) */
  onClick?: () => void
  /** Title for tooltip */
  title?: string
  /** Additional className */
  className?: string
}

/**
 * WindowHeaderBadge - Unified badge component for preview window headers
 *
 * Style specs:
 * - Height: 26px
 * - Padding: 10px horizontal
 * - Border radius: 6px
 * - Font: Sans-serif, 13px, medium weight
 * - Shadow: shadow-minimal
 * - Truncation: CSS truncate (end), shrink x, stay 1 line
 * - Clickable: underline on hover, pointer cursor, opens file
 */
export function WindowHeaderBadge({
  Icon,
  label,
  bgColor,
  textColor,
  onClick,
  title,
  className = '',
}: WindowHeaderBadgeProps) {
  const baseClasses = `flex items-center gap-1.5 h-[26px] px-2.5 rounded-[6px] font-sans text-[13px] font-medium shadow-minimal ${className}`
  const style = {
    backgroundColor: bgColor,
    color: textColor,
  } as React.CSSProperties

  if (onClick) {
    return (
      <button
        onClick={onClick}
        className={`${baseClasses} min-w-0 cursor-pointer group titlebar-no-drag`}
        style={style}
        title={title || label}
      >
        {Icon && <Icon className="w-3.5 h-3.5 shrink-0" />}
        <span className="truncate group-hover:underline">{label}</span>
      </button>
    )
  }

  return (
    <div className={`${baseClasses} shrink-0`} style={style} title={title}>
      {Icon && <Icon className="w-3.5 h-3.5 shrink-0" />}
      <span className="truncate">{label}</span>
    </div>
  )
}

interface WindowHeaderProps {
  /** Badge elements to render in center */
  children: React.ReactNode
  /** Border color for toolbar */
  borderColor?: string
  /** Additional className for the toolbar */
  className?: string
}

/**
 * WindowHeader - Standardized header/toolbar for preview windows
 */
export function WindowHeader({
  children,
  borderColor = 'rgba(255,255,255,0.1)',
  className = '',
}: WindowHeaderProps) {
  return (
    <div
      className={`titlebar-drag-region h-[52px] shrink-0 flex items-center justify-between px-4 ${className}`}
      style={{ borderBottom: `1px solid ${borderColor}` }}
    >
      {/* Left side - space for traffic lights on macOS */}
      <div className="w-[70px] shrink-0" />

      {/* Center - badges row */}
      <div className="flex items-center gap-2 min-w-0 p-2">
        {children}
      </div>

      {/* Right side - placeholder for future actions */}
      <div className="w-[70px] shrink-0" />
    </div>
  )
}
