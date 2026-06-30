import * as React from 'react'
import {
  BarChart3,
  Bot,
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Circle,
  ExternalLink,
  FileText,
  FolderKanban,
  Music2,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  Trash2,
  UserRound,
  Users,
  X,
} from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { navigate, routes } from '@/lib/navigate'
import { useOutputs, type OutputSummaryDTO } from '@/hooks/useOutputs'
import { useWorkspaceContext } from '@/hooks/useWorkspaceContext'
import { parseAutomationsConfig, type AutomationListItem } from '@/components/automations/types'
import {
  ARTIST_CALENDAR_CONTEXT_SLUG,
  artistCalendarMetadata,
  createCalendarEvent,
  parseArtistCalendarDocResult,
  serializeArtistCalendarBody,
  type ArtistCalendar,
  type ArtistCalendarEvent,
} from '@/lib/artist-calendar'
import {
  ARTIST_NETWORK_CONTEXT_SLUG,
  createNetworkCategory,
  artistNetworkMetadata,
  createNetworkPerson,
  parseArtistNetworkDocResult,
  serializeArtistNetworkBody,
  updateNetworkPerson,
  type ArtistNetwork,
  type ArtistNetworkCategory,
  type ArtistNetworkCategoryDefinition,
  type ArtistNetworkPerson,
} from '@/lib/artist-network'
import {
  ARTIST_PROFILE_CONTEXT_SLUG,
  artistProfileMetadata,
  parseArtistProfileDocResult,
  profileCompletion,
  serializeArtistProfileBody,
  type ArtistProfile,
} from '@/lib/artist-profile'
import {
  ARTIST_SPOTIFY_SNAPSHOT_CONTEXT_SLUG,
  parseArtistSpotifySnapshotDocResult,
} from '@/lib/artist-spotify'

interface ArtistHQHomeProps {
  workspaceId: string
  workspaceName?: string
}

type ArtistHQTab = 'home' | 'profile' | 'calendar' | 'network' | 'research'
type NetworkDraft = {
  name: string
  category: ArtistNetworkCategory
  role: string
  contact: string
  canHelpWith: string
  tags: string
  notes: string
}
type CalendarDraft = {
  title: string
  time: string
  notes: string
}
type ProfileDraft = Omit<ArtistProfile, 'version' | 'updatedAt'>

const HQ_HASH_PREFIX = '#artist-hq/'
const todayKey = toDateKey(new Date())
const SPOTIFY_SYNC_AUTOMATION_NAME = 'Weekly Spotify Snapshot'
const SPOTIFY_SYNC_CRON = '0 9 * * 1'
const emptyNetworkDraft: NetworkDraft = {
  name: '',
  category: 'key',
  role: '',
  contact: '',
  canHelpWith: '',
  tags: '',
  notes: '',
}
const emptyCalendarDraft: CalendarDraft = {
  title: '',
  time: '',
  notes: '',
}
const emptyProfileDraft: ProfileDraft = {
  artistName: '',
  aliases: '',
  bio: '',
  sound: '',
  visualWorld: '',
  brandWords: '',
  audience: '',
  similarArtists: '',
  priorityMarkets: '',
  socialLinks: '',
  spotifyProfile: '',
  team: '',
  promoBudget: '',
  rules: '',
}

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
  const [tab, setTab] = React.useState<ArtistHQTab>(() => readTabFromHash())
  const [query, setQuery] = React.useState('')
  const [draftOpen, setDraftOpen] = React.useState(false)
  const [categoryDraft, setCategoryDraft] = React.useState('')
  const [selectedPersonId, setSelectedPersonId] = React.useState<string | null>(null)
  const [selectedDate, setSelectedDate] = React.useState(todayKey)
  const [visibleMonth, setVisibleMonth] = React.useState(() => startOfMonth(new Date()))
  const [draft, setDraft] = React.useState<NetworkDraft>(emptyNetworkDraft)
  const [editDraft, setEditDraft] = React.useState<NetworkDraft>(emptyNetworkDraft)
  const [calendarDraft, setCalendarDraft] = React.useState<CalendarDraft>(emptyCalendarDraft)
  const [profileDraft, setProfileDraft] = React.useState<ProfileDraft>(emptyProfileDraft)
  const [spotifyAutomations, setSpotifyAutomations] = React.useState<AutomationListItem[]>([])
  const [spotifySyncBusy, setSpotifySyncBusy] = React.useState(false)
  const { docs, loading, upsert } = useWorkspaceContext(workspaceId)
  const { outputs, loading: outputsLoading } = useOutputs(workspaceId)
  const profileResult = React.useMemo(
    () => parseArtistProfileDocResult(docs.find((doc) => doc.slug === ARTIST_PROFILE_CONTEXT_SLUG)),
    [docs],
  )
  const profile = profileResult.profile
  const profilePercent = profileCompletion(profile)
  const spotifyResult = React.useMemo(
    () => parseArtistSpotifySnapshotDocResult(docs.find((doc) => doc.slug === ARTIST_SPOTIFY_SNAPSHOT_CONTEXT_SLUG)),
    [docs],
  )
  const spotifySnapshot = spotifyResult.ok ? spotifyResult.snapshot : null
  const spotifyIsPublicApi = spotifySnapshot?.dataSource === 'spotify-web-api'
  const spotifySyncAutomation = React.useMemo(
    () => spotifyAutomations.find(isSpotifySyncAutomation) ?? null,
    [spotifyAutomations],
  )
  const spotifySyncActive = Boolean(spotifySyncAutomation?.enabled)
  const calendarResult = React.useMemo(
    () => parseArtistCalendarDocResult(docs.find((doc) => doc.slug === ARTIST_CALENDAR_CONTEXT_SLUG)),
    [docs],
  )
  const calendar = calendarResult.calendar
  const networkResult = React.useMemo(
    () => parseArtistNetworkDocResult(docs.find((doc) => doc.slug === ARTIST_NETWORK_CONTEXT_SLUG)),
    [docs],
  )
  const network = networkResult.network
  const researchDocs = React.useMemo(
    () => docs.filter((doc) => /research|report|intel|analysis/i.test(`${doc.slug} ${doc.metadata.name} ${doc.metadata.description ?? ''}`)),
    [docs],
  )
  const researchOutputs = React.useMemo(
    () => outputs.filter(isResearchOutput),
    [outputs],
  )
  const selectedDateEvents = React.useMemo(
    () => calendar.events.filter((event) => event.date === selectedDate),
    [calendar.events, selectedDate],
  )
  const selectedPerson = React.useMemo(
    () => network.people.find((person) => person.id === selectedPersonId) ?? null,
    [network.people, selectedPersonId],
  )

  React.useEffect(() => {
    const onHashChange = () => setTab(readTabFromHash())
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

  React.useEffect(() => {
    if (!selectedPersonId) return
    if (!selectedPerson) setSelectedPersonId(null)
  }, [selectedPerson, selectedPersonId])

  React.useEffect(() => {
    setProfileDraft(profileToDraft(profile))
  }, [profile])

  const refreshSpotifyAutomations = React.useCallback(async () => {
    try {
      const json = await window.electronAPI.getAutomations(workspaceId)
      setSpotifyAutomations(json ? parseAutomationsConfig(json).filter(isSpotifySyncAutomation) : [])
    } catch {
      setSpotifyAutomations([])
    }
  }, [workspaceId])

  React.useEffect(() => {
    refreshSpotifyAutomations()
    const cleanup = window.electronAPI.onAutomationsChanged(() => {
      refreshSpotifyAutomations()
    })
    return () => cleanup()
  }, [refreshSpotifyAutomations])

  const saveNetwork = React.useCallback(
    async (nextNetwork: ArtistNetwork) => {
      if (!networkResult.ok) {
        throw new Error(`${networkResult.error} Open Workspace Context to recover it before saving.`)
      }
      await upsert({
        slug: ARTIST_NETWORK_CONTEXT_SLUG,
        metadata: artistNetworkMetadata(),
        body: serializeArtistNetworkBody(nextNetwork),
      })
    },
    [networkResult, upsert],
  )

  const saveCalendar = React.useCallback(
    async (nextCalendar: ArtistCalendar) => {
      if (!calendarResult.ok) {
        throw new Error(`${calendarResult.error} Open Workspace Context to recover it before saving.`)
      }
      await upsert({
        slug: ARTIST_CALENDAR_CONTEXT_SLUG,
        metadata: artistCalendarMetadata(),
        body: serializeArtistCalendarBody(nextCalendar),
      })
    },
    [calendarResult, upsert],
  )

  const saveProfile = React.useCallback(async () => {
    if (!profileResult.ok) {
      toast.error(`${profileResult.error} Open Workspace Context to recover it before saving.`)
      return
    }
    const nextProfile: ArtistProfile = {
      version: 1,
      ...profileDraft,
      updatedAt: new Date().toISOString(),
    }
    try {
      await upsert({
        slug: ARTIST_PROFILE_CONTEXT_SLUG,
        metadata: artistProfileMetadata(),
        body: serializeArtistProfileBody(nextProfile),
      })
      toast.success('Artist Profile saved')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    }
  }, [profileDraft, profileResult, upsert])

  const toggleSpotifySync = React.useCallback(async () => {
    setSpotifySyncBusy(true)
    try {
      if (spotifySyncAutomation) {
        await window.electronAPI.setAutomationEnabled(
          workspaceId,
          spotifySyncAutomation.event,
          spotifySyncAutomation.matcherIndex,
          !spotifySyncAutomation.enabled,
        )
        toast.success(spotifySyncAutomation.enabled ? 'Spotify sync paused' : 'Spotify sync enabled')
      } else {
        await window.electronAPI.createAutomationFromTemplate(
          workspaceId,
          'SchedulerTick',
          createSpotifySyncMatcher(),
        )
        toast.success('Weekly Spotify sync enabled')
      }
      await refreshSpotifyAutomations()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setSpotifySyncBusy(false)
    }
  }, [refreshSpotifyAutomations, spotifySyncAutomation, workspaceId])

  const addCalendarEvent = React.useCallback(async () => {
    if (!calendarDraft.title.trim()) {
      toast.error('Add an event title first.')
      return
    }
    const event = createCalendarEvent({
      date: selectedDate,
      title: calendarDraft.title,
      time: calendarDraft.time,
      notes: calendarDraft.notes,
    })
    const nextCalendar: ArtistCalendar = {
      version: 1,
      events: [...calendar.events, event],
      updatedAt: new Date().toISOString(),
    }
    try {
      await saveCalendar(nextCalendar)
      setCalendarDraft(emptyCalendarDraft)
      toast.success('Event added')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    }
  }, [calendar.events, calendarDraft, saveCalendar, selectedDate])

  const deleteCalendarEvent = React.useCallback(async (eventId: string) => {
    const nextCalendar: ArtistCalendar = {
      version: 1,
      events: calendar.events.filter((event) => event.id !== eventId),
      updatedAt: new Date().toISOString(),
    }
    try {
      await saveCalendar(nextCalendar)
      toast.success('Event removed')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    }
  }, [calendar.events, saveCalendar])

  const addPerson = React.useCallback(async () => {
    if (!draft.name.trim()) {
      toast.error('Add a name first.')
      return
    }
    const person = createNetworkPerson(draft)
    const nextNetwork: ArtistNetwork = {
      version: 1,
      categories: network.categories,
      people: [...network.people, person],
      updatedAt: new Date().toISOString(),
    }
    try {
      await saveNetwork(nextNetwork)
      setDraft(emptyNetworkDraft)
      setDraftOpen(false)
      toast.success('Person added to Network')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    }
  }, [draft, network.categories, network.people, saveNetwork])

  const addCategory = React.useCallback(async () => {
    if (!categoryDraft.trim()) {
      toast.error('Name the category first.')
      return
    }
    const nextCategory = createNetworkCategory(categoryDraft, network.categories)
    const nextNetwork: ArtistNetwork = {
      version: 1,
      categories: [...network.categories, nextCategory],
      people: network.people,
      updatedAt: new Date().toISOString(),
    }
    try {
      await saveNetwork(nextNetwork)
      setCategoryDraft('')
      setDraft((value) => ({ ...value, category: nextCategory.id }))
      toast.success('Category added')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    }
  }, [categoryDraft, network.categories, network.people, saveNetwork])

  const openPerson = React.useCallback((person: ArtistNetworkPerson) => {
    setSelectedPersonId(person.id)
    setEditDraft(personToDraft(person))
  }, [])

  const savePerson = React.useCallback(async () => {
    if (!selectedPerson) return
    if (!editDraft.name.trim()) {
      toast.error('Add a name first.')
      return
    }
    const nextNetwork: ArtistNetwork = {
      version: 1,
      categories: network.categories,
      people: network.people.map((person) =>
        person.id === selectedPerson.id ? updateNetworkPerson(person, editDraft) : person,
      ),
      updatedAt: new Date().toISOString(),
    }
    try {
      await saveNetwork(nextNetwork)
      toast.success('Person updated')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    }
  }, [editDraft, network.categories, network.people, saveNetwork, selectedPerson])

  const deletePerson = React.useCallback(async () => {
    if (!selectedPerson) return
    const nextNetwork: ArtistNetwork = {
      version: 1,
      categories: network.categories,
      people: network.people.filter((person) => person.id !== selectedPerson.id),
      updatedAt: new Date().toISOString(),
    }
    try {
      await saveNetwork(nextNetwork)
      setSelectedPersonId(null)
      toast.success('Person removed')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    }
  }, [network.categories, network.people, saveNetwork, selectedPerson])

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
                ['profile', 'Profile', UserRound],
                ['calendar', 'Calendar', CalendarDays],
                ['network', 'Network', Users],
                ['research', 'Research', FileText],
              ] as const).map(([id, label, Icon]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setTabHash(id)}
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
                <div className="mb-3 flex items-center justify-between gap-3 border-b border-white/[0.04] pb-2.5">
                  <div className="flex min-w-0 items-center gap-2">
                    <Music2 className="h-3 w-3 shrink-0 text-white/40" />
                    <h3 className="truncate text-[11px] font-semibold uppercase tracking-[0.16em] text-white/48">
                      Spotify Pulse
                    </h3>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="text-[10px] font-medium uppercase tracking-[0.12em] text-white/24">
                      {spotifySnapshot ? spotifySnapshot.snapshotDate : 'connect'}
                    </span>
                    <button
                      type="button"
                      onClick={toggleSpotifySync}
                      disabled={spotifySyncBusy}
                      title={spotifySyncActive ? 'Weekly Spotify sync active' : 'Enable weekly Spotify sync'}
                      className={cn(
                        'inline-flex h-6 w-6 items-center justify-center rounded-full border transition-colors',
                        spotifySyncActive
                          ? 'border-emerald-400/35 bg-emerald-500/12 text-emerald-300'
                          : 'border-white/[0.07] bg-white/[0.02] text-white/28 hover:text-white/60',
                        spotifySyncBusy && 'cursor-wait opacity-60',
                      )}
                      aria-label={spotifySyncActive ? 'Pause weekly Spotify sync' : 'Enable weekly Spotify sync'}
                    >
                      <RefreshCw className={cn('h-3.5 w-3.5', spotifySyncBusy && 'animate-spin')} />
                    </button>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <Metric
                    label={spotifyIsPublicApi ? 'Popularity' : 'Streams'}
                    value={spotifyIsPublicApi ? formatMetric(spotifySnapshot?.metrics.popularity) : formatMetric(spotifySnapshot?.metrics.streams)}
                  />
                  <Metric
                    label={spotifyIsPublicApi ? 'Top track' : 'Listeners'}
                    value={spotifyIsPublicApi ? spotifySnapshot?.tracks?.[0]?.name ?? '--' : formatMetric(spotifySnapshot?.metrics.listeners)}
                  />
                  <Metric label="Followers" value={formatMetric(spotifySnapshot?.metrics.followers)} />
                  <Metric
                    label={spotifyIsPublicApi ? 'Genres' : 'Top city'}
                    value={spotifyIsPublicApi ? spotifySnapshot?.artist.genres?.[0] ?? '--' : spotifySnapshot?.geo?.topCities?.[0]?.city ?? '--'}
                  />
                </div>
                <p className="mt-3 text-xs leading-5 text-white/38">
                  {spotifySnapshot
                    ? spotifyIsPublicApi
                      ? 'Latest public Spotify API snapshot. Streams and listeners require Spotify for Artists access.'
                      : `Latest ${spotifySnapshot.windowDays}-day Spotify for Artists snapshot.`
                    : 'Run Spotify Analyst to create the first snapshot.'}
                </p>
                <p className="mt-2 text-[10px] font-medium uppercase tracking-[0.12em] text-white/25">
                  {spotifySyncActive ? 'Weekly sync active' : 'Weekly sync off'}
                </p>
                {!spotifyResult.ok ? (
                  <p className="mt-2 text-xs leading-5 text-red-100/65">{spotifyResult.error}</p>
                ) : null}
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

        {tab === 'profile' && (
          <HQCard>
            <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
              <div>
                <SectionTitle icon={UserRound} title="Artist Profile" meta={`${profilePercent}% complete`} compact />
                <p className="mt-2 max-w-2xl text-xs leading-5 text-white/42">
                  Global context every worker should know before touching campaigns, content, research, ads, or outreach.
                </p>
              </div>
              <button
                type="button"
                onClick={saveProfile}
                disabled={!profileResult.ok}
                className="h-9 rounded-full bg-white/90 px-5 text-xs font-semibold text-black hover:bg-white disabled:cursor-not-allowed disabled:opacity-40"
              >
                Save Profile
              </button>
            </div>

            {!profileResult.ok ? (
              <div className="mb-4 rounded-[14px] border border-red-400/20 bg-red-500/10 p-3 text-xs leading-5 text-red-100/80">
                {profileResult.error} Saving is paused so existing artist context is not overwritten.
              </div>
            ) : null}

            <ArtistProfileForm draft={profileDraft} onChange={setProfileDraft} />
          </HQCard>
        )}

        {tab === 'calendar' && (
          <HQCard>
            <SectionTitle icon={CalendarDays} title="Calendar" meta={`${calendar.events.length} events`} />
            {!calendarResult.ok ? (
              <div className="mb-4 rounded-[14px] border border-red-400/20 bg-red-500/10 p-3 text-xs leading-5 text-red-100/80">
                {calendarResult.error} Saving is paused so existing calendar context is not overwritten.
              </div>
            ) : null}
            <ArtistCalendarView
              events={calendar.events}
              selectedDate={selectedDate}
              visibleMonth={visibleMonth}
              draft={calendarDraft}
              disabled={!calendarResult.ok}
              onSelectDate={setSelectedDate}
              onChangeMonth={setVisibleMonth}
              onChangeDraft={setCalendarDraft}
              onAddEvent={addCalendarEvent}
              onDeleteEvent={deleteCalendarEvent}
              selectedDateEvents={selectedDateEvents}
            />
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

            <div className="mb-4 flex flex-col gap-2 rounded-[14px] border border-white/[0.05] bg-black/20 p-3 sm:flex-row sm:items-center">
              <Input value={categoryDraft} onChange={setCategoryDraft} placeholder="New category name" />
              <button
                type="button"
                onClick={addCategory}
                disabled={!networkResult.ok}
                className="h-9 shrink-0 rounded-[10px] border border-white/[0.08] px-3 text-xs font-medium text-white/65 hover:bg-white/[0.04] disabled:cursor-not-allowed disabled:opacity-40"
              >
                Add Category
              </button>
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
                    {network.categories.map((category) => <option key={category.id} value={category.id}>{category.label}</option>)}
                  </select>
                  <Input value={draft.role} onChange={(role) => setDraft((value) => ({ ...value, role }))} placeholder="Role" />
                  <Input value={draft.contact} onChange={(contact) => setDraft((value) => ({ ...value, contact }))} placeholder="Contact" />
                  <button type="button" onClick={addPerson} disabled={!networkResult.ok} className="h-9 rounded-[10px] bg-[#f97316]/80 px-3 text-xs font-medium text-white hover:bg-[#f97316] disabled:cursor-not-allowed disabled:opacity-40">
                    Save
                  </button>
                </div>
                <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-2">
                  <Input value={draft.canHelpWith} onChange={(canHelpWith) => setDraft((value) => ({ ...value, canHelpWith }))} placeholder="Can help with" />
                  <Input value={draft.tags} onChange={(tags) => setDraft((value) => ({ ...value, tags }))} placeholder="Tags, comma separated" />
                </div>
                <textarea
                  value={draft.notes}
                  onChange={(event) => setDraft((value) => ({ ...value, notes: event.target.value }))}
                  placeholder="Notes, how they can help, last context..."
                  className="mt-2 min-h-[70px] w-full rounded-[10px] border border-white/[0.06] bg-black/25 px-3 py-2 text-xs leading-5 text-white/75 outline-none placeholder:text-white/28 focus:border-white/16"
                />
              </div>
            )}

            {!networkResult.ok ? (
              <div className="mb-4 rounded-[14px] border border-red-400/20 bg-red-500/10 p-3 text-xs leading-5 text-red-100/80">
                {networkResult.error} Saving is paused so existing relationship context is not overwritten.
              </div>
            ) : null}

            <NetworkBoard categories={network.categories} people={filteredPeople} onSelectPerson={openPerson} />
          </HQCard>
        )}

        {tab === 'research' && (
          <HQCard>
            <SectionTitle icon={FileText} title="Research Reports" meta={loading || outputsLoading ? 'loading' : `${researchDocs.length + researchOutputs.length}`} />
            {researchDocs.length === 0 && researchOutputs.length === 0 ? (
              <EmptyLine title="No research reports yet" detail="Research, Spotify analysis, YouTube intel, and trend reports will live here." />
            ) : (
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                {researchOutputs.map((output) => (
                  <button
                    key={output.id}
                    type="button"
                    onClick={() => navigate(routes.view.output(output.id))}
                    className="rounded-[14px] border border-white/[0.05] bg-black/20 p-3 text-left transition-colors hover:bg-white/[0.035]"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="truncate text-sm font-medium text-white/78">{output.title}</div>
                      <ExternalLink className="h-3.5 w-3.5 shrink-0 text-white/24" />
                    </div>
                    <p className="mt-1 line-clamp-2 text-xs leading-5 text-white/40">{output.summary || output.origin?.agentName || output.kind}</p>
                  </button>
                ))}
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
      {selectedPerson ? (
        <PersonDetailPanel
          person={selectedPerson}
          draft={editDraft}
          categories={network.categories}
          onChange={setEditDraft}
          onClose={() => setSelectedPersonId(null)}
          onSave={savePerson}
          onDelete={deletePerson}
          disabled={!networkResult.ok}
        />
      ) : null}
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
      <div title={value} className="mt-2 truncate text-lg font-medium text-white/80">{value}</div>
    </div>
  )
}

function formatMetric(value: number | undefined): string {
  if (typeof value !== 'number') return '--'
  return new Intl.NumberFormat('en-US', { notation: value >= 10000 ? 'compact' : 'standard' }).format(value)
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

function ArtistProfileForm({
  draft,
  onChange,
}: {
  draft: ProfileDraft
  onChange: (draft: ProfileDraft) => void
}) {
  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
      <ProfileField label="Artist name">
        <Input value={draft.artistName ?? ''} onChange={(artistName) => onChange({ ...draft, artistName })} placeholder="Name fans know" />
      </ProfileField>
      <ProfileField label="Aliases">
        <Input value={draft.aliases ?? ''} onChange={(aliases) => onChange({ ...draft, aliases })} placeholder="Other names, projects, handles" />
      </ProfileField>
      <ProfileField label="Spotify profile">
        <Input value={draft.spotifyProfile ?? ''} onChange={(spotifyProfile) => onChange({ ...draft, spotifyProfile })} placeholder="Spotify URL or artist ID" />
      </ProfileField>
      <ProfileField label="Promo budget">
        <Input value={draft.promoBudget ?? ''} onChange={(promoBudget) => onChange({ ...draft, promoBudget })} placeholder="$500, $2k/month, flexible..." />
      </ProfileField>
      <ProfileField label="Bio / story" wide>
        <TextArea value={draft.bio ?? ''} onChange={(bio) => onChange({ ...draft, bio })} placeholder="What is the artist story? What should workers never miss?" />
      </ProfileField>
      <ProfileField label="Sound">
        <TextArea value={draft.sound ?? ''} onChange={(sound) => onChange({ ...draft, sound })} placeholder="Genre, texture, voice, production, emotional lane" />
      </ProfileField>
      <ProfileField label="Visual world">
        <TextArea value={draft.visualWorld ?? ''} onChange={(visualWorld) => onChange({ ...draft, visualWorld })} placeholder="Colors, references, imagery, camera style, aesthetic rules" />
      </ProfileField>
      <ProfileField label="Brand words">
        <TextArea value={draft.brandWords ?? ''} onChange={(brandWords) => onChange({ ...draft, brandWords })} placeholder="Words the artist should feel like. Words to avoid." />
      </ProfileField>
      <ProfileField label="Audience">
        <TextArea value={draft.audience ?? ''} onChange={(audience) => onChange({ ...draft, audience })} placeholder="Who listens, why they care, what they are living through" />
      </ProfileField>
      <ProfileField label="Similar artists">
        <TextArea value={draft.similarArtists ?? ''} onChange={(similarArtists) => onChange({ ...draft, similarArtists })} placeholder="Reference artists, songs, scenes, labels" />
      </ProfileField>
      <ProfileField label="Priority markets">
        <TextArea value={draft.priorityMarkets ?? ''} onChange={(priorityMarkets) => onChange({ ...draft, priorityMarkets })} placeholder="Cities, countries, platforms, demographics" />
      </ProfileField>
      <ProfileField label="Social links">
        <TextArea value={draft.socialLinks ?? ''} onChange={(socialLinks) => onChange({ ...draft, socialLinks })} placeholder="Instagram, TikTok, YouTube, website, email list" />
      </ProfileField>
      <ProfileField label="Team">
        <TextArea value={draft.team ?? ''} onChange={(team) => onChange({ ...draft, team })} placeholder="Manager, producer, designer, label, collaborators" />
      </ProfileField>
      <ProfileField label="Rules / preferences">
        <TextArea value={draft.rules ?? ''} onChange={(rules) => onChange({ ...draft, rules })} placeholder="Hard no's, tone rules, approval preferences, tools to use or avoid" />
      </ProfileField>
    </div>
  )
}

function ProfileField({
  label,
  wide,
  children,
}: {
  label: string
  wide?: boolean
  children: React.ReactNode
}) {
  return (
    <label className={cn('block rounded-[14px] border border-white/[0.05] bg-black/20 p-3', wide && 'lg:col-span-2')}>
      <span className="mb-2 block text-[10px] font-semibold uppercase tracking-[0.16em] text-white/35">{label}</span>
      {children}
    </label>
  )
}

function ArtistCalendarView({
  events,
  selectedDate,
  visibleMonth,
  draft,
  disabled,
  selectedDateEvents,
  onSelectDate,
  onChangeMonth,
  onChangeDraft,
  onAddEvent,
  onDeleteEvent,
}: {
  events: ArtistCalendarEvent[]
  selectedDate: string
  visibleMonth: Date
  draft: CalendarDraft
  disabled?: boolean
  selectedDateEvents: ArtistCalendarEvent[]
  onSelectDate: (date: string) => void
  onChangeMonth: (month: Date) => void
  onChangeDraft: (draft: CalendarDraft) => void
  onAddEvent: () => void
  onDeleteEvent: (eventId: string) => void
}) {
  const days = React.useMemo(() => buildMonthDays(visibleMonth), [visibleMonth])
  const eventCounts = React.useMemo(() => {
    const counts = new Map<string, number>()
    for (const event of events) {
      counts.set(event.date, (counts.get(event.date) ?? 0) + 1)
    }
    return counts
  }, [events])
  const monthLabel = visibleMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
  const selectedLabel = parseDateKey(selectedDate).toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  })

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
      <div className="rounded-[16px] border border-white/[0.05] bg-black/20 p-3">
        <div className="mb-3 flex items-center justify-between">
          <button
            type="button"
            onClick={() => onChangeMonth(addMonths(visibleMonth, -1))}
            className="rounded-full border border-white/[0.06] p-2 text-white/45 hover:bg-white/[0.04] hover:text-white/75"
            aria-label="Previous month"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <div className="text-sm font-semibold text-white/78">{monthLabel}</div>
          <button
            type="button"
            onClick={() => onChangeMonth(addMonths(visibleMonth, 1))}
            className="rounded-full border border-white/[0.06] p-2 text-white/45 hover:bg-white/[0.04] hover:text-white/75"
            aria-label="Next month"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
        <div className="grid grid-cols-7 gap-1">
          {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => (
            <div key={day} className="py-2 text-center text-[9px] font-semibold uppercase tracking-[0.14em] text-white/28">
              {day}
            </div>
          ))}
          {days.map((day) => {
            const key = toDateKey(day)
            const isSelected = key === selectedDate
            const isToday = key === todayKey
            const isCurrentMonth = day.getMonth() === visibleMonth.getMonth()
            const count = eventCounts.get(key) ?? 0
            return (
              <button
                key={key}
                type="button"
                onClick={() => onSelectDate(key)}
                className={cn(
                  'min-h-[72px] rounded-[12px] border p-2 text-left transition-colors',
                  isSelected
                    ? 'border-orange-400/40 bg-orange-500/12'
                    : 'border-white/[0.045] bg-white/[0.015] hover:bg-white/[0.035]',
                  !isCurrentMonth && 'opacity-35',
                )}
              >
                <div className="flex items-center justify-between">
                  <span className={cn('text-xs font-medium', isToday ? 'text-orange-200' : 'text-white/65')}>
                    {day.getDate()}
                  </span>
                  {count > 0 ? <span className="rounded-full bg-white/10 px-1.5 py-0.5 text-[9px] text-white/55">{count}</span> : null}
                </div>
                {count > 0 ? <div className="mt-5 h-1.5 w-1.5 rounded-full bg-orange-400/80" /> : null}
              </button>
            )
          })}
        </div>
      </div>

      <div className="rounded-[16px] border border-white/[0.05] bg-black/20 p-3">
        <div className="mb-3">
          <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-white/35">Selected Date</div>
          <div className="mt-1 text-base font-semibold text-white/80">{selectedLabel}</div>
        </div>

        <div className="space-y-2">
          {selectedDateEvents.length === 0 ? (
            <div className="rounded-[12px] border border-white/[0.045] bg-white/[0.016] p-3 text-xs text-white/36">
              No events yet.
            </div>
          ) : selectedDateEvents.map((event) => (
            <div key={event.id} className="rounded-[12px] border border-white/[0.055] bg-white/[0.025] p-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-white/76">{event.title}</div>
                  {event.time ? <div className="mt-1 text-[10px] font-medium uppercase tracking-[0.12em] text-orange-200/65">{event.time}</div> : null}
                  {event.notes ? <div className="mt-2 text-xs leading-5 text-white/38">{event.notes}</div> : null}
                </div>
                <button
                  type="button"
                  onClick={() => onDeleteEvent(event.id)}
                  disabled={disabled}
                  className="rounded-full p-1.5 text-white/28 hover:bg-white/[0.05] hover:text-red-200 disabled:cursor-not-allowed disabled:opacity-40"
                  aria-label="Delete event"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-4 rounded-[14px] border border-white/[0.05] bg-white/[0.018] p-3">
          <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-white/35">Add Event</div>
          <div className="grid grid-cols-1 gap-2">
            <Input value={draft.title} onChange={(title) => onChangeDraft({ ...draft, title })} placeholder="Title" />
            <Input value={draft.time} onChange={(time) => onChangeDraft({ ...draft, time })} placeholder="Time, optional" />
            <textarea
              value={draft.notes}
              onChange={(event) => onChangeDraft({ ...draft, notes: event.target.value })}
              placeholder="Notes, optional"
              className="min-h-[74px] w-full rounded-[10px] border border-white/[0.06] bg-black/25 px-3 py-2 text-xs leading-5 text-white/75 outline-none placeholder:text-white/28 focus:border-white/16"
            />
            <button
              type="button"
              onClick={onAddEvent}
              disabled={disabled}
              className="h-9 rounded-full bg-white/90 px-4 text-xs font-semibold text-black hover:bg-white disabled:cursor-not-allowed disabled:opacity-40"
            >
              Add Event
            </button>
          </div>
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

function NetworkBoard({
  categories,
  people,
  onSelectPerson,
}: {
  categories: ArtistNetworkCategoryDefinition[]
  people: ArtistNetworkPerson[]
  onSelectPerson: (person: ArtistNetworkPerson) => void
}) {
  return (
    <div className="space-y-6">
      {categories.map((category) => {
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
                <PersonPill key={person.id} person={person} onClick={() => onSelectPerson(person)} />
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

function PersonPill({ person, onClick }: { person: ArtistNetworkPerson; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="group min-w-[150px] rounded-[11px] border border-white/[0.07] bg-white/[0.025] px-3 py-2 text-left transition-colors hover:bg-white/[0.045]">
      <div className="truncate text-xs font-semibold text-white/78">{person.name}</div>
      {person.role || person.contact ? (
        <div className="mt-1 truncate text-[10.5px] text-white/36">{person.role || person.contact}</div>
      ) : null}
    </button>
  )
}

function PersonDetailPanel({
  person,
  draft,
  categories,
  onChange,
  onClose,
  onSave,
  onDelete,
  disabled,
}: {
  person: ArtistNetworkPerson
  draft: NetworkDraft
  categories: ArtistNetworkCategoryDefinition[]
  onChange: (draft: NetworkDraft) => void
  onClose: () => void
  onSave: () => void
  onDelete: () => void
  disabled?: boolean
}) {
  return (
    <div className="fixed inset-y-0 right-0 z-50 flex w-full max-w-[420px] flex-col border-l border-white/[0.08] bg-[#080808]/95 p-4 shadow-2xl backdrop-blur-xl">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-white/35">Network</p>
          <h2 className="mt-1 text-xl font-semibold text-white/86">{person.name}</h2>
        </div>
        <button type="button" onClick={onClose} className="rounded-full border border-white/[0.08] p-2 text-white/45 hover:bg-white/[0.04] hover:text-white/70">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="grid grid-cols-1 gap-2">
        <Input value={draft.name} onChange={(name) => onChange({ ...draft, name })} placeholder="Name" />
        <select
          value={draft.category}
          onChange={(event) => onChange({ ...draft, category: event.target.value as ArtistNetworkCategory })}
          className="h-9 rounded-[10px] border border-white/[0.06] bg-black/30 px-3 text-xs text-white/75 outline-none"
        >
          {categories.map((category) => <option key={category.id} value={category.id}>{category.label}</option>)}
        </select>
        <Input value={draft.role} onChange={(role) => onChange({ ...draft, role })} placeholder="Role" />
        <Input value={draft.contact} onChange={(contact) => onChange({ ...draft, contact })} placeholder="Contact" />
        <Input value={draft.canHelpWith} onChange={(canHelpWith) => onChange({ ...draft, canHelpWith })} placeholder="Can help with" />
        <Input value={draft.tags} onChange={(tags) => onChange({ ...draft, tags })} placeholder="Tags, comma separated" />
        <textarea
          value={draft.notes}
          onChange={(event) => onChange({ ...draft, notes: event.target.value })}
          placeholder="Notes, context, recent history..."
          className="min-h-[120px] w-full rounded-[10px] border border-white/[0.06] bg-black/25 px-3 py-2 text-xs leading-5 text-white/75 outline-none placeholder:text-white/28 focus:border-white/16"
        />
      </div>

      <div className="mt-auto flex items-center justify-between gap-3 pt-4">
        <button type="button" onClick={onDelete} disabled={disabled} className="inline-flex h-9 items-center gap-2 rounded-full border border-red-300/15 px-4 text-xs font-medium text-red-100/70 hover:bg-red-500/10 disabled:cursor-not-allowed disabled:opacity-40">
          <Trash2 className="h-3.5 w-3.5" />
          Delete
        </button>
        <button type="button" onClick={onSave} disabled={disabled} className="h-9 rounded-full bg-white/90 px-5 text-xs font-semibold text-black hover:bg-white disabled:cursor-not-allowed disabled:opacity-40">
          Save Changes
        </button>
      </div>
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

function TextArea({ value, onChange, placeholder }: { value: string; onChange: (value: string) => void; placeholder: string }) {
  return (
    <textarea
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      className="min-h-[96px] w-full rounded-[10px] border border-white/[0.06] bg-black/25 px-3 py-2 text-xs leading-5 text-white/75 outline-none placeholder:text-white/28 focus:border-white/16"
    />
  )
}

function personToDraft(person: ArtistNetworkPerson): NetworkDraft {
  return {
    name: person.name,
    category: person.category,
    role: person.role ?? '',
    contact: person.contact ?? '',
    canHelpWith: person.canHelpWith ?? '',
    tags: person.tags.join(', '),
    notes: person.notes ?? '',
  }
}

function profileToDraft(profile: ArtistProfile): ProfileDraft {
  return {
    artistName: profile.artistName ?? '',
    aliases: profile.aliases ?? '',
    bio: profile.bio ?? '',
    sound: profile.sound ?? '',
    visualWorld: profile.visualWorld ?? '',
    brandWords: profile.brandWords ?? '',
    audience: profile.audience ?? '',
    similarArtists: profile.similarArtists ?? '',
    priorityMarkets: profile.priorityMarkets ?? '',
    socialLinks: profile.socialLinks ?? '',
    spotifyProfile: profile.spotifyProfile ?? '',
    team: profile.team ?? '',
    promoBudget: profile.promoBudget ?? '',
    rules: profile.rules ?? '',
  }
}

function isResearchOutput(output: OutputSummaryDTO): boolean {
  const text = `${output.title} ${output.summary ?? ''} ${output.kind} ${(output.tags ?? []).join(' ')} ${output.origin?.agentName ?? ''}`.toLowerCase()
  return output.kind === 'report'
    || output.origin?.source === 'deep-research'
    || /\b(research|report|intel|analysis|spotify|youtube|trend)\b/.test(text)
}

function createSpotifySyncMatcher(): Record<string, unknown> {
  return {
    name: SPOTIFY_SYNC_AUTOMATION_NAME,
    cron: SPOTIFY_SYNC_CRON,
    timezone: getLocalTimezone(),
    permissionMode: 'ask',
    labels: ['spotify', 'artist-hq', 'scheduled'],
    actions: [
      {
        type: 'prompt',
        agentSlug: 'spotify-analyst',
        prompt: `Run the weekly Spotify snapshot for this Artist HQ workspace.

Use Artist Profile first for the Spotify artist URL or ID. If SPOTIFY_CLIENT_ID or SPOTIFY_CLIENT_SECRET is missing, stop and say to add them in Settings > Secrets > Spotify.

Run:
bun "$CRAFT_APP_ROOT/packages/shared/src/skills/bundled/spotify-analytics-snapshot/scripts/api-snapshot.ts" --workspace "$CRAFT_WORKSPACE_PATH"

This writes data/spotify/snapshots/<date>-web-api.json and updates Artist HQ workspace context slug ${ARTIST_SPOTIFY_SNAPSHOT_CONTEXT_SLUG} so Spotify Pulse turns current.

Keep the final note short: snapshot date, key movement, any missing setup.`,
      },
    ],
  }
}

function isSpotifySyncAutomation(automation: AutomationListItem): boolean {
  if (automation.event !== 'SchedulerTick') return false
  if (automation.name === SPOTIFY_SYNC_AUTOMATION_NAME) return true
  return automation.actions.some((action) => (
    action.type === 'prompt'
    && action.agentSlug === 'spotify-analyst'
    && /artist-spotify-snapshot|weekly spotify/i.test(action.prompt)
  ))
}

function getLocalTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Chicago'
  } catch {
    return 'America/Chicago'
  }
}

function readTabFromHash(): ArtistHQTab {
  const raw = window.location.hash.startsWith(HQ_HASH_PREFIX)
    ? window.location.hash.slice(HQ_HASH_PREFIX.length)
    : ''
  return isArtistHQTab(raw) ? raw : 'home'
}

function setTabHash(tab: ArtistHQTab): void {
  const nextHash = `${HQ_HASH_PREFIX}${tab}`
  if (window.location.hash === nextHash) return
  window.location.hash = nextHash
}

function isArtistHQTab(value: string): value is ArtistHQTab {
  return value === 'home' || value === 'profile' || value === 'calendar' || value === 'network' || value === 'research'
}

function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1)
}

function addMonths(date: Date, months: number): Date {
  return new Date(date.getFullYear(), date.getMonth() + months, 1)
}

function buildMonthDays(month: Date): Date[] {
  const first = startOfMonth(month)
  const start = new Date(first)
  start.setDate(first.getDate() - first.getDay())
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(start)
    date.setDate(start.getDate() + index)
    return date
  })
}

function toDateKey(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function parseDateKey(key: string): Date {
  const [year, month, day] = key.split('-').map(Number)
  return new Date(year || new Date().getFullYear(), (month || 1) - 1, day || 1)
}
