import * as React from 'react'
import { ChevronRight, Circle, FolderKanban } from 'lucide-react'
import type { ComponentEntry } from './types'
import type { SessionMeta } from '@/atoms/sessions'
import type { SessionStatus } from '@/config/session-status-config'
import type { ContentSearchResult } from '@/hooks/useSessionSearch'
import { SessionItem } from '@/components/app-shell/SessionItem'
import { SessionListProvider, type SessionListContextValue } from '@/context/SessionListContext'
import { ActionRegistryProvider } from '@/actions/registry'
import { cn } from '@/lib/utils'

// ============================================================================
// Mock session statuses (parallels the playground's session-list.tsx)
// ============================================================================

const mockSessionStatuses: SessionStatus[] = [
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

function createMockContext(overrides: Partial<SessionListContextValue> = {}): SessionListContextValue {
  return {
    onRenameClick: () => {},
    onSessionStatusChange: () => {},
    onMarkUnread: () => {},
    onDelete: async () => true,
    onSelectSessionById: () => {},
    onOpenInNewWindow: () => {},
    onFocusZone: () => {},
    onKeyDown: () => {},
    sessionStatuses: mockSessionStatuses,
    flatLabels: [],
    labels: [],
    isMultiSelectActive: false,
    contentSearchResults: new Map(),
    ...overrides,
  }
}

const noopKeyDown = () => {}

// ============================================================================
// Mock projects & sessions
// ============================================================================

const PROJECT_PALETTE: string[] = [
  '#6366f1', // indigo
  '#10b981', // emerald
  '#f59e0b', // amber
  '#ef4444', // red
  '#ec4899', // pink
  '#14b8a6', // teal
  '#a855f7', // purple
  '#64748b', // slate
]

type ProjectMock = { id: string; name: string; color: string }
type ColorVariant = 'stripe' | 'tint' | 'both' | 'none'

const INITIAL_PROJECTS: ProjectMock[] = [
  { id: 'p-marketing', name: 'Marketing', color: '#ec4899' },
  { id: 'p-engineering', name: 'Engineering', color: '#6366f1' },
  { id: 'p-research', name: 'Research', color: '#10b981' },
]

const sampleSessions: Array<SessionMeta & { projectId?: string }> = [
  {
    id: 's1',
    name: 'Q3 Campaign Plan',
    workspaceId: 'ws',
    lastMessageAt: Date.now() - 1000 * 60 * 6,
    sessionStatus: 'in-progress',
    labels: ['Marketing · Strategy'],
    projectId: 'p-marketing',
  },
  {
    id: 's2',
    name: 'Pricing copy review',
    workspaceId: 'ws',
    lastMessageAt: Date.now() - 1000 * 60 * 25,
    sessionStatus: 'todo',
    projectId: 'p-marketing',
  },
  {
    id: 's3',
    name: 'Fix login crash on mobile',
    workspaceId: 'ws',
    lastMessageAt: Date.now() - 1000 * 60 * 60,
    sessionStatus: 'todo',
    labels: ['Bug · bug'],
    projectId: 'p-engineering',
  },
  {
    id: 's4',
    name: 'API rate-limit retry logic',
    workspaceId: 'ws',
    lastMessageAt: Date.now() - 1000 * 60 * 90,
    sessionStatus: 'in-progress',
    labels: ['Code · Git'],
    projectId: 'p-engineering',
  },
  {
    id: 's5',
    name: 'User interview synthesis',
    workspaceId: 'ws',
    lastMessageAt: Date.now() - 1000 * 60 * 60 * 3,
    sessionStatus: 'done',
    projectId: 'p-research',
  },
  {
    id: 's6',
    name: 'Gmail Account Reauthentication',
    workspaceId: 'ws',
    lastMessageAt: Date.now() - 1000 * 60 * 60 * 4,
    sessionStatus: 'todo',
  },
  {
    id: 's7',
    name: 'Untagged scratchpad',
    workspaceId: 'ws',
    lastMessageAt: Date.now() - 1000 * 60 * 60 * 22,
    sessionStatus: 'todo',
  },
]

// ============================================================================
// Color editor
// ============================================================================

function ProjectColorEditor({
  projects,
  onChange,
}: {
  projects: ProjectMock[]
  onChange: (next: ProjectMock[]) => void
}) {
  const setColor = (id: string, color: string) =>
    onChange(projects.map(p => (p.id === id ? { ...p, color } : p)))

  return (
    <section className="rounded-md border border-border/50 p-3">
      <div className="text-xs font-medium text-foreground/60 mb-2">Projects</div>
      <ul className="space-y-2">
        {projects.map(project => (
          <li key={project.id} className="flex items-center gap-3 flex-wrap">
            <FolderKanban className="h-3.5 w-3.5 text-foreground/40" />
            <span className="text-sm w-28 truncate">{project.name}</span>
            <div className="flex items-center gap-1">
              {PROJECT_PALETTE.map(swatch => {
                const isActive = swatch.toLowerCase() === project.color.toLowerCase()
                return (
                  <button
                    key={swatch}
                    type="button"
                    onClick={() => setColor(project.id, swatch)}
                    className="h-4 w-4 rounded-full ring-1 ring-foreground/10 hover:ring-foreground/30 transition-shadow"
                    style={{
                      backgroundColor: swatch,
                      outline: isActive ? '2px solid var(--foreground)' : 'none',
                      outlineOffset: '1px',
                    }}
                    aria-label={`Set ${project.name} color to ${swatch}`}
                  />
                )
              })}
              <input
                type="color"
                value={project.color}
                onChange={e => setColor(project.id, e.target.value)}
                className="h-5 w-7 ml-1 cursor-pointer border-0 bg-transparent"
                aria-label={`Custom color for ${project.name}`}
              />
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}

// ============================================================================
// Section header (matches real SessionList: chevron + uppercase muted label)
// ============================================================================

function GroupHeader({
  label,
  count,
  isCollapsed,
  onToggle,
}: {
  label: string
  count: number
  isCollapsed: boolean
  onToggle: () => void
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="w-full py-2 px-4 flex items-center gap-1.5 cursor-pointer relative group"
    >
      <div className="absolute inset-y-0.5 left-2 right-2 rounded-[6px] group-hover:bg-foreground/[0.03] transition-colors pointer-events-none" />
      <ChevronRight
        className={cn(
          'h-3 w-3 text-muted-foreground/60 transition-transform relative',
          !isCollapsed && 'rotate-90'
        )}
      />
      <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground relative">
        {label}
        {isCollapsed && (
          <>
            {' · '}
            <span className="text-muted-foreground/50">{count}</span>
          </>
        )}
      </span>
    </button>
  )
}

// ============================================================================
// Row wrapper that applies project color (stripe + tint overlay)
// ============================================================================

function ColoredRowWrapper({
  color,
  variant,
  children,
}: {
  color: string | null
  variant: ColorVariant
  children: React.ReactNode
}) {
  const hasColor = !!color && variant !== 'none'
  const showStripe = hasColor && (variant === 'stripe' || variant === 'both')
  const showTint = hasColor && (variant === 'tint' || variant === 'both')

  return (
    <div
      className="relative"
      style={
        showTint && color
          ? { backgroundColor: `color-mix(in srgb, ${color} 6%, transparent)` }
          : undefined
      }
    >
      {showStripe && color && (
        <div
          className="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-r-sm z-10 pointer-events-none"
          style={{ backgroundColor: color }}
          aria-hidden
        />
      )}
      {children}
    </div>
  )
}

// ============================================================================
// Grouped list
// ============================================================================

interface ProjectColorsPreviewProps {
  variant?: ColorVariant
}

function ProjectColorsPreview({ variant = 'stripe' }: ProjectColorsPreviewProps) {
  const [projects, setProjects] = React.useState<ProjectMock[]>(INITIAL_PROJECTS)
  const [collapsedGroups, setCollapsedGroups] = React.useState<Set<string>>(new Set())
  const [selectedSessionId, setSelectedSessionId] = React.useState<string | null>('s1')

  const projectById = React.useMemo(() => new Map(projects.map(p => [p.id, p])), [projects])

  // Bucket sessions by project
  const groups = React.useMemo(() => {
    const buckets = new Map<string, typeof sampleSessions>()
    for (const session of sampleSessions) {
      const key = session.projectId ?? '__none__'
      if (!buckets.has(key)) buckets.set(key, [])
      buckets.get(key)!.push(session)
    }
    const ordered: Array<{ key: string; label: string; sessions: typeof sampleSessions; project: ProjectMock | null }> = []
    for (const project of projects) {
      const rows = buckets.get(project.id)
      if (rows && rows.length > 0) {
        ordered.push({ key: project.id, label: project.name, sessions: rows, project })
      }
    }
    const noProject = buckets.get('__none__')
    if (noProject && noProject.length > 0) {
      ordered.push({ key: '__none__', label: 'No project', sessions: noProject, project: null })
    }
    return ordered
  }, [projects])

  const toggleGroup = (key: string) =>
    setCollapsedGroups(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

  const ctx = createMockContext({
    selectedSessionId,
    contentSearchResults: new Map<string, ContentSearchResult>(),
  })

  return (
    <div className="max-w-md mx-auto p-4 space-y-4">
      <ProjectColorEditor projects={projects} onChange={setProjects} />

      <ActionRegistryProvider>
        <SessionListProvider value={ctx}>
          <div className="w-full border border-border rounded-lg overflow-hidden bg-background">
            <div className="px-4 py-2.5 border-b border-border/50">
              <span className="text-sm font-medium">All Sessions</span>
            </div>
            <div className="flex flex-col pb-2">
              {groups.map(group => {
                const isCollapsed = collapsedGroups.has(group.key)
                return (
                  <React.Fragment key={group.key}>
                    <GroupHeader
                      label={group.label}
                      count={group.sessions.length}
                      isCollapsed={isCollapsed}
                      onToggle={() => toggleGroup(group.key)}
                    />
                    {!isCollapsed &&
                      group.sessions.map((session, index) => {
                        const color = session.projectId
                          ? projectById.get(session.projectId)?.color ?? null
                          : null
                        const isSelected = session.id === selectedSessionId
                        return (
                          <ColoredRowWrapper key={session.id} color={color} variant={variant}>
                            <SessionItem
                              item={session}
                              index={index}
                              itemProps={{ tabIndex: 0, onKeyDown: noopKeyDown }}
                              isSelected={isSelected}
                              isFirstInGroup={index === 0}
                              isInMultiSelect={false}
                              onSelect={() => setSelectedSessionId(session.id)}
                            />
                          </ColoredRowWrapper>
                        )
                      })}
                  </React.Fragment>
                )
              })}
            </div>
          </div>
        </SessionListProvider>
      </ActionRegistryProvider>
    </div>
  )
}

// ============================================================================
// Registry entry
// ============================================================================

export const projectColorsComponents: ComponentEntry[] = [
  {
    id: 'project-colors-prototype',
    name: 'Project Colors → Session Tint',
    category: 'Session List',
    description:
      'Prototype: projects get a color and bound sessions inherit it visually in the real SessionList. Pick a variant to compare visual treatments.',
    component: ProjectColorsPreview,
    props: [
      {
        name: 'variant',
        description: 'Visual treatment for sessions belonging to a colored project',
        control: {
          type: 'select',
          options: [
            { label: 'Left stripe', value: 'stripe' },
            { label: 'Row background tint', value: 'tint' },
            { label: 'Stripe + tint', value: 'both' },
            { label: 'No color (baseline)', value: 'none' },
          ],
        },
        defaultValue: 'stripe',
      },
    ],
    variants: [
      {
        name: 'Left stripe',
        description: '3px colored stripe on the row leading edge',
        props: { variant: 'stripe' },
      },
      {
        name: 'Row tint',
        description: 'Row background tinted at ~6% alpha with the project color',
        props: { variant: 'tint' },
      },
      {
        name: 'Stripe + tint',
        description: 'Both stripe and tint combined',
        props: { variant: 'both' },
      },
      {
        name: 'No color',
        description: 'Disable project coloring entirely (baseline)',
        props: { variant: 'none' },
      },
    ],
    mockData: () => ({}),
  },
]
