import * as React from 'react'
import { ChevronDown, FolderKanban } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

/** A selectable project in the board filter. `color` is optional (plain dot when absent). */
export interface KanbanProjectFilterOption {
  id: string
  name: string
  color?: string
}

interface KanbanProjectFilterProps {
  projects: KanbanProjectFilterOption[]
  /** Selected project ids; empty = all projects. */
  value: string[]
  onChange: (next: string[]) => void
  className?: string
}

/**
 * Multi-select project filter for the board header. Each project is a checkbox
 * item that keeps the menu open on toggle (so several can be picked in one go);
 * the "All Projects" row clears the selection. An empty selection means no
 * filter — every task is shown.
 */
export function KanbanProjectFilter({ projects, value, onChange, className }: KanbanProjectFilterProps) {
  const { t } = useTranslation()
  const selected = React.useMemo(() => new Set(value), [value])

  const toggle = (id: string) => {
    const next = new Set(selected)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    onChange([...next])
  }

  const label =
    value.length === 0
      ? t('kanban.allProjects')
      : value.length === 1
        ? projects.find(p => p.id === value[0])?.name ?? t('kanban.projectsSelected', { count: 1 })
        : t('kanban.projectsSelected', { count: value.length })

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn(
            'inline-flex min-w-0 max-w-[200px] items-center gap-1.5 rounded-lg border border-border/60 bg-foreground/[0.02] px-2 py-1 text-xs font-medium text-foreground/70 transition-colors hover:bg-foreground/5 hover:text-foreground data-[state=open]:bg-foreground/5',
            className
          )}
        >
          <FolderKanban className="h-3.5 w-3.5 shrink-0 text-foreground/50" strokeWidth={2} />
          <span className="truncate">{label}</span>
          <ChevronDown className="h-3 w-3 shrink-0 text-foreground/40" strokeWidth={2} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-w-[260px]">
        <DropdownMenuItem className="text-xs" disabled={value.length === 0} onSelect={() => onChange([])}>
          {t('kanban.allProjects')}
        </DropdownMenuItem>
        {projects.length > 0 && <DropdownMenuSeparator />}
        {projects.map(project => (
          <DropdownMenuCheckboxItem
            key={project.id}
            className="text-xs"
            checked={selected.has(project.id)}
            onCheckedChange={() => toggle(project.id)}
            onSelect={e => e.preventDefault()}
          >
            <span className="flex min-w-0 items-center gap-1.5">
              <span
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ backgroundColor: project.color ?? 'var(--muted-foreground)' }}
                aria-hidden
              />
              <span className="truncate">{project.name}</span>
            </span>
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
