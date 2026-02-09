/**
 * LabelBadge - Compact chip showing a label's color, name, and optional typed value.
 *
 * Used above FreeFormInput to display applied session labels. Clicking opens
 * LabelValuePopover for editing the value or removing the label.
 *
 * Layout: [colored circle] [name] [value in mono]
 * - Boolean labels (no valueType): just circle + name
 * - Valued labels: circle + name + formatted value in mono text
 */

import * as React from 'react'
import { cn } from '@/lib/utils'
import { LabelIcon, LabelValueTypeIcon } from './label-icon'
import { formatDisplayValue } from '@g4os/shared/labels'
import type { LabelConfig } from '@g4os/shared/labels'

export interface LabelBadgeProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Label configuration (for color, name, valueType) */
  label: LabelConfig
  /** Current raw value string (undefined for boolean labels) */
  value?: string
  /** Whether the popover is currently open (controls active state styling) */
  isActive?: boolean
}

export const LabelBadge = React.forwardRef<HTMLButtonElement, LabelBadgeProps>(
  function LabelBadge({ label, value, isActive = false, className, ...buttonProps }, ref) {
    const displayValue = value ? formatDisplayValue(value, label.valueType) : undefined

    return (
      <button
        ref={ref}
        type="button"
        {...buttonProps}
        className={cn(
          // Base chip styles
          'inline-flex items-center gap-1.5 h-6 px-2 rounded-[5px]',
          'text-[12px] leading-none text-foreground/80 select-none',
          'bg-background shadow-thin',
          'transition-colors cursor-pointer',
          // Hover and active states
          'hover:bg-foreground/5 hover:text-foreground',
          isActive && 'bg-foreground/5 text-foreground',
          className
        )}
      >
        {/* Colored circle representing the label */}
        <LabelIcon label={label} size="xs" />

        {/* Label name */}
        <span className="truncate max-w-[100px]">{label.name}</span>

        {/* Optional value, visually separated — or placeholder icon if typed but no value set */}
        {displayValue ? (
          <>
            <span className="text-foreground/30">·</span>
            <span className="text-[11px] text-foreground/60 truncate max-w-[120px]">
              {displayValue}
            </span>
          </>
        ) : (
          label.valueType && (
            <>
              <span className="text-foreground/30">·</span>
              <LabelValueTypeIcon valueType={label.valueType} />
            </>
          )
        )}
      </button>
    )
  }
)
