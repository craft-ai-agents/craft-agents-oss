import { LayoutGrid, List } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'

export type BoardListValue = 'list' | 'board'

interface BoardListToggleProps {
  value: BoardListValue
  onChange: (value: BoardListValue) => void
  className?: string
}

/**
 * List ⇄ Board view switch. Rendered both in the sessions navigator header (list
 * mode) and in the board's own header (board mode), since the navigator is hidden
 * while the board is open and would otherwise have nowhere to host the switch.
 */
export function BoardListToggle({ value, onChange, className }: BoardListToggleProps) {
  const { t } = useTranslation()
  return (
    <div
      className={cn(
        'inline-flex items-center gap-0.5 rounded-lg border border-border/60 bg-foreground/[0.02] p-0.5',
        className
      )}
    >
      <ToggleButton active={value === 'list'} icon={List} label={t('kanban.list')} onClick={() => onChange('list')} />
      <ToggleButton
        active={value === 'board'}
        icon={LayoutGrid}
        label={t('kanban.board')}
        onClick={() => onChange('board')}
      />
    </div>
  )
}

function ToggleButton({
  active,
  icon: Icon,
  label,
  onClick,
}: {
  active: boolean
  icon: typeof List
  label: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium transition-colors',
        active ? 'bg-card text-foreground shadow-sm' : 'text-foreground/50 hover:text-foreground/80'
      )}
    >
      <Icon className="h-3.5 w-3.5" strokeWidth={2} />
      {label}
    </button>
  )
}
