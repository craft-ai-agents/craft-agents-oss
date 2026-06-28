import * as React from 'react'
import {
  Activity,
  ArrowRight,
  Bot,
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  Clock3,
  ShieldCheck,
  Zap,
} from 'lucide-react'
import { cn } from '@/lib/utils'

type ApprovalPriority = 'high' | 'medium' | 'low'
type JobStatus = 'active' | 'done' | 'queued'

const stateMetrics = [
  { label: 'Momentum', value: 'Strong', detail: '+12.4k reach' },
  { label: 'Audience', value: '+2.3%', detail: '+412 listeners' },
  { label: 'Campaign', value: 'On Track', detail: 'Phase 2 healthy' },
  { label: 'Budget', value: 'Healthy', detail: '$4,250 available' },
]

const approvals: Array<{ type: string; title: string; detail: string; priority: ApprovalPriority }> = [
  { type: 'Artwork', title: 'Cover art final', detail: 'Approve before presave push', priority: 'high' },
  { type: 'Budget', title: 'Meta test: $600', detail: 'LATAM creative split', priority: 'medium' },
  { type: 'Content', title: 'Snippet pack', detail: '4 TikToks ready for review', priority: 'low' },
]

const timeline = [
  { time: '09:00', title: 'Morning agent briefing', area: 'System' },
  { time: '11:30', title: 'Mastering notes review', area: 'Creative' },
  { time: '14:00', title: 'Presave asset cutoff', area: 'Admin' },
  { time: '16:00', title: 'Short-form post window', area: 'Content' },
]

const jobs: Array<{ title: string; owner: string; status: JobStatus; time: string }> = [
  { title: 'Scanning TikTok audio trends', owner: 'Intel Agent', status: 'active', time: '14m' },
  { title: 'Checking Spotify playlist churn', owner: 'Spotify Agent', status: 'done', time: 'Done' },
  { title: 'Generating localized ad angles', owner: 'Ads Agent', status: 'queued', time: 'Waiting' },
  { title: 'Rendering six teaser cutdowns', owner: 'Content Agent', status: 'active', time: '08m' },
]

const waveBars = Array.from({ length: 42 }, (_, index) => {
  const height = 42 + Math.round(Math.sin(index * 0.48) * 28 + Math.cos(index * 0.21) * 18)
  return Math.max(12, Math.min(92, height))
})

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
        <span className="text-[8px] font-medium tracking-widest text-white/30 uppercase">
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
        'rounded-2xl border border-white/[0.04] bg-[#0A0A0A] p-4 shadow-sm transition-colors hover:bg-white/[0.02]',
        className,
      )}
    >
      {children}
    </section>
  )
}

function priorityColor(priority: ApprovalPriority) {
  if (priority === 'high') return 'bg-orange-500/80'
  if (priority === 'medium') return 'bg-white/40'
  return 'bg-white/10'
}

function statusClasses(status: JobStatus) {
  if (status === 'active') return 'bg-white/[0.06] text-white/80'
  if (status === 'done') return 'bg-white/[0.02] text-white/40'
  return 'bg-transparent text-white/30 border border-white/[0.04]'
}

export function ArtistCommandCenterHome() {
  const [showAgents, setShowAgents] = React.useState(false)

  return (
    <div className="h-full overflow-y-auto bg-[#050505] text-foreground">
      <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-4 px-5 py-6 xl:px-8 xl:py-8">
        <section className="relative min-h-[340px] overflow-hidden rounded-[24px] border border-white/[0.05] bg-[#0A0A0A]">
          {/* Ultra-modern glows */}
          <div className="absolute -left-[20%] -top-[40%] h-[600px] w-[600px] rounded-full bg-orange-600/10 blur-[120px]" />
          <div className="absolute -bottom-[40%] -right-[10%] h-[600px] w-[600px] rounded-full bg-indigo-600/5 blur-[120px]" />

          <div className="absolute bottom-0 right-12 top-16 hidden w-[35%] items-end justify-center gap-[3px] opacity-20 mix-blend-screen 2xl:flex">
            {waveBars.map((height, index) => (
              <div
                key={index}
                className="w-1.5 rounded-t-full bg-gradient-to-t from-orange-600/0 to-orange-500"
                style={{ height: `${height}%` }}
              />
            ))}
          </div>

          <div className="relative z-10 flex min-h-[340px] flex-col justify-between p-8 lg:p-10">
            <div className="flex items-start justify-between gap-4">
              <div className="inline-flex items-center gap-2.5 rounded-full border border-white/[0.05] bg-white/[0.02] px-3 py-1.5 pr-4 backdrop-blur-md">
                <span className="flex h-2 w-2 items-center justify-center rounded-full bg-emerald-500/20">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.4)]" />
                </span>
                <span className="text-[10px] font-medium uppercase tracking-[0.2em] text-white/70">
                  Mission Active • A1
                </span>
              </div>
              <div className="text-right">
                <p className="text-[10px] font-medium uppercase tracking-[0.2em] text-white/40">Release phase</p>
                <p className="mt-1.5 text-xs font-medium text-white/70">Phase 2: Pre-save expansion</p>
              </div>
            </div>

            <div className="my-10 max-w-[680px]">
              <h1 className="text-5xl font-medium tracking-tighter text-white/90 sm:text-6xl md:text-7xl lg:text-[76px] lg:leading-[0.95]">
                Midnight
                <br />
                Sun EP
              </h1>
              <p className="mt-5 max-w-xl text-sm font-light leading-relaxed text-white/50">
                Push the single from presave into release week with cover art, teaser clips, Spotify prep, and paid tests aligned.
              </p>
            </div>

            <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between border-t border-white/[0.05] pt-6">
              <div className="flex w-full max-w-2xl flex-col gap-6 md:flex-row md:items-end md:gap-10">
                <div>
                  <p className="mb-1.5 text-[9px] font-medium uppercase tracking-[0.2em] text-white/40">T-minus</p>
                  <p className="text-3xl font-light tracking-tight text-white/90">
                    14 <span className="text-sm text-white/30">days</span>
                  </p>
                </div>
                <div className="w-full max-w-[200px]">
                  <div className="mb-2 flex justify-between text-[9px] font-medium uppercase tracking-[0.2em] text-white/40">
                    <span>Progress</span>
                    <span className="text-white/60">68%</span>
                  </div>
                  <div className="h-1 overflow-hidden rounded-full bg-white/[0.04]">
                    <div className="h-full w-[68%] rounded-full bg-orange-500/80" />
                  </div>
                </div>
                <div className="hidden md:block">
                  <p className="mb-1.5 text-[9px] font-medium uppercase tracking-[0.2em] text-white/40">Next critical move</p>
                  <p className="text-xs font-medium text-white/80">Approve cover art and lock teaser</p>
                </div>
              </div>

              <div className="flex shrink-0 flex-wrap gap-2.5">
                <button className="inline-flex h-9 items-center gap-2 rounded-full bg-white/90 px-5 text-xs font-medium text-black transition-transform hover:scale-105 active:scale-95">
                  Continue Mission
                  <ArrowRight className="h-3.5 w-3.5" />
                </button>
                <button className="inline-flex h-9 items-center rounded-full bg-white/[0.02] px-5 text-xs font-medium text-white/70 ring-1 ring-inset ring-white/[0.08] transition-all hover:bg-white/[0.06] hover:text-white">
                  Review Assets
                </button>
              </div>
            </div>
          </div>
        </section>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <CommandCard>
            <SectionTitle icon={Activity} title="State of Play" meta="Live" />
            <div className="grid grid-cols-2 gap-x-4 gap-y-4 pt-1">
              {stateMetrics.map((metric) => (
                <div key={metric.label} className="group flex flex-col">
                  <p className="text-[8px] font-medium uppercase tracking-[0.2em] text-white/30">{metric.label}</p>
                  <p className="mt-1 text-base font-medium tracking-tight text-white/90">{metric.value}</p>
                  <p className="mt-0.5 text-[9px] font-light text-white/40">{metric.detail}</p>
                </div>
              ))}
            </div>
          </CommandCard>

          <CommandCard>
            <SectionTitle icon={ShieldCheck} title="Approvals" meta="3 Pending" />
            <div className="flex flex-col gap-0.5 pt-1">
              {approvals.map((approval) => (
                <button
                  key={approval.title}
                  className="group flex w-full items-center gap-2.5 rounded-lg py-1.5 text-left transition-colors hover:bg-white/[0.02]"
                >
                  <span className="flex h-3 w-3 shrink-0 items-center justify-center">
                    <span className={cn('h-1 w-1 rounded-full', priorityColor(approval.priority))} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-medium text-white/80">{approval.title}</span>
                    <span className="block truncate text-[9px] text-white/30">{approval.detail}</span>
                  </span>
                  <ArrowRight className="mr-1 h-3 w-3 shrink-0 text-white/10 transition-all group-hover:text-white/40" />
                </button>
              ))}
            </div>
          </CommandCard>

          <CommandCard>
            <SectionTitle icon={CalendarClock} title="Today" meta="Local" />
            <div className="relative mt-2.5 space-y-3.5 pl-3.5 before:absolute before:bottom-1 before:left-[5.5px] before:top-1 before:w-px before:bg-white/[0.04]">
              {timeline.map((item) => (
                <div key={`${item.time}-${item.title}`} className="relative flex gap-3">
                  <span className="absolute -left-[16px] top-1.5 h-1.5 w-1.5 rounded-full bg-white/20 ring-[3px] ring-[#0A0A0A]" />
                  <span className="w-6 shrink-0 pt-0.5 text-[9px] font-medium tracking-widest text-white/30">{item.time}</span>
                  <div className="flex flex-col gap-0.5">
                    <span className="text-xs font-medium text-white/80">{item.title}</span>
                    <span className="text-[8px] font-medium uppercase tracking-[0.2em] text-white/30">{item.area}</span>
                  </div>
                </div>
              ))}
            </div>
          </CommandCard>
        </div>

        <CommandCard>
          <button
            type="button"
            onClick={() => setShowAgents((value) => !value)}
            className="group flex w-full items-center justify-between text-left"
          >
            <div className="flex items-center gap-2">
              <Bot className="h-3 w-3 text-white/40 group-hover:text-white/60" />
              <h3 className="text-[9px] font-medium uppercase tracking-[0.15em] text-white/60">Active Agents</h3>
              <span className="ml-2 rounded bg-white/[0.03] px-2 py-0.5 text-[8px] font-medium tracking-widest text-white/40">
                4 Running
              </span>
            </div>
            <ChevronDown className={cn('h-4 w-4 text-white/20 transition-transform duration-300 group-hover:text-white/50', showAgents && 'rotate-180')} />
          </button>
          
          <div className={cn('grid transition-all duration-300 ease-in-out', showAgents ? 'grid-rows-[1fr] opacity-100 mt-3' : 'grid-rows-[0fr] opacity-0')}>
            <div className="overflow-hidden">
              <div className="grid grid-cols-1 gap-2 md:grid-cols-2 lg:grid-cols-4">
                {jobs.map((job) => (
                  <div key={job.title} className="flex flex-col gap-2.5 rounded-xl border border-white/[0.02] bg-white/[0.01] p-3.5 transition-colors hover:bg-white/[0.02]">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="line-clamp-2 text-xs font-medium leading-relaxed text-white/80">{job.title}</p>
                        <p className="mt-0.5 text-[9px] text-white/30">{job.owner}</p>
                      </div>
                      {job.status === 'active' ? (
                        <div className="relative flex h-2 w-2 shrink-0 items-center justify-center">
                          <span className="absolute h-full w-full animate-ping rounded-full bg-white/20"></span>
                          <span className="relative h-1 w-1 rounded-full bg-white/60"></span>
                        </div>
                      ) : null}
                    </div>
                    <div className="flex items-center justify-between">
                      <span className={cn('rounded px-1.5 py-0.5 text-[8px] font-medium uppercase tracking-widest', statusClasses(job.status))}>
                        {job.status}
                      </span>
                      <span className="text-[9px] font-medium text-white/30">{job.time}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </CommandCard>
      </div>
    </div>
  )
}
