import * as React from 'react'
import * as Icons from 'lucide-react'
import { cn } from '@/lib/utils'

export type MobileMenuItemAffordance = 'chevron' | 'external' | 'none'

export interface MobileMenuItemProps {
  /** Lucide icon component or null for a custom node. */
  icon?: React.ReactNode
  label: string
  /**
   * Right-side trailing affordance.
   * - `chevron`  → drills into a sub-page
   * - `external` → opens an external URL
   * - `none`     → fires a callback in place
   */
  affordance?: MobileMenuItemAffordance
  /** Sub-text rendered below the label. Optional. */
  description?: string
  onClick: () => void
  destructive?: boolean
  className?: string
}

/**
 * Touch-friendly menu row. 44px minimum tap target, full-row tap surface,
 * subtle alpha-based active state (no hover styling — touch users have no hover).
 */
export function MobileMenuItem({
  icon,
  label,
  affordance = 'none',
  description,
  onClick,
  destructive,
  className,
}: MobileMenuItemProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-3 px-4 min-h-[44px] py-2.5 text-left',
        'active:bg-foreground/10 transition-colors',
        destructive ? 'text-destructive' : 'text-foreground',
        className,
      )}
    >
      {icon && (
        <span className={cn(
          'shrink-0 flex items-center justify-center',
          destructive ? 'text-destructive' : 'text-foreground/70',
        )}>
          {icon}
        </span>
      )}
      <span className="flex-1 min-w-0">
        <span className="block text-base leading-tight">{label}</span>
        {description && (
          <span className="block text-[13px] text-foreground/50 truncate mt-0.5">
            {description}
          </span>
        )}
      </span>
      {affordance === 'chevron' && (
        <Icons.ChevronRight className="h-4 w-4 shrink-0 text-foreground/40" strokeWidth={1.75} />
      )}
      {affordance === 'external' && (
        <Icons.ExternalLink className="h-4 w-4 shrink-0 text-foreground/40" strokeWidth={1.75} />
      )}
    </button>
  )
}
