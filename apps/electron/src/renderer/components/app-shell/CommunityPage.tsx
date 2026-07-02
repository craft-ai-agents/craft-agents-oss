import * as React from 'react'
import {
  ArrowRight,
  CheckCircle2,
  Clock3,
  Download,
  Loader2,
  Mail,
  Plus,
  Send,
  Sparkles,
  Upload,
  Users,
} from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { navigate, routes } from '@/lib/navigate'
import type { CommunityContactRecord, CommunitySegment, CommunityState } from '../../../shared/types'

type SegmentFilter = CommunitySegment | 'all'
type FanDraft = {
  name: string
  email: string
  segment: CommunitySegment
  city: string
  notes: string
  tags: string
}

interface CommunityPageProps {
  workspaceId: string
}

const segmentFilters: Array<{ id: SegmentFilter; label: string }> = [
  { id: 'all', label: 'All Fans' },
  { id: 'vip', label: 'VIPs' },
  { id: 'local', label: 'Local' },
  { id: 'buyers', label: 'Buyers' },
  { id: 'street-team', label: 'Street Team' },
  { id: 'general', label: 'General' },
]

const emptyDraft: FanDraft = {
  name: '',
  email: '',
  segment: 'general',
  city: '',
  notes: '',
  tags: '',
}

export function CommunityPage({ workspaceId }: CommunityPageProps) {
  const [activeSegment, setActiveSegment] = React.useState<SegmentFilter>('all')
  const [draft, setDraft] = React.useState<FanDraft>(emptyDraft)
  const [community, setCommunity] = React.useState<CommunityState | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [saving, setSaving] = React.useState(false)

  const refreshCommunity = React.useCallback(async () => {
    setLoading(true)
    try {
      setCommunity(await window.electronAPI.getCommunity(workspaceId))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      setLoading(false)
    }
  }, [workspaceId])

  React.useEffect(() => {
    void refreshCommunity()
  }, [refreshCommunity])

  const contacts = community?.contacts.filter((fan) => !fan.deletedAt) ?? []
  const emailJobs = community?.emailJobs.filter((job) => !job.deletedAt) ?? []
  const visibleFans = React.useMemo(
    () => activeSegment === 'all'
      ? contacts
      : contacts.filter((fan) => fan.segments.includes(activeSegment)),
    [activeSegment, contacts],
  )

  const addFan = React.useCallback(async () => {
    if (!draft.name.trim() || !draft.email.trim()) {
      toast.error('Add a name and email first.')
      return
    }
    setSaving(true)
    try {
      setCommunity(await window.electronAPI.addCommunityContact(workspaceId, {
        name: draft.name,
        email: draft.email,
        segment: draft.segment,
        source: 'manual',
        city: draft.city,
        notes: draft.notes,
        tags: draft.tags.split(/[;,]/).map((tag) => tag.trim()).filter(Boolean),
        consentStatus: 'unknown',
      })
      )
      setDraft(emptyDraft)
      toast.success('Fan saved to Community')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      setSaving(false)
    }
  }, [draft, workspaceId])

  const importCsv = React.useCallback(async () => {
    try {
      const paths = await window.electronAPI.openFileDialog()
      const path = paths[0]
      if (!path) return
      const csv = await window.electronAPI.readFile(path)
      setCommunity(await window.electronAPI.importCommunityCsv(workspaceId, {
        csv,
        filename: path.split('/').pop(),
        basis: 'unknown',
      })
      )
      toast.success('CSV imported. Unknown-consent contacts are held out of broadcasts.')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    }
  }, [workspaceId])

  const queueEmailJob = React.useCallback(async (audienceLabel: string, segmentIds: string[]) => {
    try {
      setCommunity(await window.electronAPI.createCommunityEmailJob(workspaceId, {
        title: `${audienceLabel} email`,
        segmentIds,
        purpose: 'newsletter',
        subject: `${audienceLabel} update`,
        bodyMarkdown: '',
        transportProvider: 'gmail',
      })
      )
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    }
  }, [workspaceId])

  const draftEmail = React.useCallback((audience: string, segmentIds: string[]) => {
    void queueEmailJob(audience, segmentIds)
    navigate(routes.action.newSession({
      name: 'Community email draft',
      input: `Draft a short fan email for ${audience}. Keep it warm, direct, and ready to send through Gmail.`,
    }))
  }, [queueEmailJob])

  const selectedSegmentIds = activeSegment === 'all'
    ? ['vip', 'local', 'buyers', 'street-team', 'general']
    : [activeSegment]
  const activeAudience = activeSegment === 'all' ? 'all fans' : `${segmentLabel(activeSegment)} fans`
  const vipCount = contacts.filter((fan) => fan.segments.includes('vip')).length
  const emailReady = contacts.filter((fan) => fan.email?.includes('@') && fan.consentStatus === 'opted-in').length

  return (
    <div className="runneros-glass-route h-full overflow-y-auto">
      <div className="mx-auto min-h-full w-full max-w-[1500px] px-5 py-4 xl:px-8 xl:py-5">
        <header className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-white/[0.06] bg-white/[0.025] px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-white/46">
              <Users className="h-3.5 w-3.5 text-orange-300/75" />
              Fan Base
            </div>
            <h1 className="text-4xl font-medium tracking-tight text-white/95">Community</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-white/42">
              Fans, segments, emails, and outreach jobs for the artist.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => navigate(routes.view.sourcesApi('gmail'))}
              className="inline-flex h-9 items-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.035] px-4 text-xs font-medium text-white/68 transition-colors hover:bg-white/[0.06]"
            >
              <Mail className="h-3.5 w-3.5" />
              Connect Gmail
            </button>
            <button
              type="button"
              onClick={() => void importCsv()}
              className="inline-flex h-9 items-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.035] px-4 text-xs font-medium text-white/68 transition-colors hover:bg-white/[0.06]"
            >
              <Upload className="h-3.5 w-3.5" />
              Import CSV
            </button>
            <button
              type="button"
              onClick={() => draftEmail(activeAudience, selectedSegmentIds)}
              className="inline-flex h-9 items-center gap-2 rounded-full bg-[#f97316]/85 px-4 text-xs font-medium text-white transition-colors hover:bg-[#f97316]"
            >
              <Sparkles className="h-3.5 w-3.5" />
              Draft Email
            </button>
          </div>
        </header>

        <div className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-4">
          <MetricCard label="Fans" value={String(contacts.length)} detail={`${vipCount} VIP`} />
          <MetricCard label="Email Ready" value={String(emailReady)} detail="opted-in addresses" />
          <MetricCard label="Segments" value="5" detail="VIP, local, buyers, street, general" />
          <MetricCard label="Queued" value={String(emailJobs.length)} detail="email jobs" />
        </div>

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
          <section className="rounded-[18px] border border-white/[0.055] bg-[#0A0A0A]/82 p-3">
            <div className="mb-3 flex flex-col gap-3 border-b border-white/[0.045] pb-3 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <h2 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-white/50">Fan List</h2>
                <p className="mt-1 text-xs text-white/32">Email contacts saved as team-safe community records.</p>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {segmentFilters.map((segment) => (
                  <button
                    key={segment.id}
                    type="button"
                    onClick={() => setActiveSegment(segment.id)}
                    className={cn(
                      'h-7 rounded-full px-3 text-[11px] font-medium transition-colors',
                      activeSegment === segment.id
                        ? 'bg-white/[0.09] text-white/84'
                        : 'bg-white/[0.025] text-white/40 hover:bg-white/[0.05] hover:text-white/68',
                    )}
                  >
                    {segment.label}
                  </button>
                ))}
              </div>
            </div>

            {loading ? (
              <div className="flex h-64 items-center justify-center text-sm text-white/40">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Loading Community...
              </div>
            ) : visibleFans.length ? (
              <div className="space-y-2">
                {visibleFans.map((fan) => (
                  <FanRow key={fan.id} fan={fan} onDraft={() => draftEmail(`${fan.name ?? 'this fan'} and similar fans`, fan.segments)} />
                ))}
              </div>
            ) : (
              <div className="flex h-64 flex-col items-center justify-center rounded-[14px] border border-dashed border-white/[0.06] bg-white/[0.012] text-center">
                <Users className="mb-3 h-6 w-6 text-white/14" />
                <p className="text-sm font-medium text-white/48">No fans saved yet.</p>
                <p className="mt-1 text-xs text-white/30">Add the first contact from the panel on the right.</p>
              </div>
            )}
          </section>

          <aside className="space-y-4">
            <section className="rounded-[18px] border border-white/[0.055] bg-[#0A0A0A]/82 p-3">
              <div className="mb-3 flex items-center gap-2 border-b border-white/[0.045] pb-2.5">
                <Plus className="h-3.5 w-3.5 text-white/40" />
                <h2 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-white/50">Add Fan</h2>
              </div>
              <div className="space-y-2">
                <Input value={draft.name} placeholder="Name" onChange={(name) => setDraft((value) => ({ ...value, name }))} />
                <Input value={draft.email} placeholder="Email" onChange={(email) => setDraft((value) => ({ ...value, email }))} />
                <select
                  value={draft.segment}
                  onChange={(event) => setDraft((value) => ({ ...value, segment: event.target.value as CommunitySegment }))}
                  className="h-9 w-full rounded-[10px] border border-white/[0.06] bg-white/[0.025] px-3 text-xs text-white/70 outline-none"
                >
                  {segmentFilters.filter((segment) => segment.id !== 'all').map((segment) => (
                    <option key={segment.id} value={segment.id}>{segment.label}</option>
                  ))}
                </select>
                <Input value={draft.city} placeholder="City" onChange={(city) => setDraft((value) => ({ ...value, city }))} />
                <Input value={draft.tags} placeholder="Tags" onChange={(tags) => setDraft((value) => ({ ...value, tags }))} />
                <textarea
                  value={draft.notes}
                  placeholder="Notes"
                  onChange={(event) => setDraft((value) => ({ ...value, notes: event.target.value }))}
                  className="min-h-20 w-full resize-none rounded-[10px] border border-white/[0.06] bg-white/[0.025] px-3 py-2 text-xs text-white/70 outline-none placeholder:text-white/25"
                />
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => void addFan()}
                  className="inline-flex h-9 w-full items-center justify-center gap-2 rounded-[10px] bg-[#f97316]/85 text-xs font-medium text-white transition-colors hover:bg-[#f97316] disabled:cursor-wait disabled:opacity-50"
                >
                  {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
                  Save Fan
                </button>
              </div>
            </section>

            <section className="rounded-[18px] border border-white/[0.055] bg-[#0A0A0A]/82 p-3">
              <div className="mb-3 flex items-center justify-between border-b border-white/[0.045] pb-2.5">
                <div className="flex items-center gap-2">
                  <Send className="h-3.5 w-3.5 text-white/40" />
                  <h2 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-white/50">Email Queue</h2>
                </div>
                <span className="text-[10px] tabular-nums text-white/28">{emailJobs.length}</span>
              </div>
              <div className="space-y-2">
                {emailJobs.length ? emailJobs.map((email) => (
                  <button
                    key={email.id}
                    type="button"
                    onClick={() => draftEmail(email.title, email.audience.segmentIds)}
                    className="group w-full rounded-[13px] border border-white/[0.055] bg-white/[0.025] px-3 py-2.5 text-left transition-colors hover:bg-white/[0.05]"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <p className="line-clamp-1 text-sm font-medium leading-5 text-white/78">{email.title}</p>
                      <ArrowRight className="h-3.5 w-3.5 text-white/20 transition-colors group-hover:text-white/55" />
                    </div>
                    <div className="mt-2 flex items-center justify-between gap-2 text-[10px] uppercase tracking-[0.12em] text-white/28">
                      <span>{email.audience.estimatedRecipients} ready</span>
                      <span>{email.status}</span>
                    </div>
                  </button>
                )) : (
                  <div className="rounded-[14px] border border-dashed border-white/[0.06] bg-white/[0.012] px-3 py-6 text-center text-xs text-white/30">
                    No email jobs yet.
                  </div>
                )}
              </div>
            </section>

            <section className="rounded-[18px] border border-white/[0.055] bg-[#0A0A0A]/82 p-3">
              <div className="mb-3 flex items-center gap-2 border-b border-white/[0.045] pb-2.5">
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-300/65" />
                <h2 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-white/50">Next Moves</h2>
              </div>
              <div className="space-y-2">
                <ActionButton icon={Download} label="Export segment" onClick={() => toast.info('Segment export is next.')} />
                <ActionButton icon={Clock3} label="Schedule send" onClick={() => toast.info('Scheduling will use Gmail once connected.')} />
              </div>
            </section>
          </aside>
        </div>
      </div>
    </div>
  )
}

function MetricCard({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="rounded-[16px] border border-white/[0.05] bg-[#0A0A0A]/82 px-4 py-3">
      <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-white/34">{label}</p>
      <div className="mt-2 flex items-end justify-between gap-3">
        <p className="text-3xl font-medium tracking-tight text-white/88">{value}</p>
        <p className="pb-1 text-right text-xs text-white/34">{detail}</p>
      </div>
    </div>
  )
}

function segmentLabel(segment: string): string {
  return segmentFilters.find((item) => item.id === segment)?.label ?? segment
}

function FanRow({ fan, onDraft }: { fan: CommunityContactRecord; onDraft: () => void }) {
  const primarySegment = fan.segments[0] ?? 'general'
  return (
    <div className="grid grid-cols-1 gap-3 rounded-[13px] border border-white/[0.045] bg-white/[0.018] px-3 py-3 transition-colors hover:bg-white/[0.035] lg:grid-cols-[minmax(0,1.35fr)_120px_120px_minmax(0,1fr)_120px] lg:items-center">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-white/78">{fan.name ?? 'Unnamed fan'}</p>
        <p className="mt-1 truncate text-xs text-white/36">{fan.email ?? fan.emailHash}</p>
      </div>
      <Badge>{segmentLabel(primarySegment)}</Badge>
      <p className="text-xs text-white/44">{fan.city ?? 'No city'}</p>
      <div className="min-w-0">
        <p className="truncate text-xs text-white/54">{fan.source}</p>
        <p className="mt-1 truncate text-[11px] text-white/30">{fan.notes ?? 'No notes yet'}</p>
      </div>
      <button
        type="button"
        onClick={onDraft}
        className="inline-flex h-8 items-center justify-center gap-2 rounded-[10px] bg-white/[0.035] px-3 text-xs font-medium text-white/58 transition-colors hover:bg-white/[0.065] hover:text-white/85"
      >
        <Mail className="h-3.5 w-3.5" />
        Draft
      </button>
    </div>
  )
}

function Input({ value, placeholder, onChange }: { value: string; placeholder: string; onChange: (value: string) => void }) {
  return (
    <input
      value={value}
      placeholder={placeholder}
      onChange={(event) => onChange(event.target.value)}
      className="h-9 w-full rounded-[10px] border border-white/[0.06] bg-white/[0.025] px-3 text-xs text-white/70 outline-none placeholder:text-white/25"
    />
  )
}

function Badge({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex h-7 w-fit items-center rounded-full bg-white/[0.035] px-2.5 text-[10px] font-medium uppercase tracking-[0.12em] text-white/42">
      {children}
    </span>
  )
}

function ActionButton({
  icon: Icon,
  label,
  onClick,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-9 w-full items-center gap-2 rounded-[11px] bg-white/[0.025] px-3 text-left text-xs font-medium text-white/55 transition-colors hover:bg-white/[0.055] hover:text-white/80"
    >
      <Icon className="h-3.5 w-3.5" />
      {label}
    </button>
  )
}
