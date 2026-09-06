import * as React from 'react'
import {
  ProjectMultiSelectFilter,
  type ProjectFilterOption,
} from '../ProjectMultiSelectFilter'

/** A selectable project in the board filter. `color` is optional (plain dot when absent). */
export type KanbanProjectFilterOption = ProjectFilterOption

interface KanbanProjectFilterProps {
  projects: KanbanProjectFilterOption[]
  /** Selected project ids; empty = all projects. */
  value: string[]
  onChange: (next: string[]) => void
  className?: string
}

/**
 * Thin Kanban wrapper over the generic controlled ProjectMultiSelectFilter.
 * The board deliberately has no "No project" option (tiles without a project
 * are hidden while a filter is active), so `unassignedId` stays unset here.
 */
export function KanbanProjectFilter(props: KanbanProjectFilterProps) {
  return <ProjectMultiSelectFilter {...props} />
}
