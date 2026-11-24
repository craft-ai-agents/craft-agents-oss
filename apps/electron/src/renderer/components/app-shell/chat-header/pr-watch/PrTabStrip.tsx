/**
 * The PR card's tabs, shown when a session tracks more than one PR: one compact tab per PR (its number
 * and status glyph; a draft's or closed PR's number is grey, a merged one's purple), as many whole tabs
 * as fit, then "+N" with the most urgent status among the PRs it hides and a menu of them. The active PR
 * always has a tab: it takes the last slot when it would be hidden.
 *
 * The same rules and technique as the chat header's label strip (`fitLabelCount`,
 * `visibleLabelIndexes`): every tab renders so it can be measured; hidden ones leave layout, sight and
 * the focus order.
 */

import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, ChevronDown } from 'lucide-react'
import { DropdownMenu, DropdownMenuTrigger, StyledDropdownMenuContent, StyledDropdownMenuItem } from '@/components/ui/styled-dropdown'
import type { PrNavEntry } from '@/hooks/usePrWatch'
import { cn } from '@/lib/utils'
import { fitLabelCount } from '../../fit-labels'
import { visibleLabelIndexes } from '../label-strip-layout'
import { mostUrgentStatus, prChipStatus, prStateTone, type PrSummary } from './pr-watch-state'
import { PR_STATE_ICON, PrStatusGlyph, TONE_TEXT } from './pr-watch-visuals'

const HIDDEN: React.CSSProperties = { position: 'absolute', visibility: 'hidden', pointerEvents: 'none' }
const TAB_GAP = 4
const TAB_CLASS = cn(
  'inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2 text-label-sm font-medium tabular-nums -outline-offset-2',
  'transition-[background-color] duration-micro ease-out-subtle hover:duration-instant hover:bg-fill-hover',
)
const MORE_CLASS = cn(TAB_CLASS, 'gap-1 px-1.5 text-secondary data-[state=open]:bg-fill-hover')

/** A tab's number colour carries the PR's state, so tabs need no state icon. */
function numberTone(summary: PrSummary, active: boolean): string {
  if (summary.state === 'merged') return TONE_TEXT.merged
  if (summary.state !== 'open') return 'text-tertiary'
  return active ? 'text-foreground' : 'text-secondary'
}

export interface PrTabStripProps {
  entries: readonly PrNavEntry[]
  activeIndex: number
  onSelect: (index: number) => void
  /** The "+N" menu opened: the hover card pins itself, since reaching the menu looks like leaving it */
  onMenuOpen?: () => void
}

export function PrTabStrip({ entries, activeIndex, onSelect, onMenuOpen }: PrTabStripProps) {
  const { t } = useTranslation()
  const stripRef = React.useRef<HTMLDivElement>(null)
  const probeRef = React.useRef<HTMLSpanElement>(null)
  const [fitCount, setFitCount] = React.useState(entries.length)

  React.useLayoutEffect(() => {
    const strip = stripRef.current
    const probe = probeRef.current
    if (!strip || !probe) return
    const tabs = Array.from(strip.querySelectorAll<HTMLElement>('[data-pr-tab]'))
    const measure = () => {
      const widths = tabs.map(tab => tab.getBoundingClientRect().width)
      const next = fitLabelCount(widths, strip.clientWidth, probe.getBoundingClientRect().width, TAB_GAP)
      setFitCount(previous => (previous === next ? previous : next))
    }
    measure()
    // The strip is sized by the card, never by its tabs, so this can't feed back into itself.
    const observer = new ResizeObserver(measure)
    observer.observe(strip)
    tabs.forEach(tab => observer.observe(tab))
    return () => observer.disconnect()
  }, [entries])

  const shown = new Set(visibleLabelIndexes(entries.length, fitCount, activeIndex))
  const hidden = entries.map((_, index) => index).filter(index => !shown.has(index))

  return (
    <div ref={stripRef} className="relative flex items-center gap-1 px-2.5 pt-2">
      {entries.map(({ id, summary }, index) => {
        const visible = shown.has(index)
        const active = index === activeIndex
        return (
          <button
            key={id}
            type="button"
            data-pr-tab
            aria-label={t('chat.prWatch.chipLabel', { number: summary.number, title: summary.title })}
            aria-current={active ? 'true' : undefined}
            aria-hidden={visible ? undefined : true}
            title={`#${summary.number} ${summary.title}`}
            onClick={() => onSelect(index)}
            className={cn(TAB_CLASS, active && 'bg-fill-selected hover:bg-fill-selected')}
            style={visible ? undefined : HIDDEN}
          >
            <span className={numberTone(summary, active)}>#{summary.number}</span>
            <PrStatusGlyph status={prChipStatus(summary)} className="size-3" />
          </button>
        )
      })}
      {/* Measures the widest "+N" (largest count, with a status glyph) without duplicating the menu */}
      <span ref={probeRef} aria-hidden="true" className={MORE_CLASS} style={HIDDEN}>
        +{entries.length}
        <AlertTriangle className="size-3" />
        <ChevronDown className="size-3" />
      </span>
      {hidden.length > 0 && <MorePrs entries={entries} hidden={hidden} onSelect={onSelect} onOpen={onMenuOpen} />}
    </div>
  )
}

/** "+N": the PRs without a tab, with the most urgent status among them; picking one shows it in the card. */
function MorePrs({ entries, hidden, onSelect, onOpen }: {
  entries: readonly PrNavEntry[]
  hidden: number[]
  onSelect: (index: number) => void
  onOpen?: () => void
}) {
  const { t } = useTranslation()
  const urgent = mostUrgentStatus(hidden.map(index => entries[index]!.summary))
  return (
    <DropdownMenu onOpenChange={(open) => { if (open) onOpen?.() }}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={t('chat.prWatch.otherPrs', { count: hidden.length })}
          title={hidden.map(index => `#${entries[index]!.summary.number}`).join(', ')}
          className={MORE_CLASS}
        >
          +{hidden.length}
          <PrStatusGlyph status={urgent} className="size-3" />
          <ChevronDown className="size-3 text-tertiary" aria-hidden />
        </button>
      </DropdownMenuTrigger>
      <StyledDropdownMenuContent align="end" sideOffset={6} className="w-[300px] max-w-[calc(100vw-24px)]">
        {hidden.map((index) => {
          const { id, summary } = entries[index]!
          const StateIcon = PR_STATE_ICON[summary.state]
          return (
            <StyledDropdownMenuItem key={id} onSelect={() => onSelect(index)}>
              <StateIcon className={cn('size-4 shrink-0', TONE_TEXT[prStateTone(summary.state)])} aria-hidden />
              <span className="min-w-0 flex-1 truncate" title={summary.title}>
                <span className="font-medium tabular-nums">#{summary.number}</span> {summary.title}
              </span>
              <PrStatusGlyph status={prChipStatus(summary)} />
            </StyledDropdownMenuItem>
          )
        })}
      </StyledDropdownMenuContent>
    </DropdownMenu>
  )
}
