/**
 * CloudRunsChip — entry point for cloud runs (PRD docs/cloud-runs-prd.md, G3).
 *
 * Self-contained (like BackgroundFinishedChip): fetches config on mount and
 * keeps the entry point available when Cloud Runs are disabled or the bridge is
 * unavailable, so the dialog can explain the state and offer retry.
 */
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Cloud, Download, FileText, Link2, MoreHorizontal, RefreshCw, Rocket, XCircle } from 'lucide-react'
import { Markdown } from '@craft-agent/ui'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { useRegisterModal } from '@/context/ModalContext'

type RunState = 'queued' | 'running' | 'done' | 'failed' | 'cancelled'
interface ListedRun {
  id: string
  name: string
  createdAt: number
  topic?: string
  sessionId?: string
  status: {
    state: RunState
    failureReason?: string
    progress?: { completed: number; total: number }
    usage?: { promptTokens: number; completionTokens: number; cpuMs?: number }
  } | null
}

interface CloudRunsChipProps {
  sessionId: string
}

const POLL_MS = 5_000

/** Compact "12.3k tok · 4.2k out · 3m40s" ledger line for the runs list. */
function formatUsage(promptTokens: number, completionTokens: number, cpuMs?: number): string {
  const tok = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n))
  const cpu = cpuMs && cpuMs > 0 ? ` · ${Math.floor(cpuMs / 60000)}m${Math.round((cpuMs % 60000) / 1000)}s` : ''
  return `${tok(promptTokens)}+${tok(completionTokens)} tok${cpu}`
}

type Availability = 'loading' | 'enabled' | 'disabled' | 'unavailable'

/**
 * Probe configuration separately from the dialog so a temporarily unavailable
 * bridge does not remove the cloud entry point or strand the user without a
 * retry path.
 */
export function CloudRunsChip({ sessionId }: CloudRunsChipProps) {
  const [availability, setAvailability] = React.useState<Availability>('loading')

  const refreshAvailability = React.useCallback(async () => {
    try {
      const config = await window.electronAPI?.getCloudRunsConfig?.()
      setAvailability(config?.enabled === true ? 'enabled' : config ? 'disabled' : 'unavailable')
    } catch {
      setAvailability('unavailable')
    }
  }, [])

  React.useEffect(() => {
    void refreshAvailability()
  }, [refreshAvailability])

  return (
    <CloudRunsChipInner
      sessionId={sessionId}
      availability={availability}
      onRetryAvailability={refreshAvailability}
    />
  )
}

function CloudRunsChipInner({
  sessionId,
  availability,
  onRetryAvailability,
}: CloudRunsChipProps & {
  availability: Availability
  onRetryAvailability: () => Promise<void>
}) {
  const { t } = useTranslation()
  const [open, setOpen] = React.useState(false)
  const [runs, setRuns] = React.useState<ListedRun[]>([])
  const [topic, setTopic] = React.useState('')
  const [kind, setKind] = React.useState<'research' | 'competitor' | 'literature' | 'vendor'>('research')
  const [personas, setPersonas] = React.useState(false)
  const [estimatedTokens, setEstimatedTokens] = React.useState<number | null>(null)
  const [preview, setPreview] = React.useState<{ title: string; content: string } | null>(null)
  const [forkTarget, setForkTarget] = React.useState<string | null>(null)
  const [forkQuestion, setForkQuestion] = React.useState('')
  const [eventsByRun, setEventsByRun] = React.useState<Record<string, { t: number; message: string }[]>>({})
  const [schedules, setSchedules] = React.useState<{ id: string; topic: string; everyHours: number; sessionId: string; enabled: boolean; lastFireAt?: number }[]>([])
  const [schedOpen, setSchedOpen] = React.useState(false)
  const [newSched, setNewSched] = React.useState({ topic: '', everyHours: '24' })
  const [busy, setBusy] = React.useState<string | null>(null)
  const [refreshError, setRefreshError] = React.useState<string | null>(null)
  const isAvailable = availability === 'enabled'
  useRegisterModal(open, () => setOpen(false))

  const refresh = React.useCallback(async () => {
    try {
      const result = await window.electronAPI.listCloudRuns()
      setRuns(result.runs)
      setRefreshError(null)
    } catch (error) {
      setRefreshError(error instanceof Error ? error.message : String(error))
    }
  }, [])

  // F13: fetch the usage-median estimate once when Cloud Runs are available.
  React.useEffect(() => {
    if (!isAvailable) return
    window.electronAPI
      .getCloudRunsConfig()
      .then((cfg) => setEstimatedTokens(cfg.estimatedRunTokens ?? null))
      .catch(() => null)
  }, [isAvailable])

  React.useEffect(() => {
    if (!open || !isAvailable) return
    void refresh()
    window.electronAPI.listCloudRunSchedules?.().then(setSchedules).catch(() => null)
    const timer = setInterval(() => void refresh(), POLL_MS)
    return () => clearInterval(timer)
  }, [isAvailable, open, refresh])

  // F14: pull event tails for rows currently running (cheap, follows the 5s dialog poll).
  React.useEffect(() => {
    if (!open || !isAvailable) return
    const running = runs.filter((run) => run.status && (run.status.state === 'running' || run.status.state === 'queued'))
    for (const run of running) {
      window.electronAPI
        .getCloudRunEvents({ runId: run.id })
        .then((events) => setEventsByRun((previous) => ({ ...previous, [run.id]: events })))
        .catch(() => null)
    }
  }, [isAvailable, open, runs])

  // Background poll while the app is open: surfaces active runs on the
  // chip and toasts when a run finishes (PRD: resumption after close
  // is covered because the list survives server-side).
  const lastStates = React.useRef<Map<string, RunState>>(new Map())
  React.useEffect(() => {
    if (!isAvailable) return
    const timer = setInterval(async () => {
      try {
        const result = await window.electronAPI.listCloudRuns()
        setRuns(result.runs)
        for (const run of result.runs) {
          const prev = lastStates.current.get(run.id)
          const next = run.status?.state
          if (prev && next && prev !== next && next === 'done' && !open) {
            toast.success(t('cloudRuns.finished', { name: run.name }))
          }
          if (next) lastStates.current.set(run.id, next)
        }
      } catch { /* background status failures do not erase a visible refresh error */ }
    }, 30_000)
    return () => clearInterval(timer)
  }, [isAvailable, open, t])

  const activeCount = runs.filter((r) => r.status && (r.status.state === 'running' || r.status.state === 'queued')).length
  const doneCount = runs.filter((r) => r.status?.state === 'done').length

  const act = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key)
    try {
      await fn()
    } catch (error) {
      toast.error(t('cloudRuns.error'), { description: error instanceof Error ? error.message : String(error) })
    } finally {
      setBusy(null)
      void refresh()
    }
  }

  const prefillFromSession = () =>
    act('prefill', async () => {
      const result = await window.electronAPI.sessionTopicCloudRun({ sessionId })
      if (result.topic) setTopic(result.topic)
    })

  const tokShort = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n))

  return (
    <>
      <button
        type="button"
        aria-label={t('cloudRuns.open')}
        title={t('cloudRuns.open')}
        onClick={() => setOpen(true)}
        className="absolute top-2 right-2 z-20 flex h-6 items-center gap-1 rounded-full border border-border/40 bg-background px-2 text-xs text-muted-foreground/80 shadow-none hover:border-border/50 hover:bg-muted hover:text-muted-foreground"
      >
        {availability === 'loading' || activeCount > 0 ? <RefreshCw className="h-3 w-3 animate-spin" /> : <Cloud className="h-3 w-3" />}
        {activeCount > 0 ? t('cloudRuns.active', { count: activeCount }) : t('cloudRuns.open')}
        {doneCount > 0 && activeCount === 0 ? ` · ${doneCount}` : ''}
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="flex max-h-[calc(100dvh-2rem)] min-h-0 max-w-2xl flex-col gap-0 overflow-hidden p-0">
          <DialogHeader className="shrink-0 border-b border-border/50 px-6 py-4">
            <DialogTitle className="min-w-0 whitespace-normal break-words">{t('cloudRuns.title')}</DialogTitle>
          </DialogHeader>

          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-6 py-4">
            {availability === 'loading' && (
              <div role="status" className="rounded-md border border-border/60 px-3 py-2 text-sm text-muted-foreground">
                {t('common.loading')}
              </div>
            )}
            {availability === 'disabled' && (
              <div role="status" className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border/60 px-3 py-2 text-sm">
                <span className="min-w-0 whitespace-normal break-words">{t('automations.statusDisabled')}</span>
                <Button size="sm" variant="outline" onClick={() => void onRetryAvailability()}>
                  {t('common.retry')}
                </Button>
              </div>
            )}
            {availability === 'unavailable' && (
              <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-destructive/40 px-3 py-2 text-sm text-destructive">
                <span className="min-w-0 whitespace-normal break-words">{t('common.unavailable')}</span>
                <Button size="sm" variant="outline" onClick={() => void onRetryAvailability()}>
                  {t('common.retry')}
                </Button>
              </div>
            )}
            {refreshError && (
              <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-destructive/40 px-3 py-2 text-sm text-destructive">
                <span className="min-w-0 whitespace-normal break-words">{refreshError}</span>
                <Button size="sm" variant="outline" onClick={() => void refresh()}>
                  {t('common.retry')}
                </Button>
              </div>
            )}

            <div className="space-y-2 rounded-lg border border-border/60 bg-muted/20 p-3">
              <div className="text-xs font-medium text-muted-foreground">{t('cloudRuns.sectionNewRun')}</div>
              <div className="flex flex-wrap gap-2">
                <select
                  aria-label={t('cloudRuns.preset')}
                  className="h-9 rounded-md border border-border bg-background px-1.5 text-xs"
                  disabled={!isAvailable}
                  value={kind}
                  onChange={(e) => setKind(e.target.value as typeof kind)}
                >
                  <option value="research">{t('cloudRuns.presetResearch')}</option>
                  <option value="competitor">{t('cloudRuns.presetCompetitor')}</option>
                  <option value="literature">{t('cloudRuns.presetLiterature')}</option>
                  <option value="vendor">{t('cloudRuns.presetVendor')}</option>
                </select>
                <Input
                  className="min-w-[12rem] flex-1 border-border"
                  disabled={!isAvailable}
                  value={topic}
                  onChange={(e) => setTopic(e.target.value)}
                  placeholder={t('cloudRuns.topicPlaceholder')}
                  onKeyDown={(e) => {
                    if (isAvailable && e.key === 'Enter' && topic.trim()) {
                      void act('submit', async () => {
                        await window.electronAPI.submitCloudRun({ topic: topic.trim(), sessionId, kind, personas })
                        setTopic('')
                        toast.success(t('cloudRuns.submitted'))
                      })
                    }
                  }}
                />
                <label className="flex min-w-0 items-center gap-1 whitespace-normal break-words text-xs text-muted-foreground" title={t('cloudRuns.personasHint')}>
                  <input disabled={!isAvailable} type="checkbox" checked={personas} onChange={(e) => setPersonas(e.target.checked)} />
                  {t('cloudRuns.personas')}
                </label>
                <Button
                  aria-label={t('cloudRuns.prefill')}
                  size="sm"
                  variant="ghost"
                  disabled={!isAvailable || busy === 'prefill'}
                  onClick={() => void prefillFromSession()}
                >
                  ✦
                </Button>
                <Button
                  disabled={!isAvailable || !topic.trim() || busy === 'submit'}
                  onClick={() =>
                    void act('submit', async () => {
                      await window.electronAPI.submitCloudRun({ topic: topic.trim(), sessionId, kind, personas })
                      setTopic('')
                      toast.success(t('cloudRuns.submitted'))
                    })
                  }
                >
                  <Rocket className="mr-1 h-4 w-4" />
                  {t('cloudRuns.newRun')}
                </Button>
              </div>
              <p className="min-w-0 whitespace-normal break-words text-[11px] text-muted-foreground">{t('cloudRuns.topicHelp')}</p>
              {estimatedTokens !== null && (
                <p className="min-w-0 whitespace-normal break-words text-xs text-muted-foreground">
                  {t('cloudRuns.estimate', { tokens: tokShort(estimatedTokens) })}
                </p>
              )}
            </div>

            <div className="space-y-1">
              {runs.length === 0 && (
                <div className="flex flex-col items-center justify-center gap-3 py-10 text-center">
                  <div className="flex h-12 w-12 items-center justify-center rounded-full border border-dashed border-border/70 bg-muted/30">
                    <Cloud className="h-5 w-5 text-muted-foreground/70" />
                  </div>
                  <p className="min-w-0 whitespace-normal break-words text-sm text-muted-foreground">{t('cloudRuns.empty')}</p>
                  <Button
                    size="sm"
                    disabled={!isAvailable || !topic.trim() || busy === 'submit'}
                    onClick={() => {
                      if (!topic.trim()) {
                        toast.message(t('cloudRuns.topicPlaceholder'))
                        return
                      }
                      void act('submit', async () => {
                        await window.electronAPI.submitCloudRun({ topic: topic.trim(), sessionId, kind, personas })
                        setTopic('')
                        toast.success(t('cloudRuns.submitted'))
                      })
                    }}
                  >
                    <Rocket className="mr-1 h-4 w-4" />
                    {t('cloudRuns.newRun')}
                  </Button>
                </div>
              )}
              {runs.map((run) => {
                const state = run.status?.state
                const progress = run.status?.progress
                const hasActions = state === 'running' || state === 'queued' || state === 'failed' || state === 'done'
                return (
                  <div key={run.id} className="flex items-start gap-2 rounded-md border border-border/50 px-2 py-2 text-sm">
                    <div className="min-w-0 flex-1">
                      <p className="whitespace-normal break-words" title={run.topic}>{run.name}</p>
                      {run.status?.failureReason && (
                        <p className="mt-1 whitespace-normal break-words text-xs text-destructive">{run.status.failureReason}</p>
                      )}
                      {(state === 'running' || state === 'queued') && (eventsByRun[run.id]?.length ?? 0) > 0 && (
                        <p className="mt-1 whitespace-normal break-words text-xs text-muted-foreground/70">
                          {eventsByRun[run.id]?.[eventsByRun[run.id]!.length - 1]?.message}
                        </p>
                      )}
                    </div>
                    <div className="flex shrink-0 flex-wrap justify-end gap-x-2 gap-y-1 text-xs text-muted-foreground">
                      {run.status?.usage && (
                        <span title={t('cloudRuns.usageHint')}>
                          {formatUsage(run.status.usage.promptTokens, run.status.usage.completionTokens, run.status.usage.cpuMs)}
                        </span>
                      )}
                      {progress && state === 'running' && <span>{progress.completed}/{progress.total}</span>}
                      <span>{t(`cloudRuns.state.${state ?? 'unknown'}`)}</span>
                    </div>
                    {hasActions && (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            aria-label={t('common.more')}
                            size="sm"
                            variant="ghost"
                            disabled={!isAvailable || busy === run.id}
                          >
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          {(state === 'running' || state === 'queued') && (
                            <DropdownMenuItem onSelect={() => void act(run.id, () => window.electronAPI.cancelCloudRun(run.id))}>
                              <XCircle className="h-4 w-4" />
                              {t('cloudRuns.cancel')}
                            </DropdownMenuItem>
                          )}
                          {state === 'failed' && (
                            <DropdownMenuItem
                              onSelect={() =>
                                void act(run.id, async () => {
                                  await window.electronAPI.resumeCloudRun({ runId: run.id })
                                  toast.success(t('cloudRuns.resumed'))
                                })
                              }
                            >
                              <Rocket className="h-4 w-4" />
                              {t('cloudRuns.resume')}
                            </DropdownMenuItem>
                          )}
                          {state === 'failed' && run.topic && (
                            <DropdownMenuItem
                              onSelect={() =>
                                void act(run.id, async () => {
                                  await window.electronAPI.submitCloudRun({ topic: run.topic!, sessionId })
                                  toast.success(t('cloudRuns.submitted'))
                                })
                              }
                            >
                              <RefreshCw className="h-4 w-4" />
                              {t('cloudRuns.retry')}
                            </DropdownMenuItem>
                          )}
                          {state === 'done' && (
                            <>
                              <DropdownMenuItem onSelect={() => {
                                setForkTarget(run.id)
                                setForkQuestion('')
                              }}>
                                <Rocket className="h-4 w-4 rotate-90" />
                                {t('cloudRuns.fork')}
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onSelect={() =>
                                  void act(run.id, async () => {
                                    const artifacts = await window.electronAPI.listCloudRunArtifacts(run.id)
                                    const md = artifacts.find((artifact) => artifact.path.endsWith('answer.md') || artifact.path.endsWith('.md'))
                                    if (md) {
                                      const result = await window.electronAPI.readCloudRunArtifact({ runId: run.id, path: md.path })
                                      setPreview({ title: `${run.name} — ${md.path}`, content: result.content })
                                    }
                                  })
                                }
                              >
                                <FileText className="h-4 w-4" />
                                {t('cloudRuns.preview')}
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onSelect={() =>
                                  void act(run.id, async () => {
                                    const { url } = await window.electronAPI.shareCloudRun({ runId: run.id })
                                    await navigator.clipboard.writeText(url)
                                    toast.success(t('cloudRuns.shareCopied'))
                                  })
                                }
                              >
                                <Link2 className="h-4 w-4" />
                                {t('cloudRuns.share')}
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onSelect={() =>
                                  void act(run.id, async () => {
                                    const result = await window.electronAPI.importCloudRun({ runId: run.id, sessionId })
                                    toast.success(t('cloudRuns.imported', { count: result.files.length }))
                                  })
                                }
                              >
                                <Download className="h-4 w-4" />
                                {t('cloudRuns.import')}
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onSelect={() =>
                                  void act(run.id, async () => {
                                    await window.electronAPI.aggregateCloudRun({ runId: run.id, sessionId })
                                    toast.success(t('cloudRuns.aggregateStarted'))
                                  })
                                }
                              >
                                <FileText className="h-4 w-4" />
                                {t('cloudRuns.aggregate')}
                              </DropdownMenuItem>
                            </>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </div>
                )
              })}
            </div>

            <div className="border-t border-border/50 pt-2">
              <button
                type="button"
                className="flex w-full items-center justify-between text-xs text-muted-foreground hover:text-foreground"
                aria-expanded={schedOpen}
                onClick={() => setSchedOpen(!schedOpen)}
              >
                <span>{t('cloudRuns.schedules', { count: schedules.length })}</span>
                <span aria-hidden="true">{schedOpen ? '−' : '+'}</span>
              </button>
              {schedOpen && (
                <div className="mt-2 space-y-2">
                  {schedules.map((schedule) => (
                    <div key={schedule.id} className="flex items-start gap-2 text-xs">
                      <input
                        aria-label={schedule.topic}
                        disabled={!isAvailable}
                        type="checkbox"
                        checked={schedule.enabled}
                        onChange={async (e) => {
                          const nextSchedule = { ...schedule, enabled: e.target.checked }
                          await window.electronAPI.saveCloudRunSchedule({ schedule: nextSchedule })
                          setSchedules((previous) => previous.map((item) => (item.id === schedule.id ? nextSchedule : item)))
                        }}
                      />
                      <span className="min-w-0 flex-1 whitespace-normal break-words" title={schedule.topic}>{schedule.topic}</span>
                      <span className="shrink-0 text-muted-foreground">{t('cloudRuns.everyHours', { hours: schedule.everyHours })}</span>
                      {schedule.lastFireAt && <span className="shrink-0 text-muted-foreground/60">{new Date(schedule.lastFireAt).toLocaleDateString()}</span>}
                      <Button
                        aria-label={t('cloudRuns.deleteSchedule')}
                        size="sm"
                        variant="ghost"
                        className="h-5 px-1"
                        disabled={!isAvailable}
                        onClick={async () => {
                          await window.electronAPI.deleteCloudRunSchedule({ id: schedule.id })
                          setSchedules((previous) => previous.filter((item) => item.id !== schedule.id))
                        }}
                      >
                        ×
                      </Button>
                    </div>
                  ))}
                  <div className="flex flex-col gap-1">
                    <div className="flex flex-wrap gap-1">
                      <Input
                        className="h-7 min-w-[12rem] flex-1 border-border text-xs"
                        disabled={!isAvailable}
                        value={newSched.topic}
                        onChange={(e) => setNewSched((previous) => ({ ...previous, topic: e.target.value }))}
                        placeholder={t('cloudRuns.scheduleTopicPlaceholder')}
                      />
                      <Input
                        className="h-7 w-16 border-border text-xs"
                        disabled={!isAvailable}
                        type="number"
                        min={1}
                        value={newSched.everyHours}
                        onChange={(e) => setNewSched((previous) => ({ ...previous, everyHours: e.target.value }))}
                        aria-label={t('cloudRuns.everyHoursHint')}
                      />
                      <Button
                        aria-label={t('cloudRuns.scheduleSaved')}
                        size="sm"
                        className="h-7"
                        disabled={!isAvailable || !newSched.topic.trim() || !(Number(newSched.everyHours) > 0)}
                        onClick={async () => {
                          const schedule = {
                            id: `sched-${Date.now().toString(36)}`,
                            topic: newSched.topic.trim(),
                            everyHours: Number(newSched.everyHours),
                            sessionId,
                            enabled: true,
                          }
                          await window.electronAPI.saveCloudRunSchedule({ schedule })
                          setSchedules((previous) => [...previous, schedule])
                          setNewSched({ topic: '', everyHours: '24' })
                          toast.success(t('cloudRuns.scheduleSaved'))
                        }}
                      >
                        +
                      </Button>
                    </div>
                    <p className="min-w-0 whitespace-normal break-words px-0.5 text-[10px] text-muted-foreground">{t('cloudRuns.everyHoursHint')}</p>
                  </div>
                </div>
              )}
            </div>

            {forkTarget && (
              <div className="flex flex-wrap gap-2">
                <Input
                  className="min-w-[12rem] flex-1"
                  disabled={!isAvailable}
                  value={forkQuestion}
                  onChange={(e) => setForkQuestion(e.target.value)}
                  placeholder={t('cloudRuns.forkPlaceholder')}
                  autoFocus
                  onKeyDown={(e) => {
                    if (isAvailable && e.key === 'Enter' && forkQuestion.trim()) {
                      void act('fork', async () => {
                        await window.electronAPI.submitCloudRun({ topic: forkQuestion.trim(), sessionId, fromRunId: forkTarget })
                        setForkTarget(null)
                        toast.success(t('cloudRuns.submitted'))
                      })
                    }
                    if (e.key === 'Escape') setForkTarget(null)
                  }}
                />
                <Button
                  size="sm"
                  disabled={!isAvailable || !forkQuestion.trim() || busy === 'fork'}
                  onClick={() =>
                    void act('fork', async () => {
                      await window.electronAPI.submitCloudRun({ topic: forkQuestion.trim(), sessionId, fromRunId: forkTarget })
                      setForkTarget(null)
                      toast.success(t('cloudRuns.submitted'))
                    })
                  }
                >
                  {t('cloudRuns.submit')}
                </Button>
              </div>
            )}
          </div>
          <DialogFooter className="shrink-0 border-t border-border/50 px-6 py-3">
            <span className="min-w-0 whitespace-normal break-words text-xs text-muted-foreground">{t('cloudRuns.footer')}</span>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={preview !== null} onOpenChange={(nextOpen) => !nextOpen && setPreview(null)}>
        <DialogContent className="flex max-h-[calc(100dvh-2rem)] min-h-0 max-w-2xl flex-col gap-0 overflow-hidden p-0">
          <DialogHeader className="shrink-0 border-b border-border/50 px-6 py-4">
            <DialogTitle className="min-w-0 whitespace-normal break-words">{preview?.title}</DialogTitle>
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 py-4 text-sm">
            <Markdown mode="minimal">{preview?.content ?? ''}</Markdown>
          </div>
          <DialogFooter className="shrink-0 border-t border-border/50 px-6 py-3">
            <Button size="sm" variant="outline" onClick={() => setPreview(null)}>
              {t('common.close')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
