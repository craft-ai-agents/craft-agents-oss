/**
 * SchedulesPanel - Navigator panel for managing scheduled prompts
 *
 * Shows a list of scheduled prompts with their schedule description and prompt.
 * Allows adding and editing schedules.
 */

import * as React from 'react'
import { Calendar, Clock, Pause, Plus, Settings2 } from 'lucide-react'
import type { ScheduledPromptConfig } from '@craft-agent/shared/schedules'
import { formatScheduleDescription } from '@craft-agent/shared/schedules/utils'
import { cn } from '@/lib/utils'

interface SchedulesPanelProps {
  schedules: ScheduledPromptConfig[]
  workspaceRootPath?: string
  onAddSchedule?: () => void
  onEditSchedules?: () => void
}

export function SchedulesPanel({
  schedules,
  workspaceRootPath,
  onAddSchedule,
  onEditSchedules,
}: SchedulesPanelProps) {
  const enabledCount = schedules.filter(s => s.enabled).length

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
              <div
                key={schedule.id}
                className={cn(
                  "p-3 rounded-lg border transition-colors",
                  schedule.enabled
                    ? "bg-card border-border hover:border-border/80"
                    : "bg-muted/30 border-border/50 opacity-60"
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
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
