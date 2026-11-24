/**
 * AutomationInfoPage
 *
 * Detail view for a selected automation, using the Info_Page compound component system.
 * Follows SourceInfoPage pattern: Hero → Sections (When, Then, Settings, History, JSON).
 */

import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { PauseCircle, AlertCircle, Hash } from 'lucide-react'
import {
  Info_Page,
  Info_Section,
  Info_Table,
  Info_Alert,
  Info_Badge,
  Info_Markdown,
  Info_HeaderMenu,
} from '@/components/info'
import { EditPopover, EditButton, getEditConfig } from '@/components/ui/EditPopover'
import { useActiveWorkspace } from '@/context/AppShellContext'
import { AutomationAvatar } from './AutomationAvatar'
import { AutomationMenu } from './AutomationMenu'
import { AutomationActionRow } from './AutomationActionRow'
import { AutomationTestPanel } from './AutomationTestPanel'
import { AutomationEventTimeline } from './AutomationEventTimeline'
import { PhaseBadge } from './PhaseBadge'
import { getEventDisplayName, getPermissionDisplayName, flattenConditions, type AutomationListItem, type ExecutionEntry, type TestResult } from './types'
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
  onReplay?: (automationId: string, event: string) => void
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
  onReplay,
  className,
}: AutomationInfoPageProps) {
  const { t } = useTranslation()
  const workspace = useActiveWorkspace()
  const nextRuns = automation.cron ? computeNextRuns(automation.cron, 3, automation.timezone) : []

  // Lightweight per-mount fetch — mirrors the pattern used in MessagingSettingsPage.
  // Only fired when the matcher actually declares a topic to avoid unnecessary IPC.
  const [hasSupergroup, setHasSupergroup] = React.useState<boolean | null>(null)
  React.useEffect(() => {
    if (!automation.telegramTopic) {
      setHasSupergroup(null)
      return
    }
    let cancelled = false
    void window.electronAPI.getMessagingSupergroup().then((sg) => {
      if (!cancelled) setHasSupergroup(Boolean(sg?.chatId))
    }).catch(() => {
      if (!cancelled) setHasSupergroup(false)
    })
    return () => {
      cancelled = true
    }
  }, [automation.telegramTopic])

  const editActions = workspace?.rootPath ? (
    <EditPopover
      trigger={<EditButton />}
      {...getEditConfig('automation-config', workspace.rootPath)}
      secondaryAction={{ label: t('automations.editFile'), filePath: `${workspace.rootPath}/automations.json` }}
    />
  ) : undefined

  return (
    <Info_Page className={className}>
      {/* The name lives in the hero; the header carries the actions menu (same items as before) */}
      <Info_Page.Header
        actions={
          <Info_HeaderMenu>
            <AutomationMenu
              automationId={automation.id}
              automationName={automation.name}
              enabled={automation.enabled}
              onToggleEnabled={onToggleEnabled}
              onTest={onTest}
              onDuplicate={onDuplicate}
              onDelete={onDelete}
            />
          </Info_HeaderMenu>
        }
      />

      <Info_Page.Content>
        {/* Hero */}
        <Info_Page.Hero
          avatar={<AutomationAvatar event={automation.event} fluid />}
          title={automation.name}
          tagline={automation.summary}
          actions={editActions}
        />

        {/* Not running: the server skipped this entry, or its event never runs */}
        {automation.issues && (
          <Info_Alert variant="error" icon={<AlertCircle />}>
            <Info_Alert.Title>{t('automations.notRunningTitle')}</Info_Alert.Title>
            <Info_Alert.Description>
              {automation.issues.map((message, i) => (
                <span key={i} className="block break-words">{message}</span>
              ))}
            </Info_Alert.Description>
          </Info_Alert>
        )}

        {/* Disabled warning */}
        {!automation.enabled && (
          <Info_Alert variant="warning" icon={<PauseCircle />}>
            <Info_Alert.Title>{t('automations.pausedTitle')}</Info_Alert.Title>
            <Info_Alert.Description>
              {t('automations.pausedDescription')}
            </Info_Alert.Description>
          </Info_Alert>
        )}

        {/* Section: When */}
        <Info_Section
          title={t('automations.sectionWhen')}
          description={t('automations.sectionWhenDescription')}
          actions={editActions}
        >
          <Info_Table>
            <Info_Table.Row label={t('automations.labelEvent')}>
              <Info_Badge color="default">{getEventDisplayName(automation.event)}</Info_Badge>
            </Info_Table.Row>
            <Info_Table.Row label={t('automations.labelTiming')}>
              <PhaseBadge event={automation.event} />
            </Info_Table.Row>
            {automation.matcher && (
              <Info_Table.Row label={t('automations.labelOnlyWhenMatching')}>
                <code className="rounded-xs bg-fill-hover px-1.5 py-0.5 font-mono text-mono-ui [overflow-wrap:anywhere]">
                  {automation.matcher}
                </code>
              </Info_Table.Row>
            )}
            {automation.cron && (
              <>
                <Info_Table.Row label={t('automations.labelRepeats')} value={describeCron(automation.cron)} />
                <Info_Table.Row label={t('automations.labelScheduleExpression')}>
                  <code className="rounded-xs bg-fill-hover px-1.5 py-0.5 font-mono text-mono-ui">
                    {automation.cron}
                  </code>
                </Info_Table.Row>
                {nextRuns.length > 0 && (
                  <Info_Table.Row label={t('automations.labelNextRuns')}>
                    <div className="flex flex-col gap-0.5">
                      {(() => {
                        const spansYears = nextRuns.length > 1 && nextRuns[0].getFullYear() !== nextRuns[nextRuns.length - 1].getFullYear()
                        return nextRuns.map((date, i) => (
                          <span key={i} className="text-label text-secondary tabular-nums">
                            {date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: automation.timezone, ...(spansYears && { year: 'numeric' }) })}{' '}
                            {date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: automation.timezone })}
                          </span>
                        ))
                      })()}
                    </div>
                  </Info_Table.Row>
                )}
                <Info_Table.Row label={t('automations.labelTimezone')} value={automation.timezone || t('automations.systemDefault')} />
              </>
            )}
          </Info_Table>
        </Info_Section>

        {/* Section: If (conditions) — hidden when empty */}
        {automation.conditions && automation.conditions.length > 0 && (
          <Info_Section
            title={t('automations.sectionIf')}
            description={t('automations.sectionIfDescription')}
            actions={editActions}
          >
            <Info_Table>
              {flattenConditions(automation.conditions).map((row, i) => (
                <Info_Table.Row key={i} label={row.label}>
                  <span className="text-label text-secondary">
                    {row.description}
                  </span>
                </Info_Table.Row>
              ))}
            </Info_Table>
          </Info_Section>
        )}

        {/* Section: Then */}
        <Info_Section
          title={t('automations.sectionThen')}
          description={t('automations.sectionThenDescription', { count: automation.actions.length })}
          actions={editActions}
        >
          <div className="divide-y divide-separator">
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
        <Info_Section title={t('automations.sectionSettings')} actions={editActions}>
          <Info_Table>
            <Info_Table.Row label={t('automations.labelAccessLevel')} value={getPermissionDisplayName(automation.permissionMode)} />
            <Info_Table.Row label={t('automations.labelStatus')}>
              {/* Enabled is not the same as running: a skipped entry is enabled but never fires */}
              <Info_Badge color={!automation.enabled ? 'default' : automation.issues ? 'destructive' : 'success'} dot>
                {!automation.enabled
                  ? t('automations.statusDisabled')
                  : automation.issues ? t('automations.notRunning') : t('automations.statusActive')}
              </Info_Badge>
            </Info_Table.Row>
            {automation.labels && automation.labels.length > 0 && (
              <Info_Table.Row label={t('automations.labelLabels')}>
                <div className="flex gap-1.5 flex-wrap">
                  {automation.labels.map((l) => (
                    <Info_Badge key={l} color="muted">{l}</Info_Badge>
                  ))}
                </div>
              </Info_Table.Row>
            )}
            {automation.telegramTopic && (
              <Info_Table.Row label={t('automations.labelTelegramTopic')}>
                <div className="flex flex-col gap-1">
                  <div className="inline-flex items-center gap-1.5 text-foreground">
                    <Hash className="size-3.5 text-tertiary" aria-hidden />
                    <span className="font-mono text-mono-ui">{automation.telegramTopic}</span>
                  </div>
                  <span className="text-label-sm text-tertiary">
                    {hasSupergroup === false
                      ? t('automations.telegramTopicHintNoSupergroup')
                      : t('automations.telegramTopicHintBound')}
                  </span>
                </div>
              </Info_Table.Row>
            )}
          </Info_Table>
        </Info_Section>

        {/* Section: Recent Activity */}
        <Info_Section
          title={t('automations.sectionRecentActivity')}
          description={executions.length > 0 ? t('automations.lastNRuns', { count: executions.length }) : undefined}
        >
          <AutomationEventTimeline entries={executions} onReplay={onReplay} />
        </Info_Section>

        {/* Section: Raw config (JSON) */}
        <Info_Section title={t('automations.sectionRawConfig')}>
          <div className="overflow-hidden [&_pre]:!bg-transparent [&_.relative]:!bg-transparent [&_.relative]:!border-0 [&_.relative>div:first-child]:!bg-transparent [&_.relative>div:first-child]:!border-0">
            <Info_Markdown maxHeight={300} fullscreen>
              {`\`\`\`json\n${JSON.stringify({
                event: automation.event,
                matcher: automation.matcher,
                conditions: automation.conditions,
                cron: automation.cron,
                timezone: automation.timezone,
                permissionMode: automation.permissionMode,
                labels: automation.labels,
                telegramTopic: automation.telegramTopic,
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
