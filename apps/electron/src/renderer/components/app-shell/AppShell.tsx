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
  CircleAlert,
  CloudOff,
  CloudCheck,
  PowerOff,
  Globe,
  Flag,
  ListFilter,
  Check,
  Search,
  Plus,
  Trash2,
  Terminal,
} from "lucide-react"
import { McpIcon } from "../icons/McpIcon"
import {
  CircleDashed,
  CircleProgress,
  CircleEye,
  CircleCheckFilled,
  CircleXFilled,
} from "../icons/TodoStateIcons"
import { Spinner } from "@craft-agent/ui"
import { AvatarGroup } from "@/components/ui/avatar-group"
import { SourceAvatar } from "@/components/ui/source-avatar"
import { AppMenu } from "../AppMenu"
import { SquarePenRounded } from "../icons/SquarePenRounded"
import { cn, isHexColor } from "@/lib/utils"
import { Button } from "@/components/ui/button"
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
import { AgentContextMenu, type AgentAction } from "./AgentContextMenu"
import { SetupAuthBanner, type BannerState } from "./SetupAuthBanner"
import { useSession } from "@/hooks/useSession"
import { useAgentState } from "@/hooks/useAgentState"
import { ensureSessionMessagesLoadedAtom } from "@/atoms/sessions"
import { AppShellProvider, type AppShellContextType } from "@/context/AppShellContext"
import { useTheme } from "@/context/ThemeContext"
import { getResizeGradientStyle } from "@/hooks/useResizeGradient"
import { useFocusZone, useGlobalShortcuts } from "@/hooks/keyboard"
import { useFocusContext } from "@/context/FocusContext"
import { getSessionTitle } from "@/utils/session"
import { useSetAtom } from "jotai"
import type { Session, Workspace, SubAgentMetadata, FileAttachment, PermissionRequest, TodoState, LoadedSource, PermissionMode } from "../../../shared/types"
import { sessionMetaMapAtom, type SessionMeta } from "@/atoms/sessions"
import { sourcesAtom } from "@/atoms/sources"
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
  type NavigationState,
  type ChatFilter,
  type SourceCategory,
} from "@/contexts/NavigationContext"
import type { SettingsSubpage } from "../../../shared/types"
import { SourcesListPanel } from "./SourcesListPanel"
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
  mcpLogos: Array<{ name: string; logo?: string; type: 'mcp' }>
  apiLogos: Array<{ name: string; logo?: string; type: 'api' }>
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
  /** Double-click handler for starting setup conversation */
  onAgentDoubleClick?: (agent: SubAgentMetadata) => void
  /** Agent-scoped sources, keyed by agent slug */
  agentSources?: Map<string, LoadedSource[]>
  /** Expanded agent sources (set of agent slugs that have sources expanded) */
  expandedAgentSources?: Set<string>
  /** Toggle agent sources expansion */
  onToggleAgentSources?: (agentSlug: string) => void
  /** Promote agent source to workspace */
  onPromoteSource?: (agentSlug: string, sourceSlug: string) => void
  /** Open source info tab */
  onOpenSourceInfo?: (source: LoadedSource, agentSlug: string) => void
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
  onAgentDoubleClick,
  agentSources,
  expandedAgentSources,
  onToggleAgentSources,
  onPromoteSource,
  onOpenSourceInfo,
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
        onDoubleClick={() => onAgentDoubleClick?.(agent)}
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
                    <SourceAvatar
                      key={i}
                      type={service.type}
                      name={service.name}
                      logoUrl={service.logo}
                      size="sm"
                      className="rounded-[4px]"
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

    // Get agent sources for this agent (agent.id is the slug for folder-based agents)
    const sources = agentSources?.get(agent.id) || []
    const hasAgentSources = sources.length > 0
    const isSourcesExpanded = expandedAgentSources?.has(agent.id) || false

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
        {/* Agent-scoped sources */}
        {hasAgentSources && (
          <div className="ml-2">
            <button
              className="flex items-center gap-1.5 w-full pl-4 pr-2 py-1 text-[11px] text-muted-foreground hover:text-foreground hover:bg-foreground/5 rounded-md transition-colors"
              onClick={(e) => {
                e.stopPropagation()
                onToggleAgentSources?.(agent.id)
              }}
            >
              <ChevronRight className={cn(
                "h-3 w-3 transition-transform",
                isSourcesExpanded && "rotate-90"
              )} />
              <span>{sources.length} source{sources.length !== 1 ? 's' : ''}</span>
            </button>
            <AnimatedCollapsibleContent isOpen={isSourcesExpanded}>
              <div className="ml-6 pl-3 border-l border-foreground/10 space-y-0.5 py-0.5">
                {sources.map((source) => (
                  <button
                    key={source.config.slug}
                    onClick={(e) => {
                      e.stopPropagation()
                      onOpenSourceInfo?.(source, agent.id)
                    }}
                    className="group/source flex items-center gap-2 px-2 py-1 rounded-md hover:bg-foreground/5 w-full text-left"
                  >
                    <SourceAvatar source={source} size="xs" />
                    <span className="text-[12px] text-foreground/80 truncate flex-1">
                      {source.config.name}
                    </span>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span
                          onClick={(e) => {
                            e.stopPropagation()
                            onPromoteSource?.(agent.id, source.config.slug)
                          }}
                          className="p-0.5 rounded hover:bg-foreground/10 text-muted-foreground hover:text-foreground opacity-0 group-hover/source:opacity-100 transition-opacity"
                          role="button"
                          tabIndex={0}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.stopPropagation()
                              onPromoteSource?.(agent.id, source.config.slug)
                            }
                          }}
                        >
                          <Plus className="h-3 w-3" />
                        </span>
                      </TooltipTrigger>
                      <TooltipContent side="right" sideOffset={4}>
                        Add to sources
                      </TooltipContent>
                    </Tooltip>
                  </button>
                ))}
              </div>
            </AnimatedCollapsibleContent>
          </div>
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
      onAgentDoubleClick={onAgentDoubleClick}
      agentSources={agentSources}
      expandedAgentSources={expandedAgentSources}
      onToggleAgentSources={onToggleAgentSources}
      onPromoteSource={onPromoteSource}
      onOpenSourceInfo={onOpenSourceInfo}
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
 * AppShell - Main 3-panel layout container
 *
 * Layout: [LeftSidebar 20%] | [NavigatorPanel 32%] | [MainContentPanel 48%]
 *
 * View Modes:
 * - 'inbox': Shows non-archived sessions
 * - 'archive': Shows archived sessions
 * - 'agent': Shows sessions for a specific agent
 * - 'sources': Shows workspace sources
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
    agents,
    isLoadingAgents = false,
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
    onRefreshAgents,
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

  // Derive selected agent ID from navigation state
  const selectedAgentId = chatFilter?.kind === 'agent' ? chatFilter.agentId : null

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

  // Agent status indicators - tracks setup/auth status for sidebar icons
  const [agentStatus, setAgentStatus] = React.useState<Map<string, SidebarAgentStatus>>(new Map())
  // Agent service logos - extracted from definition when agent is ready/active
  const [agentLogos, setAgentLogos] = React.useState<Map<string, SidebarServiceLogos>>(new Map())

  // Agent state for selected agent via AgentStateManager (single source of truth)
  // This ensures the banner in the session list shows the same state as ChatTabPanel
  const selectedAgentState = useAgentState(
    activeWorkspaceId,
    chatFilter?.kind === 'agent' ? selectedAgentId : null
  )

  // Banner state from centralized hook (single source of truth)
  const bannerState = React.useMemo((): { state: BannerState; reason?: string } => {
    if (chatFilter?.kind !== 'agent' || !selectedAgentId) {
      return { state: 'hidden' }
    }
    return {
      state: selectedAgentState.bannerState,
      reason: selectedAgentState.bannerReason ?? undefined
    }
  }, [chatFilter, selectedAgentId, selectedAgentState.bannerState, selectedAgentState.bannerReason])

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

  // Agent-scoped sources, keyed by agent slug
  const [agentSources, setAgentSources] = React.useState<Map<string, LoadedSource[]>>(new Map())
  // Track which agents have their sources expanded
  const [expandedAgentSources, setExpandedAgentSources] = React.useState<Set<string>>(new Set())

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

  // Load agent-scoped sources for all agents
  React.useEffect(() => {
    if (!activeWorkspaceId || agents.length === 0) return

    const loadAgentSources = async () => {
      const newAgentSources = new Map<string, LoadedSource[]>()

      for (const agent of agents) {
        try {
          // agent.id is the slug for folder-based agents
          const agentSourceList = await window.electronAPI.getAgentSources(activeWorkspaceId, agent.id)
          if (agentSourceList && agentSourceList.length > 0) {
            newAgentSources.set(agent.id, agentSourceList)
          }
        } catch (err) {
          console.error(`[Chat] Failed to load sources for agent ${agent.id}:`, err)
        }
      }

      setAgentSources(newAgentSources)
    }

    loadAgentSources()
  }, [activeWorkspaceId, agents])

  // Subscribe to live source updates (when sources are added/removed via agent)
  React.useEffect(() => {
    const cleanup = window.electronAPI.onSourcesChanged(async (updatedSources) => {
      console.log('[Chat] Sources changed, updating sidebar:', updatedSources.length)
      setSources(updatedSources || [])

      // Also reload agent-scoped sources when workspace sources change
      // (agent sources may have been created or promoted)
      if (activeWorkspaceId && agents.length > 0) {
        const newAgentSources = new Map<string, LoadedSource[]>()
        for (const agent of agents) {
          try {
            const agentSourceList = await window.electronAPI.getAgentSources(activeWorkspaceId, agent.id)
            if (agentSourceList && agentSourceList.length > 0) {
              newAgentSources.set(agent.id, agentSourceList)
            }
          } catch (err) {
            // Ignore errors for individual agents
          }
        }
        setAgentSources(newAgentSources)
      }
    })
    return cleanup
  }, [activeWorkspaceId, agents])

  // Toggle agent sources expansion
  const handleToggleAgentSources = React.useCallback((agentSlug: string) => {
    setExpandedAgentSources(prev => {
      const next = new Set(prev)
      if (next.has(agentSlug)) {
        next.delete(agentSlug)
      } else {
        next.add(agentSlug)
      }
      return next
    })
  }, [])

  // Promote agent source to workspace
  const handlePromoteSource = React.useCallback(async (agentSlug: string, sourceSlug: string) => {
    if (!activeWorkspaceId) return
    try {
      await window.electronAPI.promoteSource(activeWorkspaceId, agentSlug, sourceSlug)
      // Reload both workspace and agent sources
      const [updatedWorkspaceSources, updatedAgentSources] = await Promise.all([
        window.electronAPI.getSources(activeWorkspaceId),
        window.electronAPI.getAgentSources(activeWorkspaceId, agentSlug),
      ])
      setSources(updatedWorkspaceSources || [])
      setAgentSources(prev => {
        const next = new Map(prev)
        next.set(agentSlug, updatedAgentSources || [])
        return next
      })
      console.log(`[Chat] Promoted source ${sourceSlug} from agent ${agentSlug} to workspace`)
    } catch (err) {
      console.error(`[Chat] Failed to promote source:`, err)
    }
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

  // Handle opening source info (agent-scoped)
  // TODO: Implement source info view without tabs
  const handleOpenSourceInfo = React.useCallback((source: LoadedSource, agentSlug: string) => {
    if (!activeWorkspaceId) return
    console.log('[AppShell] Open source info:', source.config.slug, 'agent:', agentSlug)
    // Source info could be shown in a modal or side panel in the future
  }, [activeWorkspaceId])

  // Handle opening source info (workspace-scoped)
  const handleOpenWorkspaceSourceInfo = React.useCallback((source: LoadedSource) => {
    if (!activeWorkspaceId) return
    // Navigate to source - the navigation state will update and highlight the source in the list
    navigate(routes.view.sources({ sourceSlug: source.config.slug }))
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
      // New chat (context-aware: uses selected agent if in agent view)
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
  // Inbox = not done/cancelled, Done = todoState === 'done' or 'cancelled'
  const isMetaDone = (s: SessionMeta) => s.todoState === 'done' || s.todoState === 'cancelled'
  const inboxCount = workspaceSessionMetas.filter(s => !isMetaDone(s)).length
  const archiveCount = workspaceSessionMetas.filter(s => isMetaDone(s)).length
  // Flagged can be both done and not done
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

  // Get conversation count per agent (scoped to workspace)
  const getConversationCount = useCallback((agentId: string) => {
    return workspaceSessionMetas.filter(s => s.agentId === agentId && !isMetaDone(s)).length
  }, [workspaceSessionMetas])

  // Filter session metadata based on sidebar mode and chat filter
  const filteredSessionMetas = useMemo(() => {
    // When in sources mode, return empty (no sessions to show)
    if (!chatFilter) {
      return []
    }

    let result: SessionMeta[]

    switch (chatFilter.kind) {
      case 'inbox':
        // "All Chats" - shows all sessions (no filtering by done status)
        result = workspaceSessionMetas
        break
      case 'archive':
        result = workspaceSessionMetas.filter(s => isMetaDone(s))
        break
      case 'flagged':
        // Flagged view shows both done and not done flagged items
        result = workspaceSessionMetas.filter(s => s.isFlagged)
        break
      case 'agent':
        result = workspaceSessionMetas.filter(s => s.agentId === chatFilter.agentId && !isMetaDone(s))
        break
      case 'state':
        // Filter by specific todo state
        result = workspaceSessionMetas.filter(s => (s.todoState || 'todo') === chatFilter.stateId)
        break
      default:
        result = workspaceSessionMetas
    }

    // Apply secondary filter by todo states if any are selected (only in inbox view)
    if (chatFilter.kind === 'inbox' && listFilter.size > 0) {
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

  // Filter out hidden agents (those starting with '.') and group for tree view
  // For folder agents, documentId contains the slug
  const visibleAgents = React.useMemo(() => agents.filter(a => !a.documentId?.startsWith('.')), [agents])
  const agentTree = React.useMemo(() => groupAgentsByFolder(visibleAgents), [visibleAgents])

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
    const mcpLogos = def.mcpServers?.map(s => ({ name: s.name, logo: s.logo, type: 'mcp' as const })) ?? []
    const apiLogos = def.apis?.map(a => ({ name: a.name, logo: a.logo, type: 'api' as const })) ?? []

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

  // Handler functions - use navigate() to trigger auto-selection via NavigationContext
  // DO NOT call setSidebarMode() directly - it bypasses auto-selection logic
  const handleSelectAgent = useCallback(async (agentId: string, _agentName: string) => {
    if (!activeWorkspaceId) return
    navigate(routes.view.agent(agentId))
  }, [activeWorkspaceId])

  // Handle banner action - no-op since agent setup flow was removed
  const handleBannerAction = useCallback(() => {
    // Agent setup wizard has been removed
    // Banner will still show auth status, but no action available
  }, [])

  const handleInboxClick = useCallback(() => {
    navigate(routes.view.inbox())
  }, [])

  const handleArchiveClick = useCallback(() => {
    navigate(routes.view.archive())
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

  // Handler for settings view
  const handleSettingsClick = useCallback((subpage: SettingsSubpage = 'general') => {
    navigate(routes.view.settings(subpage))
  }, [])

  // Create a new chat and select it
  // Uses selectedAgentId when in agent view, otherwise creates a session without agent
  const handleNewChat = useCallback(async (useCurrentAgent: boolean = true) => {
    if (!activeWorkspace) return

    const agentId = useCurrentAgent && chatFilter?.kind === 'agent' ? selectedAgentId || undefined : undefined
    const newSession = await onCreateSession(activeWorkspace.id, agentId)
    // Navigate to the new session via central routing
    navigate(routes.tab.chat(newSession.id))
  }, [activeWorkspace, chatFilter, selectedAgentId, onCreateSession])

  // Add Source - opens a chat with the .settings builtin agent
  const handleAddSource = useCallback(async () => {
    if (!activeWorkspace || !openNewChat) return

    try {
      // Ensure the builtin agent exists
      const agentId = await window.electronAPI.ensureBuiltinAgent(activeWorkspace.id, '.settings')
      if (!agentId) {
        toast.error('Failed to create settings agent')
        return
      }

      // Use openNewChat which handles session creation, tab opening, and input pre-filling
      await openNewChat({
        agentId,
        name: 'Add Source',
        input: 'I would like to add a new source: ',
      })
    } catch (error) {
      console.error('[Chat] Failed to add source:', error)
      toast.error('Failed to start source setup')
    }
  }, [activeWorkspace, openNewChat])

  const handleDeleteSource = useCallback(async (sourceName: string) => {
    if (!activeWorkspace) return

    try {
      // Ensure the builtin agent exists
      const agentId = await window.electronAPI.ensureBuiltinAgent(activeWorkspace.id, '.settings')
      if (!agentId) {
        toast.error('Failed to create settings agent')
        return
      }

      // Create a new session with this agent and set the name
      const sessionName = `Delete ${sourceName} from sources`
      const newSession = await onCreateSession(activeWorkspace.id, agentId)
      await window.electronAPI.sessionCommand(newSession.id, { type: 'rename', name: sessionName })
      // Navigate to the new session via central routing
      navigate(routes.tab.chat(newSession.id))

      // Send the delete prompt after a short delay to ensure the chat is mounted
      // Use onSendMessage to properly add the user message to the UI
      setTimeout(() => {
        onSendMessage(newSession.id, `Delete ${sourceName} source.`, [])
      }, 100)
    } catch (error) {
      console.error('[Chat] Failed to delete source:', error)
      toast.error('Failed to start source deletion')
    }
  }, [activeWorkspace, onCreateSession, onSendMessage])

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
        // Create a new conversation with this agent and navigate to it
        const newSession = await onCreateSession(activeWorkspaceId, action.agent.id)
        // Navigate to agent view with the new chat selected
        navigate(routes.view.agent(action.agent.id, newSession.id))
        break

      case 'info':
        // Navigate to agent info view
        navigate(routes.tab.agentInfo(action.agent.id))
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
  }, [activeWorkspaceId, onCreateSession])

  // Handle double-click on agent: create new conversation with setup message
  const handleAgentDoubleClick = useCallback(async (agent: SubAgentMetadata) => {
    if (!activeWorkspaceId) return

    // Create a new conversation with this agent and navigate to it
    const newSession = await onCreateSession(activeWorkspaceId, agent.id)
    // Navigate to agent view with the new chat selected
    navigate(routes.view.agent(agent.id, newSession.id))

    // Send setup message
    await onSendMessage(newSession.id, 'Please set up this agent', [])
  }, [activeWorkspaceId, onCreateSession, onSendMessage])

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

    // 2.5. Sources nav items (parent and categories)
    result.push({ id: 'nav:sources', type: 'nav', action: handleSourcesClick })
    result.push({ id: 'nav:sources:local-files', type: 'nav', action: () => handleSourceCategoryClick('local-files') })
    result.push({ id: 'nav:sources:online-sources', type: 'nav', action: () => handleSourceCategoryClick('online-sources') })
    result.push({ id: 'nav:sources:local-mcp', type: 'nav', action: () => handleSourceCategoryClick('local-mcp') })

    // 2.6. Settings nav item
    result.push({ id: 'nav:settings', type: 'nav', action: () => handleSettingsClick('general') })

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
  }, [agentTree, expandedFolders, handleInboxClick, handleFlaggedClick, handleTodoStateClick, handleSourcesClick, handleSourceCategoryClick, handleSettingsClick])

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

  // Get title based on navigation state
  const listTitle = React.useMemo(() => {
    // Sources navigator - with category-specific titles
    if (isSourcesNavigation(navState)) {
      if (navState.category === 'local-files') return 'Local Files'
      if (navState.category === 'online-sources') return 'Online Sources'
      if (navState.category === 'local-mcp') return 'Local MCP'
      return 'Sources'
    }

    // Settings navigator
    if (isSettingsNavigation(navState)) return 'Settings'

    // Chats navigator - use chatFilter
    if (!chatFilter) return 'All Chats'

    switch (chatFilter.kind) {
      case 'archive':
        return 'Archive'
      case 'flagged':
        return 'Flagged'
      case 'agent':
        return agents.find(a => a.id === chatFilter.agentId)?.displayName ||
               agents.find(a => a.id === chatFilter.agentId)?.name ||
               'All Chats'
      case 'state':
        const state = todoStates.find(s => s.id === chatFilter.stateId)
        return state?.label || 'All Chats'
      default:
        return 'All Chats'
    }
  }, [navState, chatFilter, agents, todoStates])

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
                <div className="px-2 pt-2 pb-1">
                  <Button
                    variant="ghost"
                    onClick={() => handleNewChat(true)}
                    disabled={chatFilter?.kind === 'agent' && bannerState.state !== 'hidden'}
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
                      id: "nav:inbox",
                      title: "All Chats",
                      label: String(workspaceSessionMetas.length),
                      icon: Inbox,
                      variant: chatFilter?.kind === 'inbox' ? "default" : "ghost",
                      onClick: handleInboxClick,
                      expandable: true,
                      expanded: isExpanded('nav:inbox'),
                      onToggle: () => toggleExpanded('nav:inbox'),
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
                      icon: <McpIcon className="h-4 w-4" />,
                      variant: isSourcesNavigation(navState) && !navState.category ? "default" : "ghost",
                      onClick: handleSourcesClick,
                      expandable: true,
                      expanded: isExpanded('nav:sources'),
                      onToggle: () => toggleExpanded('nav:sources'),
                      items: [
                        {
                          id: "nav:sources:local-files",
                          title: "Local Files",
                          label: String(sourceCounts.localFiles),
                          icon: FolderOpen,
                          variant: isSourcesNavigation(navState) && navState.category === 'local-files' ? "default" : "ghost",
                          onClick: () => handleSourceCategoryClick('local-files'),
                        },
                        {
                          id: "nav:sources:online-sources",
                          title: "Online Sources",
                          label: String(sourceCounts.onlineSources),
                          icon: Globe,
                          variant: isSourcesNavigation(navState) && navState.category === 'online-sources' ? "default" : "ghost",
                          onClick: () => handleSourceCategoryClick('online-sources'),
                        },
                        {
                          id: "nav:sources:local-mcp",
                          title: "Local MCP",
                          label: String(sourceCounts.localMcp),
                          icon: Terminal,
                          variant: isSourcesNavigation(navState) && navState.category === 'local-mcp' ? "default" : "ghost",
                          onClick: () => handleSourceCategoryClick('local-mcp'),
                        },
                      ],
                    },
                    {
                      id: "nav:settings",
                      title: "Settings",
                      icon: Settings,
                      variant: isSettingsNavigation(navState) ? "default" : "ghost",
                      onClick: () => handleSettingsClick('general'),
                    },
                  ]}
                />
                {/* Agent Tree: Hierarchical list of agents */}
                <div className="flex-1 min-h-0 flex flex-col overflow-hidden mb-1">
                  <ScrollArea className="h-full">
                    <AnimatePresence mode="wait">
                      <motion.div
                        key={activeWorkspaceId ?? 'none'}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.15 }}
                        className="px-2 py-1"
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
                            onAgentDoubleClick={handleAgentDoubleClick}
                            agentSources={agentSources}
                            expandedAgentSources={expandedAgentSources}
                            onToggleAgentSources={handleToggleAgentSources}
                            onPromoteSource={handlePromoteSource}
                            onOpenSourceInfo={handleOpenSourceInfo}
                          />
                        )}
                      </motion.div>
                    </AnimatePresence>
                  </ScrollArea>
                </div>
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
            className="h-full flex flex-col min-w-0 bg-background shrink-0 shadow-middle rounded-[14px] overflow-hidden"
            style={{ width: sessionListWidth }}
          >
            <PanelHeader
              title={listTitle}
              compensateForStoplight={!isSidebarVisible}
              actions={
                <>
                  {/* Filter dropdown - allows filtering by todo states (only in All Chats view) */}
                  {chatFilter?.kind === 'inbox' && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className={cn(
                            "h-7 w-7 shrink-0 rounded-[4px] titlebar-no-drag",
                            listFilter.size > 0 ? "text-foreground" : "text-muted-foreground hover:text-foreground"
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
                  {/* More menu with Search for non-inbox views (only for chats mode) */}
                  {isChatsNavigation(navState) && chatFilter?.kind !== 'inbox' && (
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
                  {/* Add Source button (only for sources mode) */}
                  {isSourcesNavigation(navState) && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 shrink-0 rounded-[4px] titlebar-no-drag text-muted-foreground hover:text-foreground"
                      onClick={handleAddSource}
                    >
                      <Plus className="h-4 w-4" />
                    </Button>
                  )}
                </>
              }
            />
            <Separator />
            {/* Content: SessionList, SourcesListPanel, or SettingsNavigator based on navigation state */}
            {isSourcesNavigation(navState) && (
              /* Sources List */
              <SourcesListPanel
                sources={sources}
                onAddSource={handleAddSource}
                onDeleteSource={handleDeleteSource}
                onSourceClick={handleOpenWorkspaceSourceInfo}
                selectedSourceSlug={isSourcesNavigation(navState) && navState.details ? navState.details.sourceSlug : null}
                localMcpEnabled={localMcpEnabled}
                category={navState.category}
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
                {/* Activation/Auth Banner - shows when agent needs activation or authentication */}
                <SetupAuthBanner
                  state={chatFilter?.kind === 'agent' ? bannerState.state : 'hidden'}
                  agentName={selectedAgentId ? agents.find(a => a.id === selectedAgentId)?.displayName || agents.find(a => a.id === selectedAgentId)?.name : undefined}
                  reason={bannerState.reason}
                  onAction={handleBannerAction}
                />
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
                    // Navigate to the session via central routing
                    navigate(routes.tab.chat(selectedMeta.id))
                  }}
                  onOpenInNewWindow={(selectedMeta) => {
                    if (activeWorkspaceId) {
                      window.electronAPI.openSessionInNewWindow(activeWorkspaceId, selectedMeta.id)
                    }
                  }}
                  onNavigateToView={(view) => {
                    if (view === 'completed') {
                      navigate(routes.view.archive())
                    } else if (view === 'inbox') {
                      navigate(routes.view.inbox())
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
          <div className="flex-1 overflow-hidden min-w-0 bg-background shadow-middle rounded-[14px]">
            <MainContentPanel isFocusedMode={isFocusedMode} />
          </div>
        </div>
      </div>

      </TooltipProvider>
    </AppShellProvider>
  )
}
