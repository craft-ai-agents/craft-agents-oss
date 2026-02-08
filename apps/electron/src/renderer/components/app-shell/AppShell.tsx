import * as React from "react"
import { useRef, useState, useEffect, useCallback, useMemo } from "react"
import { useAtomValue } from "jotai"
import { motion, AnimatePresence } from "motion/react"
import {
  CheckCircle2,
  Settings,
  ChevronRight,
  ChevronDown,
  MoreHorizontal,
  RotateCw,
  Flag,
  ListFilter,
  Tag,
  Check,
  X,
  Search,
  Plus,
  Trash2,
  DatabaseZap,
  Zap,
  Inbox,
  Globe,
  FolderOpen,
  HelpCircle,
  ExternalLink,
  Store,
  PanelRight,
  PanelLeft,
} from "lucide-react"
// TodoStateIcons no longer used - icons come from dynamic todoStates
import { SourceAvatar } from "@/components/ui/source-avatar"
import { AppMenu, type ViewMode } from "../AppMenu"
import { SquarePenRounded } from "../icons/SquarePenRounded"
import { McpIcon } from "../icons/McpIcon"
import { cn } from "@/lib/utils"
import { isMac } from "@/lib/platform"
import { Button } from "@/components/ui/button"
import { HeaderIconButton } from "@/components/ui/HeaderIconButton"
import { Separator } from "@/components/ui/separator"
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from "@craft-agent/ui"
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
import {
  ContextMenu,
  ContextMenuTrigger,
  StyledContextMenuContent,
} from "@/components/ui/styled-context-menu"
import { ContextMenuProvider } from "@/components/ui/menu-context"
import { SidebarMenu } from "./SidebarMenu"
import { ScrollArea } from "@/components/ui/scroll-area"
import { FadingText } from "@/components/ui/fading-text"
import {
  Collapsible,
  CollapsibleTrigger,
  AnimatedCollapsibleContent,
  springTransition as collapsibleSpring,
} from "@/components/ui/collapsible"
import { WorkspaceSwitcher } from "./WorkspaceSwitcher"
import { SessionList } from "./SessionList"
import { MainContentPanel } from "./MainContentPanel"
import type { ChatDisplayHandle } from "./ChatDisplay"
import { LeftSidebar } from "./LeftSidebar"
import { useSession } from "@/hooks/useSession"
import { ensureSessionMessagesLoadedAtom } from "@/atoms/sessions"
import { AppShellProvider, type AppShellContextType } from "@/context/AppShellContext"
import { EscapeInterruptProvider, useEscapeInterrupt } from "@/context/EscapeInterruptContext"
import { useTheme } from "@/context/ThemeContext"
import { getResizeGradientStyle } from "@/hooks/useResizeGradient"
import { useFocusZone, useGlobalShortcuts } from "@/hooks/keyboard"
import { useFocusContext } from "@/context/FocusContext"
import { getSessionTitle } from "@/utils/session"
import { useSetAtom } from "jotai"
import type { Session, Workspace, FileAttachment, PermissionRequest, LoadedSource, LoadedSkill, PermissionMode, SourceFilter } from "../../../shared/types"
import { sessionMetaMapAtom, type SessionMeta } from "@/atoms/sessions"
import { sourcesAtom } from "@/atoms/sources"
import { skillsAtom } from "@/atoms/skills"
import { type TodoStateId, type TodoState, statusConfigsToTodoStates } from "@/config/todo-states"
import { useStatuses } from "@/hooks/useStatuses"
import { useLabels } from "@/hooks/useLabels"
import { useViews } from "@/hooks/useViews"
import { LabelIcon, LabelValueTypeIcon } from "@/components/ui/label-icon"
import { filterItems as filterLabelMenuItems, filterStates as filterLabelMenuStates, type LabelMenuItem } from "@/components/ui/label-menu"
import { buildLabelTree, getDescendantIds, getLabelDisplayName, flattenLabels, extractLabelId, findLabelById } from "@craft-agent/shared/labels"
import type { LabelConfig, LabelTreeNode } from "@craft-agent/shared/labels"
import { resolveEntityColor } from "@craft-agent/shared/colors"
import * as storage from "@/lib/local-storage"
import { toast } from "sonner"
import { navigate, routes } from "@/lib/navigate"
import {
  useNavigation,
  useNavigationState,
  isChatsNavigation,
  isSourcesNavigation,
  isSettingsNavigation,
  isSkillsNavigation,
  type NavigationState,
  type ChatFilter,
} from "@/contexts/NavigationContext"
import type { SettingsSubpage } from "../../../shared/types"
import { SourcesListPanel } from "./SourcesListPanel"
import { SkillsListPanel } from "./SkillsListPanel"
import { PanelHeader } from "./PanelHeader"
import { EditPopover, getEditConfig, type EditContextKey } from "@/components/ui/EditPopover"
import { getDocUrl } from "@craft-agent/shared/docs/doc-links"
import SettingsNavigator from "@/pages/settings/SettingsNavigator"
import { RightSidebar } from "./RightSidebar"
import type { RichTextInputHandle } from "@/components/ui/rich-text-input"
import { hasOpenOverlay } from "@/lib/overlay-detection"
import { clearSourceIconCaches } from "@/lib/icon-cache"

/**
 * AppShellProps - Minimal props interface for AppShell component
 *
 * Data and callbacks come via contextValue (AppShellContextType).
 * Only UI-specific state is passed as separate props.
 *
 * Adding new features:
 * 1. Add to AppShellContextType in context/AppShellContext.tsx
 * 2. Update App.tsx to include in contextValue
 * 3. Use via useAppShellContext() hook in child components
 */
interface AppShellProps {
  /** All data and callbacks - passed directly to AppShellProvider */
  contextValue: AppShellContextType
  /** UI-specific props */
  defaultLayout?: number[]
  defaultCollapsed?: boolean
  menuNewChatTrigger?: number
  /** Focused mode - hides sidebars, shows only the chat content */
  isFocusedMode?: boolean
}

/** Filter mode for tri-state filtering: include shows only matching, exclude hides matching */
type FilterMode = 'include' | 'exclude'

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
        "flex items-center justify-center h-5 w-5 rounded-[4px] -mr-1",
        mode === 'include'
          ? "bg-background text-foreground shadow-minimal"
          : "bg-destructive/10 text-destructive shadow-tinted",
      )}
      style={mode === 'exclude' ? { '--shadow-color': 'var(--destructive-rgb)' } as React.CSSProperties : undefined}
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
  return (
    <>
      <StyledDropdownMenuItem
        onClick={(e) => { e.preventDefault(); onChangeMode('include') }}
        className={cn(mode === 'include' && "bg-foreground/[0.03]")}
      >
        <Check className="h-3.5 w-3.5 shrink-0" />
        <span className="flex-1">Include</span>
      </StyledDropdownMenuItem>
      <StyledDropdownMenuItem
        onClick={(e) => { e.preventDefault(); onChangeMode('exclude') }}
        className={cn(mode === 'exclude' && "bg-foreground/[0.03]")}
      >
        <X className="h-3.5 w-3.5 shrink-0" />
        <span className="flex-1">Exclude</span>
      </StyledDropdownMenuItem>
      <StyledDropdownMenuSeparator />
      <StyledDropdownMenuItem
        onClick={(e) => { e.preventDefault(); onRemove() }}
      >
        <Trash2 className="h-3.5 w-3.5 shrink-0" />
        <span className="flex-1">Clear</span>
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
}: {
  labels: LabelConfig[]
  labelFilter: Map<string, FilterMode>
  setLabelFilter: (updater: Map<string, FilterMode> | ((prev: Map<string, FilterMode>) => Map<string, FilterMode>)) => void
  /** Label ID pinned by the current route (non-removable, shown as checked+disabled) */
  pinnedLabelId?: string | null
}) {
  /** Toggle a label filter: if active → remove, if inactive → add as 'include' */
  const toggleLabel = (id: string) => {
    setLabelFilter(prev => {
      const next = new Map(prev)
      if (next.has(id)) next.delete(id)
      else next.set(id, 'include')
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
                  icon={<LabelIcon label={label} size="sm" hasChildren />}
                  label={label.name}
                  accessory={
                    showIndicator ? <Check className="h-3 w-3 text-muted-foreground" /> : undefined
                  }
                />
              </StyledDropdownMenuSubTrigger>
              <StyledDropdownMenuSubContent minWidth="min-w-[160px]">
                {isActive ? (
                  // Active group: group title as nested sub-trigger for mode options, then children
                  <>
                    <DropdownMenuSub>
                      {/* Click the group title to clear, hover to open mode submenu */}
                      <StyledDropdownMenuSubTrigger onClick={(e) => { e.preventDefault(); toggleLabel(label.id) }}>
                        <FilterMenuRow
                          icon={<LabelIcon label={label} size="sm" hasChildren />}
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
                    />
                  </>
                ) : (
                  // Inactive group: self-toggle item, then children
                  <>
                    <StyledDropdownMenuItem
                      disabled={isPinned}
                      onClick={(e) => {
                        if (isPinned) return
                        e.preventDefault()
                        toggleLabel(label.id)
                      }}
                    >
                      <FilterMenuRow
                        icon={<LabelIcon label={label} size="sm" hasChildren />}
                        label={label.name}
                        accessory={isPinned ? <Check className="h-3 w-3 text-muted-foreground" /> : undefined}
                      />
                    </StyledDropdownMenuItem>
                    <StyledDropdownMenuSeparator />
                    <FilterLabelItems
                      labels={label.children!}
                      labelFilter={labelFilter}
                      setLabelFilter={setLabelFilter}
                      pinnedLabelId={pinnedLabelId}
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
              <StyledDropdownMenuSubTrigger onClick={(e) => { e.preventDefault(); toggleLabel(label.id) }}>
                <FilterMenuRow
                  icon={<LabelIcon label={label} size="sm" />}
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
          <StyledDropdownMenuItem
            key={label.id}
            disabled={isPinned}
            onClick={(e) => {
              if (isPinned) return
              e.preventDefault()
              toggleLabel(label.id)
            }}
          >
            <FilterMenuRow
              icon={<LabelIcon label={label} size="sm" />}
              label={label.name}
              accessory={isPinned ? <Check className="h-3 w-3 text-muted-foreground" /> : undefined}
            />
          </StyledDropdownMenuItem>
        )
      })}
    </>
  )
}

const PANEL_WINDOW_EDGE_SPACING = 6 // Padding between panels and window edge
const PANEL_PANEL_SPACING = 5 // Gap between adjacent panels

/**
 * AppShell - Main 3-panel layout container
 *
 * Layout: [LeftSidebar 20%] | [NavigatorPanel 32%] | [MainContentPanel 48%]
 *
 * Chat Filters:
 * - 'allChats': Shows all sessions
 * - 'flagged': Shows flagged sessions
 * - 'state': Shows sessions with a specific todo state
 */
export function AppShell(props: AppShellProps) {
  // Wrap with EscapeInterruptProvider so AppShellContent can use useEscapeInterrupt
  return (
    <EscapeInterruptProvider>
      <AppShellContent {...props} />
    </EscapeInterruptProvider>
  )
}

/**
 * AppShellContent - Inner component that contains all the AppShell logic
 * Separated to allow useEscapeInterrupt hook to work (must be inside provider)
 */
function AppShellContent({
  contextValue,
  defaultLayout = [20, 32, 48],
  defaultCollapsed = false,
  menuNewChatTrigger,
  isFocusedMode = false,
}: AppShellProps) {
  // Destructure commonly used values from context
  // Note: sessions is NOT destructured here - we use sessionMetaMapAtom instead
  // to prevent closures from retaining the full messages array
  const {
    workspaces,
    activeWorkspaceId,
    currentModel,
    sessionOptions,
    onSelectWorkspace,
    onRefreshWorkspaces,
    onCreateSession,
    onDeleteSession,
    onFlagSession,
    onUnflagSession,
    onMarkSessionRead,
    onMarkSessionUnread,
    onTodoStateChange,
    onRenameSession,
    onOpenSettings,
    onOpenKeyboardShortcuts,
    onOpenStoredUserPreferences,
    onReset,
    onSendMessage,
    openNewChat,
  } = contextValue

  // View mode state - single source of truth for layout visibility
  // 'full': show all (sidebar + session list + chat)
  // 'compact': hide sidebar, show session list + chat
  // 'focus': hide both sidebar and session list, show only chat
  const [viewMode, setViewMode] = React.useState<ViewMode>(() => {
    // Migrate from old state if present
    const oldFocusMode = storage.get(storage.KEYS.focusModeEnabled, false)
    if (oldFocusMode) return 'focus'

    const oldSidebarVisible = storage.get(storage.KEYS.sidebarVisible, true)
    if (!oldSidebarVisible) return 'compact'

    return storage.get<ViewMode>(storage.KEYS.viewMode, 'full')
  })

  // Cycle through view modes: full -> compact -> focus -> full
  const cycleViewMode = React.useCallback(() => {
    setViewMode(current => {
      switch (current) {
        case 'full': return 'compact'
        case 'compact': return 'focus'
        case 'focus': return 'full'
      }
    })
  }, [])

  // Toggle sidebar visibility (Cmd+B behavior): toggles between full and compact
  const toggleSidebar = React.useCallback(() => {
    setViewMode(current => current === 'full' ? 'compact' : 'full')
  }, [])

  // Derived states from viewMode (prop-based focus mode overrides)
  const effectiveFocusMode = isFocusedMode || viewMode === 'focus'
  const effectiveCompactMode = viewMode === 'compact' || effectiveFocusMode
  // For backwards compatibility with existing code that uses isSidebarVisible
  const isSidebarVisible = viewMode === 'full' && !isFocusedMode

  const [sidebarWidth, setSidebarWidth] = React.useState(() => {
    return storage.get(storage.KEYS.sidebarWidth, 220)
  })
  // Session list width in pixels (min 240, max 480)
  const [sessionListWidth, setSessionListWidth] = React.useState(() => {
    return storage.get(storage.KEYS.sessionListWidth, 300)
  })

  // Right sidebar state (min 280, max 480)
  const [isRightSidebarVisible, setIsRightSidebarVisible] = React.useState(() => {
    return storage.get(storage.KEYS.rightSidebarVisible, false)
  })
  const [rightSidebarWidth, setRightSidebarWidth] = React.useState(() => {
    return storage.get(storage.KEYS.rightSidebarWidth, 300)
  })
  const [skipRightSidebarAnimation, setSkipRightSidebarAnimation] = React.useState(false)

  // Window width tracking for responsive behavior
  const [windowWidth, setWindowWidth] = React.useState(window.innerWidth)

  // Calculate overlay threshold dynamically based on actual sidebar widths
  // Formula: 600px (300px right sidebar + 300px center) + leftSidebar + sessionList
  // This ensures we switch to overlay mode when inline right sidebar would compress content
  const MIN_INLINE_SPACE = 600 // 300px for right sidebar + 300px for center content
  const leftSidebarEffectiveWidth = isSidebarVisible ? sidebarWidth : 0
  const OVERLAY_THRESHOLD = MIN_INLINE_SPACE + leftSidebarEffectiveWidth + sessionListWidth
  const shouldUseOverlay = windowWidth < OVERLAY_THRESHOLD

  const [isResizing, setIsResizing] = React.useState<'sidebar' | 'session-list' | 'right-sidebar' | null>(null)
  const [sidebarHandleY, setSidebarHandleY] = React.useState<number | null>(null)
  const [sessionListHandleY, setSessionListHandleY] = React.useState<number | null>(null)
  const [rightSidebarHandleY, setRightSidebarHandleY] = React.useState<number | null>(null)
  const resizeHandleRef = React.useRef<HTMLDivElement>(null)
  const sessionListHandleRef = React.useRef<HTMLDivElement>(null)
  const rightSidebarHandleRef = React.useRef<HTMLDivElement>(null)
  const [session, setSession] = useSession()
  const { resolvedMode, isDark, setMode } = useTheme()
  const { canGoBack, canGoForward, goBack, goForward, navigateToSource } = useNavigation()

  // Double-Esc interrupt feature: first Esc shows warning, second Esc interrupts
  const { handleEscapePress } = useEscapeInterrupt()

  // UNIFIED NAVIGATION STATE - single source of truth from NavigationContext
  // All sidebar/navigator/main panel state is derived from this
  const navState = useNavigationState()

  // Derive chat filter from navigation state (only when in chats navigator)
  const chatFilter = isChatsNavigation(navState) ? navState.filter : null

  // Derive source filter from navigation state (only when in sources navigator)
  const sourceFilter: SourceFilter | null = isSourcesNavigation(navState) ? navState.filter ?? null : null

  // Per-view filter storage: each session list view (allChats, flagged, state:X, label:X, view:X)
  // has its own independent set of status and label filters.
  // Each filter entry stores a mode ('include' or 'exclude') for tri-state filtering.
  type FilterEntry = Record<string, FilterMode> // id → mode
  type ViewFiltersMap = Record<string, { statuses: FilterEntry, labels: FilterEntry }>

  // Compute a stable key for the current chat filter view
  const chatFilterKey = useMemo(() => {
    if (!chatFilter) return null
    switch (chatFilter.kind) {
      case 'allChats': return 'allChats'
      case 'flagged': return 'flagged'
      case 'state': return `state:${chatFilter.stateId}`
      case 'label': return `label:${chatFilter.labelId}`
      case 'view': return `view:${chatFilter.viewId}`
      case 'workingDir': return `workingDir:${chatFilter.workingDir}`
      default: return 'allChats'
    }
  }, [chatFilter])

  const [viewFiltersMap, setViewFiltersMap] = React.useState<ViewFiltersMap>(() => {
    const saved = storage.get<ViewFiltersMap>(storage.KEYS.viewFilters, {})
    // Backward compat: migrate old format (arrays) into new format (Record<string, FilterMode>)
    if (saved.allChats && Array.isArray((saved.allChats as any).statuses)) {
      // Old format: { statuses: string[], labels: string[] } → new: { statuses: Record, labels: Record }
      for (const key of Object.keys(saved)) {
        const entry = saved[key] as any
        if (Array.isArray(entry.statuses)) {
          const newStatuses: FilterEntry = {}
          for (const id of entry.statuses) newStatuses[id] = 'include'
          const newLabels: FilterEntry = {}
          for (const id of entry.labels) newLabels[id] = 'include'
          saved[key] = { statuses: newStatuses, labels: newLabels }
        }
      }
    }
    // Also migrate legacy global filters if no allChats entry exists
    if (!saved.allChats) {
      const oldStatuses = storage.get<TodoStateId[]>(storage.KEYS.listFilter, [])
      const oldLabels = storage.get<string[]>(storage.KEYS.labelFilter, [])
      if (oldStatuses.length > 0 || oldLabels.length > 0) {
        const statuses: FilterEntry = {}
        for (const id of oldStatuses) statuses[id] = 'include'
        const labels: FilterEntry = {}
        for (const id of oldLabels) labels[id] = 'include'
        saved.allChats = { statuses, labels }
      }
    }
    return saved
  })

  // Derive current view's status filter as a Map<TodoStateId, FilterMode>
  const listFilter = useMemo(() => {
    if (!chatFilterKey) return new Map<TodoStateId, FilterMode>()
    const entry = viewFiltersMap[chatFilterKey]?.statuses ?? {}
    return new Map<TodoStateId, FilterMode>(Object.entries(entry) as [TodoStateId, FilterMode][])
  }, [viewFiltersMap, chatFilterKey])

  // Derive current view's label filter as a Map<string, FilterMode>
  const labelFilter = useMemo(() => {
    if (!chatFilterKey) return new Map<string, FilterMode>()
    const entry = viewFiltersMap[chatFilterKey]?.labels ?? {}
    return new Map<string, FilterMode>(Object.entries(entry) as [string, FilterMode][])
  }, [viewFiltersMap, chatFilterKey])

  // Setter for status filter — updates only the current view's entry in the map
  const setListFilter = useCallback((updater: Map<TodoStateId, FilterMode> | ((prev: Map<TodoStateId, FilterMode>) => Map<TodoStateId, FilterMode>)) => {
    setViewFiltersMap(prev => {
      if (!chatFilterKey) return prev
      const current = new Map<TodoStateId, FilterMode>(Object.entries(prev[chatFilterKey]?.statuses ?? {}) as [TodoStateId, FilterMode][])
      const next = typeof updater === 'function' ? updater(current) : updater
      return {
        ...prev,
        [chatFilterKey]: { statuses: Object.fromEntries(next), labels: prev[chatFilterKey]?.labels ?? {} }
      }
    })
  }, [chatFilterKey])

  // Setter for label filter — updates only the current view's entry in the map
  const setLabelFilter = useCallback((updater: Map<string, FilterMode> | ((prev: Map<string, FilterMode>) => Map<string, FilterMode>)) => {
    setViewFiltersMap(prev => {
      if (!chatFilterKey) return prev
      const current = new Map<string, FilterMode>(Object.entries(prev[chatFilterKey]?.labels ?? {}) as [string, FilterMode][])
      const next = typeof updater === 'function' ? updater(current) : updater
      return {
        ...prev,
        [chatFilterKey]: { statuses: prev[chatFilterKey]?.statuses ?? {}, labels: Object.fromEntries(next) }
      }
    })
  }, [chatFilterKey])
  // Search state for session list
  const [searchActive, setSearchActive] = React.useState(false)
  const [searchQuery, setSearchQuery] = React.useState('')

  // Ref for ChatDisplay navigation (exposed via forwardRef)
  const chatDisplayRef = React.useRef<ChatDisplayHandle>(null)
  // Track match count and index from ChatDisplay (for SessionList navigation UI)
  const [chatMatchInfo, setChatMatchInfo] = React.useState<{ count: number; index: number }>({ count: 0, index: 0 })

  // Callback for immediate match info updates from ChatDisplay
  const handleChatMatchInfoChange = React.useCallback((info: { count: number; index: number }) => {
    setChatMatchInfo(info)
  }, [])

  // Reset match info when search is deactivated
  React.useEffect(() => {
    if (!searchActive || !searchQuery) {
      setChatMatchInfo({ count: 0, index: 0 })
    }
  }, [searchActive, searchQuery])

  // Filter dropdown: inline search query for filtering statuses/labels in a flat list.
  // When empty, the dropdown shows hierarchical submenus. When typing, shows a flat filtered list.
  const [filterDropdownQuery, setFilterDropdownQuery] = React.useState('')

  // Reset search only when navigator or filter changes (not when selecting sessions)
  const navFilterKey = React.useMemo(() => {
    if (isChatsNavigation(navState)) {
      const filter = navState.filter
      return `chats:${filter.kind}:${filter.kind === 'state' ? filter.stateId : ''}`
    }
    return navState.navigator
  }, [navState])

  React.useEffect(() => {
    setSearchActive(false)
    setSearchQuery('')
  }, [navFilterKey])

  // Auto-hide right sidebar when navigating away from chat sessions
  React.useEffect(() => {
    // Hide sidebar if not in chat view or no session selected
    if (!isChatsNavigation(navState) || !navState.details) {
      setSkipRightSidebarAnimation(true)
      setIsRightSidebarVisible(false)
      // Reset skip flag after state update
      setTimeout(() => setSkipRightSidebarAnimation(false), 0)
    }
  }, [navState])

  // Cmd+F to activate search
  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
        e.preventDefault()
        setSearchActive(true)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  // Track window width for responsive right sidebar behavior
  React.useEffect(() => {
    const handleResize = () => setWindowWidth(window.innerWidth)
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  // Unified sidebar keyboard navigation state
  // Load expanded folders from localStorage (default: all collapsed)
  const [expandedFolders, setExpandedFolders] = React.useState<Set<string>>(() => {
    const saved = storage.get<string[]>(storage.KEYS.expandedFolders, [])
    return new Set(saved)
  })
  const [focusedSidebarItemId, setFocusedSidebarItemId] = React.useState<string | null>(null)
  const sidebarItemRefs = React.useRef<Map<string, HTMLElement>>(new Map())
  // Track which expandable sidebar items are collapsed
  // Labels are collapsed by default; user preference is persisted once toggled
  const [collapsedItems, setCollapsedItems] = React.useState<Set<string>>(() => {
    const saved = storage.get<string[] | null>(storage.KEYS.collapsedSidebarItems, null)
    if (saved !== null) return new Set(saved)
    return new Set(['nav:labels', 'nav:workingDirs'])
  })
  const isExpanded = React.useCallback((id: string) => !collapsedItems.has(id), [collapsedItems])
  const toggleExpanded = React.useCallback((id: string) => {
    setCollapsedItems(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])
  // Sources state (workspace-scoped)
  const [sources, setSources] = React.useState<LoadedSource[]>([])
  // Sync sources to atom for NavigationContext auto-selection
  const setSourcesAtom = useSetAtom(sourcesAtom)
  React.useEffect(() => {
    setSourcesAtom(sources)
  }, [sources, setSourcesAtom])

  // Skills state (workspace-scoped)
  const [skills, setSkills] = React.useState<LoadedSkill[]>([])
  // Sync skills to atom for NavigationContext auto-selection
  const setSkillsAtom = useSetAtom(skillsAtom)
  React.useEffect(() => {
    setSkillsAtom(skills)
  }, [skills, setSkillsAtom])
  // Whether local MCP servers are enabled (affects stdio source status)
  const [localMcpEnabled, setLocalMcpEnabled] = React.useState(true)

  // Enabled permission modes for Shift+Tab cycling (min 2 modes)
  const [enabledModes, setEnabledModes] = React.useState<PermissionMode[]>(['safe', 'ask', 'allow-all'])
  // Whether session status (todo) feature is enabled
  const [statusEnabled, setStatusEnabled] = React.useState(false)

  // Load workspace settings (for localMcpEnabled, cyclablePermissionModes, statusEnabled) on workspace change
  React.useEffect(() => {
    if (!activeWorkspaceId) return
    window.electronAPI.getWorkspaceSettings(activeWorkspaceId).then((settings) => {
      if (settings) {
        setLocalMcpEnabled(settings.localMcpEnabled ?? true)
        // Load cyclablePermissionModes from workspace settings
        if (settings.cyclablePermissionModes && settings.cyclablePermissionModes.length >= 2) {
          setEnabledModes(settings.cyclablePermissionModes)
        }
        // Load statusEnabled from workspace settings
        setStatusEnabled(settings.statusEnabled ?? false)
      }
    }).catch((err) => {
      console.error('[Chat] Failed to load workspace settings:', err)
    })
  }, [activeWorkspaceId])

  // Reset UI state when workspace changes
  // This prevents stale search queries, focused items, and filter state from persisting
  const previousWorkspaceRef = React.useRef<string | null>(null)
  React.useEffect(() => {
    if (!activeWorkspaceId) return

    const previousWorkspaceId = previousWorkspaceRef.current

    // Skip on initial mount
    if (previousWorkspaceId !== null && previousWorkspaceId !== activeWorkspaceId) {
      // Clear search state
      setSearchActive(false)
      setSearchQuery('')

      // Clear filter dropdown state
      setFilterDropdownQuery('')
      setFilterDropdownSelectedIdx(0)

      // Clear focused sidebar item
      setFocusedSidebarItemId(null)

      // Load workspace-scoped filter state from new workspace
      // (viewFiltersMap, expandedFolders, collapsedItems)
      const newViewFilters = storage.get<ViewFiltersMap>(storage.KEYS.viewFilters, {}, activeWorkspaceId)
      setViewFiltersMap(newViewFilters)

      const newExpandedFolders = storage.get<string[]>(storage.KEYS.expandedFolders, [], activeWorkspaceId)
      setExpandedFolders(new Set(newExpandedFolders))

      const newCollapsedItems = storage.get<string[] | null>(storage.KEYS.collapsedSidebarItems, null, activeWorkspaceId)
      setCollapsedItems(newCollapsedItems !== null ? new Set(newCollapsedItems) : new Set(['nav:labels', 'nav:workingDirs']))
    }

    previousWorkspaceRef.current = activeWorkspaceId
  }, [activeWorkspaceId])

  // Load sources from backend on mount
  React.useEffect(() => {
    if (!activeWorkspaceId) return
    window.electronAPI.getSources(activeWorkspaceId).then((loaded) => {
      setSources(loaded || [])
    }).catch(err => {
      console.error('[Chat] Failed to load sources:', err)
    })
  }, [activeWorkspaceId])

  // Subscribe to live source updates (when sources are added/removed dynamically)
  React.useEffect(() => {
    const cleanup = window.electronAPI.onSourcesChanged((updatedSources) => {
      // Clear icon cache so updated source icons are re-fetched on render
      clearSourceIconCaches()
      setSources(updatedSources || [])
    })
    return cleanup
  }, [])

  // Subscribe to live skill updates (when skills are added/removed dynamically)
  React.useEffect(() => {
    const cleanup = window.electronAPI.onSkillsChanged?.((updatedSkills) => {
      setSkills(updatedSkills || [])
    })
    return cleanup
  }, [])

  // Handle session source selection changes
  const handleSessionSourcesChange = React.useCallback(async (sessionId: string, sourceSlugs: string[]) => {
    try {
      await window.electronAPI.sessionCommand(sessionId, { type: 'setSources', sourceSlugs })
      // Session will emit a 'sources_changed' event that updates the session state
    } catch (err) {
      console.error('[Chat] Failed to set session sources:', err)
    }
  }, [])

  // Handle session label changes (add/remove via # menu or badge X)
  const handleSessionLabelsChange = React.useCallback(async (sessionId: string, labels: string[]) => {
    try {
      await window.electronAPI.sessionCommand(sessionId, { type: 'setLabels', labels })
      // Session will emit a 'labels_changed' event that updates the session state
    } catch (err) {
      console.error('[Chat] Failed to set session labels:', err)
    }
  }, [])

  const activeWorkspace = workspaces.find(w => w.id === activeWorkspaceId)

  // Load dynamic statuses from workspace config
  const { statuses: statusConfigs, isLoading: isLoadingStatuses } = useStatuses(activeWorkspace?.id || null)
  const [todoStates, setTodoStates] = React.useState<TodoState[]>([])

  // Convert StatusConfig to TodoState with resolved icons
  React.useEffect(() => {
    if (!activeWorkspace?.id || statusConfigs.length === 0) {
      setTodoStates([])
      return
    }

    setTodoStates(statusConfigsToTodoStates(statusConfigs, activeWorkspace.id, isDark))
  }, [statusConfigs, activeWorkspace?.id, isDark])

  // Optimistic status order: immediately reflects drag-drop order while IPC propagates.
  // Cleared when statusConfigs changes (config watcher is source of truth).
  const [optimisticStatusOrder, setOptimisticStatusOrder] = React.useState<string[] | null>(null)

  // Clear optimistic state when the config watcher fires (statusConfigs changes)
  React.useEffect(() => {
    setOptimisticStatusOrder(null)
  }, [statusConfigs])

  // Derive effective todo states: apply optimistic reorder if active, otherwise use canonical order
  const effectiveTodoStates = React.useMemo(() => {
    if (!optimisticStatusOrder) return todoStates
    // Reorder todoStates array to match optimistic order
    const stateMap = new Map(todoStates.map(s => [s.id, s]))
    const reordered: TodoState[] = []
    for (const id of optimisticStatusOrder) {
      const state = stateMap.get(id)
      if (state) reordered.push(state)
    }
    // Append any states not in the optimistic order (shouldn't happen, but defensive)
    for (const state of todoStates) {
      if (!optimisticStatusOrder.includes(state.id)) reordered.push(state)
    }
    return reordered
  }, [todoStates, optimisticStatusOrder])

  // Load labels from workspace config
  const { labels: labelConfigs } = useLabels(activeWorkspace?.id || null)

  // Views: compiled once on config load, evaluated per session in list/chat
  const { evaluateSession: evaluateViews, viewConfigs } = useViews(activeWorkspace?.id || null)

  // Build hierarchical label tree from nested config structure
  const labelTree = useMemo(() => buildLabelTree(labelConfigs), [labelConfigs])

  // Build flat LabelMenuItem[] from hierarchical labelConfigs for the filter dropdown's search mode.
  // Uses the same structure as the # inline menu so we can reuse filterItems().
  const flatLabelMenuItems = useMemo((): LabelMenuItem[] => {
    const flat = flattenLabels(labelConfigs)
    // Build parent path breadcrumbs for nested labels
    const findParentPath = (tree: LabelConfig[], targetId: string, path: string[]): string[] | null => {
      for (const node of tree) {
        if (node.id === targetId) return path
        if (node.children) {
          const result = findParentPath(node.children, targetId, [...path, node.name])
          if (result) return result
        }
      }
      return null
    }
    return flat.map(label => {
      let parentPath: string | undefined
      const pathParts = findParentPath(labelConfigs, label.id, [])
      if (pathParts && pathParts.length > 0) {
        parentPath = pathParts.join(' / ') + ' / '
      }
      return { id: label.id, label: label.name, config: label, parentPath }
    })
  }, [labelConfigs])

  // Filter dropdown keyboard navigation: tracks highlighted item index in flat search mode.
  // Unified index: [0..matchedStates-1] = statuses, [matchedStates..total-1] = labels.
  const [filterDropdownSelectedIdx, setFilterDropdownSelectedIdx] = React.useState(0)
  const filterDropdownListRef = React.useRef<HTMLDivElement>(null)
  const filterDropdownInputRef = React.useRef<HTMLInputElement>(null)

  // Compute filtered results for the dropdown's search mode (memoized for use in both
  // the keyboard handler and the JSX render).
  const filterDropdownResults = useMemo(() => {
    if (!filterDropdownQuery.trim()) return { states: [] as TodoState[], labels: [] as LabelMenuItem[] }
    return {
      states: filterLabelMenuStates(effectiveTodoStates, filterDropdownQuery),
      labels: filterLabelMenuItems(flatLabelMenuItems, filterDropdownQuery),
    }
  }, [filterDropdownQuery, effectiveTodoStates, flatLabelMenuItems])

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

  // Ensure session messages are loaded when selected
  const ensureMessagesLoaded = useSetAtom(ensureSessionMessagesLoadedAtom)

  // Handle selecting a source from the list (preserves current filter type)
  const handleSourceSelect = React.useCallback((source: LoadedSource) => {
    if (!activeWorkspaceId) return
    navigateToSource(source.config.slug)
  }, [activeWorkspaceId, navigateToSource])

  // Handle selecting a skill from the list
  const handleSkillSelect = React.useCallback((skill: LoadedSkill) => {
    if (!activeWorkspaceId) return
    navigate(routes.view.skills(skill.slug))
  }, [activeWorkspaceId, navigate])

  // Focus zone management
  const { focusZone, focusNextZone, focusPreviousZone } = useFocusContext()

  // Register focus zones
  const { zoneRef: sidebarRef, isFocused: sidebarFocused } = useFocusZone({ zoneId: 'sidebar' })

  // Ref for focusing chat input (passed to ChatDisplay)
  const chatInputRef = useRef<RichTextInputHandle>(null)
  const focusChatInput = useCallback(() => {
    chatInputRef.current?.focus()
  }, [])

  // Global keyboard shortcuts
  useGlobalShortcuts({
    shortcuts: [
      // Zone navigation
      { key: '1', cmd: true, action: () => focusZone('sidebar') },
      { key: '2', cmd: true, action: () => focusZone('session-list') },
      { key: '3', cmd: true, action: () => focusZone('chat') },
      // Tab navigation between zones
      { key: 'Tab', action: focusNextZone, when: () => !document.querySelector('[role="dialog"]') },
      // Shift+Tab cycles permission mode through enabled modes (textarea handles its own, this handles when focus is elsewhere)
      {
        key: 'Tab', shift: true, action: () => {
          if (session.selected) {
            const currentOptions = contextValue.sessionOptions.get(session.selected)
            const currentMode = currentOptions?.permissionMode ?? 'ask'
            // Cycle through enabled permission modes
            const modes = enabledModes.length >= 2 ? enabledModes : ['safe', 'ask', 'allow-all'] as PermissionMode[]
            const currentIndex = modes.indexOf(currentMode)
            // If current mode not in enabled list, jump to first enabled mode
            const nextIndex = currentIndex === -1 ? 0 : (currentIndex + 1) % modes.length
            const nextMode = modes[nextIndex]
            contextValue.onSessionOptionsChange(session.selected, { permissionMode: nextMode })
          }
        }, when: () => !document.querySelector('[role="dialog"]') && document.activeElement?.tagName !== 'TEXTAREA'
      },
      // Sidebar toggle (CMD+B)
      { key: 'b', cmd: true, action: toggleSidebar },
      // View mode cycle (CMD+.) - cycles through full -> compact -> focus
      { key: '.', cmd: true, action: cycleViewMode },
      // New chat
      { key: 'n', cmd: true, action: () => handleNewChat(true) },
      // Settings
      { key: ',', cmd: true, action: onOpenSettings },
      // History navigation
      { key: '[', cmd: true, action: goBack },
      { key: ']', cmd: true, action: goForward },
      // Search match navigation (CMD+G next, CMD+SHIFT+G prev)
      { key: 'g', cmd: true, action: () => chatDisplayRef.current?.goToNextMatch(), when: () => searchActive && (chatMatchInfo.count ?? 0) > 0 },
      { key: 'g', cmd: true, shift: true, action: () => chatDisplayRef.current?.goToPrevMatch(), when: () => searchActive && (chatMatchInfo.count ?? 0) > 0 },
      // ESC to stop processing - requires double-press within 1 second
      // First press shows warning overlay, second press interrupts
      {
        key: 'Escape', action: () => {
          if (session.selected) {
            const meta = sessionMetaMap.get(session.selected)
            if (meta?.isProcessing) {
              // handleEscapePress returns true on second press (within timeout)
              const shouldInterrupt = handleEscapePress()
              if (shouldInterrupt) {
                window.electronAPI.cancelProcessing(session.selected, false).catch(err => {
                  console.error('[AppShell] Failed to cancel processing:', err)
                })
              }
            }
          }
        }, when: () => {
          // Only active when no overlay is open and session is processing
          // Overlays (dialogs, menus, popovers, etc.) should handle their own Escape
          if (hasOpenOverlay()) return false
          if (!session.selected) return false
          const meta = sessionMetaMap.get(session.selected)
          return meta?.isProcessing ?? false
        }
      },
      // Theme toggle (CMD+SHIFT+A)
      { key: 'a', cmd: true, shift: true, action: () => setMode(resolvedMode === 'dark' ? 'light' : 'dark') },
    ],
  })

  // Global paste listener for file attachments
  // Fires when Cmd+V is pressed anywhere in the app (not just textarea)
  React.useEffect(() => {
    const handleGlobalPaste = (e: ClipboardEvent) => {
      // Skip if a dialog or menu is open
      if (document.querySelector('[role="dialog"], [role="menu"]')) {
        return
      }

      // Skip if there are no files in the clipboard
      const files = e.clipboardData?.files
      if (!files || files.length === 0) return

      // Skip if the active element is an input/textarea/contenteditable (let it handle paste directly)
      const activeElement = document.activeElement as HTMLElement | null
      if (
        activeElement?.tagName === 'TEXTAREA' ||
        activeElement?.tagName === 'INPUT' ||
        activeElement?.isContentEditable
      ) {
        return
      }

      // Prevent default paste behavior
      e.preventDefault()

      // Dispatch custom event for FreeFormInput to handle
      const filesArray = Array.from(files)
      window.dispatchEvent(new CustomEvent('craft:paste-files', {
        detail: { files: filesArray }
      }))
    }

    document.addEventListener('paste', handleGlobalPaste)
    return () => document.removeEventListener('paste', handleGlobalPaste)
  }, [])

  // Resize effect for sidebar, session list, and right sidebar
  React.useEffect(() => {
    if (!isResizing) return

    const handleMouseMove = (e: MouseEvent) => {
      if (isResizing === 'sidebar') {
        const newWidth = Math.min(Math.max(e.clientX, 180), 320)
        setSidebarWidth(newWidth)
        if (resizeHandleRef.current) {
          const rect = resizeHandleRef.current.getBoundingClientRect()
          setSidebarHandleY(e.clientY - rect.top)
        }
      } else if (isResizing === 'session-list') {
        const offset = isSidebarVisible ? sidebarWidth : 0
        const newWidth = Math.min(Math.max(e.clientX - offset, 240), 480)
        setSessionListWidth(newWidth)
        if (sessionListHandleRef.current) {
          const rect = sessionListHandleRef.current.getBoundingClientRect()
          setSessionListHandleY(e.clientY - rect.top)
        }
      } else if (isResizing === 'right-sidebar') {
        // Calculate from right edge
        const newWidth = Math.min(Math.max(window.innerWidth - e.clientX, 280), 480)
        setRightSidebarWidth(newWidth)
        if (rightSidebarHandleRef.current) {
          const rect = rightSidebarHandleRef.current.getBoundingClientRect()
          setRightSidebarHandleY(e.clientY - rect.top)
        }
      }
    }

    const handleMouseUp = () => {
      if (isResizing === 'sidebar') {
        storage.set(storage.KEYS.sidebarWidth, sidebarWidth)
        setSidebarHandleY(null)
      } else if (isResizing === 'session-list') {
        storage.set(storage.KEYS.sessionListWidth, sessionListWidth)
        setSessionListHandleY(null)
      } else if (isResizing === 'right-sidebar') {
        storage.set(storage.KEYS.rightSidebarWidth, rightSidebarWidth)
        setRightSidebarHandleY(null)
      }
      setIsResizing(null)
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)

    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [isResizing, sidebarWidth, sessionListWidth, rightSidebarWidth, isSidebarVisible])

  // Spring transition config - shared between sidebar and header
  // Critical damping (no bounce): damping = 2 * sqrt(stiffness * mass)
  const springTransition = {
    type: "spring" as const,
    stiffness: 600,
    damping: 49,
  }

  // Use session metadata from Jotai atom (lightweight, no messages)
  // This prevents closures from retaining full message arrays
  const sessionMetaMap = useAtomValue(sessionMetaMapAtom)

  // Reload skills when active session's workingDirectory changes (for project-level skills)
  // Skills are loaded from: global (~/.agents/skills/), workspace, and project ({workingDirectory}/.agents/skills/)
  const activeSessionWorkingDirectory = session.selected
    ? sessionMetaMap.get(session.selected)?.workingDirectory
    : undefined
  React.useEffect(() => {
    if (!activeWorkspaceId) return
    window.electronAPI.getSkills(activeWorkspaceId, activeSessionWorkingDirectory).then((loaded) => {
      setSkills(loaded || [])
    }).catch(err => {
      console.error('[Chat] Failed to load skills:', err)
    })
  }, [activeWorkspaceId, activeSessionWorkingDirectory])

  // Filter session metadata by active workspace
  // Also exclude hidden sessions (mini-agent sessions) from all counts and lists
  const workspaceSessionMetas = useMemo(() => {
    const metas = Array.from(sessionMetaMap.values())
    return activeWorkspaceId
      ? metas.filter(s => s.workspaceId === activeWorkspaceId && !s.hidden)
      : metas.filter(s => !s.hidden)
  }, [sessionMetaMap, activeWorkspaceId])

  // Count sessions by todo state (scoped to workspace)
  const isMetaDone = (s: SessionMeta) => s.todoState === 'done' || s.todoState === 'cancelled'
  const flaggedCount = workspaceSessionMetas.filter(s => s.isFlagged).length

  // Compute session counts per label (cumulative: parent includes descendants).
  // Flatten the tree for iteration, use the tree for descendant lookups.
  const labelCounts = useMemo(() => {
    const allLabels = flattenLabels(labelConfigs)
    const counts: Record<string, number> = {}
    for (const label of allLabels) {
      // Direct count: sessions explicitly tagged with this label (handles valued entries like "priority::3")
      const directCount = workspaceSessionMetas.filter(
        s => s.labels?.some(l => extractLabelId(l) === label.id)
      ).length
      counts[label.id] = directCount
    }
    // Add descendant counts to parents (cumulative)
    for (const label of allLabels) {
      const descendants = getDescendantIds(labelConfigs, label.id)
      if (descendants.length > 0) {
        const descendantCount = workspaceSessionMetas.filter(
          s => s.labels?.some(l => descendants.includes(extractLabelId(l)))
        ).length
        counts[label.id] = (counts[label.id] || 0) + descendantCount
      }
    }
    return counts
  }, [workspaceSessionMetas, labelConfigs])

  // Count sessions by individual todo state (dynamic based on effectiveTodoStates)
  const todoStateCounts = useMemo(() => {
    const counts: Record<TodoStateId, number> = {}
    // Initialize counts for all dynamic statuses
    for (const state of effectiveTodoStates) {
      counts[state.id] = 0
    }
    // Count sessions
    for (const s of workspaceSessionMetas) {
      const state = (s.todoState || 'todo') as TodoStateId
      // Increment count (initialize to 0 if status not in effectiveTodoStates yet)
      counts[state] = (counts[state] || 0) + 1
    }
    return counts
  }, [workspaceSessionMetas, effectiveTodoStates])

  // Count sources by type for the Sources dropdown subcategories
  const sourceTypeCounts = useMemo(() => {
    const counts = { api: 0, mcp: 0, local: 0 }
    for (const source of sources) {
      const t = source.config.type
      if (t === 'api' || t === 'mcp' || t === 'local') {
        counts[t]++
      }
    }
    return counts
  }, [sources])

  // Group sessions by working directory (for sidebar "Working Directory" section)
  // Returns array of { path, displayName, count } sorted by count descending
  const workingDirGroups = useMemo(() => {
    const countMap = new Map<string, number>()
    for (const s of workspaceSessionMetas) {
      if (s.workingDirectory) {
        countMap.set(s.workingDirectory, (countMap.get(s.workingDirectory) || 0) + 1)
      }
    }
    return Array.from(countMap.entries())
      .map(([path, count]) => ({
        path,
        // Display the last folder name (basename) as the title
        displayName: path.split('/').filter(Boolean).pop() || path,
        count,
      }))
      .sort((a, b) => b.count - a.count)
  }, [workspaceSessionMetas])

  // Filter session metadata based on sidebar mode and chat filter
  const filteredSessionMetas = useMemo(() => {
    // When in sources mode, return empty (no sessions to show)
    if (!chatFilter) {
      return []
    }

    let result: SessionMeta[]

    switch (chatFilter.kind) {
      case 'allChats':
        // "All Chats" - shows all sessions
        result = workspaceSessionMetas
        break
      case 'flagged':
        result = workspaceSessionMetas.filter(s => s.isFlagged)
        break
      case 'state':
        // Filter by specific todo state
        result = workspaceSessionMetas.filter(s => (s.todoState || 'todo') === chatFilter.stateId)
        break
      case 'label': {
        if (chatFilter.labelId === '__all__') {
          // "Labels" header: show all sessions that have at least one label
          result = workspaceSessionMetas.filter(s => s.labels && s.labels.length > 0)
        } else {
          // Specific label: includes sessions tagged with this label or any descendant
          const descendants = getDescendantIds(labelConfigs, chatFilter.labelId)
          const matchIds = new Set([chatFilter.labelId, ...descendants])
          result = workspaceSessionMetas.filter(
            s => s.labels?.some(l => matchIds.has(extractLabelId(l)))
          )
        }
        break
      }
      case 'view': {
        // Filter by view: __all__ shows any session matched by any view,
        // otherwise filter to the specific view
        result = workspaceSessionMetas.filter(s => {
          const matched = evaluateViews(s)
          if (chatFilter.viewId === '__all__') {
            return matched.length > 0
          }
          return matched.some(v => v.id === chatFilter.viewId)
        })
        break
      }
      default:
        result = workspaceSessionMetas
    }

    // Apply secondary filters (status + labels, AND-ed together) in ALL views.
    // These layer on top of the primary chatFilter to allow further narrowing.
    // Each filter supports include/exclude modes:
    //   - Includes: if any exist, only matching items pass
    //   - Excludes: matching items are removed (applied after includes)
    if (listFilter.size > 0) {
      const statusIncludes = new Set<TodoStateId>()
      const statusExcludes = new Set<TodoStateId>()
      for (const [id, mode] of listFilter) {
        if (mode === 'include') statusIncludes.add(id)
        else statusExcludes.add(id)
      }
      if (statusIncludes.size > 0) {
        result = result.filter(s => statusIncludes.has((s.todoState || 'todo') as TodoStateId))
      }
      if (statusExcludes.size > 0) {
        result = result.filter(s => !statusExcludes.has((s.todoState || 'todo') as TodoStateId))
      }
    }
    // Filter by labels — supports include/exclude with descendant expansion
    if (labelFilter.size > 0) {
      const labelIncludes = new Set<string>()
      const labelExcludes = new Set<string>()
      for (const [id, mode] of labelFilter) {
        // Expand to include descendant label IDs
        const ids = [id, ...getDescendantIds(labelConfigs, id)]
        for (const expandedId of ids) {
          if (mode === 'include') labelIncludes.add(expandedId)
          else labelExcludes.add(expandedId)
        }
      }
      if (labelIncludes.size > 0) {
        result = result.filter(s =>
          s.labels?.some(l => labelIncludes.has(extractLabelId(l)))
        )
      }
      if (labelExcludes.size > 0) {
        result = result.filter(s =>
          !s.labels?.some(l => labelExcludes.has(extractLabelId(l)))
        )
      }
    }

    return result
  }, [workspaceSessionMetas, chatFilter, listFilter, labelFilter, labelConfigs])

  // Derive "pinned" (non-removable) filters from the current chatFilter path.
  // These represent filters that are implicit in the current deeplink/route and
  // should be displayed as fixed chips in the filter bar that users cannot remove.
  const pinnedFilters = useMemo(() => {
    if (!chatFilter) return { pinnedStatusId: null as string | null, pinnedLabelId: null as string | null, pinnedFlagged: false }
    switch (chatFilter.kind) {
      case 'state':
        return { pinnedStatusId: chatFilter.stateId, pinnedLabelId: null, pinnedFlagged: false }
      case 'label':
        // Don't pin the __all__ pseudo-label — that just means "any label"
        return { pinnedStatusId: null, pinnedLabelId: chatFilter.labelId !== '__all__' ? chatFilter.labelId : null, pinnedFlagged: false }
      case 'flagged':
        return { pinnedStatusId: null, pinnedLabelId: null, pinnedFlagged: true }
      default:
        return { pinnedStatusId: null, pinnedLabelId: null, pinnedFlagged: false }
    }
  }, [chatFilter])

  // Ensure session messages are loaded when selected
  React.useEffect(() => {
    if (session.selected) {
      ensureMessagesLoaded(session.selected)
    }
  }, [session.selected, ensureMessagesLoaded])

  // Wrap delete handler to clear selection when deleting the currently selected session
  // This prevents stale state during re-renders that could cause crashes
  const handleDeleteSession = useCallback(async (sessionId: string, skipConfirmation?: boolean): Promise<boolean> => {
    // Clear selection first if this is the selected session
    if (session.selected === sessionId) {
      setSession({ selected: null })
    }
    return onDeleteSession(sessionId, skipConfirmation)
  }, [session.selected, setSession, onDeleteSession])

  // Right sidebar OPEN button (fades out when sidebar is open, hidden in non-chat views)
  const rightSidebarOpenButton = React.useMemo(() => {
    if (!isChatsNavigation(navState) || !navState.details) return null

    return (
      <motion.div
        initial={false}
        animate={{ opacity: isRightSidebarVisible ? 0 : 1 }}
        transition={{ duration: 0.15 }}
        style={{ pointerEvents: isRightSidebarVisible ? 'none' : 'auto' }}
      >
        <HeaderIconButton
          icon={<PanelRight className="h-4 w-4" />}
          onClick={() => setIsRightSidebarVisible(true)}

          className="text-foreground/70"
        />
      </motion.div>
    )
  }, [navState, isRightSidebarVisible])

  // Right sidebar CLOSE button (shown in sidebar header when open)
  const rightSidebarCloseButton = React.useMemo(() => {
    if (!isRightSidebarVisible) return null

    return (
      <HeaderIconButton
        icon={<PanelLeft className="h-4 w-4" />}
        onClick={() => setIsRightSidebarVisible(false)}

        className="text-foreground/70"
      />
    )
  }, [isRightSidebarVisible])

  // Extend context value with local overrides (textareaRef, wrapped onDeleteSession, sources, skills, labels, enabledModes, rightSidebarOpenButton, effectiveTodoStates, statusEnabled)
  const appShellContextValue = React.useMemo<AppShellContextType>(() => ({
    ...contextValue,
    onDeleteSession: handleDeleteSession,
    textareaRef: chatInputRef,
    enabledSources: sources,
    skills,
    labels: labelConfigs,
    onSessionLabelsChange: handleSessionLabelsChange,
    enabledModes,
    todoStates: effectiveTodoStates,
    statusEnabled,
    onSessionSourcesChange: handleSessionSourcesChange,
    rightSidebarButton: rightSidebarOpenButton,
    // Search state for ChatDisplay highlighting
    sessionListSearchQuery: searchActive ? searchQuery : undefined,
    isSearchModeActive: searchActive,
    chatDisplayRef,
    onChatMatchInfoChange: handleChatMatchInfoChange,
  }), [contextValue, handleDeleteSession, sources, skills, labelConfigs, handleSessionLabelsChange, enabledModes, effectiveTodoStates, statusEnabled, handleSessionSourcesChange, rightSidebarOpenButton, searchActive, searchQuery, handleChatMatchInfoChange])

  // Persist expanded folders to localStorage (workspace-scoped)
  React.useEffect(() => {
    if (!activeWorkspaceId) return
    storage.set(storage.KEYS.expandedFolders, [...expandedFolders], activeWorkspaceId)
  }, [expandedFolders, activeWorkspaceId])

  // Persist right sidebar visibility to localStorage
  React.useEffect(() => {
    storage.set(storage.KEYS.rightSidebarVisible, isRightSidebarVisible)
  }, [isRightSidebarVisible])

  // Persist view mode state to localStorage
  React.useEffect(() => {
    storage.set(storage.KEYS.viewMode, viewMode)
  }, [viewMode])

  // Listen for focus mode toggle from menu (View → Focus Mode) - now cycles view mode
  React.useEffect(() => {
    const cleanup = window.electronAPI.onMenuToggleFocusMode?.(() => {
      cycleViewMode()
    })
    return cleanup
  }, [cycleViewMode])

  // Listen for sidebar toggle from menu (View → Toggle Sidebar)
  React.useEffect(() => {
    const cleanup = window.electronAPI.onMenuToggleSidebar?.(() => {
      toggleSidebar()
    })
    return cleanup
  }, [toggleSidebar])

  // Persist per-view filter map to localStorage (workspace-scoped)
  React.useEffect(() => {
    if (!activeWorkspaceId) return
    storage.set(storage.KEYS.viewFilters, viewFiltersMap, activeWorkspaceId)
  }, [viewFiltersMap, activeWorkspaceId])

  // Persist sidebar section collapsed states (workspace-scoped)
  React.useEffect(() => {
    if (!activeWorkspaceId) return
    storage.set(storage.KEYS.collapsedSidebarItems, [...collapsedItems], activeWorkspaceId)
  }, [collapsedItems, activeWorkspaceId])

  const handleAllChatsClick = useCallback(() => {
    navigate(routes.view.allChats())
  }, [])

  const handleFlaggedClick = useCallback(() => {
    navigate(routes.view.flagged())
  }, [])

  // Handler for individual todo state views
  const handleTodoStateClick = useCallback((stateId: TodoStateId) => {
    navigate(routes.view.state(stateId))
  }, [])

  // Handler for label filter views (hierarchical — includes descendant labels)
  const handleLabelClick = useCallback((labelId: string) => {
    navigate(routes.view.label(labelId))
  }, [])

  const handleViewClick = useCallback((viewId: string) => {
    navigate(routes.view.view(viewId))
  }, [])

  // Handler for working directory filter views
  const handleWorkingDirClick = useCallback((workingDir: string) => {
    navigate(routes.view.workingDir(workingDir))
  }, [])

  // DnD handler: reorder statuses (flat list drag-and-drop)
  // Sets optimistic order immediately for instant UI feedback, then fires IPC.
  const handleStatusReorder = useCallback((orderedIds: string[]) => {
    if (!activeWorkspaceId) return
    setOptimisticStatusOrder(orderedIds)
    window.electronAPI.reorderStatuses(activeWorkspaceId, orderedIds)
  }, [activeWorkspaceId])

  // Handler for sources view (all sources)
  const handleSourcesClick = useCallback(() => {
    navigate(routes.view.sources())
  }, [])

  // Handlers for source type filter views (subcategories in Sources dropdown)
  const handleSourcesApiClick = useCallback(() => {
    navigate(routes.view.sourcesApi())
  }, [])

  const handleSourcesMcpClick = useCallback(() => {
    navigate(routes.view.sourcesMcp())
  }, [])

  const handleSourcesLocalClick = useCallback(() => {
    navigate(routes.view.sourcesLocal())
  }, [])

  // Handler for skills view
  const handleSkillsClick = useCallback(() => {
    navigate(routes.view.skills())
  }, [])

  // Handler for settings view
  const handleSettingsClick = useCallback((subpage: SettingsSubpage = 'app') => {
    navigate(routes.view.settings(subpage))
  }, [])

  // ============================================================================
  // EDIT POPOVER STATE
  // ============================================================================
  // State to control which EditPopover is open (triggered from context menus).
  // We use controlled popovers instead of deep links so the user can type
  // their request in the popover UI before opening a new chat window.
  // add-source variants: add-source (generic), add-source-api, add-source-mcp, add-source-local
  const [editPopoverOpen, setEditPopoverOpen] = useState<'statuses' | 'labels' | 'views' | 'add-source' | 'add-source-api' | 'add-source-mcp' | 'add-source-local' | 'add-skill' | 'add-label' | null>(null)

  // Stores the Y position of the last right-clicked sidebar item so the EditPopover
  // appears near it rather than at a fixed location. Updated synchronously before
  // the setTimeout that opens the popover, ensuring the ref is set before render.
  const editPopoverAnchorY = useRef<number>(120)
  // Tracks which label was right-clicked when opening label EditPopovers,
  // so the agent knows the target for commands like "make this red" or "add below this"
  const editLabelTargetId = useRef<string | undefined>(undefined)

  // Stores the trigger element (button) so we can keep it highlighted while the
  // EditPopover is open (after Radix removes data-state="open" on context menu close).
  const editPopoverTriggerRef = useRef<Element | null>(null)

  // Captures the bounding rect of the currently-open context menu trigger (the button).
  // Radix sets data-state="open" on the button (via ContextMenuTrigger asChild)
  // while the menu is visible, so we can locate it in the DOM at click time.
  const captureContextMenuPosition = useCallback(() => {
    const trigger = document.querySelector('.group\\/section > [data-state="open"]')
    if (trigger) {
      const rect = trigger.getBoundingClientRect()
      editPopoverAnchorY.current = rect.top
      editPopoverTriggerRef.current = trigger
    }
  }, [])

  // Sync data-edit-active attribute on the trigger element with EditPopover open state.
  // This keeps the sidebar item visually highlighted while the popover is shown,
  // since Radix's data-state="open" disappears when the context menu closes.
  useEffect(() => {
    const el = editPopoverTriggerRef.current
    if (!el) return
    if (editPopoverOpen) {
      el.setAttribute('data-edit-active', 'true')
    } else {
      el.removeAttribute('data-edit-active')
      editPopoverTriggerRef.current = null
    }
  }, [editPopoverOpen])

  // Handler for "Configure Statuses" context menu action
  // Opens the EditPopover for status configuration
  // Uses setTimeout to delay opening until after context menu closes,
  // preventing the popover from immediately closing due to focus shift
  const openConfigureStatuses = useCallback(() => {
    captureContextMenuPosition()
    setTimeout(() => setEditPopoverOpen('statuses'), 50)
  }, [captureContextMenuPosition])

  // Handler for "Configure Labels" context menu action
  // Opens the EditPopover for label configuration, storing which label was right-clicked
  const openConfigureLabels = useCallback((labelId?: string) => {
    editLabelTargetId.current = labelId
    captureContextMenuPosition()
    setTimeout(() => setEditPopoverOpen('labels'), 50)
  }, [captureContextMenuPosition])

  // Handler for "Edit Views" context menu action
  // Opens the EditPopover for view configuration
  const openConfigureViews = useCallback(() => {
    captureContextMenuPosition()
    setTimeout(() => setEditPopoverOpen('views'), 50)
  }, [captureContextMenuPosition])

  // Handler for "Delete View" context menu action
  // Removes the view from config by filtering it out and saving
  const handleDeleteView = useCallback(async (viewId: string) => {
    if (!activeWorkspace?.id) return
    try {
      const updated = viewConfigs.filter(v => v.id !== viewId)
      await window.electronAPI.saveViews(activeWorkspace.id, updated)
    } catch (err) {
      console.error('[AppShell] Failed to delete view:', err)
    }
  }, [activeWorkspace?.id, viewConfigs])

  // Handler for "Add New Label" context menu action
  // Opens the EditPopover with 'add-label' context, storing which label was right-clicked
  // so the agent knows to add the new label relative to it
  const handleAddLabel = useCallback((parentId?: string) => {
    editLabelTargetId.current = parentId
    captureContextMenuPosition()
    setTimeout(() => setEditPopoverOpen('add-label'), 50)
  }, [captureContextMenuPosition])

  // Handler for "Delete Label" context menu action
  // Deletes the label and all its descendants, stripping from sessions
  const handleDeleteLabel = useCallback(async (labelId: string) => {
    if (!activeWorkspace?.id) return
    try {
      await window.electronAPI.deleteLabel(activeWorkspace.id, labelId)
    } catch (err) {
      console.error('[AppShell] Failed to delete label:', err)
    }
  }, [activeWorkspace?.id])

  // Handler for "Add Source" context menu action
  // Opens the EditPopover for adding a new source
  // Optional sourceType param allows filter-aware context (from subcategory menus or filtered views)
  const openAddSource = useCallback((sourceType?: 'api' | 'mcp' | 'local') => {
    captureContextMenuPosition()
    const key = sourceType ? `add-source-${sourceType}` as const : 'add-source' as const
    setTimeout(() => setEditPopoverOpen(key), 50)
  }, [captureContextMenuPosition])

  // Handler for "Add Skill" context menu action
  // Opens the EditPopover for adding a new skill
  const openAddSkill = useCallback(() => {
    captureContextMenuPosition()
    setTimeout(() => setEditPopoverOpen('add-skill'), 50)
  }, [captureContextMenuPosition])

  // Create a new chat and select it
  // When in a workingDir filter view, default the new session to that working directory
  const handleNewChat = useCallback(async (_useCurrentAgent: boolean = true) => {
    if (!activeWorkspace) return

    // Exit search mode
    setSearchActive(false)
    setSearchQuery('')

    // If currently in a workingDir filter, create session with that working directory
    const createOptions: import('../../../shared/types').CreateSessionOptions = {}
    if (chatFilter?.kind === 'workingDir') {
      createOptions.workingDirectory = chatFilter.workingDir
    }

    const newSession = await onCreateSession(activeWorkspace.id, createOptions)

    // Navigate to the new session, preserving the workingDir filter context
    if (chatFilter?.kind === 'workingDir') {
      navigate(routes.view.workingDir(chatFilter.workingDir, newSession.id))
    } else {
      navigate(routes.view.allChats(newSession.id))
    }
    // Focus chat input after creating new session
    requestAnimationFrame(() => focusChatInput())
  }, [activeWorkspace, onCreateSession, focusChatInput, chatFilter])

  // Delete Source - simplified since agents system is removed
  const handleDeleteSource = useCallback(async (sourceSlug: string) => {
    if (!activeWorkspace) return
    try {
      await window.electronAPI.deleteSource(activeWorkspace.id, sourceSlug)
      toast.success(`Deleted source`)
    } catch (error) {
      console.error('[Chat] Failed to delete source:', error)
      toast.error('Failed to delete source')
    }
  }, [activeWorkspace])

  // Delete Skill
  const handleDeleteSkill = useCallback(async (skillSlug: string) => {
    if (!activeWorkspace) return
    try {
      await window.electronAPI.deleteSkill(activeWorkspace.id, skillSlug)
      toast.success(`Deleted skill: ${skillSlug}`)
    } catch (error) {
      console.error('[Chat] Failed to delete skill:', error)
      toast.error('Failed to delete skill')
    }
  }, [activeWorkspace])

  // Respond to menu bar "New Chat" trigger
  const menuTriggerRef = useRef(menuNewChatTrigger)
  useEffect(() => {
    // Skip initial render
    if (menuTriggerRef.current === menuNewChatTrigger) return
    menuTriggerRef.current = menuNewChatTrigger
    handleNewChat(true)
  }, [menuNewChatTrigger, handleNewChat])

  // Unified sidebar items: nav buttons only (agents system removed)
  type SidebarItem = {
    id: string
    type: 'nav'
    action?: () => void
  }

  const unifiedSidebarItems = React.useMemo((): SidebarItem[] => {
    const result: SidebarItem[] = []

    // 1. Chats section: All Chats (with working directories as children), Flagged, States header, States items
    result.push({ id: 'nav:allChats', type: 'nav', action: handleAllChatsClick })
    // Working directories are now children of All Chats
    for (const dir of workingDirGroups) {
      result.push({ id: `nav:workingDir:${dir.path}`, type: 'nav', action: () => handleWorkingDirClick(dir.path) })
    }
    result.push({ id: 'nav:flagged', type: 'nav', action: handleFlaggedClick })
    result.push({ id: 'nav:states', type: 'nav', action: handleAllChatsClick })
    for (const state of effectiveTodoStates) {
      result.push({ id: `nav:state:${state.id}`, type: 'nav', action: () => handleTodoStateClick(state.id) })
    }

    // 2. Labels section header + regular label tree for keyboard nav
    result.push({ id: 'nav:labels', type: 'nav', action: handleAllChatsClick })
    // Flatten regular label tree for keyboard navigation (depth-first)
    const flattenTree = (nodes: LabelTreeNode[]) => {
      for (const node of nodes) {
        if (node.label) {
          result.push({ id: `nav:label:${node.fullId}`, type: 'nav', action: () => handleLabelClick(node.fullId) })
        }
        if (node.children.length > 0) flattenTree(node.children)
      }
    }
    flattenTree(labelTree)

    // 3. Sources, Skills, Settings
    result.push({ id: 'nav:sources', type: 'nav', action: handleSourcesClick })
    result.push({ id: 'nav:skills', type: 'nav', action: handleSkillsClick })
    result.push({ id: 'nav:settings', type: 'nav', action: () => handleSettingsClick('app') })

    return result
  }, [handleAllChatsClick, handleFlaggedClick, handleTodoStateClick, effectiveTodoStates, handleLabelClick, labelConfigs, labelTree, viewConfigs, handleViewClick, workingDirGroups, handleWorkingDirClick, handleSourcesClick, handleSkillsClick, handleSettingsClick])

  // Toggle folder expanded state
  const handleToggleFolder = React.useCallback((path: string) => {
    setExpandedFolders(prev => {
      const next = new Set(prev)
      if (next.has(path)) {
        next.delete(path)
      } else {
        next.add(path)
      }
      return next
    })
  }, [])

  // Get props for any sidebar item (unified roving tabindex pattern)
  const getSidebarItemProps = React.useCallback((id: string) => ({
    tabIndex: focusedSidebarItemId === id ? 0 : -1,
    'data-focused': focusedSidebarItemId === id,
    ref: (el: HTMLElement | null) => {
      if (el) {
        sidebarItemRefs.current.set(id, el)
      } else {
        sidebarItemRefs.current.delete(id)
      }
    },
  }), [focusedSidebarItemId])

  // Unified sidebar keyboard navigation
  const handleSidebarKeyDown = React.useCallback((e: React.KeyboardEvent) => {
    if (!sidebarFocused || unifiedSidebarItems.length === 0) return

    const currentIndex = unifiedSidebarItems.findIndex(item => item.id === focusedSidebarItemId)
    const currentItem = currentIndex >= 0 ? unifiedSidebarItems[currentIndex] : null

    switch (e.key) {
      case 'ArrowDown': {
        e.preventDefault()
        const nextIndex = currentIndex < unifiedSidebarItems.length - 1 ? currentIndex + 1 : 0
        const nextItem = unifiedSidebarItems[nextIndex]
        setFocusedSidebarItemId(nextItem.id)
        sidebarItemRefs.current.get(nextItem.id)?.focus()
        break
      }
      case 'ArrowUp': {
        e.preventDefault()
        const prevIndex = currentIndex > 0 ? currentIndex - 1 : unifiedSidebarItems.length - 1
        const prevItem = unifiedSidebarItems[prevIndex]
        setFocusedSidebarItemId(prevItem.id)
        sidebarItemRefs.current.get(prevItem.id)?.focus()
        break
      }
      case 'ArrowLeft': {
        e.preventDefault()
        // At boundary - do nothing (Left doesn't change zones from sidebar)
        break
      }
      case 'ArrowRight': {
        e.preventDefault()
        // Move to next zone (session list)
        focusZone('session-list')
        break
      }
      case 'Enter':
      case ' ': {
        e.preventDefault()
        if (currentItem?.type === 'nav' && currentItem.action) {
          currentItem.action()
        }
        break
      }
      case 'Home': {
        e.preventDefault()
        if (unifiedSidebarItems.length > 0) {
          const firstItem = unifiedSidebarItems[0]
          setFocusedSidebarItemId(firstItem.id)
          sidebarItemRefs.current.get(firstItem.id)?.focus()
        }
        break
      }
      case 'End': {
        e.preventDefault()
        if (unifiedSidebarItems.length > 0) {
          const lastItem = unifiedSidebarItems[unifiedSidebarItems.length - 1]
          setFocusedSidebarItemId(lastItem.id)
          sidebarItemRefs.current.get(lastItem.id)?.focus()
        }
        break
      }
    }
  }, [sidebarFocused, unifiedSidebarItems, focusedSidebarItemId, focusZone])

  // Focus sidebar item when sidebar zone gains focus
  React.useEffect(() => {
    if (sidebarFocused && unifiedSidebarItems.length > 0) {
      // Set focused item if not already set
      const itemId = focusedSidebarItemId || unifiedSidebarItems[0].id
      if (!focusedSidebarItemId) {
        setFocusedSidebarItemId(itemId)
      }
      // Actually focus the DOM element
      requestAnimationFrame(() => {
        sidebarItemRefs.current.get(itemId)?.focus()
      })
    }
  }, [sidebarFocused, focusedSidebarItemId, unifiedSidebarItems])

  // Get title based on navigation state
  const listTitle = React.useMemo(() => {
    // Sources navigator
    if (isSourcesNavigation(navState)) {
      return 'Sources'
    }

    // Skills navigator
    if (isSkillsNavigation(navState)) {
      return 'All Skills'
    }

    // Settings navigator
    if (isSettingsNavigation(navState)) return 'Settings'

    // Chats navigator - use chatFilter
    if (!chatFilter) return 'All Chats'

    switch (chatFilter.kind) {
      case 'flagged':
        return 'Flagged'
      case 'state': {
        const state = effectiveTodoStates.find(s => s.id === chatFilter.stateId)
        return state?.label || 'All Chats'
      }
      case 'label':
        return chatFilter.labelId === '__all__' ? 'Labels' : getLabelDisplayName(labelConfigs, chatFilter.labelId)
      case 'view':
        return chatFilter.viewId === '__all__' ? 'Views' : viewConfigs.find(v => v.id === chatFilter.viewId)?.name || 'Views'
      case 'workingDir': {
        const dirName = chatFilter.workingDir.split('/').filter(Boolean).pop() || chatFilter.workingDir
        return dirName
      }
      default:
        return 'All Chats'
    }
  }, [navState, chatFilter, effectiveTodoStates, labelConfigs, viewConfigs])

  // Build recursive sidebar items from label tree.
  // Each node renders with condensed height (compact: true) since many labels expected.
  // Clicking any label navigates to its filter view; the chevron toggles expand/collapse.
  const buildLabelSidebarItems = useCallback((nodes: LabelTreeNode[]): any[] => {
    // Sort labels by associated session count (descending), then alphabetically as tiebreaker
    const sorted = [...nodes].sort((a, b) => {
      const countA = labelCounts[a.fullId] || 0
      const countB = labelCounts[b.fullId] || 0
      if (countA !== countB) return countB - countA
      const nameA = (a.label?.name || a.segment).toLowerCase()
      const nameB = (b.label?.name || b.segment).toLowerCase()
      return nameA.localeCompare(nameB)
    })
    return sorted.map(node => {
      const hasChildren = node.children.length > 0
      const isActive = chatFilter?.kind === 'label' && chatFilter.labelId === node.fullId
      const count = labelCounts[node.fullId] || 0

      const item: any = {
        id: `nav:label:${node.fullId}`,
        title: node.label?.name || node.segment.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' '),
        label: count > 0 ? String(count) : undefined,
        // Show label type icon (Hash/Calendar/Type) right-aligned before count, with tooltip explaining the type
        afterTitle: node.label?.valueType ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="flex items-center"><LabelValueTypeIcon valueType={node.label.valueType} size={10} /></span>
            </TooltipTrigger>
            <TooltipContent side="top" className="text-xs">
              This label can have a {node.label.valueType} value
            </TooltipContent>
          </Tooltip>
        ) : undefined,
        icon: node.label && activeWorkspace?.id ? (
          <LabelIcon
            label={node.label}
            size="sm"
            hasChildren={hasChildren}
          />
        ) : <Tag className="h-3.5 w-3.5" />,
        variant: isActive ? "default" : "ghost",
        compact: true, // Reduced height for label items (many labels expected)
        // All labels navigate on click — parent and leaf alike
        onClick: () => handleLabelClick(node.fullId),
        contextMenu: {
          type: 'labels' as const,
          labelId: node.fullId,
          onConfigureLabels: openConfigureLabels,
          onAddLabel: handleAddLabel,
          onDeleteLabel: handleDeleteLabel,
        },
      }

      if (hasChildren) {
        item.expandable = true
        item.expanded = isExpanded(`nav:label:${node.fullId}`)
        // Chevron toggles expand/collapse independently of navigation
        item.onToggle = () => toggleExpanded(`nav:label:${node.fullId}`)
        item.items = buildLabelSidebarItems(node.children)
      }

      return item
    })
  }, [chatFilter, labelCounts, activeWorkspace?.id, handleLabelClick, isExpanded, toggleExpanded, openConfigureLabels, handleAddLabel, handleDeleteLabel])

  const menuLeftOffset = isMac ? 86 : 12

  return (
    <AppShellProvider value={appShellContextValue}>
      <TooltipProvider delayDuration={0}>
        {/*
          Draggable title bar region for transparent window (macOS)
          - Fixed overlay at z-titlebar allows window dragging from the top bar area
          - Interactive elements (buttons, dropdowns) must use:
            1. titlebar-no-drag: prevents drag behavior on clickable elements
            2. relative z-panel: ensures elements render above this drag overlay
        */}
        <div className="titlebar-drag-region fixed top-0 left-0 right-0 h-[50px] z-titlebar" />

        {/* App Menu - fixed position, fades out in compact/focused mode
          On macOS: offset 86px to avoid stoplight controls
          On Windows/Linux: offset 12px (no stoplight controls) */}
        <div
          className="fixed top-0 h-[50px] z-overlay flex items-center titlebar-no-drag pr-2"
          style={{ left: menuLeftOffset }}
        >
          <AppMenu
            onNewChat={() => handleNewChat(true)}
            onNewWindow={() => window.electronAPI.menuNewWindow()}
            onOpenSettings={onOpenSettings}
            onOpenSettingsSubpage={handleSettingsClick}
            onOpenKeyboardShortcuts={onOpenKeyboardShortcuts}
            onOpenStoredUserPreferences={onOpenStoredUserPreferences}
            onBack={goBack}
            onForward={goForward}
            canGoBack={canGoBack}
            canGoForward={canGoForward}
            onToggleSidebar={toggleSidebar}
            onToggleFocusMode={cycleViewMode}
            onCycleViewMode={cycleViewMode}
            viewMode={viewMode}
          />
        </div>

        {/* === OUTER LAYOUT: Sidebar | Main Content === */}
        <div className="h-full flex items-stretch relative">
          {/* === SIDEBAR (Left) ===
            Animated width with spring physics for smooth 60-120fps transitions.
            Uses overflow-hidden to clip content during collapse animation.
            Resizable via drag handle on right edge (200-400px range). */}
          <motion.div
            initial={false}
            animate={{
              width: isSidebarVisible ? sidebarWidth : 0,
              opacity: isSidebarVisible ? 1 : 0,
            }}
            transition={isResizing ? { duration: 0 } : springTransition}
            className="h-full overflow-hidden shrink-0 relative"
          >
            <div
              ref={sidebarRef}
              style={{ width: sidebarWidth }}
              className="h-full font-sans relative"
              data-focus-zone="sidebar"
              tabIndex={sidebarFocused ? 0 : -1}
              onKeyDown={handleSidebarKeyDown}
            >
              <div className="flex h-full flex-col pt-[50px] select-none">
                {/* Sidebar Top Section */}
                <div className="flex-1 flex flex-col min-h-0">
                  {/* New Chat Button - Gmail-style, with context menu for "Open in New Window" */}
                  <div className="px-2 pt-1 pb-2 shrink-0">
                    <ContextMenu modal={true}>
                      <ContextMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          onClick={() => handleNewChat(true)}
                          className="w-full justify-start gap-2 py-[7px] px-2 text-[13px] font-normal rounded-[6px] shadow-minimal bg-background"
                          data-tutorial="new-chat-button"
                        >
                          <SquarePenRounded className="h-3.5 w-3.5 shrink-0" />
                          New Chat
                        </Button>
                      </ContextMenuTrigger>
                      <StyledContextMenuContent>
                        <ContextMenuProvider>
                          <SidebarMenu type="newChat" />
                        </ContextMenuProvider>
                      </StyledContextMenuContent>
                    </ContextMenu>
                  </div>
                  {/* Primary Nav: All Chats, Flagged, States, Labels | Sources, Skills | Settings */}
                  {/* pb-4 provides clearance so the last item scrolls above the mask-fade-bottom gradient */}
                  <div className="flex-1 overflow-y-auto min-h-0 mask-fade-bottom pb-4">
                    <LeftSidebar
                      isCollapsed={false}
                      getItemProps={getSidebarItemProps}
                      focusedItemId={focusedSidebarItemId}
                      links={[
                        // --- Chats Section ---
                        // All Chats: expandable section with working directory sub-items
                        {
                          id: "nav:allChats",
                          title: "All Chats",
                          label: String(workspaceSessionMetas.length),
                          icon: Inbox,
                          variant: chatFilter?.kind === 'allChats' ? "default" : "ghost",
                          onClick: handleAllChatsClick,
                          // Only show expand/collapse if there are working directories
                          ...(workingDirGroups.length > 0 ? {
                            expandable: true,
                            expanded: isExpanded('nav:allChats'),
                            onToggle: () => toggleExpanded('nav:allChats'),
                            items: workingDirGroups.map(dir => ({
                              id: `nav:workingDir:${dir.path}`,
                              title: dir.displayName,
                              label: String(dir.count),
                              icon: FolderOpen,
                              compact: true,
                              variant: (chatFilter?.kind === 'workingDir' && chatFilter.workingDir === dir.path ? "default" : "ghost") as "default" | "ghost",
                              onClick: () => handleWorkingDirClick(dir.path),
                            })),
                          } : {}),
                        },
                        {
                          id: "nav:flagged",
                          title: "Flagged",
                          label: String(flaggedCount),
                          icon: <Flag className="h-3.5 w-3.5" />,
                          variant: chatFilter?.kind === 'flagged' ? "default" : "ghost",
                          onClick: handleFlaggedClick,
                        },
                        // States: expandable section with status sub-items (drag-and-drop reorder)
                        // Only show if statusEnabled is true
                        ...(statusEnabled ? [{
                          id: "nav:states" as const,
                          title: "Status",
                          icon: CheckCircle2,
                          variant: "ghost" as const,
                          onClick: () => toggleExpanded('nav:states'),
                          expandable: true,
                          expanded: isExpanded('nav:states'),
                          onToggle: () => toggleExpanded('nav:states'),
                          contextMenu: {
                            type: 'allChats' as const,
                            onConfigureStatuses: openConfigureStatuses,
                          },
                          // Enable flat DnD reorder for status items
                          sortable: { onReorder: handleStatusReorder },
                          items: effectiveTodoStates.map(state => ({
                            id: `nav:state:${state.id}`,
                            title: state.label,
                            label: String(todoStateCounts[state.id] || 0),
                            icon: state.icon,
                            iconColor: state.resolvedColor,
                            iconColorable: state.iconColorable,
                            variant: (chatFilter?.kind === 'state' && chatFilter.stateId === state.id ? "default" : "ghost") as "default" | "ghost",
                            onClick: () => handleTodoStateClick(state.id),
                            contextMenu: {
                              type: 'status' as const,
                              statusId: state.id,
                              onConfigureStatuses: openConfigureStatuses,
                            },
                          })),
                        }] : []),
                        // Labels: navigable header (shows all labeled sessions) + hierarchical tree (drag-and-drop reorder + re-parent)
                        {
                          id: "nav:labels",
                          title: "Labels",
                          icon: Tag,
                          // Only highlighted when "Labels" itself is selected (not sub-labels)
                          variant: (chatFilter?.kind === 'label' && chatFilter.labelId === '__all__') ? "default" as const : "ghost" as const,
                          // Clicking navigates to "all labeled sessions" view
                          onClick: () => handleLabelClick('__all__'),
                          expandable: true,
                          expanded: isExpanded('nav:labels'),
                          onToggle: () => toggleExpanded('nav:labels'),
                          contextMenu: {
                            type: 'labels' as const,
                            onConfigureLabels: openConfigureLabels,
                            onAddLabel: handleAddLabel,
                          },
                          items: buildLabelSidebarItems(labelTree),
                        },
                        // --- Separator ---
                        { id: "separator:chats-sources", type: "separator" },
                        // --- Sources & Skills Section ---
                        {
                          id: "nav:sources",
                          title: "Sources",
                          label: String(sources.length),
                          icon: DatabaseZap,
                          variant: (isSourcesNavigation(navState) && !sourceFilter) ? "default" : "ghost",
                          onClick: handleSourcesClick,
                          dataTutorial: "sources-nav",
                          expandable: true,
                          expanded: isExpanded('nav:sources'),
                          onToggle: () => toggleExpanded('nav:sources'),
                          contextMenu: {
                            type: 'sources',
                            onAddSource: () => openAddSource(),
                          },
                          items: [
                            {
                              id: "nav:sources:api",
                              title: "APIs",
                              label: String(sourceTypeCounts.api),
                              icon: Globe,
                              variant: (sourceFilter?.kind === 'type' && sourceFilter.sourceType === 'api') ? "default" : "ghost",
                              onClick: handleSourcesApiClick,
                              contextMenu: {
                                type: 'sources' as const,
                                onAddSource: () => openAddSource('api'),
                                sourceType: 'api',
                              },
                            },
                            {
                              id: "nav:sources:mcp",
                              title: "MCPs",
                              label: String(sourceTypeCounts.mcp),
                              icon: <McpIcon className="h-3.5 w-3.5" />,
                              variant: (sourceFilter?.kind === 'type' && sourceFilter.sourceType === 'mcp') ? "default" : "ghost",
                              onClick: handleSourcesMcpClick,
                              contextMenu: {
                                type: 'sources' as const,
                                onAddSource: () => openAddSource('mcp'),
                                sourceType: 'mcp',
                              },
                            },
                            {
                              id: "nav:sources:local",
                              title: "Local Folders",
                              label: String(sourceTypeCounts.local),
                              icon: FolderOpen,
                              variant: (sourceFilter?.kind === 'type' && sourceFilter.sourceType === 'local') ? "default" : "ghost",
                              onClick: handleSourcesLocalClick,
                              contextMenu: {
                                type: 'sources' as const,
                                onAddSource: () => openAddSource('local'),
                                sourceType: 'local',
                              },
                            },
                          ],
                        },
                        {
                          id: "nav:skills",
                          title: "Skills",
                          label: String(skills.length),
                          icon: Zap,
                          variant: isSkillsNavigation(navState) ? "default" : "ghost",
                          onClick: handleSkillsClick,
                          contextMenu: {
                            type: 'skills',
                            onAddSkill: openAddSkill,
                          },
                        },
                        // --- Separator ---
                        { id: "separator:skills-settings", type: "separator" },
                        // --- Settings ---
                        {
                          id: "nav:settings",
                          title: "Settings",
                          icon: Settings,
                          variant: isSettingsNavigation(navState) ? "default" : "ghost",
                          onClick: () => handleSettingsClick('app'),
                        },
                      ]}
                    />
                    {/* Agent Tree: Hierarchical list of agents */}
                    {/* Agents section removed */}
                  </div>
                </div>

                {/* Sidebar Bottom Section: WorkspaceSwitcher + Help icon */}
                <div className="mt-auto shrink-0 py-2 px-2">
                  <div className="flex items-center gap-1">
                    {/* Workspace switcher takes available space */}
                    <div className="flex-1 min-w-0">
                      <WorkspaceSwitcher
                        isCollapsed={false}
                        workspaces={workspaces}
                        activeWorkspaceId={activeWorkspaceId}
                        onSelect={onSelectWorkspace}
                        onWorkspaceCreated={() => onRefreshWorkspaces?.()}
                      />
                    </div>
                    {/* Help button - icon only with tooltip */}
                    <DropdownMenu>
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <DropdownMenuTrigger asChild>
                              <button
                                className="flex items-center justify-center h-7 w-7 rounded-[6px] select-none outline-none hover:bg-foreground/5 focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring"
                              >
                                <HelpCircle className="h-4 w-4 text-foreground/60" />
                              </button>
                            </DropdownMenuTrigger>
                          </TooltipTrigger>
                          <TooltipContent side="top">Help & Documentation</TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                      <StyledDropdownMenuContent align="end" side="top" sideOffset={8}>
                        <StyledDropdownMenuItem onClick={() => window.electronAPI.openUrl(getDocUrl('sources'))}>
                          <DatabaseZap className="h-3.5 w-3.5" />
                          <span className="flex-1">Sources</span>
                          <ExternalLink className="h-3 w-3 text-muted-foreground" />
                        </StyledDropdownMenuItem>
                        <StyledDropdownMenuItem onClick={() => window.electronAPI.openUrl(getDocUrl('skills'))}>
                          <Zap className="h-3.5 w-3.5" />
                          <span className="flex-1">Skills</span>
                          <ExternalLink className="h-3 w-3 text-muted-foreground" />
                        </StyledDropdownMenuItem>
                        <StyledDropdownMenuItem onClick={() => window.electronAPI.openUrl(getDocUrl('statuses'))}>
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          <span className="flex-1">Statuses</span>
                          <ExternalLink className="h-3 w-3 text-muted-foreground" />
                        </StyledDropdownMenuItem>
                        <StyledDropdownMenuItem onClick={() => window.electronAPI.openUrl(getDocUrl('permissions'))}>
                          <Settings className="h-3.5 w-3.5" />
                          <span className="flex-1">Permissions</span>
                          <ExternalLink className="h-3 w-3 text-muted-foreground" />
                        </StyledDropdownMenuItem>
                        <StyledDropdownMenuSeparator />
                        <StyledDropdownMenuItem onClick={() => window.electronAPI.openUrl('https://agents.craft.do/docs')}>
                          <ExternalLink className="h-3.5 w-3.5" />
                          <span className="flex-1">All Documentation</span>
                        </StyledDropdownMenuItem>
                      </StyledDropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
              </div>
            </div>
          </motion.div>

          {/* Sidebar Resize Handle (hidden in focused mode) */}
          {!effectiveFocusMode && (
            <div
              ref={resizeHandleRef}
              onMouseDown={(e) => { e.preventDefault(); setIsResizing('sidebar') }}
              onMouseMove={(e) => {
                if (resizeHandleRef.current) {
                  const rect = resizeHandleRef.current.getBoundingClientRect()
                  setSidebarHandleY(e.clientY - rect.top)
                }
              }}
              onMouseLeave={() => { if (!isResizing) setSidebarHandleY(null) }}
              className="absolute top-0 w-3 h-full cursor-col-resize z-panel flex justify-center"
              style={{
                left: isSidebarVisible ? sidebarWidth - 6 : -6,
                transition: isResizing === 'sidebar' ? undefined : 'left 0.15s ease-out',
              }}
            >
              {/* Visual indicator - 2px wide */}
              <div
                className="w-0.5 h-full"
                style={getResizeGradientStyle(sidebarHandleY)}
              />
            </div>
          )}

          {/* === MAIN CONTENT (Right) ===
            Flex layout: Session List | Chat Display */}
          <div
            className="flex-1 overflow-hidden min-w-0 flex h-full"
            style={{ padding: PANEL_WINDOW_EDGE_SPACING, gap: PANEL_PANEL_SPACING / 2 }}
          >
            {/* === SESSION LIST PANEL ===
              Animated width with spring physics for smooth 60-120fps transitions.
              Outer motion.div animates width (clipping mask), inner div maintains fixed width
              so content doesn't reflow during animation - same pattern as left sidebar. */}
            <motion.div
              initial={false}
              animate={{
                width: effectiveFocusMode ? 0 : sessionListWidth,
                opacity: effectiveFocusMode ? 0 : 1,
              }}
              transition={isResizing ? { duration: 0 } : springTransition}
              className="h-full shrink-0 overflow-hidden"
            >
              <div
                style={{ width: sessionListWidth }}
                className="h-full flex flex-col min-w-0 bg-background shadow-middle rounded-l-[14px] rounded-r-[10px]"
              >
                <PanelHeader
                  title={(isSidebarVisible && !effectiveCompactMode) ? listTitle : undefined}
                  compensateForStoplight={effectiveCompactMode || !isSidebarVisible}
                  actions={
                    <>
                      {/* Filter dropdown - available in ALL chat views.
                      Shows user-added filters (removable) and pinned filters (non-removable, derived from route).
                      Pinned filters: state views pin a status, label views pin a label, flagged pins the flag. */}
                      {isChatsNavigation(navState) && (
                        <DropdownMenu onOpenChange={(open) => { if (!open) setFilterDropdownQuery('') }}>
                          <DropdownMenuTrigger asChild>
                            <HeaderIconButton
                              icon={<ListFilter className="h-4 w-4" />}
                              className={(listFilter.size > 0 || labelFilter.size > 0) ? "bg-accent/5 text-accent rounded-[8px] shadow-tinted" : "rounded-[8px]"}
                              style={(listFilter.size > 0 || labelFilter.size > 0) ? { '--shadow-color': 'var(--accent-rgb)' } as React.CSSProperties : undefined}
                            />
                          </DropdownMenuTrigger>
                          <StyledDropdownMenuContent
                            align="end"
                            light
                            minWidth="min-w-[200px]"
                            onKeyDown={(e: React.KeyboardEvent) => {
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
                          >
                            {/* Header with title and clear button (only clears user-added filters, never pinned) */}
                            <div className="flex items-center justify-between px-2 py-1.5">
                              <span className="text-xs font-medium text-muted-foreground">Filter Chats</span>
                              {(listFilter.size > 0 || labelFilter.size > 0) && (
                                <button
                                  onClick={(e) => {
                                    e.preventDefault()
                                    setListFilter(new Map())
                                    setLabelFilter(new Map())
                                  }}
                                  className="text-xs text-muted-foreground hover:text-foreground"
                                >
                                  Clear
                                </button>
                              )}
                            </div>

                            {/* Search input — typing switches from hierarchical submenus to a flat filtered list.
                            stopPropagation prevents Radix from intercepting keys. Arrow/Enter handled for navigation. */}
                            <div className="px-1 pb-3 border-b border-foreground/5">
                              <div className="bg-background rounded-[6px] shadow-minimal px-2 py-1.5">
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
                                        ; (e.target as HTMLInputElement).blur()
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
                                        const idx = filterDropdownSelectedIdx
                                        if (idx < ms.length) {
                                          // Toggle a status filter
                                          const state = ms[idx]
                                          if (state.id !== pinnedFilters.pinnedStatusId) {
                                            setListFilter(prev => {
                                              const next = new Map(prev)
                                              if (next.has(state.id)) next.delete(state.id)
                                              else next.set(state.id, 'include')
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
                                              else next.set(item.id, 'include')
                                              return next
                                            })
                                          }
                                        }
                                        break
                                      }
                                    }
                                  }}
                                  placeholder="Search statuses & labels..."
                                  className="w-full bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none"
                                  autoFocus
                                />
                              </div>
                            </div>

                            {/* ── Conditional body: hierarchical (no query) vs flat filtered list (has query) ── */}
                            {filterDropdownQuery.trim() === '' ? (
                              <>
                                {/* === HIERARCHICAL MODE (default) === */}

                                {/* Active filter chips: pinned (non-removable) + user-added (removable) */}
                                {(pinnedFilters.pinnedFlagged || pinnedFilters.pinnedStatusId || pinnedFilters.pinnedLabelId || listFilter.size > 0 || labelFilter.size > 0) && (
                                  <>
                                    {/* Pinned: flagged */}
                                    {pinnedFilters.pinnedFlagged && (
                                      <StyledDropdownMenuItem disabled>
                                        <FilterMenuRow
                                          icon={<Flag className="h-3.5 w-3.5" />}
                                          label="Flagged"
                                          accessory={<Check className="h-3 w-3 text-muted-foreground" />}
                                        />
                                      </StyledDropdownMenuItem>
                                    )}
                                    {/* Pinned: status from state view */}
                                    {(() => {
                                      if (!pinnedFilters.pinnedStatusId) return null
                                      const state = effectiveTodoStates.find(s => s.id === pinnedFilters.pinnedStatusId)
                                      if (!state) return null
                                      return (
                                        <StyledDropdownMenuItem disabled key={`pinned-status-${state.id}`}>
                                          <FilterMenuRow
                                            icon={state.icon}
                                            label={state.label}
                                            accessory={<Check className="h-3 w-3 text-muted-foreground" />}
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
                                            icon={<LabelIcon label={label} size="sm" />}
                                            label={label.name}
                                            accessory={<Check className="h-3 w-3 text-muted-foreground" />}
                                          />
                                        </StyledDropdownMenuItem>
                                      )
                                    })()}
                                    {/* User-added: selected statuses with mode pill (include/exclude) */}
                                    {effectiveTodoStates.filter(s => listFilter.has(s.id)).map(state => {
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
                                              icon={<LabelIcon label={label} size="sm" />}
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
                                    <StyledDropdownMenuSeparator />
                                  </>
                                )}

                                {/* Statuses submenu - hierarchical with toggle selection */}
                                <DropdownMenuSub>
                                  <StyledDropdownMenuSubTrigger>
                                    <Inbox className="h-3.5 w-3.5" />
                                    <span className="flex-1">Statuses</span>
                                  </StyledDropdownMenuSubTrigger>
                                  <StyledDropdownMenuSubContent minWidth="min-w-[180px]">
                                    {effectiveTodoStates.map(state => {
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
                                        <StyledDropdownMenuItem
                                          key={state.id}
                                          disabled={isPinned}
                                          onClick={(e) => {
                                            if (isPinned) return
                                            e.preventDefault()
                                            setListFilter(prev => {
                                              const next = new Map(prev)
                                              if (next.has(state.id)) next.delete(state.id)
                                              else next.set(state.id, 'include')
                                              return next
                                            })
                                          }}
                                        >
                                          <FilterMenuRow
                                            icon={state.icon}
                                            label={state.label}
                                            accessory={isPinned ? <Check className="h-3 w-3 text-muted-foreground" /> : null}
                                            iconStyle={applyColor ? { color: state.resolvedColor } : undefined}
                                            noIconContainer
                                          />
                                        </StyledDropdownMenuItem>
                                      )
                                    })}
                                  </StyledDropdownMenuSubContent>
                                </DropdownMenuSub>

                                {/* Labels submenu - hierarchical tree with recursive submenus */}
                                <DropdownMenuSub>
                                  <StyledDropdownMenuSubTrigger>
                                    <Tag className="h-3.5 w-3.5" />
                                    <span className="flex-1">Labels</span>
                                  </StyledDropdownMenuSubTrigger>
                                  <StyledDropdownMenuSubContent minWidth="min-w-[180px]">
                                    {labelConfigs.length === 0 ? (
                                      <StyledDropdownMenuItem disabled>
                                        <span className="text-muted-foreground">No labels configured</span>
                                      </StyledDropdownMenuItem>
                                    ) : (
                                      <FilterLabelItems
                                        labels={labelConfigs}
                                        labelFilter={labelFilter}
                                        setLabelFilter={setLabelFilter}
                                        pinnedLabelId={pinnedFilters.pinnedLabelId}
                                      />
                                    )}
                                  </StyledDropdownMenuSubContent>
                                </DropdownMenuSub>

                                <StyledDropdownMenuSeparator />
                                <StyledDropdownMenuItem
                                  onClick={() => {
                                    setSearchActive(true)
                                  }}
                                >
                                  <Search className="h-3.5 w-3.5" />
                                  <span className="flex-1">Search</span>
                                </StyledDropdownMenuItem>
                              </>
                            ) : (
                              <>
                                {/* === FLAT FILTERED MODE (has query) ===
                                Uses the same filter/score logic as the # inline menu.
                                Shows matching statuses and labels in a single flat list.
                                Supports keyboard navigation (ArrowUp/Down/Enter in input). */}
                                {filterDropdownResults.states.length === 0 && filterDropdownResults.labels.length === 0 ? (
                                  <div className="px-3 py-4 text-center text-xs text-muted-foreground">
                                    No matching statuses or labels
                                  </div>
                                ) : (
                                  <div ref={filterDropdownListRef} className="max-h-[240px] overflow-y-auto py-1">
                                    {/* Matched statuses */}
                                    {filterDropdownResults.states.length > 0 && (
                                      <>
                                        <div className="px-3 pt-1.5 pb-1 text-[11px] font-medium text-muted-foreground/60 uppercase tracking-wider">
                                          Statuses
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
                                                  className={cn("mx-1", isHighlighted && "bg-foreground/5")}
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
                                            <div
                                              key={`flat-status-${state.id}`}
                                              data-filter-selected={isHighlighted}
                                              onMouseEnter={() => setFilterDropdownSelectedIdx(index)}
                                              onClick={(e) => {
                                                if (isPinned) return
                                                e.preventDefault()
                                                setListFilter(prev => {
                                                  const next = new Map(prev)
                                                  if (next.has(state.id)) next.delete(state.id)
                                                  else next.set(state.id, 'include')
                                                  return next
                                                })
                                              }}
                                              className={cn(
                                                // SVG sizing matches StyledDropdownMenuSubTrigger so icons render at the same size
                                                "flex cursor-pointer select-none items-center gap-2 rounded-[4px] mx-1 px-2 py-1.5 text-sm [&_svg:not([class*='size-'])]:size-4 [&_svg]:shrink-0",
                                                isHighlighted && "bg-foreground/5",
                                                isPinned && "opacity-50 pointer-events-none",
                                              )}
                                            >
                                              <FilterMenuRow
                                                icon={state.icon}
                                                label={state.label}
                                                accessory={isPinned ? <Check className="h-3 w-3 text-muted-foreground" /> : null}
                                                iconStyle={applyColor ? { color: state.resolvedColor } : undefined}
                                                noIconContainer
                                              />
                                            </div>
                                          )
                                        })}
                                      </>
                                    )}
                                    {/* Separator between sections */}
                                    {filterDropdownResults.states.length > 0 && filterDropdownResults.labels.length > 0 && (
                                      <div className="my-1 mx-2 border-t border-border/40" />
                                    )}
                                    {/* Matched labels — flat list with parent breadcrumbs */}
                                    {filterDropdownResults.labels.length > 0 && (
                                      <>
                                        <div className="px-3 pt-1.5 pb-1 text-[11px] font-medium text-muted-foreground/60 uppercase tracking-wider">
                                          Labels
                                        </div>
                                        {filterDropdownResults.labels.map((item, index) => {
                                          // Offset by state count for unified index
                                          const flatIndex = filterDropdownResults.states.length + index
                                          const isPinned = item.id === pinnedFilters.pinnedLabelId
                                          const currentMode = labelFilter.get(item.id)
                                          const isHighlighted = flatIndex === filterDropdownSelectedIdx
                                          const isActive = !!currentMode && !isPinned
                                          const labelDisplay = item.parentPath
                                            ? <><span className="text-muted-foreground">{item.parentPath}</span>{item.label}</>
                                            : item.label
                                          // Active label → DropdownMenuSub with mode options
                                          if (isActive) {
                                            return (
                                              <DropdownMenuSub key={`flat-label-${item.id}`}>
                                                <StyledDropdownMenuSubTrigger
                                                  data-filter-selected={isHighlighted}
                                                  onMouseEnter={() => setFilterDropdownSelectedIdx(flatIndex)}
                                                  className={cn("mx-1", isHighlighted && "bg-foreground/5")}
                                                  onClick={(e) => { e.preventDefault(); setLabelFilter(prev => { const next = new Map(prev); next.delete(item.id); return next }) }}
                                                >
                                                  <FilterMenuRow
                                                    icon={<LabelIcon label={item.config} size="sm" />}
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
                                            <div
                                              key={`flat-label-${item.id}`}
                                              data-filter-selected={isHighlighted}
                                              onMouseEnter={() => setFilterDropdownSelectedIdx(flatIndex)}
                                              onClick={(e) => {
                                                if (isPinned) return
                                                e.preventDefault()
                                                setLabelFilter(prev => {
                                                  const next = new Map(prev)
                                                  if (next.has(item.id)) next.delete(item.id)
                                                  else next.set(item.id, 'include')
                                                  return next
                                                })
                                              }}
                                              className={cn(
                                                // SVG sizing matches StyledDropdownMenuSubTrigger so icons render at the same size
                                                "flex cursor-pointer select-none items-center gap-2 rounded-[4px] mx-1 px-2 py-1.5 text-sm [&_svg:not([class*='size-'])]:size-4 [&_svg]:shrink-0",
                                                isHighlighted && "bg-foreground/5",
                                                isPinned && "opacity-50 pointer-events-none",
                                              )}
                                            >
                                              <FilterMenuRow
                                                icon={<LabelIcon label={item.config} size="sm" />}
                                                label={labelDisplay}
                                                accessory={isPinned ? <Check className="h-3 w-3 text-muted-foreground" /> : null}
                                              />
                                            </div>
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
                      )}
                      {/* Add Source button (only for sources mode) - uses filter-aware edit config */}
                      {isSourcesNavigation(navState) && activeWorkspace && (
                        <EditPopover
                          trigger={
                            <HeaderIconButton
                              icon={<Plus className="h-4 w-4" />}
                              tooltip="Add Source"
                              data-tutorial="add-source-button"
                            />
                          }
                          {...getEditConfig(
                            sourceFilter?.kind === 'type' ? `add-source-${sourceFilter.sourceType}` as EditContextKey : 'add-source',
                            activeWorkspace.rootPath
                          )}
                        />
                      )}
                      {/* Add Skill button (only for skills mode) */}
                      {isSkillsNavigation(navState) && activeWorkspace && (
                        <EditPopover
                          trigger={
                            <HeaderIconButton
                              icon={<Plus className="h-4 w-4" />}
                              tooltip="Add Skill"
                              data-tutorial="add-skill-button"
                            />
                          }
                          {...getEditConfig('add-skill', activeWorkspace.rootPath)}
                        />
                      )}
                      {/* Skill Market button (only for skills mode) */}
                      {isSkillsNavigation(navState) && (
                        <HeaderIconButton
                          icon={<Store className="h-4 w-4" />}
                          tooltip="Skill Market"
                          onClick={() => window.electronAPI.openUrl('https://skillsmp.com/zh')}
                        />
                      )}
                    </>
                  }
                />
                {/* Content: SessionList, SourcesListPanel, or SettingsNavigator based on navigation state */}
                {isSourcesNavigation(navState) && (
                  /* Sources List - filtered by type if sourceFilter is active */
                  <SourcesListPanel
                    sources={sources}
                    sourceFilter={sourceFilter}
                    workspaceRootPath={activeWorkspace?.rootPath}
                    onDeleteSource={handleDeleteSource}
                    onSourceClick={handleSourceSelect}
                    selectedSourceSlug={isSourcesNavigation(navState) && navState.details ? navState.details.sourceSlug : null}
                    localMcpEnabled={localMcpEnabled}
                  />
                )}
                {isSkillsNavigation(navState) && activeWorkspaceId && (
                  /* Skills List */
                  <SkillsListPanel
                    skills={skills}
                    workspaceId={activeWorkspaceId}
                    workspaceRootPath={activeWorkspace?.rootPath}
                    onSkillClick={handleSkillSelect}
                    onDeleteSkill={handleDeleteSkill}
                    selectedSkillSlug={isSkillsNavigation(navState) && navState.details?.type === 'skill' ? navState.details.skillSlug : null}
                  />
                )}
                {isSettingsNavigation(navState) && (
                  /* Settings Navigator */
                  <SettingsNavigator
                    selectedSubpage={navState.subpage}
                    onSelectSubpage={(subpage) => handleSettingsClick(subpage)}
                  />
                )}
                {isChatsNavigation(navState) && (
                  /* Sessions List */
                  <>
                    {/* SessionList: Scrollable list of session cards */}
                    {/* Key on sidebarMode forces full remount when switching views, skipping animations */}
                    <SessionList
                      key={chatFilter?.kind}
                      items={searchActive ? workspaceSessionMetas : filteredSessionMetas}
                      onDelete={handleDeleteSession}
                      onFlag={onFlagSession}
                      onUnflag={onUnflagSession}
                      onMarkUnread={onMarkSessionUnread}
                      onTodoStateChange={onTodoStateChange}
                      onRename={onRenameSession}
                      onFocusChatInput={focusChatInput}
                      onSessionSelect={(selectedMeta) => {
                        // Navigate to the session via central routing (with filter context)
                        if (!chatFilter || chatFilter.kind === 'allChats') {
                          navigate(routes.view.allChats(selectedMeta.id))
                        } else if (chatFilter.kind === 'flagged') {
                          navigate(routes.view.flagged(selectedMeta.id))
                        } else if (chatFilter.kind === 'state') {
                          navigate(routes.view.state(chatFilter.stateId, selectedMeta.id))
                        } else if (chatFilter.kind === 'label') {
                          navigate(routes.view.label(chatFilter.labelId, selectedMeta.id))
                        } else if (chatFilter.kind === 'view') {
                          navigate(routes.view.view(chatFilter.viewId, selectedMeta.id))
                        }
                      }}
                      onOpenInNewWindow={(selectedMeta) => {
                        if (activeWorkspaceId) {
                          window.electronAPI.openSessionInNewWindow(activeWorkspaceId, selectedMeta.id)
                        }
                      }}
                      onNavigateToView={(view) => {
                        if (view === 'allChats') {
                          navigate(routes.view.allChats())
                        } else if (view === 'flagged') {
                          navigate(routes.view.flagged())
                        }
                      }}
                      sessionOptions={sessionOptions}
                      searchActive={searchActive}
                      searchQuery={searchQuery}
                      onSearchChange={setSearchQuery}
                      onSearchClose={() => {
                        setSearchActive(false)
                        setSearchQuery('')
                      }}
                      todoStates={effectiveTodoStates}
                      evaluateViews={evaluateViews}
                      labels={labelConfigs}
                      onLabelsChange={handleSessionLabelsChange}
                      workspaceId={activeWorkspaceId ?? undefined}
                      statusFilter={listFilter}
                      labelFilterMap={labelFilter}
                      statusEnabled={statusEnabled}
                    />
                  </>
                )}
              </div>
            </motion.div>

            {/* Session List Resize Handle (hidden in focused mode) */}
            {!effectiveFocusMode && (
              <div
                ref={sessionListHandleRef}
                onMouseDown={(e) => { e.preventDefault(); setIsResizing('session-list') }}
                onMouseMove={(e) => {
                  if (sessionListHandleRef.current) {
                    const rect = sessionListHandleRef.current.getBoundingClientRect()
                    setSessionListHandleY(e.clientY - rect.top)
                  }
                }}
                onMouseLeave={() => { if (isResizing !== 'session-list') setSessionListHandleY(null) }}
                className="relative w-0 h-full cursor-col-resize flex justify-center shrink-0"
              >
                {/* Touch area */}
                <div className="absolute inset-y-0 -left-1.5 -right-1.5 flex justify-center cursor-col-resize">
                  <div
                    className="absolute inset-y-0 left-1/2 -translate-x-1/2 w-0.5"
                    style={getResizeGradientStyle(sessionListHandleY)}
                  />
                </div>
              </div>
            )}

            {/* === MAIN CONTENT PANEL === */}
            <div className={cn(
              "flex-1 overflow-hidden min-w-0 bg-foreground-2 shadow-middle",
              effectiveFocusMode ? "rounded-l-[14px]" : "rounded-l-[10px]",
              isRightSidebarVisible ? "rounded-r-[10px]" : "rounded-r-[14px]"
            )}>
              <MainContentPanel isFocusedMode={effectiveFocusMode} />
            </div>

            {/* Right Sidebar - Inline Mode (≥ 920px) */}
            {!shouldUseOverlay && (
              <>
                {/* Resize Handle */}
                {isRightSidebarVisible && (
                  <div
                    ref={rightSidebarHandleRef}
                    onMouseDown={(e) => { e.preventDefault(); setIsResizing('right-sidebar') }}
                    onMouseMove={(e) => {
                      if (rightSidebarHandleRef.current) {
                        const rect = rightSidebarHandleRef.current.getBoundingClientRect()
                        setRightSidebarHandleY(e.clientY - rect.top)
                      }
                    }}
                    onMouseLeave={() => { if (isResizing !== 'right-sidebar') setRightSidebarHandleY(null) }}
                    className="relative w-0 h-full cursor-col-resize flex justify-center shrink-0"
                  >
                    {/* Touch area */}
                    <div className="absolute inset-y-0 -left-1.5 -right-1.5 flex justify-center cursor-col-resize">
                      <div
                        className="absolute inset-y-0 left-1/2 -translate-x-1/2 w-0.5"
                        style={getResizeGradientStyle(rightSidebarHandleY)}
                      />
                    </div>
                  </div>
                )}

                {/* Inline Sidebar */}
                <motion.div
                  initial={false}
                  animate={{
                    width: isRightSidebarVisible ? rightSidebarWidth : 0,
                    marginLeft: isRightSidebarVisible ? 0 : -PANEL_PANEL_SPACING / 2,
                  }}
                  transition={isResizing === 'right-sidebar' || skipRightSidebarAnimation ? { duration: 0 } : springTransition}
                  className="h-full shrink-0 overflow-visible"
                >
                  <motion.div
                    initial={false}
                    animate={{
                      x: isRightSidebarVisible ? 0 : rightSidebarWidth + PANEL_PANEL_SPACING / 2,
                      opacity: isRightSidebarVisible ? 1 : 0,
                    }}
                    transition={isResizing === 'right-sidebar' || skipRightSidebarAnimation ? { duration: 0 } : springTransition}
                    className="h-full bg-foreground-2 shadow-middle rounded-l-[10px] rounded-r-[14px]"
                    style={{ width: rightSidebarWidth }}
                  >
                    <RightSidebar
                      panel={{ type: 'sessionMetadata' }}
                      sessionId={isChatsNavigation(navState) && navState.details ? navState.details.sessionId : undefined}
                      closeButton={rightSidebarCloseButton}
                    />
                  </motion.div>
                </motion.div>
              </>
            )}

            {/* Right Sidebar - Overlay Mode (< 920px) */}
            {shouldUseOverlay && (
              <AnimatePresence>
                {isRightSidebarVisible && (
                  <>
                    {/* Backdrop */}
                    <motion.div
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      transition={skipRightSidebarAnimation ? { duration: 0 } : { duration: 0.2 }}
                      className="fixed inset-0 bg-black/25 z-overlay"
                      onClick={() => setIsRightSidebarVisible(false)}
                    />
                    {/* Drawer panel */}
                    <motion.div
                      initial={{ x: 316 }}
                      animate={{ x: 0 }}
                      exit={{ x: 316 }}
                      transition={skipRightSidebarAnimation ? { duration: 0 } : springTransition}
                      className="fixed inset-y-0 right-0 w-[316px] h-screen z-overlay p-1.5"
                    >
                      <div className="h-full bg-foreground-2 overflow-hidden shadow-strong rounded-[12px]">
                        <RightSidebar
                          panel={{ type: 'sessionMetadata' }}
                          sessionId={isChatsNavigation(navState) && navState.details ? navState.details.sessionId : undefined}
                          closeButton={rightSidebarCloseButton}
                        />
                      </div>
                    </motion.div>
                  </>
                )}
              </AnimatePresence>
            )}
          </div>
        </div>

        {/* ============================================================================
       * CONTEXT MENU TRIGGERED EDIT POPOVERS
       * ============================================================================
       * These EditPopovers are opened programmatically from sidebar context menus.
       * They use controlled state (editPopoverOpen) and invisible anchors for positioning.
       * The anchor Y position is captured from the right-clicked item (editPopoverAnchorY ref)
       * so the popover appears near the triggering item rather than at a fixed location.
       * modal={true} prevents auto-close when focus shifts after context menu closes.
       */}
        {activeWorkspace && (
          <>
            {/* Configure Statuses EditPopover - anchored near sidebar */}
            <EditPopover
              open={editPopoverOpen === 'statuses'}
              onOpenChange={(isOpen) => setEditPopoverOpen(isOpen ? 'statuses' : null)}
              modal={true}
              trigger={
                <div
                  className="fixed w-0 h-0 pointer-events-none"
                  style={{ left: sidebarWidth + 20, top: editPopoverAnchorY.current }}
                  aria-hidden="true"
                />
              }
              side="bottom"
              align="start"
              secondaryAction={{
                label: 'Edit File',
                filePath: `${activeWorkspace.rootPath}/statuses/config.json`,
              }}
              {...getEditConfig('edit-statuses', activeWorkspace.rootPath)}
            />
            {/* Configure Labels EditPopover - anchored near sidebar */}
            <EditPopover
              open={editPopoverOpen === 'labels'}
              onOpenChange={(isOpen) => setEditPopoverOpen(isOpen ? 'labels' : null)}
              modal={true}
              trigger={
                <div
                  className="fixed w-0 h-0 pointer-events-none"
                  style={{ left: sidebarWidth + 20, top: editPopoverAnchorY.current }}
                  aria-hidden="true"
                />
              }
              side="bottom"
              align="start"
              secondaryAction={{
                label: 'Edit File',
                filePath: `${activeWorkspace.rootPath}/labels/config.json`,
              }}
              {...(() => {
                // Spread base config, override context to include which label was right-clicked
                const config = getEditConfig('edit-labels', activeWorkspace.rootPath)
                const targetLabel = editLabelTargetId.current
                  ? findLabelById(labelConfigs, editLabelTargetId.current)
                  : undefined
                if (!targetLabel) return config
                return {
                  ...config,
                  context: {
                    ...config.context,
                    context: (config.context.context || '') +
                      ` The user right-clicked on the label "${targetLabel.name}" (id: "${targetLabel.id}"). ` +
                      'If they refer to "this label" or "this", they mean this specific label.',
                  },
                }
              })()}
            />
            {/* Edit Views EditPopover - anchored near sidebar */}
            <EditPopover
              open={editPopoverOpen === 'views'}
              onOpenChange={(isOpen) => setEditPopoverOpen(isOpen ? 'views' : null)}
              modal={true}
              trigger={
                <div
                  className="fixed w-0 h-0 pointer-events-none"
                  style={{ left: sidebarWidth + 20, top: editPopoverAnchorY.current }}
                  aria-hidden="true"
                />
              }
              side="bottom"
              align="start"
              secondaryAction={{
                label: 'Edit File',
                filePath: `${activeWorkspace.rootPath}/views.json`,
              }}
              {...getEditConfig('edit-views', activeWorkspace.rootPath)}
            />
            {/* Add Source EditPopovers - one for each variant (generic + filter-specific)
           * editPopoverOpen can be: 'add-source', 'add-source-api', 'add-source-mcp', 'add-source-local'
           * Each variant uses its corresponding EditContextKey for filter-aware agent context */}
            {(['add-source', 'add-source-api', 'add-source-mcp', 'add-source-local'] as const).map((variant) => (
              <EditPopover
                key={variant}
                open={editPopoverOpen === variant}
                onOpenChange={(isOpen) => setEditPopoverOpen(isOpen ? variant : null)}
                modal={true}
                trigger={
                  <div
                    className="fixed w-0 h-0 pointer-events-none"
                    style={{ left: sidebarWidth + 20, top: editPopoverAnchorY.current }}
                    aria-hidden="true"
                  />
                }
                side="bottom"
                align="start"
                {...getEditConfig(variant, activeWorkspace.rootPath)}
              />
            ))}
            {/* Add Skill EditPopover */}
            <EditPopover
              open={editPopoverOpen === 'add-skill'}
              onOpenChange={(isOpen) => setEditPopoverOpen(isOpen ? 'add-skill' : null)}
              modal={true}
              trigger={
                <div
                  className="fixed w-0 h-0 pointer-events-none"
                  style={{ left: sidebarWidth + 20, top: editPopoverAnchorY.current }}
                  aria-hidden="true"
                />
              }
              side="bottom"
              align="start"
              {...getEditConfig('add-skill', activeWorkspace.rootPath)}
            />
            {/* Add Label EditPopover - triggered from "Add New Label" context menu on labels */}
            <EditPopover
              open={editPopoverOpen === 'add-label'}
              onOpenChange={(isOpen) => setEditPopoverOpen(isOpen ? 'add-label' : null)}
              modal={true}
              trigger={
                <div
                  className="fixed w-0 h-0 pointer-events-none"
                  style={{ left: sidebarWidth + 20, top: editPopoverAnchorY.current }}
                  aria-hidden="true"
                />
              }
              side="bottom"
              align="start"
              secondaryAction={{
                label: 'Edit File',
                filePath: `${activeWorkspace.rootPath}/labels/config.json`,
              }}
              {...(() => {
                // Spread base config, override context to include which label was right-clicked
                const config = getEditConfig('add-label', activeWorkspace.rootPath)
                const targetLabel = editLabelTargetId.current
                  ? findLabelById(labelConfigs, editLabelTargetId.current)
                  : undefined
                if (!targetLabel) return config
                return {
                  ...config,
                  context: {
                    ...config.context,
                    context: (config.context.context || '') +
                      ` The user right-clicked on the label "${targetLabel.name}" (id: "${targetLabel.id}"). ` +
                      'The new label should be added as a sibling after this label, or as a child if the user specifies.',
                  },
                }
              })()}
            />
          </>
        )}

      </TooltipProvider>
    </AppShellProvider>
  )
}
