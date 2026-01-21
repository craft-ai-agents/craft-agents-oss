/**
 * SettingsMenuSelect
 *
 * Menu-style dropdown select with support for option descriptions.
 * Uses Radix Popover for collision detection and accessibility.
 */

import * as React from 'react'
import { Check, ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { settingsUI } from './SettingsUIConstants'

export interface SettingsMenuSelectOption {
  /** Value for this option */
  value: string
  /** Display label */
  label: string
  /** Optional description/subtitle */
  description?: string
}

export interface SettingsMenuSelectProps {
  /** Currently selected value */
  value: string
  /** Change handler */
  onValueChange: (value: string) => void
  /** Available options */
  options: SettingsMenuSelectOption[]
  /** Placeholder when nothing selected */
  placeholder?: string
  /** Disabled state */
  disabled?: boolean
  /** Additional className for trigger */
  className?: string
  /** Width of the dropdown menu */
  menuWidth?: number
  /** Called when hovering over an option (for live preview). Pass null on leave. */
  onHover?: (value: string | null) => void
}

/**
 * SettingsMenuSelect - Menu-style dropdown with descriptions
 *
 * Uses Radix Popover for automatic collision detection and positioning.
 * Trigger styled like the model selector in FreeFormInput.
 */
export function SettingsMenuSelect({
  value,
  onValueChange,
  options,
  placeholder = 'Select...',
  disabled,
  className,
  menuWidth = 280,
  onHover,
}: SettingsMenuSelectProps) {
  const [isOpen, setIsOpen] = React.useState(false)

  const selectedOption = options.find((o) => o.value === value)

  const handleSelect = (optionValue: string) => {
    onValueChange(optionValue)
    setIsOpen(false)
    // Clear preview on selection since the actual value is now set
    onHover?.(null)
  }

  // Clear preview when popover closes (via click outside, escape, etc.)
  const handleOpenChange = (open: boolean) => {
    setIsOpen(open)
    if (!open) {
      onHover?.(null)
    }
  }

  return (
    <Popover open={isOpen} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild disabled={disabled}>
        <button
          type="button"
          className={cn(
            'inline-flex items-center h-8 px-3 gap-1 text-sm rounded-lg',
            'bg-background shadow-minimal',
            'hover:bg-foreground/[0.02] transition-colors',
            'disabled:cursor-not-allowed disabled:opacity-50',
            isOpen && 'bg-foreground/[0.02]',
            className
          )}
        >
          <span className="truncate">{selectedOption?.label || placeholder}</span>
          <ChevronDown className="opacity-50 shrink-0 size-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={4}
        collisionPadding={8}
        className="p-1.5"
        style={{ width: menuWidth }}
        onMouseLeave={() => onHover?.(null)}
      >
        <div className="space-y-0.5">
          {options.map((option) => {
            const isSelected = value === option.value
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => handleSelect(option.value)}
                onMouseEnter={() => onHover?.(option.value)}
                className={cn(
                  'w-full flex items-center justify-between px-2.5 py-2 rounded-lg',
                  'hover:bg-foreground/5 transition-colors text-left',
                  isSelected && 'bg-foreground/3'
                )}
              >
                <div className="flex-1 min-w-0">
                  <div className={settingsUI.label}>{option.label}</div>
                  {option.description && (
                    <div className={cn(settingsUI.descriptionSmall, settingsUI.labelDescriptionGap)}>
                      {option.description}
                    </div>
                  )}
                </div>
                {isSelected && (
                  <Check className="size-4 text-foreground shrink-0 ml-3" />
                )}
              </button>
            )
          })}
        </div>
      </PopoverContent>
    </Popover>
  )
}

/**
 * SettingsMenuSelectRow - Inline row with label and menu select
 */
export interface SettingsMenuSelectRowProps {
  /** Row label */
  label: string
  /** Optional description below label */
  description?: string
  /** Currently selected value */
  value: string
  /** Change handler */
  onValueChange: (value: string) => void
  /** Available options */
  options: SettingsMenuSelectOption[]
  /** Placeholder text */
  placeholder?: string
  /** Disabled state */
  disabled?: boolean
  /** Additional className */
  className?: string
  /** Whether inside a card */
  inCard?: boolean
  /** Width of the dropdown menu */
  menuWidth?: number
  /** Called when hovering over an option (for live preview). Pass null on leave. */
  onHover?: (value: string | null) => void
}

export function SettingsMenuSelectRow({
  label,
  description,
  value,
  onValueChange,
  options,
  placeholder = 'Select...',
  disabled,
  className,
  inCard = true,
  menuWidth = 280,
  onHover,
}: SettingsMenuSelectRowProps) {
  return (
    <div
      className={cn(
        'flex items-center justify-between',
        inCard ? 'px-4 py-3.5' : 'py-3',
        className
      )}
    >
      <div className="flex-1 min-w-0">
        <div className={settingsUI.label}>{label}</div>
        {description && (
          <p className={cn(settingsUI.description, settingsUI.labelDescriptionGap)}>{description}</p>
        )}
      </div>
      <div className="ml-4 shrink-0">
        <SettingsMenuSelect
          value={value}
          onValueChange={onValueChange}
          options={options}
          placeholder={placeholder}
          disabled={disabled}
          menuWidth={menuWidth}
          onHover={onHover}
        />
      </div>
    </div>
  )
}
