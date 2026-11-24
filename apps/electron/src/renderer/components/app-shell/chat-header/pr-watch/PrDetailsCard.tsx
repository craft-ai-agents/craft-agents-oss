/**
 * The card behind the Coding-mode PR chip: the session's PRs as tabs when it tracks more than one
 * (PrTabStrip; the chip's popover handles ←/→), then the PR's head (number, title, state, branches, size),
 * then Last commit (with local commits not pushed yet), Checks, Review and Merge, and a footer with
 * freshness, the credential that answered, one action (Resolve merge conflicts, else Fix review
 * comments, else Fix CI, else a green tick; see `prCardAction`; on a pinned PR they work in a separate
 * checkout), Refresh and Open on GitHub.
 *
 * The summary renders at once; detail sections show skeletons until `details` arrives.
 */

import * as React from 'react'
import { useTranslation } from 'react-i18next'
import {
  AlertTriangle,
  ArrowDown,
  ArrowUpFromLine,
  Check,
  CircleCheck,
  CircleDashed,
  CircleX,
  ExternalLink,
  FilePen,
  FlaskConical,
  GitMerge,
  Link,
  MessageSquare,
  Pin,
  PinOff,
  RefreshCw,
  ShieldAlert,
  Wrench,
  type LucideIcon,
} from 'lucide-react'
import { Spinner } from '@craft-agent/ui'
import { Switch } from '@/components/ui/switch'
import { CardButton } from '@/components/ui/card-button'
import type { PrAutoFixView, PrAutoMergeChange } from '@/hooks/usePrWatch'
import { cn } from '@/lib/utils'
import { formatShortAge } from '@/utils/session'
import {
  checkRowsForCard,
  countChecks,
  mergeTone,
  prStateTone,
  reviewTone,
  shortSha,
  type MergeState,
  type PrAutoMergeBlock,
  type PrAutoMergeState,
  type PrCardAction,
  type PrCheck,
  type PrDetails,
  type PrMergeMethod,
  type PrSummary,
  type ReviewDecision,
  type ReviewerState,
} from './pr-watch-state'
import { CheckStatusGlyph, PR_STATE_ICON, TONE_TEXT } from './pr-watch-visuals'
import { PrTabStrip, type PrTabStripProps } from './PrTabStrip'

/** The footer's "Updated 12s ago" stays roughly current while the card is open. */
const AGE_TICK_MS = 10_000
/** How long the copy-link button shows its "Copied!" tick. */
const COPIED_MS = 1500

const REVIEW_KEY: Record<ReviewDecision, string> = {
  approved: 'chat.prWatch.review.approved',
  changes_requested: 'chat.prWatch.review.changesRequested',
  review_required: 'chat.prWatch.review.required',
  none: 'chat.prWatch.review.none',
}

const REVIEWER_KEY: Record<ReviewerState, string> = {
  approved: 'chat.prWatch.review.approved',
  changes_requested: 'chat.prWatch.review.changesRequested',
  commented: 'chat.prWatch.reviewer.commented',
  pending: 'chat.prWatch.reviewer.pending',
}

const MERGE_ICON: Record<MergeState, LucideIcon> = {
  clean: CircleCheck,
  behind: ArrowDown,
  blocked: ShieldAlert,
  conflicting: CircleX,
  unstable: AlertTriangle,
  draft: CircleDashed,
  unknown: CircleDashed,
}

export interface PrDetailsCardProps {
  summary: PrSummary
  details?: PrDetails
  refreshing?: boolean
  onRefresh?: () => void
  onOpenUrl: (url: string) => void
  /** The footer's action slot (`prCardAction`); every action but the ticks calls `onAction` */
  action?: PrCardAction | null
  /** Sends the action's prompt to the session */
  onAction?: () => void
  /** The active PR was pinned (pr_bind), not the branch's own: it can be unpinned, and its actions work in a separate checkout */
  pinned?: boolean
  /** Remove the pinned PR from the session */
  onUnbind?: () => void
  /** Enable/disable GitHub auto-merge for this PR (the toggle is hidden when absent); resolves with GitHub's answer */
  onSetAutoMerge?: (enabled: boolean, method?: PrMergeMethod) => Promise<PrAutoMergeChange>
  /** Auto-fix (the Fix button's toggle) for this PR */
  autoFix?: PrAutoFixView
  /** Turn auto-fix on/off (the toggle is hidden when absent: always for a pinned PR) */
  onSetAutoFix?: (enabled: boolean) => void
  /** The session's PRs as tabs above the header, when it tracks more than one (see PrTabStrip) */
  tabs?: PrTabStripProps
}

export function PrDetailsCard({ summary, details, refreshing, onRefresh, onOpenUrl, action, onAction, pinned, onUnbind, onSetAutoMerge, autoFix, onSetAutoFix, tabs }: PrDetailsCardProps) {
  const { t } = useTranslation()
  const [, tick] = React.useReducer((n: number) => n + 1, 0)
  React.useEffect(() => {
    const id = setInterval(tick, AGE_TICK_MS)
    return () => clearInterval(id)
  }, [])

  const StateIcon = PR_STATE_ICON[summary.state]
  const stateTone = TONE_TEXT[prStateTone(summary.state)]
  const updatedLine = t('chat.prWatch.updated', { age: formatShortAge(summary.fetchedAt), via: summary.via })
  // The Fix control (with its auto-fix toggle) shows while there is review feedback to fix, and stays
  // while auto-fix is on — next to a more urgent action (Resolve, Fix CI) or the tick, if any.
  const showFixControl = !!onSetAutoFix && (summary.state === 'open' || summary.state === 'draft') && (action === 'fix' || !!autoFix?.enabled)
  const hasTabs = !!tabs && tabs.entries.length > 1

  return (
    <div className="flex max-h-[min(560px,70vh)] flex-col">
      {hasTabs && <PrTabStrip {...tabs} />}
      <header className={cn('flex gap-2.5 px-3.5 pb-2.5', hasTabs ? 'pt-2' : 'pt-3')}>
        <StateIcon className={cn('mt-0.5 size-4 shrink-0', stateTone)} aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="line-clamp-2 text-label font-medium text-foreground" title={summary.title}>
            <span className="tabular-nums text-tertiary">#{summary.number}</span> {summary.title}
          </p>
          <p className="mt-0.5 flex min-w-0 items-center gap-1.5 text-label-sm text-tertiary">
            <span className={cn('shrink-0 font-medium', stateTone)}>{t(`chat.prWatch.state.${summary.state}`)}</span>
            <span aria-hidden>·</span>
            <span className="min-w-0 truncate font-mono text-mono-ui" title={`${summary.headRef} → ${summary.baseRef}`}>
              {summary.headRef} → {summary.baseRef}
            </span>
            {pinned && (
              <>
                <span aria-hidden>·</span>
                <span className="inline-flex shrink-0 items-center gap-1">
                  <Pin className="size-3" aria-hidden />
                  {t('chat.prWatch.pinned')}
                </span>
              </>
            )}
          </p>
          {details && (
            <p className="mt-0.5 text-label-sm text-tertiary tabular-nums">
              <span className="text-success">+{details.additions}</span>{' '}
              <span className="text-destructive">−{details.deletions}</span>
              {' · '}
              {t('chat.prWatch.files', { count: details.changedFiles })}
            </p>
          )}
        </div>
        {/* Keyed by PR: another tab starts without the previous PR's "Copied!" */}
        <CopyLinkButton key={summary.url} url={summary.url} />
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <CardSection title={t('chat.prWatch.lastCommit')}>
          {details ? <LastCommit summary={summary} details={details} onOpenUrl={onOpenUrl} /> : <SkeletonLines />}
        </CardSection>
        <CardSection
          title={t('chat.prWatch.checks.title')}
          trailing={details && details.checks.length > 0 ? <CheckSummary checks={details.checks} /> : undefined}
        >
          {details ? <CheckList checks={details.checks} onOpenUrl={onOpenUrl} /> : <SkeletonLines />}
        </CardSection>
        <CardSection
          title={t('chat.prWatch.review.title')}
          trailing={summary.unresolvedThreads > 0 ? (
            <span className="inline-flex items-center gap-1 text-label-sm text-info tabular-nums">
              <MessageSquare className="size-3.5 shrink-0" aria-hidden />
              {t('chat.prWatch.openThreads', { count: summary.unresolvedThreads })}
            </span>
          ) : undefined}
        >
          <ReviewBody decision={summary.reviewDecision} details={details} />
        </CardSection>
        <CardSection title={t('chat.prWatch.merge.title')}>
          <MergeLine state={summary.mergeState} />
          {/* Keyed by PR: another tab starts without the previous PR's pending switch or refusal */}
          {onSetAutoMerge && (summary.state === 'open' || summary.state === 'draft') && (
            <AutoMergeRow key={summary.url} autoMerge={summary.autoMerge} blocked={summary.autoMergeBlocked} onSetAutoMerge={onSetAutoMerge} />
          )}
        </CardSection>
      </div>

      <footer className="flex items-center gap-0.5 border-t border-separator p-1.5">
        {/* Truncates when an action shows; the full line stays in the tooltip */}
        <span className="min-w-0 flex-1 truncate px-2 text-label-sm text-tertiary" title={updatedLine}>
          {updatedLine}
        </span>
        {pinned && onUnbind && (
          <CardButton icon={PinOff} onClick={onUnbind} aria-label={t('chat.prWatch.unbind')} title={t('chat.prWatch.unbindHint')} />
        )}
        {showFixControl && onSetAutoFix ? (
          <>
            {action !== 'fix' && <CardAction action={action} onAction={onAction} pinned={pinned} />}
            <FixControl canFixNow={action === 'fix' && !!onAction} autoFix={autoFix} onFixNow={onAction} onToggleAuto={onSetAutoFix} />
          </>
        ) : (
          <CardAction action={action} onAction={onAction} pinned={pinned} />
        )}
        <CardButton
          icon={refreshing ? RefreshSpinner : RefreshCw}
          disabled={refreshing || !onRefresh}
          onClick={onRefresh}
          aria-label={t('chat.prWatch.refresh')}
          title={t('chat.prWatch.refresh')}
        />
        <CardButton icon={ExternalLink} onClick={() => onOpenUrl(summary.url)}>
          {t('chat.prWatch.openOnGitHub')}
        </CardButton>
      </footer>
    </div>
  )
}

const ACTION_BUTTON: Record<Exclude<PrCardAction, 'ok' | 'unsynced'>, { icon: LucideIcon; label: string; hint: string }> = {
  resolve: { icon: GitMerge, label: 'chat.prWatch.resolveConflicts', hint: 'chat.prWatch.resolveConflictsHint' },
  fix: { icon: Wrench, label: 'chat.prWatch.fixReview', hint: 'chat.prWatch.fixReviewHint' },
  'fix-ci': { icon: FlaskConical, label: 'chat.prWatch.fixChecks', hint: 'chat.prWatch.fixChecksHint' },
}

/**
 * Resolve (conflicts), else Fix (review comments), else Fix CI, else a tick: green when all good,
 * orange while local changes aren't in the PR (see prCardAction). On a pinned PR the tooltip adds that
 * the agent works in a separate checkout.
 */
function CardAction({ action, onAction, pinned }: { action?: PrCardAction | null; onAction?: () => void; pinned?: boolean }) {
  const { t } = useTranslation()
  if (!action) return null
  if (action === 'ok' || action === 'unsynced') {
    const label = t(action === 'ok' ? 'chat.prWatch.allGood' : 'chat.prWatch.unsynced')
    return (
      <span role="img" aria-label={label} title={label} className={cn('inline-flex h-7 items-center px-2', action === 'ok' ? 'text-success' : 'text-info')}>
        <CircleCheck className="size-4" />
      </span>
    )
  }
  if (!onAction) return null
  const button = ACTION_BUTTON[action]
  return (
    <CardButton icon={button.icon} onClick={onAction} title={pinned ? `${t(button.hint)}\n${t('chat.prWatch.pinnedActionHint')}` : t(button.hint)}>
      {t(button.label)}
    </CardButton>
  )
}

/**
 * The Fix action with its auto-fix toggle. The body sends the one-time Fix prompt, while there is review
 * feedback to fix (the card's `fix` action); the "Auto" switch turns auto-fix on or off. While it's on,
 * the wrench turns slowly: the server checks the PR for new review comments every 5 minutes and fixes
 * them in this session (no push, no GitHub replies), even while this window is hidden. With nothing to
 * fix right now, a turning wrench says it's watching (a glyph, not a disabled button, so its tooltip shows).
 */
function FixControl({ canFixNow, autoFix, onFixNow, onToggleAuto }: {
  canFixNow: boolean
  autoFix?: PrAutoFixView
  onFixNow?: () => void
  onToggleAuto: (enabled: boolean) => void
}) {
  const { t } = useTranslation()
  // Optimistic: show the requested state until a push confirms it (or ~6 s pass, so a refused change reverts)
  const serverOn = autoFix?.enabled ?? false
  const [pending, setPending] = React.useState<boolean | null>(null)
  React.useEffect(() => {
    if (pending === null) return
    if (pending === serverOn) { setPending(null); return }
    const timer = setTimeout(() => setPending(null), 6000)
    return () => clearTimeout(timer)
  }, [pending, serverOn])
  const on = pending ?? serverOn
  const toggleTitle = !on
    ? t('chat.prWatch.autoFix.off')
    : autoFix?.lastRunAt
      ? t('chat.prWatch.autoFix.onLastRun', { age: formatShortAge(autoFix.lastRunAt) })
      : t('chat.prWatch.autoFix.on')
  return (
    <span className="inline-flex items-center">
      {canFixNow ? (
        <CardButton icon={on ? TurningWrench : Wrench} onClick={onFixNow} title={t('chat.prWatch.fixReviewHint')} className="rounded-r-none">
          {t('chat.prWatch.fixReview')}
        </CardButton>
      ) : (
        <span role="img" aria-label={t('chat.prWatch.autoFix.watching')} title={t('chat.prWatch.autoFix.watching')} className="inline-flex h-7 items-center px-2 text-accent">
          <TurningWrench className="size-3.5 shrink-0" />
        </span>
      )}
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={t('chat.prWatch.autoFix.toggle')}
        title={toggleTitle}
        onClick={() => {
          setPending(!on)
          onToggleAuto(!on)
        }}
        className={cn(
          'motion-press inline-flex h-7 items-center rounded-md px-1.5 text-label-sm font-medium -outline-offset-2',
          'transition-[background-color,color] duration-micro ease-out-subtle hover:duration-instant',
          canFixNow && 'rounded-l-none',
          on ? 'bg-accent-tint text-accent' : 'text-tertiary hover:bg-fill-hover hover:text-foreground',
        )}
      >
        {t('chat.prWatch.autoFix.short')}
      </button>
    </span>
  )
}

/** Copies the PR's link; the icon turns into a green tick with "Copied!" for a moment. */
function CopyLinkButton({ url }: { url: string }) {
  const { t } = useTranslation()
  const [copied, setCopied] = React.useState(false)
  React.useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), COPIED_MS)
    return () => clearTimeout(timer)
  }, [copied])
  const label = copied ? t('common.copied') : t('chat.prWatch.copyLink')
  return (
    <CardButton
      icon={copied ? Check : Link}
      aria-label={label}
      title={label}
      // Lines up with the title's first line, its padding bleeding into the header's
      className={cn('-mt-1 -mr-1.5 shrink-0 self-start px-1.5', copied && 'text-success hover:text-success')}
      onClick={() => {
        // No tick when the clipboard refuses (it doesn't in the app): the missing tick is the signal
        navigator.clipboard.writeText(url).then(() => setCopied(true), () => {})
      }}
    />
  )
}

/** The wrench while auto-fix is on: a slow turn (stops under reduced motion; see base.css). */
function TurningWrench({ className }: { className?: string }) {
  return <Wrench className={cn(className, 'animate-autofix-spin')} />
}

/** CardButton takes an icon component; while refreshing that icon is the spinner. */
function RefreshSpinner({ className }: { className?: string }) {
  return <Spinner className={cn('text-label-sm', className)} />
}

function CardSection({ title, trailing, children }: { title: string; trailing?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-1.5 border-t border-separator px-3.5 py-2.5">
      <div className="flex min-w-0 items-baseline justify-between gap-2">
        <h4 className="shrink-0 text-label-sm font-medium text-tertiary">{title}</h4>
        {trailing}
      </div>
      {children}
    </section>
  )
}

function SkeletonLines({ lines = 2 }: { lines?: number }) {
  return (
    <div className="flex flex-col gap-1.5" aria-busy>
      <div className="skeleton h-3.5 w-3/4" />
      {lines > 1 && <div className="skeleton h-3.5 w-1/2" />}
    </div>
  )
}

function LastCommit({ summary, details, onOpenUrl }: { summary: PrSummary; details: PrDetails; onOpenUrl: (url: string) => void }) {
  const { t } = useTranslation()
  const commit = details.lastCommit
  return (
    <div className="flex flex-col gap-1">
      <div className="flex min-w-0 items-baseline gap-2 text-label">
        <button
          type="button"
          onClick={() => onOpenUrl(`${summary.url}/commits/${commit.sha}`)}
          className="shrink-0 rounded-xs font-mono text-mono-ui text-accent hover:underline -outline-offset-1"
        >
          {shortSha(commit.sha)}
        </button>
        <span className="min-w-0 truncate text-foreground" title={commit.headline}>{commit.headline}</span>
      </div>
      <p className="text-label-sm text-tertiary">
        {commit.author} · {formatShortAge(commit.committedAt)}
      </p>
      {summary.localAhead > 0 && (
        <p className="flex items-center gap-1.5 text-label-sm text-info">
          <ArrowUpFromLine className="size-3.5 shrink-0" aria-hidden />
          {t('chat.prWatch.unpushed', { count: summary.localAhead })}
        </p>
      )}
      {summary.localDirty && (
        <p className="flex items-center gap-1.5 text-label-sm text-tertiary">
          <FilePen className="size-3.5 shrink-0" aria-hidden />
          {t('chat.prWatch.dirty')}
        </p>
      )}
    </div>
  )
}

function CheckSummary({ checks }: { checks: readonly PrCheck[] }) {
  const { t } = useTranslation()
  const counts = countChecks(checks)
  const parts: React.ReactNode[] = []
  if (counts.failed) parts.push(<span key="failed" className="text-destructive">{t('chat.prWatch.checks.failed', { count: counts.failed })}</span>)
  if (counts.running) parts.push(<span key="running" className="text-info">{t('chat.prWatch.checks.running', { count: counts.running })}</span>)
  if (counts.passed) parts.push(<span key="passed">{t('chat.prWatch.checks.passed', { count: counts.passed })}</span>)
  return (
    <span className="min-w-0 truncate text-label-sm text-tertiary tabular-nums">
      {parts.map((part, index) => (
        <React.Fragment key={index}>
          {index > 0 && ' · '}
          {part}
        </React.Fragment>
      ))}
    </span>
  )
}

function CheckList({ checks, onOpenUrl }: { checks: readonly PrCheck[]; onOpenUrl: (url: string) => void }) {
  const { t } = useTranslation()
  if (checks.length === 0) {
    return <p className="text-label-sm text-tertiary">{t('chat.prWatch.checks.noneReported')}</p>
  }
  const { rows, overflow } = checkRowsForCard(checks)
  if (rows.length === 0) {
    return (
      <p className="flex items-center gap-1.5 text-label-sm text-success">
        <CircleCheck className="size-3.5 shrink-0" aria-hidden />
        {t('chat.prWatch.checks.allPassed')}
      </p>
    )
  }
  return (
    <ul className="flex flex-col gap-1">
      {rows.map((check) => (
        <li key={check.name} className="flex min-w-0 items-center gap-2 text-label-sm">
          <CheckStatusGlyph status={check.status} />
          <span className="min-w-0 flex-1 truncate text-secondary" title={check.name}>{check.name}</span>
          {check.url && (
            <button
              type="button"
              onClick={() => onOpenUrl(check.url!)}
              className="shrink-0 rounded-xs text-accent hover:underline -outline-offset-1"
            >
              {t('chat.prWatch.checks.details')}
            </button>
          )}
        </li>
      ))}
      {overflow > 0 && <li className="text-label-sm text-tertiary">{t('chat.prWatch.checks.more', { count: overflow })}</li>}
    </ul>
  )
}

function ReviewBody({ decision, details }: { decision: ReviewDecision; details?: PrDetails }) {
  const { t } = useTranslation()
  return (
    <div className="flex flex-col gap-1.5">
      <p className={cn('text-label-sm font-medium', TONE_TEXT[reviewTone(decision)])}>{t(REVIEW_KEY[decision])}</p>
      {details ? (
        details.reviewers.length > 0 && (
          <div className="flex flex-wrap gap-x-3 gap-y-1">
            {details.reviewers.map((reviewer) => (
              <span
                key={reviewer.login}
                className="inline-flex items-center gap-1 text-label-sm text-secondary"
                title={t(REVIEWER_KEY[reviewer.state])}
              >
                <ReviewerGlyph state={reviewer.state} />
                @{reviewer.login}
              </span>
            ))}
          </div>
        )
      ) : (
        <SkeletonLines lines={1} />
      )}
    </div>
  )
}

function ReviewerGlyph({ state }: { state: ReviewerState }) {
  switch (state) {
    case 'approved': return <CircleCheck className="size-3.5 shrink-0 text-success" aria-hidden />
    case 'changes_requested': return <CircleX className="size-3.5 shrink-0 text-destructive" aria-hidden />
    case 'commented': return <MessageSquare className="size-3.5 shrink-0 text-tertiary" aria-hidden />
    case 'pending': return <CircleDashed className="size-3.5 shrink-0 text-tertiary" aria-hidden />
  }
}

function MergeLine({ state }: { state: MergeState }) {
  const { t } = useTranslation()
  const Icon = MERGE_ICON[state]
  return (
    <p className={cn('flex items-center gap-1.5 text-label-sm', TONE_TEXT[mergeTone(state)])}>
      <Icon className="size-3.5 shrink-0" aria-hidden />
      {t(`chat.prWatch.merge.${state}`)}
    </p>
  )
}

const AUTO_MERGE_BLOCK_KEY: Record<PrAutoMergeBlock, string> = {
  'repo-disabled': 'chat.prWatch.autoMerge.blocked.repoDisabled',
  draft: 'chat.prWatch.autoMerge.blocked.draft',
  mergeable: 'chat.prWatch.autoMerge.blocked.mergeable',
  unavailable: 'chat.prWatch.autoMerge.blocked.unavailable',
}

/**
 * GitHub auto-merge toggle. Reflects `summary.autoMerge`, with an optimistic value held until the
 * next push confirms it (or ~6 s passes). A refusal reverts it at once and shows GitHub's reason
 * under it. While GitHub won't take auto-merge (`blocked`), the switch is off and says why; turning
 * it off always works. Enabling uses the repository's default merge method.
 */
function AutoMergeRow({ autoMerge, blocked, onSetAutoMerge }: {
  autoMerge?: PrAutoMergeState
  blocked?: PrAutoMergeBlock
  onSetAutoMerge: (enabled: boolean, method?: PrMergeMethod) => Promise<PrAutoMergeChange>
}) {
  const { t } = useTranslation()
  const serverEnabled = autoMerge?.enabled ?? false
  const [pending, setPending] = React.useState<boolean | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  // Only the latest click's answer counts (an older refusal must not undo a newer change)
  const requestRef = React.useRef(0)
  const autoMergeNoteId = React.useId()
  React.useEffect(() => {
    if (pending === null) return
    if (pending === serverEnabled) { setPending(null); return }
    const timer = setTimeout(() => setPending(null), 6000)
    return () => clearTimeout(timer)
  }, [pending, serverEnabled])
  const enabled = pending ?? serverEnabled
  const blockedKey = blocked && !enabled ? AUTO_MERGE_BLOCK_KEY[blocked] : null
  const unavailable = blockedKey !== null
  const note = error ?? (blockedKey ? t(blockedKey) : null)
  const toggle = (next: boolean) => {
    const request = ++requestRef.current
    setPending(next)
    setError(null)
    void onSetAutoMerge(next).then(result => {
      if (result.ok || request !== requestRef.current) return
      setPending(null)
      setError(result.error ?? t('chat.prWatch.autoMerge.failed'))
    })
  }
  return (
    <div className="pt-0.5">
      <div className="flex items-center justify-between gap-2">
        <span className={cn('min-w-0 text-label-sm', unavailable ? 'text-tertiary' : 'text-secondary')}>
          {t('chat.prWatch.autoMerge.label')}
          {enabled && autoMerge?.method && (
            <span className="text-tertiary"> · {t(`chat.prWatch.autoMerge.method.${autoMerge.method}`)}</span>
          )}
        </span>
        <Switch
          checked={enabled}
          disabled={unavailable}
          onCheckedChange={toggle}
          aria-label={t('chat.prWatch.autoMerge.label')}
          aria-describedby={note ? autoMergeNoteId : undefined}
        />
      </div>
      {note && (
        <p id={autoMergeNoteId} className={cn('mt-0.5 text-caption', error ? 'text-destructive' : 'text-tertiary')}>
          {note}
        </p>
      )}
    </div>
  )
}
