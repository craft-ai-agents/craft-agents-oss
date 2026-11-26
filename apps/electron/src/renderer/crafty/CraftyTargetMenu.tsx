import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { Check, ChevronDown, MessageSquare, SquarePen } from 'lucide-react'
import { Spinner } from '@craft-agent/ui'
import { cn } from '@/lib/utils'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  StyledDropdownMenuContent,
  StyledDropdownMenuItem,
  StyledDropdownMenuSeparator,
} from '@/components/ui/styled-dropdown'
import { COMPOSER_CHIP } from '@/components/app-shell/input/composer-styles'
import { ipcErrorMessage } from '@/lib/ipc-error'
import type { CraftySessionSummary } from '../../shared/crafty'
import { filterSessions, newSessionLabel, sessionTitle, shortAge } from './target'

const crafty = window.electronAPI.crafty!

/** As quiet as the model chip: where the answer goes matters, but the question comes first. */
const CHIP = 'h-control-sm shrink gap-1 pl-2 pr-1.5 text-label-sm font-normal text-tertiary'
const GROUP_LABEL = 'px-2 pt-2 pb-1 text-label-sm font-medium text-tertiary select-none'
/** Rows the menu renders; the search looks through every listed session. */
const MAX_ROWS = 40

interface CraftyTargetMenuProps {
  invocationId: string
  target: CraftySessionSummary | null
  /** The workspace's name when there's more than one: new sessions say where they go. */
  workspaceLabel: string | null
  /** While an answer streams: the conversation can't move. */
  disabled: boolean
  onPick: (target: CraftySessionSummary | null) => void
}

/**
 * The panel's target chip: a new session (each question starts one) or an existing session of the
 * workspace, kept until you change it. Non-modal for the same reason as the model menu: in this
 * click-through window a modal menu would let clicks fall through to the app underneath.
 */
export function CraftyTargetMenu({ invocationId, target, workspaceLabel, disabled, onPick }: CraftyTargetMenuProps) {
  const [open, setOpen] = useState(false)
  const [sessions, setSessions] = useState<CraftySessionSummary[] | null>(null)
  /** Why the list didn't load (a remote workspace's server can be out of reach). */
  const [loadError, setLoadError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const newLabel = newSessionLabel(workspaceLabel)

  // Fresh on every open: titles, the working marker and new sessions change while the window waits
  useEffect(() => {
    if (!open) return
    let current = true
    setQuery('')
    setLoadError(null)
    // Inside the chain: an older preload (hot reload before the app restarted) has no listSessions
    Promise.resolve()
      .then(() => crafty.listSessions(invocationId))
      .then(list => { if (current) setSessions(list) })
      .catch((error: unknown) => {
        if (!current) return
        setSessions([])
        setLoadError(ipcErrorMessage(error))
      })
    const frame = requestAnimationFrame(() => inputRef.current?.focus())
    const onBlur = () => setOpen(false)
    window.addEventListener('blur', onBlur)
    return () => {
      current = false
      cancelAnimationFrame(frame)
      window.removeEventListener('blur', onBlur)
    }
  }, [invocationId, open])

  const matches = useMemo(() => filterSessions(sessions ?? [], query).slice(0, MAX_ROWS), [query, sessions])
  const now = Date.now()

  const pick = (next: CraftySessionSummary | null) => {
    setOpen(false)
    onPick(next)
  }

  const onSearchKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    // Esc reaches the menu, which closes; arrows hand over to its keyboard navigation
    if (e.key === 'Escape') return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      e.currentTarget.closest('[role="menu"]')?.querySelector<HTMLElement>('[role="menuitem"]')?.focus()
      return
    }
    // Everything else is typing: keep it from the menu's typeahead
    e.stopPropagation()
    if (e.key === 'Enter' && query.trim() && matches[0]) {
      e.preventDefault()
      pick(matches[0])
    }
  }

  const groupLabel = query.trim() ? 'Matching sessions' : 'Recent sessions'

  return (
    <DropdownMenu open={open} onOpenChange={setOpen} modal={false}>
      <DropdownMenuTrigger asChild disabled={disabled}>
        <button type="button" className={cn(COMPOSER_CHIP, CHIP, 'max-w-52', open && 'bg-fill-hover text-foreground')} title="Where Crafty sends">
          {target ? <MessageSquare className="size-3.5 shrink-0" /> : <SquarePen className="size-3.5 shrink-0" />}
          <span className="min-w-0 truncate">{target ? sessionTitle(target) : newLabel}</span>
          <ChevronDown className="size-3.5 shrink-0" />
        </button>
      </DropdownMenuTrigger>
      <StyledDropdownMenuContent align="end" sideOffset={6} className="w-72 max-h-80">
        <div className="px-1 pb-1">
          <input
            ref={inputRef}
            value={query}
            placeholder="Search sessions…"
            className="field-surface h-control w-full rounded-md px-2 text-label outline-none placeholder:text-tertiary"
            onChange={e => setQuery(e.target.value)}
            onKeyDown={onSearchKeyDown}
          />
        </div>
        {!query.trim() && (
          <>
            <StyledDropdownMenuItem onSelect={() => pick(null)}>
              <SquarePen />
              <span className="min-w-0 flex-1 truncate">{newLabel}</span>
              {!target && <Check className="size-3.5 text-secondary" />}
            </StyledDropdownMenuItem>
            <StyledDropdownMenuSeparator />
          </>
        )}
        <div className={cn(GROUP_LABEL, 'truncate')}>{workspaceLabel ? `${groupLabel} in ${workspaceLabel}` : groupLabel}</div>
        {sessions === null ? (
          <div className="flex items-center gap-2 px-2 py-1.5 text-label-sm text-tertiary"><Spinner /> Loading…</div>
        ) : loadError ? (
          <div role="alert" className="px-2 py-1.5 text-label-sm text-destructive">{loadError}</div>
        ) : matches.length === 0 ? (
          <div className="px-2 py-1.5 text-label-sm text-tertiary">{query.trim() ? 'No session matches.' : 'No sessions yet.'}</div>
        ) : (
          matches.map(session => (
            <StyledDropdownMenuItem key={session.sessionId} onSelect={() => pick(session)}>
              {session.isProcessing ? <Spinner className="size-3.5" /> : <MessageSquare />}
              <span className="min-w-0 flex-1 truncate">{sessionTitle(session)}</span>
              <span className="shrink-0 text-label-sm tabular-nums text-tertiary">
                {session.isProcessing ? 'working' : shortAge(session.lastMessageAt, now)}
              </span>
              {target?.sessionId === session.sessionId && <Check className="size-3.5 text-secondary" />}
            </StyledDropdownMenuItem>
          ))
        )}
      </StyledDropdownMenuContent>
    </DropdownMenu>
  )
}
