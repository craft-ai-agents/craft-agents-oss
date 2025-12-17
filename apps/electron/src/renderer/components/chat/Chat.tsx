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
} from "lucide-react"
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
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Collapsible,
  CollapsibleTrigger,
  AnimatedCollapsibleContent,
  springTransition as collapsibleSpring,
} from "@/components/ui/collapsible"
import { WorkspaceSwitcher } from "./WorkspaceSwitcher"
import { ChatDisplay } from "./ChatDisplay"
import { SessionList } from "./SessionList"
import { LeftSidebar } from "./LeftSidebar"
import { useSession } from "@/hooks/useSession"
import { getResizeGradientStyle } from "@/hooks/useResizeGradient"
import { useFocusZone, useGlobalShortcuts } from "@/hooks/keyboard"
import { useFocusContext } from "@/context/FocusContext"
import type { Session, Workspace, SubAgentMetadata, FileAttachment } from "../../../shared/types"

type ViewMode = 'inbox' | 'archive' | 'agent'

interface ChatProps {
  workspaces: Workspace[]
  sessions: Session[]
  agents: SubAgentMetadata[]
  activeWorkspaceId: string | null
  defaultLayout?: number[]
  defaultCollapsed?: boolean
  // Model selection
  currentModel: string
  onModelChange: (model: string) => void
  // Callbacks
  onSelectWorkspace: (id: string) => void
  onCreateSession: (workspaceId: string, agentId?: string) => void
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
  isFocused = false,
  expandedFolders,
  onToggleFolder,
  focusedItemId,
  onFocusItem,
  getItemProps,
}: AgentTreeProps) {
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
    return (
      <li key={agent.id} className="min-w-0">
        <button
          {...itemProps}
          onClick={() => onSelectAgent(agent.id, agent.name)}
          className={cn(
            "flex w-full items-center gap-2 overflow-hidden rounded-md py-[6px] px-2 text-sm select-none outline-none",
            "focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
            isSelected(agent.id)
              ? "bg-primary text-primary-foreground dark:bg-muted dark:text-foreground"
              : "hover:bg-foreground/5",
            isFocusedItem && !isSelected(agent.id) && "bg-foreground/5"
          )}
          role="treeitem"
          aria-selected={isSelected(agent.id)}
        >
          <FadingText>
            {agent.displayName || agent.name.split('/').pop()}
          </FadingText>
          <span className={cn(
            "ml-auto shrink-0 text-xs opacity-0 group-hover/agents:opacity-100 transition-opacity",
            isSelected(agent.id) ? "text-primary-foreground/50 dark:text-foreground/50" : "text-muted-foreground/50"
          )}>
            {getConversationCount(agent.id)}
          </span>
        </button>
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
      isFocused={isFocused}
      expandedFolders={expandedFolders}
      onToggleFolder={onToggleFolder}
      focusedItemId={focusedItemId}
      onFocusItem={onFocusItem}
      getItemProps={getItemProps}
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
            "group flex w-full items-center gap-2 overflow-hidden rounded-md py-1.5 px-2 text-sm select-none outline-none",
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
  activeWorkspaceId,
  defaultLayout = [20, 32, 48],
  defaultCollapsed = false,
  currentModel,
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

  // Unified sidebar keyboard navigation state
  const [expandedFolders, setExpandedFolders] = React.useState<Set<string>>(() => new Set())
  const [focusedSidebarItemId, setFocusedSidebarItemId] = React.useState<string | null>(null)
  const sidebarItemRefs = React.useRef<Map<string, HTMLElement>>(new Map())

  const activeWorkspace = workspaces.find(w => w.id === activeWorkspaceId)

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
      // Sidebar toggle
      { key: 'b', cmd: true, action: () => setIsSidebarVisible(v => !v) },
      // New chat (context-aware: uses selected agent if in agent view)
      {
        key: 'n',
        cmd: true,
        action: () => {
          if (activeWorkspace) {
            onCreateSession(activeWorkspace.id, viewMode === 'agent' ? selectedAgentId || undefined : undefined)
          }
        },
      },
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

  // Group agents for tree view
  const agentTree = React.useMemo(() => groupAgentsByFolder(agents), [agents])

  // Initialize expanded folders when agents change (expand all by default)
  React.useEffect(() => {
    const allFolderPaths = new Set<string>()
    const collectPaths = (folder: AgentFolder) => {
      if (folder.path.length > 0) {
        allFolderPaths.add(folder.path.join('/'))
      }
      folder.subfolders.forEach(collectPaths)
    }
    collectPaths(agentTree)
    setExpandedFolders(allFolderPaths)
  }, [agentTree])

  // Handler functions (defined before the unified list so they can be referenced)
  const handleSelectAgent = useCallback((agentId: string, _agentName: string) => {
    setSelectedAgentId(agentId)
    setViewMode('agent')
  }, [])

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
                  onNewChat={() => activeWorkspace && onCreateSession(activeWorkspace.id, selectedAgentId || undefined)}
                  onOpenSettings={onOpenSettings}
                  onOpenKeyboardShortcuts={onOpenKeyboardShortcuts}
                  onOpenHelp={() => window.electronAPI.openUrl('https://agents.craft.do/doc')}
                  onOpenCraft={() => window.electronAPI.openUrl('craftdocs://')}
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
                    <ContextMenu>
                      <ContextMenuTrigger asChild>
                        <button
                          className="p-1 rounded hover:bg-foreground/5 text-muted-foreground hover:text-foreground"
                          onClick={(e) => {
                            e.preventDefault()
                            const rect = e.currentTarget.getBoundingClientRect()
                            const event = new MouseEvent('contextmenu', {
                              bubbles: true,
                              cancelable: true,
                              clientX: rect.right,
                              clientY: rect.bottom,
                            })
                            e.currentTarget.dispatchEvent(event)
                          }}
                        >
                          <MoreHorizontal className="h-3.5 w-3.5" />
                        </button>
                      </ContextMenuTrigger>
                      <ContextMenuContent className="min-w-0">
                        <ContextMenuItem onClick={onRefreshAgents}>
                          <RotateCw />
                          Refresh
                        </ContextMenuItem>
                      </ContextMenuContent>
                    </ContextMenu>
                  </div>
                  {/* Scrollable Agent Tree */}
                  <ScrollArea className="flex-1 min-h-0">
                    <div className="px-2 pb-2">
                      {agents.length === 0 ? (
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
                          isFocused={sidebarFocused}
                          expandedFolders={expandedFolders}
                          onToggleFolder={handleToggleFolder}
                          focusedItemId={focusedSidebarItemId}
                          onFocusItem={setFocusedSidebarItemId}
                          getItemProps={getSidebarItemProps}
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
                    onClick={() => activeWorkspace && onCreateSession(activeWorkspace.id, selectedAgentId || undefined)}
                    className="h-7 w-7 shrink-0 rounded-[4px] hover:bg-foreground/5 titlebar-no-drag"
                    title="New Chat"
                  >
                    <SquarePenRounded className="!h-5 !w-5" />
                  </Button>
                </motion.div>
                <Separator />
                {/* SessionList: Scrollable list of session cards */}
                <SessionList
                  items={filteredSessions}
                  onDelete={onDeleteSession}
                  onArchive={viewMode !== 'archive' ? onArchiveSession : undefined}
                  onUnarchive={viewMode === 'archive' ? onUnarchiveSession : undefined}
                  onRename={onRenameSession}
                  onFocusChatInput={focusChatInput}
                />
              </div>
            </ResizablePanel>

            <GradientResizeHandle />

            {/* === CHAT DISPLAY PANEL === */}
            <ResizablePanel defaultSize={60} minSize={35} className="overflow-hidden min-w-0 bg-background">
              <ChatDisplay
                session={selectedSession}
                onSendMessage={(message, attachments) => selectedSession && onSendMessage(selectedSession.id, message, attachments)}
                onOpenFile={onOpenFile}
                onOpenUrl={onOpenUrl}
                currentModel={currentModel}
                onModelChange={onModelChange}
                onRename={(name) => selectedSession && onRenameSession(selectedSession.id, name)}
                onArchive={selectedSession && !selectedSession.isArchived ? () => onArchiveSession(selectedSession.id) : undefined}
                onDelete={selectedSession ? () => onDeleteSession(selectedSession.id) : undefined}
                textareaRef={chatInputRef}
              />
            </ResizablePanel>
          </ResizablePanelGroup>
        </div>
      </div>
    </TooltipProvider>
  )
}
