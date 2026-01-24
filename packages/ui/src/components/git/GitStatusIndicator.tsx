import React from 'react'
import { cn } from '../../lib/utils'

export type GitStatus = 'staged' | 'unstaged' | 'untracked' | 'modified' | 'added' | 'deleted' | 'renamed' | 'unmodified'

export interface GitStatusIndicatorProps {
  status: GitStatus
  className?: string
  showLabel?: boolean
}

const statusConfig: Record<GitStatus, { label: string; color: string; shortLabel: string }> = {
  staged: { label: 'Staged', color: 'text-green-600 dark:text-green-400', shortLabel: 'S' },
  unstaged: { label: 'Unstaged', color: 'text-yellow-600 dark:text-yellow-400', shortLabel: 'U' },
  untracked: { label: 'Untracked', color: 'text-gray-600 dark:text-gray-400', shortLabel: '?' },
  modified: { label: 'Modified', color: 'text-blue-600 dark:text-blue-400', shortLabel: 'M' },
  added: { label: 'Added', color: 'text-green-600 dark:text-green-400', shortLabel: 'A' },
  deleted: { label: 'Deleted', color: 'text-red-600 dark:text-red-400', shortLabel: 'D' },
  renamed: { label: 'Renamed', color: 'text-purple-600 dark:text-purple-400', shortLabel: 'R' },
  unmodified: { label: 'Unmodified', color: 'text-gray-400 dark:text-gray-500', shortLabel: '' }
}

export function GitStatusIndicator({ status, className, showLabel = false }: GitStatusIndicatorProps) {
  const config = statusConfig[status]

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 text-xs font-medium',
        config.color,
        className
      )}
      title={config.label}
    >
      <span className="font-mono font-bold">{config.shortLabel}</span>
      {showLabel && <span>{config.label}</span>}
    </span>
  )
}
