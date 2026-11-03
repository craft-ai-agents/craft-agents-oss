import { useLayoutEffect, useMemo, useRef, useState } from "react"
import type * as React from "react"
import { useTranslation } from "react-i18next"
import { ChevronUp } from "lucide-react"
import { fitLabelCount } from './fit-labels'
import { cn } from "@/lib/utils"
import { formatDisplayValue, sessionLabelChips } from "@craft-agent/shared/labels"
import { EntityListLabelBadge } from "@/components/ui/entity-list-label-badge"
import { useSessionListContext } from "@/context/SessionListContext"
import type { SessionMeta } from "@/atoms/sessions"

interface SessionBadgesProps {
  item: SessionMeta
  /** Label entries left out: those the row's parent already shows (a task family's label) */
  hiddenLabels?: readonly string[]
}

/** Revealed chips slide 8px in from the left while fading in, one after another: the "expand in place"
 *  duration (200ms) with a 25ms stagger capped at 6 steps (spec §6.1). Under reduced motion the
 *  distance is 0, so only the fade remains. Collapsing is instant. */
const REVEAL_FROM: React.CSSProperties = { opacity: 0, translate: 'calc(-8px * var(--motion-scale)) 0' }
const REVEAL_TRANSITION = 'transition-[opacity,translate] duration-base ease-out'
const revealDelay = (step: number): React.CSSProperties => ({ transitionDelay: `calc(var(--stagger) * ${Math.min(step, 5)})` })

/** A div acting as a button: chips live inside the row's <button>, so no nested buttons. It keeps the
 *  press from reaching the row (which selects on mousedown) and handles Enter/Space by hand. */
export function chipButtonProps(onActivate: () => void) {
  return {
    role: 'button',
    tabIndex: 0,
    onMouseDown: (e: React.MouseEvent) => { e.stopPropagation(); e.preventDefault() },
    onClick: (e: React.MouseEvent) => { e.stopPropagation(); onActivate() },
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key !== 'Enter' && e.key !== ' ') return
      e.preventDefault()
      e.stopPropagation()
      onActivate()
    },
  } as const
}

/**
 * Label chips on a session row's second line: whole chips that fit, then "+N". Clicking "+N" expands the
 * line in place — the hidden chips slide in after the visible ones and wrap onto further lines — and a
 * trailing chevron collapses it again. The row grows once (no height animation, spec §6.1).
 */
export function SessionBadges({ item, hiddenLabels }: SessionBadgesProps) {
  const { t } = useTranslation()
  const ctx = useSessionListContext()
  const [expanded, setExpanded] = useState(false)
  const moreRef = useRef<HTMLDivElement>(null)
  const lessRef = useRef<HTMLDivElement>(null)

  // One chip per plain label, one per valued entry (shared with the chat header): a valued chip edits and
  // removes only its own entry, a plain chip every entry of its label. Chips are built from all entries
  // and filtered after, so `entryIndex` keeps pointing into the session's own labels.
  const chips = useMemo(() => {
    const labels = item.labels
    if (!labels?.length) return []
    const all = sessionLabelChips(labels, ctx.flatLabels)
    if (!hiddenLabels?.length) return all
    return all.filter(chip => !hiddenLabels.includes(chip.entryIndex === undefined ? chip.label.id : labels[chip.entryIndex]))
  }, [item.labels, ctx.flatLabels, hiddenLabels])

  const containerRef = useRef<HTMLDivElement>(null)
  const counterRef = useRef<HTMLSpanElement>(null)
  const [layout, setLayout] = useState({ count: Infinity, counterWidth: 0 })

  useLayoutEffect(() => {
    const container = containerRef.current
    const counter = counterRef.current
    if (!container || !counter) return
    const chipEls = Array.from(container.querySelectorAll<HTMLElement>('[data-label-measure]'))
    const measure = () => {
      // Read each chip's intrinsic capped width, not its current ellipsized fallback width — with the
      // SAME caps it renders with: later chips stop at 140px (EntityListLabelBadge's cap), but the first
      // chip may use the whole line when nothing is hidden. Measuring it at 140px made a long first label
      // ("TASK-craft-agents-ui-redesign-4") render wider than budgeted and push the rest out of the row.
      // Restore synchronously before paint.
      const previousMax = chipEls.map(chip => chip.style.maxWidth)
      chipEls.forEach((chip, index) => { chip.style.maxWidth = index === 0 ? `${container.clientWidth}px` : '140px' })
      const widths = chipEls.map(chip => chip.getBoundingClientRect().width)
      chipEls.forEach((chip, index) => { chip.style.maxWidth = previousMax[index] })
      const counterWidth = counter.getBoundingClientRect().width
      const count = Math.max(1, fitLabelCount(widths, container.clientWidth, counterWidth))
      setLayout(previous => previous.count === count && previous.counterWidth === counterWidth
        ? previous : { count, counterWidth })
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(container)
    chipEls.forEach(chip => observer.observe(chip))
    observer.observe(counter)
    return () => observer.disconnect()
  }, [chips])

  if (chips.length === 0) return null
  const hidden = chips.slice(layout.count)
  const isExpanded = expanded && hidden.length > 0
  const counterClass = 'shrink-0 h-5 @max-mobile/shell:h-6 px-1.5 rounded-xs bg-fill-hover text-label-sm text-secondary inline-flex items-center tabular-nums'
  const interactiveCounterClass = cn(counterClass, 'cursor-pointer -outline-offset-2 transition-[background-color,color] duration-micro ease-out-subtle hover:bg-fill-pressed hover:text-foreground hover:duration-instant')

  // Keyboard users keep their place: the activated control is replaced, so focus moves to its counterpart.
  const toggle = (next: boolean) => {
    const hadFocus = document.activeElement === (next ? moreRef.current : lessRef.current)
    setExpanded(next)
    if (hadFocus) requestAnimationFrame(() => (next ? lessRef.current : moreRef.current)?.focus({ preventScroll: true }))
  }

  return (
    <div ref={containerRef} data-slot="session-labels" className={cn('relative flex w-full min-w-0 items-center gap-1', isExpanded && 'flex-wrap')}>
      {chips.map(({ key, label, rawValue, entryIndex }, idx) => {
        const isHidden = !isExpanded && idx >= layout.count
        const isRevealed = isExpanded && idx >= layout.count
        return (
          <span key={key} data-label-measure
            className={cn('inline-flex shrink-0 min-w-0 max-w-[140px] [&>*]:max-w-full', isRevealed && REVEAL_TRANSITION)}
            aria-hidden={isHidden || undefined}
            style={isHidden
              ? { position: 'absolute', visibility: 'hidden', pointerEvents: 'none', ...REVEAL_FROM }
              : isRevealed ? revealDelay(idx - layout.count)
              : idx === 0 ? { maxWidth: hidden.length && !isExpanded ? `calc(100% - ${layout.counterWidth + 4}px)` : '100%' } : undefined}>
            <EntityListLabelBadge
              label={label}
              rawValue={rawValue}
              entryIndex={entryIndex}
              sessionLabels={item.labels || []}
              onLabelsChange={(updated) => ctx.onLabelsChange?.(item.id, updated)}
            />
          </span>
        )
      })}
      {/* Measure the widest possible counter without duplicating interactive label controls. */}
      <span ref={counterRef} aria-hidden className={counterClass} style={{ position: 'absolute', visibility: 'hidden' }}>
        +{chips.length}
      </span>
      {hidden.length > 0 && !isExpanded && (
        <div
          ref={moreRef}
          {...chipButtonProps(() => toggle(true))}
          aria-expanded={false}
          aria-label={t('chat.moreLabels', { count: hidden.length })}
          title={hidden.map(({ label, rawValue }) => rawValue ? `${label.name} · ${formatDisplayValue(rawValue, label.valueType)}` : label.name).join(', ')}
          className={interactiveCounterClass}
        >
          +{hidden.length}
        </div>
      )}
      {isExpanded && (
        // Enters last, after the revealed chips (inserted, so @starting-style runs the same slide-in)
        <div
          ref={lessRef}
          {...chipButtonProps(() => toggle(false))}
          aria-expanded={true}
          aria-label={t('session.showFewerLabels')}
          title={t('session.showFewerLabels')}
          className={cn(interactiveCounterClass, REVEAL_TRANSITION, 'starting:opacity-0 starting:[translate:calc(-8px*var(--motion-scale))_0]')}
          style={revealDelay(hidden.length)}
        >
          <ChevronUp className="size-3.5" aria-hidden />
        </div>
      )}
    </div>
  )
}
