import * as React from 'react'
import { ArrowRight, Check, ClipboardList, Loader2, Sparkles, X } from 'lucide-react'
import { toast } from 'sonner'
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from '@/components/ui/drawer'
import { cn } from '@/lib/utils'
import {
  buildMissionBrief,
  extractMissionBrief,
  missionBriefMetadata,
  serializeMissionBriefBody,
  type MissionBrief,
  type MissionExtraction,
  type MissionReference,
  type MissionType,
} from '@/lib/mission-brief'
import type { ContextDocDTO, ContextDocMetadata } from '../../../shared/types'

const intakeQuestions = [
  'What are we building toward?',
  'What is the release or project called?',
  'Is there a date or rough timeline?',
  'What should this make people feel?',
  'What references should I understand?',
]

const missionTypes: MissionType[] = ['single', 'ep', 'album', 'video', 'tour', 'merch', 'campaign', 'other']
const missionFieldClass = 'w-full rounded-lg border border-white/[0.07] bg-black/25 px-3 py-2 text-sm text-white/78 outline-none placeholder:text-white/22 focus:border-orange-300/45'

type SaveMissionBrief = (input: {
  slug: string
  metadata: ContextDocMetadata
  body: string
}) => Promise<ContextDocDTO>

interface MissionBriefDrawerProps {
  open: boolean
  workspaceId: string
  mission: MissionBrief
  onOpenChange: (open: boolean) => void
  onSaved: (brief: MissionBrief) => void
  saveMissionBrief: SaveMissionBrief
}

export function MissionBriefDrawer({
  open,
  workspaceId,
  mission,
  onOpenChange,
  onSaved,
  saveMissionBrief,
}: MissionBriefDrawerProps) {
  const [questionIndex, setQuestionIndex] = React.useState(0)
  const [answer, setAnswer] = React.useState('')
  const [extraction, setExtraction] = React.useState<MissionExtraction | null>(null)
  const [draft, setDraft] = React.useState<Partial<MissionBrief>>(mission)
  const [saving, setSaving] = React.useState(false)

  React.useEffect(() => {
    setDraft(mission)
    setExtraction(null)
  }, [mission])

  const currentQuestion = intakeQuestions[Math.min(questionIndex, intakeQuestions.length - 1)]
  const editableBrief = React.useMemo(() => buildMissionBrief(workspaceId, draft), [draft, workspaceId])

  const analyzeAnswer = React.useCallback(() => {
    if (!answer.trim()) {
      toast.message('Add a little context first')
      return
    }
    const next = extractMissionBrief(answer, draft)
    setExtraction(next)
    setDraft(next.brief)
  }, [answer, draft])

  const goDeeper = React.useCallback(() => {
    if (answer.trim()) {
      const next = extractMissionBrief(answer, draft)
      setExtraction(next)
      setDraft(next.brief)
    }
    setAnswer('')
    setQuestionIndex((value) => Math.min(value + 1, intakeQuestions.length - 1))
  }, [answer, draft])

  const save = React.useCallback(async () => {
    const brief = buildMissionBrief(workspaceId, {
      ...draft,
      openQuestions: extraction?.missing ?? draft.openQuestions,
    })
    if (brief.status === 'empty') {
      toast.message('Nothing to save yet')
      return
    }
    setSaving(true)
    try {
      await saveMissionBrief({
        slug: 'mission-brief',
        metadata: missionBriefMetadata(brief),
        body: serializeMissionBriefBody(brief),
      })
      onSaved(brief)
      toast.success('Mission brief saved')
      onOpenChange(false)
    } catch (err) {
      toast.error('Failed to save mission brief', {
        description: err instanceof Error ? err.message : String(err),
      })
    } finally {
      setSaving(false)
    }
  }, [draft, extraction?.missing, onOpenChange, onSaved, saveMissionBrief, workspaceId])

  return (
    <Drawer open={open} onOpenChange={onOpenChange} direction="right">
      <DrawerContent
        overlay={<div className="fixed inset-0 z-modal bg-black/20 backdrop-blur-[1px]" />}
        className="w-[min(480px,100vw)] !max-w-[min(480px,100vw)] border-l border-white/[0.08] bg-[#070707] text-white shadow-strong sm:!max-w-[480px]"
      >
        <DrawerHeader className="border-b border-white/[0.06] px-5 py-4 text-left">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="mb-2 flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.18em] text-orange-300/70">
                <ClipboardList className="h-3.5 w-3.5" />
                Mission Brief
              </div>
              <DrawerTitle className="text-xl font-medium tracking-tight text-white">
                {mission.title || 'Create Mission'}
              </DrawerTitle>
              <DrawerDescription className="mt-1 text-sm leading-5 text-white/45">
                Talk naturally. The system structures it before anything is saved.
              </DrawerDescription>
            </div>
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-white/[0.08] bg-white/[0.03] text-white/50 hover:bg-white/[0.08] hover:text-white"
              aria-label="Close mission brief"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </DrawerHeader>

        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-5 py-4">
          <section className="rounded-2xl border border-white/[0.06] bg-white/[0.025] p-4">
            <div className="mb-3 flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-orange-300/80" />
              <h3 className="text-sm font-medium text-white/90">{currentQuestion}</h3>
            </div>
            <textarea
              value={answer}
              onChange={(event) => setAnswer(event.target.value)}
              placeholder="Example: It is a dark pop single about leaving someone but still missing them. I want it to feel like night driving, neon, and freedom with a little withdrawal..."
              className="min-h-[132px] w-full resize-none rounded-xl border border-white/[0.07] bg-black/30 px-3 py-3 text-sm leading-5 text-white/82 outline-none placeholder:text-white/22 focus:border-orange-300/45"
            />
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={analyzeAnswer}
                className="inline-flex h-9 items-center gap-2 rounded-full bg-white/90 px-4 text-xs font-medium text-black hover:bg-white"
              >
                Structure Answer
                <ArrowRight className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={goDeeper}
                className="inline-flex h-9 items-center rounded-full border border-white/[0.08] bg-white/[0.03] px-4 text-xs font-medium text-white/65 hover:bg-white/[0.07] hover:text-white"
              >
                Go Deeper
              </button>
            </div>
          </section>

          <section className="mt-4 rounded-2xl border border-white/[0.06] bg-[#0b0b0b] p-4">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-[10px] font-medium uppercase tracking-[0.18em] text-white/50">
                Extracted Structure
              </h3>
              <span className="rounded-full border border-white/[0.06] px-2.5 py-1 text-[10px] text-white/42">
                {editableBrief.completeness}% complete
              </span>
            </div>

            <div className="grid gap-3">
              <Field label="Type">
                <select
                  value={draft.missionType ?? ''}
                  onChange={(event) => setDraft((value) => ({ ...value, missionType: event.target.value as MissionType || undefined }))}
                  className={missionFieldClass}
                >
                  <option value="">Unknown</option>
                  {missionTypes.map((type) => (
                    <option key={type} value={type}>{type}</option>
                  ))}
                </select>
              </Field>
              <Field label="Title">
                <input value={draft.title ?? ''} onChange={(event) => setDraft((value) => ({ ...value, title: event.target.value }))} className={missionFieldClass} />
              </Field>
              <Field label="Goal">
                <textarea value={draft.goal ?? ''} onChange={(event) => setDraft((value) => ({ ...value, goal: event.target.value }))} className={cn(missionFieldClass, 'min-h-[72px] resize-none')} />
              </Field>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Timeline">
                  <input value={draft.timeline ?? ''} onChange={(event) => setDraft((value) => ({ ...value, timeline: event.target.value }))} className={missionFieldClass} />
                </Field>
                <Field label="Phase">
                  <input value={draft.phase ?? ''} onChange={(event) => setDraft((value) => ({ ...value, phase: event.target.value }))} className={missionFieldClass} />
                </Field>
              </div>
              <Field label="Mood">
                <input value={draft.mood ?? ''} onChange={(event) => setDraft((value) => ({ ...value, mood: event.target.value }))} className={missionFieldClass} />
              </Field>
              <Field label="Visual World">
                <input value={draft.visualWorld ?? ''} onChange={(event) => setDraft((value) => ({ ...value, visualWorld: event.target.value }))} className={missionFieldClass} />
              </Field>
              <Field label="Target Listener">
                <input value={draft.targetListener ?? ''} onChange={(event) => setDraft((value) => ({ ...value, targetListener: event.target.value }))} className={missionFieldClass} />
              </Field>
              <Field label="References">
                <input
                  value={(draft.references ?? []).map((ref) => ref.value).join(', ')}
                  onChange={(event) => setDraft((value) => ({ ...value, references: parseReferences(event.target.value) }))}
                  className={missionFieldClass}
                  placeholder="artists, songs, visuals"
                />
              </Field>
              <Field label="Channels">
                <input
                  value={(draft.channels ?? []).join(', ')}
                  onChange={(event) => setDraft((value) => ({ ...value, channels: parseList(event.target.value) }))}
                  className={missionFieldClass}
                  placeholder="TikTok, Instagram, Spotify"
                />
              </Field>
            </div>
          </section>

          {extraction ? (
            <section className="mt-4 rounded-2xl border border-emerald-300/[0.12] bg-emerald-400/[0.045] p-4">
              <h3 className="mb-2 text-[10px] font-medium uppercase tracking-[0.18em] text-emerald-200/70">
                Agent Read
              </h3>
              <pre className="whitespace-pre-wrap text-xs leading-5 text-white/68">{extraction.enhancedSummary}</pre>
            </section>
          ) : null}
        </div>

        <div className="border-t border-white/[0.06] px-5 py-4">
          <div className="flex gap-2">
            <button
              type="button"
              onClick={save}
              disabled={saving}
              className="inline-flex h-10 flex-1 items-center justify-center gap-2 rounded-full bg-orange-500 px-4 text-sm font-medium text-black hover:bg-orange-400 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              Accept Brief
            </button>
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="inline-flex h-10 items-center justify-center rounded-full border border-white/[0.08] bg-white/[0.03] px-4 text-sm font-medium text-white/62 hover:bg-white/[0.07] hover:text-white"
            >
              Skip
            </button>
          </div>
        </div>
      </DrawerContent>
    </Drawer>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="grid gap-1.5">
      <span className="text-[9px] font-medium uppercase tracking-[0.18em] text-white/32">{label}</span>
      {children}
    </label>
  )
}

function parseList(value: string): string[] {
  return value.split(',').map((item) => item.trim()).filter(Boolean)
}

function parseReferences(value: string): MissionReference[] {
  return parseList(value).map((item) => ({ type: 'other', value: item }))
}
