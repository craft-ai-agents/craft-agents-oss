import * as React from "react"
import { useTranslation, Trans } from "react-i18next"
import { useRef, useState, useEffect, useCallback, useMemo } from "react"
import { useAtomValue, useStore } from "jotai"
import {
  Archive,
  Settings,
  ChevronRight,
  ChevronDown,
  MoreHorizontal,
  RotateCw,
  Tag,
  Search,
  Plus,
  DatabaseZap,
  Globe,
  FolderOpen,
  Cake,
  ListTodo,
  Clock,
  Radio,
  Bot,
  Info,
} from "lucide-react"
import { TopBar } from "./TopBar"
import { SquarePenRounded } from "../icons/SquarePenRounded"
import { McpIcon } from "../icons/McpIcon"
import { Button } from "@/components/ui/button"
import { HeaderIconButton } from "@/components/ui/HeaderIconButton"
import { Tooltip, TooltipTrigger, TooltipContent, DocumentFormattedMarkdownOverlay } from "@craft-agent/ui"
import {
  ContextMenu,
  ContextMenuTrigger,
  StyledContextMenuContent,
} from "@/components/ui/styled-context-menu"
import { ContextMenuProvider } from "@/components/ui/menu-context"
import { SidebarMenu } from "./SidebarMenu"
import { SessionList, type SessionListHeightBehavior } from "./SessionList"
import { MainContentPanel } from "./MainContentPanel"
import { PanelStackContainer } from "./PanelStackContainer"
import { RightSidebarPanel } from "@/components/right-sidebar/RightSidebarPanel"
import { EditorDetailPanel } from "@/components/editor/EditorDetailPanel"
import type { ChatDisplayHandle } from "./ChatDisplay"
import { LeftSidebar } from "./LeftSidebar"
import { useSession } from "@/hooks/useSession"
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
import { sourcesAtom } from "@/atoms/sources"
import { skillsAtom } from "@/atoms/skills"
import { panelStackAtom, panelCountAtom, focusedPanelIdAtom, focusedSessionIdAtom, focusNextPanelAtom, focusPrevPanelAtom } from "@/atoms/panel-stack"
import { openFileTabAtom, hasOpenTabsAtom } from "@/atoms/editor-tabs"
import { type SessionStatus, statusConfigsToSessionStatuses } from "@/config/session-status-config"
import { useStatuses } from "@/hooks/useStatuses"
import { useLabels } from "@/hooks/useLabels"
import { useViews } from "@/hooks/useViews"
import { useContainerWidth } from "@/hooks/useContainerWidth"
import { LabelIcon, LabelValueTypeIcon } from "@/components/ui/label-icon"
import { buildLabelTree, getDescendantIds, getLabelDisplayName, flattenLabels, extractLabelId, findLabelById, sortLabelsForDisplay } from "@craft-agent/shared/labels"
import type { LabelConfig, LabelTreeNode } from "@craft-agent/shared/labels"
import { resolveEntityColor } from "@craft-agent/shared/colors"
import * as storage from "@/lib/local-storage"
import { toast } from "sonner"
import { navigate, routes } from "@/lib/navigate"
import {
  useNavigation,
  useNavigationState,
  isSessionsNavigation,
  isSourcesNavigation,
  isSettingsNavigation,
  isLocalSkillsNavigation,
  isSkillMarketplaceNavigation,
  isAutomationsNavigation,
  isArchivedNavigation,
  type NavigationState,
} from "@/contexts/NavigationContext"
import type { SettingsSubpage } from "../../../shared/types"
import { SourcesListPanel } from "./SourcesListPanel"
import { ArchivedSessionsPanel } from "./ArchivedSessionsPanel"
import { SkillsListPanel } from "./SkillsListPanel"
import { SkillImportModal } from "./SkillImportModal"
import { McpSourceFormDialog } from "./McpSourceFormDialog"
import { AutomationsListPanel } from "../automations/AutomationsListPanel"
import { APP_EVENTS, AGENT_EVENTS, type AutomationFilterKind, AUTOMATION_TYPE_TO_FILTER_KIND } from "../automations/types"
import { useAutomations } from "@/hooks/useAutomations"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog"
import { PanelHeader } from "./PanelHeader"
import { FabNewChat } from "./FabNewChat"
import { SendToWorkspaceDialog } from "./SendToWorkspaceDialog"
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
import { resolveSidebarLayout } from "./sidebar-layout"
import {
  createSkillsSidebarItems,
  LOCAL_SKILLS_NAV_ID,
  SKILL_MARKETPLACE_NAV_ID,
} from "./skills-sidebar-items"
import {
  loadRightSidebarOpenPreference,
  persistRightSidebarOpenPreference,
  resolvePanelStackRightSidebarVisible,
  resolveRightSidebarContextualAvailability,
} from "./right-sidebar-state"
import {
  loadEditorPanelOpenPreference,
  persistEditorPanelOpenPreference,
} from "./editor-panel-state"
import { resolveSessionPanelNavigation } from "./session-panel-routing"
import { createAllSessionsSidebarItem } from "./all-sessions-sidebar-item"
import { createArchivedSidebarItem, ARCHIVED_NAV_ID } from "./archived-sidebar-item"
import {
  ALL_SESSIONS_NAV_ITEM_ID,
  createCollapsedSidebarItems,
  isSidebarItemExpanded,
  toggleCollapsedSidebarItem,
} from "./sidebar-expanded-state"
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

/**
 * AppShell - Main 3-panel layout container
 *
 * Layout: [LeftSidebar 20%] | [NavigatorPanel 32%] | [MainContentPanel 48%]
 *
 * Session Filters:
 * - 'allSessions': Shows all sessions
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
  const [sidebarWidth, setSidebarWidth] = React.useState(() => {
    return storage.get(storage.KEYS.sidebarWidth, storage.get(storage.KEYS.sessionListWidth, 300))
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
  const shellWidth = useContainerWidth(shellRef)
  const MOBILE_THRESHOLD = 768
  const isAutoCompact = shellWidth > 0 && shellWidth < MOBILE_THRESHOLD

  const effectiveSidebarAndNavigatorHidden = isSidebarAndNavigatorHidden || isAutoCompact

  // What's New overlay
  const [showWhatsNew, setShowWhatsNew] = React.useState(false)
  const [releaseNotesContent, setReleaseNotesContent] = React.useState('')
  const [hasUnseenReleaseNotes, setHasUnseenReleaseNotes] = React.useState(false)

  // Check for unseen release notes on mount
  useEffect(() => {
    window.electronAPI.getLatestReleaseVersion().then((latestVersion) => {
      if (!latestVersion) return
      const lastSeen = storage.get(storage.KEYS.whatsNewLastSeenVersion, '')
      setHasUnseenReleaseNotes(lastSeen !== latestVersion)
    })
  }, [])

  const [isResizing, setIsResizing] = React.useState<'sidebar' | null>(null)
  const [sidebarHandleY, setSidebarHandleY] = React.useState<number | null>(null)
  const resizeHandleRef = React.useRef<HTMLDivElement>(null)
  const [session, setSession] = useSession()
  const { resolvedMode, isDark, setMode } = useTheme()
  const { canGoBack, canGoForward, goBack, goForward, navigateToSource, navigateToSession } = useNavigation()

  // Double-Esc interrupt feature: first Esc shows warning, second Esc interrupts
  const { handleEscapePress } = useEscapeInterrupt()

  // UNIFIED NAVIGATION STATE - single source of truth from NavigationContext
  // Derived from focused panel's route — all panels are peers
  const navState = useNavigationState()
  const isLocalSkillsNav = isLocalSkillsNavigation(navState)
  const isSkillMarketplaceNav = isSkillMarketplaceNavigation(navState)
  const [isRightSidebarOpen, setIsRightSidebarOpen] = React.useState(() => {
    return loadRightSidebarOpenPreference(activeWorkspaceId ?? undefined)
  })
  const rightSidebarWorkspaceIdRef = React.useRef(activeWorkspaceId ?? undefined)
  useEffect(() => {
    const workspaceId = activeWorkspaceId ?? undefined
    rightSidebarWorkspaceIdRef.current = workspaceId
    setIsRightSidebarOpen(loadRightSidebarOpenPreference(workspaceId))
  }, [activeWorkspaceId])
  useEffect(() => {
    persistRightSidebarOpenPreference(isRightSidebarOpen, rightSidebarWorkspaceIdRef.current)
  }, [isRightSidebarOpen])
  const handleToggleRightSidebar = useCallback(() => {
    setIsRightSidebarOpen(prev => !prev)
  }, [])

  const [isEditorPanelOpen, setIsEditorPanelOpen] = React.useState(() => {
    return loadEditorPanelOpenPreference(activeWorkspaceId ?? undefined)
  })
  const editorPanelWorkspaceIdRef = React.useRef(activeWorkspaceId ?? undefined)
  useEffect(() => {
    const workspaceId = activeWorkspaceId ?? undefined
    editorPanelWorkspaceIdRef.current = workspaceId
    setIsEditorPanelOpen(loadEditorPanelOpenPreference(workspaceId))
  }, [activeWorkspaceId])
  useEffect(() => {
    persistEditorPanelOpenPreference(isEditorPanelOpen, editorPanelWorkspaceIdRef.current)
  }, [isEditorPanelOpen])
  const handleToggleEditorPanel = useCallback(() => {
    setIsEditorPanelOpen(prev => !prev)
  }, [])
  // Unified sidebar keyboard navigation state
  // Load expanded folders from localStorage (default: all collapsed)
  const [expandedFolders, setExpandedFolders] = React.useState<Set<string>>(() => {
    const saved = storage.get<string[]>(storage.KEYS.expandedFolders, [])
    return new Set(saved)
  })
  const [focusedSidebarItemId, setFocusedSidebarItemId] = React.useState<string | null>(null)
  const sidebarItemRefs = React.useRef<Map<string, HTMLElement>>(new Map())
  // Track which expandable sidebar items are collapsed.
  // An empty set means every expandable item, including All Sessions, starts expanded.
  const [collapsedItems, setCollapsedItems] = React.useState<Set<string>>(() => {
    const saved = storage.get<string[] | null>(storage.KEYS.collapsedSidebarItems, null)
    return createCollapsedSidebarItems(saved)
  })
  const isExpanded = React.useCallback((id: string) => {
    return isSidebarItemExpanded(collapsedItems, id)
  }, [collapsedItems])
  const toggleExpanded = React.useCallback((id: string) => {
    setCollapsedItems(prev => toggleCollapsedSidebarItem(prev, id))
  }, [])
  const isAllSessionsExpanded = isExpanded(ALL_SESSIONS_NAV_ITEM_ID)
  const store = useStore()
  const panelStack = useAtomValue(panelStackAtom)
  const panelCount = useAtomValue(panelCountAtom)
  const focusedSessionId = useAtomValue(focusedSessionIdAtom)
  const sidebarLayout = resolveSidebarLayout({
    navState,
    isSidebarAndNavigatorHidden: effectiveSidebarAndNavigatorHidden,
    isSidebarVisible,
    sidebarWidth,
  })
  const areContextualPanelsAvailable = resolveRightSidebarContextualAvailability({
    activeSessionId: focusedSessionId,
    navState,
  })
  const hasOpenTabs = useAtomValue(hasOpenTabsAtom)
  const prevHasOpenTabsRef = React.useRef(hasOpenTabs)
  useEffect(() => {
    if (hasOpenTabs && !prevHasOpenTabsRef.current) {
      setIsEditorPanelOpen(true)
    }
    prevHasOpenTabsRef.current = hasOpenTabs
  }, [hasOpenTabs])
  const isPanelStackRightSidebarVisible = resolvePanelStackRightSidebarVisible(
    areContextualPanelsAvailable,
    isRightSidebarOpen,
  )

  // Navigate the focused panel to a session.
  // If the session is already open in another panel, focus that panel unless
  // the current navigator needs a route-specific session view.
  const setFocusedPanel = useSetAtom(focusedPanelIdAtom)
  const openFileTab = useSetAtom(openFileTabAtom)
  const navigateToSessionInPanel = useCallback((sessionId: string) => {
    const result = resolveSessionPanelNavigation({
      navState,
      panelStack: store.get(panelStackAtom),
      sessionId,
    })

    if (result.type === 'focus') {
      setFocusedPanel(result.panelId)
      return
    }

    if (result.type === 'navigate-route') {
      navigate(result.route)
      return
    }

    // Not open in any panel — navigate() updates the focused panel
    navigateToSession(sessionId)
  }, [navState, store, setFocusedPanel, navigateToSession])

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

  // Derive source filter from navigation state (only when in sources navigator)
  const sourceFilter: SourceFilter | null = isSourcesNavigation(navState) ? navState.filter ?? null : null

  // Derive automation filter from navigation state (only when in automations navigator)
  const automationFilter: AutomationFilter | null = isAutomationsNavigation(navState) ? navState.filter ?? null : null

  // Search state for session list
  const [searchActive, setSearchActive] = React.useState(false)
  const [searchQuery, setSearchQuery] = React.useState('')

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
  // This prevents stale search queries and focused items from persisting
  const previousWorkspaceRef = React.useRef<string | null>(null)
  React.useEffect(() => {
    if (!activeWorkspaceId) return

    const previousWorkspaceId = previousWorkspaceRef.current

    // Clear transient UI state only on workspace SWITCH (not initial mount)
    if (previousWorkspaceId !== null && previousWorkspaceId !== activeWorkspaceId) {
      // Clear search state
      setSearchActive(false)
      setSearchQuery('')

      // Clear focused sidebar item
      setFocusedSidebarItemId(null)
    }

    // Load workspace-scoped state on BOTH initial mount AND workspace switch
    if (previousWorkspaceId !== activeWorkspaceId) {
      const newExpandedFolders = storage.get<string[]>(storage.KEYS.expandedFolders, [], activeWorkspaceId)
      setExpandedFolders(new Set(newExpandedFolders))

      const newCollapsedItems = storage.get<string[] | null>(storage.KEYS.collapsedSidebarItems, null, activeWorkspaceId)
      setCollapsedItems(createCollapsedSidebarItems(newCollapsedItems))
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
  const { statuses: statusConfigs } = useStatuses(activeWorkspace?.id || null)
  const [sessionStatuses, setSessionStatuses] = React.useState<SessionStatus[]>([])

  // Convert StatusConfig to SessionStatus with resolved icons
  React.useEffect(() => {
    if (!activeWorkspace?.id || statusConfigs.length === 0) {
      setSessionStatuses([])
      return
    }

    setSessionStatuses(statusConfigsToSessionStatuses(statusConfigs, activeWorkspace.id, isDark))
  }, [statusConfigs, activeWorkspace?.id, isDark])

  const effectiveSessionStatuses = sessionStatuses

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

  // Resize effect for the permanent wide sidebar.
  React.useEffect(() => {
    if (!isResizing) return

    const handleMouseMove = (e: MouseEvent) => {
      if (isResizing === 'sidebar') {
        const newWidth = Math.min(Math.max(e.clientX, 240), 480)
        setSidebarWidth(newWidth)
        if (resizeHandleRef.current) {
          const rect = resizeHandleRef.current.getBoundingClientRect()
          setSidebarHandleY(e.clientY - rect.top)
        }
      }
    }

    const handleMouseUp = () => {
      if (isResizing === 'sidebar') {
        storage.set(storage.KEYS.sidebarWidth, sidebarWidth)
        setSidebarHandleY(null)
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

  const archivedSessions = useMemo(
    () => workspaceSessionMetas.filter(s => s.isArchived),
    [workspaceSessionMetas]
  )
  const archivedCount = archivedSessions.length

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
    // Add descendant counts to parents (cumulative)
    for (const label of allLabels) {
      const descendants = getDescendantIds(labelConfigs, label.id)
      if (descendants.length > 0) {
        const descendantCount = activeSessionMetas.filter(
          s => s.labels?.some(l => descendants.includes(extractLabelId(l)))
        ).length
        counts[label.id] = (counts[label.id] || 0) + descendantCount
      }
    }
    return counts
  }, [activeSessionMetas, labelConfigs])

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
        if (sessionFilter.labelId === '__all__') {
          // "Labels" header: show all active sessions that have at least one label
          result = activeSessionMetas.filter(s => s.labels && s.labels.length > 0)
        } else {
          // Specific label: includes sessions tagged with this label or any descendant
          const descendants = getDescendantIds(labelConfigs, sessionFilter.labelId)
          const matchIds = new Set([sessionFilter.labelId, ...descendants])
          result = activeSessionMetas.filter(
            s => s.labels?.some(l => matchIds.has(extractLabelId(l)))
          )
        }
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

    return result
  }, [workspaceSessionMetas, activeSessionMetas, sessionFilter, labelConfigs])

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
    onDeleteSession: handleDeleteSession,
    onOpenFile: openFileTab,
    enabledSources: sources,
    skills,
    activeSessionWorkingDirectory,
    labels: displayLabelConfigs,
    onSessionLabelsChange: handleSessionLabelsChange,
    enabledModes,
    sessionStatuses: effectiveSessionStatuses,
    onSessionSourcesChange: handleSessionSourcesChange,
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
  }), [contextValue, handleDeleteSession, openFileTab, sources, skills, activeSessionWorkingDirectory, displayLabelConfigs, handleSessionLabelsChange, enabledModes, effectiveSessionStatuses, handleSessionSourcesChange, isAutoCompact, searchActive, searchQuery, handleChatMatchInfoChange, handleTestAutomation, handleToggleAutomation, handleDuplicateAutomation, handleDeleteAutomation, automationTestResults, getAutomationHistory, handleReplayAutomation])

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

  // Listen for sidebar toggle from menu (View → Toggle Sidebar)
  React.useEffect(() => {
    const cleanup = window.electronAPI.onMenuToggleSidebar?.(() => {
      handleToggleSidebar()
    })
    return cleanup
  }, [handleToggleSidebar])

  // Persist sidebar section collapsed states (workspace-scoped)
  React.useEffect(() => {
    if (!activeWorkspaceId) return
    storage.set(storage.KEYS.collapsedSidebarItems, [...collapsedItems], activeWorkspaceId)
  }, [collapsedItems, activeWorkspaceId])

  const handleAllSessionsClick = useCallback(() => {
    navigate(routes.view.allSessions())
  }, [])

  const handleArchivedClick = useCallback(() => {
    navigate(routes.view.archived())
  }, [])

  // Handler for label filter views (hierarchical — includes descendant labels)
  const handleLabelClick = useCallback((labelId: string) => {
    navigate(routes.view.label(labelId))
  }, [])

  const handleViewClick = useCallback((viewId: string) => {
    navigate(routes.view.view(viewId))
  }, [])

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

  const handleLocalSkillsClick = useCallback(() => {
    navigate(routes.view.localSkills())
  }, [])

  const handleSkillMarketplaceClick = useCallback(() => {
    navigate(routes.view.skillMarketplace())
  }, [])

  // Handlers for automations view
  const handleAutomationsClick = useCallback(() => {
    navigate(routes.view.automations())
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

  const handleSessionListNavigateToView = useCallback((view: 'allSessions' | 'flagged') => {
    switch (view) {
      case 'allSessions':
        navigate(routes.view.allSessions())
        return
      case 'flagged':
        navigate(routes.view.flagged())
        return
    }
  }, [])

  // Handler for What's New overlay
  const handleWhatsNewClick = useCallback(async () => {
    const content = await window.electronAPI.getReleaseNotes()
    setReleaseNotesContent(content)
    setShowWhatsNew(true)
    setHasUnseenReleaseNotes(false)
    // Update last seen version
    const latestVersion = await window.electronAPI.getLatestReleaseVersion()
    if (latestVersion) {
      storage.set(storage.KEYS.whatsNewLastSeenVersion, latestVersion)
    }
  }, [])

  // ============================================================================
  // EDIT POPOVER STATE
  // ============================================================================
  // State to control which EditPopover is open (triggered from context menus).
  // We use controlled popovers instead of deep links so the user can type
  // their request in the popover UI before opening a new chat window.
  // add-source variants: add-source (generic), add-source-api, add-source-mcp, add-source-local
  const [editPopoverOpen, setEditPopoverOpen] = useState<'statuses' | 'labels' | 'views' | 'add-source' | 'add-source-api' | 'add-source-mcp' | 'add-source-local' | 'add-label' | 'automation-config' | null>(null)
  const [skillImportOpen, setSkillImportOpen] = useState(false)

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
  const openAddSkill = useCallback(() => {
    captureContextMenuPosition()
    setTimeout(() => setSkillImportOpen(true), 50)
  }, [captureContextMenuPosition])

  const handleSkillInstalled = useCallback(async (skillSlug: string) => {
    if (!activeWorkspaceId) return
    const loaded = await window.electronAPI.getSkills(activeWorkspaceId, activeSessionWorkingDirectory)
    setSkills(loaded || [])
    navigate(routes.view.skills(skillSlug))
  }, [activeSessionWorkingDirectory, activeWorkspaceId, navigate])

  // Handler for "Add Automation" context menu action
  // Opens the EditPopover for adding a new automation
  const openAddAutomation = useCallback(() => {
    captureContextMenuPosition()
    setTimeout(() => setEditPopoverOpen('automation-config'), 50)
  }, [captureContextMenuPosition])

  // Create a new chat and select it
  const handleNewChat = useCallback((newPanel: boolean = false) => {
    if (!activeWorkspace) return

    // Exit search mode and switch to All Sessions
    setSearchActive(false)
    setSearchQuery('')

    // Delegate to NavigationContext which handles session creation
    navigate(
      routes.action.newSession(),
      newPanel ? { newPanel: true, targetLaneId: 'main' } : undefined
    )

    // Focus the chat input after navigation completes
    setTimeout(() => focusZone('chat', { intent: 'programmatic' }), 50)
  }, [activeWorkspace, focusZone, navigate])

  // Create a brand new dedicated browser window and focus it.
  // Intentionally unbound: this action should always create a NEW window.
  const handleNewBrowserWindow = useCallback(async () => {
    try {
      const instanceId = await window.electronAPI.browserPane.create({
        show: true,
      })
      await window.electronAPI.browserPane.focus(instanceId)
    } catch (error) {
      console.error('[Chat] Failed to create browser window:', error)
      toast.error(t('toast.failedToCreateBrowser'))
    }
  }, [])

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

    // 1. Sessions section
    result.push({ id: ALL_SESSIONS_NAV_ITEM_ID, type: 'nav', action: handleAllSessionsClick })
    result.push({ id: ARCHIVED_NAV_ID, type: 'nav', action: handleArchivedClick })

    // 2. Sources, Skills, Marketplace, Settings
    result.push({ id: 'nav:sources', type: 'nav', action: handleSourcesClick })
    result.push({ id: LOCAL_SKILLS_NAV_ID, type: 'nav', action: handleLocalSkillsClick })
    result.push({ id: SKILL_MARKETPLACE_NAV_ID, type: 'nav', action: handleSkillMarketplaceClick })
    result.push({ id: 'nav:automations', type: 'nav', action: handleAutomationsClick })
    result.push({ id: 'nav:settings', type: 'nav', action: () => handleSettingsClick() })
    result.push({ id: 'nav:whats-new', type: 'nav', action: handleWhatsNewClick })

    return result
  }, [handleAllSessionsClick, handleArchivedClick, handleLabelClick, labelTree, handleSourcesClick, handleLocalSkillsClick, handleSkillMarketplaceClick, handleAutomationsClick, handleSettingsClick, handleWhatsNewClick])

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
    // Archived navigator
    if (isArchivedNavigation(navState)) {
      return t("sidebar.archived")
    }

    // Sources navigator
    if (isSourcesNavigation(navState)) {
      return t("sidebar.sources")
    }

    // Skills navigator
    if (isSkillMarketplaceNav) {
      return t("sidebar.marketplace")
    }

    if (isLocalSkillsNav) {
      return t("sidebar.localSkills")
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

  let sessionListFocusedSessionId: string | null | undefined
  if (panelCount === 0) {
    sessionListFocusedSessionId = null
  } else if (panelCount > 1) {
    sessionListFocusedSessionId = focusedSessionId
  }

  const sessionListNavigateToSession = panelCount > 1 ? navigateToSessionInPanel : undefined

  const renderSessionList = (key: string, items: SessionMeta[], heightBehavior?: SessionListHeightBehavior) => (
    <SessionList
      key={key}
      items={items}
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
      onNavigateToView={handleSessionListNavigateToView}
      sessionOptions={sessionOptions}
      searchActive={searchActive}
      searchQuery={searchQuery}
      onSearchChange={setSearchQuery}
      onSearchClose={() => {
        setSearchActive(false)
        setSearchQuery('')
      }}
      sessionStatuses={effectiveSessionStatuses}
      evaluateViews={evaluateViews}
      workspaceId={activeWorkspaceId ?? undefined}
      focusedSessionId={sessionListFocusedSessionId}
      onNavigateToSession={sessionListNavigateToSession}
      hasPendingPrompt={hasPendingPrompt}
      activeChatMatchInfo={chatMatchInfo}
      heightBehavior={heightBehavior}
    />
  )

  const allSessionsList = renderSessionList(
    'all-sessions-sidebar',
    searchActive ? workspaceSessionMetas : activeSessionMetas,
    'auto',
  )

  const sessionListContent = isSessionsNavigation(navState) && sessionFilter?.kind !== 'allSessions' ? (
    renderSessionList(
      `navigator-${sessionFilter?.kind}`,
      searchActive ? workspaceSessionMetas : filteredSessionMetas,
    )
  ) : null

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
          onOpenKeyboardShortcuts={onOpenKeyboardShortcuts}
          onOpenStoredUserPreferences={onOpenStoredUserPreferences}
          onBack={goBack}
          onForward={goForward}
          canGoBack={canGoBack}
          canGoForward={canGoForward}
          onToggleSidebar={handleToggleSidebar}
          onToggleRightSidebar={handleToggleRightSidebar}
          onToggleFocusMode={() => setIsSidebarAndNavigatorHidden(prev => !prev)}
          onAddSessionPanel={() => handleNewChat(true)}
          onAddBrowserPanel={() => { void handleNewBrowserWindow() }}
          isRightSidebarToggleVisible={areContextualPanelsAvailable}
          isEditorPanelToggleVisible={areContextualPanelsAvailable}
          isEditorPanelOpen={isEditorPanelOpen}
          onEditorPanelToggle={handleToggleEditorPanel}
          isCompact={isAutoCompact}
        />

      {/* === OUTER LAYOUT: Unified Panel Stack | Right Sidebar === */}
      <div
        ref={shellRef}
        className="flex items-stretch relative bg-foreground-5"
        style={{
          height: '100%',
          paddingRight: isAutoCompact ? 0 : PANEL_EDGE_INSET,
          paddingBottom: isAutoCompact ? 0 : PANEL_EDGE_INSET,
          paddingLeft: 0,
          gap: PANEL_GAP,
        }}
      >
        <PanelStackContainer
          sidebarSlot={
            <div
              ref={sidebarRef}
              style={{ width: sidebarLayout.sidebarWidth }}
              className="h-full font-sans relative"
              data-focus-zone="sidebar"
              tabIndex={sidebarFocused ? 0 : -1}
              onKeyDown={handleSidebarKeyDown}
            >
            <div className="flex h-full flex-col select-none bg-foreground-5">
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
                {/* Primary Nav: All Sessions, Archived, Labels | Sources, Skills | Settings */}
                {/* pb-4 provides clearance so the last item scrolls above the mask-fade-bottom gradient */}
                <div className="flex-1 overflow-y-auto min-h-0 [scrollbar-gutter:stable] mask-fade-bottom pb-4">
                <LeftSidebar
                  isCollapsed={false}
                  getItemProps={getSidebarItemProps}
                  focusedItemId={focusedSidebarItemId}
                  links={[
                    createAllSessionsSidebarItem({
                      title: t("sidebar.allSessions"),
                      label: String(workspaceSessionMetas.length),
                      isActive: sessionFilter?.kind === 'allSessions',
                      onClick: handleAllSessionsClick,
                      isExpanded: isAllSessionsExpanded,
                      onToggle: () => toggleExpanded(ALL_SESSIONS_NAV_ITEM_ID),
                      expandedContent: (
                        <div className="mt-1 max-h-[min(560px,calc(100vh-150px))] overflow-y-auto">
                          {allSessionsList}
                        </div>
                      ),
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
                    }),
                    createArchivedSidebarItem({
                      title: t("sidebar.archived"),
                      label: archivedCount > 0 ? String(archivedCount) : undefined,
                      isActive: isArchivedNavigation(navState),
                      onClick: handleArchivedClick,
                    }),
                    // --- Separator ---
                    { id: "separator:chats-sources", type: "separator" },
                    // --- Sources, Skills & Marketplace Section ---
                    {
                      id: "nav:sources",
                      title: t("sidebar.sources"),
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
                    ...createSkillsSidebarItems({
                      skillsCount: skills.length,
                      isLocalSkillsNav,
                      isSkillMarketplaceNav,
                      onLocalSkillsClick: handleLocalSkillsClick,
                      onSkillMarketplaceClick: handleSkillMarketplaceClick,
                      onAddSkill: openAddSkill,
                      t,
                    }),
                    {
                      id: "nav:automations",
                      title: t("sidebar.automations"),
                      label: String(automations.length),
                      icon: ListTodo,
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
                    // --- Separator ---
                    { id: "separator:skills-settings", type: "separator" },
                    // --- Settings ---
                    {
                      id: "nav:settings",
                      title: t("sidebar.settings"),
                      icon: Settings,
                      variant: isSettingsNavigation(navState) ? "default" : "ghost",
                      onClick: () => handleSettingsClick(),
                    },
                    // --- What's New ---
                    {
                      id: "nav:whats-new",
                      title: t("sidebar.whatsNew"),
                      icon: hasUnseenReleaseNotes ? (
                        <span className="relative">
                          <Cake className="h-3.5 w-3.5" />
                          <span className="absolute -top-0.5 -right-0.5 h-1.5 w-1.5 rounded-full bg-accent" />
                        </span>
                      ) : Cake,
                      variant: "ghost" as const,
                      onClick: handleWhatsNewClick,
                    },
                  ]}
                />
                {/* Agent Tree: Hierarchical list of agents */}
                {/* Agents section removed */}
                </div>
              </div>

            </div>
          </div>
          }
          sidebarWidth={sidebarLayout.sidebarWidth}
          navigatorSlot={
            <div
              style={{ width: isAutoCompact ? '100%' : sidebarLayout.navigatorWidth }}
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
                  {/* Add Source button (only for sources mode) - uses filter-aware edit config */}
                  {isSourcesNavigation(navState) && activeWorkspace && (
                    sourceFilter?.kind === 'type' && sourceFilter.sourceType === 'mcp' ? (
                      <McpSourceFormDialog
                        workspaceId={activeWorkspace.id}
                        trigger={
                          <HeaderIconButton
                            icon={<Plus className="h-4 w-4" />}
                            tooltip={t("sidebarMenu.addSource")}
                            data-tutorial="add-source-button"
                          />
                        }
                      />
                    ) : (
                      <EditPopover
                        trigger={
                          <HeaderIconButton
                            icon={<Plus className="h-4 w-4" />}
                            tooltip={t("sidebarMenu.addSource")}
                            data-tutorial="add-source-button"
                          />
                        }
                        {...getEditConfig(
                          sourceFilter?.kind === 'type' ? `add-source-${sourceFilter.sourceType}` as EditContextKey : 'add-source',
                          activeWorkspace.rootPath
                        )}
                      />
                    )
                  )}
                  {/* Add Skill button (only for skills mode) */}
                  {isLocalSkillsNav && activeWorkspace && (
                    <HeaderIconButton
                      icon={<Plus className="h-4 w-4" />}
                      tooltip={t("sidebarMenu.addSkill")}
                      data-tutorial="add-skill-button"
                      onClick={openAddSkill}
                    />
                  )}
                  {/* Add Automation button (only for automations mode) */}
                  {isAutomationsNavigation(navState) && activeWorkspace && (
                    <EditPopover
                      trigger={
                        <HeaderIconButton
                          icon={<Plus className="h-4 w-4" />}
                          tooltip={t("sidebarMenu.addAutomation")}
                        />
                      }
                      {...getEditConfig('automation-config', activeWorkspace.rootPath)}
                    />
                  )}
                </>
              }
            />
            {/* Content: SessionList, SourcesListPanel, ArchivedSessionsPanel, or SettingsNavigator based on navigation state */}
            {sessionListContent}
            {isArchivedNavigation(navState) && (
              /* Archived Sessions List */
              <ArchivedSessionsPanel
                sessions={archivedSessions}
                onSessionClick={(session) => navigateToSessionInPanel(session.id)}
                selectedSessionId={focusedSessionId}
              />
            )}
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
            {isLocalSkillsNav && activeWorkspaceId && (
              /* Skills List */
              <SkillsListPanel
                skills={skills}
                workspaceId={activeWorkspaceId}
                workspaceRootPath={activeWorkspace?.rootPath}
                onAddSkill={openAddSkill}
                onSkillClick={handleSkillSelect}
                onPublishSkill={handleSkillSelect}
                onDeleteSkill={handleDeleteSkill}
                selectedSkillSlug={isLocalSkillsNav && navState.details?.type === 'skill' ? navState.details.skillSlug : null}
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
            {/* Mobile/compact-only FAB for starting a new chat — only on the
                session list itself, not when a chat is open (it would overlap
                the chat input). */}
            {isAutoCompact && isSessionsNavigation(navState) && !navState.details && (
              <FabNewChat onClick={() => handleNewChat()} />
            )}
            </div>
          }
          navigatorWidth={sidebarLayout.navigatorWidth}
          isSidebarAndNavigatorHidden={effectiveSidebarAndNavigatorHidden}
          isRightSidebarVisible={isPanelStackRightSidebarVisible}
          isCompact={isAutoCompact}
          isResizing={!!isResizing}
        />

        {areContextualPanelsAvailable && (
          <EditorDetailPanel
            workspaceId={activeWorkspaceId ?? undefined}
            sessionId={focusedSessionId ?? undefined}
            isOpen={isEditorPanelOpen}
          />
        )}

        {areContextualPanelsAvailable && (
          <RightSidebarPanel
            workspaceId={activeWorkspaceId ?? undefined}
            sessionId={focusedSessionId ?? undefined}
            isOpen={isRightSidebarOpen}
          />
        )}

        {/* Sidebar Resize Handle (absolute, hidden in focused mode) */}
        {sidebarLayout.showSidebarResizeHandle && (
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
            left: isSidebarVisible
              ? sidebarLayout.sidebarWidth + (PANEL_GAP / 2) - PANEL_SASH_HALF_HIT_WIDTH
              : -PANEL_GAP,
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
          <SkillImportModal
            open={skillImportOpen}
            onOpenChange={setSkillImportOpen}
            workspaceId={activeWorkspace.id}
            workspaceRootPath={activeWorkspace.rootPath}
            onSkillInstalled={handleSkillInstalled}
          />
        </>
      )}

      {/* What's New overlay */}
      <DocumentFormattedMarkdownOverlay
        isOpen={showWhatsNew}
        onClose={() => setShowWhatsNew(false)}
        content={releaseNotesContent}
        onOpenUrl={(url) => window.electronAPI.openUrl(url)}
      />

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

    </AppShellProvider>
  )
}
