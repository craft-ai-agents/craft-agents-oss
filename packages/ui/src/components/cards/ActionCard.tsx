import * as React from 'react'
import { useState, useEffect, useCallback } from 'react'
import { Copy, Check } from 'lucide-react'
import { cn } from '../../lib/utils'

// ============================================================================
// Types
// ============================================================================

export interface ActionCardAction {
  /** Button label */
  label: string
  /** 'primary' uses brand color bg, 'secondary' uses outline, 'ghost' is text-only */
  variant: 'primary' | 'secondary' | 'ghost'
  onClick: () => void
  /** Optional icon element */
  icon?: React.ReactNode
  /** Disable this action (e.g., source not connected) */
  disabled?: boolean
  /** Tooltip text when disabled */
  disabledReason?: string
}

export interface ActionCardProps {
  /** Icon rendered in header (Lucide element, img, emoji, etc.) */
  icon?: React.ReactNode
  /** Card title (e.g., "Email Draft") */
  title: string
  /** Tag shown right-aligned in header (e.g., recipient, channel name) */
  tag?: string
  /** Brand color for this card — sets header tint and primary button color.
   *  Pass a CSS color string or { light, dark } for mode-aware theming.
   *  Falls back to var(--accent) if not provided. */
  brandColor?: string | { light: string; dark: string }
  /** Main body content */
  children: React.ReactNode
  /** Footer action buttons */
  actions?: ActionCardAction[]
  /** Max content height before scroll (default 400) */
  maxHeight?: number
  /** Whether source is connected — disables primary actions if false */
  sourceConnected?: boolean
  /** Additional className on the root element */
  className?: string
}

// ============================================================================
// Size Config (matches TurnCard's SIZE_CONFIG)
// ============================================================================

const SIZE = {
  fontSize: 'text-[13px]',
  iconSize: 'w-3.5 h-3.5',
} as const

// ============================================================================
// Sub-components
// ============================================================================

function ActionButton({
  label,
  variant,
  onClick,
  icon,
  disabled,
  disabledReason,
  useBrandColor,
}: ActionCardAction & { useBrandColor: boolean }) {
  const base = cn(
    'inline-flex items-center gap-1.5 rounded-md px-3 h-8 text-xs font-medium transition-colors',
    'focus:outline-none focus-visible:ring-1 focus-visible:ring-ring',
    'select-none whitespace-nowrap',
    disabled && 'opacity-50 cursor-not-allowed',
  )

  const variants: Record<string, string> = {
    primary: useBrandColor
      ? 'bg-[var(--card-brand)] text-white shadow-sm hover:opacity-90'
      : 'bg-accent text-background shadow-sm hover:bg-accent/90',
    secondary: 'border border-foreground/15 bg-background shadow-sm hover:bg-foreground/3 text-foreground',
    ghost: 'text-muted-foreground hover:text-foreground hover:bg-foreground/3',
  }

  return (
    <button
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      className={cn(base, variants[variant])}
      title={disabled ? disabledReason : undefined}
    >
      {icon}
      {label}
    </button>
  )
}

/** Built-in copy action for convenience */
function CopyAction({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      console.error('Failed to copy:', err)
    }
  }, [text])

  return (
    <button
      onClick={handleCopy}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md px-3 h-8 text-xs font-medium transition-colors select-none',
        'focus:outline-none focus-visible:ring-1 focus-visible:ring-ring',
        copied ? 'text-success' : 'text-muted-foreground hover:text-foreground hover:bg-foreground/3',
      )}
    >
      {copied ? <Check className={SIZE.iconSize} /> : <Copy className={SIZE.iconSize} />}
      {copied ? 'Copied!' : 'Copy'}
    </button>
  )
}

// ============================================================================
// ActionCard
// ============================================================================

/**
 * ActionCard — A themed card component for rich AI response types.
 *
 * Follows the same visual language as ResponseCard:
 * - shadow-minimal rounded container
 * - Header with icon, title, tag
 * - Scrollable content area
 * - Footer with action buttons
 *
 * Supports source brand theming via --card-brand CSS variable.
 * When brandColor is provided, the header tint and primary buttons use it.
 */
export function ActionCard({
  icon,
  title,
  tag,
  brandColor,
  children,
  actions,
  maxHeight = 400,
  sourceConnected = true,
  className,
}: ActionCardProps) {
  // Dark mode detection (same pattern as ResponseCard)
  const [isDarkMode, setIsDarkMode] = useState(false)

  useEffect(() => {
    const checkDarkMode = () => {
      setIsDarkMode(document.documentElement.classList.contains('dark'))
    }
    checkDarkMode()
    const observer = new MutationObserver(checkDarkMode)
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
    return () => observer.disconnect()
  }, [])

  // Resolve brand color for current mode
  const resolvedBrand = brandColor
    ? typeof brandColor === 'string'
      ? brandColor
      : isDarkMode
        ? (brandColor.dark ?? brandColor.light)
        : brandColor.light
    : undefined

  const hasBrand = !!resolvedBrand

  // Extract text content from children for copy action
  const textContentRef = React.useRef<HTMLDivElement>(null)

  return (
    <div
      className={cn(
        'bg-background shadow-minimal rounded-[8px] overflow-hidden',
        className,
      )}
      style={resolvedBrand ? {
        '--card-brand': resolvedBrand,
      } as React.CSSProperties : undefined}
    >
      {/* Header */}
      <div
        className={cn(
          'px-4 py-2 border-b border-border/30 flex items-center gap-2',
          SIZE.fontSize,
        )}
        style={resolvedBrand ? {
          backgroundColor: `color-mix(in oklab, ${resolvedBrand} 5%, var(--background))`,
        } : {
          backgroundColor: 'color-mix(in oklab, var(--accent) 5%, var(--background))',
        }}
      >
        {/* Icon */}
        {icon && (
          <span
            className="shrink-0"
            style={resolvedBrand ? { color: resolvedBrand } : undefined}
          >
            {icon}
          </span>
        )}

        {/* Title */}
        <span className="font-medium truncate" style={resolvedBrand ? { color: resolvedBrand } : undefined}>
          {title}
        </span>

        {/* Spacer */}
        <span className="flex-1" />

        {/* Tag */}
        {tag && (
          <span className="shrink-0 text-muted-foreground text-[11px] font-mono truncate max-w-[200px]">
            {tag}
          </span>
        )}
      </div>

      {/* Content */}
      <div
        ref={textContentRef}
        className="px-5 py-4 text-sm overflow-y-auto"
        style={{
          maxHeight,
          ...(isDarkMode && {
            maskImage: 'linear-gradient(to bottom, transparent 0%, black 12px, black calc(100% - 12px), transparent 100%)',
            WebkitMaskImage: 'linear-gradient(to bottom, transparent 0%, black 12px, black calc(100% - 12px), transparent 100%)',
          }),
        }}
      >
        {children}
      </div>

      {/* Footer */}
      {actions && actions.length > 0 && (
        <div className={cn(
          'px-4 py-2 border-t border-border/30 flex items-center justify-end gap-2 bg-muted/20',
          SIZE.fontSize,
        )}>
          {actions.map((action, i) => (
            <ActionButton
              key={`${action.label}-${i}`}
              {...action}
              disabled={action.disabled || (action.variant === 'primary' && !sourceConnected)}
              disabledReason={
                action.disabledReason ||
                (action.variant === 'primary' && !sourceConnected ? 'Source not connected' : undefined)
              }
              useBrandColor={hasBrand}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// Re-export CopyAction for card authors to use
ActionCard.CopyAction = CopyAction
