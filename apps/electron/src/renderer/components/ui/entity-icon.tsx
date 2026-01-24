/**
 * EntityIcon - Unified base component for rendering any entity's icon.
 *
 * Handles three icon kinds:
 * - emoji: Renders as sized text span with bg-muted container
 * - file: Renders via CrossfadeAvatar with smooth loading transition
 * - fallback: Renders the fallbackIcon (Lucide component) with proper sizing
 *
 * Entity-specific wrappers (SourceAvatar, SkillAvatar, StatusIcon)
 * call this with their own fallbackIcon and any extra chrome (status dots, color, etc.)
 *
 * The fallbackIcon prop is the primary customisation point for subclasses.
 * EntityIcon handles all sizing, styling, and rendering logic internally.
 */

import * as React from 'react'
import { CrossfadeAvatar } from '@/components/ui/avatar'
import { cn } from '@/lib/utils'
import type { ResolvedEntityIcon, IconSize } from '@craft-agent/shared/icons'
import { ICON_SIZE_CLASSES, ICON_EMOJI_SIZES } from '@craft-agent/shared/icons'

/**
 * Any React component that accepts className prop.
 * Compatible with Lucide icons, custom SVG components (e.g. McpIcon), etc.
 */
export type IconComponent = React.ComponentType<{ className?: string }>

// ============================================================================
// Props
// ============================================================================

export interface EntityIconProps {
  /** Resolved icon from useEntityIcon hook */
  icon: ResolvedEntityIcon
  /** Size variant (default: 'md') */
  size?: IconSize
  /** Icon component rendered when icon.kind === 'fallback' (Lucide icon or custom SVG) */
  fallbackIcon: IconComponent
  /** Escape hatch: fully custom fallback ReactNode (overrides fallbackIcon if provided) */
  fallback?: React.ReactNode
  /** Alt text for accessibility */
  alt?: string
  /** Additional className on the outer container */
  className?: string
  /**
   * Override container size class.
   * Use 'h-full w-full' for fluid sizing within a parent container.
   * If provided, replaces the default ICON_SIZE_CLASSES for the given size.
   */
  containerClassName?: string
  /**
   * When true, renders emoji without container chrome (no bg, ring, or rounded).
   * Used for inline emoji icons in the sidebar where the container is unnecessary.
   */
  chromeless?: boolean
}

// ============================================================================
// Component
// ============================================================================

export function EntityIcon({
  icon,
  size = 'md',
  fallbackIcon: FallbackIcon,
  fallback,
  alt,
  className,
  containerClassName,
  chromeless,
}: EntityIconProps) {
  // Container size: use override if provided, otherwise standard size classes
  const sizeClass = containerClassName ?? ICON_SIZE_CLASSES[size]

  // Standard container styling (ring + rounded + shrink-0)
  const containerBase = 'rounded-[4px] ring-1 ring-border/30 shrink-0'

  // --- Emoji rendering ---
  if (icon.kind === 'emoji') {
    return (
      <div
        className={cn(
          sizeClass,
          // Chromeless mode: no background, ring, or rounded — just the emoji
          !chromeless && containerBase,
          !chromeless && 'bg-muted',
          'flex items-center justify-center',
          ICON_EMOJI_SIZES[size],
          'leading-none',
          className,
        )}
        title={alt}
      >
        {icon.value}
      </div>
    )
  }

  // --- File icon rendering ---
  if (icon.kind === 'file') {
    // Colorable SVGs with rawSvg: render inline so CSS color classes from the
    // parent cascade into SVG fills/strokes via currentColor inheritance.
    // Parent applies color via Tailwind class (e.g. <span className="text-success">).
    if (icon.colorable && icon.rawSvg) {
      return (
        <div
          className={cn(sizeClass, containerBase, className)}
          title={alt}
          dangerouslySetInnerHTML={{ __html: icon.rawSvg }}
        />
      )
    }

    // Non-colorable files (raster images, SVGs with hardcoded colors):
    // render via CrossfadeAvatar with smooth loading transition
    const fallbackNode = fallback ?? (
      <FallbackIcon className="w-full h-full text-muted-foreground p-0.5" />
    )

    return (
      <CrossfadeAvatar
        src={icon.value}
        alt={alt}
        className={cn(sizeClass, containerBase, className)}
        fallbackClassName="bg-muted rounded-[4px]"
        fallback={fallbackNode}
      />
    )
  }

  // --- Fallback rendering (no icon file or emoji found) ---
  if (fallback) {
    // Escape hatch: render custom fallback node
    return (
      <div
        className={cn(sizeClass, containerBase, 'bg-muted', className)}
        title={alt}
      >
        {fallback}
      </div>
    )
  }

  // Default: render the Lucide fallback icon via CrossfadeAvatar (shows immediately, no loading)
  return (
    <CrossfadeAvatar
      src={null}
      alt={alt}
      className={cn(sizeClass, containerBase, className)}
      fallbackClassName="bg-muted rounded-[4px]"
      fallback={<FallbackIcon className="w-full h-full text-muted-foreground p-0.5" />}
    />
  )
}
