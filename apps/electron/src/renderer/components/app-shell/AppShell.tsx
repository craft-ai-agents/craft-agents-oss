import * as React from "react"
import { useTranslation, Trans } from "react-i18next"
import { useRef, useState, useEffect, useCallback, useMemo } from "react"
import { useAtomValue, useStore } from "jotai"
import { motion, AnimatePresence } from "motion/react"
import {
  Archive,
  Settings,
  ChevronRight,
  ChevronDown,
  MoreHorizontal,
  RotateCw,
  Flag,
  Tag,
  Check,
  X,
  Search,
  Plus,
  Trash2,
  Inbox,
  Globe,
  FolderOpen,
  Calendar,
  Layers,
  Clock,
  Radio,
  Bot,
  Info,
  MailOpen,
  FolderKanban,
} from "lucide-react"
// SessionStatusIcons no longer used - icons come from dynamic sessionStatuses
import { SourceAvatar } from "@/components/ui/source-avatar"
import { TopBar } from "./TopBar"
import { SquarePenRounded } from "../icons/SquarePenRounded"
import { McpIcon } from "../icons/McpIcon"
import { cn } from "@/lib/utils"
import { isMac, isWebUI } from "@/lib/platform"
import { Button } from "@/components/ui/button"
import { HeaderIconButton } from "@/components/ui/HeaderIconButton"
import { resolveInheritedFilterParams, type FilterMode } from "./inherited-filter-params"
import { HeaderMenu } from "@/components/ui/HeaderMenu"
import { Separator } from "@/components/ui/separator"
import { Tooltip, TooltipTrigger, TooltipContent } from "@craft-agent/ui"
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
import { SessionList, type ChatGroupingMode } from "./SessionList"
import { MainContentPanel } from "./MainContentPanel"
import { CollectionViewChrome } from "./collection/CollectionViewChrome"
import { PanelStackContainer } from "./PanelStackContainer"
import type { ChatDisplayHandle } from "./ChatDisplay"
import { LeftSidebar } from "./LeftSidebar"
import { ProfileStrip, type ProfileStripData } from "./ProfileStrip"
import {
  clearStatusUnseen,
  getUnseenStatuses,
  subscribeUnseenStatuses,
  type UnseenStatusMap,
} from '@/lib/sidebar-unseen-status'

import { APP_NAV_DESTINATIONS_BY_ID } from "./nav-destinations"
import {
  WorkspaceSurfaceHost,
  ACTIVITY_RAIL_WIDTH,
  ACTIVITY_RAIL_COLLAPSED_WIDTH,
  resolveWorkbenchAvailability,
} from "../../platform"
import { featureWorkbenchAtom, activityRailCollapsedAtom } from "@/atoms/unified-shell"
import { useSession, useSessionSelection } from "@/hooks/useSession"
import { ensureSessionMessagesLoadedAtom } from "@/atoms/sessions"
import { AppShellProvider, type AppShellContextType } from "@/context/AppShellContext"
import { EscapeInterruptProvider, useEscapeInterrupt } from "@/context/EscapeInterruptContext"
import { useTheme } from "@/context/ThemeContext"
import { getResizeGradientStyle } from "@/hooks/useResizeGradient"
import { useAction, useActionLabel } from "@/actions"
import { useFocusZone } from "@/hooks/keyboard"
import { useFocusContext } from "@/context/FocusContext"
import { getSessionTitle } from "@/utils/session"
import { useSetAtom } from "jotai"
import type { Session, Workspace, FileAttachment, PermissionRequest, LoadedSource, LoadedSkill, PermissionMode, SourceFilter, AutomationFilter } from "../../../shared/types"
import { sessionMetaMapAtom, sendToWorkspaceAtom, type SessionMeta } from "@/atoms/sessions"
import { collectionDisplayAtom } from "@/atoms/collection-display"
import { collectionFiltersAtom } from "@/atoms/collection-filters"
import { compareSessions, DEFAULT_COLLECTION_FILTERS, filterSessionMeta } from "@craft-agent/shared/sessions/collection"
import { sourcesAtom } from "@/atoms/sources"
import { skillsAtom } from "@/atoms/skills"
import { panelStackAtom, panelCountAtom, focusedPanelIdAtom, focusedSessionIdAtom, focusNextPanelAtom, focusPrevPanelAtom, parseSessionIdFromRoute } from "@/atoms/panel-stack"
import { type SessionStatusId, type SessionStatus, statusConfigsToSessionStatuses, resolveStatusDisplayLabel, resolveLabelDisplayName } from "@/config/session-status-config"
import { useStatuses } from "@/hooks/useStatuses"
import { useLabels } from "@/hooks/useLabels"
import { useViews } from "@/hooks/useViews"
import { useContainerWidth } from "@/hooks/useContainerWidth"
import { LabelIcon, LabelValueTypeIcon } from "@/components/ui/label-icon"
import { buildLabelTree, getDescendantIds, getLabelDisplayName, flattenLabels, extractLabelId, findLabelById, sortLabelsForDisplay, matchesLabelFilter } from "@craft-agent/shared/labels"
import type { LabelConfig, LabelTreeNode } from "@craft-agent/shared/labels"
import { resolveEntityColor } from "@craft-agent/shared/colors"
import * as storage from "@/lib/local-storage"
import { toast } from "sonner"
import { navigate, routes } from "@/lib/navigate"
import {
  useNavigation,
  useNavigationState,
  isSessionsNavigation,
  isKnowledgeNavigation,
  isSourcesNavigation,
  isSettingsNavigation,
  isSkillsNavigation,
  isMemoryNavigation,
  isConnectionsNavigation,
  isNotesNavigation,
  isAutomationsNavigation,
  isProjectsNavigation,
  type NavigationState,
} from "@/contexts/NavigationContext"
import type { SettingsSubpage } from "../../../shared/types"
import { SourcesListPanel } from "./SourcesListPanel"
import { SkillsListPanel } from "./SkillsListPanel"
import { MemoryListPanel } from "./MemoryListPanel"
import { AutomationsListPanel } from "../automations/AutomationsListPanel"
import { ProjectsListPanel } from "./ProjectsListPanel"
import { APP_EVENTS, AGENT_EVENTS, type AutomationFilterKind, AUTOMATION_TYPE_TO_FILTER_KIND } from "../automations/types"
import { useAutomations } from "@/hooks/useAutomations"
import { useProjects } from "@/hooks/useProjects"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog"
import { PanelHeader } from "./PanelHeader"
import { OnboardingDialog } from "./OnboardingDialog"
import { FabNewChat } from "./FabNewChat"
import { SendToWorkspaceDialog } from "./SendToWorkspaceDialog"
import { CreateProjectDialog } from "../projects/CreateProjectDialog"
import { MessagingDialogHost } from "@/components/messaging/MessagingDialogHost"
import { PublishSessionDialogHost } from "@/components/knowledge/PublishSessionDialogHost"
import { EditPopover, getEditConfig, type EditContextKey } from "@/components/ui/EditPopover"
import SettingsNavigator from "@/pages/settings/SettingsNavigator"
import {
  PANEL_GAP,
  PANEL_EDGE_INSET,
  PANEL_SASH_HALF_HIT_WIDTH,
  PANEL_SASH_HIT_WIDTH,
  PANEL_SASH_LINE_WIDTH,
  PANEL_STACK_VERTICAL_OVERFLOW,
  RADIUS_EDGE,
  RADIUS_INNER,
} from "./panel-constants"
import { hasOpenOverlay } from "@/lib/overlay-detection"
import { clearSourceIconCaches } from "@/lib/icon-cache"
import { dispatchFocusInputEvent } from "./input/focus-input-events"
import { WebBrowserPanel } from "../browser/WebBrowserPanel"
import { KnowledgeNavigator } from "../../knowledge/KnowledgeNavigator"

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
  /** When false, workspace selection is rendered outside the top bar. */
  showTopBarWorkspaceSelector?: boolean
  /** Left offset for a full-height rail rendered outside the top bar. */
  topBarLeftInset?: number
  /** Main-process capability injection for the Workbench two-key rollout. */
  workbenchOperatorCapability?: unknown
}

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
  showTopBarWorkspaceSelector = true,
  topBarLeftInset = 0,
  workbenchOperatorCapability = false,
}: AppShellProps) {
  // Destructure commonly used values from context
  // Note: sessions is NOT destructured here - we use sessionMetaMapAtom instead
  // to prevent closures from retaining the full messages array
  const {
    workspaces,
    activeWorkspaceId,
    sessionOptions,
    onSelectWorkspace,
    onRefreshWorkspaces,
    onDeleteSession,
    onFlagSession,
    onUnflagSession,
    onArchiveSession,
    onUnarchiveSession,
    onMarkSessionRead,
    onMarkSessionUnread,
    onSessionStatusChange,
    onRenameSession,
    onOpenSettings,
    onOpenKeyboardShortcuts,
    onOpenStoredUserPreferences,
    onReset,
    onSendMessage,
    openNewChat,
    pendingPermissions,
  } = contextValue

  const { t } = useTranslation()

  // Get hotkey labels from centralized action registry
  const newChatHotkey = useActionLabel('app.newChat').hotkey

  const [isSidebarVisible, setIsSidebarVisible] = React.useState(() => {
    return storage.get(storage.KEYS.sidebarVisible, !defaultCollapsed)
  })
  // PR-2: the rail offset follows the same two-key decision as the host.
  const workbenchUserPreference = useAtomValue(featureWorkbenchAtom)
  const workbenchAvailability = resolveWorkbenchAvailability(
    workbenchOperatorCapability,
    workbenchUserPreference,
  )
  const workbenchEnabled = workbenchAvailability === 'enabled'
  const activityRailCollapsed = useAtomValue(activityRailCollapsedAtom)
  const unifiedRailOffset = workbenchEnabled
    ? (activityRailCollapsed ? ACTIVITY_RAIL_COLLAPSED_WIDTH : ACTIVITY_RAIL_WIDTH) + PANEL_GAP
    : 0
  const [sidebarWidth, setSidebarWidth] = React.useState(() => {
    return storage.get(storage.KEYS.sidebarWidth, 220)
  })
  // Session list width in pixels (min 240, max 480)
  const [sessionListWidth, setSessionListWidth] = React.useState(() => {
    return storage.get(storage.KEYS.sessionListWidth, 300)
  })

  // Hides both sidebar and navigator (CMD+. toggle)
  // Seed from either focused window param or persisted preference, then keep it toggleable.
  const [isSidebarAndNavigatorHidden, setIsSidebarAndNavigatorHidden] = React.useState(() => {
    return isFocusedMode || storage.get(storage.KEYS.focusModeEnabled, false)
  })

  // Auto-compact mode: shell width below mobile threshold hides sidebar/navigator
  // and switches to single-panel mode. Works in both webui (narrow viewport) and
  // desktop (narrow window or small screen).
  const shellRef = useRef<HTMLDivElement>(null)
  const compactHeaderOrderRef = useRef(0)
  const [compactHeaderEntries, setCompactHeaderEntries] = useState<Record<string, {
    render: () => React.ReactNode
    priority: number
    order: number
  }>>({})
  const registerCompactHeader = useCallback((id: string, render: () => React.ReactNode, priority: number) => {
    const order = ++compactHeaderOrderRef.current
    setCompactHeaderEntries(prev => ({ ...prev, [id]: { render, priority, order } }))
  }, [])
  const unregisterCompactHeader = useCallback((id: string) => {
    setCompactHeaderEntries(prev => {
      if (!prev[id]) return prev
      const next = { ...prev }
      delete next[id]
      return next
    })
  }, [])
  const compactHeaderRenderer = useMemo(() => {
    const selected = Object.values(compactHeaderEntries)
      .sort((a, b) => b.priority - a.priority || b.order - a.order)[0]
    return selected?.render
  }, [compactHeaderEntries])
  const shellWidth = useContainerWidth(shellRef)
  const MOBILE_THRESHOLD = 768
  const isAutoCompact = shellWidth > 0 && shellWidth < MOBILE_THRESHOLD

  const effectiveSidebarAndNavigatorHidden = isSidebarAndNavigatorHidden || isAutoCompact


  // Profile strip (gamification footer)
  const [profileStrip, setProfileStrip] = React.useState<ProfileStripData>({
    displayName: 'User',
    level: 1,
    xp: 0,
    progress: 0,
    xpIntoLevel: 0,
    xpForNext: 100,
    nextThreshold: 100,
    balance: null,
  })

  useEffect(() => {
    let cancelled = false

    const applyProfile = async () => {
      try {
        const [prefsResult, gamification] = await Promise.all([
          window.electronAPI.readPreferences(),
          window.electronAPI.getGamificationProfile(),
        ])
        if (cancelled) return
        let displayName = ''
        try {
          const prefs = JSON.parse(prefsResult.content || '{}') as { name?: string }
          if (typeof prefs.name === 'string' && prefs.name.trim()) {
            displayName = prefs.name.trim()
          }
        } catch {
          // ignore bad prefs JSON
        }
        if (!displayName) displayName = t('profile.defaultName')
        setProfileStrip({
          displayName,
          level: gamification.level,
          xp: gamification.xp,
          progress: gamification.progress,
          xpIntoLevel: gamification.xpIntoLevel,
          xpForNext: gamification.xpForNext,
          nextThreshold: gamification.nextThreshold,
          balance: gamification.balance,
        })
      } catch (err) {
        console.error('Failed to load profile strip:', err)
      }
    }

    void applyProfile()
    const off = window.electronAPI.onGamificationChanged((payload) => {
      setProfileStrip((prev) => ({
        ...prev,
        level: payload.level,
        xp: payload.xp,
        progress: payload.progress,
        xpIntoLevel: payload.xpIntoLevel,
        xpForNext: payload.xpForNext,
        nextThreshold: payload.nextThreshold,
        balance: payload.balance,
      }))
    })
    return () => {
      cancelled = true
      off()
    }
  }, [t])



  const [isResizing, setIsResizing] = React.useState<'sidebar' | 'session-list' | null>(null)
  const [sidebarHandleY, setSidebarHandleY] = React.useState<number | null>(null)
  const [sessionListHandleY, setSessionListHandleY] = React.useState<number | null>(null)
  const resizeHandleRef = React.useRef<HTMLDivElement>(null)
  const sessionListHandleRef = React.useRef<HTMLDivElement>(null)
  const [session, setSession] = useSession()
  const { resolvedMode, isDark, setMode } = useTheme()
  const { canGoBack, canGoForward, goBack, goForward, navigateToSource, navigateToSession } = useNavigation()

  // Double-Esc interrupt feature: first Esc shows warning, second Esc interrupts
  const { handleEscapePress } = useEscapeInterrupt()

  // UNIFIED NAVIGATION STATE - single source of truth from NavigationContext
  // Derived from focused panel's route — all panels are peers
  const navState = useNavigationState()

  const store = useStore()
  const panelStack = useAtomValue(panelStackAtom)
  const panelCount = useAtomValue(panelCountAtom)
  const focusedSessionId = useAtomValue(focusedSessionIdAtom)

  // Navigate the focused panel to a session.
  // If the session is already open in another panel, focus that panel instead.
  const setFocusedPanel = useSetAtom(focusedPanelIdAtom)
  const navigateToSessionInPanel = useCallback((sessionId: string) => {
    // Check if the session is already open in any panel — focus it instead of navigating
    const stack = store.get(panelStackAtom)
    for (const entry of stack) {
      if (parseSessionIdFromRoute(entry.route) === sessionId) {
        setFocusedPanel(entry.id)
        return
      }
    }

    // Not open in any panel — navigate() updates the focused panel
    navigateToSession(sessionId)
  }, [store, setFocusedPanel, navigateToSession])

  const sessionsContext = React.useMemo(() => {
    if (isSessionsNavigation(navState)) {
      return {
        filter: navState.filter,
        sessionId: navState.details?.sessionId ?? null,
      }
    }
    return null
  }, [navState])

  const sessionFilter = sessionsContext?.filter ?? null

  // Board and table replace the session-list navigator with a full-width host,
  // so the navigator (and its resize handle) collapse to zero width while active.
  // Each host renders its own CollectionViewToggle.
  const isBoardView =
    isSessionsNavigation(navState) &&
    (navState.viewMode === 'board' || navState.viewMode === 'table')

  // Derive source filter from navigation state (only when in sources navigator)
  const sourceFilter: SourceFilter | null = isSourcesNavigation(navState) ? navState.filter ?? null : null

  // Derive automation filter from navigation state (only when in automations navigator)
  const automationFilter: AutomationFilter | null = isAutomationsNavigation(navState) ? navState.filter ?? null : null

  // Per-view filter storage: each session list view (allSessions, flagged, state:X, label:X, view:X)
  // has its own independent set of status and label filters.
  // Each filter entry stores a mode ('include' or 'exclude') for tri-state filtering.
  type FilterEntry = Record<string, FilterMode> // id → mode
  type ViewFiltersMap = Record<string, { statuses: FilterEntry, labels: FilterEntry, projects?: FilterEntry, groupingMode?: ChatGroupingMode }>

  // Compute a stable key for the current chat filter view
  const sessionFilterKey = useMemo(() => {
    if (!sessionFilter) return null
    switch (sessionFilter.kind) {
      case 'allSessions': return 'allSessions'
      case 'flagged': return 'flagged'
      case 'archived': return 'archived'
      case 'state': return `state:${sessionFilter.stateId}`
      case 'label': return `label:${sessionFilter.labelId}`
      case 'view': return `view:${sessionFilter.viewId}`
      default: return 'allSessions'
    }
  }, [sessionFilter])

  const [viewFiltersMap, setViewFiltersMap] = React.useState<ViewFiltersMap>(() => {
    const saved = storage.get<ViewFiltersMap>(storage.KEYS.viewFilters, {})
    // Backward compat: migrate old format (arrays) into new format (Record<string, FilterMode>)
    if (saved.allSessions && Array.isArray((saved.allSessions as any).statuses)) {
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
    // Also migrate legacy global filters if no allSessions entry exists
    if (!saved.allSessions) {
      const oldStatuses = storage.get<SessionStatusId[]>(storage.KEYS.listFilter, [])
      const oldLabels = storage.get<string[]>(storage.KEYS.labelFilter, [])
      if (oldStatuses.length > 0 || oldLabels.length > 0) {
        const statuses: FilterEntry = {}
        for (const id of oldStatuses) statuses[id] = 'include'
        const labels: FilterEntry = {}
        for (const id of oldLabels) labels[id] = 'include'
        saved.allSessions = { statuses, labels }
      }
    }
    return saved
  })

  const collectionDisplay = useAtomValue(collectionDisplayAtom)
  const collectionFilters = useAtomValue(collectionFiltersAtom)
  const setCollectionFilters = useSetAtom(collectionFiltersAtom)
  const { clearMultiSelect: clearSessionMultiSelect } = useSessionSelection()
  const sessionsViewMode = isSessionsNavigation(navState) ? navState.viewMode : null
  const collectionFiltersKey = JSON.stringify(collectionFilters)

  React.useEffect(() => {
    clearSessionMultiSelect()
  }, [sessionsViewMode, clearSessionMultiSelect])

  React.useEffect(() => {
    clearSessionMultiSelect()
  }, [collectionFiltersKey, clearSessionMultiSelect])

  // Jump to All Sessions filtered by a single project. Used by the Projects list
  // context menu — sets the allSessions view's project filter (preserving its
  // other filters), then navigates.
  const handleJumpToProjectSessions = useCallback((projectId: string) => {
    // FR-31: jump writes the shared CollectionFilters atom (not viewFiltersMap).
    setCollectionFilters(prev => ({
      ...prev,
      projectId: [projectId],
    }))
    navigate(routes.view.allSessions())
  }, [setCollectionFilters, navigate])

  // Jump to All Sessions scoped to a task: replace the allSessions view's label filter
  // (and project filter, when the task is bound to one) with the task's scope, then open
  // the session. These are the SAME user-clearable filters the list-header chips edit —
  // clearing them afterwards works exactly like any hand-set filter. Mirrors
  // handleJumpToProjectSessions; used by kanban tile/subtask clicks and post-create.
  const handleJumpToTaskSessions = useCallback(
    (sessionId: string, scope: { labelId: string; projectId?: string }) => {
      setCollectionFilters(prev => ({
        ...prev,
        labels: [scope.labelId],
        projectId: scope.projectId ? [scope.projectId] : undefined,
      }))
      navigate(routes.view.allSessions(sessionId))
    },
    [setCollectionFilters, navigate],
  )

  // Search state for session list
  const [searchActive, setSearchActive] = React.useState(false)
  const [searchQuery, setSearchQuery] = React.useState('')

  // Grouping mode for chat list: per-view (stored in viewFiltersMap), forced to 'date' for state sub-views
  const isStateSubView = sessionFilter?.kind === 'state'

  const chatGroupingMode: ChatGroupingMode = isStateSubView
    ? 'date'
    : (viewFiltersMap[sessionFilterKey ?? '']?.groupingMode ?? 'date')

  const setChatGroupingMode = useCallback((mode: ChatGroupingMode) => {
    setViewFiltersMap(prev => {
      if (!sessionFilterKey) return prev
      const existing = prev[sessionFilterKey] ?? { statuses: {}, labels: {} }
      return {
        ...prev,
        [sessionFilterKey]: { ...existing, groupingMode: mode }
      }
    })
  }, [sessionFilterKey])

  // Ref for ChatDisplay navigation (exposed via forwardRef)
  const chatDisplayRef = React.useRef<ChatDisplayHandle>(null)
  // Track match count and index from ChatDisplay (for SessionList navigation UI)
  const [chatMatchInfo, setChatMatchInfo] = React.useState<{ sessionId: string | null; count: number; index: number; isHighlighting?: boolean }>({ sessionId: null, count: 0, index: 0 })

  // Callback for immediate match info updates from ChatDisplay
  // Memo guard prevents render feedback loops from identical updates
  const handleChatMatchInfoChange = React.useCallback((info: { sessionId: string | null; count: number; index: number; isHighlighting: boolean }) => {
    setChatMatchInfo(prev => {
      if (prev.sessionId === info.sessionId && prev.count === info.count && prev.index === info.index && prev.isHighlighting === info.isHighlighting) {
        return prev
      }
      return info
    })
  }, [])

  // Reset match info when search is deactivated
  React.useEffect(() => {
    if (!searchActive || !searchQuery) {
      setChatMatchInfo({ sessionId: null, count: 0, index: 0 })
    }
  }, [searchActive, searchQuery])


  // Reset search only when navigator or filter changes (not when selecting sessions)
  const navFilterKey = React.useMemo(() => {
    if (isSessionsNavigation(navState)) {
      const filter = navState.filter
      return `chats:${filter.kind}:${filter.kind === 'state' ? filter.stateId : ''}`
    }
    return navState.navigator
  }, [navState])

  React.useEffect(() => {
    setSearchActive(false)
    setSearchQuery('')
  }, [navFilterKey])

  // Cmd+F to activate search
  useAction('app.search', () => setSearchActive(true))

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
    return new Set(['nav:labels'])
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
  // Automations — state, handlers, loading, subscriptions
  const activeWorkspace = workspaces.find(w => w.id === activeWorkspaceId)

  // Send to Workspace dialog state (driven by sendToWorkspaceAtom set from SessionMenu/BatchSessionMenu)
  const sendToWorkspaceIds = useAtomValue(sendToWorkspaceAtom)
  const setSendToWorkspaceIds = useSetAtom(sendToWorkspaceAtom)
  const handleTransferComplete = useCallback((targetWorkspaceId: string, _newSessionIds: string[]) => {
    onSelectWorkspace(targetWorkspaceId)
  }, [onSelectWorkspace])
  const {
    automations, automationTestResults,
    automationPendingDelete, pendingDeleteAutomation, setAutomationPendingDelete,
    handleTestAutomation, handleToggleAutomation, handleDuplicateAutomation, handleDeleteAutomation, confirmDeleteAutomation,
    getAutomationHistory, handleReplayAutomation,
  } = useAutomations(activeWorkspaceId)

  const { projects } = useProjects(activeWorkspaceId)
  const projectMenuOptions = useMemo(
    () => projects.map(p => ({ id: p.config.id, slug: p.config.slug, name: p.config.name, color: p.config.color })),
    [projects],
  )
  const handleSessionProjectChange = useCallback(async (sessionId: string, projectId: string | null) => {
    try {
      await window.electronAPI.sessionCommand(sessionId, { type: 'setProjectId', projectId })
    } catch (err) {
      console.error('[AppShell] Failed to update session project:', err)
      toast.error(t('toast.failedToUpdateProject'))
    }
  }, [t])

  // Whether local MCP servers are enabled (affects stdio source status)
  const [localMcpEnabled, setLocalMcpEnabled] = React.useState(true)

  // Enabled permission modes for Shift+Tab cycling (min 2 modes)
  const [enabledModes, setEnabledModes] = React.useState<PermissionMode[]>(['safe', 'ask', 'allow-all'])

  // Load workspace settings (for localMcpEnabled and cyclablePermissionModes) on workspace change
  React.useEffect(() => {
    if (!activeWorkspaceId) return
    window.electronAPI.getWorkspaceSettings(activeWorkspaceId).then((settings) => {
      if (settings) {
        setLocalMcpEnabled(settings.localMcpEnabled ?? true)
        // Load cyclablePermissionModes from workspace settings
        if (settings.cyclablePermissionModes && settings.cyclablePermissionModes.length >= 2) {
          setEnabledModes(settings.cyclablePermissionModes)
        }
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

    // Clear transient UI state only on workspace SWITCH (not initial mount)
    if (previousWorkspaceId !== null && previousWorkspaceId !== activeWorkspaceId) {
      setCollectionFilters({ ...DEFAULT_COLLECTION_FILTERS })

      // Clear search state
      setSearchActive(false)
      setSearchQuery('')

      // Clear focused sidebar item
      setFocusedSidebarItemId(null)
    }

    // Load workspace-scoped state on BOTH initial mount AND workspace switch
    // This fixes CMD+R losing filters - previously only ran on workspace switch
    if (previousWorkspaceId !== activeWorkspaceId) {
      const newViewFilters = storage.get<ViewFiltersMap>(storage.KEYS.viewFilters, {}, activeWorkspaceId)
      setViewFiltersMap(newViewFilters)

      const newExpandedFolders = storage.get<string[]>(storage.KEYS.expandedFolders, [], activeWorkspaceId)
      setExpandedFolders(new Set(newExpandedFolders))

      const newCollapsedItems = storage.get<string[] | null>(storage.KEYS.collapsedSidebarItems, null, activeWorkspaceId)
      setCollapsedItems(newCollapsedItems !== null ? new Set(newCollapsedItems) : new Set(['nav:labels']))
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
    const cleanup = window.electronAPI.onSourcesChanged((workspaceId, updatedSources) => {
      if (workspaceId !== activeWorkspaceId) return
      // Clear icon cache so updated source icons are re-fetched on render
      clearSourceIconCaches()
      setSources(updatedSources || [])
    })
    return cleanup
  }, [activeWorkspaceId])

  // Subscribe to live skill updates (when skills are added/removed dynamically)
  React.useEffect(() => {
    const cleanup = window.electronAPI.onSkillsChanged((workspaceId, updatedSkills) => {
      if (workspaceId !== activeWorkspaceId) return
      setSkills(updatedSkills || [])
    })
    return cleanup
  }, [activeWorkspaceId])

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


  // Load dynamic statuses from workspace config
  const { statuses: statusConfigs, isLoading: isLoadingStatuses } = useStatuses(activeWorkspace?.id || null)
  const [sessionStatuses, setSessionStatuses] = React.useState<SessionStatus[]>([])

  // Convert StatusConfig to SessionStatus with resolved icons
  React.useEffect(() => {
    if (!activeWorkspace?.id || statusConfigs.length === 0) {
      setSessionStatuses([])
      return
    }

    setSessionStatuses(statusConfigsToSessionStatuses(statusConfigs, activeWorkspace.id, isDark))
  }, [statusConfigs, activeWorkspace?.id, isDark])

  // Optimistic status order: immediately reflects drag-drop order while IPC propagates.
  // Cleared when statusConfigs changes (config watcher is source of truth).
  const [optimisticStatusOrder, setOptimisticStatusOrder] = React.useState<string[] | null>(null)

  // Clear optimistic state when the config watcher fires (statusConfigs changes)
  React.useEffect(() => {
    setOptimisticStatusOrder(null)
  }, [statusConfigs])

  // Derive effective todo states: apply optimistic reorder if active, otherwise use canonical order
  const effectiveSessionStatuses = React.useMemo(() => {
    if (!optimisticStatusOrder) return sessionStatuses
    // Reorder sessionStatuses array to match optimistic order
    const stateMap = new Map(sessionStatuses.map(s => [s.id, s]))
    const reordered: SessionStatus[] = []
    for (const id of optimisticStatusOrder) {
      const state = stateMap.get(id)
      if (state) reordered.push(state)
    }
    // Append any states not in the optimistic order (shouldn't happen, but defensive)
    for (const state of sessionStatuses) {
      if (!optimisticStatusOrder.includes(state.id)) reordered.push(state)
    }
    return reordered
  }, [sessionStatuses, optimisticStatusOrder])

  // Load labels from workspace config
  const { labels: labelConfigs } = useLabels(activeWorkspace?.id || null)
  const displayLabelConfigs = useMemo(() => sortLabelsForDisplay(labelConfigs), [labelConfigs])

  // Views: compiled once on config load, evaluated per session in list/chat
  const { evaluateSession: evaluateViews, viewConfigs } = useViews(activeWorkspace?.id || null)

  // Build hierarchical label tree from the display-sorted label config structure
  const labelTree = useMemo(() => buildLabelTree(displayLabelConfigs), [displayLabelConfigs])


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

  // Handle selecting an automation from the list
  const handleAutomationSelect = React.useCallback((automationId: string) => {
    // Preserve current automation filter when selecting an automation
    const type = isAutomationsNavigation(navState) ? navState.filter?.automationType : undefined
    navigate(routes.view.automations({ automationId, type }))
  }, [navState, navigate])

  // Focus zone management
  const { focusZone, focusNextZone, focusPreviousZone } = useFocusContext()

  // Register focus zones
  const { zoneRef: sidebarRef, isFocused: sidebarFocused } = useFocusZone({ zoneId: 'sidebar' })

  // Global keyboard shortcuts using centralized action registry
  // Actions are defined in @/actions/definitions.ts

  // Zone navigation - explicit keyboard intent, always move DOM focus
  useAction('nav.focusSidebar', () => focusZone('sidebar', { intent: 'keyboard' }))
  useAction('nav.focusNavigator', () => focusZone('navigator', { intent: 'keyboard' }))
  useAction('nav.focusChat', () => focusZone('chat', { intent: 'keyboard' }))

  // Tab navigation between zones
  useAction('nav.nextZone', () => {
    focusNextZone()
  }, { enabled: () => !document.querySelector('[role="dialog"]') })

  // Shift+Tab cycles permission mode through enabled modes (textarea handles its own, this handles when focus is elsewhere)
  // In multi-panel, targets the focused panel's session
  const effectiveSessionId = focusedSessionId ?? session.selected

  // Focus chat input for the target session only (multi-panel safe).
  const focusChatInputForSession = useCallback((targetSessionId?: string | null) => {
    if (!targetSessionId) return
    dispatchFocusInputEvent({ sessionId: targetSessionId })
  }, [])

  useAction('chat.cyclePermissionMode', () => {
    if (effectiveSessionId) {
      const currentOptions = contextValue.sessionOptions.get(effectiveSessionId)
      const currentMode = currentOptions?.permissionMode ?? 'ask'
      // Cycle through enabled permission modes
      const modes = enabledModes.length >= 2 ? enabledModes : ['safe', 'ask', 'allow-all'] as PermissionMode[]
      const currentIndex = modes.indexOf(currentMode)
      // If current mode not in enabled list, jump to first enabled mode
      const nextIndex = currentIndex === -1 ? 0 : (currentIndex + 1) % modes.length
      const nextMode = modes[nextIndex]
      contextValue.onSessionOptionsChange(effectiveSessionId, { permissionMode: nextMode })
    }
  })

  const handleToggleSidebar = useCallback(() => {
    if (isSidebarAndNavigatorHidden) {
      setIsSidebarAndNavigatorHidden(false)
      return
    }
    setIsSidebarVisible(v => !v)
  }, [isSidebarAndNavigatorHidden])

  // Sidebar toggle (CMD+B)
  useAction('view.toggleSidebar', handleToggleSidebar)

  // Focus mode toggle (CMD+.) - hides both sidebars
  useAction('view.toggleFocusMode', () => setIsSidebarAndNavigatorHidden(v => !v))

  // Panel focus navigation (CMD+SHIFT+[ / ])
  const focusNextPanel = useSetAtom(focusNextPanelAtom)
  const focusPrevPanel = useSetAtom(focusPrevPanelAtom)
  useAction('panel.focusNext', focusNextPanel, { enabled: () => panelCount > 1 })
  useAction('panel.focusPrev', focusPrevPanel, { enabled: () => panelCount > 1 })

  // New chat
  useAction('app.newChat', () => handleNewChat())
  useAction('app.newChatInPanel', () => handleNewChat(true))

  // Settings
  useAction('app.settings', onOpenSettings)

  // Keyboard shortcuts
  useAction('app.keyboardShortcuts', onOpenKeyboardShortcuts)

  // New window
  useAction('app.newWindow', () => window.electronAPI.menuNewWindow())

  // Quit (note: also handled by native menu on macOS)
  useAction('app.quit', () => window.electronAPI.menuQuit())

  // History navigation
  useAction('nav.goBack', goBack)
  useAction('nav.goForward', goForward)

  // History navigation (arrow key alternatives)
  useAction('nav.goBackAlt', goBack)
  useAction('nav.goForwardAlt', goForward)

  // Search match navigation (CMD+G next, CMD+SHIFT+G prev)
  useAction('chat.nextSearchMatch', () => chatDisplayRef.current?.goToNextMatch(), {
    enabled: () => searchActive && (chatMatchInfo.count ?? 0) > 0
  })
  useAction('chat.prevSearchMatch', () => chatDisplayRef.current?.goToPrevMatch(), {
    enabled: () => searchActive && (chatMatchInfo.count ?? 0) > 0
  })

  // ESC to stop processing - requires double-press within 1 second
  // First press shows warning overlay, second press interrupts
  // In multi-panel, targets the focused panel's session
  useAction('chat.stopProcessing', () => {
    if (effectiveSessionId) {
      const meta = sessionMetaMap.get(effectiveSessionId)
      if (meta?.isProcessing) {
        // handleEscapePress returns true on second press (within timeout)
        const shouldInterrupt = handleEscapePress()
        if (shouldInterrupt) {
          window.electronAPI.cancelProcessing(effectiveSessionId, false).catch(err => {
            console.error('[AppShell] Failed to cancel processing:', err)
          })
        }
      }
    }
  }, {
    // Only active when no overlay is open and session is processing
    // Overlays (dialogs, menus, popovers, etc.) should handle their own Escape
    enabled: () => {
      if (hasOpenOverlay()) return false
      if (!effectiveSessionId) return false
      const meta = sessionMetaMap.get(effectiveSessionId)
      return meta?.isProcessing ?? false
    }
  }, [effectiveSessionId, handleEscapePress])

  // Theme toggle (CMD+SHIFT+A)
  useAction('app.toggleTheme', () => setMode(resolvedMode === 'dark' ? 'light' : 'dark'))

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

      // Dispatch custom event for FreeFormInput to handle (target focused session only)
      const filesArray = Array.from(files)
      const targetSessionId = focusedSessionId ?? session.selected
      if (!targetSessionId) return
      window.dispatchEvent(new CustomEvent('craft:paste-files', {
        detail: { files: filesArray, sessionId: targetSessionId }
      }))
    }

    document.addEventListener('paste', handleGlobalPaste)
    return () => document.removeEventListener('paste', handleGlobalPaste)
  }, [focusedSessionId, session.selected])

  // Resize effect for sidebar, session list, browser host lane, and metadata right sidebar.
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
      }
    }

    const handleMouseUp = () => {
      if (isResizing === 'sidebar') {
        storage.set(storage.KEYS.sidebarWidth, sidebarWidth)
        setSidebarHandleY(null)
      } else if (isResizing === 'session-list') {
        storage.set(storage.KEYS.sessionListWidth, sessionListWidth)
        setSessionListHandleY(null)
      }
      setIsResizing(null)
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)

    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [
    isResizing,
    sidebarWidth,
    sessionListWidth,
    isSidebarVisible,
  ])

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
  const setSessionMetaMap = useSetAtom(sessionMetaMapAtom)

  const hasPendingPrompt = React.useCallback((sessionId: string) => {
    return (pendingPermissions.get(sessionId)?.length ?? 0) > 0
  }, [pendingPermissions])

  // Workspace-level unread indicators (needed for workspace selectors across all workspaces)
  const [workspaceUnreadMap, setWorkspaceUnreadMap] = useState<Record<string, boolean>>({})

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
  // For remote workspaces, sessions have the remote workspace ID (not the local one),
  // so we match against both the local and remote workspace IDs.
  const remoteWorkspaceId = activeWorkspace?.remoteServer?.remoteWorkspaceId
  const workspaceSessionMetas = useMemo(() => {
    const metas = Array.from(sessionMetaMap.values())
    if (!activeWorkspaceId) return metas.filter(s => !s.hidden)
    return metas.filter(s =>
      !s.hidden && (s.workspaceId === activeWorkspaceId || (remoteWorkspaceId && s.workspaceId === remoteWorkspaceId))
    )
  }, [sessionMetaMap, activeWorkspaceId, remoteWorkspaceId])

  // Active sessions exclude archived - use this for all counts and filters except archived view
  const activeSessionMetas = useMemo(() => {
    return workspaceSessionMetas.filter(s => !s.isArchived)
  }, [workspaceSessionMetas])

  const refreshWorkspaceUnreadMap = useCallback(async () => {
    try {
      const summary = await window.electronAPI.getUnreadSummary()
      const next: Record<string, boolean> = {}

      for (const workspace of workspaces) {
        next[workspace.id] = !!summary.hasUnreadByWorkspace[workspace.id]
      }

      setWorkspaceUnreadMap(next)
    } catch (error) {
      console.error('[AppShell] Failed to refresh workspace unread indicators:', error)
    }
  }, [workspaces])

  // Initial + workspace-list refresh
  useEffect(() => {
    void refreshWorkspaceUnreadMap()
  }, [refreshWorkspaceUnreadMap])

  // Keep active workspace unread indicator in sync with live metadata updates
  useEffect(() => {
    if (!activeWorkspaceId) return
    const activeHasUnread = activeSessionMetas.some((session) => !!session.hasUnread)
    setWorkspaceUnreadMap((prev) => ({ ...prev, [activeWorkspaceId]: activeHasUnread }))
  }, [activeWorkspaceId, activeSessionMetas])

  // Keep cross-workspace indicators in sync with global unread updates from main process
  useEffect(() => {
    const cleanup = window.electronAPI.onUnreadSummaryChanged((summary) => {
      const next: Record<string, boolean> = {}
      for (const workspace of workspaces) {
        next[workspace.id] = !!summary.hasUnreadByWorkspace[workspace.id]
      }
      setWorkspaceUnreadMap(next)
    })

    return cleanup
  }, [workspaces])

  // Count sessions by todo state (scoped to workspace)
  const isMetaDone = (s: SessionMeta) => s.sessionStatus === 'done' || s.sessionStatus === 'cancelled'
  const flaggedCount = activeSessionMetas.filter(s => s.isFlagged).length
  const archivedCount = workspaceSessionMetas.filter(s => s.isArchived).length

  // Compute session counts per label (cumulative: parent includes descendants).
  // Flatten the tree for iteration, use the tree for descendant lookups.
  // Uses activeSessionMetas to exclude archived sessions from counts.
  const labelCounts = useMemo(() => {
    const allLabels = flattenLabels(labelConfigs)
    const counts: Record<string, number> = {}
    for (const label of allLabels) {
      // Direct count: sessions explicitly tagged with this label (handles valued entries like "priority::3")
      const directCount = activeSessionMetas.filter(
        s => s.labels?.some(l => extractLabelId(l) === label.id)
      ).length
      counts[label.id] = directCount
    }
    // Add descendant counts to parents (cumulative).
    // Only count sessions that have a descendant label but NOT the parent itself,
    // to avoid double-counting sessions that already carry the parent label.
    for (const label of allLabels) {
      const descendants = getDescendantIds(labelConfigs, label.id)
      if (descendants.length > 0) {
        const descendantOnlyCount = activeSessionMetas.filter(
          s => {
            const sessionLabelIds = s.labels?.map(l => extractLabelId(l)) ?? []
            const hasDescendant = sessionLabelIds.some(id => descendants.includes(id))
            const hasParent = sessionLabelIds.includes(label.id)
            return hasDescendant && !hasParent
          }
        ).length
        counts[label.id] = (counts[label.id] || 0) + descendantOnlyCount
      }
    }
    return counts
  }, [activeSessionMetas, labelConfigs])

  // Count sessions by individual todo state (dynamic based on effectiveSessionStatuses)
  // Uses activeSessionMetas to exclude archived sessions from counts.
  const sessionStatusCounts = useMemo(() => {
    const counts: Record<SessionStatusId, number> = {}
    // Initialize counts for all dynamic statuses
    for (const state of effectiveSessionStatuses) {
      counts[state.id] = 0
    }
    // Count sessions
    for (const s of activeSessionMetas) {
      const state = (s.sessionStatus || 'todo') as SessionStatusId
      // Increment count (initialize to 0 if status not in effectiveSessionStatuses yet)
      counts[state] = (counts[state] || 0) + 1
    }
    return counts
  }, [activeSessionMetas, effectiveSessionStatuses])

  // Per-status unseen accent dots (localStorage map, multi-window via storage event).
  const [unseenStatuses, setUnseenStatusesState] = useState<UnseenStatusMap>({})
  useEffect(() => {
    if (!activeWorkspaceId) {
      setUnseenStatusesState({})
      return
    }
    setUnseenStatusesState(getUnseenStatuses(activeWorkspaceId))
    return subscribeUnseenStatuses(activeWorkspaceId, setUnseenStatusesState)
  }, [activeWorkspaceId])


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

  // Count automations by type for the Automations dropdown subcategories
  const automationTypeCounts = useMemo(() => {
    const counts = { scheduled: 0, event: 0, agentic: 0 }
    for (const automation of automations) {
      if (automation.event === 'SchedulerTick') counts.scheduled++
      else if ((APP_EVENTS as string[]).includes(automation.event)) counts.event++
      else if ((AGENT_EVENTS as string[]).includes(automation.event)) counts.agentic++
    }
    return counts
  }, [automations])

  // Filter session metadata based on sidebar mode and chat filter
  const filteredSessionMetas = useMemo(() => {
    // When in sources mode, return empty (no sessions to show)
    if (!sessionFilter) {
      return []
    }

    let result: SessionMeta[]

    switch (sessionFilter.kind) {
      case 'allSessions':
        // "All Sessions" - shows active (non-archived) sessions
        result = activeSessionMetas
        break
      case 'flagged':
        result = activeSessionMetas.filter(s => s.isFlagged)
        break
      case 'archived':
        // Archived view shows only archived sessions
        result = workspaceSessionMetas.filter(s => s.isArchived)
        break
      case 'state':
        // Filter by specific todo state (excludes archived)
        result = activeSessionMetas.filter(s => (s.sessionStatus || 'todo') === sessionFilter.stateId)
        break
      case 'label': {
        // Shared predicate (handles '__all__', descendant labels, and the optional
        // project scope) — the same implementation the session list filters with,
        // so the two stay aligned by construction.
        result = activeSessionMetas.filter(s => matchesLabelFilter(s, sessionFilter, labelConfigs))
        break
      }
      case 'view': {
        // Filter by view: __all__ shows any session matched by any view,
        // otherwise filter to the specific view (excludes archived)
        result = activeSessionMetas.filter(s => {
          const matched = evaluateViews(s)
          if (sessionFilter.viewId === '__all__') {
            return matched.length > 0
          }
          return matched.some(v => v.id === sessionFilter.viewId)
        })
        break
      }
      default:
        result = activeSessionMetas
    }

    // Shared CollectionFilters path (FR-26/FR-31) — same pure helper as board/table.
    // sessionFilter.kind above remains the outer navigator predicate (smart views AND chips).
    {
      const filtersForQuery = (() => {
        const selected = collectionFilters.labels
        if (!selected?.length) return collectionFilters

        const expanded = new Set<string>()
        for (const id of selected) {
          expanded.add(id)
          for (const descendantId of getDescendantIds(labelConfigs, id)) {
            expanded.add(descendantId)
          }
        }
        return { ...collectionFilters, labels: Array.from(expanded) }
      })()
      const now = Date.now()
      const statusById = new Map(effectiveSessionStatuses.map(st => [st.id, st]))
      result = result.filter(meta =>
        filterSessionMeta(meta, filtersForQuery, {
          showCompleted: collectionDisplay.showCompleted,
          now,
          statusById,
        }),
      )
    }

    result.sort((a, b) => compareSessions(a, b, collectionDisplay.orderBy, collectionDisplay.orderDir))
    return result
  }, [workspaceSessionMetas, activeSessionMetas, sessionFilter, labelConfigs, collectionFilters, collectionDisplay.showCompleted, collectionDisplay.orderBy, collectionDisplay.orderDir, effectiveSessionStatuses])


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

  // Extend context value with local overrides (wrapped onDeleteSession, sources, skills, labels, enabledModes, rightSidebarOpenButton, effectiveSessionStatuses)
  const appShellContextValue = React.useMemo<AppShellContextType>(() => ({
    ...contextValue,
    registerCompactHeader,
    unregisterCompactHeader,
    compactHeaderRenderer,
    isCompactChatMode: isAutoCompact && isSessionsNavigation(navState) && !!navState.details,
    isCompactSettingsMode: isWebUI && isAutoCompact && isSettingsNavigation(navState),
    onDeleteSession: handleDeleteSession,
    enabledSources: sources,
    skills,
    activeSessionWorkingDirectory,
    labels: displayLabelConfigs,
    onSessionLabelsChange: handleSessionLabelsChange,
    projects: projectMenuOptions,
    onSetProjectId: handleSessionProjectChange,
    enabledModes,
    sessionStatuses: effectiveSessionStatuses,
    onSessionSourcesChange: handleSessionSourcesChange,
    onJumpToTaskSessions: handleJumpToTaskSessions,
    rightSidebarButton: null,
    isCompactMode: isAutoCompact,
    // Search state for ChatDisplay highlighting
    sessionListSearchQuery: searchActive ? searchQuery : undefined,
    isSearchModeActive: searchActive,
    chatDisplayRef,
    onChatMatchInfoChange: handleChatMatchInfoChange,
    onTestAutomation: handleTestAutomation,
    onToggleAutomation: handleToggleAutomation,
    onDuplicateAutomation: handleDuplicateAutomation,
    onDeleteAutomation: handleDeleteAutomation,
    automationTestResults,
    getAutomationHistory,
    onReplayAutomation: handleReplayAutomation,
  }), [contextValue, registerCompactHeader, unregisterCompactHeader, compactHeaderRenderer, isAutoCompact, navState, handleDeleteSession, sources, skills, activeSessionWorkingDirectory, displayLabelConfigs, handleSessionLabelsChange, projectMenuOptions, handleSessionProjectChange, enabledModes, effectiveSessionStatuses, handleSessionSourcesChange, handleJumpToTaskSessions, searchActive, searchQuery, handleChatMatchInfoChange, handleTestAutomation, handleToggleAutomation, handleDuplicateAutomation, handleDeleteAutomation, automationTestResults, getAutomationHistory, handleReplayAutomation])
  // Persist expanded folders to localStorage (workspace-scoped)
  React.useEffect(() => {
    if (!activeWorkspaceId) return
    storage.set(storage.KEYS.expandedFolders, [...expandedFolders], activeWorkspaceId)
  }, [expandedFolders, activeWorkspaceId])

  // Persist sidebar visibility to localStorage
  React.useEffect(() => {
    storage.set(storage.KEYS.sidebarVisible, isSidebarVisible)
  }, [isSidebarVisible])

  // Persist focus mode state to localStorage
  React.useEffect(() => {
    storage.set(storage.KEYS.focusModeEnabled, isSidebarAndNavigatorHidden)
  }, [isSidebarAndNavigatorHidden])

  // Listen for focus mode toggle from menu (View → Focus Mode)
  React.useEffect(() => {
    const cleanup = window.electronAPI.onMenuToggleFocusMode?.(() => {
      setIsSidebarAndNavigatorHidden(v => !v)
    })
    return cleanup
  }, [])

  // Mind map zen: collapse sidebar+navigator chrome (same as focus mode).
  React.useEffect(() => {
    const onZen = (event: Event) => {
      const detail = (event as CustomEvent<{ zen?: boolean }>).detail
      if (typeof detail?.zen === 'boolean') {
        setIsSidebarAndNavigatorHidden(detail.zen)
      }
    }
    window.addEventListener('craft-mindmap-zen', onZen)
    return () => window.removeEventListener('craft-mindmap-zen', onZen)
  }, [])

  // Listen for sidebar toggle from menu (View → Toggle Sidebar)
  React.useEffect(() => {
    const cleanup = window.electronAPI.onMenuToggleSidebar?.(() => {
      handleToggleSidebar()
    })
    return cleanup
  }, [handleToggleSidebar])

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

  const handleAllSessionsClick = useCallback(() => {
    navigate(routes.view.allSessions())
  }, [])

  const handleFlaggedClick = useCallback(() => {
    navigate(routes.view.flagged())
  }, [])

  const handleArchivedClick = useCallback(() => {
    navigate(routes.view.archived())
  }, [])

  // Handler for individual todo state views
  const handleSessionStatusClick = useCallback((stateId: SessionStatusId) => {
    if (activeWorkspaceId) clearStatusUnseen(activeWorkspaceId, stateId)
    navigate(routes.view.state(stateId))
  }, [activeWorkspaceId])

  // Handler for label filter views (hierarchical — includes descendant labels)
  const handleLabelClick = useCallback((labelId: string) => {
    navigate(routes.view.label(labelId))
  }, [])

  const handleViewClick = useCallback((viewId: string) => {
    navigate(routes.view.view(viewId))
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

  // Handler for memory view
  const handleMemoryClick = useCallback(() => {
    navigate(routes.view.memory())
  }, [])

  // Handler for workspace-local Notes.
  const handleNotesClick = useCallback(() => {
    navigate(routes.view.notes())
  }, [])

  // Handlers for automations view
  const handleAutomationsClick = useCallback(() => {
    navigate(routes.view.automations())
  }, [])

  // Handler for projects view
  const handleProjectsClick = useCallback(() => {
    navigate(routes.view.projects())
  }, [])

  const handleAutomationsScheduledClick = useCallback(() => {
    navigate(routes.view.automationsScheduled())
  }, [])

  const handleAutomationsEventClick = useCallback(() => {
    navigate(routes.view.automationsEvent())
  }, [])

  const handleAutomationsAgenticClick = useCallback(() => {
    navigate(routes.view.automationsAgentic())
  }, [])

  // Handler for settings view. With no arg → bare `settings` route (navigator-only
  // in compact mode, App fallback on desktop). With an arg → `settings/<subpage>`.
  const handleSettingsClick = useCallback((subpage?: SettingsSubpage) => {
    navigate(routes.view.settings(subpage))
  }, [])


  // ============================================================================
  // EDIT POPOVER STATE
  // ============================================================================
  // State to control which EditPopover is open (triggered from context menus).
  // We use controlled popovers instead of deep links so the user can type
  // their request in the popover UI before opening a new chat window.
  // add-source variants: add-source (generic), add-source-api, add-source-mcp, add-source-local
  const [editPopoverOpen, setEditPopoverOpen] = useState<'statuses' | 'labels' | 'views' | 'add-source' | 'add-source-api' | 'add-source-mcp' | 'add-source-local' | 'add-skill' | 'add-label' | 'automation-config' | 'add-project' | null>(null)

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

  // Handler for "Add Automation" context menu action
  // Opens the EditPopover for adding a new automation
  const openAddAutomation = useCallback(() => {
    captureContextMenuPosition()
    setTimeout(() => setEditPopoverOpen('automation-config'), 50)
  }, [captureContextMenuPosition])

  // Handler for "Add Project" context menu action — creates a project directly
  // Open the "Create Project" dialog so the user can provide a name up front.
  // The previous flow auto-created with the default name and produced ugly
  // permanent slugs (new-project, new-project-1, …).
  const [createProjectDialogOpen, setCreateProjectDialogOpen] = useState(false)
  const [webBrowserOpen, setWebBrowserOpen] = useState(false)

  React.useEffect(() => {
    if (!isWebUI) return
    const handleOpenBrowser = () => setWebBrowserOpen(true)
    window.addEventListener('craft:open-vps-browser', handleOpenBrowser)
    return () => window.removeEventListener('craft:open-vps-browser', handleOpenBrowser)
  }, [])

  const openAddProject = useCallback(() => {
    if (!activeWorkspace?.id) return
    setCreateProjectDialogOpen(true)
  }, [activeWorkspace?.id])
  const handleCreateProjectSubmit = useCallback(async (name: string) => {
    if (!activeWorkspace?.id) return
    setCreateProjectDialogOpen(false)
    try {
      const project = await window.electronAPI.createProject(activeWorkspace.id, { name })
      navigate(routes.view.projects(project.slug))
    } catch (err) {
      console.error('[AppShell] Failed to create project:', err)
      toast.error(t('projectsList.createFailed'))
    }
  }, [activeWorkspace?.id, navigate, t])

  /**
   * Resolve the "inherit sole active filter" rule for new sessions. Only
   * include-mode filters are candidates — an excluded status/label/project must
   * never be inherited (#970). See resolveInheritedFilterParams.
   */
  const resolveInheritedNewSessionParams = useCallback(() => {
    // Bridge shared CollectionFilters (include-OR chips) into the Map shape
    // resolveInheritedFilterParams expects. Exclude-mode is gone with FR-31.
    const statusMap = new Map((collectionFilters.status ?? []).map(id => [id, 'include' as const]))
    const labelMap = new Map((collectionFilters.labels ?? []).map(id => [id, 'include' as const]))
    const projectMap = new Map((collectionFilters.projectId ?? []).map(id => [id, 'include' as const]))
    return resolveInheritedFilterParams(statusMap, labelMap, projectMap)
  }, [collectionFilters])
  // Create a new chat and select it
  const handleNewChat = useCallback((newPanel: boolean = false) => {
    if (!activeWorkspace) return

    // Exit search mode and switch to All Sessions
    setSearchActive(false)
    setSearchQuery('')

    // Inherit the sole included filter into the new session when unambiguous.
    const inherited = resolveInheritedNewSessionParams()

    // Delegate to NavigationContext which handles session creation
    navigate(
      routes.action.newSession(inherited ?? undefined),
      newPanel ? { newPanel: true, targetLaneId: 'main' } : undefined
    )

    // Focus the chat input after navigation completes
    setTimeout(() => focusZone('chat', { intent: 'programmatic' }), 50)
  }, [activeWorkspace, focusZone, navigate, resolveInheritedNewSessionParams])

  // Create a brand new embedded browser panel and focus it.
  // Intentionally unbound: this action should always create a NEW panel.
  const handleNewBrowserWindow = useCallback(async () => {
    if (isWebUI) {
      setWebBrowserOpen(true)
      return
    }
    try {
      const instanceId = await window.electronAPI.browserPane.createEmbedded()
      navigate(routes.view.browser(instanceId), { newPanel: true, targetLaneId: 'main' })
    } catch (error) {
      console.error('[Chat] Failed to create browser panel:', error)
      toast.error(t('toast.failedToCreateBrowser'))
    }
  }, [navigate, t])

  // Delete Source - simplified since agents system is removed
  const handleDeleteSource = useCallback(async (sourceSlug: string) => {
    if (!activeWorkspace) return
    try {
      await window.electronAPI.deleteSource(activeWorkspace.id, sourceSlug)
      toast.success(t('toast.deletedSource'))
    } catch (error) {
      console.error('[Chat] Failed to delete source:', error)
      toast.error(t('toast.failedToDeleteSource'))
    }
  }, [activeWorkspace])

  // Delete Skill
  const handleDeleteSkill = useCallback(async (skillSlug: string) => {
    if (!activeWorkspace) return
    try {
      await window.electronAPI.deleteSkill(activeWorkspace.id, skillSlug)
      toast.success(t('toast.deletedSkill', { slug: skillSlug }))
    } catch (error) {
      console.error('[Chat] Failed to delete skill:', error)
      toast.error(t('toast.failedToDeleteSkill'))
    }
  }, [activeWorkspace])

  // Respond to menu bar "New Chat" trigger
  const menuTriggerRef = useRef(menuNewChatTrigger)
  useEffect(() => {
    // Skip initial render
    if (menuTriggerRef.current === menuNewChatTrigger) return
    menuTriggerRef.current = menuNewChatTrigger
    handleNewChat()
  }, [menuNewChatTrigger, handleNewChat])

  // Unified sidebar items: nav buttons only (agents system removed)
  type SidebarItem = {
    id: string
    type: 'nav'
    action?: () => void
  }

  const unifiedSidebarItems = React.useMemo((): SidebarItem[] => {
    const result: SidebarItem[] = []

    // 1. Sessions section: All Sessions (expandable) with status items, Flagged, Archived as children
    result.push({ id: 'nav:allSessions', type: 'nav', action: handleAllSessionsClick })
    for (const state of effectiveSessionStatuses) {
      result.push({ id: `nav:state:${state.id}`, type: 'nav', action: () => handleSessionStatusClick(state.id) })
    }
    result.push({ id: 'nav:flagged', type: 'nav', action: handleFlaggedClick })
    result.push({ id: 'nav:archived', type: 'nav', action: handleArchivedClick })

    // 2. Labels section header + regular label tree for keyboard nav
    result.push({ id: 'nav:labels', type: 'nav', action: () => handleLabelClick('__all__') })
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

    // 3. Destinations (matches APP_NAV_DESTINATIONS / sidebar order)
    result.push({ id: 'nav:projects', type: 'nav', action: handleProjectsClick })
    result.push({ id: 'nav:memory', type: 'nav', action: handleMemoryClick })
    result.push({ id: 'nav:sources', type: 'nav', action: handleSourcesClick })
    result.push({ id: 'nav:skills', type: 'nav', action: handleSkillsClick })
    result.push({ id: 'nav:notes', type: 'nav', action: handleNotesClick })
    result.push({ id: 'nav:automations', type: 'nav', action: handleAutomationsClick })
    result.push({ id: 'nav:settings', type: 'nav', action: () => handleSettingsClick() })

    return result
  }, [handleAllSessionsClick, handleFlaggedClick, handleArchivedClick, handleSessionStatusClick, effectiveSessionStatuses, handleLabelClick, labelConfigs, labelTree, viewConfigs, handleViewClick, handleSourcesClick, handleSkillsClick, handleMemoryClick, handleNotesClick, handleProjectsClick, handleAutomationsClick, handleSettingsClick])

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
        // Move to next zone (navigator) - keyboard navigation
        focusZone('navigator', { intent: 'keyboard' })
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
    // Knowledge navigator
    if (isKnowledgeNavigation(navState)) {
      return t('knowledge.nav.title')
    }

    // Sources navigator
    if (isSourcesNavigation(navState)) {
      return t("sidebar.sources")
    }

    // Skills navigator
    if (isSkillsNavigation(navState)) {
      return t("sidebar.allSkills")
    }

    // Memory navigator
    if (isMemoryNavigation(navState)) {
      return t("sidebar.memory")
    }

    if (isConnectionsNavigation(navState)) {
      return t("sidebar.connections")
    }

    // Projects navigator
    if (isProjectsNavigation(navState)) {
      return t("sidebar.allProjects")
    }

    // Notes navigator
    if (isNotesNavigation(navState)) {
      return t("sidebar.notes")
    }

    // Automations navigator
    if (isAutomationsNavigation(navState)) {
      if (!automationFilter) return t("sidebar.allAutomations")
      switch (automationFilter.automationType) {
        case 'scheduled': return t("sidebar.scheduled")
        case 'event': return t("sidebar.eventBased")
        case 'agentic': return t("sidebar.agentic")
        default: return t("sidebar.allAutomations")
      }
    }

    // Settings navigator
    if (isSettingsNavigation(navState)) return t("sidebar.settings")

    // Sessions navigator - use sessionFilter
    if (!sessionFilter) return t("sidebar.allSessions")

    switch (sessionFilter.kind) {
      case 'flagged':
        return t("sidebar.flagged")
      case 'state': {
        const state = effectiveSessionStatuses.find(s => s.id === sessionFilter.stateId)
        return state ? t(`status.${state.id}`, state.label) : t("sidebar.allSessions")
      }
      case 'label':
        return sessionFilter.labelId === '__all__' ? t("sidebar.labels") : getLabelDisplayName(labelConfigs, sessionFilter.labelId)
      case 'view':
        return sessionFilter.viewId === '__all__' ? t("sidebar.views") : viewConfigs.find(v => v.id === sessionFilter.viewId)?.name || t("sidebar.views")
      default:
        return t("sidebar.allSessions")
    }
  }, [navState, t, sessionFilter, automationFilter, labelConfigs, viewConfigs, effectiveSessionStatuses])

  // Build recursive sidebar items from the shared display-sorted label tree.
  // Each node renders with condensed height (compact: true) since many labels expected.
  // Clicking any label navigates to its filter view; the chevron toggles expand/collapse.
  const buildLabelSidebarItems = useCallback((nodes: LabelTreeNode[]): any[] => {
    return nodes.map(node => {
      const hasChildren = node.children.length > 0
      const isActive = sessionFilter?.kind === 'label' && sessionFilter.labelId === node.fullId
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
              {t("sidebar.labelValueTypeTooltip", { valueType: t(`sidebar.labelValueType.${node.label.valueType}`) })}
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
  }, [sessionFilter, labelCounts, activeWorkspace?.id, handleLabelClick, isExpanded, toggleExpanded, openConfigureLabels, handleAddLabel, handleDeleteLabel])

  return (
    <AppShellProvider value={appShellContextValue}>
        {/* === TOP BAR === */}
        <TopBar
          workspaces={workspaces}
          activeWorkspaceId={activeWorkspaceId}
          onSelectWorkspace={onSelectWorkspace}
          workspaceUnreadMap={workspaceUnreadMap}
          onWorkspaceCreated={() => onRefreshWorkspaces?.()}
          onWorkspaceRemoved={() => onRefreshWorkspaces?.()}
          activeSessionId={effectiveSessionId}
          onNewChat={() => handleNewChat()}
          onNewWindow={() => window.electronAPI.menuNewWindow()}
          onOpenSettings={onOpenSettings}
          onOpenSettingsSubpage={handleSettingsClick}
          onOpenStoredUserPreferences={onOpenStoredUserPreferences}
          onBack={goBack}
          onForward={goForward}
          canGoBack={canGoBack}
          canGoForward={canGoForward}
          onToggleSidebar={handleToggleSidebar}
          onToggleFocusMode={() => setIsSidebarAndNavigatorHidden(prev => !prev)}
          onAddSessionPanel={() => handleNewChat(true)}
          onAddBrowserPanel={() => { void handleNewBrowserWindow() }}
          compactHeaderRenderer={compactHeaderRenderer}
          isCompactChatMode={isAutoCompact && isSessionsNavigation(navState) && !!navState.details}
          isCompactSettingsMode={isWebUI && isAutoCompact && isSettingsNavigation(navState)}
          isCompact={isAutoCompact}
          showWorkspaceSelector={showTopBarWorkspaceSelector || isAutoCompact}
          leftInset={topBarLeftInset}
        />

        {isWebUI && <WebBrowserPanel open={webBrowserOpen} onClose={() => setWebBrowserOpen(false)} />}

      {/* === OUTER LAYOUT: Unified Panel Stack | Right Sidebar === */}
      <div
        ref={shellRef}
        className="flex items-stretch relative"
        style={{
          height: '100%',
          paddingRight: isAutoCompact ? 0 : PANEL_EDGE_INSET,
          paddingBottom: isAutoCompact ? 0 : PANEL_EDGE_INSET,
          paddingLeft: 0,
          gap: PANEL_GAP,
        }}
      >
        {/* PR-2 Workbench host: legacy children remain unchanged until both
            operator capability and explicit user preference are true. */}
        <WorkspaceSurfaceHost operatorCapability={workbenchOperatorCapability}>
          <PanelStackContainer
          sidebarSlot={
            <div
              ref={sidebarRef}
              style={{ width: sidebarWidth }}
              className="h-full font-sans relative"
              data-focus-zone="sidebar"
              tabIndex={sidebarFocused ? 0 : -1}
              onKeyDown={handleSidebarKeyDown}
            >
            <div className="flex h-full flex-col select-none">
              {/* Sidebar Top Section */}
              <div className="flex-1 flex flex-col min-h-0">
                {/* New Session Button - Gmail-style, with context menu for "Open in New Window" */}
                <div className="px-2 pb-2 shrink-0">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div>
                        <ContextMenu modal={true}>
                          <ContextMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              onClick={(e) => handleNewChat(e.metaKey || e.ctrlKey)}
                              className="w-full justify-start gap-2 py-[7px] px-2 text-[13px] font-normal rounded-[6px] shadow-minimal bg-background"
                              data-tutorial="new-chat-button"
                            >
                              <SquarePenRounded className="h-3.5 w-3.5 shrink-0" />
                              {t("session.newSession")}
                            </Button>
                          </ContextMenuTrigger>
                          <StyledContextMenuContent>
                            <ContextMenuProvider>
                              <SidebarMenu type="newSession" />
                            </ContextMenuProvider>
                          </StyledContextMenuContent>
                        </ContextMenu>
                      </div>
                    </TooltipTrigger>
                    <TooltipContent side="right">{newChatHotkey}</TooltipContent>
                  </Tooltip>
                </div>
                {/* Primary Nav: Sessions → Labels → Projects | Memory…Knowledge | Automations → Settings */}
                {/* pb-4 provides clearance so the last item scrolls above the mask-fade-bottom gradient */}
                <div className="flex-1 overflow-y-auto min-h-0 mask-fade-bottom pb-4">
                <LeftSidebar
                  isCollapsed={false}
                  getItemProps={getSidebarItemProps}
                  focusedItemId={focusedSidebarItemId}
                  links={[
                    // --- Sessions Section ---
                    // All Sessions: expandable with status children (sortable) + Flagged & Archived as trailing items
                    {
                      id: "nav:allSessions",
                      title: t(APP_NAV_DESTINATIONS_BY_ID.sessions.labelKey),
                      label: String(workspaceSessionMetas.length),
                      icon: APP_NAV_DESTINATIONS_BY_ID.sessions.icon,
                      variant: sessionFilter?.kind === 'allSessions' ? "default" : "ghost",
                      onClick: handleAllSessionsClick,
                      expandable: true,
                      expanded: isExpanded('nav:allSessions'),
                      onToggle: () => toggleExpanded('nav:allSessions'),
                      contextMenu: {
                        type: 'allSessions',
                        onConfigureStatuses: openConfigureStatuses,
                        onMarkAllRead: () => {
                          if (!activeWorkspaceId) return
                          // Optimistic: clear hasUnread on all workspace session metas
                          setSessionMetaMap(prev => {
                            const next = new Map(prev)
                            for (const [id, meta] of next) {
                              if (meta.workspaceId === activeWorkspaceId && meta.hasUnread) {
                                next.set(id, { ...meta, hasUnread: false })
                              }
                            }
                            return next
                          })
                          window.electronAPI.markAllSessionsRead(activeWorkspaceId)
                        },
                      },
                      // Enable flat DnD reorder for status items
                      sortable: { onReorder: handleStatusReorder },
                      items: [
                        // Status items (sortable via SortableStatusList)
                        ...effectiveSessionStatuses.map(state => ({
                          id: `nav:state:${state.id}`,
                          title: t(`status.${state.id}`, state.label),
                          label: String(sessionStatusCounts[state.id] || 0),
                          icon: state.icon,
                          iconColor: state.resolvedColor,
                          iconColorable: state.iconColorable,
                          variant: (sessionFilter?.kind === 'state' && sessionFilter.stateId === state.id ? "default" : "ghost") as "default" | "ghost",
                          onClick: () => handleSessionStatusClick(state.id),
                          // Accent dot when a session landed in this bucket since last open.
                          hasUnseen: !!unseenStatuses[state.id],
                          contextMenu: {
                            type: 'status' as const,
                            statusId: state.id,
                            onConfigureStatuses: openConfigureStatuses,
                          },
                        })),
                        // Separator: SortableStatusList splits here — items after become non-sortable trailingItems
                        { id: 'separator:states-flagged', type: 'separator' as const },
                        // Flagged (trailing, non-sortable)
                        {
                          id: "nav:flagged",
                          title: t("sidebar.flagged"),
                          label: String(flaggedCount),
                          icon: <Flag className="h-3.5 w-3.5" />,
                          variant: (sessionFilter?.kind === 'flagged' ? "default" : "ghost") as "default" | "ghost",
                          onClick: handleFlaggedClick,
                        },
                        // Archived (trailing, non-sortable)
                        {
                          id: "nav:archived",
                          title: t("sidebar.archived"),
                          label: archivedCount > 0 ? String(archivedCount) : undefined,
                          icon: Archive,
                          variant: (sessionFilter?.kind === 'archived' ? "default" : "ghost") as "default" | "ghost",
                          onClick: handleArchivedClick,
                        },
                      ],
                    },
                    // Labels: navigable header (shows all labeled sessions) + hierarchical tree (drag-and-drop reorder + re-parent)
                    {
                      id: "nav:labels",
                      title: t("sidebar.labels"),
                      icon: Tag,
                      // Only highlighted when "Labels" itself is selected (not sub-labels)
                      variant: (sessionFilter?.kind === 'label' && sessionFilter.labelId === '__all__') ? "default" as const : "ghost" as const,
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
                    // --- Projects (after session chrome) ---
                    {
                      id: "nav:projects",
                      title: t(APP_NAV_DESTINATIONS_BY_ID.projects.labelKey),
                      label: String(projects.length),
                      icon: APP_NAV_DESTINATIONS_BY_ID.projects.icon,
                      // Highlight only when on Projects view itself, not when a child is "active" (jumped-to filter)
                      variant: isProjectsNavigation(navState) ? "default" : "ghost",
                      onClick: handleProjectsClick,
                      expandable: projects.length > 0,
                      expanded: isExpanded('nav:projects'),
                      onToggle: () => toggleExpanded('nav:projects'),
                      contextMenu: {
                        type: 'projects' as const,
                        onAddProject: openAddProject,
                      },
                      items: projects.map(p => ({
                        id: `nav:projects:${p.config.id}`,
                        title: p.config.name,
                        icon: FolderKanban,
                        // Highlight when on allSessions view AND filter includes this project (the jump-to state)
                        variant: (sessionFilter?.kind === 'allSessions' && (collectionFilters.projectId ?? []).includes(p.config.id)) ? "default" as const : "ghost" as const,
                        onClick: () => handleJumpToProjectSessions(p.config.id),
                      })),
                    },
                    // --- Separator after projects ---
                    { id: "separator:projects-memory", type: "separator" },
                    // --- Memory ---
                    {
                      id: "nav:memory",
                      title: t(APP_NAV_DESTINATIONS_BY_ID.memory.labelKey),
                      icon: APP_NAV_DESTINATIONS_BY_ID.memory.icon,
                      variant: isMemoryNavigation(navState) ? "default" : "ghost",
                      onClick: handleMemoryClick,
                    },
                    // --- Sources ---
                    {
                      id: "nav:sources",
                      title: t(APP_NAV_DESTINATIONS_BY_ID.sources.labelKey),
                      label: String(sources.length),
                      icon: APP_NAV_DESTINATIONS_BY_ID.sources.icon,
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
                          title: t("sidebar.apis"),
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
                          title: t("sidebar.mcps"),
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
                          title: t("sidebar.localFolders"),
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
                      title: t(APP_NAV_DESTINATIONS_BY_ID.skills.labelKey),
                      label: String(skills.length),
                      icon: APP_NAV_DESTINATIONS_BY_ID.skills.icon,
                      variant: isSkillsNavigation(navState) ? "default" : "ghost",
                      onClick: handleSkillsClick,
                      contextMenu: {
                        type: 'skills',
                        onAddSkill: openAddSkill,
                      },
                    },
                    {
                      id: "nav:notes",
                      title: t(APP_NAV_DESTINATIONS_BY_ID.notes.labelKey),
                      icon: APP_NAV_DESTINATIONS_BY_ID.notes.icon,
                      variant: isNotesNavigation(navState) ? "default" : "ghost",
                      onClick: handleNotesClick,
                    },
                    // --- Separator before footer ---
                    { id: "separator:notes-automations", type: "separator" },
                    {
                      id: "nav:automations",
                      title: t(APP_NAV_DESTINATIONS_BY_ID.automations.labelKey),
                      label: String(automations.length),
                      icon: APP_NAV_DESTINATIONS_BY_ID.automations.icon,
                      variant: (isAutomationsNavigation(navState) && !automationFilter) ? "default" : "ghost",
                      onClick: handleAutomationsClick,
                      expandable: true,
                      expanded: isExpanded('nav:automations'),
                      onToggle: () => toggleExpanded('nav:automations'),
                      contextMenu: {
                        type: 'automations' as const,
                        onAddAutomation: openAddAutomation,
                      },
                      items: [
                        {
                          id: "nav:automations:scheduled",
                          title: t("sidebar.scheduled"),
                          label: String(automationTypeCounts.scheduled),
                          icon: Clock,
                          variant: (automationFilter?.kind === 'type' && automationFilter.automationType === 'scheduled') ? "default" : "ghost",
                          onClick: handleAutomationsScheduledClick,
                          contextMenu: { type: 'automations' as const, onAddAutomation: openAddAutomation },
                        },
                        {
                          id: "nav:automations:event",
                          title: t("sidebar.eventBased"),
                          label: String(automationTypeCounts.event),
                          icon: Radio,
                          variant: (automationFilter?.kind === 'type' && automationFilter.automationType === 'event') ? "default" : "ghost",
                          onClick: handleAutomationsEventClick,
                          contextMenu: { type: 'automations' as const, onAddAutomation: openAddAutomation },
                        },
                        {
                          id: "nav:automations:agentic",
                          title: t("sidebar.agentic"),
                          label: String(automationTypeCounts.agentic),
                          icon: Bot,
                          variant: (automationFilter?.kind === 'type' && automationFilter.automationType === 'agentic') ? "default" : "ghost",
                          onClick: handleAutomationsAgenticClick,
                          contextMenu: { type: 'automations' as const, onAddAutomation: openAddAutomation },
                        },
                      ],
                    },
                    // --- Settings (What's New moved to TopBar) ---
                    {
                      id: "nav:settings",
                      title: t(APP_NAV_DESTINATIONS_BY_ID.settings.labelKey),
                      icon: APP_NAV_DESTINATIONS_BY_ID.settings.icon,
                      variant: isSettingsNavigation(navState) ? "default" : "ghost",
                      onClick: () => handleSettingsClick(),
                    },
                  ]}
                />
                {/* Agent Tree: Hierarchical list of agents */}
                {/* Agents section removed */}
                </div>
                {/* Pinned profile strip — opens Settings */}
                <div className="shrink-0 border-t border-foreground/5 px-1 py-1.5">
                  <ProfileStrip
                    data={profileStrip}
                    onClick={() => handleSettingsClick()}
                  />
                </div>
              </div>

            </div>
          </div>
          }
          sidebarWidth={effectiveSidebarAndNavigatorHidden ? 0 : (isSidebarVisible ? sidebarWidth : 0)}
          navigatorSlot={(isNotesNavigation(navState) || isConnectionsNavigation(navState)) ? null : (
            <div
              style={{ width: isAutoCompact ? '100%' : sessionListWidth }}
              className="h-full flex flex-col min-w-0 relative z-panel"
            >
            <PanelHeader
                title={isSidebarVisible ? listTitle : undefined}
                compensateForStoplight={!isSidebarVisible}
                badge={automationFilter?.automationType === 'scheduled' ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="text-muted-foreground/50 cursor-default flex items-center titlebar-no-drag">
                      <Info className="h-3 w-3" />
                    </span>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="max-w-[220px]">
                    Scheduling requires your machine to be running. It can be locked, but must be powered on.
                  </TooltipContent>
                </Tooltip>
              ) : undefined}
              actions={
                <>
                  {/* FR-26/FR-31: shared CollectionFilters + Display chrome for list mode.
                      Board/table hosts own their OpsBar; list uses full (non-compact) chrome. */}
                  {isSessionsNavigation(navState) && navState.viewMode !== 'board' && navState.viewMode !== 'table' && (
                    <CollectionViewChrome
                      workspaceId={activeWorkspaceId}
                      viewMode="list"
                      onViewModeChange={view => {
                        if (view === 'board') navigate(routes.view.board())
                        else if (view === 'table') navigate(routes.view.table())
                      }}
                      compact={false}
                      statuses={effectiveSessionStatuses}
                      projects={projects.map(pr => ({ id: pr.config.id, name: pr.config.name }))}
                      labels={displayLabelConfigs.map(l => ({ id: l.id, name: l.name }))}
                    />
                  )}
                  {isProjectsNavigation(navState) && activeWorkspace && (
                    <HeaderIconButton
                      icon={<Plus className="h-4 w-4" />}
                      tooltip={t("sidebarMenu.addProject")}
                      onClick={openAddProject}
                    />
                  )}
                  {isWebUI && isAutoCompact && isSettingsNavigation(navState) && (
                    <HeaderMenu route={routes.view.settings()} />
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
            {isKnowledgeNavigation(navState) && (
              /* Knowledge Navigator — SiYuan notebook/doc tree (W2, prop-less self-contained) */
              <KnowledgeNavigator />
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
            {isMemoryNavigation(navState) && (
              /* Memory (self-learning lessons / context / history) */
              <MemoryListPanel workspaceId={activeWorkspaceId ?? undefined} />
            )}
            {isProjectsNavigation(navState) && activeWorkspaceId && (
              /* Projects List */
              <ProjectsListPanel
                projects={projects}
                workspaceId={activeWorkspaceId}
                onProjectClick={(slug) => navigate(routes.view.projects(slug))}
                onAddProject={openAddProject}
                onJumpToSessions={handleJumpToProjectSessions}
                selectedProjectSlug={isProjectsNavigation(navState) ? navState.details?.projectSlug ?? null : null}
              />
            )}
            {isAutomationsNavigation(navState) && (
              /* Automations List - filtered by type if automationFilter is active */
              <AutomationsListPanel
                automations={automations}
                automationFilter={automationFilter ? { kind: AUTOMATION_TYPE_TO_FILTER_KIND[automationFilter.automationType] ?? 'all' } : undefined}
                onAutomationClick={handleAutomationSelect}
                onTestAutomation={handleTestAutomation}
                onToggleAutomation={handleToggleAutomation}
                onDuplicateAutomation={handleDuplicateAutomation}
                onDeleteAutomation={handleDeleteAutomation}
                selectedAutomationId={isAutomationsNavigation(navState) && navState.details ? navState.details.automationId : null}
                workspaceRootPath={activeWorkspace?.rootPath}
              />
            )}
            {isSettingsNavigation(navState) && (
              /* Settings Navigator */
              <SettingsNavigator
                selectedSubpage={navState.subpage}
                onSelectSubpage={(subpage) => handleSettingsClick(subpage)}
              />
            )}
            {isSessionsNavigation(navState) && (
              /* Sessions List */
              <>
                {/* SessionList: Scrollable list of session cards */}
                {/* Key on sidebarMode forces full remount when switching views, skipping animations */}
                <SessionList
                  key={sessionFilter?.kind}
                  items={searchActive ? workspaceSessionMetas : filteredSessionMetas}
                  onDelete={handleDeleteSession}
                  onFlag={onFlagSession}
                  onUnflag={onUnflagSession}
                  onArchive={onArchiveSession}
                  onUnarchive={onUnarchiveSession}
                  onMarkUnread={onMarkSessionUnread}
                  onSessionStatusChange={onSessionStatusChange}
                  onRename={onRenameSession}
                  onFocusChatInput={(targetSessionId) => {
                    focusChatInputForSession(targetSessionId ?? focusedSessionId ?? session.selected)
                  }}
                  onSessionSelect={(selectedMeta) => {
                    navigateToSession(selectedMeta.id)
                  }}
                  onOpenInNewWindow={(selectedMeta) => {
                    if (activeWorkspaceId) {
                      window.electronAPI.openSessionInNewWindow(activeWorkspaceId, selectedMeta.id)
                    }
                  }}
                  onNavigateToView={(view) => {
                    if (view === 'allSessions') {
                      navigate(routes.view.allSessions())
                    } else if (view === 'flagged') {
                      navigate(routes.view.flagged())
                    }
                  }}
                  sessionOptions={sessionOptions}
                  searchActive={searchActive || searchQuery.length > 0}
                  searchQuery={searchQuery}
                  onSearchChange={(q) => {
                    setSearchQuery(q)
                    if (q.length > 0) setSearchActive(true)
                  }}
                  onSearchClose={() => {
                    setSearchActive(false)
                    setSearchQuery('')
                  }}
                  sessionStatuses={effectiveSessionStatuses}
                  evaluateViews={evaluateViews}
                  labels={displayLabelConfigs}
                  onLabelsChange={handleSessionLabelsChange}
                  projects={projectMenuOptions}
                  onSetProjectId={handleSessionProjectChange}
                  groupingMode={chatGroupingMode}
                  workspaceId={activeWorkspaceId ?? undefined}
                  focusedSessionId={panelCount === 0 ? null : panelCount > 1 ? focusedSessionId : undefined}
                  onNavigateToSession={panelCount > 1 ? navigateToSessionInPanel : undefined}
                  hasPendingPrompt={hasPendingPrompt}
                  activeChatMatchInfo={chatMatchInfo}
                />
              </>
            )}
            {/* Mobile/compact-only FAB for starting a new chat — only on the
                session list itself, not when a chat is open (it would overlap
                the chat input). */}
            {isAutoCompact && isSessionsNavigation(navState) && !navState.details && (
              <FabNewChat onClick={() => handleNewChat()} />
            )}
            </div>
          )}
          navigatorWidth={(isNotesNavigation(navState) || isConnectionsNavigation(navState)) ? 0 : (isAutoCompact ? sessionListWidth : (effectiveSidebarAndNavigatorHidden || isBoardView ? 0 : sessionListWidth))}
          isSidebarAndNavigatorHidden={effectiveSidebarAndNavigatorHidden}
          isRightSidebarVisible={false}
          isCompact={isAutoCompact}
          isResizing={!!isResizing}
        />
        </WorkspaceSurfaceHost>

        {/* Sidebar Resize Handle (absolute, hidden in focused mode) */}
        {!effectiveSidebarAndNavigatorHidden && (
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
          className="absolute cursor-col-resize z-panel flex justify-center"
          style={{
            width: PANEL_SASH_HIT_WIDTH,
            top: PANEL_STACK_VERTICAL_OVERFLOW,
            bottom: PANEL_STACK_VERTICAL_OVERFLOW,
            left: unifiedRailOffset + (isSidebarVisible
              ? sidebarWidth + (PANEL_GAP / 2) - PANEL_SASH_HALF_HIT_WIDTH
              : -PANEL_GAP),
            transition: isResizing === 'sidebar' ? undefined : 'left 0.15s ease-out',
          }}
        >
          <div
            className="h-full"
            style={{
              ...getResizeGradientStyle(sidebarHandleY, resizeHandleRef.current?.clientHeight ?? null),
              width: PANEL_SASH_LINE_WIDTH,
            }}
          />
        </div>
        )}

        {/* Session List Resize Handle (absolute, hidden in focused mode and board view) */}
        {!effectiveSidebarAndNavigatorHidden && !isBoardView && (
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
          className="absolute cursor-col-resize z-panel flex justify-center"
          style={{
            width: PANEL_SASH_HIT_WIDTH,
            top: PANEL_STACK_VERTICAL_OVERFLOW,
            bottom: PANEL_STACK_VERTICAL_OVERFLOW,
            left:
              unifiedRailOffset +
              (isSidebarVisible ? sidebarWidth + PANEL_GAP : PANEL_EDGE_INSET) +
              sessionListWidth +
              (PANEL_GAP / 2) -
              PANEL_SASH_HALF_HIT_WIDTH,
            transition: isResizing === 'session-list' ? undefined : 'left 0.15s ease-out',
          }}
        >
          <div
            className="h-full"
            style={{
              ...getResizeGradientStyle(sessionListHandleY, sessionListHandleRef.current?.clientHeight ?? null),
              width: PANEL_SASH_LINE_WIDTH,
            }}
          />
        </div>
        )}

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
          {/* Add Automation EditPopover - triggered from "Add Automation" context menu in automations */}
          <EditPopover
            open={editPopoverOpen === 'automation-config'}
            onOpenChange={(isOpen) => setEditPopoverOpen(isOpen ? 'automation-config' : null)}
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
            {...getEditConfig('automation-config', activeWorkspace.rootPath)}
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


      {/* Delete automation confirmation dialog */}
      <Dialog open={!!automationPendingDelete} onOpenChange={(open) => { if (!open) setAutomationPendingDelete(null) }}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>{t("dialog.deleteAutomation.title")}</DialogTitle>
            <DialogDescription>
              <Trans
                i18nKey="dialog.deleteAutomation.description"
                values={{ name: pendingDeleteAutomation?.name }}
                components={{ strong: <strong /> }}
              />
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAutomationPendingDelete(null)}>{t("common.cancel")}</Button>
            <Button variant="destructive" onClick={confirmDeleteAutomation}>{t("common.delete")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Send to Workspace dialog (driven by sendToWorkspaceAtom) */}
      <SendToWorkspaceDialog
        open={sendToWorkspaceIds.length > 0}
        onOpenChange={(open) => { if (!open) setSendToWorkspaceIds([]) }}
        sessionIds={sendToWorkspaceIds}
        workspaces={workspaces}
        activeWorkspaceId={activeWorkspaceId}
        onTransferComplete={handleTransferComplete}
      />

      {/* Create Project dialog — prompts for a name so slugs stay meaningful */}
      <CreateProjectDialog
        open={createProjectDialogOpen}
        onCancel={() => setCreateProjectDialogOpen(false)}
        onSubmit={handleCreateProjectSubmit}
      />

      {/* Messaging dialogs (pairing-code + WA connect) — driven by messagingDialogAtom.
          Mounted here so they survive context-menu / dropdown close. */}
      <MessagingDialogHost />
      <PublishSessionDialogHost />

      {/* Y4: first-run memory onboarding — shown once when no lessons exist */}
      <OnboardingDialog workspaceId={activeWorkspaceId ?? undefined} />

    </AppShellProvider>
  )
}
