/**
 * SchedulesPanel - Navigator panel for managing scheduled prompts
 *
 * Shows a list of scheduled prompts with their schedule description and prompt.
 * Allows adding, editing, and deleting schedules via context menu.
 */

import * as React from 'react'
import { useState } from 'react'
import { Calendar, Clock, Pause, Plus, Settings2 } from 'lucide-react'
import type { ScheduledPromptConfig } from '@craft-agent/shared/schedules'
import { formatScheduleDescription } from '@craft-agent/shared/schedules/utils'
import { cn } from '@/lib/utils'
import {
  ContextMenu,
  ContextMenuTrigger,
  StyledContextMenuContent,
} from '@/components/ui/styled-context-menu'
import { ContextMenuProvider } from '@/components/ui/menu-context'
import { ScheduleMenu } from '@/components/schedules/ScheduleMenu'
import { EditScheduleDialog } from '@/components/schedules/EditScheduleDialog'
import { toast } from 'sonner'

interface SchedulesPanelProps {
  schedules: ScheduledPromptConfig[]
  workspaceId: string
  workspaceRootPath?: string
  onAddSchedule?: () => void
  onEditSchedules?: () => void
}

export function SchedulesPanel({
  schedules,
  workspaceId,
  workspaceRootPath,
  onAddSchedule,
  onEditSchedules,
}: SchedulesPanelProps) {
  const enabledCount = schedules.filter(s => s.enabled).length

  // Edit dialog state
  const [editingSchedule, setEditingSchedule] = useState<ScheduledPromptConfig | null>(null)
  const [editDialogOpen, setEditDialogOpen] = useState(false)

  const handleEdit = (schedule: ScheduledPromptConfig) => {
    setEditingSchedule(schedule)
    // Defer dialog open to next frame to let context menu fully close
    requestAnimationFrame(() => setEditDialogOpen(true))
  }

  const handleSave = async (updates: Partial<ScheduledPromptConfig>) => {
    if (!editingSchedule) return
    try {
      const result = await window.electronAPI.updateSchedule(
        workspaceId,
        editingSchedule.id,
        updates
      )
      if (result) {
        toast.success('Schedule updated')
      } else {
        toast.error('Failed to update schedule')
      }
    } catch (error) {
      console.error('Failed to update schedule:', error)
      toast.error('Failed to update schedule')
    }
  }

  const handleDelete = async (scheduleId: string) => {
    try {
      const success = await window.electronAPI.deleteSchedule(workspaceId, scheduleId)
      if (success) {
        toast.success('Schedule deleted')
      } else {
        toast.error('Failed to delete schedule')
      }
    } catch (error) {
      console.error('Failed to delete schedule:', error)
      toast.error('Failed to delete schedule')
    }
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border/50">
        <div className="flex items-center gap-2">
          <Calendar className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium">Scheduled Prompts</span>
          {enabledCount > 0 && (
            <span className="text-xs text-muted-foreground">({enabledCount} active)</span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {onEditSchedules && (
            <button
              onClick={onEditSchedules}
              className="p-1.5 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
              title="Edit schedules"
            >
              <Settings2 className="h-4 w-4" />
            </button>
          )}
          {onAddSchedule && (
            <button
              onClick={onAddSchedule}
              className="p-1.5 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
              title="Add schedule"
            >
              <Plus className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      {/* Schedule List */}
      <div className="flex-1 overflow-y-auto">
        {schedules.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center px-4 py-8">
            <Calendar className="h-10 w-10 text-muted-foreground/50 mb-3" />
            <p className="text-sm text-muted-foreground mb-1">No scheduled prompts</p>
            <p className="text-xs text-muted-foreground/70 mb-4">
              Schedules automatically send prompts at configured times
            </p>
            {onAddSchedule && (
              <button
                onClick={onAddSchedule}
                className="text-xs text-primary hover:underline"
              >
                Add your first schedule
              </button>
            )}
          </div>
        ) : (
          <div className="p-2 space-y-1">
            {schedules.map(schedule => (
              <ContextMenu key={schedule.id}>
                <ContextMenuTrigger asChild>
                  <div
                    className={cn(
                      'p-3 rounded-lg border transition-colors cursor-default',
                      schedule.enabled
                        ? 'bg-card border-border hover:border-border/80'
                        : 'bg-muted/30 border-border/50 opacity-60'
                    )}
                  >
                    {/* Schedule Name */}
                    <div className="flex items-center gap-2 mb-1">
                      {schedule.enabled ? (
                        <Clock className="h-4 w-4 text-primary shrink-0" />
                      ) : (
                        <Pause className="h-4 w-4 text-muted-foreground shrink-0" />
                      )}
                      <span className="font-medium text-sm truncate">{schedule.name}</span>
                    </div>

                    {/* Schedule Description (e.g., "Every Wednesday at 9am") */}
                    <div className="text-xs text-muted-foreground mb-2 ml-6">
                      {schedule.enabled ? formatScheduleDescription(schedule) : 'Paused'}
                    </div>

                    {/* Prompt Preview */}
                    <div className="text-xs text-muted-foreground/80 line-clamp-2 ml-6 italic">
                      "{schedule.prompt}"
                    </div>
                  </div>
                </ContextMenuTrigger>
                <StyledContextMenuContent>
                  <ContextMenuProvider>
                    <ScheduleMenu
                      onEdit={() => handleEdit(schedule)}
                      onDelete={() => handleDelete(schedule.id)}
                    />
                  </ContextMenuProvider>
                </StyledContextMenuContent>
              </ContextMenu>
            ))}
          </div>
        )}
      </div>

      {/* Edit Schedule Dialog */}
      <EditScheduleDialog
        open={editDialogOpen}
        onOpenChange={setEditDialogOpen}
        schedule={editingSchedule}
        onSave={handleSave}
      />
    </div>
  )
}
