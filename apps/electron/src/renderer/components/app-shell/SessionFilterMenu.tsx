/**
 * SessionFilterMenu — the session list's filter dropdown (statuses, labels, projects, grouping, search),
 * extracted from AppShell. Hierarchical submenus by default; typing switches to a flat filtered list
 * with arrow/Enter navigation (same scoring as the # inline menu). Alt/⌥-click excludes.
 *
 * The filter maps live in AppShell (per-view, persisted); this component owns only the dropdown's
 * transient state (query, highlighted row, Alt held).
 */

import * as React from "react"
import { useMemo } from "react"
import { useTranslation } from "react-i18next"
import {
  Calendar,
  Check,
  Flag,
  FolderKanban,
  Inbox,
  Layers,
  GripVertical,
  ListFilter,
  MailOpen,
  Search,
  Tag,
  Trash2,
  X,
} from "lucide-react"
import { Tooltip, TooltipTrigger, TooltipContent } from "@craft-agent/ui"
import { cn } from "@/lib/utils"
import { isMac } from "@/lib/platform"
import { HeaderIconButton } from "@/components/ui/HeaderIconButton"
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuSub,
  StyledDropdownMenuContent,
  StyledDropdownMenuItem,
  StyledDropdownMenuSeparator,
  StyledDropdownMenuSubTrigger,
  StyledDropdownMenuSubContent,
} from "@/components/ui/styled-dropdown"
import { LabelIcon } from "@/components/ui/label-icon"
import { filterSessionStatuses as filterLabelMenuStates } from "@/components/ui/label-menu"
import { createLabelMenuItems, filterItems as filterLabelMenuItems, type LabelMenuItem } from "@/components/ui/label-menu-utils"
import { findLabelById } from "@craft-agent/shared/labels"
import type { LabelConfig } from "@craft-agent/shared/labels"
import type { SessionStatus, SessionStatusId } from "@/config/session-status-config"
import type { FilterMode } from "./inherited-filter-params"
import type { ChatGroupingMode } from "./SessionList"

type FilterMapSetter<K extends string> = (
  updater: Map<K, FilterMode> | ((prev: Map<K, FilterMode>) => Map<K, FilterMode>),
) => void

interface PinnedFilters {
  pinnedStatusId: string | null
  pinnedLabelId: string | null
  pinnedFlagged: boolean
}

interface ProjectMenuOption {
  id: string
  slug: string
  name: string
  color?: string
}

export interface SessionFilterMenuProps {
  listFilter: Map<SessionStatusId, FilterMode>
  setListFilter: FilterMapSetter<SessionStatusId>
  labelFilter: Map<string, FilterMode>
  setLabelFilter: FilterMapSetter<string>
  projectFilter: Map<string, FilterMode>
  setProjectFilter: FilterMapSetter<string>
  /** Filters implied by the route (status/label/flagged views) — shown checked, not removable */
  pinnedFilters: PinnedFilters
  effectiveSessionStatuses: SessionStatus[]
  labelConfigs: LabelConfig[]
  displayLabelConfigs: LabelConfig[]
  projectMenuOptions: ProjectMenuOption[]
  /** State sub-views always group by date, so the Group submenu is hidden there */
  isStateSubView: boolean
  chatGroupingMode: ChatGroupingMode
  setChatGroupingMode: (mode: ChatGroupingMode) => void
  onOpenSearch: () => void
}

const altClickTooltipLabel = isMac ? '⌥ click to exclude' : 'Alt click to exclude'

/** Wraps children in a Tooltip that shows instantly on hover — only rendered when `show` is true. */
function AltExcludeTooltip({ show, children }: { show: boolean; children: React.ReactNode }) {
  if (!show) return children
  return (
    <Tooltip delayDuration={0}>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="right">{altClickTooltipLabel}</TooltipContent>
    </Tooltip>
  )
}

/**
 * FilterModeBadge - Display-only badge showing the current filter mode.
 * Shows a checkmark for 'include' and an X for 'exclude'. Used as a visual
 * indicator inside DropdownMenuSubTrigger rows (the actual mode switching
 * happens via the sub-menu content, not this badge).
 */
function FilterModeBadge({ mode }: { mode: FilterMode }) {
  return (
    <span
      className={cn(
        "flex items-center justify-center size-5 rounded-xs -mr-1",
        mode === 'include'
          ? "bg-raised text-foreground shadow-elev-1"
          : "bg-destructive-tint text-destructive",
      )}
    >
      {mode === 'include' ? <Check className="!h-2.5 !w-2.5" /> : <X className="!h-2.5 !w-2.5" />}
    </span>
  )
}

/**
 * FilterModeSubMenuItems - Shared sub-menu content for switching filter mode.
 * Renders Include / Exclude / Remove options using StyledDropdownMenuItem for
 * consistent styling. Used inside StyledDropdownMenuSubContent by both leaf
 * and group label items when they have an active filter mode.
 */
function FilterModeSubMenuItems({
  mode,
  onChangeMode,
  onRemove,
}: {
  mode: FilterMode
  onChangeMode: (mode: FilterMode) => void
  onRemove: () => void
}) {
  const { t } = useTranslation()
  return (
    <>
      <StyledDropdownMenuItem
        onClick={(e) => { e.preventDefault(); onChangeMode('include') }}
        className={cn(mode === 'include' && "bg-fill-hover")}
      >
        <Check className="h-3.5 w-3.5 shrink-0" />
        <span className="flex-1">{t("filter.include")}</span>
      </StyledDropdownMenuItem>
      <StyledDropdownMenuItem
        onClick={(e) => { e.preventDefault(); onChangeMode('exclude') }}
        className={cn(mode === 'exclude' && "bg-fill-hover")}
      >
        <X className="h-3.5 w-3.5 shrink-0" />
        <span className="flex-1">{t("filter.exclude")}</span>
      </StyledDropdownMenuItem>
      <StyledDropdownMenuSeparator />
      <StyledDropdownMenuItem
        onClick={(e) => { e.preventDefault(); onRemove() }}
      >
        <Trash2 className="h-3.5 w-3.5 shrink-0" />
        <span className="flex-1">{t("common.clear")}</span>
      </StyledDropdownMenuItem>
    </>
  )
}

/**
 * FilterMenuRow - Consistent layout for filter menu items.
 * Enforces: [icon 14px box] [label flex] [accessory 12px box]
 */
function FilterMenuRow({
  icon,
  label,
  accessory,
  iconClassName,
  iconStyle,
  noIconContainer,
}: {
  icon: React.ReactNode
  label: React.ReactNode
  accessory?: React.ReactNode
  /** Additional classes for icon container (e.g., for status icon scaling) */
  iconClassName?: string
  /** Style for icon container (e.g., for status icon color) */
  iconStyle?: React.CSSProperties
  /** When true, skip the icon container (for icons that have their own container) */
  noIconContainer?: boolean
}) {
  return (
    <>
      {noIconContainer ? (
        // Wrapper for color inheritance. Clone icon to add bare prop (removes EntityIcon container).
        <span style={iconStyle}>
          {React.isValidElement(icon) ? React.cloneElement(icon as React.ReactElement<{ bare?: boolean }>, { bare: true }) : icon}
        </span>
      ) : (
        <span
          className={cn("h-3.5 w-3.5 flex items-center justify-center shrink-0", iconClassName)}
          style={iconStyle}
        >
          {icon}
        </span>
      )}
      <span className="flex-1">{label}</span>
      <span className="shrink-0">{accessory}</span>
    </>
  )
}

/**
 * FilterLabelItems - Recursive component for rendering label tree in the filter dropdown.
 *
 * Rendering rules by label state:
 * - **Inactive leaf**: StyledDropdownMenuItem — click to add as 'include'
 * - **Active leaf**: DropdownMenuSub — SubTrigger shows label + mode badge, SubContent
 *   has Include/Exclude/Remove options (uses Radix's built-in safe-triangle hover)
 * - **Group (with children)**: Always a DropdownMenuSub. When active, SubContent shows
 *   mode options first, then separator, then children. When inactive, shows a self-toggle
 *   item, then separator, then children.
 * - **Pinned labels**: Shown with a check mark, non-interactive (no toggle/sub-menu).
 */
function FilterLabelItems({
  labels,
  labelFilter,
  setLabelFilter,
  pinnedLabelId,
  altHeld,
}: {
  labels: LabelConfig[]
  labelFilter: Map<string, FilterMode>
  setLabelFilter: (updater: Map<string, FilterMode> | ((prev: Map<string, FilterMode>) => Map<string, FilterMode>)) => void
  /** Label ID pinned by the current route (non-removable, shown as checked+disabled) */
  pinnedLabelId?: string | null
  altHeld?: boolean
}) {
  /** Toggle a label filter: if active → remove, if inactive → add as 'include' (or 'exclude' with Alt) */
  const toggleLabel = (id: string, altKey = false) => {
    setLabelFilter(prev => {
      const next = new Map(prev)
      if (next.has(id)) next.delete(id)
      else next.set(id, altKey ? 'exclude' : 'include')
      return next
    })
  }

  /** Build callbacks for changing/removing a label's filter mode */
  const makeModeCallbacks = (id: string) => ({
    onChangeMode: (newMode: FilterMode) => setLabelFilter(prev => {
      const next = new Map(prev)
      next.set(id, newMode)
      return next
    }),
    onRemove: () => setLabelFilter(prev => {
      const next = new Map(prev)
      next.delete(id)
      return next
    }),
  })

  return (
    <>
      {labels.map(label => {
        const hasChildren = label.children && label.children.length > 0
        const isPinned = label.id === pinnedLabelId
        const mode = labelFilter.get(label.id)
        const isActive = !!mode && !isPinned

        // --- Group labels (have children) → always DropdownMenuSub ---
        if (hasChildren) {
          // Check if any child has an active filter (to show indicator on parent)
          const hasActiveChild = label.children!.some(child => {
            const childMode = labelFilter.get(child.id)
            return !!childMode && child.id !== pinnedLabelId
          })
          const showIndicator = isActive || hasActiveChild || isPinned

          return (
            <DropdownMenuSub key={label.id}>
              <StyledDropdownMenuSubTrigger>
                <FilterMenuRow
                  icon={<LabelIcon label={label} size="lg" hasChildren />}
                  label={label.name}
                  accessory={
                    showIndicator ? <Check className="h-3 w-3 text-tertiary" /> : undefined
                  }
                />
              </StyledDropdownMenuSubTrigger>
              <StyledDropdownMenuSubContent minWidth="min-w-[160px]">
                {isActive ? (
                  // Active group: group title as nested sub-trigger for mode options, then children
                  <>
                    <DropdownMenuSub>
                      {/* Click the group title to clear, hover to open mode submenu */}
                      <StyledDropdownMenuSubTrigger onClick={(e) => { e.preventDefault(); toggleLabel(label.id, e.altKey) }}>
                        <FilterMenuRow
                          icon={<LabelIcon label={label} size="lg" hasChildren />}
                          label={label.name}
                          accessory={<FilterModeBadge mode={mode} />}
                        />
                      </StyledDropdownMenuSubTrigger>
                      <StyledDropdownMenuSubContent minWidth="min-w-[140px]">
                        <FilterModeSubMenuItems mode={mode} {...makeModeCallbacks(label.id)} />
                      </StyledDropdownMenuSubContent>
                    </DropdownMenuSub>
                    <StyledDropdownMenuSeparator />
                    <FilterLabelItems
                      labels={label.children!}
                      labelFilter={labelFilter}
                      setLabelFilter={setLabelFilter}
                      pinnedLabelId={pinnedLabelId}
                      altHeld={altHeld}
                    />
                  </>
                ) : (
                  // Inactive group: self-toggle item, then children
                  <>
                    <AltExcludeTooltip show={!!altHeld && !isPinned}>
                      <StyledDropdownMenuItem
                        disabled={isPinned}
                        onClick={(e) => {
                          if (isPinned) return
                          e.preventDefault()
                          toggleLabel(label.id, e.altKey)
                        }}
                      >
                        <FilterMenuRow
                          icon={<LabelIcon label={label} size="lg" hasChildren />}
                          label={label.name}
                          accessory={isPinned ? <Check className="h-3 w-3 text-tertiary" /> : undefined}
                        />
                      </StyledDropdownMenuItem>
                    </AltExcludeTooltip>
                    <StyledDropdownMenuSeparator />
                    <FilterLabelItems
                      labels={label.children!}
                      labelFilter={labelFilter}
                      setLabelFilter={setLabelFilter}
                      pinnedLabelId={pinnedLabelId}
                      altHeld={altHeld}
                    />
                  </>
                )}
              </StyledDropdownMenuSubContent>
            </DropdownMenuSub>
          )
        }

        // --- Active leaf label → DropdownMenuSub with mode options ---
        if (isActive) {
          return (
            <DropdownMenuSub key={label.id}>
              {/* Click the item itself to clear, hover to open mode submenu */}
              <StyledDropdownMenuSubTrigger onClick={(e) => { e.preventDefault(); toggleLabel(label.id, e.altKey) }}>
                <FilterMenuRow
                  icon={<LabelIcon label={label} size="lg" />}
                  label={label.name}
                  accessory={<FilterModeBadge mode={mode} />}
                />
              </StyledDropdownMenuSubTrigger>
              <StyledDropdownMenuSubContent minWidth="min-w-[140px]">
                <FilterModeSubMenuItems mode={mode} {...makeModeCallbacks(label.id)} />
              </StyledDropdownMenuSubContent>
            </DropdownMenuSub>
          )
        }

        // --- Inactive / pinned leaf label → simple toggleable item ---
        return (
          <AltExcludeTooltip key={label.id} show={!!altHeld && !isPinned}>
            <StyledDropdownMenuItem
              disabled={isPinned}
              onClick={(e) => {
                if (isPinned) return
                e.preventDefault()
                toggleLabel(label.id, e.altKey)
              }}
            >
              <FilterMenuRow
                icon={<LabelIcon label={label} size="lg" />}
                label={label.name}
                accessory={isPinned ? <Check className="h-3 w-3 text-tertiary" /> : undefined}
              />
            </StyledDropdownMenuItem>
          </AltExcludeTooltip>
        )
      })}
    </>
  )
}

export function SessionFilterMenu({
  listFilter,
  setListFilter,
  labelFilter,
  setLabelFilter,
  projectFilter,
  setProjectFilter,
  pinnedFilters,
  effectiveSessionStatuses,
  labelConfigs,
  displayLabelConfigs,
  projectMenuOptions,
  isStateSubView,
  chatGroupingMode,
  setChatGroupingMode,
  onOpenSearch,
}: SessionFilterMenuProps) {
  const { t } = useTranslation()

  // Inline search: when empty, the dropdown shows hierarchical submenus; typing shows a flat filtered list.
  const [filterDropdownQuery, setFilterDropdownQuery] = React.useState('')
  const [filterAltHeld, setFilterAltHeld] = React.useState(false)

  // Flat LabelMenuItem[] from the hierarchical labels for search mode — the same structure as the
  // # inline menu so the two search surfaces stay aligned.
  const flatLabelMenuItems = useMemo(
    (): LabelMenuItem[] => createLabelMenuItems(displayLabelConfigs),
    [displayLabelConfigs],
  )

  // Keyboard navigation in flat search mode.
  // Unified index: [0..matchedStates-1] = statuses, [matchedStates..total-1] = labels.
  const [filterDropdownSelectedIdx, setFilterDropdownSelectedIdx] = React.useState(0)
  const filterDropdownListRef = React.useRef<HTMLDivElement>(null)
  const filterDropdownInputRef = React.useRef<HTMLInputElement>(null)

  const filterDropdownResults = useMemo(() => {
    if (!filterDropdownQuery.trim()) return { states: [] as SessionStatus[], labels: [] as LabelMenuItem[] }
    return {
      states: filterLabelMenuStates(effectiveSessionStatuses, filterDropdownQuery),
      labels: filterLabelMenuItems(flatLabelMenuItems, filterDropdownQuery),
    }
  }, [filterDropdownQuery, effectiveSessionStatuses, flatLabelMenuItems])

  // Reset selected index when query changes
  React.useEffect(() => {
    setFilterDropdownSelectedIdx(0)
  }, [filterDropdownQuery])

  // Scroll keyboard-highlighted item into view
  React.useEffect(() => {
    if (!filterDropdownListRef.current) return
    const el = filterDropdownListRef.current.querySelector('[data-filter-selected="true"]')
    if (el) el.scrollIntoView({ block: 'nearest' })
  }, [filterDropdownSelectedIdx])

  return (
      <DropdownMenu onOpenChange={(open) => { if (!open) { setFilterDropdownQuery(''); setFilterAltHeld(false) } }}>
        <DropdownMenuTrigger asChild>
          <HeaderIconButton
            icon={<ListFilter className="size-4" />}
            aria-label={t("sidebar.filterChats")}
            // An active filter tints the button so the list's scope stays visible
            className={(listFilter.size > 0 || labelFilter.size > 0 || projectFilter.size > 0) ? "bg-accent-tint text-accent hover:bg-accent-tint hover:text-accent" : undefined}
          />
        </DropdownMenuTrigger>
        <StyledDropdownMenuContent
          align="end"
          light
          minWidth="min-w-[200px]"
          onKeyDown={(e: React.KeyboardEvent) => {
            if (e.key === 'Alt') setFilterAltHeld(true)
            // When on the first menu item and pressing Up, refocus the search input
            if (e.key === 'ArrowUp' && !filterDropdownQuery.trim()) {
              const menu = (e.target as HTMLElement).closest('[role="menu"]')
              const items = menu?.querySelectorAll('[role="menuitem"]')
              if (items && items.length > 0 && document.activeElement === items[0]) {
                e.preventDefault()
                e.stopPropagation()
                filterDropdownInputRef.current?.focus()
              }
            }
          }}
          onKeyUp={(e: React.KeyboardEvent) => {
            if (e.key === 'Alt') setFilterAltHeld(false)
          }}
        >
          {/* Header with title and clear button (only clears user-added filters, never pinned) */}
          <div className="flex items-center justify-between px-2 py-1.5">
            <span className="text-label-sm font-medium text-tertiary">{t("sidebar.filterChats")}</span>
            {(listFilter.size > 0 || labelFilter.size > 0 || projectFilter.size > 0) && (
              <button
                onClick={(e) => {
                  e.preventDefault()
                  setListFilter(new Map())
                  setLabelFilter(new Map())
                  setProjectFilter(new Map())
                }}
                className="text-label-sm text-tertiary hover:text-foreground"
              >
                {t("common.clear")}
              </button>
            )}
          </div>

          {/* Search input — typing switches from hierarchical submenus to a flat filtered list.
              stopPropagation prevents Radix from intercepting keys. Arrow/Enter handled for navigation. */}
          <div className="px-1 pb-1.5 mb-1 border-b border-subtle">
            <div className="field-surface flex h-control items-center rounded-md px-2">
              <input
                ref={filterDropdownInputRef}
                type="text"
                value={filterDropdownQuery}
                onChange={(e) => setFilterDropdownQuery(e.target.value)}
                onKeyDown={(e) => {
                  // When input is empty, let ArrowDown/ArrowUp blur the input
                  // so Radix's native menu keyboard navigation takes over
                  if (!filterDropdownQuery.trim() && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
                    e.preventDefault()
                    ;(e.target as HTMLInputElement).blur()
                    // Focus the first menu item so Radix's keyboard navigation activates
                    const menu = (e.target as HTMLElement).closest('[role="menu"]')
                    const firstItem = menu?.querySelector('[role="menuitem"]') as HTMLElement | null
                    firstItem?.focus()
                    return
                  }
                  e.stopPropagation()
                  const { states: ms, labels: ml } = filterDropdownResults
                  const total = ms.length + ml.length
                  if (total === 0) return
                  switch (e.key) {
                    case 'ArrowDown':
                      e.preventDefault()
                      setFilterDropdownSelectedIdx(prev => (prev < total - 1 ? prev + 1 : 0))
                      break
                    case 'ArrowUp':
                      e.preventDefault()
                      setFilterDropdownSelectedIdx(prev => (prev > 0 ? prev - 1 : total - 1))
                      break
                    case 'Enter': {
                      e.preventDefault()
                      const mode: FilterMode = e.altKey ? 'exclude' : 'include'
                      const idx = filterDropdownSelectedIdx
                      if (idx < ms.length) {
                        // Toggle a status filter
                        const state = ms[idx]
                        if (state.id !== pinnedFilters.pinnedStatusId) {
                          setListFilter(prev => {
                            const next = new Map(prev)
                            if (next.has(state.id)) next.delete(state.id)
                            else next.set(state.id, mode)
                            return next
                          })
                        }
                      } else {
                        // Toggle a label filter
                        const item = ml[idx - ms.length]
                        if (item && item.id !== pinnedFilters.pinnedLabelId) {
                          setLabelFilter(prev => {
                            const next = new Map(prev)
                            if (next.has(item.id)) next.delete(item.id)
                            else next.set(item.id, mode)
                            return next
                          })
                        }
                      }
                      break
                    }
                  }
                }}
                placeholder={t("sidebar.searchStatusesLabels")}
                className="w-full bg-transparent text-label text-foreground placeholder:text-tertiary outline-none"
                autoFocus
              />
            </div>
          </div>

          {/* ── Conditional body: hierarchical (no query) vs flat filtered list (has query) ── */}
          {filterDropdownQuery.trim() === '' ? (
            <>
              {/* === HIERARCHICAL MODE (default) === */}

              {/* Active filter chips: pinned (non-removable) + user-added (removable) */}
              {(pinnedFilters.pinnedFlagged || pinnedFilters.pinnedStatusId || pinnedFilters.pinnedLabelId || listFilter.size > 0 || labelFilter.size > 0 || projectFilter.size > 0) && (
                <>
                  {/* Pinned: flagged */}
                  {pinnedFilters.pinnedFlagged && (
                    <StyledDropdownMenuItem disabled>
                      <FilterMenuRow
                        icon={<Flag className="h-3.5 w-3.5" />}
                        label={t("sidebar.flagged")}
                        accessory={<Check className="h-3 w-3 text-tertiary" />}
                      />
                    </StyledDropdownMenuItem>
                  )}
                  {/* Pinned: status from state view */}
                  {(() => {
                    if (!pinnedFilters.pinnedStatusId) return null
                    const state = effectiveSessionStatuses.find(s => s.id === pinnedFilters.pinnedStatusId)
                    if (!state) return null
                    return (
                      <StyledDropdownMenuItem disabled key={`pinned-status-${state.id}`}>
                        <FilterMenuRow
                          icon={state.icon}
                          label={state.label}
                          accessory={<Check className="h-3 w-3 text-tertiary" />}
                          iconStyle={state.iconColorable ? { color: state.resolvedColor } : undefined}
                          noIconContainer
                        />
                      </StyledDropdownMenuItem>
                    )
                  })()}
                  {/* Pinned: label from label view */}
                  {(() => {
                    if (!pinnedFilters.pinnedLabelId) return null
                    const label = findLabelById(labelConfigs, pinnedFilters.pinnedLabelId)
                    if (!label) return null
                    return (
                      <StyledDropdownMenuItem disabled key={`pinned-label-${label.id}`}>
                        <FilterMenuRow
                          icon={<LabelIcon label={label} size="lg" />}
                          label={label.name}
                          accessory={<Check className="h-3 w-3 text-tertiary" />}
                        />
                      </StyledDropdownMenuItem>
                    )
                  })()}
                  {/* User-added: selected statuses with mode pill (include/exclude) */}
                  {effectiveSessionStatuses.filter(s => listFilter.has(s.id)).map(state => {
                    const applyColor = state.iconColorable
                    const mode = listFilter.get(state.id)!
                    return (
                      <DropdownMenuSub key={`sel-status-${state.id}`}>
                        <StyledDropdownMenuSubTrigger onClick={(e) => { e.preventDefault(); setListFilter(prev => { const next = new Map(prev); next.delete(state.id); return next }) }}>
                          <FilterMenuRow
                            icon={state.icon}
                            label={state.label}
                            accessory={<FilterModeBadge mode={mode} />}
                            iconStyle={applyColor ? { color: state.resolvedColor } : undefined}
                            noIconContainer
                          />
                        </StyledDropdownMenuSubTrigger>
                        <StyledDropdownMenuSubContent minWidth="min-w-[140px]">
                          <FilterModeSubMenuItems
                            mode={mode}
                            onChangeMode={(newMode) => setListFilter(prev => {
                              const next = new Map(prev)
                              next.set(state.id, newMode)
                              return next
                            })}
                            onRemove={() => setListFilter(prev => {
                              const next = new Map(prev)
                              next.delete(state.id)
                              return next
                            })}
                          />
                        </StyledDropdownMenuSubContent>
                      </DropdownMenuSub>
                    )
                  })}
                  {/* User-added: selected labels with mode pill (include/exclude) */}
                  {Array.from(labelFilter).map(([labelId, mode]) => {
                    const label = findLabelById(labelConfigs, labelId)
                    if (!label) return null
                    return (
                      <DropdownMenuSub key={`sel-label-${labelId}`}>
                        <StyledDropdownMenuSubTrigger onClick={(e) => { e.preventDefault(); setLabelFilter(prev => { const next = new Map(prev); next.delete(labelId); return next }) }}>
                          <FilterMenuRow
                            icon={<LabelIcon label={label} size="lg" />}
                            label={label.name}
                            accessory={<FilterModeBadge mode={mode} />}
                          />
                        </StyledDropdownMenuSubTrigger>
                        <StyledDropdownMenuSubContent minWidth="min-w-[140px]">
                          <FilterModeSubMenuItems
                            mode={mode}
                            onChangeMode={(newMode) => setLabelFilter(prev => {
                              const next = new Map(prev)
                              next.set(labelId, newMode)
                              return next
                            })}
                            onRemove={() => setLabelFilter(prev => {
                              const next = new Map(prev)
                              next.delete(labelId)
                              return next
                            })}
                          />
                        </StyledDropdownMenuSubContent>
                      </DropdownMenuSub>
                    )
                  })}
                  {/* User-added: selected projects with mode pill (include/exclude) */}
                  {Array.from(projectFilter).map(([projectId, mode]) => {
                    const project = projectMenuOptions.find(p => p.id === projectId)
                    if (!project) return null
                    return (
                      <DropdownMenuSub key={`sel-project-${projectId}`}>
                        <StyledDropdownMenuSubTrigger onClick={(e) => { e.preventDefault(); setProjectFilter(prev => { const next = new Map(prev); next.delete(projectId); return next }) }}>
                          <FilterMenuRow
                            icon={<FolderKanban className="h-3.5 w-3.5" />}
                            label={project.name}
                            accessory={<FilterModeBadge mode={mode} />}
                          />
                        </StyledDropdownMenuSubTrigger>
                        <StyledDropdownMenuSubContent minWidth="min-w-[140px]">
                          <FilterModeSubMenuItems
                            mode={mode}
                            onChangeMode={(newMode) => setProjectFilter(prev => {
                              const next = new Map(prev)
                              next.set(projectId, newMode)
                              return next
                            })}
                            onRemove={() => setProjectFilter(prev => {
                              const next = new Map(prev)
                              next.delete(projectId)
                              return next
                            })}
                          />
                        </StyledDropdownMenuSubContent>
                      </DropdownMenuSub>
                    )
                  })}
                  <StyledDropdownMenuSeparator />
                </>
              )}

              {/* Statuses submenu - hierarchical with toggle selection */}
              <DropdownMenuSub>
                <StyledDropdownMenuSubTrigger>
                  <Inbox className="h-3.5 w-3.5" />
                  <span className="flex-1">{t("sidebar.statuses")}</span>
                </StyledDropdownMenuSubTrigger>
                <StyledDropdownMenuSubContent minWidth="min-w-[180px]">
                  {effectiveSessionStatuses.map(state => {
                    const applyColor = state.iconColorable
                    const isPinned = state.id === pinnedFilters.pinnedStatusId
                    const currentMode = listFilter.get(state.id)
                    const isActive = !!currentMode && !isPinned
                    // Active status → DropdownMenuSub with mode options (Radix safe-triangle hover)
                    if (isActive) {
                      return (
                        <DropdownMenuSub key={state.id}>
                          <StyledDropdownMenuSubTrigger onClick={(e) => { e.preventDefault(); setListFilter(prev => { const next = new Map(prev); next.delete(state.id); return next }) }}>
                            <FilterMenuRow
                              icon={state.icon}
                              label={state.label}
                              accessory={<FilterModeBadge mode={currentMode} />}
                              iconStyle={applyColor ? { color: state.resolvedColor } : undefined}
                              noIconContainer
                            />
                          </StyledDropdownMenuSubTrigger>
                          <StyledDropdownMenuSubContent minWidth="min-w-[140px]">
                            <FilterModeSubMenuItems
                              mode={currentMode}
                              onChangeMode={(newMode) => setListFilter(prev => {
                                const next = new Map(prev)
                                next.set(state.id, newMode)
                                return next
                              })}
                              onRemove={() => setListFilter(prev => {
                                const next = new Map(prev)
                                next.delete(state.id)
                                return next
                              })}
                            />
                          </StyledDropdownMenuSubContent>
                        </DropdownMenuSub>
                      )
                    }
                    // Inactive / pinned status → simple toggleable item
                    return (
                      <AltExcludeTooltip key={state.id} show={filterAltHeld && !isPinned}>
                        <StyledDropdownMenuItem
                          disabled={isPinned}
                          onClick={(e) => {
                            if (isPinned) return
                            e.preventDefault()
                            setListFilter(prev => {
                              const next = new Map(prev)
                              if (next.has(state.id)) next.delete(state.id)
                              else next.set(state.id, e.altKey ? 'exclude' : 'include')
                              return next
                            })
                          }}
                        >
                          <FilterMenuRow
                            icon={state.icon}
                            label={state.label}
                            accessory={isPinned ? <Check className="h-3 w-3 text-tertiary" /> : null}
                            iconStyle={applyColor ? { color: state.resolvedColor } : undefined}
                            noIconContainer
                          />
                        </StyledDropdownMenuItem>
                      </AltExcludeTooltip>
                    )
                  })}
                </StyledDropdownMenuSubContent>
              </DropdownMenuSub>

              {/* Labels submenu - hierarchical tree with recursive submenus */}
              <DropdownMenuSub>
                <StyledDropdownMenuSubTrigger>
                  <Tag className="h-3.5 w-3.5" />
                  <span className="flex-1">{t("sidebar.labels")}</span>
                </StyledDropdownMenuSubTrigger>
                <StyledDropdownMenuSubContent minWidth="min-w-[180px]">
                  {labelConfigs.length === 0 ? (
                    <StyledDropdownMenuItem disabled>
                      <span className="text-tertiary">{t("table.noLabelsConfigured")}</span>
                    </StyledDropdownMenuItem>
                  ) : (
                    <FilterLabelItems
                      labels={displayLabelConfigs}
                      labelFilter={labelFilter}
                      setLabelFilter={setLabelFilter}
                      pinnedLabelId={pinnedFilters.pinnedLabelId}
                      altHeld={filterAltHeld}
                    />
                  )}
                </StyledDropdownMenuSubContent>
              </DropdownMenuSub>

              {/* Projects submenu - flat list of workspace projects */}
              {projectMenuOptions.length > 0 && (
                <DropdownMenuSub>
                  <StyledDropdownMenuSubTrigger>
                    <FolderKanban className="h-3.5 w-3.5" />
                    <span className="flex-1">{t("sidebar.projects")}</span>
                  </StyledDropdownMenuSubTrigger>
                  <StyledDropdownMenuSubContent minWidth="min-w-[180px]">
                    {projectMenuOptions.map(project => {
                      const currentMode = projectFilter.get(project.id)
                      const isActive = !!currentMode
                      if (isActive) {
                        return (
                          <DropdownMenuSub key={project.id}>
                            <StyledDropdownMenuSubTrigger onClick={(e) => { e.preventDefault(); setProjectFilter(prev => { const next = new Map(prev); next.delete(project.id); return next }) }}>
                              <FilterMenuRow
                                icon={<FolderKanban className="h-3.5 w-3.5" />}
                                label={project.name}
                                accessory={<FilterModeBadge mode={currentMode} />}
                              />
                            </StyledDropdownMenuSubTrigger>
                            <StyledDropdownMenuSubContent minWidth="min-w-[140px]">
                              <FilterModeSubMenuItems
                                mode={currentMode}
                                onChangeMode={(newMode) => setProjectFilter(prev => {
                                  const next = new Map(prev)
                                  next.set(project.id, newMode)
                                  return next
                                })}
                                onRemove={() => setProjectFilter(prev => {
                                  const next = new Map(prev)
                                  next.delete(project.id)
                                  return next
                                })}
                              />
                            </StyledDropdownMenuSubContent>
                          </DropdownMenuSub>
                        )
                      }
                      return (
                        <AltExcludeTooltip key={project.id} show={filterAltHeld}>
                          <StyledDropdownMenuItem
                            onClick={(e) => {
                              e.preventDefault()
                              setProjectFilter(prev => {
                                const next = new Map(prev)
                                if (next.has(project.id)) next.delete(project.id)
                                else next.set(project.id, e.altKey ? 'exclude' : 'include')
                                return next
                              })
                            }}
                          >
                            <FilterMenuRow
                              icon={<FolderKanban className="h-3.5 w-3.5" />}
                              label={project.name}
                            />
                          </StyledDropdownMenuItem>
                        </AltExcludeTooltip>
                      )
                    })}
                  </StyledDropdownMenuSubContent>
                </DropdownMenuSub>
              )}

              <StyledDropdownMenuSeparator />
              <DropdownMenuSub>
                <StyledDropdownMenuSubTrigger>
                  <Layers className="h-3.5 w-3.5" />
                  <span className="flex-1">{t("sidebar.group")}</span>
                </StyledDropdownMenuSubTrigger>
                <StyledDropdownMenuSubContent minWidth="min-w-[140px]">
                  <StyledDropdownMenuItem onClick={() => setChatGroupingMode('date')}>
                    <Calendar className="h-3.5 w-3.5" />
                    <span className="flex-1">{t("sidebar.groupByDate")}</span>
                    {chatGroupingMode === 'date' && <Check className="h-3 w-3 text-tertiary" />}
                  </StyledDropdownMenuItem>
                  {!isStateSubView && (
                    <>
                      <StyledDropdownMenuItem onClick={() => setChatGroupingMode('status')}>
                        <Inbox className="h-3.5 w-3.5" />
                        <span className="flex-1">{t("sidebar.groupByStatus")}</span>
                        {chatGroupingMode === 'status' && <Check className="h-3 w-3 text-tertiary" />}
                      </StyledDropdownMenuItem>
                      <StyledDropdownMenuItem onClick={() => setChatGroupingMode('unread')}>
                        <MailOpen className="h-3.5 w-3.5" />
                        <span className="flex-1">{t("sidebar.groupByUnread")}</span>
                        {chatGroupingMode === 'unread' && <Check className="h-3 w-3 text-tertiary" />}
                      </StyledDropdownMenuItem>
                      {projectMenuOptions.length > 0 && (
                        <StyledDropdownMenuItem onClick={() => setChatGroupingMode('project')}>
                          <FolderKanban className="h-3.5 w-3.5" />
                          <span className="flex-1">{t("sidebar.groupByProject")}</span>
                          {chatGroupingMode === 'project' && <Check className="h-3 w-3 text-tertiary" />}
                        </StyledDropdownMenuItem>
                      )}
                    </>
                  )}
                  <StyledDropdownMenuItem onClick={() => setChatGroupingMode('manual')}>
                    <GripVertical className="h-3.5 w-3.5" />
                    <span className="flex-1">{t("sidebar.groupByManual")}</span>
                    {chatGroupingMode === 'manual' && <Check className="h-3 w-3 text-tertiary" />}
                  </StyledDropdownMenuItem>
                </StyledDropdownMenuSubContent>
              </DropdownMenuSub>

              <StyledDropdownMenuSeparator />
              <StyledDropdownMenuItem
                onClick={() => {
                  onOpenSearch()
                }}
              >
                <Search className="h-3.5 w-3.5" />
                <span className="flex-1">{t("sidebar.search")}</span>
              </StyledDropdownMenuItem>
            </>
          ) : (
            <>
              {/* === FLAT FILTERED MODE (has query) ===
                  Uses the same filter/score logic as the # inline menu.
                  Shows matching statuses and labels in a single flat list.
                  Supports keyboard navigation (ArrowUp/Down/Enter in input). */}
              {filterDropdownResults.states.length === 0 && filterDropdownResults.labels.length === 0 ? (
                <div className="px-3 py-4 text-center text-label-sm text-tertiary">
                  {t("sidebar.noMatchingFilters")}
                </div>
              ) : (
                <div ref={filterDropdownListRef} className="max-h-[240px] overflow-y-auto py-1">
                  {/* Matched statuses */}
                  {filterDropdownResults.states.length > 0 && (
                    <>
                      <div className="px-2 pt-1.5 pb-1 text-label-sm font-medium text-tertiary">
                        {t("sidebar.statuses")}
                      </div>
                      {filterDropdownResults.states.map((state, index) => {
                        const applyColor = state.iconColorable
                        const isPinned = state.id === pinnedFilters.pinnedStatusId
                        const currentMode = listFilter.get(state.id)
                        const isHighlighted = index === filterDropdownSelectedIdx
                        const isActive = !!currentMode && !isPinned
                        // Active status → DropdownMenuSub with mode options
                        if (isActive) {
                          return (
                            <DropdownMenuSub key={`flat-status-${state.id}`}>
                              <StyledDropdownMenuSubTrigger
                                data-filter-selected={isHighlighted}
                                onMouseEnter={() => setFilterDropdownSelectedIdx(index)}
                                className={cn("mx-1", isHighlighted && "bg-fill-hover")}
                                onClick={(e) => { e.preventDefault(); setListFilter(prev => { const next = new Map(prev); next.delete(state.id); return next }) }}
                              >
                                <FilterMenuRow
                                  icon={state.icon}
                                  label={state.label}
                                  accessory={<FilterModeBadge mode={currentMode} />}
                                  iconStyle={applyColor ? { color: state.resolvedColor } : undefined}
                                  noIconContainer
                                />
                              </StyledDropdownMenuSubTrigger>
                              <StyledDropdownMenuSubContent minWidth="min-w-[140px]">
                                <FilterModeSubMenuItems
                                  mode={currentMode}
                                  onChangeMode={(newMode) => setListFilter(prev => {
                                    const next = new Map(prev)
                                    next.set(state.id, newMode)
                                    return next
                                  })}
                                  onRemove={() => setListFilter(prev => {
                                    const next = new Map(prev)
                                    next.delete(state.id)
                                    return next
                                  })}
                                />
                              </StyledDropdownMenuSubContent>
                            </DropdownMenuSub>
                          )
                        }
                        // Inactive / pinned status → plain div with click-to-toggle
                        return (
                          <AltExcludeTooltip key={`flat-status-${state.id}`} show={filterAltHeld && !isPinned}>
                            <div
                              data-filter-selected={isHighlighted}
                              onMouseEnter={() => setFilterDropdownSelectedIdx(index)}
                              onClick={(e) => {
                                if (isPinned) return
                                e.preventDefault()
                                setListFilter(prev => {
                                  const next = new Map(prev)
                                  if (next.has(state.id)) next.delete(state.id)
                                  else next.set(state.id, e.altKey ? 'exclude' : 'include')
                                  return next
                                })
                              }}
                              className={cn(
                                // SVG sizing matches StyledDropdownMenuSubTrigger so icons render at the same size
                                "flex cursor-pointer select-none items-center gap-2 rounded-md mx-1 px-2 min-h-row-menu text-label [&_svg:not([class*='size-'])]:size-4 [&_svg]:shrink-0",
                                isHighlighted && "bg-fill-hover",
                                isPinned && "opacity-50 pointer-events-none",
                              )}
                            >
                              <FilterMenuRow
                                icon={state.icon}
                                label={state.label}
                                accessory={isPinned ? <Check className="h-3 w-3 text-tertiary" /> : null}
                                iconStyle={applyColor ? { color: state.resolvedColor } : undefined}
                                noIconContainer
                              />
                            </div>
                          </AltExcludeTooltip>
                        )
                      })}
                    </>
                  )}
                  {/* Separator between sections */}
                  {filterDropdownResults.states.length > 0 && filterDropdownResults.labels.length > 0 && (
                    <div className="my-1 mx-2 h-px bg-separator" />
                  )}
                  {/* Matched labels — flat list with parent breadcrumbs */}
                  {filterDropdownResults.labels.length > 0 && (
                    <>
                      <div className="px-2 pt-1.5 pb-1 text-label-sm font-medium text-tertiary">
                        {t("sidebar.labels")}
                      </div>
                      {filterDropdownResults.labels.map((item, index) => {
                        // Offset by state count for unified index
                        const flatIndex = filterDropdownResults.states.length + index
                        const isPinned = item.id === pinnedFilters.pinnedLabelId
                        const currentMode = labelFilter.get(item.id)
                        const isHighlighted = flatIndex === filterDropdownSelectedIdx
                        const isActive = !!currentMode && !isPinned
                        const labelDisplay = item.parentPath
                          ? <><span className="text-tertiary">{item.parentPath}</span>{item.label}</>
                          : item.label
                        // Active label → DropdownMenuSub with mode options
                        if (isActive) {
                          return (
                            <DropdownMenuSub key={`flat-label-${item.id}`}>
                              <StyledDropdownMenuSubTrigger
                                data-filter-selected={isHighlighted}
                                onMouseEnter={() => setFilterDropdownSelectedIdx(flatIndex)}
                                className={cn("mx-1", isHighlighted && "bg-fill-hover")}
                                onClick={(e) => { e.preventDefault(); setLabelFilter(prev => { const next = new Map(prev); next.delete(item.id); return next }) }}
                              >
                                <FilterMenuRow
                                  icon={<LabelIcon label={item.config} size="lg" />}
                                  label={labelDisplay}
                                  accessory={<FilterModeBadge mode={currentMode} />}
                                />
                              </StyledDropdownMenuSubTrigger>
                              <StyledDropdownMenuSubContent minWidth="min-w-[140px]">
                                <FilterModeSubMenuItems
                                  mode={currentMode}
                                  onChangeMode={(newMode) => setLabelFilter(prev => {
                                    const next = new Map(prev)
                                    next.set(item.id, newMode)
                                    return next
                                  })}
                                  onRemove={() => setLabelFilter(prev => {
                                    const next = new Map(prev)
                                    next.delete(item.id)
                                    return next
                                  })}
                                />
                              </StyledDropdownMenuSubContent>
                            </DropdownMenuSub>
                          )
                        }
                        // Inactive / pinned label → plain div with click-to-toggle
                        return (
                          <AltExcludeTooltip key={`flat-label-${item.id}`} show={filterAltHeld && !isPinned}>
                            <div
                              data-filter-selected={isHighlighted}
                              onMouseEnter={() => setFilterDropdownSelectedIdx(flatIndex)}
                              onClick={(e) => {
                                if (isPinned) return
                                e.preventDefault()
                                setLabelFilter(prev => {
                                  const next = new Map(prev)
                                  if (next.has(item.id)) next.delete(item.id)
                                  else next.set(item.id, e.altKey ? 'exclude' : 'include')
                                  return next
                                })
                              }}
                              className={cn(
                                // SVG sizing matches StyledDropdownMenuSubTrigger so icons render at the same size
                                "flex cursor-pointer select-none items-center gap-2 rounded-md mx-1 px-2 min-h-row-menu text-label [&_svg:not([class*='size-'])]:size-4 [&_svg]:shrink-0",
                                isHighlighted && "bg-fill-hover",
                                isPinned && "opacity-50 pointer-events-none",
                              )}
                            >
                              <FilterMenuRow
                                icon={<LabelIcon label={item.config} size="lg" />}
                                label={labelDisplay}
                                accessory={isPinned ? <Check className="h-3 w-3 text-tertiary" /> : null}
                              />
                            </div>
                          </AltExcludeTooltip>
                        )
                      })}
                    </>
                  )}
                </div>
              )}
            </>
          )}
        </StyledDropdownMenuContent>
      </DropdownMenu>
  )
}
