import type { ComponentPropsWithRef, ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'

import { cn } from '@/lib/utils'

interface SidebarSectionHeaderProps {
  title: string
  icon?: ReactNode
  actions?: ReactNode
  className?: string
  onClick?: () => void
  active?: boolean
  navigationProps?: ComponentPropsWithRef<'button'>
  expanded?: boolean
  onToggle?: () => void
}

/**
 * Compact section heading used by the workspace sidebar. Actions stay visible
 * because creating and filtering are primary navigation operations, not hover
 * affordances.
 */
export function SidebarSectionHeader({
  title,
  icon,
  actions,
  className,
  onClick,
  active = false,
  navigationProps,
  expanded,
  onToggle,
}: SidebarSectionHeaderProps) {
  const isInteractive = Boolean(onClick)

  if (icon) {
    return (
      <div className={cn(
        'group/sidebar-header mx-2 flex min-h-7 items-center gap-2 rounded-[6px] px-2 py-[5px] text-[13px] font-normal text-foreground/70 transition-colors hover:bg-sidebar-hover',
        active && 'text-foreground',
        className,
      )}>
        <span className="relative flex h-3.5 w-3.5 shrink-0 items-center justify-center">
          <span className={cn('absolute inset-0 flex items-center justify-center transition-opacity', onToggle && 'group-hover/sidebar-header:opacity-0')}>
            {icon}
          </span>
          {onToggle && (
            <span
              role="button"
              tabIndex={0}
              onClick={event => { event.stopPropagation(); onToggle() }}
              onKeyDown={event => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  event.stopPropagation()
                  onToggle()
                }
              }}
              className="absolute inset-0 flex cursor-pointer items-center justify-center opacity-0 transition-opacity group-hover/sidebar-header:opacity-100 focus-visible:opacity-100"
              aria-expanded={expanded}
              aria-label={title}
            >
              <ChevronDown className={cn('h-3.5 w-3.5 -rotate-90 text-muted-foreground transition-transform', expanded && 'rotate-0')} />
            </span>
          )}
        </span>
        {isInteractive ? (
          <button
            type="button"
            {...navigationProps}
            onClick={onClick}
            className={cn('min-w-0 flex-1 truncate text-left outline-none focus-visible:underline', navigationProps?.className)}
          >
            {title}
          </button>
        ) : (
          <span className="min-w-0 flex-1 truncate">{title}</span>
        )}
        {actions && <div className="flex shrink-0 items-center gap-0.5">{actions}</div>}
      </div>
    )
  }

  return (
    <div className={cn('group/sidebar-header flex h-7 items-center gap-1 px-2 text-left text-[12px] font-medium text-foreground/55', className)}>
      {isInteractive ? (
        <button
          type="button"
          {...navigationProps}
          onClick={onClick}
          className={cn(
            'min-w-0 flex-1 truncate rounded-md px-0 py-1 text-left transition-colors',
            active
              ? 'text-foreground'
              : 'hover:bg-foreground/[0.05] hover:text-foreground',
            navigationProps?.className,
          )}
        >
          {title}
        </button>
      ) : (
        <span className="min-w-0 flex-1 truncate">{title}</span>
      )}
      {onToggle && (
        <button
          type="button"
          onClick={onToggle}
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-foreground/35 opacity-0 transition-opacity hover:bg-foreground/[0.05] hover:text-foreground focus-visible:opacity-100 group-hover/sidebar-header:opacity-100"
          aria-expanded={expanded}
          aria-label={title}
        >
          <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', !expanded && '-rotate-90')} />
        </button>
      )}
      {actions && <div className="flex shrink-0 items-center gap-0.5">{actions}</div>}
    </div>
  )
}
