import * as React from 'react'
import { CalendarDays, CheckCircle2, Circle, Clock3, MessageSquare, Plus, Users, GripVertical } from 'lucide-react'
import {
  DndContext,
  DragOverlay,
  closestCorners,
  PointerSensor,
  useSensor,
  useSensors,
  DragStartEvent,
  DragEndEvent,
  useDroppable,
  useDraggable,
} from '@dnd-kit/core'
import { CSS } from '@dnd-kit/utilities'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { getSessionTitle } from '@/utils/session'
import type { SessionMeta } from '@/atoms/sessions'
import {
  ARTIST_NETWORK_CONTEXT_SLUG,
  parseArtistNetworkDocResult,
  type ArtistNetworkPerson,
} from '@/lib/artist-network'

interface AgendaPageProps {
  sessions: SessionMeta[]
  onOpenSession: (sessionId: string) => void
  onNewTask: () => void
  networkWorkspaceId?: string
}

type AgendaColumnId = 'todo' | 'in-progress' | 'done'

const AGENDA_COLUMNS: Array<{ id: AgendaColumnId; label: string }> = [
  { id: 'todo', label: 'To Do' },
  { id: 'in-progress', label: 'Doing' },
  { id: 'done', label: 'Done' },
]

const PERSON_LABEL_PREFIX = 'person::'
const NO_PERSON_VALUE = '__none__'

type SessionOverride = Partial<Pick<SessionMeta, 'name' | 'sessionStatus' | 'labels' | 'preview'>>

function DroppableLane({ id, children, className }: { id: string, children: React.ReactNode, className?: string }) {
  const { isOver, setNodeRef } = useDroppable({ id })
  return (
    <section ref={setNodeRef} className={cn(className, isOver && 'ring-2 ring-orange-500/50 bg-[#0A0A0A]')}>
      {children}
    </section>
  )
}

function DraggableCard({ session, networkPeople, onClick }: { session: SessionMeta, networkPeople: ArtistNetworkPerson[], onClick: () => void }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: session.id,
    data: { session }
  })
  
  const style = {
    transform: CSS.Translate.toString(transform),
    opacity: isDragging ? 0.4 : 1,
    zIndex: isDragging ? 50 : undefined,
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "group relative flex w-full flex-col gap-2 rounded-[13px] border border-white/[0.055] bg-white/[0.025] px-3 py-2.5 text-left transition-colors hover:bg-white/[0.05]",
        isDragging && "shadow-2xl border-white/[0.15]"
      )}
    >
      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={onClick}
          className="flex-1 text-left line-clamp-1 text-sm font-medium leading-5 text-white/80 hover:text-white"
        >
          {getSessionTitle(session)}
        </button>
        <div className="flex items-center gap-2">
          <Circle className={cn('h-3 w-3 shrink-0', session.isProcessing ? 'text-orange-300' : 'text-white/24')} />
          <button
            type="button"
            className="cursor-grab p-1 text-white/20 opacity-0 transition-opacity hover:text-white/50 group-hover:opacity-100"
            {...attributes}
            {...listeners}
          >
            <GripVertical className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
      <button type="button" onClick={onClick} className="text-left w-full cursor-pointer">
        <p className="line-clamp-1 text-xs leading-5 text-white/38">
          {session.preview || session.spawnedFromAgent?.agentName || 'Workspace task'}
        </p>
        <div className="mt-2 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.12em] text-white/25">
            <MessageSquare className="h-3 w-3" />
            {session.messageCount ?? 0}
          </div>
          <PersonBadge labels={session.labels} people={networkPeople} />
        </div>
      </button>
    </div>
  )
}

function CardOverlay({ session, networkPeople }: { session: SessionMeta, networkPeople: ArtistNetworkPerson[] }) {
  return (
    <div className="w-full rounded-[13px] border border-white/[0.15] bg-[#1a1a1a] px-3 py-2.5 shadow-2xl rotate-2">
      <div className="flex items-center justify-between gap-3">
        <p className="line-clamp-1 text-sm font-medium leading-5 text-white/80">{getSessionTitle(session)}</p>
        <Circle className={cn('h-3 w-3 shrink-0', session.isProcessing ? 'text-orange-300' : 'text-white/24')} />
      </div>
      <p className="mt-1 line-clamp-1 text-xs leading-5 text-white/38">
        {session.preview || session.spawnedFromAgent?.agentName || 'Workspace task'}
      </p>
      <div className="mt-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.12em] text-white/25">
          <MessageSquare className="h-3 w-3" />
          {session.messageCount ?? 0}
        </div>
        <PersonBadge labels={session.labels} people={networkPeople} />
      </div>
    </div>
  )
}

export function AgendaPage({ sessions, onOpenSession, onNewTask, networkWorkspaceId }: AgendaPageProps) {
  const [networkPeople, setNetworkPeople] = React.useState<ArtistNetworkPerson[]>([])
  const [sessionOverrides, setSessionOverrides] = React.useState<Record<string, SessionOverride>>({})
  const [selectedSessionId, setSelectedSessionId] = React.useState<string | null>(null)
  const [draftTitle, setDraftTitle] = React.useState('')
  const [draftDetails, setDraftDetails] = React.useState('')
  const [draftStatus, setDraftStatus] = React.useState<AgendaColumnId>('todo')
  const [draftPersonId, setDraftPersonId] = React.useState(NO_PERSON_VALUE)
  const [saving, setSaving] = React.useState(false)

  React.useEffect(() => {
    let cancelled = false
    if (!networkWorkspaceId) {
      setNetworkPeople([])
      return
    }
    void window.electronAPI.listWorkspaceContextDocs(networkWorkspaceId).then((docs) => {
      if (cancelled) return
      const result = parseArtistNetworkDocResult(docs.find((doc) => doc.slug === ARTIST_NETWORK_CONTEXT_SLUG))
      setNetworkPeople(result.network.people)
    }).catch(() => {
      if (!cancelled) setNetworkPeople([])
    })
    return () => {
      cancelled = true
    }
  }, [networkWorkspaceId])

  const visibleSessions = React.useMemo(
    () => sessions
      .filter((session) => !session.hidden && !session.isArchived)
      .map((session) => ({ ...session, ...(sessionOverrides[session.id] ?? {}) })),
    [sessionOverrides, sessions],
  )
  const byColumn = React.useMemo(() => {
    const map = new Map<string, SessionMeta[]>()
    for (const column of AGENDA_COLUMNS) map.set(column.id, [])
    for (const session of visibleSessions) {
      const key = normalizeAgendaStatus(session.sessionStatus)
      map.get(key)?.push(session)
    }
    for (const items of map.values()) {
      items.sort((a, b) => (b.lastMessageAt ?? b.createdAt ?? 0) - (a.lastMessageAt ?? a.createdAt ?? 0))
    }
    return map
  }, [visibleSessions])

  const selectedSession = React.useMemo(
    () => visibleSessions.find((session) => session.id === selectedSessionId) ?? null,
    [selectedSessionId, visibleSessions],
  )

  const openEditor = React.useCallback((session: SessionMeta) => {
    setSelectedSessionId(session.id)
    setDraftTitle(getSessionTitle(session))
    setDraftDetails('')
    setDraftStatus(normalizeAgendaStatus(session.sessionStatus))
    setDraftPersonId(getPersonIdFromLabels(session.labels) ?? NO_PERSON_VALUE)
    void window.electronAPI.getSessionNotes(session.id).then((notes) => {
      setDraftDetails(notes)
    }).catch(() => {
      setDraftDetails(session.preview ?? '')
    })
  }, [])

  const saveEditor = React.useCallback(async () => {
    if (!selectedSession) return
    const title = draftTitle.trim() || getSessionTitle(selectedSession)
    const labels = setPersonLabel(selectedSession.labels ?? [], draftPersonId === NO_PERSON_VALUE ? null : draftPersonId)
    setSaving(true)
    try {
      await Promise.all([
        title !== getSessionTitle(selectedSession)
          ? window.electronAPI.sessionCommand(selectedSession.id, { type: 'rename', name: title })
          : Promise.resolve(),
        draftStatus !== normalizeAgendaStatus(selectedSession.sessionStatus)
          ? window.electronAPI.sessionCommand(selectedSession.id, { type: 'setSessionStatus', state: draftStatus })
          : Promise.resolve(),
        window.electronAPI.sessionCommand(selectedSession.id, { type: 'setLabels', labels }),
        window.electronAPI.setSessionNotes(selectedSession.id, draftDetails),
      ])
      setSessionOverrides((current) => ({
        ...current,
        [selectedSession.id]: {
          ...(current[selectedSession.id] ?? {}),
          name: title,
          sessionStatus: draftStatus,
          labels,
          preview: draftDetails.trim() ? draftDetails.trim().split('\n')[0] : selectedSession.preview,
        },
      }))
      setSelectedSessionId(null)
    } finally {
      setSaving(false)
    }
  }, [draftDetails, draftPersonId, draftStatus, draftTitle, selectedSession])

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 5,
      },
    })
  )

  const [activeDragId, setActiveDragId] = React.useState<string | null>(null)
  
  const activeDragSession = React.useMemo(
    () => activeDragId ? visibleSessions.find(s => s.id === activeDragId) : null,
    [activeDragId, visibleSessions]
  )

  const handleDragStart = React.useCallback((event: DragStartEvent) => {
    setActiveDragId(event.active.id as string)
  }, [])

  const handleDragEnd = React.useCallback((event: DragEndEvent) => {
    const { active, over } = event
    setActiveDragId(null)
    
    if (over && over.id !== normalizeAgendaStatus(visibleSessions.find(s => s.id === active.id)?.sessionStatus)) {
      const sessionId = active.id as string
      const newStatus = over.id as AgendaColumnId
      
      setSessionOverrides((current) => ({
        ...current,
        [sessionId]: {
          ...(current[sessionId] ?? {}),
          sessionStatus: newStatus,
        },
      }))
      
      window.electronAPI.sessionCommand(sessionId, { type: 'setSessionStatus', state: newStatus }).catch(console.error)
    }
  }, [visibleSessions])

  return (
    <div className="runneros-glass-route h-full overflow-y-auto">
      <div className="mx-auto min-h-full w-full max-w-[1600px] px-5 py-4 xl:px-8 xl:py-5">
        <header className="mb-5 flex items-start justify-between gap-4">
          <div>
            <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-white/[0.06] bg-white/[0.025] px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-white/46">
              <CalendarDays className="h-3.5 w-3.5 text-orange-300/75" />
              Work Board
            </div>
            <h1 className="text-4xl font-medium tracking-tight text-white/90">Agenda</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-white/45">
              Track jobs, follow-ups, and active work without opening chat. Campaign command centers stay inside their own workspaces.
            </p>
          </div>
          <button
            type="button"
            onClick={onNewTask}
            className="inline-flex h-9 items-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.035] px-4 text-xs font-medium text-white/65"
          >
            <Plus className="h-3.5 w-3.5" />
            New Task
          </button>
        </header>

        <DndContext
          sensors={sensors}
          collisionDetection={closestCorners}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
        >
          <div className="grid min-h-[520px] grid-cols-1 gap-3 lg:grid-cols-3">
            {AGENDA_COLUMNS.map((column, index) => {
              const items = byColumn.get(column.id) ?? []
              return (
                <DroppableLane key={column.id} id={column.id} className="rounded-[18px] border border-white/[0.055] bg-[#0A0A0A]/82 p-3 transition-colors">
                  <div className="mb-3 flex items-center justify-between border-b border-white/[0.045] pb-2.5">
                    <div className="flex items-center gap-2">
                      <ColumnIcon index={index} />
                      <h2 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-white/50">{column.label}</h2>
                    </div>
                    <span className="text-[10px] tabular-nums text-white/28">{items.length}</span>
                  </div>

                  <div className="space-y-2">
                    {items.length ? items.map((session) => (
                      <DraggableCard
                        key={session.id}
                        session={session}
                        networkPeople={networkPeople}
                        onClick={() => openEditor(session)}
                      />
                    )) : (
                      <div className="rounded-[14px] border border-dashed border-white/[0.06] bg-white/[0.012] px-3 py-6 text-center text-xs text-white/30 pointer-events-none">
                        Nothing here.
                      </div>
                    )}
                  </div>
                </DroppableLane>
              )
            })}
          </div>
          <DragOverlay>
            {activeDragSession ? (
              <CardOverlay session={activeDragSession} networkPeople={networkPeople} />
            ) : null}
          </DragOverlay>
        </DndContext>
      </div>

      <Dialog open={Boolean(selectedSession)} onOpenChange={(open) => !open && setSelectedSessionId(null)}>
        <DialogContent className="max-w-[620px] border-white/[0.08] bg-[#080808] text-white shadow-2xl">
          <DialogHeader>
            <DialogTitle className="text-xl font-medium">Edit task</DialogTitle>
            <DialogDescription className="sr-only">
              Edit the task title, notes, board status, and assigned Network person.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <label className="block space-y-2">
              <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-white/36">Title</span>
              <input
                value={draftTitle}
                onChange={(event) => setDraftTitle(event.target.value)}
                className="h-10 w-full rounded-[10px] border border-white/[0.08] bg-white/[0.025] px-3 text-sm text-white/80 outline-none focus:border-orange-400/45"
              />
            </label>
            <label className="block space-y-2">
              <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-white/36">Info</span>
              <Textarea
                value={draftDetails}
                onChange={(event) => setDraftDetails(event.target.value)}
                placeholder="Add notes, context, links, or next steps..."
                className="min-h-28 rounded-[12px] border-white/[0.08] bg-white/[0.025] text-sm text-white/74 placeholder:text-white/22 focus-visible:border-orange-400/45"
              />
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block space-y-2">
                <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-white/36">Status</span>
                <Select value={draftStatus} onValueChange={(value) => setDraftStatus(value as AgendaColumnId)}>
                  <SelectTrigger className="rounded-[10px] border-white/[0.08] bg-white/[0.025] text-white/74">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {AGENDA_COLUMNS.map((column) => (
                      <SelectItem key={column.id} value={column.id}>{column.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>
              <label className="block space-y-2">
                <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-white/36">Person</span>
                <Select value={draftPersonId} onValueChange={setDraftPersonId}>
                  <SelectTrigger className="rounded-[10px] border-white/[0.08] bg-white/[0.025] text-white/74">
                    <SelectValue placeholder="Tag from Network" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_PERSON_VALUE}>No person</SelectItem>
                    {networkPeople.map((person) => (
                      <SelectItem key={person.id} value={person.id}>{person.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>
            </div>
          </div>
          <DialogFooter>
            <button
              type="button"
              onClick={() => selectedSession && onOpenSession(selectedSession.id)}
              className="h-10 rounded-full border border-white/[0.08] px-4 text-sm font-medium text-white/62 hover:bg-white/[0.04]"
            >
              Open Chat
            </button>
            <button
              type="button"
              onClick={saveEditor}
              disabled={saving}
              className="h-10 rounded-full bg-white px-5 text-sm font-semibold text-black disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saving ? 'Saving...' : 'Save'}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function ColumnIcon({ index }: { index: number }) {
  const Icon = index === 0 ? Circle : index === 1 ? Clock3 : CheckCircle2
  return <Icon className="h-3.5 w-3.5 text-white/35" />
}

function normalizeAgendaStatus(status: string | undefined): AgendaColumnId {
  if (status === 'done' || status === 'complete' || status === 'completed') return 'done'
  if (status === 'in-progress' || status === 'doing' || status === 'active') return 'in-progress'
  return 'todo'
}

function getPersonIdFromLabels(labels: string[] | undefined): string | null {
  return labels?.find((label) => label.startsWith(PERSON_LABEL_PREFIX))?.slice(PERSON_LABEL_PREFIX.length) ?? null
}

function setPersonLabel(labels: string[], personId: string | null): string[] {
  const next = labels.filter((label) => !label.startsWith(PERSON_LABEL_PREFIX))
  if (personId) next.push(`${PERSON_LABEL_PREFIX}${personId}`)
  return next
}

function PersonBadge({ labels, people }: { labels: string[] | undefined; people: ArtistNetworkPerson[] }) {
  const personId = getPersonIdFromLabels(labels)
  if (!personId) return null
  const person = people.find((item) => item.id === personId)
  return (
    <span className="inline-flex max-w-[160px] items-center gap-1 rounded-full border border-white/[0.06] bg-white/[0.035] px-2 py-1 text-[10px] font-medium text-white/46">
      <Users className="h-3 w-3 shrink-0" />
      <span className="truncate">{person?.name ?? 'Network'}</span>
    </span>
  )
}
