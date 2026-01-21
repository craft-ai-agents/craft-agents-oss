import * as React from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import * as ReactDOM from 'react-dom'
import { cn } from '../../lib/utils'

/**
 * SimpleDropdown - A lightweight dropdown menu without external dependencies
 *
 * Features:
 * - Click-outside detection
 * - Portal rendering for proper stacking
 * - Keyboard navigation (Escape to close)
 * - Position-aware (flips if near edge)
 */

export interface SimpleDropdownItemProps {
  /** Click handler */
  onClick: (e?: React.MouseEvent) => void
  /** Item content */
  children: React.ReactNode
  /** Optional icon (rendered before label) */
  icon?: React.ReactNode
  /** Destructive variant - red text */
  variant?: 'default' | 'destructive'
  /** Additional className */
  className?: string
}

export function SimpleDropdownItem({
  onClick,
  children,
  icon,
  variant = 'default',
  className,
}: SimpleDropdownItemProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex items-center gap-2 w-full px-2.5 py-1.5 text-left text-[13px] rounded-[4px]",
        "hover:bg-foreground/[0.05] focus:bg-foreground/[0.05] focus:outline-none",
        "transition-colors",
        variant === 'destructive' && "text-destructive hover:text-destructive",
        className
      )}
    >
      {icon && (
        <span className="w-3.5 h-3.5 flex items-center justify-center shrink-0 [&>svg]:w-3.5 [&>svg]:h-3.5">
          {icon}
        </span>
      )}
      <span className="flex-1">{children}</span>
    </button>
  )
}

export interface SimpleDropdownProps {
  /** Trigger element */
  trigger: React.ReactNode
  /** Menu items */
  children: React.ReactNode
  /** Alignment relative to trigger */
  align?: 'start' | 'end'
  /** Additional className for the menu */
  className?: string
  /** Whether the dropdown is disabled */
  disabled?: boolean
  /** Callback when open state changes */
  onOpenChange?: (open: boolean) => void
}

export function SimpleDropdown({
  trigger,
  children,
  align = 'end',
  className,
  disabled = false,
  onOpenChange,
}: SimpleDropdownProps) {
  const [isOpen, setIsOpen] = useState(false)

  // Notify parent of open state changes
  const setIsOpenWithCallback = useCallback((open: boolean | ((prev: boolean) => boolean)) => {
    setIsOpen(prev => {
      const newValue = typeof open === 'function' ? open(prev) : open
      if (newValue !== prev) {
        onOpenChange?.(newValue)
      }
      return newValue
    })
  }, [onOpenChange])
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null)
  const triggerRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  const updatePosition = useCallback(() => {
    if (!triggerRef.current) return

    const rect = triggerRef.current.getBoundingClientRect()
    const menuWidth = 160 // Approximate menu width

    let left = align === 'end' ? rect.right - menuWidth : rect.left
    const top = rect.bottom + 4

    // Keep menu within viewport
    if (left < 8) left = 8
    if (left + menuWidth > window.innerWidth - 8) {
      left = window.innerWidth - menuWidth - 8
    }

    setPosition({ top, left })
  }, [align])

  const handleToggle = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    if (disabled) return

    if (!isOpen) {
      // Calculate position before opening to prevent animation from wrong position
      if (triggerRef.current) {
        const rect = triggerRef.current.getBoundingClientRect()
        const menuWidth = 160
        let left = align === 'end' ? rect.right - menuWidth : rect.left
        const top = rect.bottom + 4
        if (left < 8) left = 8
        if (left + menuWidth > window.innerWidth - 8) {
          left = window.innerWidth - menuWidth - 8
        }
        setPosition({ top, left })
      }
    }
    setIsOpenWithCallback(prev => !prev)
  }, [disabled, isOpen, align])

  const handleClose = useCallback(() => {
    setIsOpenWithCallback(false)
  }, [setIsOpenWithCallback])

  // Update position when opening (for edge cases like window resize)
  useEffect(() => {
    if (isOpen) {
      updatePosition()
    }
  }, [isOpen, updatePosition])

  // Click outside detection
  useEffect(() => {
    if (!isOpen) return

    const handleClickOutside = (e: MouseEvent) => {
      if (
        menuRef.current &&
        !menuRef.current.contains(e.target as Node) &&
        triggerRef.current &&
        !triggerRef.current.contains(e.target as Node)
      ) {
        handleClose()
      }
    }

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        handleClose()
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleEscape)

    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [isOpen, handleClose])

  // Wrap item clicks to close menu and prevent event bubbling
  // This ensures dropdown item clicks don't propagate to parent elements
  // (e.g., clicking "View Turn Details" shouldn't expand the turn card)
  const wrappedChildren = React.Children.map(children, child => {
    if (React.isValidElement<SimpleDropdownItemProps>(child) && child.type === SimpleDropdownItem) {
      return React.cloneElement(child, {
        onClick: (e?: React.MouseEvent) => {
          e?.stopPropagation()
          child.props.onClick()
          handleClose()
        },
      } as Partial<SimpleDropdownItemProps>)
    }
    return child
  })

  return (
    <>
      <div
        ref={triggerRef}
        onClick={handleToggle}
        className={cn("inline-flex", disabled && "opacity-50 pointer-events-none")}
      >
        {trigger}
      </div>

      {isOpen && position && ReactDOM.createPortal(
        <div
          ref={menuRef}
          className={cn(
            "fixed z-50 min-w-[140px] p-1",
            "bg-background rounded-[8px] shadow-strong border border-border/50",
            "animate-in fade-in-0 zoom-in-95 duration-100",
            className
          )}
          style={{ top: position.top, left: position.left }}
        >
          {wrappedChildren}
        </div>,
        document.body
      )}
    </>
  )
}
