import * as React from "react"
import { useRef, useState, useEffect, useCallback, useMemo } from "react"
import { useAtomValue } from "jotai"
import { motion, AnimatePresence } from "motion/react"
import {
  CheckCircle2,
  Inbox,
  Settings,
  ChevronRight,
  ChevronDown,
  FolderOpen,
  MoreHorizontal,
  RotateCw,
  Globe,
  Flag,
  ListFilter,
  Check,
  Search,
  Plus,
  Trash2,
  DatabaseZap,
  Zap,
} from "lucide-react"
import { McpIcon } from "../icons/McpIcon"
import {
  CircleDashed,
  CircleProgress,
  CircleEye,
  CircleCheckFilled,
  CircleXFilled,
} from "../icons/TodoStateIcons"
import { SourceAvatar } from "@/components/ui/source-avatar"
import { AppMenu } from "../AppMenu"
import { SquarePenRounded } from "../icons/SquarePenRounded"
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
import { useTheme } from "@/context/ThemeContext"
import { getResizeGradientStyle } from "@/hooks/useResizeGradient"
import { useFocusZone, useGlobalShortcuts } from "@/hooks/keyboard"
import { useFocusContext } from "@/context/FocusContext"
import { getSessionTitle } from "@/utils/session"
import { useSetAtom } from "jotai"
import type { Session, Workspace, FileAttachment, PermissionRequest, TodoState, LoadedSource, LoadedSkill, PermissionMode } from "../../../shared/types"
import { sessionMetaMapAtom, type SessionMeta } from "@/atoms/sessions"
import { sourcesAtom } from "@/atoms/sources"
import { skillsAtom } from "@/atoms/skills"
import { type TodoStateId, getStateColor, statusConfigsToTodoStates } from "@/config/todo-states"
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
  type SourceCategory,
} from "@/contexts/NavigationContext"
import type { SettingsSubpage } from "../../../shared/types"
import { SourcesListPanel } from "./SourcesListPanel"
import { SkillsListPanel } from "./SkillsListPanel"
import { PanelHeader } from "./PanelHeader"
import SettingsNavigator from "@/pages/settings/SettingsNavigator"

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
 * Chat Filters:
 * - 'allChats': Shows all sessions
 * - 'flagged': Shows flagged sessions
 * - 'state': Shows sessions with a specific todo state
 */
export function AppShell({
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
  const [isResizing, setIsResizing] = React.useState<'sidebar' | 'session-list' | null>(null)
  const [sidebarHandleY, setSidebarHandleY] = React.useState<number | null>(null)
  const [sessionListHandleY, setSessionListHandleY] = React.useState<number | null>(null)
  const resizeHandleRef = React.useRef<HTMLDivElement>(null)
  const sessionListHandleRef = React.useRef<HTMLDivElement>(null)
  const [session, setSession] = useSession()
  const { resolvedMode } = useTheme()
  const { canGoBack, canGoForward, goBack, goForward } = useNavigation()

  // UNIFIED NAVIGATION STATE - single source of truth from NavigationContext
  // All sidebar/navigator/main panel state is derived from this
  const navState = useNavigationState()

  // Derive chat filter from navigation state (only when in chats navigator)
  const chatFilter = isChatsNavigation(navState) ? navState.filter : null

  // Session list filter: empty set shows all, otherwise shows only sessions with selected states
  const [listFilter, setListFilter] = React.useState<Set<TodoStateId>>(() => {
    const saved = storage.get<TodoStateId[]>(storage.KEYS.listFilter, [])
    return new Set(saved)
  })
  // Search state for session list
  const [searchActive, setSearchActive] = React.useState(false)
  const [searchQuery, setSearchQuery] = React.useState('')

  // Reset search when navigation state changes
  React.useEffect(() => {
    setSearchActive(false)
    setSearchQuery('')
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

  // Load enabled permission modes on mount
  React.useEffect(() => {
    window.electronAPI.getEnabledPermissionModes().then((modes) => {
      if (modes && modes.length >= 2) {
        setEnabledModes(modes)
      }
    }).catch((err) => {
      console.error('[Chat] Failed to load enabled permission modes:', err)
    })
  }, [])

  // Load workspace settings (for localMcpEnabled) on workspace change
  React.useEffect(() => {
    if (!activeWorkspaceId) return
    window.electronAPI.getWorkspaceSettings(activeWorkspaceId).then((settings) => {
      if (settings) {
        setLocalMcpEnabled(settings.localMcpEnabled ?? true)
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
      console.log('[Chat] Sources changed, updating sidebar:', updatedSources.length)
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
      console.log('[Chat] Skills changed, updating sidebar:', updatedSkills.length)
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
    // Preserve current category when navigating to a source
    const currentCategory = isSourcesNavigation(navState) ? navState.category : undefined
    navigate(routes.view.sources({ sourceSlug: source.config.slug, category: currentCategory }))
  }, [activeWorkspaceId, navigate, navState])

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
  const chatInputRef = useRef<HTMLTextAreaElement>(null)
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
      // Sidebar toggle
      { key: 'b', cmd: true, action: () => setIsSidebarVisible(v => !v) },
      // New chat
      { key: 'n', cmd: true, action: () => handleNewChat(true) },
      // Settings
      { key: ',', cmd: true, action: onOpenSettings },
      // History navigation
      { key: '[', cmd: true, action: goBack },
      { key: ']', cmd: true, action: goForward },
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

      // Skip if the active element is an input/textarea (let it handle paste directly)
      const activeElement = document.activeElement
      if (activeElement?.tagName === 'TEXTAREA' || activeElement?.tagName === 'INPUT') {
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

  // Resize effect for both sidebar and session list
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
  }, [isResizing, sidebarWidth, sessionListWidth, isSidebarVisible])

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

  // Count sessions by individual todo state
  const todoStateCounts = useMemo(() => {
    const counts: Record<TodoStateId, number> = {
      'todo': 0,
      'in-progress': 0,
      'needs-review': 0,
      'done': 0,
      'cancelled': 0,
    }
    for (const s of workspaceSessionMetas) {
      const state = (s.todoState || 'todo') as TodoStateId
      counts[state]++
    }
    return counts
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

  // Extend context value with local overrides (textareaRef, wrapped onDeleteSession, sources, enabledModes)
  const appShellContextValue = React.useMemo<AppShellContextType>(() => ({
    ...contextValue,
    onDeleteSession: handleDeleteSession,
    textareaRef: chatInputRef,
    enabledSources: sources,
    enabledModes,
    onSessionSourcesChange: handleSessionSourcesChange,
  }), [contextValue, handleDeleteSession, sources, enabledModes, handleSessionSourcesChange])

  // Persist expanded folders to localStorage
  React.useEffect(() => {
    storage.set(storage.KEYS.expandedFolders, [...expandedFolders])
  }, [expandedFolders])

  // Persist sidebar visibility to localStorage
  React.useEffect(() => {
    storage.set(storage.KEYS.sidebarVisible, isSidebarVisible)
  }, [isSidebarVisible])

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

  // Handler for sources view
  const handleSourcesClick = useCallback(() => {
    navigate(routes.view.sources())
  }, [])

  // Handler for source category click - uses navigate() for proper auto-selection
  const handleSourceCategoryClick = useCallback((category: SourceCategory) => {
    navigate(routes.view.sources({ category }))
  }, [])

  // Compute source category counts
  const sourceCounts = React.useMemo(() => {
    let localFiles = 0, onlineSources = 0, localMcp = 0
    for (const s of sources) {
      if (s.config.type === 'local') {
        localFiles++
      } else if (s.config.type === 'mcp') {
        if (s.config.mcp?.transport === 'stdio') {
          localMcp++
        } else {
          onlineSources++
        }
      } else if (s.config.type === 'api') {
        onlineSources++
      }
    }
    return { localFiles, onlineSources, localMcp }
  }, [sources])

  // Handler for skills view
  const handleSkillsClick = useCallback(() => {
    navigate(routes.view.skills())
  }, [])

  // Handler for settings view
  const handleSettingsClick = useCallback((subpage: SettingsSubpage = 'app') => {
    navigate(routes.view.settings(subpage))
  }, [])

  // Create a new chat and select it
  const handleNewChat = useCallback(async (_useCurrentAgent: boolean = true) => {
    if (!activeWorkspace) return

    const newSession = await onCreateSession(activeWorkspace.id)
    // Navigate to the new session via central routing
    navigate(routes.view.allChats(newSession.id))
  }, [activeWorkspace, onCreateSession])

  // Add Source - create a new chat with add-source onboarding
  const handleAddSource = useCallback(() => {
    // Navigate using route with onboarding param - NavigationContext handles session creation
    navigate(routes.action.newChat({ onboarding: 'add-source' }))
  }, [])

  // Delete Source - simplified since agents system is removed
  const handleDeleteSource = useCallback(async (sourceName: string) => {
    if (!activeWorkspace) return
    try {
      await window.electronAPI.deleteSource(activeWorkspace.id, sourceName)
      toast.success(`Deleted source: ${sourceName}`)
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

    // 2. Status nav items (todo states)
    result.push({ id: 'nav:state:todo', type: 'nav', action: () => handleTodoStateClick('todo') })
    result.push({ id: 'nav:state:in-progress', type: 'nav', action: () => handleTodoStateClick('in-progress') })
    result.push({ id: 'nav:state:needs-review', type: 'nav', action: () => handleTodoStateClick('needs-review') })
    result.push({ id: 'nav:state:done', type: 'nav', action: () => handleTodoStateClick('done') })
    result.push({ id: 'nav:state:cancelled', type: 'nav', action: () => handleTodoStateClick('cancelled') })

    // 2.5. Sources nav items (parent and categories)
    result.push({ id: 'nav:sources', type: 'nav', action: handleSourcesClick })
    result.push({ id: 'nav:sources:local-files', type: 'nav', action: () => handleSourceCategoryClick('local-files') })
    result.push({ id: 'nav:sources:online-sources', type: 'nav', action: () => handleSourceCategoryClick('online-sources') })
    result.push({ id: 'nav:sources:local-mcp', type: 'nav', action: () => handleSourceCategoryClick('local-mcp') })

    // 2.6. Settings nav item
    result.push({ id: 'nav:settings', type: 'nav', action: () => handleSettingsClick('app') })

    return result
  }, [handleAllChatsClick, handleFlaggedClick, handleTodoStateClick, handleSourcesClick, handleSourceCategoryClick, handleSettingsClick])

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
    // Sources navigator - with category-specific titles
    if (isSourcesNavigation(navState)) {
      if (navState.category === 'local-files') return 'Local Folders'
      if (navState.category === 'online-sources') return 'Cloud Services'
      if (navState.category === 'local-mcp') return 'Local Tools'
      return 'Sources'
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
          - Fixed overlay at z-40 allows window dragging from the top bar area
          - Interactive elements (buttons, dropdowns) must use:
            1. titlebar-no-drag: prevents drag behavior on clickable elements
            2. relative z-50: ensures elements render above this drag overlay
        */}
        <div className="titlebar-drag-region fixed top-0 left-0 right-0 h-[50px] z-40" />

      {/* App Menu - fixed position, always visible (hidden in focused mode) */}
      {!isFocusedMode && (
        <div
          className="fixed left-[86px] top-0 h-[50px] z-[60] flex items-center titlebar-no-drag pr-2"
          style={{ width: sidebarWidth - 86 }}
        >
          <AppMenu
            onNewChat={() => handleNewChat(true)}
            onOpenSettings={onOpenSettings}
            onOpenKeyboardShortcuts={onOpenKeyboardShortcuts}
            onOpenStoredUserPreferences={onOpenStoredUserPreferences}
            onOpenHelp={() => window.electronAPI.openUrl('https://agents.craft.do/docs')}
            onOpenCraft={() => window.electronAPI.openUrl('craftdocs://')}
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
                {/* New Chat Button - Gmail-style */}
                <div className="px-2 pt-1 pb-2">
                  <Button
                    variant="ghost"
                    onClick={() => handleNewChat(true)}
                    className="w-full justify-start gap-2 py-[7px] px-2 text-[13px] font-normal rounded-[6px] shadow-minimal bg-background"
                  >
                    <SquarePenRounded className="h-3.5 w-3.5 shrink-0" />
                    New Chat
                  </Button>
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
                      items: [
                        {
                          id: "nav:flagged",
                          title: "Flagged",
                          label: String(flaggedCount),
                          icon: <Flag className="h-3.5 w-3.5 fill-current" />,
                          iconColor: "text-orange-500",
                          variant: chatFilter?.kind === 'flagged' ? "default" : "ghost",
                          onClick: handleFlaggedClick,
                        },
                        {
                          id: "nav:state:todo",
                          title: "Todo",
                          label: String(todoStateCounts['todo']),
                          icon: <CircleDashed className="h-3.5 w-3.5" />,
                          iconColor: "text-muted-foreground",
                          variant: chatFilter?.kind === 'state' && chatFilter.stateId === 'todo' ? "default" : "ghost",
                          onClick: () => handleTodoStateClick('todo'),
                        },
                        {
                          id: "nav:state:in-progress",
                          title: "In Progress",
                          label: String(todoStateCounts['in-progress']),
                          icon: <CircleProgress className="h-3.5 w-3.5" />,
                          iconColor: getStateColor('in-progress', todoStates),
                          variant: chatFilter?.kind === 'state' && chatFilter.stateId === 'in-progress' ? "default" : "ghost",
                          onClick: () => handleTodoStateClick('in-progress'),
                        },
                        {
                          id: "nav:state:needs-review",
                          title: "Needs Review",
                          label: String(todoStateCounts['needs-review']),
                          icon: <CircleEye className="h-3.5 w-3.5" />,
                          iconColor: getStateColor('needs-review', todoStates),
                          variant: chatFilter?.kind === 'state' && chatFilter.stateId === 'needs-review' ? "default" : "ghost",
                          onClick: () => handleTodoStateClick('needs-review'),
                        },
                        {
                          id: "nav:state:done",
                          title: "Done",
                          label: String(todoStateCounts['done']),
                          icon: <CircleCheckFilled className="h-3.5 w-3.5" />,
                          iconColor: "text-accent",
                          variant: chatFilter?.kind === 'state' && chatFilter.stateId === 'done' ? "default" : "ghost",
                          onClick: () => handleTodoStateClick('done'),
                        },
                        {
                          id: "nav:state:cancelled",
                          title: "Cancelled",
                          label: String(todoStateCounts['cancelled']),
                          icon: <CircleXFilled className="h-3.5 w-3.5" />,
                          iconColor: "text-muted-foreground/60",
                          variant: chatFilter?.kind === 'state' && chatFilter.stateId === 'cancelled' ? "default" : "ghost",
                          onClick: () => handleTodoStateClick('cancelled'),
                        },
                      ],
                    },
                    {
                      id: "nav:sources",
                      title: "Sources",
                      label: String(sources.length),
                      icon: DatabaseZap,
                      variant: isSourcesNavigation(navState) && !navState.category ? "default" : "ghost",
                      onClick: handleSourcesClick,
                      expandable: true,
                      expanded: isExpanded('nav:sources'),
                      onToggle: () => toggleExpanded('nav:sources'),
                      dataTutorial: "sources-nav",
                      items: [
                        {
                          id: "nav:sources:local-files",
                          title: "Local Folders",
                          label: String(sourceCounts.localFiles),
                          icon: FolderOpen,
                          variant: isSourcesNavigation(navState) && navState.category === 'local-files' ? "default" : "ghost",
                          onClick: () => handleSourceCategoryClick('local-files'),
                        },
                        {
                          id: "nav:sources:online-sources",
                          title: "Cloud Services",
                          label: String(sourceCounts.onlineSources),
                          icon: Globe,
                          variant: isSourcesNavigation(navState) && navState.category === 'online-sources' ? "default" : "ghost",
                          onClick: () => handleSourceCategoryClick('online-sources'),
                        },
                        {
                          id: "nav:sources:local-mcp",
                          title: "Local Tools",
                          label: String(sourceCounts.localMcp),
                          icon: <McpIcon className="h-4 w-4" />,
                          variant: isSourcesNavigation(navState) && navState.category === 'local-mcp' ? "default" : "ghost",
                          onClick: () => handleSourceCategoryClick('local-mcp'),
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

              {/* Sidebar Bottom Section: WorkspaceSwitcher + Settings */}
              <div className="mt-auto shrink-0">
                <div className="flex items-center py-2 px-2 gap-2">
                  <div className="flex-1 min-w-0">
                    <WorkspaceSwitcher
                      isCollapsed={false}
                      workspaces={workspaces}
                      activeWorkspaceId={activeWorkspaceId}
                      onSelect={onSelectWorkspace}
                      onWorkspaceCreated={() => onRefreshWorkspaces?.()}
                    />
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 shrink-0 rounded-[4px] hover:bg-foreground/5"
                    onClick={onOpenSettings}
                  >
                    <Settings className="h-3.5 w-3.5 text-muted-foreground" />
                  </Button>
                </div>
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
          className="absolute top-0 w-3 h-full cursor-col-resize z-50 flex justify-center"
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
        <div className="flex-1 overflow-hidden min-w-0 flex h-full pl-1.5 pr-2 pb-2 pt-[6px] gap-[3px]">
          {/* === SESSION LIST PANEL === (hidden in focused mode) */}
          {!isFocusedMode && (
          <div
            className={cn(
              "h-full flex flex-col min-w-0 bg-background shrink-0 shadow-middle overflow-hidden",
              isSidebarVisible ? "rounded-l-[14px] rounded-r-[10px]" : "rounded-l-[14px] rounded-r-[10px]"
            )}
            style={{ width: sessionListWidth }}
          >
            <PanelHeader
              title={isSidebarVisible ? listTitle : undefined}
              compensateForStoplight={!isSidebarVisible}
              className="bg-background"
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
                        <StyledDropdownMenuItem
                          onClick={(e) => {
                            e.preventDefault()
                            setListFilter(prev => {
                              const next = new Set(prev)
                              if (next.has('todo')) next.delete('todo')
                              else next.add('todo')
                              return next
                            })
                          }}
                        >
                          <CircleDashed className="h-3.5 w-3.5 text-muted-foreground" />
                          <span className="flex-1">Todo</span>
                          <span className="w-3.5 ml-4">{listFilter.has('todo') && <Check className="h-3.5 w-3.5 text-foreground" />}</span>
                        </StyledDropdownMenuItem>
                        <StyledDropdownMenuItem
                          onClick={(e) => {
                            e.preventDefault()
                            setListFilter(prev => {
                              const next = new Set(prev)
                              if (next.has('in-progress')) next.delete('in-progress')
                              else next.add('in-progress')
                              return next
                            })
                          }}
                        >
                          <CircleProgress className="h-3.5 w-3.5" style={isHexColor(getStateColor('in-progress', todoStates)) ? { color: getStateColor('in-progress', todoStates) } : undefined} />
                          <span className="flex-1">In Progress</span>
                          <span className="w-3.5 ml-4">{listFilter.has('in-progress') && <Check className="h-3.5 w-3.5 text-foreground" />}</span>
                        </StyledDropdownMenuItem>
                        <StyledDropdownMenuItem
                          onClick={(e) => {
                            e.preventDefault()
                            setListFilter(prev => {
                              const next = new Set(prev)
                              if (next.has('needs-review')) next.delete('needs-review')
                              else next.add('needs-review')
                              return next
                            })
                          }}
                        >
                          <CircleEye className="h-3.5 w-3.5" style={isHexColor(getStateColor('needs-review', todoStates)) ? { color: getStateColor('needs-review', todoStates) } : undefined} />
                          <span className="flex-1">Needs Review</span>
                          <span className="w-3.5 ml-4">{listFilter.has('needs-review') && <Check className="h-3.5 w-3.5 text-foreground" />}</span>
                        </StyledDropdownMenuItem>
                        <StyledDropdownMenuItem
                          onClick={(e) => {
                            e.preventDefault()
                            setListFilter(prev => {
                              const next = new Set(prev)
                              if (next.has('done')) next.delete('done')
                              else next.add('done')
                              return next
                            })
                          }}
                        >
                          <CircleCheckFilled className="h-3.5 w-3.5 text-accent" />
                          <span className="flex-1">Done</span>
                          <span className="w-3.5 ml-4">{listFilter.has('done') && <Check className="h-3.5 w-3.5 text-foreground" />}</span>
                        </StyledDropdownMenuItem>
                        <StyledDropdownMenuItem
                          onClick={(e) => {
                            e.preventDefault()
                            setListFilter(prev => {
                              const next = new Set(prev)
                              if (next.has('cancelled')) next.delete('cancelled')
                              else next.add('cancelled')
                              return next
                            })
                          }}
                        >
                          <CircleXFilled className="h-3.5 w-3.5 text-muted-foreground/60" />
                          <span className="flex-1">Cancelled</span>
                          <span className="w-3.5 ml-4">{listFilter.has('cancelled') && <Check className="h-3.5 w-3.5 text-foreground" />}</span>
                        </StyledDropdownMenuItem>
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
                  {isSourcesNavigation(navState) && (
                    <HeaderIconButton
                      icon={<Plus className="h-4 w-4" />}
                      onClick={handleAddSource}
                      tooltip="Add Source"
                      data-tutorial="add-source-button"
                    />
                  )}
                </>
              }
            />
            {/* Content: SessionList, SourcesListPanel, or SettingsNavigator based on navigation state */}
            {isSourcesNavigation(navState) && (
              /* Sources List */
              <SourcesListPanel
                sources={sources}
                onAddSource={handleAddSource}
                onDeleteSource={handleDeleteSource}
                onSourceClick={handleSourceSelect}
                selectedSourceSlug={isSourcesNavigation(navState) && navState.details ? navState.details.sourceSlug : null}
                localMcpEnabled={localMcpEnabled}
                category={navState.category}
              />
            )}
            {isSkillsNavigation(navState) && activeWorkspaceId && (
              /* Skills List */
              <SkillsListPanel
                skills={skills}
                workspaceId={activeWorkspaceId}
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
            "flex-1 overflow-hidden min-w-0 bg-background shadow-middle",
            isFocusedMode ? "rounded-[14px]" : "rounded-l-[10px] rounded-r-[14px]"
          )}>
            <MainContentPanel isFocusedMode={isFocusedMode} />
          </div>
        </div>
      </div>

      </TooltipProvider>
    </AppShellProvider>
  )
}
