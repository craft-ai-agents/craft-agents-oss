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
  { label: 'Momentum', value: 'Strong', detail: '+12.4k reach', tone: 'text-emerald-300' },
  { label: 'Audience', value: '+2.3%', detail: '+412 listeners', tone: 'text-sky-300' },
  { label: 'Campaign', value: 'On Track', detail: 'Phase 2 healthy', tone: 'text-white' },
  { label: 'Budget', value: 'Healthy', detail: '$4,250 available', tone: 'text-amber-200' },
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

const waveBars = Array.from({ length: 38 }, (_, index) => {
  const height = 42 + Math.round(Math.sin(index * 0.48) * 28 + Math.cos(index * 0.21) * 18)
  return Math.max(18, Math.min(92, height))
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
    <div className="mb-4 flex items-center justify-between border-b border-white/10 pb-3">
      <div className="flex items-center gap-2">
        <Icon className="h-3.5 w-3.5 text-orange-500" />
        <h3 className="font-mono text-[11px] font-semibold uppercase text-foreground/85">{title}</h3>
      </div>
      {meta ? <span className="font-mono text-[10px] uppercase text-foreground/35">{meta}</span> : null}
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
        'rounded-[8px] border border-white/10 bg-[#171717] p-5 shadow-minimal',
        className,
      )}
    >
      {children}
    </section>
  )
}

function priorityColor(priority: ApprovalPriority) {
  if (priority === 'high') return 'bg-orange-500'
  if (priority === 'medium') return 'bg-amber-300'
  return 'bg-slate-400'
}

function statusClasses(status: JobStatus) {
  if (status === 'active') return 'border-orange-500/30 bg-orange-500/10 text-orange-300'
  if (status === 'done') return 'border-emerald-400/20 bg-emerald-400/10 text-emerald-300'
  return 'border-white/10 bg-white/5 text-foreground/45'
}

export function ArtistCommandCenterHome() {
  const [showAgents, setShowAgents] = React.useState(false)

  return (
    <div className="h-full overflow-y-auto bg-[#080808] text-foreground">
      <div className="flex w-full flex-col gap-4 px-5 py-5 xl:px-7">
        <section className="relative min-h-[280px] overflow-hidden rounded-[8px] border border-white/10 bg-[#101010]">
          <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(8,8,8,0.98)_0%,rgba(8,8,8,0.88)_46%,rgba(255,69,0,0.08)_100%)]" />
          <div className="absolute bottom-0 right-10 top-16 hidden w-[34%] items-end justify-center gap-1 opacity-55 2xl:flex">
            {waveBars.map((height, index) => (
              <div
                key={index}
                className="w-1.5 rounded-t-[1px] bg-orange-600/80"
                style={{ height: `${height}%` }}
              />
            ))}
          </div>
          <div className="absolute bottom-10 right-12 hidden h-44 w-44 rounded-full border border-orange-500/10 bg-orange-500/5 xl:block" />

          <div className="relative z-10 flex min-h-[280px] flex-col justify-between p-6 lg:p-7">
            <div className="flex items-start justify-between gap-4">
              <div className="inline-flex flex-col border border-white/15 bg-white/5">
                <span className="bg-white/10 px-3 py-1 font-mono text-[10px] uppercase text-foreground/55">Mission active</span>
                <span className="px-3 py-1 text-center font-mono text-sm font-semibold text-white">A1</span>
              </div>
              <div className="text-right">
                <p className="font-mono text-[10px] font-semibold uppercase text-orange-500">Release phase</p>
                <p className="mt-1 font-mono text-xs uppercase text-foreground/70">Phase 2: Pre-save expansion</p>
              </div>
            </div>

            <div className="max-w-[680px]">
              <p className="mb-3 font-mono text-xs font-semibold uppercase text-orange-500">Current mission</p>
              <h1 className="text-4xl font-semibold leading-none text-white md:text-5xl xl:text-6xl">
                Midnight
                <br />
                Sun EP
              </h1>
              <p className="mt-4 max-w-2xl text-sm leading-6 text-white/58">
                Push the single from presave into release week with cover art, teaser clips, Spotify prep, and paid tests aligned.
              </p>
            </div>

            <div className="border-t border-white/10 pt-5">
              <div className="mb-5 grid gap-5 md:grid-cols-[auto_minmax(220px,360px)_minmax(240px,1fr)] md:items-end">
                <div>
                  <p className="mb-1 font-mono text-[10px] uppercase text-foreground/35">T-minus</p>
                  <p className="text-3xl font-light text-white">
                    14 <span className="text-base text-foreground/45">days</span>
                  </p>
                </div>
                <div>
                  <div className="mb-2 flex justify-between font-mono text-[10px] uppercase text-foreground/40">
                    <span>Progress</span>
                    <span>68%</span>
                  </div>
                  <div className="h-1 bg-white/12">
                    <div className="h-full w-[68%] bg-orange-500" />
                  </div>
                </div>
                <div className="max-w-md">
                  <p className="mb-1 font-mono text-[10px] uppercase text-foreground/35">Next critical move</p>
                  <p className="text-sm font-medium text-white">Approve cover art and lock teaser pack</p>
                </div>
              </div>

              <div className="flex flex-wrap gap-3">
                <button className="inline-flex h-10 items-center gap-2 rounded-[6px] bg-orange-500 px-4 text-sm font-semibold text-black transition hover:bg-orange-400">
                  Continue Mission
                  <ArrowRight className="h-4 w-4" />
                </button>
                <button className="inline-flex h-10 items-center rounded-[6px] border border-white/12 px-4 text-sm font-medium text-foreground/78 transition hover:border-white/24 hover:text-white">
                  Review Assets
                </button>
                <button className="inline-flex h-10 items-center rounded-[6px] border border-white/12 px-4 text-sm font-medium text-foreground/78 transition hover:border-white/24 hover:text-white">
                  Brief Team
                </button>
              </div>
            </div>
          </div>
        </section>

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
          <CommandCard className="p-4">
            <SectionTitle icon={Activity} title="State of Play" meta="Live" />
            <div className="grid grid-cols-2 gap-x-5 gap-y-4">
              {stateMetrics.map((metric) => (
                <div key={metric.label}>
                  <p className="font-mono text-[10px] uppercase text-white/34">{metric.label}</p>
                  <p className={cn('mt-1 text-base font-semibold', metric.tone)}>{metric.value}</p>
                  <p className="mt-1 truncate text-xs text-white/43">{metric.detail}</p>
                </div>
              ))}
            </div>
          </CommandCard>

          <CommandCard className="p-4">
            <SectionTitle icon={ShieldCheck} title="Approvals" meta="3" />
            <div className="divide-y divide-white/[0.07]">
              {approvals.map((approval) => (
                <button
                  key={approval.title}
                  className="group flex w-full items-center gap-3 py-3 text-left first:pt-0 last:pb-0"
                >
                  <span className={cn('h-2 w-2 rounded-full', priorityColor(approval.priority))} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-white">{approval.title}</span>
                    <span className="mt-0.5 block truncate text-xs text-white/42">{approval.detail}</span>
                  </span>
                  <ArrowRight className="h-4 w-4 text-white/25 transition group-hover:translate-x-0.5 group-hover:text-orange-300" />
                </button>
              ))}
            </div>
          </CommandCard>

          <CommandCard className="p-4">
            <SectionTitle icon={CalendarClock} title="Today" meta="Local" />
            <div className="relative space-y-4 pl-4 before:absolute before:bottom-1 before:left-[3px] before:top-1 before:w-px before:bg-white/10">
              {timeline.map((item) => (
                <div key={`${item.time}-${item.title}`} className="relative flex gap-4">
                  <span className="absolute -left-[15px] top-1.5 h-2 w-2 rounded-full border border-orange-500 bg-[#101010]" />
                  <span className="w-12 font-mono text-xs text-foreground/38">{item.time}</span>
                  <span>
                    <span className="block text-sm font-medium text-white/90">{item.title}</span>
                    <span className="font-mono text-[10px] uppercase text-foreground/35">{item.area}</span>
                  </span>
                </div>
              ))}
            </div>
          </CommandCard>
        </div>

        <CommandCard className="p-4">
          <button
            type="button"
            onClick={() => setShowAgents((value) => !value)}
            className="flex w-full items-center justify-between text-left"
          >
            <div className="flex items-center gap-2">
              <Bot className="h-3.5 w-3.5 text-orange-500" />
              <h3 className="font-mono text-[11px] font-semibold uppercase text-foreground/85">Active Agents</h3>
              <span className="rounded-full bg-white/[0.06] px-2 py-0.5 font-mono text-[10px] text-white/42">4 running</span>
            </div>
            <ChevronDown className={cn('h-4 w-4 text-white/35 transition', showAgents && 'rotate-180')} />
          </button>
          {showAgents ? (
            <div className="mt-4">
              <div className="grid grid-cols-1 overflow-hidden border border-white/[0.08] md:grid-cols-2">
                {jobs.map((job) => (
                  <div key={job.title} className="flex min-h-[92px] flex-col justify-between border-b border-white/[0.07] bg-black/18 p-4 odd:md:border-r md:[&:nth-last-child(-n+2)]:border-b-0">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-medium text-white">{job.title}</p>
                        <p className="mt-1 text-xs text-foreground/45">{job.owner}</p>
                      </div>
                      {job.status === 'done' ? (
                        <CheckCircle2 className="h-4 w-4 text-emerald-300" />
                      ) : job.status === 'queued' ? (
                        <Clock3 className="h-4 w-4 text-foreground/35" />
                      ) : (
                        <Zap className="h-4 w-4 text-orange-400" />
                      )}
                    </div>
                    <div className="flex items-end justify-between">
                      <span className={cn('rounded-[4px] border px-2 py-0.5 font-mono text-[10px] uppercase', statusClasses(job.status))}>
                        {job.status}
                      </span>
                      <span className="font-mono text-[10px] text-foreground/35">{job.time}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </CommandCard>
      </div>
    </div>
  )
}
