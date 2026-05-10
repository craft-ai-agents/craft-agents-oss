import * as React from 'react'
import { Check, Loader2, X } from 'lucide-react'
import type { DiscoveredSkill } from '../../shared/types'
import { Button } from '@/components/ui/button'

export type RowStatus = 'pending' | 'installing' | 'done' | 'failed'

interface SkillRowState {
  skill: DiscoveredSkill
  selected: boolean
  status: RowStatus
  error?: string
}

interface SkillPickerProps {
  skills: DiscoveredSkill[]
  onConfirm: (selected: DiscoveredSkill[]) => void
  onCancel: () => void
  installing?: boolean
  rowStatuses?: Map<string, RowStatus>
}

export function SkillPicker({ skills, onConfirm, onCancel, installing = false, rowStatuses }: SkillPickerProps) {
  const [rows, setRows] = React.useState<SkillRowState[]>(() =>
    skills.map(skill => ({ skill, selected: true, status: 'pending' }))
  )

  React.useEffect(() => {
    if (!rowStatuses) return
    setRows(prev => prev.map(row => ({
      ...row,
      status: rowStatuses.get(row.skill.slug) ?? row.status,
    })))
  }, [rowStatuses])

  const allSelected = rows.every(r => r.selected)
  const noneSelected = rows.every(r => !r.selected)
  const selectedSkills = rows.filter(r => r.selected).map(r => r.skill)

  function toggleAll() {
    setRows(prev => prev.map(r => ({ ...r, selected: !allSelected })))
  }

  function toggleRow(slug: string) {
    setRows(prev => prev.map(r =>
      r.skill.slug === slug ? { ...r, selected: !r.selected } : r
    ))
  }

  const isInstalling = installing || rows.some(r => r.status === 'installing')
  const allDone = rows.filter(r => r.selected).every(r => r.status === 'done' || r.status === 'failed')

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="text-sm text-muted-foreground">
          {selectedSkills.length} of {rows.length} selected
        </span>
        <Button
          variant="ghost"
          size="sm"
          onClick={toggleAll}
          disabled={isInstalling}
          className="h-7 px-2 text-xs"
        >
          {allSelected ? 'Deselect all' : 'Select all'}
        </Button>
      </div>

      <div className="flex flex-col gap-1.5 rounded-md border border-foreground/10 bg-foreground/[0.02] p-2">
        {rows.map(row => (
          <SkillRow
            key={row.skill.slug}
            row={row}
            onToggle={toggleRow}
            disabled={isInstalling}
          />
        ))}
      </div>

      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onCancel} disabled={isInstalling && !allDone}>
          Cancel
        </Button>
        {!isInstalling && (
          <Button
            onClick={() => onConfirm(selectedSkills)}
            disabled={noneSelected}
          >
            Install selected
          </Button>
        )}
      </div>
    </div>
  )
}

function SkillRow({
  row,
  onToggle,
  disabled,
}: {
  row: SkillRowState
  onToggle: (slug: string) => void
  disabled: boolean
}) {
  return (
    <label className="flex cursor-pointer items-start gap-2.5 rounded px-2 py-1.5 hover:bg-foreground/[0.04]">
      <div className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border border-foreground/20">
        {row.selected && <Check className="h-3 w-3" />}
      </div>
      <input
        type="checkbox"
        className="sr-only"
        checked={row.selected}
        disabled={disabled}
        onChange={() => onToggle(row.skill.slug)}
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium">{row.skill.metadata.name}</span>
          <StatusBadge status={row.status} />
        </div>
        {row.skill.metadata.description && (
          <p className="truncate text-xs text-muted-foreground">{row.skill.metadata.description}</p>
        )}
        <p className="mt-0.5 truncate text-xs text-muted-foreground/60">{row.skill.sourcePath}</p>
      </div>
    </label>
  )
}

function StatusBadge({ status }: { status: RowStatus }) {
  if (status === 'pending') return null
  if (status === 'installing') {
    return <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
  }
  if (status === 'done') {
    return <Check className="h-3 w-3 text-green-500" />
  }
  return <X className="h-3 w-3 text-destructive" />
}
