import * as React from "react"
import { useRef, useState, useEffect, useCallback } from "react"
import { motion } from "motion/react"
import {
  Archive,
  Inbox,
  Settings,
  ChevronRight,
  FolderOpen,
  MoreHorizontal,
  RotateCw,
  CircleAlert,
  CloudOff,
  PowerOff,
} from "lucide-react"
import { Spinner } from "@/components/ui/loading-indicator"
import { AppMenu } from "../AppMenu"
import { PanelLeftRounded } from "../icons/PanelLeftRounded"
import { SquarePenRounded } from "../icons/SquarePenRounded"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import {
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable"
import { GradientResizeHandle } from "@/components/ui/gradient-resize-handle"
import { Separator } from "@/components/ui/separator"
import { TooltipProvider } from "@/components/ui/tooltip"
import {
  DropdownMenu,
  DropdownMenuTrigger,
  StyledDropdownMenuContent,
  StyledDropdownMenuItem,
} from "@/components/ui/styled-dropdown"
import { ScrollArea } from "@/components/ui/scroll-area"
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
import { AgentInfoDialog } from "./AgentInfoDialog"
import { AgentAuthDialog } from "./AgentAuthDialog"
import { SetupAuthBanner, type BannerState } from "./SetupAuthBanner"
import { useSession } from "@/hooks/useSession"
import { TabContainer, useTabs } from "@/tabs"
import { ChatProvider, type ChatContextType } from "@/context/ChatContext"
import { getResizeGradientStyle } from "@/hooks/useResizeGradient"
import { useFocusZone, useGlobalShortcuts } from "@/hooks/keyboard"
import { useFocusContext } from "@/context/FocusContext"
import { getSessionTitle } from "@/utils/session"
import type { Session, Workspace, SubAgentMetadata, FileAttachment, PermissionRequest } from "../../../shared/types"

type ViewMode = 'inbox' | 'archive' | 'agent'

interface ChatProps {
  workspaces: Workspace[]
  sessions: Session[]
  agents: SubAgentMetadata[]
  isLoadingAgents?: boolean
  activeWorkspaceId: string | null
  defaultLayout?: number[]
  defaultCollapsed?: boolean
  // Model selection
  currentModel: string
  // Menu bar trigger - increments when menu bar "New Chat" is clicked
  menuNewChatTrigger?: number
  onModelChange: (model: string) => void
  // Callbacks
  onSelectWorkspace: (id: string) => void
  onCreateSession: (workspaceId: string, agentId?: string) => Promise<Session>
  onDeleteSession: (sessionId: string) => void
  onArchiveSession: (sessionId: string) => void
  onUnarchiveSession: (sessionId: string) => void
  onRenameSession: (sessionId: string, name: string) => void
  onSendMessage: (sessionId: string, message: string, attachments?: FileAttachment[]) => void
  onOpenFile: (path: string) => void
  onOpenUrl: (url: string) => void
  onOpenSettings: () => void
  onOpenKeyboardShortcuts: () => void
  onRefreshAgents: () => void
  onLogout: () => void
  onAddWorkspace: () => void
  // Permission handling (queue to support multiple concurrent requests)
  pendingPermissions?: Map<string, PermissionRequest[]>
  onRespondToPermission?: (sessionId: string, requestId: string, allowed: boolean, alwaysAllow: boolean) => void
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
}

/**
 * FadingText - Text that fades with gradient only when overflowing
 */
function FadingText({
  children,
  className,
  fadeWidth = 24
}: {
  children: React.ReactNode
  className?: string
  fadeWidth?: number
}) {
  const ref = useRef<HTMLSpanElement>(null)
  const [isOverflowing, setIsOverflowing] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return

    const checkOverflow = () => {
      setIsOverflowing(el.scrollWidth > el.clientWidth)
    }

    checkOverflow()

    const observer = new ResizeObserver(checkOverflow)
    observer.observe(el)

    return () => observer.disconnect()
  }, [children])

  return (
    <span
      ref={ref}
      className={cn(
        "min-w-0 overflow-hidden whitespace-nowrap",
        className
      )}
      style={isOverflowing ? {
        maskImage: `linear-gradient(to right, black calc(100% - ${fadeWidth}px), transparent)`
      } : undefined}
    >
      {children}
    </span>
  )
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
          "flex w-full items-center gap-2 overflow-hidden rounded-md py-[6px] px-2 text-[13px] select-none outline-none",
          "focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
          isSelected(agent.id)
            ? "bg-primary text-primary-foreground dark:bg-muted dark:text-foreground"
            : "hover:bg-foreground/5",
          (isFocusedItem || isMenuOpen) && !isSelected(agent.id) && "bg-foreground/5"
        )}
        role="treeitem"
        aria-selected={isSelected(agent.id)}
      >
        <FadingText>
          {agent.displayName || agent.name.split('/').pop()}
        </FadingText>
        {/* Status indicator based on SidebarAgentStatus - all shown on hover only */}
        {(() => {
          const status = agentStatus?.get(agent.id)
          const hoverClasses = "ml-auto shrink-0 opacity-0 group-hover/agents:opacity-100 transition-opacity"
          switch (status) {
            case 'loading':
              return <Spinner className={cn("text-sm text-foreground/40", hoverClasses)} />
            case 'needs_setup':
              return <PowerOff className={cn("h-3.5 w-3.5 text-foreground/40", hoverClasses)} />
            case 'needs_auth':
              return <CloudOff className={cn("h-3.5 w-3.5 text-foreground/40", hoverClasses)} />
            case 'error':
              return <CircleAlert className={cn("h-3.5 w-3.5 text-foreground/40", hoverClasses)} />
            default:
              // idle, ready, or undefined - show conversation count on hover
              return (
                <span className={cn(
                  "text-xs",
                  hoverClasses,
                  isSelected(agent.id) ? "text-primary-foreground/50 dark:text-foreground/50" : "text-muted-foreground/50"
                )}>
                  {getConversationCount(agent.id)}
                </span>
              )
          }
        })()}
      </button>
    )

    return (
      <li key={agent.id} className="min-w-0">
        {onAgentAction ? (
          <AgentContextMenu
            agent={agent}
            onAction={onAgentAction}
            onOpenChange={(open) => setOpenMenuAgentId(open ? agent.id : null)}
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
  workspaces,
  sessions,
  agents,
  isLoadingAgents = false,
  activeWorkspaceId,
  defaultLayout = [20, 32, 48],
  defaultCollapsed = false,
  currentModel,
  menuNewChatTrigger,
  onModelChange,
  onSelectWorkspace,
  onCreateSession,
  onDeleteSession,
  onArchiveSession,
  onUnarchiveSession,
  onRenameSession,
  onSendMessage,
  onOpenFile,
  onOpenUrl,
  onOpenSettings,
  onOpenKeyboardShortcuts,
  onRefreshAgents,
  onLogout,
  onAddWorkspace,
  pendingPermissions,
  onRespondToPermission,
}: ChatProps) {
  const [isSidebarVisible, setIsSidebarVisible] = React.useState(!defaultCollapsed)
  const [sidebarWidth, setSidebarWidth] = React.useState(() => {
    const saved = localStorage.getItem('chat-sidebar-width')
    return saved ? Number(saved) : 260
  })
  const [isResizing, setIsResizing] = React.useState(false)
  const [resizeHandleY, setResizeHandleY] = React.useState<number | null>(null)
  const resizeHandleRef = React.useRef<HTMLDivElement>(null)
  const [session, setSession] = useSession()
  const [viewMode, setViewMode] = React.useState<ViewMode>('inbox')
  const [selectedAgentId, setSelectedAgentId] = React.useState<string | null>(null)

  // Agent info dialog state
  const [infoDialogOpen, setInfoDialogOpen] = React.useState(false)
  const [infoDialogAgent, setInfoDialogAgent] = React.useState<SubAgentMetadata | null>(null)

  // Agent auth dialog state
  const [authDialogOpen, setAuthDialogOpen] = React.useState(false)
  const [authDialogAgent, setAuthDialogAgent] = React.useState<SubAgentMetadata | null>(null)

  // Agent status indicators - tracks setup/auth status for sidebar icons
  const [agentStatus, setAgentStatus] = React.useState<Map<string, SidebarAgentStatus>>(new Map())

  // Banner state for selected agent (setup needed vs auth needed)
  const [bannerState, setBannerState] = React.useState<{
    state: BannerState
    reason?: string
  }>({ state: 'hidden' })

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
    openChatTab,
    openSettingsTab,
    openShortcutsTab,
    openAgentInfoTab,
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
      // Tab navigation between zones
      { key: 'Tab', action: focusNextZone, when: () => !document.querySelector('[role="dialog"]') },
      { key: 'Tab', shift: true, action: focusPreviousZone, when: () => !document.querySelector('[role="dialog"]') },
      // Panel tab navigation
      { key: '[', cmd: true, action: previousTab },
      { key: ']', cmd: true, action: nextTab },
      { key: 'w', cmd: true, action: () => { if (activeTab?.closable) closeTab(activeTab.id) } },
      // Sidebar toggle
      { key: 'b', cmd: true, action: () => setIsSidebarVisible(v => !v) },
      // New chat (context-aware: uses selected agent if in agent view)
      { key: 'n', cmd: true, action: () => handleNewChat(true) },
      // Settings
      { key: ',', cmd: true, action: onOpenSettings },
    ],
  })

  // Sidebar resize handlers
  const handleResizeStart = React.useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    setIsResizing(true)
  }, [])

  // Track mouse position on resize handle for gradient effect
  const handleResizeHandleMouseMove = React.useCallback((e: React.MouseEvent) => {
    if (resizeHandleRef.current) {
      const rect = resizeHandleRef.current.getBoundingClientRect()
      setResizeHandleY(e.clientY - rect.top)
    }
  }, [])

  const handleResizeHandleMouseLeave = React.useCallback(() => {
    if (!isResizing) {
      setResizeHandleY(null)
    }
  }, [isResizing])

  React.useEffect(() => {
    if (!isResizing) return

    const handleMouseMove = (e: MouseEvent) => {
      const newWidth = Math.min(Math.max(e.clientX, 200), 400)
      setSidebarWidth(newWidth)
      // Update gradient position during drag
      if (resizeHandleRef.current) {
        const rect = resizeHandleRef.current.getBoundingClientRect()
        setResizeHandleY(e.clientY - rect.top)
      }
    }

    const handleMouseUp = () => {
      setIsResizing(false)
      setResizeHandleY(null)
      localStorage.setItem('chat-sidebar-width', String(sidebarWidth))
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)

    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [isResizing, sidebarWidth])

  // Spring transition config - shared between sidebar and header
  // Critical damping (no bounce): damping = 2 * sqrt(stiffness * mass)
  const springTransition = {
    type: "spring" as const,
    stiffness: 600,
    damping: 49,
  }

  // Count sessions by archive status
  const inboxCount = sessions.filter(s => !s.isArchived).length
  const archiveCount = sessions.filter(s => s.isArchived).length

  // Get conversation count per agent
  const getConversationCount = React.useCallback((agentId: string) => {
    return sessions.filter(s => s.agentId === agentId && !s.isArchived).length
  }, [sessions])

  // Filter sessions based on view mode and agent selection
  const filteredSessions = React.useMemo(() => {
    if (viewMode === 'inbox') {
      return sessions.filter(s => !s.isArchived)
    } else if (viewMode === 'archive') {
      return sessions.filter(s => s.isArchived)
    } else if (viewMode === 'agent' && selectedAgentId) {
      return sessions.filter(s => s.agentId === selectedAgentId && !s.isArchived)
    }
    return sessions
  }, [sessions, viewMode, selectedAgentId])

  const selectedSession = sessions.find(s => s.id === session.selected) || null

  // Ref for openChatTab to avoid circular dependency in sync effect
  // Without this, clicking a tab would trigger the effect because openChatTab
  // depends on state.activeTabId, causing it to fight with the user's click
  const openChatTabRef = React.useRef(openChatTab)
  openChatTabRef.current = openChatTab

  // Sync session selection with tab system
  // When a session is selected, open (or focus) its chat tab
  // Uses ref for openChatTab to prevent re-running when tabs switch
  React.useEffect(() => {
    if (session.selected && activeWorkspaceId) {
      const selectedSess = sessions.find(s => s.id === session.selected)
      if (selectedSess) {
        openChatTabRef.current(
          selectedSess.id,
          selectedSess.workspaceId,
          selectedSess.name || 'New Chat',
          selectedSess.agentId
        )
      }
    }
  }, [session.selected, sessions, activeWorkspaceId])

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

  // Create ChatContext value for tab panels
  const chatContextValue = React.useMemo<ChatContextType>(() => ({
    sessions,
    workspaces,
    agents,
    activeWorkspaceId,
    currentModel,
    pendingPermissions: pendingPermissions || new Map(),
    onSendMessage,
    onRenameSession,
    onArchiveSession,
    onDeleteSession,
    onRespondToPermission,
    onOpenFile,
    onOpenUrl,
    onModelChange,
    textareaRef: chatInputRef,
  }), [
    sessions,
    workspaces,
    agents,
    activeWorkspaceId,
    currentModel,
    pendingPermissions,
    onSendMessage,
    onRenameSession,
    onArchiveSession,
    onDeleteSession,
    onRespondToPermission,
    onOpenFile,
    onOpenUrl,
    onModelChange,
  ])

  // Group agents for tree view
  const agentTree = React.useMemo(() => groupAgentsByFolder(agents), [agents])

  // Persist expanded folders to localStorage
  React.useEffect(() => {
    localStorage.setItem('sidebar-expanded-folders', JSON.stringify([...expandedFolders]))
  }, [expandedFolders])

  // Fetch setup/auth status for all agents when agents list changes
  React.useEffect(() => {
    if (!activeWorkspaceId || agents.length === 0) {
      setAgentStatus(new Map())
      return
    }

    // Fetch status for each agent
    const fetchStatuses = async () => {
      const newStatus = new Map<string, SidebarAgentStatus>()

      await Promise.all(
        agents.map(async (agent) => {
          try {
            const result = await window.electronAPI.getAgentSetupStatus(activeWorkspaceId, agent.id)
            if (result.needsSetup) {
              newStatus.set(agent.id, 'needs_setup')
            } else if (result.needsAuth) {
              newStatus.set(agent.id, 'needs_auth')
            } else {
              newStatus.set(agent.id, 'ready')
            }
          } catch {
            newStatus.set(agent.id, 'error')
          }
        })
      )

      setAgentStatus(newStatus)
    }

    fetchStatuses()
  }, [activeWorkspaceId, agents])

  // Check agent setup/auth status when agent is selected
  React.useEffect(() => {
    if (viewMode !== 'agent' || !selectedAgentId || !activeWorkspaceId) {
      setBannerState({ state: 'hidden' })
      return
    }

    // Check setup/auth status
    window.electronAPI.getAgentSetupStatus(activeWorkspaceId, selectedAgentId)
      .then(result => {
        if (result.needsSetup) {
          setBannerState({ state: 'setup', reason: result.reason })
        } else if (result.needsAuth) {
          setBannerState({ state: 'auth', reason: result.reason })
        } else {
          setBannerState({ state: 'hidden' })
        }
      })
      .catch(() => {
        setBannerState({ state: 'hidden' })
      })
  }, [viewMode, selectedAgentId, activeWorkspaceId])

  // Handler functions (defined before the unified list so they can be referenced)
  const handleSelectAgent = useCallback(async (agentId: string, _agentName: string) => {
    if (!activeWorkspaceId) return

    // Always select the agent - banner will show if setup/auth needed
    // The useEffect above will check status and update bannerState
    setSelectedAgentId(agentId)
    setViewMode('agent')
  }, [activeWorkspaceId])

  // Handle banner action (open auth dialog)
  const handleBannerAction = useCallback(() => {
    if (!selectedAgentId) return

    const agent = agents.find(a => a.id === selectedAgentId)
    if (!agent) return

    // Open auth dialog for both setup and auth states
    // Auth dialog handles extraction + credential setup in one flow
    setAuthDialogAgent(agent)
    setAuthDialogOpen(true)
  }, [selectedAgentId, agents])

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

  // Handle auth dialog completion
  const handleAuthComplete = useCallback((success: boolean) => {
    setAuthDialogOpen(false)
    if (success && authDialogAgent) {
      // Auth successful - clear banner state
      setBannerState({ state: 'hidden' })
      // Update status to ready in sidebar
      setAgentStatus(prev => new Map(prev).set(authDialogAgent.id, 'ready'))
    }
    setAuthDialogAgent(null)
  }, [authDialogAgent])

  // Handle agent context menu actions
  const handleAgentAction = useCallback(async (action: AgentAction) => {
    if (!activeWorkspaceId) return

    switch (action.type) {
      case 'info':
        setInfoDialogAgent(action.agent)
        setInfoDialogOpen(true)
        break

      case 'reload':
        console.log('[Chat] Reloading agent:', action.agent.name)
        // Set loading state
        setAgentStatus(prev => new Map(prev).set(action.agent.id, 'loading'))
        try {
          const reloadSuccess = await window.electronAPI.reloadAgent(activeWorkspaceId, action.agent.id)
          if (reloadSuccess) {
            console.log('[Chat] Agent reloaded successfully:', action.agent.name)
            // Re-check setup status after reload
            const result = await window.electronAPI.getAgentSetupStatus(activeWorkspaceId, action.agent.id)
            if (result.needsSetup) {
              setAgentStatus(prev => new Map(prev).set(action.agent.id, 'needs_setup'))
            } else if (result.needsAuth) {
              setAgentStatus(prev => new Map(prev).set(action.agent.id, 'needs_auth'))
            } else {
              setAgentStatus(prev => new Map(prev).set(action.agent.id, 'ready'))
            }
          } else {
            console.error('[Chat] Failed to reload agent:', action.agent.name)
            setAgentStatus(prev => new Map(prev).set(action.agent.id, 'error'))
          }
        } catch (err) {
          console.error('[Chat] Error reloading agent:', err)
          setAgentStatus(prev => new Map(prev).set(action.agent.id, 'error'))
        }
        break

      case 'reauthenticate':
        console.log('[Chat] Reauthenticating agent:', action.agent.name)
        await window.electronAPI.resetAgent(activeWorkspaceId, action.agent.id)
        // Mark as needing setup since we reset
        setAgentStatus(prev => new Map(prev).set(action.agent.id, 'needs_setup'))
        // Open auth dialog
        setAuthDialogAgent(action.agent)
        setAuthDialogOpen(true)
        break

      case 'reset':
        console.log('[Chat] Resetting agent:', action.agent.name)
        const resetSuccess = await window.electronAPI.resetAgent(activeWorkspaceId, action.agent.id)
        if (resetSuccess) {
          console.log('[Chat] Agent reset successfully:', action.agent.name)
          // Mark as needing setup since credentials were cleared
          setAgentStatus(prev => new Map(prev).set(action.agent.id, 'needs_setup'))
        } else {
          console.error('[Chat] Failed to reset agent:', action.agent.name)
          setAgentStatus(prev => new Map(prev).set(action.agent.id, 'error'))
        }
        break
    }
  }, [activeWorkspaceId])

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

    // 1. Nav items (Inbox, Archive)
    result.push({ id: 'nav:inbox', type: 'nav', action: handleInboxClick })
    result.push({ id: 'nav:archive', type: 'nav', action: handleArchiveClick })

    // 2. Tree items (agents and folders)
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
  }, [agentTree, expandedFolders, handleInboxClick, handleArchiveClick])

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
  const listTitle = viewMode === 'archive' ? 'Archive' :
                    viewMode === 'agent' && selectedAgentId ?
                      (agents.find(a => a.id === selectedAgentId)?.displayName || agents.find(a => a.id === selectedAgentId)?.name || 'Inbox') :
                      'Inbox'

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
                {/* Primary Nav: Inbox, Archive */}
                <LeftSidebar
                  isCollapsed={false}
                  getItemProps={getSidebarItemProps}
                  focusedItemId={focusedSidebarItemId}
                  links={[
                    {
                      id: "nav:inbox",
                      title: "Inbox",
                      label: String(inboxCount),
                      icon: Inbox,
                      variant: viewMode === 'inbox' ? "default" : "ghost",
                      onClick: handleInboxClick,
                    },
                    {
                      id: "nav:archive",
                      title: "Archive",
                      label: String(archiveCount),
                      icon: Archive,
                      variant: viewMode === 'archive' ? "default" : "ghost",
                      onClick: handleArchiveClick,
                    },
                  ]}
                />
                <Separator className="bg-foreground/10" />
                {/* Agent Tree: Hierarchical list of agents */}
                <div className="group/agents flex-1 min-h-0 flex flex-col overflow-hidden pt-0.5">
                  {/* Agents Section Header with menu */}
                  <div className="flex items-center justify-between pl-4 pr-2 py-2 shrink-0">
                    <span className="text-xs font-medium text-muted-foreground select-none">Agents</span>
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
                    <div className="px-2 pb-2">
                      {isLoadingAgents ? (
                        <div className="flex items-center gap-2 px-2 py-4">
                          <Spinner className="text-sm text-muted-foreground" />
                          <span className="text-xs text-muted-foreground">Loading agents...</span>
                        </div>
                      ) : agents.length === 0 ? (
                        <p className="text-xs text-muted-foreground px-2 py-4">
                          No agents found. Create an "Agents" folder in your Craft space.
                        </p>
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
                        />
                      )}
                    </div>
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
          onMouseDown={handleResizeStart}
          onMouseMove={handleResizeHandleMouseMove}
          onMouseLeave={handleResizeHandleMouseLeave}
          className="absolute top-0 w-3 h-full cursor-col-resize z-50 flex justify-center"
          style={{
            left: isSidebarVisible ? sidebarWidth - 6 : -6,
            transition: isResizing ? undefined : 'left 0.15s ease-out',
          }}
        >
          {/* Visual indicator - 2px wide */}
          <div
            className="w-0.5 h-full"
            style={getResizeGradientStyle(resizeHandleY)}
          />
        </div>

        {/* === MAIN CONTENT (Right) ===
            Nested resizable layout: Session List | Chat Display */}
        <div className="flex-1 overflow-hidden min-w-0">
          {/* Inner Layout: Session List (40%) | Chat Display (60%) */}
          <ResizablePanelGroup
            direction="horizontal"
            onLayout={(sizes: number[]) => {
              localStorage.setItem('chat-layout-inner', JSON.stringify(sizes))
            }}
            className="h-full"
          >
            {/* === SESSION LIST PANEL === */}
            <ResizablePanel defaultSize={40} minSize={25} className="overflow-hidden min-w-0">
              <div className="h-full flex flex-col min-w-0 bg-background">
                {/* Header: Dynamic title (Conversations/Archive/Agent name) + New Chat button
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
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => handleNewChat(true)}
                    disabled={viewMode === 'agent' && bannerState.state === 'setup'}
                    className={cn(
                      "h-7 w-7 shrink-0 rounded-[4px] hover:bg-foreground/5 titlebar-no-drag",
                      viewMode === 'agent' && bannerState.state === 'setup' && "opacity-50 cursor-not-allowed"
                    )}
                    title="New Chat"
                  >
                    <SquarePenRounded className="!h-5 !w-5" />
                  </Button>
                </motion.div>
                <Separator />
                {/* Setup/Auth Banner - shows when agent needs setup or authentication */}
                <SetupAuthBanner
                  state={viewMode === 'agent' ? bannerState.state : 'hidden'}
                  agentName={selectedAgentId ? agents.find(a => a.id === selectedAgentId)?.displayName || agents.find(a => a.id === selectedAgentId)?.name : undefined}
                  reason={bannerState.reason}
                  onAction={handleBannerAction}
                />
                {/* SessionList: Scrollable list of session cards */}
                <SessionList
                  items={filteredSessions}
                  onDelete={onDeleteSession}
                  onArchive={viewMode !== 'archive' ? onArchiveSession : undefined}
                  onUnarchive={viewMode === 'archive' ? onUnarchiveSession : undefined}
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
                />
              </div>
            </ResizablePanel>

            <GradientResizeHandle />

            {/* === TAB CONTAINER PANEL === */}
            <ResizablePanel defaultSize={60} minSize={35} className="overflow-hidden min-w-0 bg-background">
              <TabContainer />
            </ResizablePanel>
          </ResizablePanelGroup>
        </div>
      </div>

        {/* Agent Info Dialog */}
        {activeWorkspaceId && (
          <AgentInfoDialog
            agent={infoDialogAgent}
            open={infoDialogOpen}
            onOpenChange={setInfoDialogOpen}
            workspaceId={activeWorkspaceId}
          />
        )}

        {/* Agent Auth Dialog */}
        {activeWorkspaceId && authDialogAgent && (
          <AgentAuthDialog
            agent={authDialogAgent}
            workspaceId={activeWorkspaceId}
            open={authDialogOpen}
            onOpenChange={setAuthDialogOpen}
            onComplete={handleAuthComplete}
          />
        )}
      </TooltipProvider>
    </ChatProvider>
  )
}
