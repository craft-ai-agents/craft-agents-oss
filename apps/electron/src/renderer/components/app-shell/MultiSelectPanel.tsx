/**
 * MultiSelectPanel - Empty state panel shown when multiple sessions are selected.
 *
 * Displays the selection count and provides batch action buttons for:
 * - Change status
 * - Set labels
 * - Archive selected sessions
 * - Clear selection
 */

import * as React from 'react'
import { Archive, Tag, CheckCircle2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Kbd, KbdGroup } from '@/components/ui/kbd'
import { cn } from '@/lib/utils'
import { isMac } from '@/lib/platform'
import { DropdownMenu, DropdownMenuTrigger, StyledDropdownMenuContent, StyledDropdownMenuItem, StyledDropdownMenuSeparator, StyledDropdownMenuSubContent, StyledDropdownMenuSubTrigger, DropdownMenuSub } from '@/components/ui/styled-dropdown'
import type { TodoStateId, TodoState } from '@/config/todo-states'
import type { LabelConfig } from '@craft-agent/shared/labels'
import { LabelMenuItems, StatusMenuItems } from './SessionMenuParts'

export interface MultiSelectPanelProps {
  /** Number of selected sessions */
  count: number
  /** Available todo states */
  todoStates?: TodoState[]
  /** Active status if all selected share the same state */
  activeStatusId?: TodoStateId | null
  /** Callback when setting status for all selected */
  onSetStatus?: (status: TodoStateId) => void
  /** Available label configs (tree) */
  labels?: LabelConfig[]
  /** Labels applied to all selected sessions */
  appliedLabelIds?: Set<string>
  /** Callback when toggling a label for all selected */
  onToggleLabel?: (labelId: string) => void
  /** Callback when archiving all selected */
  onArchive?: () => void
  /** Callback when clearing the selection */
  onClearSelection?: () => void
  /** Optional className for the container */
  className?: string
}

export function MultiSelectPanel({
  count,
  todoStates = [],
  activeStatusId,
  onSetStatus,
  labels = [],
  appliedLabelIds = new Set(),
  onToggleLabel,
  onArchive,
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
        <div className="text-sm text-foreground/50 flex flex-col items-center gap-1">
          <span>
            Use{' '}
            <KbdGroup>
              <Kbd>{isMac ? '⌘' : 'Ctrl'}</Kbd>
              <Kbd>Click</Kbd>
            </KbdGroup>{' '}
            to toggle,{' '}
            <KbdGroup>
              <Kbd>⇧</Kbd>
              <Kbd>Click</Kbd>
            </KbdGroup>{' '}
            for range
          </span>
          <span>
            Press <Kbd>Esc</Kbd> to clear selection
          </span>
        </div>
      </div>

      {/* Action buttons */}
      <div className="flex flex-wrap justify-center gap-2">
        {onSetStatus && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="gap-2 bg-background shadow-minimal hover:bg-foreground/[0.03]"
              >
                <CheckCircle2 className="w-4 h-4" />
                Change Status
              </Button>
            </DropdownMenuTrigger>
            <StyledDropdownMenuContent align="center">
              <StatusMenuItems
                todoStates={todoStates}
                activeStateId={activeStatusId ?? undefined}
                onSelect={onSetStatus}
                menu={{ MenuItem: StyledDropdownMenuItem }}
              />
            </StyledDropdownMenuContent>
          </DropdownMenu>
        )}
        {onToggleLabel && labels.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="gap-2 bg-background shadow-minimal hover:bg-foreground/[0.03]"
              >
                <Tag className="w-4 h-4" />
                Set Labels
              </Button>
            </DropdownMenuTrigger>
            <StyledDropdownMenuContent align="center" className="min-w-[220px]">
              <LabelMenuItems
                labels={labels}
                appliedLabelIds={appliedLabelIds}
                onToggle={onToggleLabel}
                menu={{
                  MenuItem: StyledDropdownMenuItem,
                  Separator: StyledDropdownMenuSeparator,
                  Sub: DropdownMenuSub,
                  SubTrigger: StyledDropdownMenuSubTrigger,
                  SubContent: StyledDropdownMenuSubContent,
                }}
              />
            </StyledDropdownMenuContent>
          </DropdownMenu>
        )}
        {onArchive && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onArchive}
            className="gap-2 bg-background shadow-minimal hover:bg-foreground/[0.03]"
          >
            <Archive className="w-4 h-4" />
            Archive
          </Button>
        )}
      </div>

      {/* Keyboard hint moved below click hint */}
    </div>
  )
}
