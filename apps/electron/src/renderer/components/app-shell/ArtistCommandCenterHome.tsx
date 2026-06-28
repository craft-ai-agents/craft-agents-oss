import * as React from 'react'
import {
  Activity,
  ArrowRight,
  Bot,
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  FileUp,
  ShieldCheck,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useWorkspaceContext } from '@/hooks/useWorkspaceContext'
import {
  MISSION_BRIEF_CONTEXT_SLUG,
  emptyMissionBrief,
  parseMissionBriefDoc,
  type MissionBrief,
} from '@/lib/mission-brief'
import { MissionBriefDrawer } from './MissionBriefDrawer'

interface ArtistCommandCenterHomeProps {
  workspaceId: string
}

function SectionTitle({
  icon: Icon,
  title,
  meta,
}: {
  icon: React.ComponentType<{ className?: string }>
  title: string
  meta?: string
}) {
  return (
    <div className="mb-3 flex items-center justify-between border-b border-white/[0.04] pb-2.5">
      <div className="flex items-center gap-2">
        <Icon className="h-3 w-3 text-white/40" />
        <h3 className="text-[9px] font-medium uppercase tracking-[0.15em] text-white/60">{title}</h3>
      </div>
      {meta ? (
        <span className="text-[8px] font-medium uppercase tracking-widest text-white/30">
          {meta}
        </span>
      ) : null}
    </div>
  )
}

function CommandCard({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <section
      className={cn(
        'rounded-2xl border border-white/[0.04] bg-[#0A0A0A] p-4 shadow-minimal transition-colors hover:bg-white/[0.02]',
        className,
      )}
    >
      {children}
    </section>
  )
}

export function ArtistCommandCenterHome({ workspaceId }: ArtistCommandCenterHomeProps) {
  const [drawerOpen, setDrawerOpen] = React.useState(false)
  const [showAgents, setShowAgents] = React.useState(false)
  const { docs, loading, upsert } = useWorkspaceContext(workspaceId)

  const savedMission = React.useMemo(() => {
    const doc = docs.find((item) => item.slug === MISSION_BRIEF_CONTEXT_SLUG)
    return parseMissionBriefDoc(doc)
  }, [docs])

  const [optimisticMission, setOptimisticMission] = React.useState<MissionBrief | null>(null)

  React.useEffect(() => {
    if (savedMission) setOptimisticMission(null)
  }, [savedMission])

  const emptyMission = React.useMemo(
    () => emptyMissionBrief(workspaceId || 'workspace'),
    [workspaceId],
  )
  const mission = optimisticMission ?? savedMission ?? emptyMission
  const hasMission = mission.status !== 'empty'
  const title = mission.title || 'Untitled Mission'
  const subtitle = hasMission
    ? mission.goal || mission.mood || 'Mission brief started. Add more context when ready.'
    : 'Start with a goal, files, or an agent.'
  const phase = mission.phase || (hasMission ? mission.missionType || 'Mission active' : 'No brief yet')
  const completenessLabel = `${mission.completeness}% context`

  return (
    <div className="h-full overflow-y-auto bg-[#050505] text-foreground">
      <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-4 px-5 py-6 xl:px-8 xl:py-8">
        <section className="relative min-h-[320px] overflow-hidden rounded-[24px] border border-white/[0.05] bg-[#0A0A0A]">
          <div className="absolute -left-[20%] -top-[40%] h-[600px] w-[600px] rounded-full bg-orange-600/10 blur-[120px]" />
          <div className="absolute -bottom-[40%] -right-[10%] h-[600px] w-[600px] rounded-full bg-indigo-600/5 blur-[120px]" />

          <div className="absolute bottom-10 right-10 hidden w-[32%] rounded-[28px] border border-white/[0.04] bg-white/[0.015] p-5 2xl:block">
            <p className="mb-2 text-[9px] font-medium uppercase tracking-[0.18em] text-white/35">Mission Context</p>
            <div className="h-1 overflow-hidden rounded-full bg-white/[0.05]">
              <div className="h-full rounded-full bg-orange-400" style={{ width: `${mission.completeness}%` }} />
            </div>
            <p className="mt-3 text-xs leading-5 text-white/42">
              {hasMission
                ? 'The command center is now using this mission brief as workspace context.'
                : 'Nothing is required before agents can work. The brief just makes them sharper.'}
            </p>
          </div>

          <div className="relative z-10 flex min-h-[320px] flex-col justify-between p-8 lg:p-10">
            <div className="flex items-start justify-between gap-4">
              <div className="inline-flex items-center gap-2.5 rounded-full border border-white/[0.05] bg-white/[0.02] px-3 py-1.5 pr-4 backdrop-blur-md">
                <span className={cn('flex h-2 w-2 items-center justify-center rounded-full', hasMission ? 'bg-emerald-500/20' : 'bg-white/10')}>
                  <span className={cn('h-1.5 w-1.5 rounded-full', hasMission ? 'bg-emerald-500' : 'bg-white/35')} />
                </span>
                <span className="text-[10px] font-medium uppercase tracking-[0.2em] text-white/70">
                  {hasMission ? 'Mission Active' : 'Mission Empty'}
                </span>
              </div>
              <div className="text-right">
                <p className="text-[10px] font-medium uppercase tracking-[0.2em] text-white/40">Focus</p>
                <p className="mt-1.5 text-xs font-medium capitalize text-white/70">{phase}</p>
              </div>
            </div>

            <div className="my-9 max-w-[760px]">
              <h1 className="text-5xl font-medium tracking-tighter text-white/90 sm:text-6xl md:text-7xl lg:text-[76px] lg:leading-[0.95]">
                {title}
              </h1>
              <p className="mt-5 max-w-2xl text-sm font-light leading-relaxed text-white/50">
                {subtitle}
              </p>
            </div>

            <div className="flex flex-col gap-6 border-t border-white/[0.05] pt-6 md:flex-row md:items-end md:justify-between">
              <div className="flex w-full max-w-2xl flex-col gap-6 md:flex-row md:items-end md:gap-10">
                <div>
                  <p className="mb-1.5 text-[9px] font-medium uppercase tracking-[0.2em] text-white/40">Status</p>
                  <p className="text-3xl font-light capitalize tracking-tight text-white/90">
                    {mission.status}
                  </p>
                </div>
                <div className="w-full max-w-[220px]">
                  <div className="mb-2 flex justify-between text-[9px] font-medium uppercase tracking-[0.2em] text-white/40">
                    <span>Brief</span>
                    <span className="text-white/60">{completenessLabel}</span>
                  </div>
                  <div className="h-1 overflow-hidden rounded-full bg-white/[0.04]">
                    <div className="h-full rounded-full bg-orange-500/80" style={{ width: `${mission.completeness}%` }} />
                  </div>
                </div>
                <div className="hidden md:block">
                  <p className="mb-1.5 text-[9px] font-medium uppercase tracking-[0.2em] text-white/40">Next Move</p>
                  <p className="text-xs font-medium text-white/80">
                    {hasMission ? 'Keep shaping the brief or launch an agent.' : 'Create the mission brief.'}
                  </p>
                </div>
              </div>

              <div className="flex shrink-0 flex-wrap gap-2.5">
                <button
                  type="button"
                  onClick={() => setDrawerOpen(true)}
                  className="inline-flex h-9 items-center gap-2 rounded-full bg-white/90 px-5 text-xs font-medium text-black transition-transform hover:scale-[1.02] active:scale-95"
                >
                  {hasMission ? 'Edit Mission' : 'Create Mission'}
                  <ArrowRight className="h-3.5 w-3.5" />
                </button>
                <button className="inline-flex h-9 items-center gap-2 rounded-full bg-white/[0.02] px-5 text-xs font-medium text-white/70 ring-1 ring-inset ring-white/[0.08] transition-all hover:bg-white/[0.06] hover:text-white">
                  <FileUp className="h-3.5 w-3.5" />
                  Drop Files
                </button>
              </div>
            </div>
          </div>
        </section>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <CommandCard>
            <SectionTitle icon={Activity} title="State of Play" meta={loading ? 'Loading' : 'Live'} />
            <div className="grid grid-cols-2 gap-x-4 gap-y-4 pt-1">
              <Metric label="Context" value={hasMission ? `${mission.completeness}%` : 'Empty'} detail={hasMission ? 'Brief saved' : 'No mission brief'} />
              <Metric label="Mission" value={hasMission ? 'Active' : 'Open'} detail={mission.missionType || 'Any creative work'} />
              <Metric label="Timeline" value={mission.timeline || mission.releaseDate || 'Unknown'} detail={hasMission ? 'User-provided' : 'Not set'} />
              <Metric label="Sources" value="Quiet" detail="No connected stats yet" />
            </div>
          </CommandCard>

          <CommandCard>
            <SectionTitle icon={ShieldCheck} title="Approvals" meta="None" />
            <EmptyCardLine
              title="No pending approvals"
              detail={hasMission ? 'Approvals will appear when workflows create review points.' : 'Create a mission before approval workflows matter.'}
            />
          </CommandCard>

          <CommandCard>
            <SectionTitle icon={CalendarClock} title="Today" meta="Local" />
            {mission.timeline || mission.releaseDate ? (
              <div className="relative mt-2.5 space-y-3.5 pl-3.5 before:absolute before:bottom-1 before:left-[5.5px] before:top-1 before:w-px before:bg-white/[0.04]">
                <TimelineLine time="Now" title={mission.timeline || mission.releaseDate || 'Mission timeline'} area="Mission" />
                <TimelineLine time="Next" title="Ask an agent to turn this into a plan" area="Delegation" />
              </div>
            ) : (
              <EmptyCardLine title="No timeline yet" detail="Add a release date or rough window in the mission brief." />
            )}
          </CommandCard>
        </div>

        <CommandCard>
          <button
            type="button"
            onClick={() => setShowAgents((value) => !value)}
            className="group flex w-full items-center justify-between text-left"
            aria-expanded={showAgents}
          >
            <div className="flex items-center gap-2">
              <Bot className="h-3 w-3 text-white/40 group-hover:text-white/60" />
              <h3 className="text-[9px] font-medium uppercase tracking-[0.15em] text-white/60">Active Agents</h3>
              <span className="ml-2 rounded bg-white/[0.03] px-2 py-0.5 text-[8px] font-medium tracking-widest text-white/40">
                Quiet
              </span>
            </div>
            <ChevronDown className={cn('h-4 w-4 text-white/20 transition-transform duration-300 group-hover:text-white/50', showAgents && 'rotate-180')} />
          </button>

          <div className={cn('grid transition-all duration-300 ease-in-out', showAgents ? 'mt-3 grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0')}>
            <div className="overflow-hidden">
              <div className="rounded-xl border border-white/[0.03] bg-white/[0.012] p-4">
                <div className="flex items-start gap-3">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 text-white/32" />
                  <div>
                    <p className="text-sm font-medium text-white/75">No background agents running</p>
                    <p className="mt-1 text-xs leading-5 text-white/38">
                      Once a mission workflow starts, agent runs and handoffs can appear here.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </CommandCard>
      </div>

      <MissionBriefDrawer
        open={drawerOpen}
        workspaceId={workspaceId}
        mission={mission}
        onOpenChange={setDrawerOpen}
        onSaved={setOptimisticMission}
        saveMissionBrief={upsert}
      />
    </div>
  )
}

function Metric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="group flex min-w-0 flex-col">
      <p className="text-[8px] font-medium uppercase tracking-[0.2em] text-white/30">{label}</p>
      <p className="mt-1 truncate text-base font-medium tracking-tight text-white/90">{value}</p>
      <p className="mt-0.5 truncate text-[9px] font-light text-white/40">{detail}</p>
    </div>
  )
}

function EmptyCardLine({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="rounded-xl border border-white/[0.03] bg-white/[0.012] p-4">
      <p className="text-sm font-medium text-white/76">{title}</p>
      <p className="mt-1 text-xs leading-5 text-white/36">{detail}</p>
    </div>
  )
}

function TimelineLine({ time, title, area }: { time: string; title: string; area: string }) {
  return (
    <div className="relative flex gap-3">
      <span className="absolute -left-[16px] top-1.5 h-1.5 w-1.5 rounded-full bg-white/20 ring-[3px] ring-[#0A0A0A]" />
      <span className="w-9 shrink-0 pt-0.5 text-[9px] font-medium tracking-widest text-white/30">{time}</span>
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="text-xs font-medium text-white/80">{title}</span>
        <span className="text-[8px] font-medium uppercase tracking-[0.2em] text-white/30">{area}</span>
      </div>
    </div>
  )
}
