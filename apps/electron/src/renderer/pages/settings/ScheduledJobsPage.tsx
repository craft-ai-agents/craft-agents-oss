/**
 * ScheduledJobsPage
 *
 * Settings page for managing scheduled jobs (cron).
 * Lists jobs with enable/disable, edit, delete, and run-now actions.
 * Includes a creation/edit form for new jobs.
 */

import { useState, useEffect, useCallback } from 'react'
import { useAtomValue } from 'jotai'
import { PanelHeader } from '@/components/app-shell/PanelHeader'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Button } from '@/components/ui/button'
import { HeaderMenu } from '@/components/ui/HeaderMenu'
import { routes } from '@/lib/navigate'
import { useAppShellContext } from '@/context/AppShellContext'
import {
  SettingsSection,
  SettingsCard,
  SettingsRow,
  SettingsToggle,
  SettingsMenuSelectRow,
  SettingsSegmentedControl,
} from '@/components/settings'
import { Play, Trash2, Plus, Check } from 'lucide-react'
import { SourceAvatar } from '@/components/ui/source-avatar'
import { sourcesAtom } from '@/atoms/sources'
import { skillsAtom } from '@/atoms/skills'
import type { ScheduledJob, CreateScheduledJobInput, UpdateScheduledJobInput, JobAction, LoadedSource, LoadedSkill } from '../../../shared/types'
import { describeSchedule, parseSchedule } from '@g4os/shared/scheduler/cron'
import { cn } from '@/lib/utils'

// ============================================
// Schedule Editor
// ============================================

type ScheduleMode = 'time-and-days' | 'interval' | 'advanced'

interface ScheduleEditorState {
  mode: ScheduleMode
  time: string            // "HH:MM" format
  days: boolean[]         // [Sun, Mon, Tue, Wed, Thu, Fri, Sat] — index matches JS getDay()
  intervalValue: string
  intervalUnit: 'h' | 'm'
  rawText: string         // for advanced mode
}

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const
const ALL_DAYS: boolean[] = [true, true, true, true, true, true, true]
const WEEKDAYS: boolean[] = [false, true, true, true, true, true, false]
const WEEKENDS: boolean[] = [true, false, false, false, false, false, true]

function arraysEqual(a: boolean[], b: boolean[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i])
}

const pad2 = (n: number) => String(n).padStart(2, '0')

function parseScheduleToEditorState(schedule: string): ScheduleEditorState {
  try {
    const parsed = parseSchedule(schedule)

    switch (parsed.type) {
      case 'daily':
        return {
          mode: 'time-and-days',
          time: `${pad2(parsed.hour!)}:${pad2(parsed.minute!)}`,
          days: [...ALL_DAYS],
          intervalValue: '2', intervalUnit: 'h', rawText: schedule,
        }
      case 'weekdays':
        return {
          mode: 'time-and-days',
          time: `${pad2(parsed.hour!)}:${pad2(parsed.minute!)}`,
          days: [...WEEKDAYS],
          intervalValue: '2', intervalUnit: 'h', rawText: schedule,
        }
      case 'weekends':
        return {
          mode: 'time-and-days',
          time: `${pad2(parsed.hour!)}:${pad2(parsed.minute!)}`,
          days: [...WEEKENDS],
          intervalValue: '2', intervalUnit: 'h', rawText: schedule,
        }
      case 'interval': {
        const ms = parsed.intervalMs!
        const isHours = ms >= 60 * 60 * 1000 && ms % (60 * 60 * 1000) === 0
        return {
          mode: 'interval',
          time: '08:00', days: [...ALL_DAYS],
          intervalValue: isHours ? String(ms / (60 * 60 * 1000)) : String(ms / (60 * 1000)),
          intervalUnit: isHours ? 'h' : 'm',
          rawText: schedule,
        }
      }
      case 'cron': {
        const cron = parsed.cron!
        const isSimpleDayCron =
          cron.minutes.length === 1 &&
          cron.hours.length === 1 &&
          cron.daysOfMonth.length === 31 &&
          cron.months.length === 12

        if (isSimpleDayCron) {
          const days = [false, false, false, false, false, false, false]
          for (const d of cron.daysOfWeek) days[d] = true
          return {
            mode: 'time-and-days',
            time: `${pad2(cron.hours[0]!)}:${pad2(cron.minutes[0]!)}`,
            days,
            intervalValue: '2', intervalUnit: 'h', rawText: schedule,
          }
        }

        return {
          mode: 'advanced',
          time: '08:00', days: [...ALL_DAYS],
          intervalValue: '2', intervalUnit: 'h', rawText: schedule,
        }
      }
    }
  } catch {
    return {
      mode: 'advanced',
      time: '08:00', days: [...ALL_DAYS],
      intervalValue: '2', intervalUnit: 'h', rawText: schedule,
    }
  }
}

function editorStateToScheduleString(state: ScheduleEditorState): string {
  switch (state.mode) {
    case 'advanced':
      return state.rawText

    case 'interval': {
      const val = parseInt(state.intervalValue, 10)
      if (isNaN(val) || val <= 0) return `*/1${state.intervalUnit}`
      return `*/${val}${state.intervalUnit}`
    }

    case 'time-and-days': {
      const selectedDays = state.days
        .map((checked, i) => (checked ? i : -1))
        .filter(i => i >= 0)

      if (selectedDays.length === 0) return state.time

      const isAllDays = selectedDays.length === 7
      const isWeekdays =
        selectedDays.length === 5 &&
        [1, 2, 3, 4, 5].every(d => selectedDays.includes(d))
      const isWeekends =
        selectedDays.length === 2 &&
        selectedDays.includes(0) &&
        selectedDays.includes(6)

      if (isAllDays) return state.time
      if (isWeekdays) return `weekdays ${state.time}`
      if (isWeekends) return `weekends ${state.time}`

      const [hourStr, minStr] = state.time.split(':')
      const hour = parseInt(hourStr!, 10)
      const minute = parseInt(minStr!, 10)
      const dowField = selectedDays.join(',')
      return `${minute} ${hour} * * ${dowField}`
    }
  }
}

// ============================================
// Job Form
// ============================================

interface JobFormData {
  name: string
  schedule: string
  actionType: 'new-session' | 'batch'
  skillSlug: string
  prompt: string
  filterScope: 'today' | 'active' | 'labeled'
  filterLabels: string
  permissionMode: 'safe' | 'ask' | 'allow-all'
  enabledSourceSlugs: string[]
  workingDirectory: string
  enabledSkillSlugs: string[]
  runOnLaunchIfMissed: boolean
  notifyOnComplete: boolean
}

const defaultFormData: JobFormData = {
  name: '',
  schedule: '08:00',
  actionType: 'new-session',
  skillSlug: '',
  prompt: '',
  filterScope: 'today',
  filterLabels: '',
  permissionMode: 'allow-all',
  enabledSourceSlugs: [],
  workingDirectory: '',
  enabledSkillSlugs: [],
  runOnLaunchIfMissed: false,
  notifyOnComplete: true,
}

function formToInput(form: JobFormData): CreateScheduledJobInput {
  const action: JobAction = form.actionType === 'new-session'
    ? {
        type: 'new-session',
        skillSlug: form.skillSlug || undefined,
        prompt: form.prompt || undefined,
      }
    : {
        type: 'batch',
        skillSlug: form.skillSlug,
        filter: {
          scope: form.filterScope,
          labels: form.filterScope === 'labeled'
            ? form.filterLabels.split(',').map(l => l.trim()).filter(Boolean)
            : undefined,
        },
      }

  return {
    name: form.name,
    schedule: form.schedule,
    action,
    permissionMode: form.permissionMode,
    enabledSourceSlugs: form.enabledSourceSlugs.length > 0 ? form.enabledSourceSlugs : undefined,
    workingDirectory: form.workingDirectory || undefined,
    enabledSkillSlugs: form.enabledSkillSlugs.length > 0 ? form.enabledSkillSlugs : undefined,
    runOnLaunchIfMissed: form.runOnLaunchIfMissed,
    notifyOnComplete: form.notifyOnComplete,
  }
}

function jobToForm(job: ScheduledJob): JobFormData {
  return {
    name: job.name,
    schedule: job.schedule,
    actionType: job.action.type,
    skillSlug: job.action.type === 'new-session' ? (job.action.skillSlug ?? '') : job.action.skillSlug,
    prompt: job.action.type === 'new-session' ? (job.action.prompt ?? '') : '',
    filterScope: job.action.type === 'batch' ? job.action.filter.scope : 'today',
    filterLabels: job.action.type === 'batch' && job.action.filter.labels ? job.action.filter.labels.join(', ') : '',
    permissionMode: job.permissionMode ?? 'allow-all',
    enabledSourceSlugs: job.enabledSourceSlugs ?? [],
    workingDirectory: job.workingDirectory ?? '',
    enabledSkillSlugs: job.enabledSkillSlugs ?? [],
    runOnLaunchIfMissed: job.runOnLaunchIfMissed ?? false,
    notifyOnComplete: job.notifyOnComplete ?? true,
  }
}

function ScheduleEditor({
  state,
  onChange,
}: {
  state: ScheduleEditorState
  onChange: (state: ScheduleEditorState) => void
}) {
  const toggleDay = (index: number) => {
    const newDays = [...state.days]
    newDays[index] = !newDays[index]
    onChange({ ...state, days: newDays })
  }

  const handleModeChange = (newMode: string) => {
    const mode = newMode as ScheduleMode
    if (mode === 'advanced') {
      onChange({ ...state, mode, rawText: editorStateToScheduleString(state) })
    } else {
      onChange({ ...state, mode })
    }
  }

  return (
    <div className="space-y-3">
      <SettingsSegmentedControl
        value={state.mode}
        onValueChange={handleModeChange}
        options={[
          { value: 'time-and-days', label: 'Schedule' },
          { value: 'interval', label: 'Interval' },
          { value: 'advanced', label: 'Advanced' },
        ]}
        size="sm"
      />

      {state.mode === 'time-and-days' && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">At</span>
            <input
              type="time"
              className="rounded-md border border-border bg-background px-3 py-1.5 text-sm font-mono"
              value={state.time}
              onChange={e => onChange({ ...state, time: e.target.value })}
            />
          </div>

          <div className="space-y-2">
            <div className="flex gap-1">
              {DAY_LABELS.map((label, i) => (
                <button
                  key={label}
                  type="button"
                  onClick={() => toggleDay(i)}
                  className={cn(
                    'w-9 h-8 rounded-md text-xs font-medium transition-colors',
                    state.days[i]
                      ? 'bg-accent text-accent-foreground'
                      : 'bg-muted/50 text-muted-foreground hover:bg-muted'
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="flex gap-1.5">
              {([
                { label: 'Every day', preset: ALL_DAYS },
                { label: 'Weekdays', preset: WEEKDAYS },
                { label: 'Weekends', preset: WEEKENDS },
              ] as const).map(({ label, preset }) => (
                <button
                  key={label}
                  type="button"
                  onClick={() => onChange({ ...state, days: [...preset] })}
                  className={cn(
                    'px-2 py-0.5 rounded text-xs transition-colors',
                    arraysEqual(state.days, preset)
                      ? 'bg-foreground/10 text-foreground font-medium'
                      : 'text-muted-foreground hover:text-foreground'
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <span className="text-xs text-muted-foreground block">
            {(() => {
              try { return describeSchedule(editorStateToScheduleString(state)) }
              catch { return 'Select at least one day' }
            })()}
          </span>
        </div>
      )}

      {state.mode === 'interval' && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">Every</span>
            <input
              type="number"
              min="1"
              className="w-20 rounded-md border border-border bg-background px-3 py-1.5 text-sm font-mono"
              value={state.intervalValue}
              onChange={e => onChange({ ...state, intervalValue: e.target.value })}
            />
            <select
              className="rounded-md border border-border bg-background px-2 py-1.5 text-sm"
              value={state.intervalUnit}
              onChange={e => onChange({ ...state, intervalUnit: e.target.value as 'h' | 'm' })}
            >
              <option value="h">hours</option>
              <option value="m">minutes</option>
            </select>
          </div>
          <span className="text-xs text-muted-foreground block">
            {(() => {
              try { return describeSchedule(editorStateToScheduleString(state)) }
              catch { return 'Enter a valid interval' }
            })()}
          </span>
        </div>
      )}

      {state.mode === 'advanced' && (
        <div className="space-y-1">
          <input
            type="text"
            className="w-64 rounded-md border border-border bg-background px-3 py-1.5 text-sm font-mono"
            placeholder="0 8 * * 1-5"
            value={state.rawText}
            onChange={e => onChange({ ...state, rawText: e.target.value })}
          />
          <span className="text-xs text-muted-foreground block">
            {(() => {
              try { return describeSchedule(state.rawText) }
              catch { return 'Formats: HH:MM, weekdays HH:MM, weekends HH:MM, */2h, or 5-field cron' }
            })()}
          </span>
        </div>
      )}
    </div>
  )
}

// ============================================
// Job Form
// ============================================

function JobForm({
  initial,
  sources,
  skills,
  onSubmit,
  onCancel,
  submitLabel,
}: {
  initial: JobFormData
  sources: LoadedSource[]
  skills: LoadedSkill[]
  onSubmit: (data: JobFormData) => void
  onCancel: () => void
  submitLabel: string
}) {
  const [form, setForm] = useState<JobFormData>(initial)
  const [scheduleState, setScheduleState] = useState<ScheduleEditorState>(
    () => parseScheduleToEditorState(initial.schedule)
  )

  const update = <K extends keyof JobFormData>(key: K, value: JobFormData[K]) => {
    setForm(prev => ({ ...prev, [key]: value }))
  }

  const toggleSource = (slug: string) => {
    setForm(prev => {
      const slugs = new Set(prev.enabledSourceSlugs)
      if (slugs.has(slug)) slugs.delete(slug)
      else slugs.add(slug)
      return { ...prev, enabledSourceSlugs: Array.from(slugs) }
    })
  }

  const toggleSkill = (slug: string) => {
    setForm(prev => {
      const slugs = new Set(prev.enabledSkillSlugs)
      if (slugs.has(slug)) slugs.delete(slug)
      else slugs.add(slug)
      return { ...prev, enabledSkillSlugs: Array.from(slugs) }
    })
  }

  const scheduleString = editorStateToScheduleString(scheduleState)
  const isScheduleValid = (() => {
    try { parseSchedule(scheduleString); return true } catch { return false }
  })()
  const isValid = form.name.trim() && isScheduleValid

  return (
    <div className="space-y-6">
      <SettingsSection title="Job Details">
        <SettingsCard>
          <SettingsRow label="Name">
            <input
              type="text"
              className="w-64 rounded-md border border-border bg-background px-3 py-1.5 text-sm"
              placeholder="Morning Brief"
              value={form.name}
              onChange={e => update('name', e.target.value)}
            />
          </SettingsRow>
          <div className="px-4 py-3.5">
            <div className="text-sm font-medium mb-2">Schedule</div>
            <ScheduleEditor state={scheduleState} onChange={setScheduleState} />
          </div>
        </SettingsCard>
      </SettingsSection>

      <SettingsSection title="Action">
        <SettingsCard>
          <SettingsMenuSelectRow
            label="Type"
            description="What to do when the job runs"
            value={form.actionType}
            onValueChange={v => update('actionType', v as 'new-session' | 'batch')}
            options={[
              { value: 'new-session', label: 'New Session' },
              { value: 'batch', label: 'Batch (existing sessions)' },
            ]}
          />
          <SettingsRow label="Skill Slug">
            <input
              type="text"
              className="w-64 rounded-md border border-border bg-background px-3 py-1.5 text-sm"
              placeholder="session-start"
              value={form.skillSlug}
              onChange={e => update('skillSlug', e.target.value)}
            />
          </SettingsRow>
          {form.actionType === 'new-session' && (
            <SettingsRow label="Prompt (optional)">
              <input
                type="text"
                className="w-64 rounded-md border border-border bg-background px-3 py-1.5 text-sm"
                placeholder="Run my morning brief"
                value={form.prompt}
                onChange={e => update('prompt', e.target.value)}
              />
            </SettingsRow>
          )}
          {form.actionType === 'batch' && (
            <>
              <SettingsMenuSelectRow
                label="Filter"
                description="Which sessions to target"
                value={form.filterScope}
                onValueChange={v => update('filterScope', v as 'today' | 'active' | 'labeled')}
                options={[
                  { value: 'today', label: "Today's sessions" },
                  { value: 'active', label: 'All active' },
                  { value: 'labeled', label: 'By label' },
                ]}
              />
              {form.filterScope === 'labeled' && (
                <SettingsRow label="Labels (comma-separated)">
                  <input
                    type="text"
                    className="w-64 rounded-md border border-border bg-background px-3 py-1.5 text-sm"
                    placeholder="bug, automation"
                    value={form.filterLabels}
                    onChange={e => update('filterLabels', e.target.value)}
                  />
                </SettingsRow>
              )}
            </>
          )}
        </SettingsCard>
      </SettingsSection>

      {/* Source selection — shown for new-session jobs */}
      {form.actionType === 'new-session' && sources.length > 0 && (
        <SettingsSection title="Sources">
          <SettingsCard>
            <div className="px-4 py-3">
              <p className="text-xs text-muted-foreground mb-3">
                Select sources (MCP servers, APIs) to activate on the created session.
              </p>
              <div className="space-y-1">
                {sources.map(source => {
                  const isSelected = form.enabledSourceSlugs.includes(source.config.slug)
                  return (
                    <button
                      key={source.config.slug}
                      type="button"
                      onClick={() => toggleSource(source.config.slug)}
                      className="flex items-center gap-2.5 w-full rounded-md px-2.5 py-2 text-left text-sm hover:bg-foreground/5 transition-colors"
                    >
                      <div className="flex items-center justify-center w-5 h-5 shrink-0">
                        {isSelected ? (
                          <div className="w-4 h-4 rounded bg-accent flex items-center justify-center">
                            <Check className="w-3 h-3 text-accent-foreground" />
                          </div>
                        ) : (
                          <div className="w-4 h-4 rounded border border-border" />
                        )}
                      </div>
                      <SourceAvatar source={source} size="sm" />
                      <div className="flex-1 min-w-0">
                        <span className="truncate block">{source.config.name}</span>
                        <span className="text-xs text-muted-foreground truncate block">
                          {source.config.type}{source.config.provider ? ` · ${source.config.provider}` : ''}
                        </span>
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>
          </SettingsCard>
        </SettingsSection>
      )}

      {/* Working Directory */}
      {form.actionType === 'new-session' && (
        <SettingsSection title="Working Directory">
          <SettingsCard>
            <SettingsRow label="Path" description="Leave empty to use workspace default">
              <input
                type="text"
                className="w-64 rounded-md border border-border bg-background px-3 py-1.5 text-sm"
                placeholder="/Users/you/projects/myapp"
                value={form.workingDirectory}
                onChange={e => update('workingDirectory', e.target.value)}
              />
            </SettingsRow>
          </SettingsCard>
        </SettingsSection>
      )}

      {/* Skills selection — shown for new-session jobs */}
      {form.actionType === 'new-session' && skills.length > 0 && (
        <SettingsSection title="Skills">
          <SettingsCard>
            <div className="px-4 py-3">
              <p className="text-xs text-muted-foreground mb-3">
                Select skills to activate on the created session (via skillSlugs).
              </p>
              <div className="space-y-1">
                {skills.map(skill => {
                  const isSelected = form.enabledSkillSlugs.includes(skill.slug)
                  return (
                    <button
                      key={skill.slug}
                      type="button"
                      onClick={() => toggleSkill(skill.slug)}
                      className="flex items-center gap-2.5 w-full rounded-md px-2.5 py-2 text-left text-sm hover:bg-foreground/5 transition-colors"
                    >
                      <div className="flex items-center justify-center w-5 h-5 shrink-0">
                        {isSelected ? (
                          <div className="w-4 h-4 rounded bg-accent flex items-center justify-center">
                            <Check className="w-3 h-3 text-accent-foreground" />
                          </div>
                        ) : (
                          <div className="w-4 h-4 rounded border border-border" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <span className="truncate block">{skill.metadata?.name ?? skill.slug}</span>
                        {skill.metadata?.description && (
                          <span className="text-xs text-muted-foreground truncate block">
                            {skill.metadata.description}
                          </span>
                        )}
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>
          </SettingsCard>
        </SettingsSection>
      )}

      <SettingsSection title="Options">
        <SettingsCard>
          <SettingsMenuSelectRow
            label="Permission Mode"
            description="Permission mode for created sessions"
            value={form.permissionMode}
            onValueChange={v => update('permissionMode', v as 'safe' | 'ask' | 'allow-all')}
            options={[
              { value: 'allow-all', label: 'Execute (auto-approve)' },
              { value: 'ask', label: 'Ask to Edit' },
              { value: 'safe', label: 'Explore (read-only)' },
            ]}
          />
          <SettingsToggle
            label="Run on launch if missed"
            description="Execute job on next app launch if it was missed (within 2 hours)"
            checked={form.runOnLaunchIfMissed}
            onCheckedChange={v => update('runOnLaunchIfMissed', v)}
          />
          <SettingsToggle
            label="Notify on complete"
            description="Show a notification when the job finishes"
            checked={form.notifyOnComplete}
            onCheckedChange={v => update('notifyOnComplete', v)}
          />
        </SettingsCard>
      </SettingsSection>

      <div className="flex gap-2 justify-end">
        <Button variant="outline" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button size="sm" disabled={!isValid} onClick={() => onSubmit({ ...form, schedule: scheduleString })}>
          {submitLabel}
        </Button>
      </div>
    </div>
  )
}

// ============================================
// Main Component
// ============================================

type PageView = { type: 'list' } | { type: 'create' } | { type: 'edit'; job: ScheduledJob }

export default function ScheduledJobsPage() {
  const { activeWorkspaceId } = useAppShellContext()
  const sources = useAtomValue(sourcesAtom)
  const skills = useAtomValue(skillsAtom)
  const [jobs, setJobs] = useState<ScheduledJob[]>([])
  const [view, setView] = useState<PageView>({ type: 'list' })
  const [isLoading, setIsLoading] = useState(true)

  const loadJobs = useCallback(async () => {
    if (!window.electronAPI || !activeWorkspaceId) return
    try {
      const result = await window.electronAPI.getScheduledJobs(activeWorkspaceId)
      setJobs(result)
    } catch (error) {
      console.error('Failed to load scheduled jobs:', error)
    } finally {
      setIsLoading(false)
    }
  }, [activeWorkspaceId])

  useEffect(() => {
    loadJobs()
  }, [loadJobs])

  // Listen for changes from other windows
  useEffect(() => {
    if (!window.electronAPI) return
    const cleanup = window.electronAPI.onScheduledJobsChanged(() => {
      loadJobs()
    })
    return cleanup
  }, [loadJobs])

  const handleCreate = useCallback(async (formData: JobFormData) => {
    if (!window.electronAPI || !activeWorkspaceId) return
    const input = formToInput(formData)
    await window.electronAPI.createScheduledJob(activeWorkspaceId, input)
    await loadJobs()
    setView({ type: 'list' })
  }, [activeWorkspaceId, loadJobs])

  const handleUpdate = useCallback(async (jobId: string, formData: JobFormData) => {
    if (!window.electronAPI || !activeWorkspaceId) return
    const input = formToInput(formData)
    await window.electronAPI.updateScheduledJob(activeWorkspaceId, jobId, input)
    await loadJobs()
    setView({ type: 'list' })
  }, [activeWorkspaceId, loadJobs])

  const handleToggleEnabled = useCallback(async (jobId: string, enabled: boolean) => {
    if (!window.electronAPI || !activeWorkspaceId) return
    await window.electronAPI.updateScheduledJob(activeWorkspaceId, jobId, { enabled })
    await loadJobs()
  }, [activeWorkspaceId, loadJobs])

  const handleDelete = useCallback(async (jobId: string) => {
    if (!window.electronAPI || !activeWorkspaceId) return
    await window.electronAPI.deleteScheduledJob(activeWorkspaceId, jobId)
    await loadJobs()
  }, [activeWorkspaceId, loadJobs])

  const handleRunNow = useCallback(async (jobId: string) => {
    if (!window.electronAPI || !activeWorkspaceId) return
    try {
      await window.electronAPI.runScheduledJobNow(activeWorkspaceId, jobId)
      await loadJobs()
    } catch (error) {
      console.error('Failed to run job:', error)
    }
  }, [activeWorkspaceId, loadJobs])

  // Create/Edit views
  if (view.type === 'create') {
    return (
      <div className="h-full flex flex-col">
        <PanelHeader title="New Scheduled Job" />
        <div className="flex-1 min-h-0 mask-fade-y">
          <ScrollArea className="h-full">
            <div className="px-5 py-7 max-w-3xl mx-auto">
              <JobForm
                initial={defaultFormData}
                sources={sources}
                skills={skills}
                onSubmit={handleCreate}
                onCancel={() => setView({ type: 'list' })}
                submitLabel="Create Job"
              />
            </div>
          </ScrollArea>
        </div>
      </div>
    )
  }

  if (view.type === 'edit') {
    return (
      <div className="h-full flex flex-col">
        <PanelHeader title={`Edit: ${view.job.name}`} />
        <div className="flex-1 min-h-0 mask-fade-y">
          <ScrollArea className="h-full">
            <div className="px-5 py-7 max-w-3xl mx-auto">
              <JobForm
                initial={jobToForm(view.job)}
                sources={sources}
                skills={skills}
                onSubmit={data => handleUpdate(view.job.id, data)}
                onCancel={() => setView({ type: 'list' })}
                submitLabel="Save Changes"
              />
            </div>
          </ScrollArea>
        </div>
      </div>
    )
  }

  // List view
  return (
    <div className="h-full flex flex-col">
      <PanelHeader
        title="Scheduled Jobs"
        actions={<HeaderMenu route={routes.view.scheduler()} />}
      />
      <div className="flex-1 min-h-0 mask-fade-y">
        <ScrollArea className="h-full">
          <div className="px-5 py-7 max-w-3xl mx-auto">
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <p className="text-sm text-muted-foreground">
                  Automate recurring tasks. Jobs run while the app is open.
                </p>
                <Button size="sm" onClick={() => setView({ type: 'create' })}>
                  <Plus className="w-4 h-4 mr-1" />
                  New Job
                </Button>
              </div>

              {isLoading ? (
                <div className="py-12 flex items-center justify-center text-muted-foreground text-sm">
                  Loading...
                </div>
              ) : jobs.length === 0 ? (
                <SettingsCard>
                  <div className="py-8 text-center text-sm text-muted-foreground">
                    No scheduled jobs yet. Create one to automate recurring tasks.
                  </div>
                </SettingsCard>
              ) : (
                <div className="space-y-3">
                  {jobs.map(job => (
                    <SettingsCard key={job.id}>
                      <div className="flex items-start justify-between gap-4 px-4 py-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-sm truncate">{job.name}</span>
                            {job.lastRunStatus === 'error' && (
                              <span className="text-xs text-destructive">Failed</span>
                            )}
                          </div>
                          <div className="text-xs text-muted-foreground mt-0.5">
                            {describeSchedule(job.schedule)}
                            {job.action.type === 'new-session' && job.action.skillSlug && (
                              <> &middot; /{job.action.skillSlug}</>
                            )}
                            {job.action.type === 'batch' && (
                              <> &middot; batch /{job.action.skillSlug} ({job.action.filter.scope})</>
                            )}
                            {job.enabledSourceSlugs && job.enabledSourceSlugs.length > 0 && (
                              <> &middot; {job.enabledSourceSlugs.length} source{job.enabledSourceSlugs.length !== 1 ? 's' : ''}</>
                            )}
                            {job.enabledSkillSlugs && job.enabledSkillSlugs.length > 0 && (
                              <> &middot; {job.enabledSkillSlugs.length} skill{job.enabledSkillSlugs.length !== 1 ? 's' : ''}</>
                            )}
                            {job.workingDirectory && (
                              <> &middot; {job.workingDirectory}</>
                            )}
                          </div>
                          {job.lastRunAt && (
                            <div className="text-xs text-muted-foreground mt-0.5">
                              Last run: {new Date(job.lastRunAt).toLocaleString()}
                            </div>
                          )}
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 w-7 p-0"
                            title="Run Now"
                            onClick={() => handleRunNow(job.id)}
                          >
                            <Play className="w-3.5 h-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 px-2 text-xs"
                            onClick={() => setView({ type: 'edit', job })}
                          >
                            Edit
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 w-7 p-0 text-destructive hover:text-destructive"
                            title="Delete"
                            onClick={() => handleDelete(job.id)}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                          <div className="ml-1">
                            <SettingsToggle
                              label=""
                              checked={job.enabled}
                              onCheckedChange={v => handleToggleEnabled(job.id, v)}
                            />
                          </div>
                        </div>
                      </div>
                    </SettingsCard>
                  ))}
                </div>
              )}
            </div>
          </div>
        </ScrollArea>
      </div>
    </div>
  )
}
