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
} from '@/components/settings'
import { Play, Trash2, Plus, Check } from 'lucide-react'
import { SourceAvatar } from '@/components/ui/source-avatar'
import { sourcesAtom } from '@/atoms/sources'
import { skillsAtom } from '@/atoms/skills'
import type { ScheduledJob, CreateScheduledJobInput, UpdateScheduledJobInput, JobAction, LoadedSource, LoadedSkill } from '../../../shared/types'
import { describeSchedule } from '@g4os/shared/scheduler/cron'

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

  const isValid = form.name.trim() && form.schedule.trim()

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
          <SettingsRow label="Schedule">
            <div className="flex flex-col gap-1">
              <input
                type="text"
                className="w-64 rounded-md border border-border bg-background px-3 py-1.5 text-sm font-mono"
                placeholder="08:00"
                value={form.schedule}
                onChange={e => update('schedule', e.target.value)}
              />
              <span className="text-xs text-muted-foreground">
                {(() => {
                  try { return describeSchedule(form.schedule) } catch { return 'Examples: 08:00, weekdays 09:30, */2h, 0 8 * * 1-5' }
                })()}
              </span>
            </div>
          </SettingsRow>
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
        <Button size="sm" disabled={!isValid} onClick={() => onSubmit(form)}>
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
