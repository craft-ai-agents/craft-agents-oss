/**
 * AutomationInfoPage
 *
 * Detail view for a selected automation, using the Info_Page compound component system.
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
import { EditPopover, EditButton, getEditConfig } from '@/components/ui/EditPopover'
import { useActiveWorkspace } from '@/context/AppShellContext'
import { AutomationAvatar } from './AutomationAvatar'
import { AutomationMenu } from './AutomationMenu'
import { AutomationActionRow } from './AutomationActionRow'
import { AutomationTestPanel } from './AutomationTestPanel'
import { AutomationEventTimeline } from './AutomationEventTimeline'
import { PhaseBadge } from './PhaseBadge'
import { getEventDisplayName, getPermissionDisplayName, type AutomationListItem, type ExecutionEntry, type TestResult } from './types'
import { describeCron, computeNextRuns } from './utils'

// ============================================================================
// Component
// ============================================================================

export interface AutomationInfoPageProps {
  automation: AutomationListItem
  executions?: ExecutionEntry[]
  testResult?: TestResult
  onToggleEnabled?: () => void
  onTest?: () => void
  onDuplicate?: () => void
  onDelete?: () => void
  className?: string
}

export function AutomationInfoPage({
  automation,
  executions = [],
  testResult,
  onToggleEnabled,
  onTest,
  onDuplicate,
  onDelete,
  className,
}: AutomationInfoPageProps) {
  const workspace = useActiveWorkspace()
  const nextRuns = automation.cron ? computeNextRuns(automation.cron) : []

  const editActions = workspace?.rootPath ? (
    <EditPopover
      trigger={<EditButton />}
      {...getEditConfig('automation-config', workspace.rootPath)}
      secondaryAction={{ label: 'Edit File', filePath: `${workspace.rootPath}/automations.json` }}
    />
  ) : undefined

  return (
    <Info_Page className={className}>
      <Info_Page.Header
        title={automation.name}
        titleMenu={
          <AutomationMenu
            automationId={automation.id}
            automationName={automation.name}
            enabled={automation.enabled}
            onToggleEnabled={onToggleEnabled}
            onTest={onTest}
            onDuplicate={onDuplicate}
            onDelete={onDelete}
          />
        }
      />

      <Info_Page.Content>
        {/* Hero */}
        <div className="flex items-start justify-between">
          <Info_Page.Hero
            avatar={<AutomationAvatar event={automation.event} fluid />}
            title={automation.name}
            tagline={automation.summary}
          />
          {editActions}
        </div>

        {/* Disabled warning */}
        {!automation.enabled && (
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
          actions={editActions}
        >
          <Info_Table>
            <Info_Table.Row label="Event">
              <Info_Badge color="default">{getEventDisplayName(automation.event)}</Info_Badge>
            </Info_Table.Row>
            <Info_Table.Row label="Timing">
              <PhaseBadge event={automation.event} />
            </Info_Table.Row>
            {automation.matcher && (
              <Info_Table.Row label="Only when matching">
                <code className="text-xs font-mono bg-foreground/5 px-1.5 py-0.5 rounded">
                  {automation.matcher}
                </code>
              </Info_Table.Row>
            )}
            {automation.cron && (
              <>
                <Info_Table.Row label="Repeats" value={describeCron(automation.cron)} />
                <Info_Table.Row label="Schedule expression">
                  <code className="text-xs font-mono bg-foreground/5 px-1.5 py-0.5 rounded">
                    {automation.cron}
                  </code>
                </Info_Table.Row>
                {nextRuns.length > 0 && (
                  <Info_Table.Row label="Next runs">
                    <div className="flex flex-col gap-0.5">
                      {(() => {
                        const spansYears = nextRuns.length > 1 && nextRuns[0].getFullYear() !== nextRuns[nextRuns.length - 1].getFullYear()
                        return nextRuns.map((date, i) => (
                          <span key={i} className="text-sm text-foreground/70">
                            {date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(spansYears && { year: 'numeric' }) })}{' '}
                            {date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })}
                          </span>
                        ))
                      })()}
                    </div>
                  </Info_Table.Row>
                )}
                <Info_Table.Row label="Timezone" value={automation.timezone || 'System default'} />
              </>
            )}
          </Info_Table>
        </Info_Section>

        {/* Section: Then */}
        <Info_Section
          title="Then"
          description={`${automation.actions.length} action${automation.actions.length !== 1 ? 's' : ''} to perform`}
          actions={editActions}
        >
          <div className="divide-y divide-border/30">
            {automation.actions.map((action, i) => (
              <AutomationActionRow key={i} action={action} index={i} />
            ))}
          </div>
        </Info_Section>

        {/* Test results (if any) */}
        {testResult && testResult.state !== 'idle' && (
          <AutomationTestPanel result={testResult} />
        )}

        {/* Section: Settings */}
        <Info_Section title="Settings" actions={editActions}>
          <Info_Table>
            <Info_Table.Row label="Access Level" value={getPermissionDisplayName(automation.permissionMode)} />
            <Info_Table.Row label="Status">
              <Info_Badge color={automation.enabled ? 'success' : 'muted'}>
                {automation.enabled ? 'Active' : 'Disabled'}
              </Info_Badge>
            </Info_Table.Row>
            {automation.labels && automation.labels.length > 0 && (
              <Info_Table.Row label="Labels">
                <div className="flex gap-1.5 flex-wrap">
                  {automation.labels.map((l) => (
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
          <AutomationEventTimeline entries={executions} />
        </Info_Section>

        {/* Section: Raw config (JSON) */}
        <Info_Section title="Raw config">
          <div className="rounded-[8px] shadow-minimal overflow-hidden [&_pre]:!bg-transparent [&_.relative]:!bg-transparent [&_.relative]:!border-0 [&_.relative>div:first-child]:!bg-transparent [&_.relative>div:first-child]:!border-0">
            <Info_Markdown maxHeight={300} fullscreen>
              {`\`\`\`json\n${JSON.stringify({
                event: automation.event,
                matcher: automation.matcher,
                cron: automation.cron,
                timezone: automation.timezone,
                permissionMode: automation.permissionMode,
                labels: automation.labels,
                enabled: automation.enabled,
                actions: automation.actions,
              }, null, 2)}\n\`\`\``}
            </Info_Markdown>
          </div>
        </Info_Section>
      </Info_Page.Content>
    </Info_Page>
  )
}
