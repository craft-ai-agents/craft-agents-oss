/**
 * The chat header's label chips (design spec §7.3): neutral chips with the label's color dot, at
 * most three whole chips that fit (one in Coding mode, which keeps the row for the PR chip), then "+N". "+N" lists the labels that didn't fit (picking one
 * opens its value editor on a pinned chip) above the Labels toggles. A valued label just applied
 * from the composer's `#` menu opens its editor here too.
 *
 * Every chip renders so it can be measured. Hidden chips leave layout, sight and the focus order
 * (`visibility: hidden`), the same technique as the session row's `SessionBadges`.
 */

import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { useAtom } from 'jotai'
import { flattenLabels, formatDisplayValue, sessionLabelChips, type LabelConfig, type SessionLabelChip } from '@craft-agent/shared/labels'
import { EntityListLabelBadge } from '@/components/ui/entity-list-label-badge'
import { LabelIcon } from '@/components/ui/label-icon'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  StyledDropdownMenuContent,
  StyledDropdownMenuItem,
  StyledDropdownMenuSeparator,
} from '@/components/ui/styled-dropdown'
import { useMenuComponents } from '@/components/ui/menu-context'
import { useAppShellContext } from '@/context/AppShellContext'
import { useSessionMenuActions } from '@/hooks/useSessionMenuActions'
import { pendingLabelValueEditAtom, PENDING_LABEL_VALUE_EDIT_TTL_MS } from '@/atoms/label-value-edit'
import type { SessionMeta } from '@/atoms/sessions'
import { cn } from '@/lib/utils'
import { LabelMenuItems } from '../SessionMenuParts'
import { CHAT_HEADER_MAX_LABELS, headerLabelFitCount, labelStripBudget, visibleLabelIndexes } from './label-strip-layout'
import { PR_CHIP_RESERVE_PAD } from './pr-watch/ChatHeaderPrChip'

const NO_LABELS: string[] = []
const HIDDEN: React.CSSProperties = { position: 'absolute', visibility: 'hidden', pointerEvents: 'none' }
const COUNTER_CLASS = 'shrink-0 h-5 px-1.5 rounded-xs bg-fill-hover text-label-sm text-secondary inline-flex items-center tabular-nums'

interface ChatHeaderLabelsProps {
  item: SessionMeta
  /** Workspace label tree */
  labels: LabelConfig[]
  onLabelsChange: (labels: string[]) => void
  /** The title row the strip sits in: its width sets the strip's budget (null until it mounts) */
  rowEl: HTMLElement | null
  /** At most this many chips before "+N" (default {@link CHAT_HEADER_MAX_LABELS}) */
  maxLabels?: number
  /** The Coding-mode PR chip: its width is kept free of labels */
  reserveEl?: HTMLElement | null
}

export function ChatHeaderLabels({ item, labels, onLabelsChange, rowEl, maxLabels = CHAT_HEADER_MAX_LABELS, reserveEl }: ChatHeaderLabelsProps) {
  const { panelId } = useAppShellContext()
  const sessionLabels = item.labels ?? NO_LABELS
  const flatLabels = React.useMemo(() => flattenLabels(labels), [labels])
  // One chip per plain label, one per valued entry (shared with the session row's chips)
  const resolved = React.useMemo(() => sessionLabelChips(sessionLabels, flatLabels), [sessionLabels, flatLabels])

  const stripRef = React.useRef<HTMLDivElement>(null)
  const counterProbeRef = React.useRef<HTMLSpanElement>(null)
  const [fitCount, setFitCount] = React.useState(maxLabels)
  // The chip whose value editor is open stays visible even when the strip runs out of room. Scoped to the
  // session: the chat page (and this header) outlives session switches, and chip keys repeat across sessions.
  const [openChip, setOpenChip] = React.useState<{ sessionId: string; key: string } | null>(null)
  const openKey = openChip?.sessionId === item.id ? openChip.key : null

  // Forget an open chip once it is gone (its label was removed or moved, or the session changed), so it
  // can't pop open again when a label with the same key comes back later.
  React.useEffect(() => {
    if (!openChip) return
    if (openChip.sessionId !== item.id || !resolved.some(chip => chip.key === openChip.key)) setOpenChip(null)
  }, [openChip, item.id, resolved])

  React.useLayoutEffect(() => {
    const strip = stripRef.current
    const row = rowEl
    const probe = counterProbeRef.current
    if (!strip || !row || !probe) return
    const chips = Array.from(strip.querySelectorAll<HTMLElement>('[data-label-chip]'))
    const measure = () => {
      const widths = chips.map(chip => chip.getBoundingClientRect().width)
      // The PR chip never shrinks, so reserving it can't feed back into the strip either.
      const reserved = reserveEl ? reserveEl.getBoundingClientRect().width + PR_CHIP_RESERVE_PAD : 0
      const budget = labelStripBudget(row.clientWidth, reserved)
      const next = headerLabelFitCount(widths, budget, probe.getBoundingClientRect().width, undefined, maxLabels)
      setFitCount(previous => (previous === next ? previous : next))
    }
    measure()
    // The row is sized by the header, never by the chips, so this can't feed back into itself.
    const observer = new ResizeObserver(measure)
    observer.observe(row)
    chips.forEach(chip => observer.observe(chip))
    observer.observe(probe)
    if (reserveEl) observer.observe(reserveEl)
    return () => observer.disconnect()
  }, [resolved, rowEl, reserveEl, maxLabels])

  // A valued label applied from the composer's # menu: open its editor once the label has arrived. Only the
  // header in the asking composer's panel answers: the same session can be open in two panels.
  const [pendingEdit, setPendingEdit] = useAtom(pendingLabelValueEditAtom)
  React.useEffect(() => {
    if (!pendingEdit || pendingEdit.sessionId !== item.id || pendingEdit.panelId !== panelId) return
    if (Date.now() - pendingEdit.requestedAt > PENDING_LABEL_VALUE_EDIT_TTL_MS) {
      setPendingEdit(null)
      return
    }
    // The newest entry with that id is the one just added.
    const target = [...resolved].reverse().find(chip => chip.label.id === pendingEdit.labelId)
    if (!target) return
    setPendingEdit(null)
    setOpenChip({ sessionId: item.id, key: target.key })
  }, [pendingEdit, item.id, panelId, resolved, setPendingEdit])

  const [moreOpen, setMoreOpen] = React.useState(false)
  // While its menu is open, "+N" stays put (with its last count) even if a toggle leaves nothing hidden,
  // so the menu doesn't vanish mid-use.
  const lastHiddenCountRef = React.useRef(0)

  // An open "+N" menu keeps the strip (and itself) mounted even after its toggles removed every label.
  if (resolved.length === 0 && !moreOpen) return null

  const pinnedIndex = openKey ? resolved.findIndex(chip => chip.key === openKey) : -1
  const shown = new Set(visibleLabelIndexes(resolved.length, fitCount, pinnedIndex >= 0 ? pinnedIndex : undefined))
  const hidden = resolved.filter((_, index) => !shown.has(index))
  if (hidden.length > 0) lastHiddenCountRef.current = hidden.length

  return (
    <div ref={stripRef} data-slot="chat-header-labels" className="titlebar-no-drag relative ml-auto flex shrink-0 items-center gap-1 pl-2">
      {resolved.map((chip, index) => {
        const visible = shown.has(index)
        return (
          <span
            key={chip.key}
            data-label-chip
            aria-hidden={visible ? undefined : true}
            className={cn('inline-flex min-w-0 shrink-0 [&>*]:max-w-full', maxLabels < CHAT_HEADER_MAX_LABELS ? 'max-w-[96px]' : 'max-w-[140px]')}
            style={visible ? undefined : HIDDEN}
          >
            <EntityListLabelBadge
              label={chip.label}
              rawValue={chip.rawValue}
              sessionLabels={sessionLabels}
              onLabelsChange={onLabelsChange}
              entryIndex={chip.entryIndex}
              open={openKey === chip.key}
              onOpenChange={(open) => setOpenChip(current => (
                open ? { sessionId: item.id, key: chip.key } : current?.key === chip.key ? null : current
              ))}
              sessionId={item.id}
              popoverSide="bottom"
            />
          </span>
        )
      })}
      {/* Measures the widest counter without duplicating interactive controls */}
      <span ref={counterProbeRef} aria-hidden="true" className={COUNTER_CLASS} style={HIDDEN}>
        +{resolved.length}
      </span>
      {(hidden.length > 0 || moreOpen) && (
        <MoreLabelsButton
          count={hidden.length || lastHiddenCountRef.current}
          hidden={hidden}
          item={item}
          labels={labels}
          onLabelsChange={onLabelsChange}
          open={moreOpen}
          onOpenChange={(open) => {
            setMoreOpen(open)
            // Nothing hidden any more: "+N" unmounts with its menu, so hand focus to the last chip rather
            // than letting it fall to the page. After the unmount: the open menu traps focus until then.
            if (!open && hidden.length === 0) {
              requestAnimationFrame(() => {
                const chips = stripRef.current?.querySelectorAll<HTMLElement>('[data-label-chip] [role="button"]')
                chips?.[chips.length - 1]?.focus()
              })
            }
          }}
          onEdit={(key) => setOpenChip({ sessionId: item.id, key })}
        />
      )}
    </div>
  )
}

/**
 * "+N": the labels that didn't fit (picking one opens its value editor on its chip), then the same
 * Labels toggles as the session menu's Labels submenu.
 */
function MoreLabelsButton({
  count,
  hidden,
  item,
  labels,
  onLabelsChange,
  open,
  onOpenChange,
  onEdit,
}: {
  count: number
  hidden: SessionLabelChip[]
  item: SessionMeta
  labels: LabelConfig[]
  onLabelsChange: (labels: string[]) => void
  open: boolean
  onOpenChange: (open: boolean) => void
  onEdit: (key: string) => void
}) {
  const { t } = useTranslation()
  const menu = useMenuComponents()
  const actions = useSessionMenuActions({ item, onLabelsChange })
  // Set when a hidden label is picked: its value editor takes focus, so the closing menu mustn't hand it back.
  const editingRef = React.useRef(false)
  const describe = ({ label, rawValue }: SessionLabelChip) =>
    rawValue ? `${label.name} · ${formatDisplayValue(rawValue, label.valueType)}` : label.name

  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={t('chat.moreLabels', { count })}
          title={hidden.map(describe).join(', ')}
          className={cn(COUNTER_CLASS, 'cursor-pointer -outline-offset-2 hover:bg-fill-pressed data-[state=open]:bg-fill-pressed')}
        >
          +{count}
        </button>
      </DropdownMenuTrigger>
      <StyledDropdownMenuContent
        align="end"
        sideOffset={6}
        onCloseAutoFocus={(event) => {
          if (!editingRef.current) return
          editingRef.current = false
          event.preventDefault()
        }}
      >
        {hidden.map((chip) => (
          <StyledDropdownMenuItem
            key={chip.key}
            onSelect={() => {
              editingRef.current = true
              onEdit(chip.key)
            }}
          >
            <LabelIcon label={chip.label} size="sm" />
            <span className="flex-1 truncate">{describe(chip)}</span>
          </StyledDropdownMenuItem>
        ))}
        {hidden.length > 0 && <StyledDropdownMenuSeparator />}
        <LabelMenuItems
          labels={labels}
          appliedLabelIds={actions.appliedLabelIds}
          onToggle={actions.toggleLabel}
          menu={menu}
        />
      </StyledDropdownMenuContent>
    </DropdownMenu>
  )
}
