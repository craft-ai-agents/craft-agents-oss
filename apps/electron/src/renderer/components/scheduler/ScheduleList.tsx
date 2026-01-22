import { useState, useEffect, useCallback } from 'react'
import { Cron } from 'croner'
import { Plus, Clock, MoreHorizontal, AlertCircle, Play } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { ScheduleModal } from './ScheduleModal'
import type { Schedule, ScheduleFormData, ScheduleEvent } from '../../../shared/types'

interface ScheduleListProps {
  workspaceId: string
}

export function ScheduleList({ workspaceId }: ScheduleListProps) {
  const [schedules, setSchedules] = useState<Schedule[]>([])
  const [editingSchedule, setEditingSchedule] = useState<Schedule | null>(null)
  const [showNew, setShowNew] = useState(false)

  useEffect(() => {
    window.electronAPI.scheduleList(workspaceId).then(setSchedules)
  }, [workspaceId])

  // Listen for schedule events
  useEffect(() => {
    const cleanup = window.electronAPI.onScheduleEvent((event: ScheduleEvent) => {
      // Refresh the list when schedules complete or fail
      if (event.type === 'completed' || event.type === 'failed') {
        window.electronAPI.scheduleList(workspaceId).then(setSchedules)
      }
    })
    return cleanup
  }, [workspaceId])

  const handleCreate = useCallback(async (data: ScheduleFormData) => {
    const created = await window.electronAPI.scheduleCreate(workspaceId, data)
    setSchedules(prev => [...prev, created])
    setShowNew(false)
  }, [workspaceId])

  const handleUpdate = useCallback(async (data: ScheduleFormData) => {
    if (!editingSchedule) return
    const updated = await window.electronAPI.scheduleUpdate(workspaceId, editingSchedule.id, data)
    if (updated) {
      setSchedules(prev => prev.map(s => s.id === updated.id ? updated : s))
    }
    setEditingSchedule(null)
  }, [workspaceId, editingSchedule])

  const handleDelete = useCallback(async (id: string) => {
    await window.electronAPI.scheduleDelete(workspaceId, id)
    setSchedules(prev => prev.filter(s => s.id !== id))
  }, [workspaceId])

  const handleToggle = useCallback(async (id: string) => {
    const updated = await window.electronAPI.scheduleToggle(workspaceId, id)
    if (updated) {
      setSchedules(prev => prev.map(s => s.id === updated.id ? updated : s))
    }
  }, [workspaceId])

  const handleRunNow = useCallback(async (id: string) => {
    await window.electronAPI.scheduleRunNow(workspaceId, id)
  }, [workspaceId])

  return (
    <div className="p-4 h-full flex flex-col">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold">Schedules</h2>
        <Button size="sm" onClick={() => setShowNew(true)}>
          <Plus className="w-4 h-4 mr-2" />
          New Schedule
        </Button>
      </div>

      {schedules.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground">
          <Clock className="w-12 h-12 mb-2 opacity-50" />
          <p>No schedules yet</p>
          <p className="text-sm">Create a schedule to run prompts automatically</p>
        </div>
      ) : (
        <div className="flex-1 space-y-2 overflow-auto">
          {schedules.map(schedule => (
            <ScheduleCard
              key={schedule.id}
              schedule={schedule}
              onEdit={() => setEditingSchedule(schedule)}
              onDelete={() => handleDelete(schedule.id)}
              onToggle={() => handleToggle(schedule.id)}
              onRunNow={() => handleRunNow(schedule.id)}
            />
          ))}
        </div>
      )}

      {/* App must be open notice */}
      <p className="text-xs text-muted-foreground mt-4 text-center">
        Schedules run when Vesper is open
      </p>

      {showNew && (
        <ScheduleModal onSave={handleCreate} onClose={() => setShowNew(false)} />
      )}

      {editingSchedule && (
        <ScheduleModal
          schedule={editingSchedule}
          onSave={handleUpdate}
          onClose={() => setEditingSchedule(null)}
        />
      )}
    </div>
  )
}

function StatusBadge({ status }: { status: Schedule['lastRunStatus'] }) {
  const config = {
    success: { color: 'bg-green-500', label: 'Success' },
    failed: { color: 'bg-red-500', label: 'Failed' },
    null: { color: 'bg-gray-400', label: 'Not run yet' },
  }
  const { color, label } = config[status ?? 'null']

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className={`w-2 h-2 rounded-full ${color} inline-block`} />
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

interface ScheduleCardProps {
  schedule: Schedule
  onEdit: () => void
  onDelete: () => void
  onToggle: () => void
  onRunNow: () => void
}

function ScheduleCard({ schedule, onEdit, onDelete, onToggle, onRunNow }: ScheduleCardProps) {
  const nextRun = schedule.enabled && schedule.cron
    ? getNextRun(schedule.cron, schedule.timezone)
    : null

  return (
    <div className="p-3 rounded-lg border bg-card">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Switch checked={schedule.enabled} onCheckedChange={onToggle} />
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <StatusBadge status={schedule.lastRunStatus} />
              <p className="font-medium truncate">{schedule.name}</p>
            </div>
            <p className="text-xs text-muted-foreground truncate max-w-[200px]">
              {schedule.prompt}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {schedule.lastRunStatus === 'failed' && (
            <Tooltip>
              <TooltipTrigger asChild>
                <AlertCircle className="w-4 h-4 text-destructive" />
              </TooltipTrigger>
              <TooltipContent>
                {schedule.lastRunError || 'Unknown error'}
              </TooltipContent>
            </Tooltip>
          )}

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm">
                <MoreHorizontal className="w-4 h-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={onRunNow}>
                <Play className="w-4 h-4 mr-2" />
                Run Now
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onEdit}>Edit</DropdownMenuItem>
              <DropdownMenuItem variant="destructive" onClick={onDelete}>
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <div className="mt-2 text-xs text-muted-foreground">
        {schedule.cron ? (
          nextRun ? `Next: ${nextRun.toLocaleString()}` : 'Invalid schedule'
        ) : (
          schedule.scheduledFor
            ? `Scheduled for: ${new Date(schedule.scheduledFor * 1000).toLocaleString()}`
            : 'Completed'
        )}
        {schedule.lastRunAt && (
          <span className="ml-2">
            (Last: {new Date(schedule.lastRunAt * 1000).toLocaleString()})
          </span>
        )}
      </div>
    </div>
  )
}

function getNextRun(cron: string, timezone: string): Date | null {
  try {
    const cronJob = new Cron(cron, { timezone })
    return cronJob.nextRun()
  } catch {
    return null
  }
}
