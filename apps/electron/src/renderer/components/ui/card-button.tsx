/**
 * The compact text-and-icon action in a popover card's footer (background task card, PR card):
 * 28px, secondary text, hover fill; `destructive` tints it for Stop-like actions.
 */

import * as React from 'react'
import { cn } from '@/lib/utils'

export interface CardButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** A Lucide icon, or any component taking a className (a Spinner while busy) */
  icon: React.ComponentType<{ className?: string }>
  tone?: 'destructive'
}

export function CardButton({ icon: Icon, tone, children, className, ...props }: CardButtonProps) {
  return (
    <button
      type="button"
      {...props}
      className={cn(
        'motion-press inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-label-sm font-medium -outline-offset-2',
        'transition-[background-color,color] duration-micro ease-out-subtle hover:duration-instant',
        'disabled:pointer-events-none disabled:text-disabled',
        tone === 'destructive' ? 'text-destructive hover:bg-destructive-tint' : 'text-secondary hover:bg-fill-hover hover:text-foreground',
        className,
      )}
    >
      <Icon className="size-3.5 shrink-0" />
      {children}
    </button>
  )
}
