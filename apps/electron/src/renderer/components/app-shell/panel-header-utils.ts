import { cn } from '@/lib/utils'

// Padding to compensate for macOS traffic lights (stoplight buttons)
// Traffic lights positioned at x:18, ~52px wide = 70px + 14px gap
export const STOPLIGHT_PADDING = 84

/**
 * Build the base className for the PanelHeader container.
 * Uses static pl-1 padding — no animated inline paddingLeft.
 */
export function buildPanelHeaderClassName(className?: string): string {
  return cn(
    'flex shrink-0 items-center pr-2 min-w-0 gap-1.5 relative z-panel h-[42px] pl-1',
    className
  )
}

/**
 * Resolve the New Session button className based on sidebar visibility.
 * When sidebar is visible, the button is invisible (preserves space for layout stability).
 */
export function resolveLeadingActionClassName(
  baseClassName: string,
  isSidebarVisible: boolean
): string {
  return cn(baseClassName, isSidebarVisible && 'invisible')
}
