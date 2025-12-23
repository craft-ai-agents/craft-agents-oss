import * as React from "react"
import { useRef, useState, useEffect, useCallback } from "react"
import { motion, AnimatePresence } from "motion/react"
import {
  CheckCircle2,
  Inbox,
  Settings,
  ChevronRight,
  FolderOpen,
  MoreHorizontal,
  RotateCw,
  CircleAlert,
  CloudOff,
  CloudCheck,
  PowerOff,
  Globe,
  Flag,
  ListFilter,
  Check,
  Search,
} from "lucide-react"
import { McpIcon } from "../icons/McpIcon"
import {
  CircleDashed,
  CircleProgress,
  CircleEye,
  CircleCheckFilled,
  CircleXFilled,
} from "../icons/TodoStateIcons"
import { Spinner } from "@/components/ui/loading-indicator"
import { AvatarGroup } from "@/components/ui/avatar-group"
import { ServiceLogo } from "@/components/ui/service-logo"
import { AppMenu } from "../AppMenu"
import { PanelLeftRounded } from "../icons/PanelLeftRounded"
import { SquarePenRounded } from "../icons/SquarePenRounded"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { TooltipProvider } from "@/components/ui/tooltip"
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
import { LeftSidebar } from "./LeftSidebar"
import { AgentContextMenu, type AgentAction } from "./AgentContextMenu"
import { SetupAuthBanner, type BannerState } from "./SetupAuthBanner"
import { useSession } from "@/hooks/useSession"
import { useAgentState } from "@/hooks/useAgentState"
import { TabContainer, useTabs, type ChatTab } from "@/tabs"
import { ChatProvider, type ChatContextType } from "@/context/ChatContext"
import { getResizeGradientStyle } from "@/hooks/useResizeGradient"
import { useFocusZone, useGlobalShortcuts } from "@/hooks/keyboard"
import { useFocusContext } from "@/context/FocusContext"
import { getSessionTitle } from "@/utils/session"
import { closeTabWithCleanup } from "@/utils/closeTabWithCleanup"
import type { Session, Workspace, SubAgentMetadata, FileAttachment, PermissionRequest, TodoState } from "../../../shared/types"
import { type TodoStateId, DEFAULT_TODO_STATES, getStateColor } from "@/config/todo-states"

type ViewMode = 'inbox' | 'archive' | 'flagged' | 'agent' | `state:${TodoStateId}`

/**
 * ChatProps - Minimal props interface for Chat component
 *
 * Data and callbacks come via contextValue (ChatContextType).
 * Only UI-specific state is passed as separate props.
 *
 * Adding new features:
 * 1. Add to ChatContextType in context/ChatContext.tsx
 * 2. Update App.tsx to include in contextValue
 * 3. Use via useChatContext() hook in child components
 */
interface ChatProps {
  /** All data and callbacks - passed directly to ChatProvider */
  contextValue: ChatContextType
  /** UI-specific props */
  defaultLayout?: number[]
  defaultCollapsed?: boolean
  menuNewChatTrigger?: number
}

/**
 * AgentFolder - Hierarchical structure for organizing agents
 * Agents can be nested in folders up to 3 levels deep
 */
interface AgentFolder {
  name: string                    // Folder name (empty string for root)
  path: string[]                  // Full path from root
  agents: SubAgentMetadata[]      // Agents directly in this folder
  subfolders: AgentFolder[]       // Nested folders
}

/**
 * SidebarAgentStatus - Status displayed in sidebar for each agent
 * Based on AgentSetupStatus but with additional UI-specific states
 */
type SidebarAgentStatus =
  | 'idle'         // Default state, no special indicator
  | 'loading'      // Currently loading/extracting
  | 'needs_setup'  // Agent has never been extracted
  | 'needs_auth'   // Credentials missing
  | 'ready'        // Fully set up and ready to use
  | 'error'        // Error state

/**
 * SidebarServiceLogos - Logo info for MCP servers and APIs
 * Used to display avatar group in sidebar when agent is ready
 */
interface SidebarServiceLogos {
  mcpLogos: Array<{ name: string; logo?: string }>
  apiLogos: Array<{ name: string; logo?: string }>
}

/**
 * Groups flat agent list into hierarchical folder structure
 * Uses agent.folderPath to determine nesting
 */
function groupAgentsByFolder(agents: SubAgentMetadata[]): AgentFolder {
  const root: AgentFolder = { name: '', path: [], agents: [], subfolders: [] }

  for (const agent of agents) {
    const folderPath = agent.folderPath || []
    let current = root

    for (const folderName of folderPath) {
      let subfolder = current.subfolders.find(f => f.name === folderName)
      if (!subfolder) {
        subfolder = {
          name: folderName,
          path: [...current.path, folderName],
          agents: [],
          subfolders: []
        }
        current.subfolders.push(subfolder)
      }
      current = subfolder
    }

    current.agents.push(agent)
  }

  return root
}

interface AgentTreeProps {
  folder: AgentFolder
  level: number
  isCollapsed: boolean
  selectedAgentId: string | null
  onSelectAgent: (agentId: string, agentName: string) => void
  getConversationCount: (agentId: string) => number
  /** Context menu action handler */
  onAgentAction?: (action: AgentAction) => void
  /** Keyboard navigation props */
  isFocused?: boolean
  expandedFolders?: Set<string>
  onToggleFolder?: (path: string) => void
  focusedItemId?: string | null
  onFocusItem?: (id: string) => void
  getItemProps?: (id: string) => {
    tabIndex: number
    'data-focused': boolean
    ref: (el: HTMLElement | null) => void
  }
  /** Agent status indicators */
  agentStatus?: Map<string, SidebarAgentStatus>
  /** Agent service logos for ready agents */
  agentLogos?: Map<string, SidebarServiceLogos>
}

// Union type for sorting agents and folders together alphabetically
type TreeItem =
  | { type: 'agent'; agent: SubAgentMetadata }
  | { type: 'folder'; folder: AgentFolder }

/**
 * AgentTree - Recursive component for rendering agent folder hierarchy
 *
 * Follows shadcn/ui Sidebar component patterns for proper width handling:
 * - Container: flex min-w-0 flex-col (allows shrinking)
 * - Buttons: overflow-hidden + [&>span:last-child]:truncate (clips text)
 * - Nested: border-l for vertical line, ml-* for indentation
 *
 * Keyboard navigation (when isFocused):
 * - Arrow Up/Down: Navigate between items
 * - Arrow Left: Collapse folder / go to parent
 * - Arrow Right: Expand folder
 * - Enter: Select agent or toggle folder
 */
function AgentTree({
  folder,
  level,
  isCollapsed,
  selectedAgentId,
  onSelectAgent,
  getConversationCount,
  onAgentAction,
  isFocused = false,
  expandedFolders,
  onToggleFolder,
  focusedItemId,
  onFocusItem,
  getItemProps,
  agentStatus,
  agentLogos,
}: AgentTreeProps) {
  // Track which agent has an open context menu
  const [openMenuAgentId, setOpenMenuAgentId] = React.useState<string | null>(null)

  // For non-root levels, use parent's expanded state if provided
  const folderPath = folder.path.join('/')
  const isOpen = expandedFolders ? expandedFolders.has(folderPath) : true

  if (isCollapsed && level > 0) return null

  // Combine agents and folders: agents first (alphabetically), then folders (alphabetically)
  const items: TreeItem[] = React.useMemo(() => {
    const agentItems: TreeItem[] = folder.agents
      .map(agent => ({ type: 'agent' as const, agent }))
      .sort((a, b) => {
        const nameA = a.agent.name.split('/').pop()!
        const nameB = b.agent.name.split('/').pop()!
        return nameA.localeCompare(nameB)
      })
    const folderItems: TreeItem[] = folder.subfolders
      .map(f => ({ type: 'folder' as const, folder: f }))
      .sort((a, b) => a.folder.name.localeCompare(b.folder.name))
    return [...agentItems, ...folderItems]
  }, [folder.agents, folder.subfolders])

  // Render agent button - min-w-0 on li and span allows proper truncation
  // Selection style matches LeftSidebar "default" variant
  const isSelected = (agentId: string) => selectedAgentId === agentId
  const renderAgentItem = (agent: SubAgentMetadata) => {
    const itemProps = getItemProps?.(`agent:${agent.id}`)
    const isFocusedItem = focusedItemId === `agent:${agent.id}`
    const isMenuOpen = openMenuAgentId === agent.id

    const agentButton = (
      <button
        {...itemProps}
        onClick={() => onSelectAgent(agent.id, agent.name)}
        className={cn(
          "flex w-full items-center gap-2 overflow-hidden rounded-[6px] py-[6px] px-2 text-[13px] select-none outline-none",
          "focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
          isSelected(agent.id)
            ? "bg-foreground/[0.07]"
            : "hover:bg-foreground/5",
          (isFocusedItem || isMenuOpen) && !isSelected(agent.id) && "bg-foreground/5"
        )}
        role="treeitem"
        aria-selected={isSelected(agent.id)}
      >
        {/* Status indicator - always visible, before title */}
        {(() => {
          const status = agentStatus?.get(agent.id)
          const iconClasses = "h-3.5 w-3.5 shrink-0 text-muted-foreground"
          switch (status) {
            case 'loading':
              return <Spinner className="text-sm shrink-0 text-muted-foreground" />
            case 'needs_setup':
              return <PowerOff className={iconClasses} />
            case 'needs_auth':
              return <CloudOff className={iconClasses} />
            case 'error':
              return <CircleAlert className={iconClasses} />
            default: {
              // Ready state - show service logos if available, or check icon
              const logos = agentLogos?.get(agent.id)
              if (!logos || (logos.mcpLogos.length === 0 && logos.apiLogos.length === 0)) {
                return <CloudCheck className={iconClasses} />
              }
              const allServices = [...logos.mcpLogos, ...logos.apiLogos]
              return (
                <AvatarGroup
                  max={3}
                  className="shrink-0"
                >
                  {allServices.map((service, i) => (
                    <ServiceLogo
                      key={i}
                      logo={service.logo}
                      name={service.name}
                      fallbackIcon={
                        i < logos.mcpLogos.length
                          ? <McpIcon className="h-2 w-2" />
                          : <Globe className="h-2 w-2" />
                      }
                      className="h-4 w-4 rounded-[4px]"
                    />
                  ))}
                </AvatarGroup>
              )
            }
          }
        })()}
        <FadingText>
          {agent.displayName || agent.name.split('/').pop()}
        </FadingText>
      </button>
    )

    return (
      <li key={agent.id} className="min-w-0">
        {onAgentAction ? (
          <AgentContextMenu
            agent={agent}
            onAction={onAgentAction}
            onOpenChange={(open) => setOpenMenuAgentId(open ? agent.id : null)}
            canStartConversation={agentStatus?.get(agent.id) === 'ready'}
          >
            {agentButton}
          </AgentContextMenu>
        ) : (
          agentButton
        )}
      </li>
    )
  }

  // Render folder with collapsible children - shadcn SidebarMenuSub pattern
  const renderFolderItem = (subFolder: AgentFolder) => (
    <AgentTree
      key={subFolder.path.join('/')}
      folder={subFolder}
      level={level + 1}
      isCollapsed={isCollapsed}
      selectedAgentId={selectedAgentId}
      onSelectAgent={onSelectAgent}
      getConversationCount={getConversationCount}
      onAgentAction={onAgentAction}
      isFocused={isFocused}
      expandedFolders={expandedFolders}
      onToggleFolder={onToggleFolder}
      focusedItemId={focusedItemId}
      onFocusItem={onFocusItem}
      getItemProps={getItemProps}
      agentStatus={agentStatus}
      agentLogos={agentLogos}
    />
  )

  // Root level (no folder name) - render as flat list
  // Uses grid like LeftSidebar component - grid children respect container width automatically
  if (!folder.name) {
    return (
      <ul className="grid gap-0.5" role="tree" aria-label="Agents">
        {items.map(item =>
          item.type === 'agent' ? renderAgentItem(item.agent) : renderFolderItem(item.folder)
        )}
      </ul>
    )
  }

  // Folder level - render with collapsible and nested list
  const folderItemProps = getItemProps?.(`folder:${folderPath}`)
  const isFocusedFolder = focusedItemId === `folder:${folderPath}`

  return (
    <li className="min-w-0" role="none">
      <Collapsible open={isOpen} onOpenChange={() => onToggleFolder?.(folderPath)}>
        <CollapsibleTrigger
          {...folderItemProps}
          className={cn(
            "group flex w-full items-center gap-2 overflow-hidden rounded-md py-1.5 px-2 text-[13px] select-none outline-none",
            "hover:bg-foreground/[0.03]",
            "focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
            isFocusedFolder && "bg-foreground/[0.03]"
          )}
          role="treeitem"
          aria-expanded={isOpen}
        >
          <div className="relative h-3.5 w-3.5 shrink-0">
            <FolderOpen className="absolute inset-0 h-3.5 w-3.5 text-muted-foreground transition-opacity group-hover:opacity-0" />
            <motion.div
              initial={false}
              animate={{ rotate: isOpen ? 90 : 0 }}
              transition={collapsibleSpring}
              className="absolute inset-0"
            >
              <ChevronRight className="h-3.5 w-3.5 text-muted-foreground transition-opacity opacity-0 group-hover:opacity-100" />
            </motion.div>
          </div>
          <FadingText>
            {folder.name}
          </FadingText>
        </CollapsibleTrigger>
        <AnimatedCollapsibleContent isOpen={isOpen}>
          {/* Nested list - uses grid + border-l for line, ml/pl for indent */}
          {/* ml-[15px] aligns border-l with icon center: px-2 (8px) + half of w-3.5 (7px) = 15px */}
          <ul className="ml-[15px] grid gap-0.5 border-l border-foreground/10 pl-3 pt-0.5" role="group">
            {items.map(item =>
              item.type === 'agent' ? renderAgentItem(item.agent) : renderFolderItem(item.folder)
            )}
          </ul>
        </AnimatedCollapsibleContent>
      </Collapsible>
    </li>
  )
}

/**
 * Chat - Main 3-panel layout container
 *
 * Layout: [Sidebar 20%] | [Session List + Chat Display 80%]
 *         The right side is split into [Session List 40%] | [Chat Display 60%]
 *
 * View Modes:
 * - 'inbox': Shows non-archived sessions
 * - 'archive': Shows archived sessions
 * - 'agent': Shows sessions for a specific agent
 */
export function Chat({
  contextValue,
  defaultLayout = [20, 32, 48],
  defaultCollapsed = false,
  menuNewChatTrigger,
}: ChatProps) {
  // Destructure commonly used values from context
  const {
    workspaces,
    sessions,
    agents,
    isLoadingAgents = false,
    activeWorkspaceId,
    currentModel,
    sessionOptions,
    onSelectWorkspace,
    onCreateSession,
    onDeleteSession,
    onFlagSession,
    onUnflagSession,
    onMarkSessionRead,
    onMarkSessionUnread,
    onTodoStateChange,
    onRenameSession,
    onRefreshAgents,
    onOpenSettings,
    onOpenKeyboardShortcuts,
    onOpenStoredUserPreferences,
    onAddWorkspace,
    onLogout,
  } = contextValue
  const [isSidebarVisible, setIsSidebarVisible] = React.useState(() => {
    const saved = localStorage.getItem('chat-sidebar-visible')
    return saved !== null ? saved === 'true' : !defaultCollapsed
  })
  const [sidebarWidth, setSidebarWidth] = React.useState(() => {
    const saved = localStorage.getItem('chat-sidebar-width')
    return saved ? Number(saved) : 260
  })
  // Session list width in pixels (min 280, max 500)
  const [sessionListWidth, setSessionListWidth] = React.useState(() => {
    const saved = localStorage.getItem('chat-session-list-width')
    return saved ? Number(saved) : 340
  })
  const [isResizing, setIsResizing] = React.useState<'sidebar' | 'session-list' | null>(null)
  const [sidebarHandleY, setSidebarHandleY] = React.useState<number | null>(null)
  const [sessionListHandleY, setSessionListHandleY] = React.useState<number | null>(null)
  const resizeHandleRef = React.useRef<HTMLDivElement>(null)
  const sessionListHandleRef = React.useRef<HTMLDivElement>(null)
  const [session, setSession] = useSession()
  const [viewMode, setViewMode] = React.useState<ViewMode>('inbox')
  const [selectedAgentId, setSelectedAgentId] = React.useState<string | null>(null)
  // Session list filter: empty set shows all, otherwise shows only sessions with selected states
  const [listFilter, setListFilter] = React.useState<Set<TodoStateId>>(() => {
    const saved = localStorage.getItem('chat-list-filter')
    if (saved) {
      try {
        return new Set(JSON.parse(saved) as TodoStateId[])
      } catch {
        return new Set()
      }
    }
    return new Set()
  })
  // Search state for session list
  const [searchActive, setSearchActive] = React.useState(false)
  const [searchQuery, setSearchQuery] = React.useState('')

  // Reset search when view mode changes
  React.useEffect(() => {
    setSearchActive(false)
    setSearchQuery('')
  }, [viewMode, selectedAgentId])

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

  // Agent status indicators - tracks setup/auth status for sidebar icons
  const [agentStatus, setAgentStatus] = React.useState<Map<string, SidebarAgentStatus>>(new Map())
  // Agent service logos - extracted from definition when agent is ready/active
  const [agentLogos, setAgentLogos] = React.useState<Map<string, SidebarServiceLogos>>(new Map())

  // Agent state for selected agent via AgentStateManager (single source of truth)
  // This ensures the banner in the session list shows the same state as ChatTabPanel
  const selectedAgentState = useAgentState(
    activeWorkspaceId,
    viewMode === 'agent' ? selectedAgentId : null
  )

  // Banner state from centralized hook (single source of truth)
  const bannerState = React.useMemo((): { state: BannerState; reason?: string } => {
    if (viewMode !== 'agent' || !selectedAgentId) {
      return { state: 'hidden' }
    }
    return {
      state: selectedAgentState.bannerState,
      reason: selectedAgentState.bannerReason ?? undefined
    }
  }, [viewMode, selectedAgentId, selectedAgentState.bannerState, selectedAgentState.bannerReason])

  // Unified sidebar keyboard navigation state
  // Load expanded folders from localStorage (default: all collapsed)
  const [expandedFolders, setExpandedFolders] = React.useState<Set<string>>(() => {
    const saved = localStorage.getItem('sidebar-expanded-folders')
    if (saved) {
      try {
        return new Set(JSON.parse(saved))
      } catch {
        return new Set()
      }
    }
    return new Set()
  })
  const [focusedSidebarItemId, setFocusedSidebarItemId] = React.useState<string | null>(null)
  const sidebarItemRefs = React.useRef<Map<string, HTMLElement>>(new Map())

  const activeWorkspace = workspaces.find(w => w.id === activeWorkspaceId)

  // Tab system
  const {
    tabs,
    openChatTab,
    openSettingsTab,
    openShortcutsTab,
    openAgentInfoTab,
    openAgentSetupTab,
    updateChatTabLabel,
    validateTabs,
    previousTab,
    nextTab,
    closeTab,
    activeTab,
  } = useTabs()

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
      // Tab navigation between zones (disabled when in textarea - Shift+Tab toggles plan mode there)
      { key: 'Tab', action: focusNextZone, when: () => !document.querySelector('[role="dialog"]') },
      { key: 'Tab', shift: true, action: focusPreviousZone, when: () => !document.querySelector('[role="dialog"]') && document.activeElement?.tagName !== 'TEXTAREA' },
      // Panel tab navigation
      { key: '[', cmd: true, action: previousTab },
      { key: ']', cmd: true, action: nextTab },
      { key: 'w', cmd: true, action: () => {
        if (!activeTab?.closable) return
        closeTabWithCleanup({
          tabId: activeTab.id,
          tabs,
          sessions,
          onDeleteSession,
          closeTab,
        })
      } },
      // Sidebar toggle
      { key: 'b', cmd: true, action: () => setIsSidebarVisible(v => !v) },
      // New chat (context-aware: uses selected agent if in agent view)
      { key: 'n', cmd: true, action: () => handleNewChat(true) },
      // Settings
      { key: ',', cmd: true, action: onOpenSettings },
    ],
  })

  // Resize effect for both sidebar and session list
  React.useEffect(() => {
    if (!isResizing) return

    const handleMouseMove = (e: MouseEvent) => {
      if (isResizing === 'sidebar') {
        const newWidth = Math.min(Math.max(e.clientX, 200), 400)
        setSidebarWidth(newWidth)
        if (resizeHandleRef.current) {
          const rect = resizeHandleRef.current.getBoundingClientRect()
          setSidebarHandleY(e.clientY - rect.top)
        }
      } else if (isResizing === 'session-list') {
        const offset = isSidebarVisible ? sidebarWidth : 0
        const newWidth = Math.min(Math.max(e.clientX - offset, 280), 500)
        setSessionListWidth(newWidth)
        if (sessionListHandleRef.current) {
          const rect = sessionListHandleRef.current.getBoundingClientRect()
          setSessionListHandleY(e.clientY - rect.top)
        }
      }
    }

    const handleMouseUp = () => {
      if (isResizing === 'sidebar') {
        localStorage.setItem('chat-sidebar-width', String(sidebarWidth))
        setSidebarHandleY(null)
      } else if (isResizing === 'session-list') {
        localStorage.setItem('chat-session-list-width', String(sessionListWidth))
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

  // Filter sessions by active workspace
  const workspaceSessions = activeWorkspaceId
    ? sessions.filter(s => s.workspaceId === activeWorkspaceId)
    : sessions

  // Count sessions by todo state (scoped to workspace)
  // Inbox = not done/cancelled, Done = todoState === 'done' or 'cancelled'
  const isDone = (s: Session) => s.todoState === 'done' || s.todoState === 'cancelled'
  const inboxCount = workspaceSessions.filter(s => !isDone(s)).length
  const archiveCount = workspaceSessions.filter(s => isDone(s)).length
  // Flagged can be both done and not done
  const flaggedCount = workspaceSessions.filter(s => s.isFlagged).length

  // Count sessions by individual todo state
  const todoStateCounts = React.useMemo(() => {
    const counts: Record<TodoStateId, number> = {
      'todo': 0,
      'in-progress': 0,
      'needs-review': 0,
      'done': 0,
      'cancelled': 0,
    }
    for (const s of workspaceSessions) {
      const state = (s.todoState || 'todo') as TodoStateId
      counts[state]++
    }
    return counts
  }, [workspaceSessions])

  // Get conversation count per agent (scoped to workspace)
  const getConversationCount = React.useCallback((agentId: string) => {
    return workspaceSessions.filter(s => s.agentId === agentId && !isDone(s)).length
  }, [workspaceSessions])

  // Filter sessions based on view mode and agent selection
  const filteredSessions = React.useMemo(() => {
    let result: Session[]

    if (viewMode === 'inbox') {
      // "All Chats" - shows all sessions (no filtering by done status)
      result = workspaceSessions
    } else if (viewMode === 'archive') {
      result = workspaceSessions.filter(s => isDone(s))
    } else if (viewMode === 'flagged') {
      // Flagged view shows both done and not done flagged items
      result = workspaceSessions.filter(s => s.isFlagged)
    } else if (viewMode === 'agent' && selectedAgentId) {
      result = workspaceSessions.filter(s => s.agentId === selectedAgentId && !isDone(s))
    } else if (viewMode.startsWith('state:')) {
      // Filter by specific todo state
      const stateId = viewMode.replace('state:', '') as TodoStateId
      result = workspaceSessions.filter(s => (s.todoState || 'todo') === stateId)
    } else {
      result = workspaceSessions
    }

    // Apply secondary filter by todo states if any are selected (only in inbox view)
    if (viewMode === 'inbox' && listFilter.size > 0) {
      result = result.filter(s => listFilter.has((s.todoState || 'todo') as TodoStateId))
    }

    return result
  }, [workspaceSessions, viewMode, selectedAgentId, listFilter])

  const selectedSession = sessions.find(s => s.id === session.selected) || null

  // Refs to avoid circular dependencies and unnecessary re-runs
  // openChatTabRef: clicking a tab would trigger the effect because openChatTab
  // depends on state.activeTabId, causing it to fight with the user's click
  // sessionsRef: we need to look up session data but don't want to re-run
  // the effect when sessions update (e.g., during streaming)
  const openChatTabRef = React.useRef(openChatTab)
  openChatTabRef.current = openChatTab
  const sessionsRef = React.useRef(sessions)
  sessionsRef.current = sessions

  // Sync session selection with tab system
  // When a session is selected, open (or focus) its chat tab
  // Uses refs for openChatTab and sessions to prevent re-running when:
  // - tabs switch (openChatTab changes)
  // - sessions update during generation (text_delta, etc.)
  React.useEffect(() => {
    if (session.selected && activeWorkspaceId) {
      const selectedSess = sessionsRef.current.find(s => s.id === session.selected)
      if (selectedSess) {
        openChatTabRef.current(
          selectedSess.id,
          selectedSess.workspaceId,
          selectedSess.name || 'New Chat',
          selectedSess.agentId
        )
      }
    }
  }, [session.selected, activeWorkspaceId])

  // Sync tab activation with sidebar state (reverse direction)
  // When user clicks a tab in the tab bar:
  // 1. session.selected - to highlight the session in the list
  // 2. viewMode/selectedAgentId - only if session isn't visible in current view
  // Does NOT sync when:
  // - Tab change was initiated by sidebar (session already selected)
  // - Opening a new tab (session already selected before tab exists)
  const prevActiveTabIdRef = React.useRef<string | null>(null)
  const sessionSelectedRef = React.useRef(session.selected)
  sessionSelectedRef.current = session.selected
  const filteredSessionsRef = React.useRef(filteredSessions)
  filteredSessionsRef.current = filteredSessions

  React.useEffect(() => {
    const currentTabId = activeTab?.id ?? null

    // Only sync when the tab actually changes
    if (currentTabId === prevActiveTabIdRef.current) {
      return
    }
    prevActiveTabIdRef.current = currentTabId

    if (activeTab?.type === 'chat') {
      const chatTab = activeTab as ChatTab

      // If session is already selected, this was initiated by sidebar/new session
      // The sidebar is already in the correct state, no sync needed
      if (sessionSelectedRef.current === chatTab.sessionId) {
        return
      }

      // Tab bar click - update session selection
      setSession({ selected: chatTab.sessionId })

      // Check if session is visible in current view
      const isVisibleInCurrentView = filteredSessionsRef.current.some(
        s => s.id === chatTab.sessionId
      )

      // Only change view if session isn't visible in current list
      if (!isVisibleInCurrentView) {
        if (chatTab.agentId) {
          setViewMode('agent')
          setSelectedAgentId(chatTab.agentId)
        } else {
          setViewMode('inbox')
          setSelectedAgentId(null)
        }
      }
    }
  }, [activeTab, setSession])

  // Track if sessions have been loaded at least once
  const sessionsLoadedRef = React.useRef(false)

  // Validate tabs when sessions change (remove stale chat tabs)
  // Skip validation until sessions are loaded to prevent removing tabs on initial empty state
  React.useEffect(() => {
    // Mark as loaded once we have sessions
    if (sessions.length > 0) {
      sessionsLoadedRef.current = true
    }
    // Only validate after sessions have been loaded at least once
    if (!sessionsLoadedRef.current) {
      return
    }
    const validSessionIds = new Set(sessions.map(s => s.id))
    validateTabs(validSessionIds)
  }, [sessions, validateTabs])

  // Wrap delete handler to clear selection when deleting the currently selected session
  // This prevents stale state during re-renders that could cause crashes
  const handleDeleteSession = useCallback(async (sessionId: string, skipConfirmation?: boolean): Promise<boolean> => {
    // Clear selection first if this is the selected session
    if (session.selected === sessionId) {
      setSession({ selected: null })
    }
    return onDeleteSession(sessionId, skipConfirmation)
  }, [session.selected, setSession, onDeleteSession])

  // Extend context value with local overrides (textareaRef, wrapped onDeleteSession)
  const chatContextValue = React.useMemo<ChatContextType>(() => ({
    ...contextValue,
    onDeleteSession: handleDeleteSession,
    textareaRef: chatInputRef,
  }), [contextValue, handleDeleteSession])

  // Group agents for tree view
  const agentTree = React.useMemo(() => groupAgentsByFolder(agents), [agents])

  // Persist expanded folders to localStorage
  React.useEffect(() => {
    localStorage.setItem('sidebar-expanded-folders', JSON.stringify([...expandedFolders]))
  }, [expandedFolders])

  // Persist sidebar visibility to localStorage
  React.useEffect(() => {
    localStorage.setItem('chat-sidebar-visible', String(isSidebarVisible))
  }, [isSidebarVisible])

  // Persist list filter to localStorage
  React.useEffect(() => {
    localStorage.setItem('chat-list-filter', JSON.stringify([...listFilter]))
  }, [listFilter])

  // Helper to map AgentStatus to SidebarAgentStatus (centralized logic)
  const mapAgentStatusToSidebar = React.useCallback((status: import('../../../shared/types').AgentStatus): SidebarAgentStatus => {
    switch (status.status) {
      case 'idle':
        // Use centralized setup info from status
        if (status.needsAuth) {
          return 'needs_auth'
        }
        if (status.needsSetup) {
          return 'needs_setup'
        }
        return 'ready'
      case 'extracting':
        return 'loading'
      case 'needs_mcp_auth':
      case 'needs_api_auth':
        return 'needs_auth'
      case 'ready':
      case 'active':
        return 'ready'
      case 'error':
        return 'error'
      default:
        return 'needs_setup'
    }
  }, [])

  // Extract logo info from AgentStatus when status is ready/active
  // Returns null if no MCP servers or APIs (nothing to display)
  const extractLogosFromStatus = React.useCallback((status: import('../../../shared/types').AgentStatus): SidebarServiceLogos | null => {
    if (status.status !== 'ready' && status.status !== 'active') {
      return null
    }
    const def = status.definition
    const mcpLogos = def.mcpServers?.map(s => ({ name: s.name, logo: s.logo })) ?? []
    const apiLogos = def.apis?.map(a => ({ name: a.name, logo: a.logo })) ?? []

    // Don't return anything if there are no services to display
    if (mcpLogos.length === 0 && apiLogos.length === 0) {
      return null
    }

    return { mcpLogos, apiLogos }
  }, [])

  // Fetch status for all agents when agents list changes (uses centralized getAgentStatus)
  React.useEffect(() => {
    if (!activeWorkspaceId || agents.length === 0) {
      setAgentStatus(new Map())
      setAgentLogos(new Map())
      return
    }

    const fetchStatuses = async () => {
      const newStatus = new Map<string, SidebarAgentStatus>()
      const newLogos = new Map<string, SidebarServiceLogos>()

      await Promise.all(
        agents.map(async (agent) => {
          try {
            const result = await window.electronAPI.getAgentStatus(activeWorkspaceId, agent.id)
            newStatus.set(agent.id, mapAgentStatusToSidebar(result))

            // Extract logos if agent is ready/active
            const logos = extractLogosFromStatus(result)
            if (logos) {
              newLogos.set(agent.id, logos)
            }
          } catch {
            newStatus.set(agent.id, 'error')
          }
        })
      )

      setAgentStatus(newStatus)
      setAgentLogos(newLogos)
    }

    fetchStatuses()
  }, [activeWorkspaceId, agents, mapAgentStatusToSidebar, extractLogosFromStatus])

  // Listen for agent status changes from broadcastAgentState()
  // This is now the SINGLE listener for all agent state changes:
  // - Status changes (extracting, ready, active, error)
  // - Auth changes (credentials saved/cleared)
  // - Reset (credentials and cache cleared)
  // The complete state (status + needsSetup + needsAuth) is always included
  React.useEffect(() => {
    const cleanup = window.electronAPI.onAgentStatusChanged((workspaceId, agentId, status) => {
      if (workspaceId !== activeWorkspaceId) return

      setAgentStatus(prev => {
        const next = new Map(prev)
        next.set(agentId, mapAgentStatusToSidebar(status))
        return next
      })

      // Update logos if status includes definition
      const logos = extractLogosFromStatus(status)
      setAgentLogos(prev => {
        const next = new Map(prev)
        if (logos) {
          next.set(agentId, logos)
        } else {
          next.delete(agentId)
        }
        return next
      })
    })

    return cleanup
  }, [activeWorkspaceId, mapAgentStatusToSidebar, extractLogosFromStatus])

  // Handler functions (defined before the unified list so they can be referenced)
  const handleSelectAgent = useCallback(async (agentId: string, _agentName: string) => {
    if (!activeWorkspaceId) return

    // Always select the agent - banner state is derived from useAgentState hook
    setSelectedAgentId(agentId)
    setViewMode('agent')
  }, [activeWorkspaceId])

  // Handle banner action (open setup tab)
  const handleBannerAction = useCallback(() => {
    if (!selectedAgentId || !activeWorkspaceId) return

    const agent = agents.find(a => a.id === selectedAgentId)
    if (!agent) return

    // Open setup tab for both setup and auth states
    openAgentSetupTab(agent.id, activeWorkspaceId, agent.displayName || agent.name)
  }, [selectedAgentId, activeWorkspaceId, agents, openAgentSetupTab])

  const handleInboxClick = useCallback(() => {
    setViewMode('inbox')
    setSelectedAgentId(null)
    setSession({ selected: null })
  }, [setSession])

  const handleArchiveClick = useCallback(() => {
    setViewMode('archive')
    setSelectedAgentId(null)
    setSession({ selected: null })
  }, [setSession])

  const handleFlaggedClick = useCallback(() => {
    setViewMode('flagged')
    setSelectedAgentId(null)
    setSession({ selected: null })
  }, [setSession])

  // Handler for individual todo state views
  const handleTodoStateClick = useCallback((stateId: TodoStateId) => {
    setViewMode(`state:${stateId}`)
    setSelectedAgentId(null)
    setSession({ selected: null })
  }, [setSession])

  // Create a new chat and select it
  // Uses selectedAgentId when in agent view, otherwise creates a session without agent
  const handleNewChat = useCallback(async (useCurrentAgent: boolean = true) => {
    if (!activeWorkspace) return

    const agentId = useCurrentAgent && viewMode === 'agent' ? selectedAgentId || undefined : undefined
    const newSession = await onCreateSession(activeWorkspace.id, agentId)
    setSession({ selected: newSession.id })
  }, [activeWorkspace, viewMode, selectedAgentId, onCreateSession, setSession])

  // Respond to menu bar "New Chat" trigger
  const menuTriggerRef = useRef(menuNewChatTrigger)
  useEffect(() => {
    // Skip initial render
    if (menuTriggerRef.current === menuNewChatTrigger) return
    menuTriggerRef.current = menuNewChatTrigger
    handleNewChat(true)
  }, [menuNewChatTrigger, handleNewChat])

  // Handle agent context menu actions
  const handleAgentAction = useCallback(async (action: AgentAction) => {
    if (!activeWorkspaceId) return

    switch (action.type) {
      case 'new_conversation':
        // Create a new conversation with this agent
        setSelectedAgentId(action.agent.id)
        setViewMode('agent')
        const newSession = await onCreateSession(activeWorkspaceId, action.agent.id)
        setSession({ selected: newSession.id })
        break

      case 'info':
        // Open agent info in a tab
        openAgentInfoTab(action.agent.id, activeWorkspaceId, action.agent.displayName || action.agent.name)
        break

      case 'reset':
        // Reset clears both cached instructions and auth credentials
        console.log('[Chat] Resetting agent:', action.agent.name)
        const resetSuccess = await window.electronAPI.resetAgent(activeWorkspaceId, action.agent.id)
        if (resetSuccess) {
          console.log('[Chat] Agent reset successfully:', action.agent.name)
          // Sidebar and banners will update automatically via AGENT_STATUS_CHANGED broadcast
        } else {
          console.error('[Chat] Failed to reset agent:', action.agent.name)
          setAgentStatus(prev => new Map(prev).set(action.agent.id, 'error'))
        }
        break
    }
  }, [activeWorkspaceId, openAgentInfoTab, onCreateSession, setSession])

  // Unified sidebar items: nav buttons + tree items
  // This creates one continuous navigable list for the entire sidebar
  type SidebarItem = {
    id: string
    type: 'nav' | 'agent' | 'folder'
    action?: () => void
    agentId?: string
    folderPath?: string
    parentPath?: string
  }

  const unifiedSidebarItems = React.useMemo((): SidebarItem[] => {
    const result: SidebarItem[] = []

    // 1. Nav items (Inbox, Flagged)
    result.push({ id: 'nav:inbox', type: 'nav', action: handleInboxClick })
    result.push({ id: 'nav:flagged', type: 'nav', action: handleFlaggedClick })

    // 2. Status nav items (todo states)
    result.push({ id: 'nav:state:todo', type: 'nav', action: () => handleTodoStateClick('todo') })
    result.push({ id: 'nav:state:in-progress', type: 'nav', action: () => handleTodoStateClick('in-progress') })
    result.push({ id: 'nav:state:needs-review', type: 'nav', action: () => handleTodoStateClick('needs-review') })
    result.push({ id: 'nav:state:done', type: 'nav', action: () => handleTodoStateClick('done') })
    result.push({ id: 'nav:state:cancelled', type: 'nav', action: () => handleTodoStateClick('cancelled') })

    // 3. Tree items (agents and folders)
    const flattenTree = (folder: AgentFolder) => {
      // Sort items: agents first (alphabetically), then folders (alphabetically)
      const agentItems = folder.agents
        .map(a => ({ type: 'agent' as const, agent: a }))
        .sort((a, b) => {
          const nameA = a.agent.name.split('/').pop()!
          const nameB = b.agent.name.split('/').pop()!
          return nameA.localeCompare(nameB)
        })
      const folderItems = folder.subfolders
        .map(f => ({ type: 'folder' as const, folder: f }))
        .sort((a, b) => a.folder.name.localeCompare(b.folder.name))

      // Add agents first
      for (const item of agentItems) {
        result.push({
          id: `agent:${item.agent.id}`,
          type: 'agent',
          agentId: item.agent.id,
          parentPath: folder.path.join('/'),
        })
      }

      // Then folders
      for (const item of folderItems) {
        const folderPath = item.folder.path.join('/')
        result.push({
          id: `folder:${folderPath}`,
          type: 'folder',
          folderPath,
          parentPath: folder.path.join('/'),
        })
        // Only add children if folder is expanded
        if (expandedFolders.has(folderPath)) {
          flattenTree(item.folder)
        }
      }
    }
    flattenTree(agentTree)

    return result
  }, [agentTree, expandedFolders, handleInboxClick, handleFlaggedClick, handleTodoStateClick])

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
        // For folders: collapse if expanded, otherwise go to parent
        if (currentItem?.type === 'folder' && currentItem.folderPath && expandedFolders.has(currentItem.folderPath)) {
          handleToggleFolder(currentItem.folderPath)
        } else if (currentItem?.parentPath) {
          const parentId = `folder:${currentItem.parentPath}`
          const parentItem = unifiedSidebarItems.find(item => item.id === parentId)
          if (parentItem) {
            setFocusedSidebarItemId(parentId)
            sidebarItemRefs.current.get(parentId)?.focus()
          }
        } else {
          // At boundary - do nothing (Left doesn't change zones from sidebar)
        }
        break
      }
      case 'ArrowRight': {
        e.preventDefault()
        // For folders: expand if collapsed
        if (currentItem?.type === 'folder' && currentItem.folderPath && !expandedFolders.has(currentItem.folderPath)) {
          handleToggleFolder(currentItem.folderPath)
        } else {
          // Move to next zone (session list)
          focusZone('session-list')
        }
        break
      }
      case 'Enter':
      case ' ': {
        e.preventDefault()
        if (currentItem?.type === 'nav' && currentItem.action) {
          currentItem.action()
        } else if (currentItem?.type === 'folder' && currentItem.folderPath) {
          handleToggleFolder(currentItem.folderPath)
        } else if (currentItem?.type === 'agent' && currentItem.agentId) {
          const agent = agents.find(a => a.id === currentItem.agentId)
          if (agent) {
            handleSelectAgent(agent.id, agent.name)
          }
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
  }, [sidebarFocused, unifiedSidebarItems, focusedSidebarItemId, expandedFolders, handleToggleFolder, agents, handleSelectAgent, focusZone])

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

  // Get title based on view mode
  const listTitle = React.useMemo(() => {
    if (viewMode === 'archive') return 'Archive'
    if (viewMode === 'flagged') return 'Flagged'
    if (viewMode === 'agent' && selectedAgentId) {
      return agents.find(a => a.id === selectedAgentId)?.displayName ||
             agents.find(a => a.id === selectedAgentId)?.name ||
             'All Chats'
    }
    if (viewMode.startsWith('state:')) {
      const stateId = viewMode.replace('state:', '') as TodoStateId
      const state = DEFAULT_TODO_STATES.find(s => s.id === stateId)
      return state?.label || 'All Chats'
    }
    return 'All Chats'
  }, [viewMode, selectedAgentId, agents])

  return (
    <ChatProvider value={chatContextValue}>
      <TooltipProvider delayDuration={0}>
        {/*
          Draggable title bar region for transparent window (macOS)
          - Fixed overlay at z-40 allows window dragging from the top bar area
          - Interactive elements (buttons, dropdowns) must use:
            1. titlebar-no-drag: prevents drag behavior on clickable elements
            2. relative z-50: ensures elements render above this drag overlay
        */}
        <div className="titlebar-drag-region fixed top-0 left-0 right-0 h-[50px] z-40" />

      {/* Sidebar Toggle Button - fixed position, animated opacity */}
      <motion.div
        initial={false}
        animate={{ opacity: isSidebarVisible ? 0 : 1 }}
        transition={{ duration: 0.15 }}
        className="fixed left-[86px] top-[13px] z-[60]"
        style={{ pointerEvents: isSidebarVisible ? 'none' : 'auto' }}
      >
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setIsSidebarVisible(true)}
          className="h-7 w-7 titlebar-no-drag rounded-[4px] hover:bg-foreground/5"
        >
          <PanelLeftRounded className="!h-5 !w-5 -translate-y-px" />
        </Button>
      </motion.div>

      {/* === OUTER LAYOUT: Sidebar | Main Content === */}
      <div className="h-full flex items-stretch relative">
        {/* === SIDEBAR (Left) ===
            Animated width with spring physics for smooth 60-120fps transitions.
            Uses overflow-hidden to clip content during collapse animation.
            Resizable via drag handle on right edge (200-400px range). */}
        <motion.div
          initial={false}
          animate={{ width: isSidebarVisible ? sidebarWidth : 0 }}
          transition={isResizing ? { duration: 0 } : springTransition}
          className="h-full overflow-hidden shrink-0 relative"
        >
          <div
            ref={sidebarRef}
            style={{ width: sidebarWidth }}
            className="h-full bg-sidebar font-sans relative border-r border-border"
            data-focus-zone="sidebar"
            tabIndex={sidebarFocused ? 0 : -1}
            onKeyDown={handleSidebarKeyDown}
          >
            {/* Header row: Logo (left) + Toggle Button (right) */}
            <div className="absolute top-0 left-0 right-0 h-[50px] z-50 titlebar-no-drag">
              {/* App Menu - left aligned after traffic lights */}
              <div className="absolute left-[86px] top-0 bottom-0 flex items-center">
                <AppMenu
                  onNewChat={() => handleNewChat(true)}
                  onOpenSettings={onOpenSettings}
                  onOpenKeyboardShortcuts={onOpenKeyboardShortcuts}
                  onOpenStoredUserPreferences={onOpenStoredUserPreferences}
                  onOpenHelp={() => window.electronAPI.openUrl('https://agents.craft.do/docs')}
                  onOpenCraft={() => window.electronAPI.openUrl('craftdocs://')}
                  onLogout={onLogout}
                />
              </div>
              {/* Toggle button - right aligned */}
              <div className="absolute right-2 top-0 bottom-0 flex items-center">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setIsSidebarVisible(false)}
                  className="h-7 w-7 shrink-0 rounded-[4px] hover:bg-foreground/5"
                >
                  <PanelLeftRounded className="!h-5 !w-5 -translate-y-px" />
                </Button>
              </div>
            </div>
            <div className="flex h-full flex-col pt-[50px]">
              {/* Sidebar Top Section */}
              <div className="flex-1 flex flex-col min-h-0">
                {/* New Chat Button - Gmail-style */}
                <div className="px-2 pt-2 pb-1">
                  <Button
                    variant="ghost"
                    onClick={() => handleNewChat(true)}
                    disabled={viewMode === 'agent' && bannerState.state !== 'hidden'}
                    className="w-full justify-start gap-2 py-[7px] px-2 text-[13px] font-normal rounded-[6px] shadow-minimal bg-background"
                  >
                    <SquarePenRounded className="h-3.5 w-3.5 shrink-0" />
                    New Chat
                  </Button>
                </div>
                {/* Primary Nav: All Chats, Flagged */}
                <LeftSidebar
                  isCollapsed={false}
                  getItemProps={getSidebarItemProps}
                  focusedItemId={focusedSidebarItemId}
                  links={[
                    {
                      id: "nav:inbox",
                      title: "All Chats",
                      label: String(workspaceSessions.length),
                      icon: Inbox,
                      variant: viewMode === 'inbox' ? "default" : "ghost",
                      onClick: handleInboxClick,
                    },
                    {
                      id: "nav:flagged",
                      title: "Flagged",
                      label: String(flaggedCount),
                      icon: Flag,
                      variant: viewMode === 'flagged' ? "default" : "ghost",
                      onClick: handleFlaggedClick,
                    },
                  ]}
                />
                {/* Status Section Header */}
                <div className="flex items-center pl-4 pr-2 pt-2 pb-1">
                  <span className="text-xs font-medium text-muted-foreground select-none">Status</span>
                </div>
                {/* Status Nav: Todo states */}
                <LeftSidebar
                  isCollapsed={false}
                  getItemProps={getSidebarItemProps}
                  focusedItemId={focusedSidebarItemId}
                  links={[
                    {
                      id: "nav:state:todo",
                      title: "Todo",
                      label: String(todoStateCounts['todo']),
                      icon: <CircleDashed className="h-3.5 w-3.5" />,
                      iconColor: "text-muted-foreground",
                      variant: viewMode === 'state:todo' ? "default" : "ghost",
                      onClick: () => handleTodoStateClick('todo'),
                    },
                    {
                      id: "nav:state:in-progress",
                      title: "In Progress",
                      label: String(todoStateCounts['in-progress']),
                      icon: <CircleProgress className="h-3.5 w-3.5" />,
                      iconColor: getStateColor('in-progress'),
                      variant: viewMode === 'state:in-progress' ? "default" : "ghost",
                      onClick: () => handleTodoStateClick('in-progress'),
                    },
                    {
                      id: "nav:state:needs-review",
                      title: "Needs Review",
                      label: String(todoStateCounts['needs-review']),
                      icon: <CircleEye className="h-3.5 w-3.5" />,
                      iconColor: getStateColor('needs-review'),
                      variant: viewMode === 'state:needs-review' ? "default" : "ghost",
                      onClick: () => handleTodoStateClick('needs-review'),
                    },
                    {
                      id: "nav:state:done",
                      title: "Done",
                      label: String(todoStateCounts['done']),
                      icon: <CircleCheckFilled className="h-3.5 w-3.5" />,
                      iconColor: "text-[#9570BE]",
                      variant: viewMode === 'state:done' ? "default" : "ghost",
                      onClick: () => handleTodoStateClick('done'),
                    },
                    {
                      id: "nav:state:cancelled",
                      title: "Cancelled",
                      label: String(todoStateCounts['cancelled']),
                      icon: <CircleXFilled className="h-3.5 w-3.5" />,
                      iconColor: "text-muted-foreground/60",
                      variant: viewMode === 'state:cancelled' ? "default" : "ghost",
                      onClick: () => handleTodoStateClick('cancelled'),
                    },
                  ]}
                />
                {/* Agent Tree: Hierarchical list of agents */}
                <div className="group/agents flex-1 min-h-0 flex flex-col overflow-hidden pt-0.5">
                  {/* Agents Section Header with menu */}
                  <div className="flex items-center justify-between pl-4 pr-2 py-2 shrink-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium text-muted-foreground select-none">Agents</span>
                      {isLoadingAgents && agents.length > 0 && (
                        <Spinner className="text-xs text-muted-foreground" />
                      )}
                    </div>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button
                          className="p-1 rounded hover:bg-foreground/5 data-[state=open]:bg-foreground/5 text-muted-foreground hover:text-foreground"
                        >
                          <MoreHorizontal className="h-3.5 w-3.5" />
                        </button>
                      </DropdownMenuTrigger>
                      <StyledDropdownMenuContent align="end" minWidth="min-w-0">
                        <StyledDropdownMenuItem onClick={onRefreshAgents}>
                          <RotateCw />
                          Refresh
                        </StyledDropdownMenuItem>
                      </StyledDropdownMenuContent>
                    </DropdownMenu>
                  </div>
                  {/* Scrollable Agent Tree */}
                  <ScrollArea className="flex-1 min-h-0">
                    <AnimatePresence mode="wait">
                      <motion.div
                        key={activeWorkspaceId ?? 'none'}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.15 }}
                        className="px-2 pb-2"
                      >
                        {agents.length === 0 ? (
                          isLoadingAgents ? (
                            <div className="flex items-center gap-2 px-2 py-4">
                              <Spinner className="text-sm text-muted-foreground" />
                              <span className="text-xs text-muted-foreground">Loading agents...</span>
                            </div>
                          ) : (
                            <p className="text-xs text-muted-foreground px-2 py-4">
                              No agents found. Create an "Agents" folder in your Craft space.
                            </p>
                          )
                        ) : (
                          <AgentTree
                            folder={agentTree}
                            level={0}
                            isCollapsed={false}
                            selectedAgentId={selectedAgentId}
                            onSelectAgent={handleSelectAgent}
                            getConversationCount={getConversationCount}
                            onAgentAction={handleAgentAction}
                            isFocused={sidebarFocused}
                            expandedFolders={expandedFolders}
                            onToggleFolder={handleToggleFolder}
                            focusedItemId={focusedSidebarItemId}
                            onFocusItem={setFocusedSidebarItemId}
                            getItemProps={getSidebarItemProps}
                            agentStatus={agentStatus}
                            agentLogos={agentLogos}
                          />
                        )}
                      </motion.div>
                    </AnimatePresence>
                  </ScrollArea>
                </div>
              </div>

              {/* Sidebar Bottom Section: WorkspaceSwitcher + Settings */}
              <div className="mt-auto shrink-0">
                <Separator className="bg-foreground/10" />
                <div className="flex items-center py-2 px-2 gap-2">
                  <div className="flex-1 min-w-0">
                    <WorkspaceSwitcher
                      isCollapsed={false}
                      workspaces={workspaces}
                      activeWorkspaceId={activeWorkspaceId}
                      onSelect={onSelectWorkspace}
                      onAddWorkspace={onAddWorkspace}
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

        {/* Resize Handle - OUTSIDE sidebar so it's not clipped by overflow-hidden
            Touch area: 12px wide (±6px from edge)
            Visual: 2px wide gradient centered in touch area */}
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

        {/* === MAIN CONTENT (Right) ===
            Flex layout: Session List | Chat Display */}
        <div className="flex-1 overflow-hidden min-w-0 flex h-full">
          {/* === SESSION LIST PANEL === */}
          <div
            className="h-full flex flex-col min-w-0 bg-background shrink-0"
            style={{ width: sessionListWidth }}
          >
            {/* Header: Dynamic title (Conversations/Archive/Agent name)
                Animated margin when sidebar toggles - uses same spring curve */}
            <motion.div
              initial={false}
              animate={{ marginLeft: isSidebarVisible ? 0 : 102 }}
              transition={springTransition}
              className="flex h-[50px] shrink-0 items-center pl-5 pr-2 min-w-0 relative z-50"
            >
              <div className="flex-1 min-w-0 flex flex-col justify-center">
                <h1 className="text-sm font-semibold truncate font-sans leading-tight">{listTitle}</h1>
                <p className="text-[11px] opacity-50 font-sans leading-tight">{filteredSessions.length} conversations</p>
              </div>
              {/* Filter dropdown - allows filtering by todo states (only in All Chats view) */}
              {viewMode === 'inbox' && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className={cn(
                        "h-7 w-7 shrink-0 rounded-[4px] titlebar-no-drag",
                        listFilter.size > 0 ? "text-primary" : "text-muted-foreground hover:text-foreground"
                      )}
                    >
                      <ListFilter className="h-4 w-4" />
                    </Button>
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
                      <span className="w-3.5 ml-4">{listFilter.has('todo') && <Check className="h-3.5 w-3.5 text-primary" />}</span>
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
                      <CircleProgress className={cn("h-3.5 w-3.5", getStateColor('in-progress'))} />
                      <span className="flex-1">In Progress</span>
                      <span className="w-3.5 ml-4">{listFilter.has('in-progress') && <Check className="h-3.5 w-3.5 text-primary" />}</span>
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
                      <CircleEye className={cn("h-3.5 w-3.5", getStateColor('needs-review'))} />
                      <span className="flex-1">Needs Review</span>
                      <span className="w-3.5 ml-4">{listFilter.has('needs-review') && <Check className="h-3.5 w-3.5 text-primary" />}</span>
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
                      <CircleCheckFilled className="h-3.5 w-3.5 text-[#9570BE]" />
                      <span className="flex-1">Done</span>
                      <span className="w-3.5 ml-4">{listFilter.has('done') && <Check className="h-3.5 w-3.5 text-primary" />}</span>
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
                      <span className="w-3.5 ml-4">{listFilter.has('cancelled') && <Check className="h-3.5 w-3.5 text-primary" />}</span>
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
              {/* More menu with Search for non-inbox views */}
              {viewMode !== 'inbox' && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 shrink-0 rounded-[4px] titlebar-no-drag text-muted-foreground hover:text-foreground"
                    >
                      <MoreHorizontal className="h-4 w-4" />
                    </Button>
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
            </motion.div>
            <Separator />
            {/* Activation/Auth Banner - shows when agent needs activation or authentication */}
            <SetupAuthBanner
              state={viewMode === 'agent' ? bannerState.state : 'hidden'}
              agentName={selectedAgentId ? agents.find(a => a.id === selectedAgentId)?.displayName || agents.find(a => a.id === selectedAgentId)?.name : undefined}
              reason={bannerState.reason}
              onAction={handleBannerAction}
            />
            {/* SessionList: Scrollable list of session cards */}
            {/* Key on viewMode forces full remount when switching views, skipping animations */}
            <SessionList
              key={viewMode}
              items={filteredSessions}
              onDelete={handleDeleteSession}
              onFlag={onFlagSession}
              onUnflag={onUnflagSession}
              onMarkUnread={onMarkSessionUnread}
              onTodoStateChange={onTodoStateChange}
              onRename={onRenameSession}
              onFocusChatInput={focusChatInput}
              onSessionSelect={(selectedSession, { forceNewTab }) => {
                if (activeWorkspaceId) {
                  openChatTab(
                    selectedSession.id,
                    activeWorkspaceId,
                    getSessionTitle(selectedSession),
                    selectedSession.agentId,
                    { forceNew: forceNewTab }
                  )
                }
              }}
              onNavigateToView={(view) => {
                if (view === 'completed') {
                  setViewMode('archive')
                } else if (view === 'inbox') {
                  setViewMode('inbox')
                } else if (view === 'flagged') {
                  setViewMode('flagged')
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
            />
          </div>

          {/* Session List Resize Handle */}
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
            className="relative w-px h-full cursor-col-resize flex justify-center shrink-0"
          >
            {/* Horizontal connector at header height */}
            <div className="absolute h-px bg-border" style={{ top: 50, left: -6, right: 0 }} />
            {/* Touch area */}
            <div className="absolute inset-y-0 -left-1.5 -right-1.5 flex justify-center cursor-col-resize">
              <div className="w-px h-full bg-border" />
              <div
                className="absolute inset-y-0 left-1/2 -translate-x-1/2 w-0.5"
                style={getResizeGradientStyle(sessionListHandleY)}
              />
            </div>
          </div>

          {/* === TAB CONTAINER PANEL === */}
          <div className="flex-1 overflow-hidden min-w-0 bg-background">
            <TabContainer />
          </div>
        </div>
      </div>

      </TooltipProvider>
    </ChatProvider>
  )
}
