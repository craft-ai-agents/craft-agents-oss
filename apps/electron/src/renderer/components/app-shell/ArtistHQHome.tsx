import * as React from 'react'
import {
  Bot,
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Circle,
  ExternalLink,
  FileText,
  FolderKanban,
  MessageSquareText,
  Music2,
  Plus,
  RefreshCw,
  Radio,
  Search,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  UserRound,
  Users,
  X,
} from 'lucide-react'
import { useAtomValue } from 'jotai'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { navigate, routes } from '@/lib/navigate'
import { useAppShellContext } from '@/context/AppShellContext'
import { useAgents } from '@/hooks/useAgents'
import { useOutputs, type OutputSummaryDTO } from '@/hooks/useOutputs'
import { useWorkspaceContext } from '@/hooks/useWorkspaceContext'
import { skillsAtom } from '@/atoms/skills'
import { sourcesAtom } from '@/atoms/sources'
import { openAgentSessionComposer } from '@/lib/run-agent'
import { parseAutomationsConfig, type AutomationListItem } from '@/components/automations/types'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
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
  ARTIST_VOICE_CONTEXT_SLUG,
  artistVoiceMetadata,
  parseArtistVoiceDocResult,
  serializeArtistVoiceBody,
  voiceCompletion,
  type ArtistVoice,
} from '@/lib/artist-voice'
import {
  ARTIST_SPOTIFY_SNAPSHOT_CONTEXT_SLUG,
  parseArtistSpotifySnapshotDocResult,
} from '@/lib/artist-spotify'
import {
  ARTIST_INTEL_CONFIG_CONTEXT_SLUG,
  ARTIST_INTEL_REPORT_CONTEXT_SLUG,
  artistIntelConfigMetadata,
  artistIntelReportMetadata,
  createQueuedIntelRun,
  createIntelRunPrompt,
  createScheduledIntelRunPrompt,
  isValidYouTubeChannelUrl,
  parseArtistIntelConfigDocResult,
  parseArtistIntelReportDocResult,
  serializeArtistIntelConfigBody,
  serializeArtistIntelReportBody,
  type ArtistIntelConfig,
  type ArtistIntelSource,
} from '@/lib/artist-intel'

interface ArtistHQHomeProps {
  workspaceId: string
  workspaceName?: string
}

type ArtistHQTab = 'home' | 'profile' | 'voice' | 'calendar' | 'network' | 'research' | 'workers' | 'branding'
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
type VoiceDraft = Omit<ArtistVoice, 'version' | 'updatedAt'>

const HQ_HASH_PREFIX = '#artist-hq/'
const todayKey = toDateKey(new Date())
const SPOTIFY_SYNC_AUTOMATION_NAME = 'Weekly Spotify Snapshot'
const SPOTIFY_SYNC_CRON = '0 9 * * 1'
const INTEL_SYNC_AUTOMATION_NAME = 'Weekly YouTube Intel Pulse'
const INTEL_SYNC_CRON = '0 10 * * 1'
const YOUTUBE_RESEARCH_AGENT_SLUG = 'youtube-research-agent'
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
  themes: '',
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
const emptyVoiceDraft: VoiceDraft = {
  summary: '',
  speakingStyle: '',
  vocabulary: '',
  avoid: '',
  captionExamples: '',
  postExamples: '',
  writingExcerpts: '',
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
  const {
    activeAgents: shellActiveAgents = [],
    onCreateSession,
    onInputChange,
    onSendMessage,
  } = useAppShellContext()
  const { activeAgents: workspaceActiveAgents, allAgents } = useAgents(workspaceId)
  const skills = useAtomValue(skillsAtom)
  const sources = useAtomValue(sourcesAtom)
  const [tab, setTab] = React.useState<ArtistHQTab>(() => readTabFromHash())
  const [query, setQuery] = React.useState('')
  const [draftOpen, setDraftOpen] = React.useState(false)
  const [intelConfigOpen, setIntelConfigOpen] = React.useState(false)
  const [intelBusy, setIntelBusy] = React.useState(false)
  const [categoryDraft, setCategoryDraft] = React.useState('')
  const [selectedPersonId, setSelectedPersonId] = React.useState<string | null>(null)
  const [selectedDate, setSelectedDate] = React.useState(todayKey)
  const [visibleMonth, setVisibleMonth] = React.useState(() => startOfMonth(new Date()))
  const [draft, setDraft] = React.useState<NetworkDraft>(emptyNetworkDraft)
  const [editDraft, setEditDraft] = React.useState<NetworkDraft>(emptyNetworkDraft)
  const [calendarDraft, setCalendarDraft] = React.useState<CalendarDraft>(emptyCalendarDraft)
  const [profileDraft, setProfileDraft] = React.useState<ProfileDraft>(emptyProfileDraft)
  const [voiceDraft, setVoiceDraft] = React.useState<VoiceDraft>(emptyVoiceDraft)
  const [automations, setAutomations] = React.useState<AutomationListItem[]>([])
  const [spotifySyncBusy, setSpotifySyncBusy] = React.useState(false)
  const { docs, loading, upsert, refresh: refreshContext } = useWorkspaceContext(workspaceId)
  const { outputs, loading: outputsLoading } = useOutputs(workspaceId)
  const profileResult = React.useMemo(
    () => parseArtistProfileDocResult(docs.find((doc) => doc.slug === ARTIST_PROFILE_CONTEXT_SLUG)),
    [docs],
  )
  const profile = profileResult.profile
  const profilePercent = profileCompletion(profile)
  const voiceResult = React.useMemo(
    () => parseArtistVoiceDocResult(docs.find((doc) => doc.slug === ARTIST_VOICE_CONTEXT_SLUG)),
    [docs],
  )
  const voice = voiceResult.voice
  const voicePercent = voiceCompletion(voice)
  const spotifyResult = React.useMemo(
    () => parseArtistSpotifySnapshotDocResult(docs.find((doc) => doc.slug === ARTIST_SPOTIFY_SNAPSHOT_CONTEXT_SLUG)),
    [docs],
  )
  const spotifySnapshot = spotifyResult.ok ? spotifyResult.snapshot : null
  const spotifyIsPublicApi = spotifySnapshot?.dataSource === 'spotify-web-api'
  const spotifySyncAutomation = React.useMemo(
    () => automations.find(isSpotifySyncAutomation) ?? null,
    [automations],
  )
  const spotifySyncActive = Boolean(spotifySyncAutomation?.enabled)
  const intelSyncAutomation = React.useMemo(
    () => automations.find(isIntelSyncAutomation) ?? null,
    [automations],
  )
  const intelSyncActive = Boolean(intelSyncAutomation?.enabled)
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
  const intelConfigResult = React.useMemo(
    () => parseArtistIntelConfigDocResult(docs.find((doc) => doc.slug === ARTIST_INTEL_CONFIG_CONTEXT_SLUG)),
    [docs],
  )
  const intelConfig = intelConfigResult.config
  const intelReportResult = React.useMemo(
    () => parseArtistIntelReportDocResult(docs.find((doc) => doc.slug === ARTIST_INTEL_REPORT_CONTEXT_SLUG)),
    [docs],
  )
  const intelReport = intelReportResult.report
  const youtubeResearchAgent = React.useMemo(
    () => [...shellActiveAgents, ...workspaceActiveAgents, ...allAgents]
      .find((agent) => agent.slug === YOUTUBE_RESEARCH_AGENT_SLUG),
    [allAgents, shellActiveAgents, workspaceActiveAgents],
  )
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

  React.useEffect(() => {
    setVoiceDraft(voiceToDraft(voice))
  }, [voice])

  React.useEffect(() => {
    if (intelReport.status !== 'queued') return
    const interval = window.setInterval(() => {
      refreshContext()
    }, 10000)
    return () => window.clearInterval(interval)
  }, [intelReport.status, refreshContext])

  const refreshAutomations = React.useCallback(async () => {
    try {
      const json = await window.electronAPI.getAutomations(workspaceId)
      setAutomations(json ? parseAutomationsConfig(json) : [])
    } catch {
      setAutomations([])
    }
  }, [workspaceId])

  React.useEffect(() => {
    refreshAutomations()
    const cleanup = window.electronAPI.onAutomationsChanged(() => {
      refreshAutomations()
    })
    return () => cleanup()
  }, [refreshAutomations])

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

  const saveVoice = React.useCallback(async () => {
    if (!voiceResult.ok) {
      toast.error(`${voiceResult.error} Open Workspace Context to recover it before saving.`)
      return
    }
    const nextVoice: ArtistVoice = {
      version: 1,
      ...voiceDraft,
      updatedAt: new Date().toISOString(),
    }
    try {
      await upsert({
        slug: ARTIST_VOICE_CONTEXT_SLUG,
        metadata: artistVoiceMetadata(),
        body: serializeArtistVoiceBody(nextVoice),
      })
      toast.success('Artist Voice saved')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    }
  }, [upsert, voiceDraft, voiceResult])

  const saveIntelConfig = React.useCallback(async (nextConfig: ArtistIntelConfig) => {
    const config = {
      ...nextConfig,
      updatedAt: new Date().toISOString(),
    }
    await upsert({
      slug: ARTIST_INTEL_CONFIG_CONTEXT_SLUG,
      metadata: artistIntelConfigMetadata(),
      body: serializeArtistIntelConfigBody(config),
    })
  }, [upsert])

  const toggleIntelPulse = React.useCallback(async () => {
    if (!intelConfigResult.ok) {
      toast.error(intelConfigResult.error)
      return
    }
    setIntelBusy(true)
    try {
      const nextEnabled = !intelConfig.enabled
      await saveIntelConfig({
        ...intelConfig,
        enabled: nextEnabled,
      })
      if (intelSyncAutomation) {
        await window.electronAPI.setAutomationEnabled(
          workspaceId,
          intelSyncAutomation.event,
          intelSyncAutomation.matcherIndex,
          nextEnabled && intelConfig.cadence === 'weekly',
        )
      } else if (nextEnabled && intelConfig.cadence === 'weekly') {
        await window.electronAPI.createAutomationFromTemplate(
          workspaceId,
          'SchedulerTick',
          createIntelSyncMatcher(workspaceName || 'Artist HQ'),
        )
      }
      await refreshAutomations()
      toast.success(nextEnabled ? 'Intel Pulse activated' : 'Intel Pulse paused')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      setIntelBusy(false)
    }
  }, [intelConfig, intelConfigResult, intelSyncAutomation, refreshAutomations, saveIntelConfig, workspaceId, workspaceName])

  const runIntelPulse = React.useCallback(async () => {
    if (!workspaceId || !intelConfigResult.ok) return
    if (!youtubeResearchAgent) {
      toast.error('YouTube Research Agent is not installed in this workspace')
      return
    }
    setIntelBusy(true)
    try {
      const config = intelConfig.enabled ? intelConfig : { ...intelConfig, enabled: true }
      if (!intelConfig.enabled) {
        await saveIntelConfig(config)
      }
      const contextDocs = await window.electronAPI
        .listWorkspaceContextDocsForAgent(workspaceId, youtubeResearchAgent.slug)
      const generatedAt = new Date().toISOString()
      const session = await openAgentSessionComposer({
        agent: youtubeResearchAgent,
        workspaceId,
        onCreateSession,
        onInputChange,
        skills,
        sources,
        contextDocs,
      })
      await Promise.resolve(onSendMessage(session.id, createIntelRunPrompt(config, workspaceName || 'Artist HQ')))
      await upsert({
        slug: ARTIST_INTEL_REPORT_CONTEXT_SLUG,
        metadata: artistIntelReportMetadata(),
        body: serializeArtistIntelReportBody(createQueuedIntelRun(intelReport, {
          sessionId: session.id,
          sourceCount: config.sources.length,
          generatedAt,
        })),
      })
      toast.success('Intel Pulse started')
    } catch (error) {
      toast.error('Failed to start Intel Pulse', {
        description: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setIntelBusy(false)
    }
  }, [
    intelConfig,
    intelConfigResult,
    intelReport,
    onCreateSession,
    onInputChange,
    onSendMessage,
    saveIntelConfig,
    skills,
    sources,
    upsert,
    workspaceId,
    workspaceName,
    youtubeResearchAgent,
  ])

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
      await refreshAutomations()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setSpotifySyncBusy(false)
    }
  }, [refreshAutomations, spotifySyncAutomation, workspaceId])

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

  // Dynamic header properties based on active tab
  const getHeaderProps = () => {
    switch (tab) {
      case 'calendar':
        return {
          title: 'Calendar',
          description: 'Schedule, events, and important dates for the artist.',
          orb1: 'bg-indigo-600/10',
          orb2: 'bg-purple-500/5',
          icon: <CalendarDays className="h-3.5 w-3.5 text-indigo-300/80" />,
          label: 'Schedule',
        }
      case 'network':
        return {
          title: 'Network',
          description: 'Relationships, roles, contact info, and context on everyone who matters to the artist.',
          orb1: 'bg-emerald-600/10',
          orb2: 'bg-teal-500/5',
          icon: <Users className="h-3.5 w-3.5 text-emerald-300/80" />,
          label: 'Contacts',
        }
      case 'profile':
        return {
          title: 'Artist Profile',
          description: 'Global context every worker should know before touching campaigns, content, research, ads, or outreach.',
          orb1: 'bg-blue-600/10',
          orb2: 'bg-indigo-500/5',
          icon: <UserRound className="h-3.5 w-3.5 text-blue-300/80" />,
          label: 'Context',
        }
      case 'voice':
        return {
          title: 'Voice',
          description: 'How the artist talks, writes captions, phrases ideas, and wants public copy to sound.',
          orb1: 'bg-pink-600/10',
          orb2: 'bg-orange-500/5',
          icon: <MessageSquareText className="h-3.5 w-3.5 text-pink-300/80" />,
          label: 'Style',
        }
      case 'workers':
        return {
          title: 'Workers',
          description: 'Global HQ workers for recurring artist operations.',
          orb1: 'bg-orange-600/10',
          orb2: 'bg-emerald-500/5',
          icon: <Bot className="h-3.5 w-3.5 text-orange-300/80" />,
          label: 'Work',
        }
      case 'branding':
        return {
          title: 'Branding',
          description: 'Artist positioning, narrative, voice, references, and creative direction.',
          orb1: 'bg-blue-600/10',
          orb2: 'bg-emerald-500/5',
          icon: <Sparkles className="h-3.5 w-3.5 text-blue-300/80" />,
          label: 'Brain',
        }
      default:
        return {
          title: artistName,
          description: 'Global career context, signals, calendar, network, and research. Campaign workspaces pull from here.',
          orb1: 'bg-orange-600/10',
          orb2: 'bg-cyan-500/5',
          icon: <Sparkles className="h-3.5 w-3.5 text-orange-300/80" />,
          label: 'Artist HQ',
        }
    }
  }

  const headerProps = getHeaderProps()

  return (
    <div className="h-full overflow-y-auto bg-[#050505] text-foreground">
      <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-3 px-5 py-4 xl:px-8 xl:py-5">
        <section className="relative overflow-hidden rounded-[24px] border border-white/[0.05] bg-[#0A0A0A] p-6 lg:p-8">
          <div className={cn("absolute -left-[18%] -top-[50%] h-[520px] w-[520px] rounded-full blur-[110px]", headerProps.orb1)} />
          <div className={cn("absolute -bottom-[50%] -right-[12%] h-[520px] w-[520px] rounded-full blur-[120px]", headerProps.orb2)} />
          <div className="relative z-10">
            <div className="flex items-start justify-between gap-4">
              <div className="inline-flex items-center gap-2 rounded-full border border-white/[0.05] bg-white/[0.02] px-3 py-1.5">
                {headerProps.icon}
                <span className="text-[10px] font-medium uppercase tracking-[0.2em] text-white/65">{headerProps.label}</span>
              </div>
              <div className="text-right">
                <p className="text-[10px] font-medium uppercase tracking-[0.2em] text-white/35">Next</p>
                <p className="mt-1.5 text-xs font-medium text-white/70">{nextDate}</p>
              </div>
            </div>

            <div className="mt-8 max-w-3xl">
              <h1 className="text-4xl font-medium tracking-tighter text-white/90 sm:text-5xl lg:text-[56px] lg:leading-[0.96]">
                {headerProps.title}
              </h1>
              <p className="mt-3 max-w-2xl text-sm font-light leading-relaxed text-white/50">
                {headerProps.description}
              </p>
            </div>

          </div>
        </section>

        {tab === 'home' && (
          <>
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-4">
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

              <IntelPulseCard
                config={intelConfig}
                report={intelReport}
                configError={intelConfigResult.ok ? null : intelConfigResult.error}
                reportError={intelReportResult.ok ? null : intelReportResult.error}
                busy={intelBusy}
                agentReady={Boolean(youtubeResearchAgent)}
                scheduled={intelSyncActive}
                onToggle={toggleIntelPulse}
                onRun={runIntelPulse}
                onEdit={() => setIntelConfigOpen(true)}
              />

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

        {tab === 'voice' && (
          <HQCard>
            <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
              <div>
                <SectionTitle icon={MessageSquareText} title="Voice" meta={`${voicePercent}% complete`} compact />
                <p className="mt-2 max-w-2xl text-xs leading-5 text-white/42">
                  This is routed into posting and content workers so captions, hooks, ads, and replies sound like the artist.
                </p>
              </div>
              <button
                type="button"
                onClick={saveVoice}
                disabled={!voiceResult.ok}
                className="h-9 rounded-full bg-white/90 px-5 text-xs font-semibold text-black hover:bg-white disabled:cursor-not-allowed disabled:opacity-40"
              >
                Save Voice
              </button>
            </div>

            {!voiceResult.ok ? (
              <div className="mb-4 rounded-[14px] border border-red-400/20 bg-red-500/10 p-3 text-xs leading-5 text-red-100/80">
                {voiceResult.error} Saving is paused so existing voice context is not overwritten.
              </div>
            ) : null}

            <ArtistVoiceForm draft={voiceDraft} onChange={setVoiceDraft} />
          </HQCard>
        )}

        {tab === 'calendar' && (
          <HQCard>
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

        {tab === 'workers' && (
          <HQCard>
            <SectionTitle icon={Bot} title="Workers" meta="work" />
            <EmptyLine title="No active global workers" detail="Spotify sync, YouTube intel, website, SEO, and comms workers will appear here." />
          </HQCard>
        )}

        {tab === 'branding' && (
          <HQCard>
            <SectionTitle icon={Sparkles} title="Branding" meta="brain" />
            <EmptyLine title="No brand system yet" detail="Narrative, positioning, references, and creative direction will live here." />
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
      <IntelConfigDialog
        open={intelConfigOpen}
        config={intelConfig}
        onOpenChange={setIntelConfigOpen}
        onSave={async (nextConfig) => {
          try {
            await saveIntelConfig(nextConfig)
            if (intelSyncAutomation) {
              await window.electronAPI.setAutomationEnabled(
                workspaceId,
                intelSyncAutomation.event,
                intelSyncAutomation.matcherIndex,
                nextConfig.enabled && nextConfig.cadence === 'weekly',
              )
            } else if (nextConfig.enabled && nextConfig.cadence === 'weekly') {
              await window.electronAPI.createAutomationFromTemplate(
                workspaceId,
                'SchedulerTick',
                createIntelSyncMatcher(workspaceName || 'Artist HQ'),
              )
            }
            await refreshAutomations()
            toast.success('Intel channels saved')
            setIntelConfigOpen(false)
          } catch (error) {
            toast.error(error instanceof Error ? error.message : String(error))
          }
        }}
      />
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

function IntelPulseCard({
  config,
  report,
  configError,
  reportError,
  busy,
  agentReady,
  scheduled,
  onToggle,
  onRun,
  onEdit,
}: {
  config: ArtistIntelConfig
  report: ReturnType<typeof parseArtistIntelReportDocResult>['report']
  configError: string | null
  reportError: string | null
  busy: boolean
  agentReady: boolean
  scheduled: boolean
  onToggle: () => void
  onRun: () => void
  onEdit: () => void
}) {
  const latestLabel = report.generatedAt ? formatShortDate(report.generatedAt) : 'not run'
  const running = report.status === 'queued'
  const statusLabel = report.status === 'queued'
    ? 'Running'
    : report.status === 'ready'
      ? 'Ready'
      : report.status === 'failed'
        ? 'Needs check'
        : config.enabled ? scheduled ? 'Scheduled' : 'Manual' : 'Off'

  return (
    <HQCard>
      <div className="mb-3 flex items-center justify-between gap-3 border-b border-white/[0.04] pb-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <Radio className="h-3 w-3 shrink-0 text-white/40" />
          <h3 className="truncate text-[11px] font-semibold uppercase tracking-[0.16em] text-white/48">
            Intel Pulse
          </h3>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className="text-[10px] font-medium uppercase tracking-[0.12em] text-white/24">
            {statusLabel}
          </span>
          <button
            type="button"
            onClick={onToggle}
            disabled={busy}
            title={config.enabled ? 'Pause Intel Pulse' : 'Activate Intel Pulse'}
            className={cn(
              'inline-flex h-6 w-6 items-center justify-center rounded-full border transition-colors',
              config.enabled
                ? 'border-emerald-400/35 bg-emerald-500/12 text-emerald-300'
                : 'border-white/[0.07] bg-white/[0.02] text-white/28 hover:text-white/60',
              busy && 'cursor-wait opacity-60',
            )}
            aria-label={config.enabled ? 'Pause Intel Pulse' : 'Activate Intel Pulse'}
          >
            <RefreshCw className={cn('h-3.5 w-3.5', busy && 'animate-spin')} />
          </button>
          <button
            type="button"
            onClick={onEdit}
            title="Edit Intel channels"
            className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-white/[0.07] bg-white/[0.02] text-white/28 transition-colors hover:text-white/65"
            aria-label="Edit Intel channels"
          >
            <SlidersHorizontal className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Metric label="Channels" value={String(config.sources.length)} />
        <Metric label="Latest" value={latestLabel} />
      </div>
      <p className="mt-3 line-clamp-2 text-xs leading-5 text-white/38">
        {report.summary || 'Watches selected YouTube channels and turns new videos into artist-facing research.'}
      </p>
      <div className="mt-3 flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={onRun}
          disabled={busy || running || !agentReady || config.sources.length === 0}
          className="h-8 rounded-full bg-white/90 px-4 text-xs font-semibold text-black hover:bg-white disabled:cursor-not-allowed disabled:opacity-45"
        >
          {busy ? 'Starting...' : running ? 'Running' : 'Run'}
        </button>
        {report.sessionId ? (
          <button
            type="button"
            onClick={() => navigate(routes.view.allSessions(report.sessionId))}
            className="h-8 rounded-full border border-white/[0.08] px-3 text-xs font-medium text-white/55 hover:bg-white/[0.04]"
          >
            Open
          </button>
        ) : null}
      </div>
      <p className="mt-2 text-[10px] font-medium uppercase tracking-[0.12em] text-white/25">
        {config.enabled
          ? scheduled ? 'Weekly automation active' : 'Manual radar active'
          : 'Radar off'}
      </p>
      {report.runs.length > 0 ? (
        <div className="mt-3 space-y-1.5 border-t border-white/[0.04] pt-2">
          {report.runs.slice(0, 3).map((run) => (
            <div key={run.id} className="flex items-center justify-between gap-3 text-[11px] leading-4">
              <span className="truncate text-white/38">{run.summary || run.title || run.status}</span>
              <span className="shrink-0 uppercase tracking-[0.1em] text-white/22">{run.status}</span>
            </div>
          ))}
        </div>
      ) : null}
      {!agentReady ? (
        <p className="mt-2 text-xs leading-5 text-yellow-100/65">YouTube Research Agent is not active in this workspace.</p>
      ) : null}
      {configError || reportError ? (
        <p className="mt-2 text-xs leading-5 text-red-100/65">{configError || reportError}</p>
      ) : null}
    </HQCard>
  )
}

function IntelConfigDialog({
  open,
  config,
  onOpenChange,
  onSave,
}: {
  open: boolean
  config: ArtistIntelConfig
  onOpenChange: (open: boolean) => void
  onSave: (config: ArtistIntelConfig) => void | Promise<void>
}) {
  const [sources, setSources] = React.useState<ArtistIntelSource[]>(config.sources)
  const [sinceDays, setSinceDays] = React.useState(config.sinceDays)
  const [maxPerChannel, setMaxPerChannel] = React.useState(config.maxPerChannel)
  const [cadence, setCadence] = React.useState(config.cadence)

  React.useEffect(() => {
    if (!open) return
    setSources(config.sources)
    setSinceDays(config.sinceDays)
    setMaxPerChannel(config.maxPerChannel)
    setCadence(config.cadence)
  }, [config, open])

  const updateSource = React.useCallback((id: string, patch: Partial<ArtistIntelSource>) => {
    setSources((current) => current.map((source) => source.id === id ? { ...source, ...patch } : source))
  }, [])

  const addSource = React.useCallback(() => {
    const id = `source-${Date.now()}`
    setSources((current) => [
      ...current,
      { id, name: '', url: '', priority: 'medium', notes: '' },
    ])
  }, [])

  const removeSource = React.useCallback((id: string) => {
    setSources((current) => current.filter((source) => source.id !== id))
  }, [])

  const save = React.useCallback(() => {
    const nextSources = sources
      .map((source) => ({
        ...source,
        name: source.name.trim(),
        url: source.url.trim(),
        notes: source.notes?.trim(),
      }))
      .filter((source) => source.name && source.url)
    const invalid = nextSources.find((source) => !isValidYouTubeChannelUrl(source.url))
    if (invalid) {
      toast.error('Use a YouTube channel URL', {
        description: invalid.name ? `${invalid.name}: ${invalid.url}` : invalid.url,
      })
      return
    }
    void onSave({
      ...config,
      cadence,
      sources: nextSources,
      sinceDays,
      maxPerChannel,
      updatedAt: new Date().toISOString(),
    })
  }, [cadence, config, maxPerChannel, onSave, sinceDays, sources])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[760px] border-white/[0.08] bg-[#080808] text-white shadow-2xl">
        <DialogHeader>
          <DialogTitle className="text-xl font-medium">Intel channels</DialogTitle>
          <DialogDescription className="text-white/42">
            Pick the YouTube channels this HQ should watch.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid gap-2 sm:grid-cols-3">
            <label className="block space-y-1.5">
              <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-white/36">Cadence</span>
              <select
                value={cadence}
                onChange={(event) => setCadence(event.target.value as ArtistIntelConfig['cadence'])}
                className="h-9 w-full rounded-[10px] border border-white/[0.08] bg-white/[0.025] px-3 text-sm text-white/80 outline-none focus:border-orange-400/45"
              >
                <option value="weekly">Weekly</option>
                <option value="manual">Manual</option>
              </select>
            </label>
            <label className="block space-y-1.5">
              <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-white/36">Scan days</span>
              <input
                type="number"
                min={1}
                max={30}
                value={sinceDays}
                onChange={(event) => setSinceDays(Number(event.target.value))}
                className="h-9 w-full rounded-[10px] border border-white/[0.08] bg-white/[0.025] px-3 text-sm text-white/80 outline-none focus:border-orange-400/45"
              />
            </label>
            <label className="block space-y-1.5">
              <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-white/36">Max per channel</span>
              <input
                type="number"
                min={1}
                max={10}
                value={maxPerChannel}
                onChange={(event) => setMaxPerChannel(Number(event.target.value))}
                className="h-9 w-full rounded-[10px] border border-white/[0.08] bg-white/[0.025] px-3 text-sm text-white/80 outline-none focus:border-orange-400/45"
              />
            </label>
          </div>
          <div className="max-h-[420px] space-y-2 overflow-y-auto pr-1">
            {sources.map((source) => (
              <div key={source.id} className="rounded-[14px] border border-white/[0.055] bg-white/[0.018] p-3">
                <div className="grid gap-2 md:grid-cols-[1fr_1.35fr_120px_34px]">
                  <Input value={source.name} onChange={(name) => updateSource(source.id, { name })} placeholder="Channel name" />
                  <Input value={source.url} onChange={(url) => updateSource(source.id, { url })} placeholder="https://www.youtube.com/@channel" />
                  <select
                    value={source.priority}
                    onChange={(event) => updateSource(source.id, { priority: event.target.value as ArtistIntelSource['priority'] })}
                    className="h-9 rounded-[10px] border border-white/[0.06] bg-black/30 px-3 text-xs text-white/75 outline-none"
                  >
                    <option value="high">High</option>
                    <option value="medium">Medium</option>
                    <option value="low">Low</option>
                  </select>
                  <button
                    type="button"
                    onClick={() => removeSource(source.id)}
                    className="inline-flex h-9 items-center justify-center rounded-[10px] border border-white/[0.07] text-white/35 hover:bg-white/[0.04] hover:text-white/70"
                    aria-label={`Remove ${source.name || 'channel'}`}
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
                <textarea
                  value={source.notes ?? ''}
                  onChange={(event) => updateSource(source.id, { notes: event.target.value })}
                  placeholder="Why this channel matters..."
                  className="mt-2 min-h-[58px] w-full rounded-[10px] border border-white/[0.06] bg-black/25 px-3 py-2 text-xs leading-5 text-white/75 outline-none placeholder:text-white/28 focus:border-white/16"
                />
              </div>
            ))}
          </div>
          <div className="flex items-center justify-between gap-3 pt-1">
            <button
              type="button"
              onClick={addSource}
              className="inline-flex h-9 items-center gap-2 rounded-full border border-white/[0.08] px-4 text-xs font-medium text-white/62 hover:bg-white/[0.04]"
            >
              <Plus className="h-3.5 w-3.5" />
              Add channel
            </button>
            <button
              type="button"
              onClick={save}
              className="h-9 rounded-full bg-white px-5 text-xs font-semibold text-black"
            >
              Save
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function formatMetric(value: number | undefined): string {
  if (typeof value !== 'number') return '--'
  return new Intl.NumberFormat('en-US', { notation: value >= 10000 ? 'compact' : 'standard' }).format(value)
}

function formatShortDate(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(date)
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
      <ProfileField label="Themes / topics" wide>
        <TextArea
          value={draft.themes ?? ''}
          onChange={(themes) => onChange({ ...draft, themes })}
          placeholder="Topics they write about, recurring ideas, worldview, content lanes, lyrical themes, tensions, scenes, values."
        />
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

function ArtistVoiceForm({
  draft,
  onChange,
}: {
  draft: VoiceDraft
  onChange: (draft: VoiceDraft) => void
}) {
  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
      <ProfileField label="Voice summary" wide>
        <TextArea value={draft.summary ?? ''} onChange={(summary) => onChange({ ...draft, summary })} placeholder="Short summary of how the artist sounds in public. Dry, sharp, intimate, funny, poetic, chaotic..." />
      </ProfileField>
      <ProfileField label="How they talk">
        <TextArea value={draft.speakingStyle ?? ''} onChange={(speakingStyle) => onChange({ ...draft, speakingStyle })} placeholder="Sentence length, rhythm, humor, slang, punctuation, directness, emotional temperature" />
      </ProfileField>
      <ProfileField label="Words / phrases">
        <TextArea value={draft.vocabulary ?? ''} onChange={(vocabulary) => onChange({ ...draft, vocabulary })} placeholder="Words they use, repeated phrases, spelling quirks, signature expressions" />
      </ProfileField>
      <ProfileField label="Avoid">
        <TextArea value={draft.avoid ?? ''} onChange={(avoid) => onChange({ ...draft, avoid })} placeholder="Words, tones, cliches, emojis, topics, fake hype, or anything that does not sound like them" />
      </ProfileField>
      <ProfileField label="Caption examples" wide>
        <TextArea value={draft.captionExamples ?? ''} onChange={(captionExamples) => onChange({ ...draft, captionExamples })} placeholder="Paste real captions. Include good examples and notes if useful." />
      </ProfileField>
      <ProfileField label="Post examples" wide>
        <TextArea value={draft.postExamples ?? ''} onChange={(postExamples) => onChange({ ...draft, postExamples })} placeholder="Paste posts, tweets, threads, announcements, replies, or email/social copy that sounds right." />
      </ProfileField>
      <ProfileField label="Writing excerpts" wide>
        <TextArea value={draft.writingExcerpts ?? ''} onChange={(writingExcerpts) => onChange({ ...draft, writingExcerpts })} placeholder="Longer samples: notes app drafts, artist statements, scripts, captions, or journal-style writing." />
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
                  <ContextBadges
                    workspaceLinks={event.workspaceLinks}
                    googleStatus={event.google?.syncStatus}
                    relatedCount={event.relatedPersonIds.length}
                  />
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
    <div className="space-y-8">
      {categories.map((category) => {
        const categoryPeople = people.filter((person) => person.category === category.id)
        if (categoryPeople.length === 0) return null
        return (
          <section key={category.id}>
            <div className="mb-4 flex items-center gap-3">
              <h3 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-white/50">{category.label}</h3>
              <div className="h-px flex-1 bg-gradient-to-r from-white/[0.08] to-transparent" />
              <span className="rounded-full bg-white/[0.03] px-2 py-0.5 text-[10px] tabular-nums text-white/30">{categoryPeople.length}</span>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
              {categoryPeople.map((person) => (
                <PersonCard key={person.id} person={person} onClick={() => onSelectPerson(person)} />
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

function PersonCard({ person, onClick }: { person: ArtistNetworkPerson; onClick: () => void }) {
  return (
    <button 
      type="button" 
      onClick={onClick} 
      className="group flex flex-col justify-between rounded-[14px] border border-white/[0.04] bg-white/[0.015] p-3 text-left transition-all hover:bg-white/[0.03] hover:border-white/[0.08] hover:shadow-lg hover:-translate-y-0.5"
    >
      <div className="flex items-start justify-between gap-2 w-full">
        <div className="flex items-center justify-center h-8 w-8 rounded-full bg-gradient-to-br from-white/10 to-white/5 border border-white/10 shrink-0">
          <UserRound className="h-4 w-4 text-white/60" />
        </div>
        {person.relationship && person.relationship !== 'new' ? (
          <span className={cn(
            "rounded-full px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.1em]",
            person.relationship === 'vip' ? "bg-purple-500/10 text-purple-300" :
            person.relationship === 'strong' ? "bg-orange-500/10 text-orange-300" :
            "bg-blue-500/10 text-blue-300"
          )}>
            {person.relationship}
          </span>
        ) : null}
      </div>
      
      <div className="mt-3 w-full">
        <div className="truncate text-sm font-semibold text-white/80 group-hover:text-white transition-colors">{person.name}</div>
        <div className="mt-0.5 truncate text-[11px] text-white/40">{person.role || person.contact || 'No role added'}</div>
      </div>
      
      {person.tags.length > 0 ? (
        <div className="mt-3 flex w-full flex-wrap gap-1.5 overflow-hidden h-[20px]">
          {person.tags.slice(0, 3).map(tag => (
            <span key={tag} className="inline-flex items-center rounded-[6px] bg-white/[0.04] px-1.5 py-0.5 text-[9px] font-medium text-white/40">
              {tag}
            </span>
          ))}
          {person.tags.length > 3 && (
            <span className="inline-flex items-center rounded-[6px] bg-white/[0.02] px-1.5 py-0.5 text-[9px] font-medium text-white/30">
              +{person.tags.length - 3}
            </span>
          )}
        </div>
      ) : (
        <div className="mt-3 h-[20px]" />
      )}
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

      <ContextBadges workspaceLinks={person.workspaceLinks} googleStatus={person.google?.syncStatus} />

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

function ContextBadges({
  workspaceLinks,
  googleStatus,
  relatedCount,
}: {
  workspaceLinks: { workspaceId: string; workspaceName?: string; role?: string }[]
  googleStatus?: string
  relatedCount?: number
}) {
  const badges = [
    ...workspaceLinks.map((link) => link.workspaceName || link.role || 'Campaign linked'),
    googleStatus && googleStatus !== 'not-synced' ? `Google ${googleStatus}` : null,
    relatedCount ? `${relatedCount} people` : null,
  ].filter((badge): badge is string => Boolean(badge))

  if (badges.length === 0) return null

  return (
    <div className="mt-3 flex flex-wrap gap-1.5">
      {badges.map((badge, index) => (
        <span
          key={`${badge}-${index}`}
          className="rounded-full border border-white/[0.06] bg-white/[0.025] px-2 py-1 text-[10px] font-medium text-white/38"
        >
          {badge}
        </span>
      ))}
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
    themes: profile.themes ?? '',
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

function voiceToDraft(voice: ArtistVoice): VoiceDraft {
  return {
    summary: voice.summary ?? '',
    speakingStyle: voice.speakingStyle ?? '',
    vocabulary: voice.vocabulary ?? '',
    avoid: voice.avoid ?? '',
    captionExamples: voice.captionExamples ?? '',
    postExamples: voice.postExamples ?? '',
    writingExcerpts: voice.writingExcerpts ?? '',
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

function createIntelSyncMatcher(workspaceName: string): Record<string, unknown> {
  return {
    name: INTEL_SYNC_AUTOMATION_NAME,
    cron: INTEL_SYNC_CRON,
    timezone: getLocalTimezone(),
    permissionMode: 'ask',
    labels: ['youtube', 'intel', 'artist-hq', 'scheduled'],
    actions: [
      {
        type: 'prompt',
        agentSlug: YOUTUBE_RESEARCH_AGENT_SLUG,
        prompt: createScheduledIntelRunPrompt(workspaceName),
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

function isIntelSyncAutomation(automation: AutomationListItem): boolean {
  if (automation.event !== 'SchedulerTick') return false
  if (automation.name === INTEL_SYNC_AUTOMATION_NAME) return true
  return automation.actions.some((action) => (
    action.type === 'prompt'
    && action.agentSlug === YOUTUBE_RESEARCH_AGENT_SLUG
    && /artist-intel-config|youtube intel pulse/i.test(action.prompt)
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

function isArtistHQTab(value: string): value is ArtistHQTab {
  return value === 'home' || value === 'profile' || value === 'voice' || value === 'calendar' || value === 'network' || value === 'research' || value === 'workers' || value === 'branding'
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
