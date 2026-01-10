/**
 * Panel - Base container component for app panels
 *
 * Provides consistent styling for panel containers including:
 * - Background color (theme-aware)
 * - Shadow (shadow-middle)
 * - Corner radius (14px)
 * - Overflow handling
 *
 * Usage:
 * ```tsx
 * <Panel variant="grow">
 *   <PanelHeader title="Title" subtitle="Subtitle" />
 *   <Separator />
 *   {content}
 * </Panel>
 * ```
 */

import * as React from 'react'
import { cn } from '@/lib/utils'

export interface PanelProps {
  /** Panel sizing behavior */
  variant?: 'shrink' | 'grow'
  /** Fixed width in pixels (only for shrink variant) */
  width?: number
  /** Optional className for additional styling */
  className?: string
  /** Optional inline styles */
  style?: React.CSSProperties
  /** Panel content */
  children: React.ReactNode
}

/**
 * Base panel container with consistent styling
 */
export function Panel({
  variant = 'grow',
  width,
  className,
  style,
  children,
}: PanelProps) {
  return (
    <div
      className={cn(
        // Base styles shared by all panels
        'h-full flex flex-col min-w-0 bg-background shadow-middle rounded-[14px] overflow-hidden',
        // Variant-specific styles
        variant === 'grow' && 'flex-1',
        variant === 'shrink' && 'shrink-0',
        className
      )}
      style={{
        ...(variant === 'shrink' && width ? { width } : {}),
        ...style,
      }}
    >
      {children}
    </div>
  )
}
