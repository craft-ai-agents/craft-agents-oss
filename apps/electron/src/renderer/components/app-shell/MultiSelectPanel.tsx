/**
 * MultiSelectPanel - Empty state panel shown when multiple sessions are selected.
 *
 * Displays the selection count and provides batch action buttons for:
 * - Set status (Mark Done, Mark Todo)
 * - Delete selected sessions
 * - Clear selection
 */

import * as React from 'react'
import { Trash2, CheckCircle2, Circle, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { isMac } from '@/lib/platform'

export interface MultiSelectPanelProps {
  /** Number of selected sessions */
  count: number
  /** Callback when setting status for all selected */
  onSetStatus?: (status: 'done' | 'todo') => void
  /** Callback when deleting all selected */
  onDelete?: () => void
  /** Callback when clearing the selection */
  onClearSelection?: () => void
  /** Optional className for the container */
  className?: string
}

export function MultiSelectPanel({
  count,
  onSetStatus,
  onDelete,
  onClearSelection,
  className,
}: MultiSelectPanelProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center h-full gap-6 p-8',
        className
      )}
    >
      {/* Selection count */}
      <div className="flex flex-col items-center gap-2">
        <div className="w-16 h-16 rounded-full bg-accent/10 flex items-center justify-center">
          <span className="text-2xl font-semibold text-accent">{count}</span>
        </div>
        <h2 className="text-lg font-medium text-foreground">
          {count} {count === 1 ? 'Chat' : 'Chats'} selected
        </h2>
        <p className="text-sm text-muted-foreground">
          Use {isMac ? '⌘' : 'Ctrl'}+Click to toggle, Shift+Click for range
        </p>
      </div>

      {/* Action buttons */}
      <div className="flex flex-wrap justify-center gap-2">
        {onSetStatus && (
          <>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onSetStatus('done')}
              className="gap-2 shadow-minimal"
            >
              <CheckCircle2 className="w-4 h-4" />
              Mark Done
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onSetStatus('todo')}
              className="gap-2 shadow-minimal"
            >
              <Circle className="w-4 h-4" />
              Mark Todo
            </Button>
          </>
        )}
        {onDelete && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onDelete}
            className="gap-2 text-destructive hover:text-destructive hover:bg-destructive/10 shadow-tinted"
          >
            <Trash2 className="w-4 h-4" />
            Delete
          </Button>
        )}
      </div>

      {/* Clear selection link */}
      {onClearSelection && (
        <button
          onClick={onClearSelection}
          className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <X className="w-3.5 h-3.5" />
          Clear selection
        </button>
      )}

      {/* Keyboard hint */}
      <p className="text-xs text-muted-foreground/60">
        Press Escape to clear selection
      </p>
    </div>
  )
}
