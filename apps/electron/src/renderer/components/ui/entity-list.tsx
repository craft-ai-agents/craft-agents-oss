/**
 * EntityList — Reusable container for rendering a scrollable list of EntityRow items.
 *
 * Handles:
 * - ScrollArea wrapping with proper padding
 * - Optional grouped layout with section headers
 * - Collapsible groups with chevron toggle and item count
 * - Empty state rendering (centered, outside ScrollArea)
 * - Header (e.g. search bar) and footer (e.g. infinite scroll sentinel) slots
 *
 * Domain-specific logic (filtering, keyboard nav, multi-select) lives in the consumer.
 */

import * as React from 'react'
import { ChevronRight } from 'lucide-react'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'

// ============================================================================
// Types
// ============================================================================

export interface EntityListGroup<T> {
  /** Unique key for the group */
  key: string
  /** Label shown in the section header */
  label: string
  /** Items in this group */
  items: T[]
  /** Whether this group supports collapse/expand (default: false) */
  collapsible?: boolean
}

export interface EntityListProps<T> {
  /** Flat item list (used when not grouped) */
  items?: T[]
  /** Grouped items with section headers (takes precedence over items) */
  groups?: EntityListGroup<T>[]
  /** Render function for each item */
  renderItem: (item: T, index: number, isFirstInGroup: boolean) => React.ReactNode
  /** Unique key extractor */
  getKey: (item: T) => string
  /** Empty state content — rendered centered, outside ScrollArea */
  emptyState?: React.ReactNode
  /** Header content above the list (e.g. search bar) — rendered outside ScrollArea */
  header?: React.ReactNode
  /** Footer content after all items (e.g. infinite scroll sentinel) — inside ScrollArea */
  footer?: React.ReactNode
  /** Ref for the inner list container (for keyboard navigation zones) */
  containerRef?: React.Ref<HTMLDivElement>
  /** Props spread on the inner list container (role, aria-label, data-focus-zone) */
  containerProps?: Record<string, string>
  /** Additional ScrollArea class */
  scrollAreaClassName?: string
  className?: string
  /** Set of collapsed group keys (for collapsible groups) */
  collapsedGroups?: Set<string>
  /** Called when a collapsible group header is clicked */
  onToggleCollapse?: (groupKey: string) => void
}

// ============================================================================
// Section Header
// ============================================================================

function SectionHeader({ label }: { label: string }) {
  return (
    <div className="px-4 py-2">
      <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
        {label}
      </span>
    </div>
  )
}

/** Collapsible group header with chevron toggle and item count when collapsed */
function CollapsibleGroupHeader({
  label,
  isCollapsed,
  itemCount,
  onToggle,
}: {
  label: string
  isCollapsed: boolean
  itemCount: number
  onToggle: () => void
}) {
  return (
    <button
      onClick={onToggle}
      className="w-full py-2 px-4 flex items-center gap-1.5 hover:bg-foreground/5 transition-colors cursor-pointer"
    >
      <ChevronRight
        className={cn(
          "h-3 w-3 text-muted-foreground/60 transition-transform",
          !isCollapsed && "rotate-90"
        )}
      />
      <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        {label}{isCollapsed && <> · <span className="text-muted-foreground/50">{itemCount}</span></>}
      </span>
    </button>
  )
}

// ============================================================================
// Component
// ============================================================================

export function EntityList<T>({
  items,
  groups,
  renderItem,
  getKey,
  emptyState,
  header,
  footer,
  containerRef,
  containerProps,
  scrollAreaClassName,
  className,
  collapsedGroups,
  onToggleCollapse,
}: EntityListProps<T>) {
  // Determine if we have content
  const hasGroups = groups && groups.length > 0
  const hasItems = items && items.length > 0
  const isEmpty = !hasGroups && !hasItems

  // Empty state — rendered outside everything for proper centering
  if (isEmpty && emptyState) {
    return (
      <div className={cn('flex flex-col flex-1', className)}>
        {header}
        {emptyState}
      </div>
    )
  }

  return (
    <div className={cn('flex flex-col flex-1 min-h-0', className)}>
      {header}
      <ScrollArea className={cn('flex-1', scrollAreaClassName)}>
        <div
          ref={containerRef}
          className="flex flex-col pb-2"
          {...containerProps}
        >
          <div className="pt-2">
            {hasGroups
              ? groups!.map((group) => {
                  const isCollapsed = group.collapsible && collapsedGroups?.has(group.key)

                  return (
                    <div key={group.key}>
                      {group.collapsible && onToggleCollapse ? (
                        <CollapsibleGroupHeader
                          label={group.label}
                          isCollapsed={!!isCollapsed}
                          itemCount={group.items.length}
                          onToggle={() => onToggleCollapse(group.key)}
                        />
                      ) : (
                        <SectionHeader label={group.label} />
                      )}
                      {!isCollapsed && group.items.map((item, indexInGroup) =>
                        <React.Fragment key={getKey(item)}>
                          {renderItem(item, indexInGroup, indexInGroup === 0)}
                        </React.Fragment>
                      )}
                    </div>
                  )
                })
              : items?.map((item, index) =>
                  <React.Fragment key={getKey(item)}>
                    {renderItem(item, index, index === 0)}
                  </React.Fragment>
                )
            }
          </div>
          {footer}
        </div>
      </ScrollArea>
    </div>
  )
}
