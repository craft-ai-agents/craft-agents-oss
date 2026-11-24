/**
 * Coding mode's PR chip in the chat header's title row, after the working folder. A session tracks its
 * branch's PR plus any PRs pinned with pr_bind; the chip shows the ACTIVE one (its state glyph, number,
 * status glyph and, on wide panels, its title) and, when there are more, "+N" with the most urgent status
 * among the others. Hover opens the details card, a click pins it (see useHoverPopover); with more than
 * one PR the card starts with a tab per PR (PrTabStrip) to switch between them. The card's one action (Resolve / Fix / Fix CI, see prCardAction) sends a
 * fixed prompt to this session; on a pinned PR the prompt has the agent work in a separate checkout
 * (pinnedCheckoutPreface). Auto-fix runs unattended, so only on the branch's own PR (canFixLocally).
 * The auto-merge toggle and Unpin go through the server-side watcher.
 *
 * Renders only once an active PR is known: nothing for a folder that isn't a git repo, a branch
 * without a PR, a remote that isn't GitHub, a missing credential, or while the first lookup runs.
 */

import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { Wrench } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useAppShellContext } from '@/context/AppShellContext'
import { useHoverPopover } from '@/hooks/useHoverPopover'
import { cn } from '@/lib/utils'
import type { PrEntry, PrMergeMethod } from '@craft-agent/shared/protocol'
import type { PrAutoFixView, PrAutoMergeChange, PrWatchNav } from '@/hooks/usePrWatch'
import { canFixLocally, mostUrgentStatus, prCardAction, prCardActionMessage, prChipStatus, prStateTone, type PrChipStatus, type PrSummary, type PrWatchState } from './pr-watch-state'
import { PR_STATE_ICON, PrStatusGlyph, TONE_TEXT } from './pr-watch-visuals'
import { PrDetailsCard } from './PrDetailsCard'

/**
 * The title row's gaps around the chip, which the label strip reserves on top of the chip's width.
 * The chip itself never shrinks (the PR title only shows on wide panels), so the session title is
 * what gives way, after the folder name.
 */
export const PR_CHIP_RESERVE_PAD = 12

export interface ChatHeaderPrChipProps {
  /** The session the card's action prompts go to */
  sessionId: string
  /** The active PR as a single-PR state (the carousel's selection; see usePrWatch) */
  state: PrWatchState
  /** The session's PRs; with more than one the chip shows "+N" and the card its tabs */
  nav?: PrWatchNav
  /** Where the active PR came from — only `bound` PRs can be unbound */
  activeOrigin?: PrEntry['origin']
  onRefresh?: () => void
  /** Remove the active (bound) PR; the ref is its URL */
  onUnbind?: (ref: string) => void
  /** Toggle GitHub auto-merge on the active PR; the ref is its URL. Resolves with GitHub's answer */
  onSetAutoMerge?: (ref: string, enabled: boolean, method?: PrMergeMethod) => Promise<PrAutoMergeChange>
  /** Auto-fix (the card's Fix toggle) for the active PR; a turning wrench in the chip while on */
  autoFix?: PrAutoFixView
  onSetAutoFix?: (enabled: boolean) => void
  /** The card opened or closed (the data hook loads details while it is open) */
  onCardOpenChange?: (open: boolean) => void
  /** The chip element, which the label strip measures and keeps room for */
  onReserveElChange?: (el: HTMLElement | null) => void
}

export function ChatHeaderPrChip({ sessionId, state, nav, activeOrigin, onRefresh, onUnbind, onSetAutoMerge, autoFix, onSetAutoFix, onCardOpenChange, onReserveElChange }: ChatHeaderPrChipProps) {
  const { t } = useTranslation()
  const { onOpenUrl, onSendMessage } = useAppShellContext()
  const popover = useHoverPopover()
  // How the card was opened, kept after it closes: only a hover-opened card must not take or return focus
  const pinnedRef = React.useRef(false)
  if (popover.open) pinnedRef.current = popover.pinned
  React.useEffect(() => {
    onCardOpenChange?.(popover.open)
  }, [popover.open, onCardOpenChange])

  if (state.kind !== 'pr') return null

  const { summary, details } = state
  // Auto-fix runs unattended, so only on the branch's own PR; a pinned PR's actions use a separate checkout
  const fixable = canFixLocally(activeOrigin)
  const action = prCardAction(summary)
  const activeAutoFix = fixable ? autoFix : undefined
  const status = prChipStatus(summary)
  const multi = !!nav && nav.count > 1
  const others = multi ? nav.entries.filter((_, index) => index !== nav.index).map(entry => entry.summary) : []
  const othersStatus = mostUrgentStatus(others)
  // The PR that status comes from, so the chip's accessible name can say what it is (e.g. "2 open threads")
  const othersStatusSummary = othersStatus ? others.find(other => prChipStatus(other) === othersStatus) : undefined
  const handleAction = () => {
    const message = action && prCardActionMessage(action, summary, details, activeOrigin)
    if (!message) return
    onSendMessage(sessionId, message)
    popover.onOpenChange(false)
  }
  const StateIcon = PR_STATE_ICON[summary.state]

  return (
    <span ref={onReserveElChange} className="inline-flex shrink-0 items-center">
      <Popover open={popover.open} onOpenChange={popover.onOpenChange}>
        <PopoverTrigger asChild>
          <button
            type="button"
            {...popover.triggerProps}
            aria-label={[
              t('chat.prWatch.chipLabel', { number: summary.number, title: summary.title }),
              t(`chat.prWatch.state.${summary.state}`),
              status && statusLabel(status, summary, t),
              activeAutoFix?.enabled && t('chat.prWatch.autoFix.chip'),
              multi && t('chat.prWatch.otherPrs', { count: nav.count - 1 }),
              othersStatus && othersStatusSummary && statusLabel(othersStatus, othersStatusSummary, t),
            ].filter(Boolean).join(' · ')}
            className={cn(
              // The header is a window drag region: without no-drag, hover and clicks never reach the chip
              'titlebar-no-drag inline-flex h-6 shrink-0 items-center gap-1.5 rounded-md px-1.5 text-label-sm -outline-offset-2',
              'transition-[background-color] duration-micro ease-out-subtle hover:duration-instant',
              'hover:bg-fill-hover data-[state=open]:bg-fill-hover',
            )}
          >
            <span className="inline-flex shrink-0 items-center gap-1">
              <StateIcon className={cn('size-3.5 shrink-0', TONE_TEXT[prStateTone(summary.state)])} aria-hidden />
              <span className="font-medium tabular-nums text-secondary">#{summary.number}</span>
              <PrStatusGlyph status={status} />
              {activeAutoFix?.enabled && <Wrench className="size-3 shrink-0 text-accent animate-autofix-spin" aria-hidden />}
              {multi && (
                // The other PRs: how many, and the most urgent problem among them, so none goes unseen
                <span className="inline-flex items-center gap-0.5 text-caption tabular-nums text-tertiary">
                  +{nav.count - 1}
                  <PrStatusGlyph status={othersStatus} className="size-3" />
                </span>
              )}
            </span>
            {/* The PR title often repeats the session title: only wide panels spend room on it (the card has it) */}
            <span className="min-w-0 max-w-[220px] truncate text-tertiary @max-[60rem]/panel:hidden">{summary.title}</span>
          </button>
        </PopoverTrigger>
        <PopoverContent
          {...popover.contentProps}
          side="bottom"
          align="start"
          sideOffset={6}
          className="w-[380px] max-w-[calc(100vw-24px)] p-0"
          tabIndex={-1}
          // A hover-opened card never takes focus (the composer keeps it); a clicked one focuses the card itself
          onOpenAutoFocus={(event) => {
            event.preventDefault()
            if (pinnedRef.current) (event.currentTarget as HTMLElement | null)?.focus()
          }}
          onCloseAutoFocus={(event) => {
            if (!pinnedRef.current) event.preventDefault()
          }}
          // ←/→ step through the session's PRs. Here, not on the card: a clicked card focuses this element
          onKeyDown={(event) => {
            if (!multi || event.defaultPrevented || (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')) return
            // Leave the arrows to controls that use them (the "+N" menu's events bubble here through its portal)
            if ((event.target as HTMLElement).closest('[role="menu"], [role="menuitem"], input, textarea')) return
            const next = nav.index + (event.key === 'ArrowRight' ? 1 : -1)
            if (next < 0 || next >= nav.count) return
            event.preventDefault()
            nav.onSelect(next)
          }}
        >
          <PrDetailsCard
            summary={summary}
            details={details}
            refreshing={state.refreshing}
            onRefresh={onRefresh}
            onOpenUrl={onOpenUrl}
            action={action}
            onAction={handleAction}
            pinned={activeOrigin === 'bound'}
            onUnbind={onUnbind ? () => onUnbind(summary.url) : undefined}
            onSetAutoMerge={onSetAutoMerge ? (enabled, method) => onSetAutoMerge(summary.url, enabled, method) : undefined}
            autoFix={activeAutoFix}
            onSetAutoFix={fixable ? onSetAutoFix : undefined}
            tabs={multi ? { entries: nav.entries, activeIndex: nav.index, onSelect: nav.onSelect, onMenuOpen: popover.pin } : undefined}
          />
        </PopoverContent>
      </Popover>
    </span>
  )
}

/** The status glyph in words, for the chip's accessible name. */
function statusLabel(status: PrChipStatus, summary: PrSummary, t: (key: string, options?: Record<string, unknown>) => string): string {
  switch (status) {
    case 'resolve': return t('chat.prWatch.merge.conflicting')
    case 'fix': return summary.unresolvedThreads > 0
      ? t('chat.prWatch.openThreads', { count: summary.unresolvedThreads })
      : t('chat.prWatch.review.changesRequested')
    case 'fix-ci': return t('chat.prWatch.checks.failure')
    case 'pending': return t('chat.prWatch.checks.pending')
    case 'unsynced': return t('chat.prWatch.unsynced')
    case 'ok': return t('chat.prWatch.allGood')
  }
}
