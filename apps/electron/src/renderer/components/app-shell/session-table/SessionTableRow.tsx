import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { Flag as FlagIcon, GripVertical } from 'lucide-react'
import type { SessionPriority } from '@craft-agent/shared/sessions/collection'
import type { SessionMeta } from '@/atoms/sessions'
import type { SessionStatusConfig } from '@/config/session-status-config'
import { getSessionTitle } from '@/utils/session'
import { cn } from '@/lib/utils'
import { isDueOverdue } from './table-due'

export interface SessionTableRowProps {
  meta: SessionMeta
  statuses?: SessionStatusConfig[]
  projectNameById: Map<string, string>
  labelById: Map<string, string>
  selected: boolean
  onSelect: (checked: boolean, shiftKey: boolean) => void
  onOpen: (sessionId: string) => void
  onUpdate: (partial: Partial<SessionMeta>) => void
  showGrip: boolean
  showStatus: boolean
  showPriority: boolean
  showProject: boolean
  showLabels: boolean
  showDue: boolean
  showModel: boolean
  showUpdated: boolean
  showCreated: boolean
  showFlag: boolean
  /** B5: HTML5 drag reorder callbacks (table host wires when showGrip). */
  onDragStartRow?: (sessionId: string) => void
  onDragOverRow?: (sessionId: string, event: React.DragEvent) => void
  dropIndicator?: 'before' | 'after' | null
  style?: React.CSSProperties
}

const PRIORITY_ORDER: SessionPriority[] = ['urgent', 'high', 'medium', 'low', 'none']

function formatRelative(ts: number | null | undefined): string {
  if (ts == null || !Number.isFinite(ts)) return '—'
  const diff = Date.now() - ts
  const m = Math.floor(diff / 60_000)
  if (m < 1) return '<1m'
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h`
  const d = Math.floor(h / 24)
  return `${d}d`
}

function formatDate(ts: number | null | undefined): string {
  if (ts == null || !Number.isFinite(ts)) return '—'
  return new Date(ts).toLocaleDateString()
}


function formatDue(
  dueDate: number | null | undefined,
  sessionStatus: string | null | undefined,
): { text: string; overdue: boolean } {
  if (dueDate == null || !Number.isFinite(dueDate)) return { text: '—', overdue: false }
  const d = new Date(dueDate)
  return {
    text: d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
    overdue: isDueOverdue(dueDate, sessionStatus),
  }
}

export function SessionTableRow({
  meta,
  statuses = [],
  projectNameById,
  labelById,
  selected,
  onSelect,
  onOpen,
  onUpdate,
  showGrip,
  showStatus,
  showPriority,
  showProject,
  showLabels,
  showDue,
  showModel,
  showUpdated,
  showCreated,
  showFlag,
  onDragStartRow,
  onDragOverRow,
  dropIndicator,
  style,
}: SessionTableRowProps) {
  const { t } = useTranslation()
  const title = getSessionTitle(meta as never) || meta.id.slice(0, 8)
  const due = formatDue(meta.dueDate, meta.sessionStatus)
  const priority = meta.priority ?? 'none'
  const sessionStatus: string = meta.sessionStatus ?? 'todo'

  const projectName = meta.projectId ? (projectNameById.get(meta.projectId) ?? meta.projectId) : ''
  const labelNames = (meta.labels ?? []).map((id) => labelById.get(id) ?? id).join(', ')

  const onPickDue = (v: string | null) => {
    if (v === null) {
      onUpdate({ dueDate: null })
      return
    }
    // Store UTC noon of picked local calendar day (PRD FR-16).
    const [y, m, d] = v.split('-').map(Number)
    const noon = Date.UTC(y, (m ?? 1) - 1, d ?? 1, 12, 0, 0)
    onUpdate({ dueDate: noon })
  }

  const dueInputValue = React.useMemo(() => {
    if (meta.dueDate == null || !Number.isFinite(meta.dueDate)) return ''
    const d = new Date(meta.dueDate)
    const y = d.getUTCFullYear()
    const m = String(d.getUTCMonth() + 1).padStart(2, '0')
    const day = String(d.getUTCDate()).padStart(2, '0')
    return `${y}-${m}-${day}`
  }, [meta.dueDate])

  return (
    <li
      className={cn(
        'group flex min-h-10 items-center gap-2 border-b border-border/30 px-3 py-1.5 text-sm hover:bg-foreground/[0.02]',
        selected && 'bg-foreground/[0.05]',
        dropIndicator === 'before' && 'border-t-2 border-t-foreground/40',
        dropIndicator === 'after' && 'border-b-2 border-b-foreground/40',
      )}
      style={style}
      aria-selected={selected}
      draggable={showGrip}
      onDragStart={() => onDragStartRow?.(meta.id)}
      onDragOver={(e) => {
        if (!onDragOverRow) return
        e.preventDefault()
        onDragOverRow(meta.id, e)
      }}
    >
      <span className="w-6 shrink-0">
        <input
          type="checkbox"
          checked={selected}
          onChange={(e) => onSelect(e.target.checked, (e.nativeEvent as MouseEvent).shiftKey)}
          aria-label={t('collection.table.select', { title })}
          data-selected={selected}
        />
      </span>
      {showGrip && (
        <span className="w-4 shrink-0 cursor-grab text-muted-foreground/50 active:cursor-grabbing">
          <GripVertical className="h-3.5 w-3.5" />
        </span>
      )}

      <button
        type="button"
        className="min-w-0 flex-1 truncate text-left hover:underline"
        onClick={() => onOpen(meta.id)}
        title={title}
      >
        {title}
      </button>

      {showStatus && (
        <span className="w-28 shrink-0">
          <select
            className="w-full rounded-md border border-border/60 bg-background px-1.5 py-0.5 text-xs"
            value={sessionStatus}
            onChange={(e) =>
              onUpdate({ sessionStatus: e.target.value })
            }
          >
            {(statuses.length > 0 ? statuses : [{ id: sessionStatus } as never]).map((s) => (
              <option key={s.id} value={s.id}>
                {s.label ?? s.id}
              </option>
            ))}
          </select>
        </span>
      )}

      {showPriority && (
        <span className="w-20 shrink-0">
          <select
            className="w-full rounded-md border border-border/60 bg-background px-1.5 py-0.5 text-xs"
            value={priority}
            onChange={(e) => onUpdate({ priority: e.target.value as SessionPriority })}
          >
            {PRIORITY_ORDER.map((p) => (
              <option key={p} value={p}>
                {t(`priority.${p}`)}
              </option>
            ))}
          </select>
        </span>
      )}

      {showProject && (
        <span className="w-28 shrink-0 truncate text-xs text-muted-foreground">{projectName || '—'}</span>
      )}

      {showLabels && (
        <span className="w-32 shrink-0 truncate text-xs text-muted-foreground">{labelNames || '—'}</span>
      )}

      {showDue && (
        <span className={cn('w-24 shrink-0', due.overdue && 'text-red-500 font-medium')}>
          <input
            type="date"
            className="w-full rounded-md border border-border/60 bg-background px-1 py-0.5 text-[11px]"
            value={dueInputValue}
            onChange={(e) => {
              if (!e.target.value) onPickDue(null)
              else onPickDue(e.target.value)
            }}
          />
        </span>
      )}

      {showModel && (
        <span className="w-24 shrink-0 truncate text-xs text-muted-foreground">{meta.model ?? '—'}</span>
      )}
      {showUpdated && (
        <span className="w-20 shrink-0 text-xs text-muted-foreground">{formatRelative(meta.lastMessageAt)}</span>
      )}
      {showCreated && (
        <span className="w-20 shrink-0 text-xs text-muted-foreground">{formatDate(meta.createdAt)}</span>
      )}

      {showFlag && (
        <button
          type="button"
          className={cn(
            'w-8 shrink-0 text-muted-foreground/50 hover:text-amber-400',
            meta.isFlagged && 'text-amber-500',
          )}
          aria-pressed={Boolean(meta.isFlagged)}
          onClick={() => onUpdate({ isFlagged: !meta.isFlagged })}
        >
          <FlagIcon className="h-3.5 w-3.5" fill={meta.isFlagged ? 'currentColor' : 'none'} />
        </button>
      )}
    </li>
  )
}
