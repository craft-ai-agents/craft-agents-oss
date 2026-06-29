import * as React from 'react'
import {
  BarChart3,
  Bot,
  CalendarDays,
  CheckCircle2,
  Circle,
  FileText,
  FolderKanban,
  Music2,
  Plus,
  Search,
  Sparkles,
  Users,
} from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { useWorkspaceContext } from '@/hooks/useWorkspaceContext'
import {
  ARTIST_NETWORK_CONTEXT_SLUG,
  NETWORK_CATEGORIES,
  artistNetworkMetadata,
  createNetworkPerson,
  parseArtistNetworkDoc,
  serializeArtistNetworkBody,
  type ArtistNetwork,
  type ArtistNetworkCategory,
  type ArtistNetworkPerson,
} from '@/lib/artist-network'

interface ArtistHQHomeProps {
  workspaceId: string
  workspaceName?: string
}

type ArtistHQTab = 'home' | 'calendar' | 'network' | 'research'

const projectColumns = [
  {
    id: 'focus',
    label: 'Focus',
    cards: [
      { title: 'Current Release', detail: 'Open the active campaign workspace', status: 'active' },
      { title: 'Spotify Pulse', detail: 'Connect analytics and review listener movement', status: 'waiting' },
    ],
  },
  {
    id: 'active',
    label: 'Active',
    cards: [
      { title: 'Content System', detail: 'Weekly clips and hooks', status: 'active' },
      { title: 'Audience Research', detail: 'Reference artists and cities', status: 'active' },
    ],
  },
  {
    id: 'waiting',
    label: 'Waiting',
    cards: [
      { title: 'Network Follow Ups', detail: 'People to touch this week', status: 'waiting' },
    ],
  },
  {
    id: 'upcoming',
    label: 'Upcoming',
    cards: [
      { title: 'Next Campaign', detail: 'Single, EP, album, or other release', status: 'planned' },
    ],
  },
]

export function ArtistHQHome({ workspaceId, workspaceName }: ArtistHQHomeProps) {
  const [tab, setTab] = React.useState<ArtistHQTab>('home')
  const [query, setQuery] = React.useState('')
  const [draftOpen, setDraftOpen] = React.useState(false)
  const [draft, setDraft] = React.useState({
    name: '',
    category: 'key' as ArtistNetworkCategory,
    role: '',
    contact: '',
    notes: '',
  })
  const { docs, loading, upsert } = useWorkspaceContext(workspaceId)
  const network = React.useMemo(
    () => parseArtistNetworkDoc(docs.find((doc) => doc.slug === ARTIST_NETWORK_CONTEXT_SLUG)),
    [docs],
  )
  const researchDocs = React.useMemo(
    () => docs.filter((doc) => /research|report|intel|analysis/i.test(`${doc.slug} ${doc.metadata.name} ${doc.metadata.description ?? ''}`)),
    [docs],
  )

  const saveNetwork = React.useCallback(
    async (nextNetwork: ArtistNetwork) => {
      await upsert({
        slug: ARTIST_NETWORK_CONTEXT_SLUG,
        metadata: artistNetworkMetadata(),
        body: serializeArtistNetworkBody(nextNetwork),
      })
    },
    [upsert],
  )

  const addPerson = React.useCallback(async () => {
    if (!draft.name.trim()) {
      toast.error('Add a name first.')
      return
    }
    const person = createNetworkPerson(draft)
    const nextNetwork: ArtistNetwork = {
      version: 1,
      people: [...network.people, person],
      updatedAt: new Date().toISOString(),
    }
    try {
      await saveNetwork(nextNetwork)
      setDraft({ name: '', category: 'key', role: '', contact: '', notes: '' })
      setDraftOpen(false)
      toast.success('Person added to Network')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    }
  }, [draft, network.people, saveNetwork])

  const filteredPeople = React.useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return network.people
    return network.people.filter((person) => [
      person.name,
      person.role,
      person.contact,
      person.location,
      person.canHelpWith,
      person.notes,
      ...person.tags,
    ].filter(Boolean).join(' ').toLowerCase().includes(needle))
  }, [network.people, query])

  const artistName = workspaceName || 'Artist HQ'
  const nextDate = 'This week'

  return (
    <div className="h-full overflow-y-auto bg-[#050505] text-foreground">
      <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-3 px-5 py-4 xl:px-8 xl:py-5">
        <section className="relative overflow-hidden rounded-[24px] border border-white/[0.05] bg-[#0A0A0A] p-6 lg:p-8">
          <div className="absolute -left-[18%] -top-[50%] h-[520px] w-[520px] rounded-full bg-orange-600/10 blur-[110px]" />
          <div className="absolute -bottom-[50%] -right-[12%] h-[520px] w-[520px] rounded-full bg-cyan-500/5 blur-[120px]" />
          <div className="relative z-10">
            <div className="flex items-start justify-between gap-4">
              <div className="inline-flex items-center gap-2 rounded-full border border-white/[0.05] bg-white/[0.02] px-3 py-1.5">
                <Sparkles className="h-3.5 w-3.5 text-orange-300/80" />
                <span className="text-[10px] font-medium uppercase tracking-[0.2em] text-white/65">Artist HQ</span>
              </div>
              <div className="text-right">
                <p className="text-[10px] font-medium uppercase tracking-[0.2em] text-white/35">Next</p>
                <p className="mt-1.5 text-xs font-medium text-white/70">{nextDate}</p>
              </div>
            </div>

            <div className="mt-8 max-w-3xl">
              <h1 className="text-4xl font-medium tracking-tighter text-white/90 sm:text-5xl lg:text-[56px] lg:leading-[0.96]">
                {artistName}
              </h1>
              <p className="mt-3 max-w-2xl text-sm font-light leading-relaxed text-white/50">
                Global career context, signals, calendar, network, and research. Campaign workspaces pull from here.
              </p>
            </div>

            <div className="mt-7 flex flex-wrap gap-2">
              {([
                ['home', 'HQ', BarChart3],
                ['calendar', 'Calendar', CalendarDays],
                ['network', 'Network', Users],
                ['research', 'Research', FileText],
              ] as const).map(([id, label, Icon]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setTab(id)}
                  className={cn(
                    'inline-flex h-8 items-center gap-2 rounded-full border px-3 text-xs font-medium transition-colors',
                    tab === id
                      ? 'border-[#fb923c]/28 bg-[#f97316]/14 text-white'
                      : 'border-white/[0.06] bg-white/[0.025] text-white/48 hover:bg-white/[0.05] hover:text-white/72',
                  )}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {label}
                </button>
              ))}
            </div>
          </div>
        </section>

        {tab === 'home' && (
          <>
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
              <HQCard className="lg:col-span-1">
                <SectionTitle icon={Music2} title="Spotify Pulse" meta="connect" />
                <div className="grid grid-cols-2 gap-2">
                  <Metric label="Monthly listeners" value="--" />
                  <Metric label="Followers" value="--" />
                  <Metric label="Top city" value="--" />
                  <Metric label="Playlist adds" value="--" />
                </div>
                <p className="mt-3 text-xs leading-5 text-white/38">Connect Spotify to turn this into the global audience signal.</p>
              </HQCard>

              <HQCard>
                <SectionTitle icon={CalendarDays} title="This Week" meta="calendar" />
                <TimelineItem time="Today" title="Review active campaign" />
                <TimelineItem time="Next" title="Plan content and outreach" />
                <TimelineItem time="Soon" title="Add key dates to Calendar" />
              </HQCard>

              <HQCard>
                <SectionTitle icon={Bot} title="Workers" meta="quiet" />
                <EmptyLine title="No active global workers" detail="Spotify sync, research monitors, and calendar jobs will appear here." />
              </HQCard>
            </div>

            <HQCard>
              <SectionTitle icon={FolderKanban} title="Projects" meta="global" />
              <ProjectBoard />
            </HQCard>
          </>
        )}

        {tab === 'calendar' && (
          <HQCard>
            <SectionTitle icon={CalendarDays} title="Calendar" meta="planning" />
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              {['Today', 'This Week', 'Upcoming'].map((column) => (
                <div key={column} className="rounded-[14px] border border-white/[0.05] bg-black/20 p-3">
                  <div className="text-[10px] font-semibold uppercase tracking-[0.15em] text-white/42">{column}</div>
                  <div className="mt-3 space-y-2">
                    <CalendarRow title={column === 'Today' ? 'Check campaign priority' : column === 'This Week' ? 'Content + outreach block' : 'Next release milestone'} />
                    <CalendarRow title={column === 'Today' ? 'Worker review window' : column === 'This Week' ? 'Research report review' : 'Calendar sync placeholder'} />
                  </div>
                </div>
              ))}
            </div>
          </HQCard>
        )}

        {tab === 'network' && (
          <HQCard>
            <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <SectionTitle icon={Users} title="Network" meta={`${network.people.length} people`} compact />
              <div className="flex items-center gap-2">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-white/28" />
                  <input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Search people..."
                    className="h-9 w-52 rounded-full border border-white/[0.06] bg-black/20 pl-8 pr-3 text-xs text-white/75 outline-none placeholder:text-white/28 focus:border-white/16"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => setDraftOpen((value) => !value)}
                  className="inline-flex h-9 items-center gap-2 rounded-full bg-white/90 px-4 text-xs font-medium text-black"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Add Person
                </button>
              </div>
            </div>

            {draftOpen && (
              <div className="mb-4 rounded-[16px] border border-white/[0.06] bg-white/[0.025] p-3">
                <div className="grid grid-cols-1 gap-2 md:grid-cols-5">
                  <Input value={draft.name} onChange={(name) => setDraft((value) => ({ ...value, name }))} placeholder="Name" />
                  <select
                    value={draft.category}
                    onChange={(event) => setDraft((value) => ({ ...value, category: event.target.value as ArtistNetworkCategory }))}
                    className="h-9 rounded-[10px] border border-white/[0.06] bg-black/30 px-3 text-xs text-white/75 outline-none"
                  >
                    {NETWORK_CATEGORIES.map((category) => <option key={category.id} value={category.id}>{category.label}</option>)}
                  </select>
                  <Input value={draft.role} onChange={(role) => setDraft((value) => ({ ...value, role }))} placeholder="Role" />
                  <Input value={draft.contact} onChange={(contact) => setDraft((value) => ({ ...value, contact }))} placeholder="Contact" />
                  <button type="button" onClick={addPerson} className="h-9 rounded-[10px] bg-[#f97316]/80 px-3 text-xs font-medium text-white hover:bg-[#f97316]">
                    Save
                  </button>
                </div>
                <textarea
                  value={draft.notes}
                  onChange={(event) => setDraft((value) => ({ ...value, notes: event.target.value }))}
                  placeholder="Notes, how they can help, last context..."
                  className="mt-2 min-h-[70px] w-full rounded-[10px] border border-white/[0.06] bg-black/25 px-3 py-2 text-xs leading-5 text-white/75 outline-none placeholder:text-white/28 focus:border-white/16"
                />
              </div>
            )}

            <NetworkBoard people={filteredPeople} />
          </HQCard>
        )}

        {tab === 'research' && (
          <HQCard>
            <SectionTitle icon={FileText} title="Research Reports" meta={loading ? 'loading' : `${researchDocs.length}`} />
            {researchDocs.length === 0 ? (
              <EmptyLine title="No research reports yet" detail="Research, Spotify analysis, YouTube intel, and trend reports will live here." />
            ) : (
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                {researchDocs.map((doc) => (
                  <div key={doc.slug} className="rounded-[14px] border border-white/[0.05] bg-black/20 p-3">
                    <div className="truncate text-sm font-medium text-white/78">{doc.metadata.name}</div>
                    <p className="mt-1 line-clamp-2 text-xs leading-5 text-white/40">{doc.metadata.description || doc.body}</p>
                  </div>
                ))}
              </div>
            )}
          </HQCard>
        )}
      </div>
    </div>
  )
}

function HQCard({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <section className={cn('rounded-2xl border border-white/[0.04] bg-[#0A0A0A] p-4 shadow-minimal', className)}>
      {children}
    </section>
  )
}

function SectionTitle({
  icon: Icon,
  title,
  meta,
  compact,
}: {
  icon: React.ComponentType<{ className?: string }>
  title: string
  meta?: string
  compact?: boolean
}) {
  return (
    <div className={cn('flex items-center justify-between gap-3', compact ? '' : 'mb-3 border-b border-white/[0.04] pb-2.5')}>
      <div className="flex items-center gap-2">
        <Icon className="h-3 w-3 text-white/40" />
        <h3 className="text-[9px] font-medium uppercase tracking-[0.15em] text-white/60">{title}</h3>
      </div>
      {meta ? <span className="text-[8px] font-medium uppercase tracking-widest text-white/30">{meta}</span> : null}
    </div>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[13px] border border-white/[0.045] bg-white/[0.018] p-3">
      <div className="text-[9px] font-medium uppercase tracking-[0.14em] text-white/32">{label}</div>
      <div className="mt-2 text-lg font-medium text-white/80">{value}</div>
    </div>
  )
}

function TimelineItem({ time, title }: { time: string; title: string }) {
  return (
    <div className="flex items-start gap-3 py-1.5">
      <div className="w-12 text-[10px] font-medium uppercase tracking-[0.12em] text-white/28">{time}</div>
      <Circle className="mt-1 h-2 w-2 fill-orange-400 text-orange-400" />
      <div className="text-sm font-medium text-white/72">{title}</div>
    </div>
  )
}

function CalendarRow({ title }: { title: string }) {
  return (
    <div className="rounded-[11px] border border-white/[0.045] bg-white/[0.018] px-3 py-2 text-xs font-medium text-white/64">
      {title}
    </div>
  )
}

function EmptyLine({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="rounded-[14px] border border-white/[0.045] bg-white/[0.016] p-4">
      <div className="flex items-start gap-3">
        <CheckCircle2 className="mt-0.5 h-4 w-4 text-white/30" />
        <div>
          <p className="text-sm font-medium text-white/72">{title}</p>
          <p className="mt-1 text-xs leading-5 text-white/38">{detail}</p>
        </div>
      </div>
    </div>
  )
}

function ProjectBoard() {
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
      {projectColumns.map((column) => (
        <div key={column.id} className="min-h-[210px] rounded-[14px] border border-white/[0.05] bg-black/20 p-3">
          <div className="mb-3 flex items-center justify-between">
            <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-white/42">{column.label}</div>
            <span className="text-[10px] text-white/28">{column.cards.length}</span>
          </div>
          <div className="space-y-2">
            {column.cards.map((card) => (
              <div key={card.title} className="rounded-[12px] border border-white/[0.055] bg-white/[0.025] p-3">
                <div className="text-sm font-semibold text-white/76">{card.title}</div>
                <div className="mt-1 line-clamp-2 text-xs leading-5 text-white/38">{card.detail}</div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

function NetworkBoard({ people }: { people: ArtistNetworkPerson[] }) {
  return (
    <div className="space-y-6">
      {NETWORK_CATEGORIES.map((category) => {
        const categoryPeople = people.filter((person) => person.category === category.id)
        if (categoryPeople.length === 0) return null
        return (
          <section key={category.id}>
            <div className="mb-3 flex items-center gap-3">
              <h3 className="text-[10px] font-semibold uppercase tracking-[0.16em] text-white/52">{category.label}</h3>
              <div className="h-px flex-1 bg-white/[0.06]" />
              <span className="text-[10px] text-white/28">{categoryPeople.length}</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {categoryPeople.map((person) => (
                <PersonPill key={person.id} person={person} />
              ))}
            </div>
          </section>
        )
      })}
      {people.length === 0 ? (
        <EmptyLine title="No people yet" detail="Add the real humans around the artist: DJs, producers, curators, collaborators, press, brands, and VIPs." />
      ) : null}
    </div>
  )
}

function PersonPill({ person }: { person: ArtistNetworkPerson }) {
  return (
    <div className="group min-w-[150px] rounded-[11px] border border-white/[0.07] bg-white/[0.025] px-3 py-2">
      <div className="truncate text-xs font-semibold text-white/78">{person.name}</div>
      {person.role || person.contact ? (
        <div className="mt-1 truncate text-[10.5px] text-white/36">{person.role || person.contact}</div>
      ) : null}
    </div>
  )
}

function Input({ value, onChange, placeholder }: { value: string; onChange: (value: string) => void; placeholder: string }) {
  return (
    <input
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      className="h-9 rounded-[10px] border border-white/[0.06] bg-black/25 px-3 text-xs text-white/75 outline-none placeholder:text-white/28 focus:border-white/16"
    />
  )
}
