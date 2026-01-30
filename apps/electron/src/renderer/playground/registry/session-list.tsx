import * as React from 'react'
import type { ComponentEntry } from './types'
import type { SessionMeta } from '@/atoms/sessions'
import type { TodoState } from '@/config/todo-states'
import { Circle, Flag } from 'lucide-react'
import { Spinner } from '@craft-agent/ui'
import { cn } from '@/lib/utils'
import { Separator } from '@/components/ui/separator'
import { SessionSearchHeader } from '@/components/app-shell/SessionSearchHeader'

// ============================================================================
// Mock Todo States (minimal set for playground)
// ============================================================================

const mockTodoStates: TodoState[] = [
  {
    id: 'todo',
    label: 'Todo',
    resolvedColor: 'var(--muted-foreground)',
    icon: <Circle className="h-3.5 w-3.5" strokeWidth={1.5} />,
    iconColorable: true,
    category: 'open',
  },
  {
    id: 'in-progress',
    label: 'In Progress',
    resolvedColor: 'var(--info)',
    icon: <Circle className="h-3.5 w-3.5" strokeWidth={1.5} />,
    iconColorable: true,
    category: 'open',
  },
  {
    id: 'done',
    label: 'Done',
    resolvedColor: 'var(--success)',
    icon: <Circle className="h-3.5 w-3.5" strokeWidth={1.5} />,
    iconColorable: true,
    category: 'closed',
  },
]

// ============================================================================
// Highlight matching text utility (mirrored from SessionList)
// ============================================================================

function highlightMatch(text: string, query: string): React.ReactNode {
  if (!query.trim()) return text

  const lowerText = text.toLowerCase()
  const lowerQuery = query.toLowerCase()
  const index = lowerText.indexOf(lowerQuery)

  if (index === -1) return text

  const before = text.slice(0, index)
  const match = text.slice(index, index + query.length)
  const after = text.slice(index + query.length)

  return (
    <>
      {before}
      <span className="px-1 py-0.5 bg-yellow-300/30 rounded-[4px]">{match}</span>
      {highlightMatch(after, query)}
    </>
  )
}

// ============================================================================
// Sample Session Data
// ============================================================================

const sampleSessions: SessionMeta[] = [
  {
    id: 'session-1',
    name: 'Fix authentication bug in login flow',
    workspaceId: 'workspace-1',
    lastMessageAt: Date.now() - 1000 * 60 * 5, // 5 min ago
    todoState: 'in-progress',
    hasUnread: true,
    isFlagged: true,
  },
  {
    id: 'session-2',
    name: 'Implement search functionality',
    workspaceId: 'workspace-1',
    lastMessageAt: Date.now() - 1000 * 60 * 30, // 30 min ago
    todoState: 'todo',
    labels: ['feature', 'priority::high'],
  },
  {
    id: 'session-3',
    name: 'Review pull request #42',
    workspaceId: 'workspace-1',
    lastMessageAt: Date.now() - 1000 * 60 * 60, // 1 hour ago
    todoState: 'done',
    isProcessing: true,
  },
  {
    id: 'session-4',
    name: 'Debug API response handling',
    workspaceId: 'workspace-1',
    lastMessageAt: Date.now() - 1000 * 60 * 60 * 2, // 2 hours ago
    todoState: 'todo',
  },
]

// ============================================================================
// SessionItemPreview - Simplified SessionItem for playground
// Renders the visual states without requiring all SessionList infrastructure
// ============================================================================

interface SessionItemPreviewProps {
  item: SessionMeta
  isSelected?: boolean
  searchQuery?: string
  /** Number of matches in ChatDisplay (for match badge) */
  chatMatchCount?: number
  todoStates?: TodoState[]
}

function SessionItemPreview({
  item,
  isSelected = false,
  searchQuery = '',
  chatMatchCount,
  todoStates = mockTodoStates,
}: SessionItemPreviewProps) {
  const currentTodoState = todoStates.find(s => s.id === item.todoState) ?? todoStates[0]
  const title = item.name || item.preview || 'Untitled conversation'

  return (
    <div
      className="session-item"
      data-selected={isSelected || undefined}
    >
      {/* Wrapper for button content */}
      <div className="session-content relative group select-none pl-2 mr-2">
        {/* Todo State Icon */}
        <div className="absolute left-4 top-3.5 z-10">
          <div
            className={cn(
              "w-4 h-4 flex items-center justify-center rounded-full transition-colors cursor-pointer",
              "hover:bg-foreground/5",
            )}
            style={{ color: currentTodoState.resolvedColor }}
          >
            <div className="w-4 h-4 flex items-center justify-center [&>svg]:w-full [&>svg]:h-full">
              {currentTodoState.icon}
            </div>
          </div>
        </div>

        {/* Main content button */}
        <div
          className={cn(
            "flex w-full items-start gap-2 pl-2 pr-4 py-3 text-left text-sm outline-none rounded-[8px]",
            "transition-[background-color] duration-75",
            isSelected
              ? "bg-foreground/5 hover:bg-foreground/7"
              : "hover:bg-foreground/2"
          )}
        >
          {/* Spacer for todo icon */}
          <div className="w-4 h-5 shrink-0" />

          {/* Content column */}
          <div className="flex flex-col gap-1.5 min-w-0 flex-1">
            {/* Title with search highlighting */}
            <div className="flex items-start gap-2 w-full pr-6 min-w-0">
              <div className="font-medium font-sans line-clamp-2 min-w-0 -mb-[2px]">
                {searchQuery ? highlightMatch(title, searchQuery) : title}
              </div>
            </div>

            {/* Subtitle row */}
            <div className="flex items-center gap-1.5 text-xs text-foreground/70 w-full -mb-[2px] min-w-0">
              {/* Processing spinner */}
              {item.isProcessing && (
                <Spinner className="text-[8px] text-foreground shrink-0" />
              )}

              {/* New badge */}
              {!item.isProcessing && item.hasUnread && (
                <span className="shrink-0 px-1.5 py-0.5 text-[10px] font-medium rounded bg-accent text-white">
                  New
                </span>
              )}

              {/* Badges container */}
              <div
                className="flex-1 flex items-center gap-1 min-w-0 overflow-x-auto scrollbar-hide pr-4"
                style={{ maskImage: 'linear-gradient(to right, black calc(100% - 16px), transparent 100%)', WebkitMaskImage: 'linear-gradient(to right, black calc(100% - 16px), transparent 100%)' }}
              >
                {item.isFlagged && (
                  <span className="shrink-0 h-[18px] w-[18px] flex items-center justify-center rounded bg-foreground/5">
                    <Flag className="h-[10px] w-[10px] text-info fill-info" />
                  </span>
                )}
                {item.labels?.map((label, i) => (
                  <span
                    key={i}
                    className="shrink-0 h-[18px] max-w-[120px] px-1.5 text-[10px] font-medium rounded flex items-center whitespace-nowrap"
                    style={{
                      backgroundColor: 'rgba(var(--foreground-rgb), 0.05)',
                      color: 'rgba(var(--foreground-rgb), 0.8)',
                    }}
                  >
                    {label}
                  </span>
                ))}
              </div>

              {/* Timestamp - hidden when showing match navigation */}
              {!(isSelected && searchQuery && chatMatchCount && chatMatchCount > 0) && (
                <span className="shrink-0 text-[11px] text-foreground/40 whitespace-nowrap">
                  {item.lastMessageAt ? formatRelativeTime(item.lastMessageAt) : ''}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Match count badge - shown on right side for all items with matches */}
        {chatMatchCount != null && chatMatchCount > 0 && (
          <div className="absolute right-3 top-2 z-10">
            <span
              className={cn(
                "inline-flex items-center justify-center min-w-[24px] px-1 py-1 rounded-[6px] text-[10px] font-medium tabular-nums leading-tight whitespace-nowrap",
                isSelected
                  ? "bg-yellow-300/50 border border-yellow-500 text-yellow-900"
                  : "bg-yellow-300/10 border border-yellow-600/20 text-yellow-800"
              )}
              style={{ boxShadow: isSelected ? '0 1px 2px 0 rgba(234, 179, 8, 0.3)' : '0 1px 2px 0 rgba(133, 77, 14, 0.15)' }}
              title="Matches found (⌘G next, ⌘⇧G prev)"
            >
              {chatMatchCount}
            </span>
          </div>
        )}
      </div>
    </div>
  )
}

// Simple relative time formatter
function formatRelativeTime(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  return `${days}d`
}

// ============================================================================
// SessionListSearchPreview - Shows multiple session items in search context
// ============================================================================

interface SessionListSearchPreviewProps {
  /** Current search query (highlights matches in titles) */
  searchQuery?: string
  /** Show search input bar */
  showSearchInput?: boolean
  /** Show loading state in status row */
  isSearching?: boolean
  /** Index of currently selected session (0-based) */
  selectedIndex?: number
  /** Match count for selected session (shows yellow badge) */
  chatMatchCount?: number
  /** Whether to show "no results" state */
  showNoResults?: boolean
  /** Explicit result count to display (defaults to filtered session count) */
  resultCount?: number
}

function SessionListSearchPreview({
  searchQuery = '',
  showSearchInput = true,
  isSearching = false,
  selectedIndex = 0,
  chatMatchCount,
  showNoResults = false,
  resultCount,
}: SessionListSearchPreviewProps) {
  // Filter sessions if there's a search query (simple title match for demo)
  const filteredSessions = searchQuery && !showNoResults
    ? sampleSessions.filter(s => {
        const title = s.name || s.preview || ''
        return title.toLowerCase().includes(searchQuery.toLowerCase())
      })
    : showNoResults
    ? []
    : sampleSessions

  // Use explicit resultCount if provided, otherwise use filtered count
  const displayCount = resultCount ?? filteredSessions.length

  return (
    <div className="w-[320px] h-[480px] flex flex-col border border-border rounded-lg overflow-hidden bg-background">
      {/* Search header - uses the SAME component as the real app */}
      {showSearchInput && (
        <SessionSearchHeader
          searchQuery={searchQuery}
          isSearching={isSearching}
          resultCount={displayCount}
          readOnly
        />
      )}

      {/* Session list */}
      <div className="flex-1 overflow-auto">
        {showNoResults ? (
          <div className="flex flex-col items-center justify-center py-12 px-4">
            <p className="text-sm text-muted-foreground">No conversations found</p>
            <p className="text-xs text-muted-foreground/60 mt-0.5">
              Searched titles and message content
            </p>
            <button className="text-xs text-foreground hover:underline mt-2">
              Clear search
            </button>
          </div>
        ) : (
          <div className="flex flex-col pb-4">
            {/* Date header */}
            <div className="px-4 py-2">
              <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
                Today
              </span>
            </div>

            {filteredSessions.map((session, index) => {
              const isSelected = index === selectedIndex

              return (
                <React.Fragment key={session.id}>
                  {index > 0 && (
                    <div className="session-separator pl-12 pr-4">
                      <Separator />
                    </div>
                  )}
                  <SessionItemPreview
                    item={session}
                    isSelected={isSelected}
                    searchQuery={searchQuery}
                    chatMatchCount={chatMatchCount}
                  />
                </React.Fragment>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

// ============================================================================
// Registry Entries
// ============================================================================

export const sessionListComponents: ComponentEntry[] = [
  {
    id: 'session-list-search',
    name: 'SessionList Search States',
    category: 'Session List',
    description: 'Session list search UI showing title matching and yellow match count badge',
    component: SessionListSearchPreview,
    props: [
      {
        name: 'searchQuery',
        description: 'Current search query text',
        control: { type: 'string', placeholder: 'Search...' },
        defaultValue: '',
      },
      {
        name: 'showSearchInput',
        description: 'Show the search input bar',
        control: { type: 'boolean' },
        defaultValue: true,
      },
      {
        name: 'isSearching',
        description: 'Show loading spinner while searching',
        control: { type: 'boolean' },
        defaultValue: false,
      },
      {
        name: 'selectedIndex',
        description: 'Index of selected session (0-based)',
        control: { type: 'number', min: 0, max: 3, step: 1 },
        defaultValue: 0,
      },
      {
        name: 'chatMatchCount',
        description: 'Number of matches in chat (shows yellow badge)',
        control: { type: 'number', min: 0, max: 50, step: 1 },
        defaultValue: 0,
      },
      {
        name: 'showNoResults',
        description: 'Show empty/no results state',
        control: { type: 'boolean' },
        defaultValue: false,
      },
      {
        name: 'resultCount',
        description: 'Explicit result count to display',
        control: { type: 'number', min: 0, max: 999, step: 1 },
        defaultValue: undefined,
      },
    ],
    variants: [
      {
        name: 'Default (No Search)',
        description: 'Normal session list without search active',
        props: {
          searchQuery: '',
          showSearchInput: false,
        },
      },
      {
        name: 'Search Active',
        description: 'Search input visible, no query yet',
        props: {
          searchQuery: '',
          showSearchInput: true,
        },
      },
      {
        name: 'Title Match Highlight',
        description: 'Search query matching session titles',
        props: {
          searchQuery: 'auth',
          showSearchInput: true,
          selectedIndex: 0,
          resultCount: 2,
        },
      },
      {
        name: 'With Match Badge',
        description: 'Selected session with yellow match count badge',
        props: {
          searchQuery: 'auth',
          showSearchInput: true,
          selectedIndex: 0,
          chatMatchCount: 5,
          resultCount: 47,
        },
      },
      {
        name: 'Searching (Loading)',
        description: 'Content search in progress',
        props: {
          searchQuery: 'complex query',
          showSearchInput: true,
          isSearching: true,
        },
      },
      {
        name: 'No Results',
        description: 'Search returned no matches',
        props: {
          searchQuery: 'xyznonexistent',
          showSearchInput: true,
          showNoResults: true,
          resultCount: 0,
        },
      },
    ],
    mockData: () => ({}),
  },
  {
    id: 'session-item-search',
    name: 'SessionItem Search States',
    category: 'Session List',
    description: 'Individual session item showing search-related visual states',
    component: SessionItemPreview,
    props: [
      {
        name: 'searchQuery',
        description: 'Search query for highlighting',
        control: { type: 'string', placeholder: 'Search...' },
        defaultValue: '',
      },
      {
        name: 'isSelected',
        description: 'Whether this session is selected',
        control: { type: 'boolean' },
        defaultValue: false,
      },
      {
        name: 'chatMatchCount',
        description: 'Number of matches (shows yellow badge)',
        control: { type: 'number', min: 0, max: 50, step: 1 },
        defaultValue: 0,
      },
    ],
    variants: [
      {
        name: 'Default',
        description: 'Normal state without search',
        props: {
          item: sampleSessions[0],
        },
      },
      {
        name: 'Title Highlighted',
        description: 'Search query highlights in title',
        props: {
          item: sampleSessions[0],
          searchQuery: 'auth',
        },
      },
      {
        name: 'Selected with Match Badge',
        description: 'Selected session with yellow match count badge',
        props: {
          item: sampleSessions[0],
          searchQuery: 'auth',
          isSelected: true,
          chatMatchCount: 5,
        },
      },
    ],
    mockData: () => ({
      item: sampleSessions[0],
    }),
  },
]
