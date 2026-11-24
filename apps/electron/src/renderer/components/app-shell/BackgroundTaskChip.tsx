/**
 * A background task of the session (subagent, shell command, workflow) as a chip above the composer,
 * and the card it opens.
 *
 * The chip says what runs and for how long: a spinner and a slow shimmer while it runs, a check, cross
 * or stop mark once it ends (the glyphs cross-fade). The card shows what the task is doing — an agent's
 * live one-line summary (SDK progress summaries), its step count and recent steps, then its result;
 * a command's output tail — refreshed while the card is open, with Open (the full output in an
 * overlay), Copy, and Stop or Dismiss.
 */

import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { AnimatePresence, motion } from 'motion/react'
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  Copy,
  FilePen,
  FileText,
  Globe,
  Maximize2,
  Plug,
  Search,
  Square,
  SquareTerminal,
  Workflow,
  Wrench,
  X,
  XCircle,
  type LucideIcon,
} from 'lucide-react'
import { toast } from 'sonner'
import { MemoizedMarkdown, Spinner } from '@craft-agent/ui'
import { SPRING } from '@craft-agent/ui/motion'
import type { BackgroundTaskOutput, BackgroundTaskStep } from '@craft-agent/shared/protocol'
import { CardButton } from '@/components/ui/card-button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import type { BackgroundTask } from '@/atoms/sessions'
import { cn } from '@/lib/utils'
import { COMPOSER_META_CHIP } from './input/composer-styles'

/** How often an open card re-reads a running task's output. */
const OUTPUT_POLL_MS = 2_000
/** Recent steps the card lists. */
const CARD_STEPS = 4
/** A running agent's message is clamped to a few lines: parse only what could show. */
const LIVE_MESSAGE_CHARS = 1_200

/** Compact elapsed time: 45s, 2m 49s, 1h 5m. */
export function formatElapsed(seconds: number): string {
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = seconds % 60
  if (minutes < 60) return remainingSeconds > 0 ? `${minutes}m ${remainingSeconds}s` : `${minutes}m`
  const hours = Math.floor(minutes / 60)
  const remainingMinutes = minutes % 60
  return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`
}

function isLive(task: BackgroundTask): boolean {
  return task.status === 'running' || task.status === 'stale'
}

/** Elapsed seconds: ticking while the task runs, frozen at its end. */
function useElapsed(task: BackgroundTask): number {
  const [now, setNow] = React.useState(() => Date.now())
  React.useEffect(() => {
    if (task.status !== 'running') return
    const interval = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(interval)
  }, [task.status])
  const end = isLive(task) ? now : (task.completedAt ?? now)
  return Math.max(0, Math.floor((end - task.startTime) / 1000), isLive(task) ? task.elapsedSeconds : 0)
}

const TYPE_ICON: Record<BackgroundTask['type'], LucideIcon> = { agent: Bot, shell: SquareTerminal, workflow: Workflow }
const TYPE_LABEL_KEY: Record<BackgroundTask['type'], string> = {
  agent: 'chat.backgroundTask.typeAgent',
  shell: 'chat.backgroundTask.typeShell',
  workflow: 'chat.backgroundTask.typeWorkflow',
}

function useStatusText(task: BackgroundTask): string {
  const { t } = useTranslation()
  if (task.stopping && isLive(task)) return t('chat.backgroundTask.stopping')
  switch (task.status) {
    case 'running': return t('chat.backgroundTask.running')
    case 'completed': return t('chat.backgroundTask.done')
    case 'failed': return t('chat.backgroundTask.failed')
    case 'stopped': return t('chat.backgroundTask.stopped')
    case 'orphaned': return t('chat.backgroundTask.interrupted')
    case 'stale': return t('chat.backgroundTask.noSignal')
  }
}

/** The status glyph; a change cross-fades with a small scale (spring "snap"). */
function StatusGlyph({ task }: { task: BackgroundTask }) {
  const stopping = task.stopping && isLive(task)
  const key = stopping ? 'stopping' : task.status
  const glyph = stopping || task.status === 'running'
    ? <Spinner className="text-label-sm text-tertiary" />
    : task.status === 'completed' ? <CheckCircle2 className="size-3.5 text-success" />
    : task.status === 'failed' ? <XCircle className="size-3.5 text-destructive" />
    : task.status === 'stopped' ? <Square className="size-3 fill-current text-tertiary" />
    : <AlertTriangle className="size-3.5 text-info" />
  return (
    <span className="relative grid size-3.5 shrink-0 place-items-center" aria-hidden>
      <AnimatePresence initial={false} mode="popLayout">
        <motion.span
          key={key}
          className="grid place-items-center"
          initial={{ opacity: 0, scale: 0.5 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.5 }}
          transition={SPRING.snap}
        >
          {glyph}
        </motion.span>
      </AnimatePresence>
    </span>
  )
}

function stepIcon(tool: string): LucideIcon {
  if (tool === 'Bash') return SquareTerminal
  if (tool === 'Read') return FileText
  if (tool === 'Write' || tool === 'Edit' || tool === 'MultiEdit' || tool === 'NotebookEdit') return FilePen
  if (tool === 'Grep' || tool === 'Glob') return Search
  if (tool === 'WebFetch' || tool === 'WebSearch') return Globe
  if (tool === 'Task' || tool === 'Agent') return Bot
  if (tool.startsWith('mcp__')) return Plug
  return Wrench
}

/** A source tool shows its source (`mcp__linear__list_issues` → `linear`; the label names the action); built-in tools keep their name. */
function stepToolName(tool: string): string {
  return tool.startsWith('mcp__') ? tool.split('__')[1] || tool : tool
}

/** The card's text for Copy and Open: a command's output, or an agent's message. */
function outputText(output: BackgroundTaskOutput | null): string | null {
  if (!output) return null
  if (output.kind === 'text') return output.text.trim() ? output.text : null
  return output.message
}

/** An agent's output as one document for the overlay: its message, then its recent steps. */
function agentDocument(output: Extract<BackgroundTaskOutput, { kind: 'agent' }>, stepsHeading: string): string {
  const steps = output.steps.map(step => `- **${stepToolName(step.tool)}**${step.label ? ` ${step.label}` : ''}`).join('\n')
  return [output.message ?? '', steps ? `**${stepsHeading}**\n\n${steps}` : ''].filter(Boolean).join('\n\n---\n\n')
}

/** Same content as last time? Then keep the old object, so nothing re-renders. */
function sameOutput(a: BackgroundTaskOutput | null, b: BackgroundTaskOutput | null): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

/**
 * Reads the task's output while the card is open: once, then again OUTPUT_POLL_MS after each answer
 * while it runs (never two requests in flight, so a slow answer can't overwrite a newer one). A
 * failed read stops the polling and offers Retry (e.g. a server without this channel).
 */
function useTaskOutput(sessionId: string, task: BackgroundTask) {
  const [state, setState] = React.useState<{ output: BackgroundTaskOutput | null; status: 'loading' | 'ready' | 'error' }>(
    { output: null, status: 'loading' },
  )
  const [attempt, setAttempt] = React.useState(0)
  const live = isLive(task)

  React.useEffect(() => {
    let current = true
    let timer: ReturnType<typeof setTimeout> | undefined
    const load = async () => {
      try {
        const output = await window.electronAPI.getBackgroundTaskOutput(sessionId, task.id, task.type)
        if (!current) return
        setState(previous => (previous.status === 'ready' && sameOutput(previous.output, output) ? previous : { output, status: 'ready' }))
        // A running task keeps writing; a finished one was read once more, for its final output
        if (live) timer = setTimeout(() => void load(), OUTPUT_POLL_MS)
      } catch {
        if (current) setState(previous => ({ output: previous.output, status: previous.output ? 'ready' : 'error' }))
      }
    }
    void load()
    return () => {
      current = false
      if (timer) clearTimeout(timer)
    }
  }, [sessionId, task.id, task.type, live, task.status, attempt])

  return { ...state, reload: () => setAttempt(n => n + 1) }
}

function StepRow({ step }: { step: BackgroundTaskStep }) {
  const Icon = stepIcon(step.tool)
  return (
    <li className="flex min-w-0 items-center gap-2 text-label-sm">
      <Icon className="size-3.5 shrink-0 text-tertiary" aria-hidden />
      <span className="shrink-0 text-secondary">{stepToolName(step.tool)}</span>
      {step.label && <span className="min-w-0 truncate text-tertiary" title={step.label}>{step.label}</span>}
    </li>
  )
}

/** A command's output, scrolled to its end (and kept there as it grows). */
function OutputTail({ text, truncated }: { text: string; truncated: boolean }) {
  const { t } = useTranslation()
  const ref = React.useRef<HTMLPreElement>(null)
  // Follow the end only while the reader is there: scrolling up to read earlier output must stick
  const atEndRef = React.useRef(true)
  React.useLayoutEffect(() => {
    const el = ref.current
    if (el && atEndRef.current) el.scrollTop = el.scrollHeight
  }, [text])
  return (
    <div className="flex flex-col gap-1">
      {truncated && <span className="text-label-sm text-tertiary">{t('chat.backgroundTask.truncated')}</span>}
      <pre
        ref={ref}
        onScroll={(e) => {
          const el = e.currentTarget
          atEndRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 8
        }}
        className="max-h-56 overflow-auto rounded-md bg-fill-hover px-2.5 py-2 font-mono text-mono-ui whitespace-pre-wrap break-words text-secondary"
      >
        {text}
      </pre>
    </div>
  )
}

interface CardProps {
  task: BackgroundTask
  sessionId: string
  onStop: (task: BackgroundTask) => void
  onDismiss: (task: BackgroundTask) => void
  onOpenOutput?: (task: BackgroundTask, output: BackgroundTaskOutput) => void
  onClose: () => void
}

function BackgroundTaskCard({ task, sessionId, onStop, onDismiss, onOpenOutput, onClose }: CardProps) {
  const { t } = useTranslation()
  const elapsed = useElapsed(task)
  const statusText = useStatusText(task)
  const { output, status, reload } = useTaskOutput(sessionId, task)
  const live = isLive(task)
  const TypeIcon = TYPE_ICON[task.type]
  const title = task.intent?.trim() || task.id
  const copyText = outputText(output)
  const activity = task.activity

  const handleCopy = async () => {
    if (!copyText) return
    await navigator.clipboard?.writeText(copyText)
    toast.success(t('toast.taskOutputCopied'))
  }

  let body: React.ReactNode
  if (status === 'loading' && !output) {
    body = (
      <div className="flex flex-col gap-2" aria-busy>
        <div className="skeleton h-3.5 w-3/4" />
        <div className="skeleton h-3.5 w-1/2" />
        <div className="skeleton h-3.5 w-2/3" />
      </div>
    )
  } else if (status === 'error') {
    body = (
      <div className="flex items-center justify-between gap-2 text-label-sm text-secondary">
        <span>{t('chat.backgroundTask.loadFailed')}</span>
        <CardButton icon={Wrench} onClick={reload}>{t('common.retry')}</CardButton>
      </div>
    )
  } else if (output?.kind === 'text' && output.text.trim()) {
    body = <OutputTail text={output.text} truncated={output.truncated} />
  } else if (output?.kind === 'agent' && (output.message || output.steps.length > 0)) {
    body = (
      <div className="flex flex-col gap-3">
        {output.steps.length > 0 && live && (
          <section className="flex flex-col gap-1.5">
            <h4 className="text-label-sm font-medium text-tertiary">{t('chat.backgroundTask.recentSteps')}</h4>
            <ul className="flex flex-col gap-1">
              {output.steps.slice(-CARD_STEPS).map((step, index) => <StepRow key={`${index}-${step.tool}`} step={step} />)}
            </ul>
          </section>
        )}
        {output.message && (
          <section className="flex flex-col gap-1.5">
            <h4 className="text-label-sm font-medium text-tertiary">
              {live ? t('chat.backgroundTask.latestMessage') : t('chat.backgroundTask.result')}
            </h4>
            <div className={cn('min-w-0 text-label text-foreground', live && 'line-clamp-6')}>
              <MemoizedMarkdown mode="minimal">
                {live && output.message.length > LIVE_MESSAGE_CHARS ? `${output.message.slice(0, LIVE_MESSAGE_CHARS)}…` : output.message}
              </MemoizedMarkdown>
            </div>
          </section>
        )}
      </div>
    )
  } else {
    body = (
      <p className="text-label-sm text-tertiary">
        {task.summary || (live ? t('chat.backgroundTask.waiting') : t('chat.backgroundTask.noOutput'))}
      </p>
    )
  }

  return (
    <div className="flex max-h-[min(520px,70vh)] flex-col">
      <header className="flex gap-2.5 px-3.5 pt-3 pb-2.5">
        <TypeIcon className="mt-0.5 size-4 shrink-0 text-tertiary" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="line-clamp-2 text-label font-medium text-foreground" title={title}>{title}</p>
          <p className="mt-0.5 text-label-sm text-tertiary tabular-nums">
            {t(TYPE_LABEL_KEY[task.type])} · {statusText} · {formatElapsed(elapsed)}
            {task.type === 'workflow' && (task.agentsCompleted ?? 0) > 0 && ` · ${t('chat.workflowAgentsDone', { count: task.agentsCompleted ?? 0 })}`}
          </p>
          {/* The agent's own one-line status (SDK progress summary), refreshed about every 30 s */}
          {live && (activity?.summary || activity?.toolUses) ? (
            <p className="mt-1.5 flex min-w-0 items-baseline gap-1.5 text-label-sm text-secondary">
              {activity?.summary && <span className="min-w-0 truncate animate-shimmer-text" title={activity.summary}>{activity.summary}</span>}
              {activity?.toolUses ? (
                <span className="shrink-0 text-tertiary tabular-nums">{t('chat.backgroundTask.steps', { count: activity.toolUses })}</span>
              ) : null}
            </p>
          ) : null}
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto border-t border-separator px-3.5 py-3">{body}</div>

      <footer className="flex items-center gap-0.5 border-t border-separator p-1.5">
        <CardButton
          icon={Maximize2}
          disabled={!output || !copyText}
          onClick={() => {
            if (!output) return
            onOpenOutput?.(task, output)
            onClose()
          }}
        >
          {t('common.open')}
        </CardButton>
        <CardButton icon={Copy} disabled={!copyText} onClick={() => void handleCopy()}>{t('common.copy')}</CardButton>
        <div className="flex-1" />
        {live ? (
          <CardButton icon={Square} tone="destructive" disabled={task.stopping} onClick={() => onStop(task)}>
            {task.stopping ? t('chat.backgroundTask.stopping') : t('chat.backgroundTask.stop')}
          </CardButton>
        ) : (
          <CardButton icon={X} onClick={() => onDismiss(task)}>{t('common.dismiss')}</CardButton>
        )}
      </footer>
    </div>
  )
}

export interface BackgroundTaskChipProps {
  task: BackgroundTask
  sessionId: string
  /** The card is open (ActiveTasksBar keeps one open at a time, and keeps its chip while it is) */
  open: boolean
  onOpenChange: (open: boolean) => void
  onStop: (task: BackgroundTask) => void
  onDismiss: (task: BackgroundTask) => void
  /** Show the task's full output (ChatDisplay opens it in an overlay) */
  onOpenOutput?: (task: BackgroundTask, output: BackgroundTaskOutput) => void
}

export function BackgroundTaskChip({ task, sessionId, open, onOpenChange, onStop, onDismiss, onOpenOutput }: BackgroundTaskChipProps) {
  const { t } = useTranslation()
  const elapsed = useElapsed(task)
  const statusText = useStatusText(task)
  const label = task.intent?.trim() || task.id
  const running = task.status === 'running' && !task.stopping
  const tone = task.status === 'failed'
    ? 'bg-destructive-tint text-destructive ring-[color:var(--destructive-border)]'
    : task.status === 'orphaned' || task.status === 'stale'
      ? 'bg-info-tint text-info ring-[color:var(--info-border)]'
      : undefined
  const hint = task.status === 'orphaned' ? t('chat.taskOrphanedHint') : task.status === 'stale' ? t('chat.taskStaleHint') : undefined

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`${t('chat.backgroundTask.chipLabel', { type: t(TYPE_LABEL_KEY[task.type]), intent: label })} · ${statusText} · ${formatElapsed(elapsed)}`}
          title={hint ?? label}
          className={cn(COMPOSER_META_CHIP, 'max-w-full cursor-pointer pl-2', running && 'animate-shimmer', tone)}
        >
          <StatusGlyph task={task} />
          <span className="min-w-0 max-w-[240px] truncate">{label}</span>
          <span className={cn('shrink-0 tabular-nums', tone ? 'font-medium' : 'text-tertiary')}>
            {running ? formatElapsed(elapsed) : statusText}
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="start"
        sideOffset={8}
        className="w-[360px] max-w-[calc(100vw-24px)] p-0"
        // Focus the card itself: while it loads, Open and Copy are disabled, and focus must never
        // land on Stop (holding Enter that opened the card would stop the task)
        tabIndex={-1}
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          ;(event.currentTarget as HTMLElement | null)?.focus()
        }}
      >
        <BackgroundTaskCard
          task={task}
          sessionId={sessionId}
          onStop={onStop}
          onDismiss={onDismiss}
          onOpenOutput={onOpenOutput}
          onClose={() => onOpenChange(false)}
        />
      </PopoverContent>
    </Popover>
  )
}

export { agentDocument }
