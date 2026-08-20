import { LayoutGrid, List, Table2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'

export type CollectionViewMode = 'list' | 'board' | 'table'

export interface CollectionViewToggleProps {
  value: CollectionViewMode
  onChange: (value: CollectionViewMode) => void
  className?: string
}

/**
 * List ⇄ Board ⇄ Table view switch. Rendered in the sessions navigator header
 * (list mode), the board header (board mode — navigator is collapsed), and the
 * table host header.
 */
export function CollectionViewToggle({ value, onChange, className }: CollectionViewToggleProps) {
  const { t } = useTranslation()
  return (
    <div
      className={cn(
        'inline-flex items-center gap-0.5 rounded-lg border border-border/60 bg-foreground/[0.02] p-0.5',
        className
      )}
    >
      <ToggleButton
        active={value === 'list'}
        icon={List}
        label={t('collection.view.list')}
        onClick={() => onChange('list')}
      />
      <ToggleButton
        active={value === 'board'}
        icon={LayoutGrid}
        label={t('collection.view.board')}
        onClick={() => onChange('board')}
      />
      <ToggleButton
        active={value === 'table'}
        icon={Table2}
        label={t('collection.view.table')}
        onClick={() => onChange('table')}
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
