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
  Check,
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
} from "lucide-react"
import { PanelRightRounded } from "../icons/PanelRightRounded"
import { PanelLeftRounded } from "../icons/PanelLeftRounded"
// TodoStateIcons no longer used - icons come from dynamic todoStates
import { SourceAvatar } from "@/components/ui/source-avatar"
import { AppMenu } from "../AppMenu"
import { SquarePenRounded } from "../icons/SquarePenRounded"
import { McpIcon } from "../icons/McpIcon"
import { cn, isHexColor } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { HeaderIconButton } from "@/components/ui/HeaderIconButton"
import { Separator } from "@/components/ui/separator"
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from "@/components/ui/tooltip"
import {
  DropdownMenu,
  DropdownMenuTrigger,
  StyledDropdownMenuContent,
  StyledDropdownMenuItem,
  StyledDropdownMenuSeparator,
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
import type { Session, Workspace, FileAttachment, PermissionRequest, TodoState, LoadedSource, LoadedSkill, PermissionMode, SourceFilter } from "../../../shared/types"
import { sessionMetaMapAtom, type SessionMeta } from "@/atoms/sessions"
import { sourcesAtom } from "@/atoms/sources"
import { skillsAtom } from "@/atoms/skills"
import { type TodoStateId, statusConfigsToTodoStates } from "@/config/todo-states"
import { useStatuses } from "@/hooks/useStatuses"
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
import { EditPopover, getEditConfig } from "@/components/ui/EditPopover"
import { HelpPopover } from "@/components/ui/HelpPopover"
import { getDocUrl } from "@craft-agent/shared/docs/doc-links"
import SettingsNavigator from "@/pages/settings/SettingsNavigator"
import { RightSidebar } from "./RightSidebar"
import type { RichTextInputHandle } from "@/components/ui/rich-text-input"
import { hasOpenOverlay } from "@/lib/overlay-detection"

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
 * Panel spacing constants (in pixels)
 */
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

  const [isSidebarVisible, setIsSidebarVisible] = React.useState(() => {
    return storage.get(storage.KEYS.sidebarVisible, !defaultCollapsed)
  })
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
  const { resolvedMode } = useTheme()
  const { canGoBack, canGoForward, goBack, goForward } = useNavigation()

  // Double-Esc interrupt feature: first Esc shows warning, second Esc interrupts
  const { handleEscapePress } = useEscapeInterrupt()

  // UNIFIED NAVIGATION STATE - single source of truth from NavigationContext
  // All sidebar/navigator/main panel state is derived from this
  const navState = useNavigationState()

  // Derive chat filter from navigation state (only when in chats navigator)
  const chatFilter = isChatsNavigation(navState) ? navState.filter : null

  // Derive source filter from navigation state (only when in sources navigator)
  const sourceFilter: SourceFilter | null = isSourcesNavigation(navState) ? navState.filter ?? null : null

  // Session list filter: empty set shows all, otherwise shows only sessions with selected states
  const [listFilter, setListFilter] = React.useState<Set<TodoStateId>>(() => {
    const saved = storage.get<TodoStateId[]>(storage.KEYS.listFilter, [])
    return new Set(saved)
  })
  // Search state for session list
  const [searchActive, setSearchActive] = React.useState(false)
  const [searchQuery, setSearchQuery] = React.useState('')

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
  // Track which expandable sidebar items are collapsed (default: all expanded)
  const [collapsedItems, setCollapsedItems] = React.useState<Set<string>>(() => {
    const saved = storage.get<string[]>(storage.KEYS.collapsedSidebarItems, [])
    return new Set(saved)
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
      setSources(updatedSources || [])
    })
    return cleanup
  }, [])

  // Load skills from backend on mount
  React.useEffect(() => {
    if (!activeWorkspaceId) return
    window.electronAPI.getSkills(activeWorkspaceId).then((loaded) => {
      setSkills(loaded || [])
    }).catch(err => {
      console.error('[Chat] Failed to load skills:', err)
    })
  }, [activeWorkspaceId])

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

  const activeWorkspace = workspaces.find(w => w.id === activeWorkspaceId)

  // Load dynamic statuses from workspace config
  const { statuses: statusConfigs, isLoading: isLoadingStatuses } = useStatuses(activeWorkspace?.id || null)
  const [todoStates, setTodoStates] = React.useState<Array<{
    id: string
    label: string
    color: string
    icon: React.ReactNode
    iconColorable: boolean
    category?: 'open' | 'closed'
    isFixed?: boolean
    isDefault?: boolean
    shortcut?: string
  }>>([])

  // Convert StatusConfig to TodoState with resolved icons
  React.useEffect(() => {
    if (!activeWorkspace?.id || statusConfigs.length === 0) {
      setTodoStates([])
      return
    }

    statusConfigsToTodoStates(statusConfigs, activeWorkspace.id).then(setTodoStates)
  }, [statusConfigs, activeWorkspace?.id])

  // Ensure session messages are loaded when selected
  const ensureMessagesLoaded = useSetAtom(ensureSessionMessagesLoadedAtom)

  // Handle selecting a source from the list
  const handleSourceSelect = React.useCallback((source: LoadedSource) => {
    if (!activeWorkspaceId) return
    navigate(routes.view.sources({ sourceSlug: source.config.slug }))
  }, [activeWorkspaceId, navigate])

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
      { key: 'Tab', shift: true, action: () => {
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
      }, when: () => !document.querySelector('[role="dialog"]') && document.activeElement?.tagName !== 'TEXTAREA' },
      // Sidebar toggle (CMD+\ like VS Code, avoids conflict with CMD+B for bold)
      { key: '\\', cmd: true, action: () => setIsSidebarVisible(v => !v) },
      // New chat
      { key: 'n', cmd: true, action: () => handleNewChat(true) },
      // Settings
      { key: ',', cmd: true, action: onOpenSettings },
      // History navigation
      { key: '[', cmd: true, action: goBack },
      { key: ']', cmd: true, action: goForward },
      // ESC to stop processing - requires double-press within 1 second
      // First press shows warning overlay, second press interrupts
      { key: 'Escape', action: () => {
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
      }},
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

  // Filter session metadata by active workspace
  const workspaceSessionMetas = useMemo(() => {
    const metas = Array.from(sessionMetaMap.values())
    return activeWorkspaceId
      ? metas.filter(s => s.workspaceId === activeWorkspaceId)
      : metas
  }, [sessionMetaMap, activeWorkspaceId])

  // Count sessions by todo state (scoped to workspace)
  const isMetaDone = (s: SessionMeta) => s.todoState === 'done' || s.todoState === 'cancelled'
  const flaggedCount = workspaceSessionMetas.filter(s => s.isFlagged).length

  // Count sessions by individual todo state (dynamic based on todoStates)
  const todoStateCounts = useMemo(() => {
    const counts: Record<TodoStateId, number> = {}
    // Initialize counts for all dynamic statuses
    for (const state of todoStates) {
      counts[state.id] = 0
    }
    // Count sessions
    for (const s of workspaceSessionMetas) {
      const state = (s.todoState || 'todo') as TodoStateId
      // Increment count (initialize to 0 if status not in todoStates yet)
      counts[state] = (counts[state] || 0) + 1
    }
    return counts
  }, [workspaceSessionMetas, todoStates])

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
      default:
        result = workspaceSessionMetas
    }

    // Apply secondary filter by todo states if any are selected (only in allChats view)
    if (chatFilter.kind === 'allChats' && listFilter.size > 0) {
      result = result.filter(s => listFilter.has((s.todoState || 'todo') as TodoStateId))
    }

    return result
  }, [workspaceSessionMetas, chatFilter, listFilter])

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

  // Right sidebar OPEN button (fades out when sidebar is open, hidden in focused mode or non-chat views)
  const rightSidebarOpenButton = React.useMemo(() => {
    if (isFocusedMode || !isChatsNavigation(navState) || !navState.details) return null

    return (
      <motion.div
        initial={false}
        animate={{ opacity: isRightSidebarVisible ? 0 : 1 }}
        transition={{ duration: 0.15 }}
        style={{ pointerEvents: isRightSidebarVisible ? 'none' : 'auto' }}
      >
        <HeaderIconButton
          icon={<PanelRightRounded className="h-5 w-6" />}
          onClick={() => setIsRightSidebarVisible(true)}
          tooltip="Open sidebar"
          className="text-foreground"
        />
      </motion.div>
    )
  }, [isFocusedMode, navState, isRightSidebarVisible])

  // Right sidebar CLOSE button (shown in sidebar header when open)
  const rightSidebarCloseButton = React.useMemo(() => {
    if (isFocusedMode || !isRightSidebarVisible) return null

    return (
      <HeaderIconButton
        icon={<PanelLeftRounded className="h-5 w-6" />}
        onClick={() => setIsRightSidebarVisible(false)}
        tooltip="Close sidebar"
        className="text-foreground"
      />
    )
  }, [isFocusedMode, isRightSidebarVisible])

  // Extend context value with local overrides (textareaRef, wrapped onDeleteSession, sources, skills, enabledModes, rightSidebarOpenButton, todoStates)
  const appShellContextValue = React.useMemo<AppShellContextType>(() => ({
    ...contextValue,
    onDeleteSession: handleDeleteSession,
    textareaRef: chatInputRef,
    enabledSources: sources,
    skills,
    enabledModes,
    todoStates,
    onSessionSourcesChange: handleSessionSourcesChange,
    rightSidebarButton: rightSidebarOpenButton,
  }), [contextValue, handleDeleteSession, sources, skills, enabledModes, todoStates, handleSessionSourcesChange, rightSidebarOpenButton])

  // Persist expanded folders to localStorage
  React.useEffect(() => {
    storage.set(storage.KEYS.expandedFolders, [...expandedFolders])
  }, [expandedFolders])

  // Persist sidebar visibility to localStorage
  React.useEffect(() => {
    storage.set(storage.KEYS.sidebarVisible, isSidebarVisible)
  }, [isSidebarVisible])

  // Persist right sidebar visibility to localStorage
  React.useEffect(() => {
    storage.set(storage.KEYS.rightSidebarVisible, isRightSidebarVisible)
  }, [isRightSidebarVisible])

  // Persist list filter to localStorage
  React.useEffect(() => {
    storage.set(storage.KEYS.listFilter, [...listFilter])
  }, [listFilter])

  // Persist sidebar section collapsed states
  React.useEffect(() => {
    storage.set(storage.KEYS.collapsedSidebarItems, [...collapsedItems])
  }, [collapsedItems])

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
  const [editPopoverOpen, setEditPopoverOpen] = useState<'statuses' | 'add-source' | 'add-skill' | null>(null)

  // Handler for "Configure Statuses" context menu action
  // Opens the EditPopover for status configuration
  // Uses setTimeout to delay opening until after context menu closes,
  // preventing the popover from immediately closing due to focus shift
  const openConfigureStatuses = useCallback(() => {
    setTimeout(() => setEditPopoverOpen('statuses'), 50)
  }, [])

  // Handler for "Add Source" context menu action
  // Opens the EditPopover for adding a new source
  const openAddSource = useCallback(() => {
    setTimeout(() => setEditPopoverOpen('add-source'), 50)
  }, [])

  // Handler for "Add Skill" context menu action
  // Opens the EditPopover for adding a new skill
  const openAddSkill = useCallback(() => {
    setTimeout(() => setEditPopoverOpen('add-skill'), 50)
  }, [])

  // Create a new chat and select it
  const handleNewChat = useCallback(async (_useCurrentAgent: boolean = true) => {
    if (!activeWorkspace) return

    const newSession = await onCreateSession(activeWorkspace.id)
    // Navigate to the new session via central routing
    navigate(routes.view.allChats(newSession.id))
  }, [activeWorkspace, onCreateSession])

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

    // 1. Nav items (All Chats, Flagged)
    result.push({ id: 'nav:allChats', type: 'nav', action: handleAllChatsClick })
    result.push({ id: 'nav:flagged', type: 'nav', action: handleFlaggedClick })

    // 2. Status nav items (dynamic from todoStates)
    for (const state of todoStates) {
      result.push({ id: `nav:state:${state.id}`, type: 'nav', action: () => handleTodoStateClick(state.id) })
    }

    // 2.5. Sources nav item
    result.push({ id: 'nav:sources', type: 'nav', action: handleSourcesClick })

    // 2.6. Skills nav item
    result.push({ id: 'nav:skills', type: 'nav', action: handleSkillsClick })

    // 2.7. Settings nav item
    result.push({ id: 'nav:settings', type: 'nav', action: () => handleSettingsClick('app') })

    return result
  }, [handleAllChatsClick, handleFlaggedClick, handleTodoStateClick, todoStates, handleSourcesClick, handleSkillsClick, handleSettingsClick])

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
      case 'state':
        const state = todoStates.find(s => s.id === chatFilter.stateId)
        return state?.label || 'All Chats'
      default:
        return 'All Chats'
    }
  }, [navState, chatFilter, todoStates])

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

      {/* App Menu - fixed position, always visible (hidden in focused mode) */}
      {!isFocusedMode && (
        <div
          className="fixed left-[86px] top-0 h-[50px] z-overlay flex items-center titlebar-no-drag pr-2"
          style={{ width: sidebarWidth - 86 }}
        >
          <AppMenu
            onNewChat={() => handleNewChat(true)}
            onOpenSettings={onOpenSettings}
            onOpenKeyboardShortcuts={onOpenKeyboardShortcuts}
            onOpenStoredUserPreferences={onOpenStoredUserPreferences}
            onReset={onReset}
            onBack={goBack}
            onForward={goForward}
            canGoBack={canGoBack}
            canGoForward={canGoForward}
            onToggleSidebar={() => setIsSidebarVisible(prev => !prev)}
            isSidebarVisible={isSidebarVisible}
          />
        </div>
      )}

      {/* === OUTER LAYOUT: Sidebar | Main Content === */}
      <div className="h-full flex items-stretch relative">
        {/* === SIDEBAR (Left) === (hidden in focused mode)
            Animated width with spring physics for smooth 60-120fps transitions.
            Uses overflow-hidden to clip content during collapse animation.
            Resizable via drag handle on right edge (200-400px range). */}
        {!isFocusedMode && (
        <motion.div
          initial={false}
          animate={{ width: isSidebarVisible ? sidebarWidth : 0 }}
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
                <div className="px-2 pt-1 pb-2">
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
                {/* Primary Nav: All Chats (with expandable submenu), Sources */}
                <LeftSidebar
                  isCollapsed={false}
                  getItemProps={getSidebarItemProps}
                  focusedItemId={focusedSidebarItemId}
                  links={[
                    {
                      id: "nav:allChats",
                      title: "All Chats",
                      label: String(workspaceSessionMetas.length),
                      icon: Inbox,
                      variant: chatFilter?.kind === 'allChats' ? "default" : "ghost",
                      onClick: handleAllChatsClick,
                      expandable: true,
                      expanded: isExpanded('nav:allChats'),
                      onToggle: () => toggleExpanded('nav:allChats'),
                      // Context menu: Configure Statuses
                      contextMenu: {
                        type: 'allChats',
                        onConfigureStatuses: openConfigureStatuses,
                      },
                      items: [
                        // Dynamic status items from todoStates
                        ...todoStates.map(state => ({
                          id: `nav:state:${state.id}`,
                          title: state.label,
                          label: String(todoStateCounts[state.id] || 0),
                          icon: state.icon,
                          iconColor: state.color,
                          iconColorable: state.iconColorable,
                          variant: (chatFilter?.kind === 'state' && chatFilter.stateId === state.id ? "default" : "ghost") as "default" | "ghost",
                          onClick: () => handleTodoStateClick(state.id),
                          // Context menu for each status: Configure Statuses
                          contextMenu: {
                            type: 'status' as const,
                            statusId: state.id,
                            onConfigureStatuses: openConfigureStatuses,
                          },
                        })),
                        // Separator before Flagged
                        { id: "separator:before-flagged", type: "separator" },
                        // Flagged at the bottom
                        {
                          id: "nav:flagged",
                          title: "Flagged",
                          label: String(flaggedCount),
                          icon: <Flag className="h-3.5 w-3.5 fill-current" />,
                          iconColor: "text-info",
                          variant: chatFilter?.kind === 'flagged' ? "default" : "ghost",
                          onClick: handleFlaggedClick,
                          // Context menu for Flagged: Configure Statuses
                          contextMenu: {
                            type: 'flagged' as const,
                            onConfigureStatuses: openConfigureStatuses,
                          },
                        },
                      ],
                    },
                    {
                      id: "nav:sources",
                      title: "Sources",
                      label: String(sources.length),
                      icon: DatabaseZap,
                      // Highlight when in sources navigator and no type filter (or viewing all)
                      variant: (isSourcesNavigation(navState) && !sourceFilter) ? "default" : "ghost",
                      onClick: handleSourcesClick,
                      dataTutorial: "sources-nav",
                      // Make expandable with source type subcategories
                      expandable: true,
                      expanded: isExpanded('nav:sources'),
                      onToggle: () => toggleExpanded('nav:sources'),
                      // Context menu: Add Source
                      contextMenu: {
                        type: 'sources',
                        onAddSource: openAddSource,
                      },
                      // Subcategories for source types: APIs, MCPs, Local Folders
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
                            onAddSource: openAddSource,
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
                            onAddSource: openAddSource,
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
                            onAddSource: openAddSource,
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
                      // Context menu: Add Skill
                      contextMenu: {
                        type: 'skills',
                        onAddSkill: openAddSkill,
                      },
                    },
                    { id: "separator:skills-settings", type: "separator" },
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

              {/* Sidebar Bottom Section: Help + WorkspaceSwitcher */}
              <div className="mt-auto shrink-0 py-2 px-2 space-y-1">
                {/* Global Help Button */}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      className="flex w-full items-center gap-2 rounded-[6px] py-[5px] px-2 text-[13px] select-none outline-none hover:bg-foreground/5 focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring"
                    >
                      <HelpCircle className="h-3.5 w-3.5 text-foreground/60" />
                      <span>Help & Documentation</span>
                    </button>
                  </DropdownMenuTrigger>
                  <StyledDropdownMenuContent align="start" side="top" sideOffset={8}>
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
                <WorkspaceSwitcher
                  isCollapsed={false}
                  workspaces={workspaces}
                  activeWorkspaceId={activeWorkspaceId}
                  onSelect={onSelectWorkspace}
                  onWorkspaceCreated={() => onRefreshWorkspaces?.()}
                />
              </div>
            </div>
          </div>
        </motion.div>
        )}

        {/* Sidebar Resize Handle (hidden in focused mode) */}
        {!isFocusedMode && (
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
          {/* === SESSION LIST PANEL === (hidden in focused mode) */}
          {!isFocusedMode && (
          <div
            className="h-full flex flex-col min-w-0 bg-background shrink-0 shadow-middle overflow-hidden rounded-l-[14px] rounded-r-[10px]"
            style={{ width: sessionListWidth }}
          >
            <PanelHeader
              title={isSidebarVisible ? listTitle : undefined}
              compensateForStoplight={!isSidebarVisible}
              badge={
                // Help icon next to the title only for chat views (Sources/Skills have it in the sidebar)
                isChatsNavigation(navState) ? <HelpPopover feature="statuses" side="bottom" /> : undefined
              }
              actions={
                <>
                  {/* Filter dropdown - allows filtering by todo states (only in All Chats view) */}
                  {chatFilter?.kind === 'allChats' && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <HeaderIconButton
                          icon={<ListFilter className="h-4 w-4" />}
                          className={listFilter.size > 0 ? "text-foreground" : undefined}
                        />
                      </DropdownMenuTrigger>
                      <StyledDropdownMenuContent align="end" light minWidth="min-w-[200px]">
                        {/* Header with title and clear button */}
                        <div className="flex items-center justify-between px-2 py-1.5 border-b border-foreground/5">
                          <span className="text-xs font-medium text-muted-foreground">Filter Chats</span>
                          {listFilter.size > 0 && (
                            <button
                              onClick={(e) => {
                                e.preventDefault()
                                setListFilter(new Set())
                              }}
                              className="text-xs text-muted-foreground hover:text-foreground"
                            >
                              Clear
                            </button>
                          )}
                        </div>
                        {/* Dynamic status filter items */}
                        {todoStates.map(state => {
                          // Only apply color if icon is colorable (uses currentColor)
                          const applyColor = state.iconColorable
                          return (
                            <StyledDropdownMenuItem
                              key={state.id}
                              onClick={(e) => {
                                e.preventDefault()
                                setListFilter(prev => {
                                  const next = new Set(prev)
                                  if (next.has(state.id)) next.delete(state.id)
                                  else next.add(state.id)
                                  return next
                                })
                              }}
                            >
                              <span
                                className={cn(
                                  "h-3.5 w-3.5 flex items-center justify-center shrink-0 [&>svg]:w-full [&>svg]:h-full [&>img]:w-full [&>img]:h-full",
                                  applyColor && !isHexColor(state.color) && state.color
                                )}
                                style={applyColor && isHexColor(state.color) ? { color: state.color } : undefined}
                              >
                                {state.icon}
                              </span>
                              <span className="flex-1">{state.label}</span>
                              <span className="w-3.5 ml-4">{listFilter.has(state.id) && <Check className="h-3.5 w-3.5 text-foreground" />}</span>
                            </StyledDropdownMenuItem>
                          )
                        })}
                        <StyledDropdownMenuSeparator />
                        <StyledDropdownMenuItem
                          onClick={() => {
                            setSearchActive(true)
                          }}
                        >
                          <Search className="h-3.5 w-3.5" />
                          <span className="flex-1">Search</span>
                        </StyledDropdownMenuItem>
                      </StyledDropdownMenuContent>
                    </DropdownMenu>
                  )}
                  {/* More menu with Search for non-allChats views (only for chats mode) */}
                  {isChatsNavigation(navState) && chatFilter?.kind !== 'allChats' && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <HeaderIconButton icon={<MoreHorizontal className="h-4 w-4" />} />
                      </DropdownMenuTrigger>
                      <StyledDropdownMenuContent align="end" light>
                        <StyledDropdownMenuItem
                          onClick={() => {
                            setSearchActive(true)
                          }}
                        >
                          <Search className="h-3.5 w-3.5" />
                          <span className="flex-1">Search</span>
                        </StyledDropdownMenuItem>
                      </StyledDropdownMenuContent>
                    </DropdownMenu>
                  )}
                  {/* Add Source button (only for sources mode) */}
                  {isSourcesNavigation(navState) && activeWorkspace && (
                    <EditPopover
                      trigger={
                        <HeaderIconButton
                          icon={<Plus className="h-4 w-4" />}
                          tooltip="Add Source"
                          data-tutorial="add-source-button"
                        />
                      }
                      {...getEditConfig('add-source', activeWorkspace.rootPath)}
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
                selectedSkillSlug={isSkillsNavigation(navState) && navState.details ? navState.details.skillSlug : null}
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
                  items={filteredSessionMetas}
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
                  todoStates={todoStates}
                />
              </>
            )}
          </div>
          )}

          {/* Session List Resize Handle (hidden in focused mode) */}
          {!isFocusedMode && (
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
            isFocusedMode ? "rounded-[14px]" : (isRightSidebarVisible ? "rounded-l-[10px] rounded-r-[10px]" : "rounded-l-[10px] rounded-r-[14px]")
          )}>
            <MainContentPanel isFocusedMode={isFocusedMode} />
          </div>

          {/* Right Sidebar - Inline Mode (≥ 920px) */}
          {!isFocusedMode && !shouldUseOverlay && (
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
          {!isFocusedMode && shouldUseOverlay && (
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
       * Positioned near the sidebar (left side) since that's where context menus originate.
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
                className="fixed top-[120px] w-0 h-0 pointer-events-none"
                style={{ left: sidebarWidth + 20 }}
                aria-hidden="true"
              />
            }
            side="bottom"
            align="start"
            {...getEditConfig('edit-statuses', activeWorkspace.rootPath)}
          />
          {/* Add Source EditPopover */}
          <EditPopover
            open={editPopoverOpen === 'add-source'}
            onOpenChange={(isOpen) => setEditPopoverOpen(isOpen ? 'add-source' : null)}
            modal={true}
            trigger={
              <div
                className="fixed top-[120px] w-0 h-0 pointer-events-none"
                style={{ left: sidebarWidth + 20 }}
                aria-hidden="true"
              />
            }
            side="bottom"
            align="start"
            {...getEditConfig('add-source', activeWorkspace.rootPath)}
          />
          {/* Add Skill EditPopover */}
          <EditPopover
            open={editPopoverOpen === 'add-skill'}
            onOpenChange={(isOpen) => setEditPopoverOpen(isOpen ? 'add-skill' : null)}
            modal={true}
            trigger={
              <div
                className="fixed top-[120px] w-0 h-0 pointer-events-none"
                style={{ left: sidebarWidth + 20 }}
                aria-hidden="true"
              />
            }
            side="bottom"
            align="start"
            {...getEditConfig('add-skill', activeWorkspace.rootPath)}
          />
        </>
      )}

      </TooltipProvider>
    </AppShellProvider>
  )
}
