/**
 * HookInfoPage
 *
 * Detail view for a selected hook, using the Info_Page compound component system.
 * Follows SourceInfoPage pattern: Hero → Sections (When, Then, Settings, History, JSON).
 */

import * as React from 'react'
import { PauseCircle, AlertCircle } from 'lucide-react'
import {
  Info_Page,
  Info_Section,
  Info_Table,
  Info_Alert,
  Info_Badge,
  Info_Markdown,
} from '@/components/info'
import { HookAvatar } from './HookAvatar'
import { HookMenu } from './HookMenu'
import { HookActionRow } from './HookActionRow'
import { HookTestPanel } from './HookTestPanel'
import { HookEventTimeline } from './HookEventTimeline'
import { PhaseBadge } from './PhaseBadge'
import { getEventDisplayName, getPermissionDisplayName, type HookListItem, type ExecutionEntry, type TestResult } from './types'

// ============================================================================
// Helpers
// ============================================================================

/**
 * Describe a cron expression in human-readable form (simplified)
 */
function describeCron(cron: string): string {
  const parts = cron.split(' ')
  if (parts.length !== 5) return cron

  const [minute, hour, dom, month, dow] = parts

  // Common patterns
  if (cron === '* * * * *') return 'Every minute'
  if (minute.startsWith('*/')) return `Every ${minute.slice(2)} minutes`
  if (hour === '*' && minute !== '*') return `Every hour at :${minute.padStart(2, '0')}`
  if (dom === '*' && month === '*') {
    const time = `${hour.padStart(2, '0')}:${minute.padStart(2, '0')}`
    if (dow === '*') return `Daily at ${time}`
    if (dow === '1-5') return `Weekdays at ${time}`
    if (dow === '0,6') return `Weekends at ${time}`
    return `${time} on day-of-week ${dow}`
  }
  if (month === '*' && dow === '*') {
    const time = `${hour.padStart(2, '0')}:${minute.padStart(2, '0')}`
    return `Monthly on day ${dom} at ${time}`
  }

  return cron
}

/**
 * Compute next N run times for a cron expression (mock for playground)
 */
function getNextRuns(cron: string, timezone?: string, count: number = 3): string[] {
  // Simplified: for playground, generate plausible next times
  const now = new Date()
  const runs: string[] = []
  const parts = cron.split(' ')
  if (parts.length !== 5) return []

  const [minute, hour] = parts
  const h = hour === '*' ? now.getHours() : parseInt(hour, 10)
  const m = minute.startsWith('*/') ? 0 : (minute === '*' ? 0 : parseInt(minute, 10))

  for (let i = 0; i < count; i++) {
    const d = new Date(now)
    d.setDate(d.getDate() + i + 1)
    d.setHours(h, m, 0, 0)
    runs.push(d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ` ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`)
  }

  return runs
}

// ============================================================================
// Component
// ============================================================================

export interface HookInfoPageProps {
  hook: HookListItem
  executions?: ExecutionEntry[]
  testResult?: TestResult
  onToggleEnabled?: () => void
  onTest?: () => void
  onDuplicate?: () => void
  onDelete?: () => void
  className?: string
}

export function HookInfoPage({
  hook,
  executions = [],
  testResult,
  onToggleEnabled,
  onTest,
  onDuplicate,
  onDelete,
  className,
}: HookInfoPageProps) {
  const nextRuns = hook.cron ? getNextRuns(hook.cron, hook.timezone) : []

  return (
    <Info_Page className={className}>
      <Info_Page.Header
        title={hook.name}
        titleMenu={
          <HookMenu
            hookId={hook.id}
            hookName={hook.name}
            enabled={hook.enabled}
            onToggleEnabled={onToggleEnabled}
            onTest={onTest}
            onDuplicate={onDuplicate}
            onDelete={onDelete}
          />
        }
      />

      <Info_Page.Content>
        {/* Hero */}
        <Info_Page.Hero
          avatar={<HookAvatar event={hook.event} size="lg" />}
          title={hook.name}
          tagline={hook.summary}
        />

        {/* Disabled warning */}
        {!hook.enabled && (
          <Info_Alert variant="warning" icon={<PauseCircle className="h-4 w-4" />}>
            <Info_Alert.Title>Paused</Info_Alert.Title>
            <Info_Alert.Description>
              This automation is turned off. Enable it to start running again.
            </Info_Alert.Description>
          </Info_Alert>
        )}

        {/* Section: When */}
        <Info_Section
          title="When"
          description="What causes this automation to run"
        >
          <Info_Table>
            <Info_Table.Row label="Event">
              <Info_Badge color="default">{getEventDisplayName(hook.event)}</Info_Badge>
            </Info_Table.Row>
            <Info_Table.Row label="Timing">
              <PhaseBadge event={hook.event} />
            </Info_Table.Row>
            {hook.matcher && (
              <Info_Table.Row label="Only when matching">
                <code className="text-xs font-mono bg-foreground/5 px-1.5 py-0.5 rounded">
                  {hook.matcher}
                </code>
              </Info_Table.Row>
            )}
            {hook.cron && (
              <>
                <Info_Table.Row label="Repeats" value={describeCron(hook.cron)} />
                <Info_Table.Row label="Schedule expression">
                  <code className="text-xs font-mono bg-foreground/5 px-1.5 py-0.5 rounded">
                    {hook.cron}
                  </code>
                </Info_Table.Row>
                {nextRuns.length > 0 && (
                  <Info_Table.Row label="Next runs">
                    <div className="flex flex-col gap-0.5">
                      {nextRuns.map((run, i) => (
                        <span key={i} className="text-sm text-foreground/70">{run}</span>
                      ))}
                    </div>
                  </Info_Table.Row>
                )}
                <Info_Table.Row label="Timezone" value={hook.timezone || 'System default'} />
              </>
            )}
          </Info_Table>
        </Info_Section>

        {/* Section: Then */}
        <Info_Section
          title="Then"
          description={`${hook.hooks.length} action${hook.hooks.length !== 1 ? 's' : ''} to perform`}
        >
          <div className="divide-y divide-border/30">
            {hook.hooks.map((action, i) => (
              <HookActionRow key={i} action={action} index={i} />
            ))}
          </div>
        </Info_Section>

        {/* Test results (if any) */}
        {testResult && testResult.state !== 'idle' && (
          <HookTestPanel result={testResult} />
        )}

        {/* Section: Settings */}
        <Info_Section title="Settings">
          <Info_Table>
            <Info_Table.Row label="Access Level" value={getPermissionDisplayName(hook.permissionMode)} />
            <Info_Table.Row label="Status">
              <Info_Badge color={hook.enabled ? 'success' : 'muted'}>
                {hook.enabled ? 'Active' : 'Disabled'}
              </Info_Badge>
            </Info_Table.Row>
            {hook.labels && hook.labels.length > 0 && (
              <Info_Table.Row label="Labels">
                <div className="flex gap-1.5 flex-wrap">
                  {hook.labels.map((l) => (
                    <Info_Badge key={l} color="muted">{l}</Info_Badge>
                  ))}
                </div>
              </Info_Table.Row>
            )}
          </Info_Table>
        </Info_Section>

        {/* Section: Recent Activity */}
        <Info_Section
          title="Recent Activity"
          description={executions.length > 0 ? `Last ${executions.length} runs` : undefined}
        >
          <HookEventTimeline entries={executions} />
        </Info_Section>

        {/* Section: Advanced Configuration (raw JSON) */}
        <Info_Section title="Advanced">
          <Info_Markdown maxHeight={300} fullscreen>
            {`\`\`\`json\n${JSON.stringify({
              event: hook.event,
              matcher: hook.matcher,
              cron: hook.cron,
              timezone: hook.timezone,
              permissionMode: hook.permissionMode,
              labels: hook.labels,
              enabled: hook.enabled,
              hooks: hook.hooks,
            }, null, 2)}\n\`\`\``}
          </Info_Markdown>
        </Info_Section>
      </Info_Page.Content>
    </Info_Page>
  )
}
