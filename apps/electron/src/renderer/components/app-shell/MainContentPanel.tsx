/**
 * MainContentPanel - Right panel component for displaying content
 *
 * Renders content based on the unified NavigationState:
 * - Chats navigator: ChatPage for selected session, or empty state
 * - Sources navigator: SourceInfoPage for selected source, or empty state
 * - Settings navigator: Settings, Preferences, or Shortcuts page
 *
 * The NavigationState is the single source of truth for what to display.
 *
 * In focused mode (single window), wraps content with StoplightProvider
 * so PanelHeader components automatically compensate for macOS traffic lights.
 *
 * When multiple sessions are selected (multi-select mode), shows the
 * MultiSelectPanel with batch action buttons instead of a single chat.
 */

import * as React from 'react'
import { useCallback, useMemo, useState } from 'react'
import { useAtomValue } from 'jotai'
import { useTranslation } from 'react-i18next'
import { Panel } from './Panel'
import { MultiSelectPanel } from './MultiSelectPanel'
import { useAppShellContext } from '@/context/AppShellContext'
import { sessionMetaMapAtom, type SessionMeta } from '@/atoms/sessions'
import { StoplightProvider } from '@/context/StoplightContext'
import {
  useNavigation,
  useNavigationState,
  isSessionsNavigation,
  isSourcesNavigation,
  isSettingsNavigation,
  isSkillsNavigation,
  isAgentsNavigation,
  isAutomationsNavigation,
  isWorkspaceContextNavigation,
  isOutputsNavigation,
} from '@/contexts/NavigationContext'
import { isWorkflowsNavigation, isWorkflowRunNavigation } from '../../../shared/types'
import type { LoadedSkill, LoadedSource } from '../../../shared/types'
import { useSessionSelection, useIsMultiSelectActive, useSelectedIds, useSelectionCount } from '@/hooks/useSession'
import { sourceSelection, skillSelection, automationSelection } from '@/hooks/useEntitySelection'
import { extractLabelId } from '@craft-agent/shared/labels'
import type { SessionStatusId } from '@/config/session-status-config'
import { ChatPage } from '@/pages'
import AgentInfoPage from '@/pages/AgentInfoPage'
import WorkspaceContextPage from '@/pages/WorkspaceContextPage'
import WorkflowsListPage from '@/pages/WorkflowsListPage'
import WorkflowInfoPage from '@/pages/WorkflowInfoPage'
import WorkflowEditPage from '@/pages/WorkflowEditPage'
import WorkflowRunPage from '@/pages/WorkflowRunPage'
import RecentRunsPage from '@/pages/RecentRunsPage'
import OutputDetailPage from '@/pages/OutputDetailPage'
import { AgentsLaunchpad } from './AgentsLaunchpad'
import { getSettingsPageComponent } from '@/pages/settings/settings-pages'
import {
  AGENT_EVENTS,
  APP_EVENTS,
  EXTERNAL_INPUT_EVENTS,
  getEventDisplayName,
  type AutomationListItem,
} from '../automations/types'
import { automationsAtom } from '@/atoms/automations'
import { SendResourceToWorkspaceDialog, type SendResourceType } from './SendResourceToWorkspaceDialog'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { useOutputs, type OutputSummaryDTO } from '@/hooks/useOutputs'
import { navigate, routes } from '@/lib/navigate'

export interface MainContentPanelProps {
  /** Whether both sidebar and navigator are hidden (focus mode / CMD+.) */
  isSidebarAndNavigatorHidden?: boolean
  /** Optional className for the container */
  className?: string
  /**
   * Override the navigation state for this panel.
   * When provided, this panel renders based on the override instead of the global NavigationState.
   * Used by PanelSlot to render panels in the panel stack.
   */
  navStateOverride?: import('../../../shared/types').NavigationState | null
}

export function MainContentPanel({
  isSidebarAndNavigatorHidden = false,
  className,
  navStateOverride,
}: MainContentPanelProps) {
  const { t } = useTranslation()
  const globalNavState = useNavigationState()
  const navState = navStateOverride ?? globalNavState
  const {
    activeWorkspaceId,
    workspaces,
    onSessionStatusChange,
    onArchiveSession,
    onSessionLabelsChange,
    sessionStatuses,
    labels,
    onTestAutomation,
    onToggleAutomation,
    onDuplicateAutomation,
    onDeleteAutomation,
    enabledSources,
    skills,
  } = useAppShellContext()

  // Session multi-select state
  const isMultiSelectActive = useIsMultiSelectActive()
  const selectedIds = useSelectedIds()
  const selectionCount = useSelectionCount()
  const { clearMultiSelect } = useSessionSelection()
  const sessionMetaMap = useAtomValue(sessionMetaMapAtom)
  const automations = useAtomValue(automationsAtom)
  const {
    outputs,
    loading: outputsLoading,
    error: outputsError,
  } = useOutputs(activeWorkspaceId)

  // Source multi-select state
  const isSourceMultiSelectActive = sourceSelection.useIsMultiSelectActive()
  const sourceSelectionCount = sourceSelection.useSelectionCount()
  const selectedSourceIds = sourceSelection.useSelectedIds()
  const { clearMultiSelect: clearSourceSelection } = sourceSelection.useSelection()

  // Skill multi-select state
  const isSkillMultiSelectActive = skillSelection.useIsMultiSelectActive()
  const skillSelectionCount = skillSelection.useSelectionCount()
  const selectedSkillIds = skillSelection.useSelectedIds()
  const { clearMultiSelect: clearSkillSelection } = skillSelection.useSelection()

  // Automation multi-select state
  const isAutomationMultiSelectActive = automationSelection.useIsMultiSelectActive()
  const automationSelectionCount = automationSelection.useSelectionCount()
  const selectedAutomationIds = automationSelection.useSelectedIds()
  const { clearMultiSelect: clearAutomationSelection } = automationSelection.useSelection()

  // Send to Workspace dialog state (shared across resource types)
  const [sendDialogOpen, setSendDialogOpen] = useState(false)
  const [sendResourceType, setSendResourceType] = useState<SendResourceType>('source')
  const [sendResourceIds, setSendResourceIds] = useState<string[]>([])
  const [sendResourceLabel, setSendResourceLabel] = useState('')
  const hasOtherWorkspaces = workspaces.length > 1

  const openSendDialog = useCallback((type: SendResourceType, ids: Set<string>) => {
    const count = ids.size
    setSendResourceType(type)
    setSendResourceIds([...ids])
    setSendResourceLabel(`${count} ${type}${count !== 1 ? 's' : ''}`)
    setSendDialogOpen(true)
  }, [])

  const selectedMetas = useMemo(() => {
    const metas: SessionMeta[] = []
    selectedIds.forEach((id) => {
      const meta = sessionMetaMap.get(id)
      if (meta) metas.push(meta)
    })
    return metas
  }, [selectedIds, sessionMetaMap])

  const activeStatusId = useMemo((): SessionStatusId | null => {
    if (selectedMetas.length === 0) return null
    const first = (selectedMetas[0].sessionStatus || 'todo') as SessionStatusId
    const allSame = selectedMetas.every(meta => (meta.sessionStatus || 'todo') === first)
    return allSame ? first : null
  }, [selectedMetas])

  const appliedLabelIds = useMemo(() => {
    if (selectedMetas.length === 0) return new Set<string>()
    const toLabelSet = (meta: SessionMeta) =>
      new Set((meta.labels || []).map(entry => extractLabelId(entry)))
    const [first, ...rest] = selectedMetas.map(toLabelSet)
    const intersection = new Set(first)
    for (const labelSet of rest) {
      for (const id of [...intersection]) {
        if (!labelSet.has(id)) intersection.delete(id)
      }
    }
    return intersection
  }, [selectedMetas])

  // Batch operations for multi-select
  const handleBatchSetStatus = useCallback((status: SessionStatusId) => {
    selectedIds.forEach(sessionId => {
      onSessionStatusChange(sessionId, status)
    })
  }, [selectedIds, onSessionStatusChange])

  const handleBatchArchive = useCallback(() => {
    selectedIds.forEach(sessionId => {
      onArchiveSession(sessionId)
    })
    clearMultiSelect()
  }, [selectedIds, onArchiveSession, clearMultiSelect])

  const handleBatchToggleLabel = useCallback((labelId: string) => {
    if (!onSessionLabelsChange) return
    const allHaveLabel = selectedMetas.every(meta =>
      (meta.labels || []).some(entry => extractLabelId(entry) === labelId)
    )

    selectedMetas.forEach(meta => {
      const labels = meta.labels || []
      const hasLabel = labels.some(entry => extractLabelId(entry) === labelId)
      const filtered = labels.filter(entry => extractLabelId(entry) !== labelId)
      const nextLabels = allHaveLabel
        ? filtered
        : (hasLabel ? labels : [...labels, labelId])
      onSessionLabelsChange(meta.id, nextLabels)
    })
  }, [selectedMetas, onSessionLabelsChange])

  // Wrap content with StoplightProvider so PanelHeaders auto-compensate in focused mode.
  // Also renders the Send to Workspace dialog (portal-based, so it overlays regardless of position).
  const wrapWithStoplight = (content: React.ReactNode) => (
    <StoplightProvider value={isSidebarAndNavigatorHidden}>
      {content}
      <SendResourceToWorkspaceDialog
        open={sendDialogOpen}
        onOpenChange={setSendDialogOpen}
        resourceType={sendResourceType}
        resourceIds={sendResourceIds}
        resourceLabel={sendResourceLabel}
        workspaces={workspaces}
        activeWorkspaceId={activeWorkspaceId || ''}
      />
    </StoplightProvider>
  )

  // Settings navigator - uses component map from settings-pages.ts
  if (isSettingsNavigation(navState)) {
    const SettingsPageComponent = getSettingsPageComponent(navState.subpage)
    return wrapWithStoplight(
      <Panel variant="grow" className={className}>
        <SettingsPageComponent />
      </Panel>
    )
  }

  // Sources navigator - show source info, multi-select panel, or empty state
  if (isSourcesNavigation(navState)) {
    if (isSourceMultiSelectActive) {
      return wrapWithStoplight(
        <Panel variant="grow" className={className}>
          <MultiSelectPanel
            count={sourceSelectionCount}
            entityType="source"
            onSendToWorkspace={hasOtherWorkspaces ? () => openSendDialog('source', selectedSourceIds) : undefined}
            onClearSelection={clearSourceSelection}
          />
        </Panel>
      )
    }
    const handleDeleteSource = async (sourceSlug: string) => {
      if (!activeWorkspaceId) return
      try {
        await window.electronAPI.deleteSource(activeWorkspaceId, sourceSlug)
        toast.success(t('toast.deletedSource'))
      } catch (error) {
        console.error('[MainContentPanel] Failed to delete source:', error)
        toast.error(t('toast.failedToDeleteSource'))
      }
    }

    return wrapWithStoplight(
      <Panel variant="grow" className={className}>
        <ResourceRows
          label="Tool layer"
          title="Tools"
          description="Connected capabilities available to sessions and agents."
          sources={enabledSources ?? []}
          sourceFilter={navState.filter?.kind === 'type' ? navState.filter.sourceType : null}
          onDeleteSource={handleDeleteSource}
        />
      </Panel>
    )
  }

  // Skills navigator - show skill info, multi-select panel, or empty state
  if (isSkillsNavigation(navState)) {
    if (isSkillMultiSelectActive) {
      return wrapWithStoplight(
        <Panel variant="grow" className={className}>
          <MultiSelectPanel
            count={skillSelectionCount}
            entityType="skill"
            onSendToWorkspace={hasOtherWorkspaces ? () => openSendDialog('skill', selectedSkillIds) : undefined}
            onClearSelection={clearSkillSelection}
          />
        </Panel>
      )
    }
    const handleDeleteSkill = async (skillSlug: string) => {
      if (!activeWorkspaceId) return
      try {
        await window.electronAPI.deleteSkill(activeWorkspaceId, skillSlug)
        toast.success(t('toast.deletedSkill', { slug: skillSlug }))
      } catch (error) {
        console.error('[MainContentPanel] Failed to delete skill:', error)
        toast.error(t('toast.failedToDeleteSkill'))
      }
    }

    return wrapWithStoplight(
      <Panel variant="grow" className={className}>
        <ResourceRows
          label="Skill layer"
          title="Skills"
          description="Reusable instruction sets agents can invoke when the task calls for them."
          skills={skills ?? []}
          onDeleteSkill={handleDeleteSkill}
        />
      </Panel>
    )
  }

  // Agents navigator - show agent info, or a launchpad/welcome view when
  // no agent is selected. Sidebar children carry the active list now, so
  // we don't repeat them here — instead we show a friendly orientation
  // surface that points users at the Orchestrator and the Manage modal.
  if (isAgentsNavigation(navState)) {
    if (navState.details?.type === 'agent') {
      return wrapWithStoplight(
        <Panel variant="grow" className={className}>
          <AgentInfoPage
            agentSlug={navState.details.agentSlug}
            workspaceId={activeWorkspaceId || ''}
          />
        </Panel>
      )
    }
    return wrapWithStoplight(
      <Panel variant="grow" className={className}>
        <AgentsLaunchpad workspaceId={activeWorkspaceId} />
      </Panel>
    )
  }

  if (isWorkspaceContextNavigation(navState)) {
    return wrapWithStoplight(
      <Panel variant="grow" className={className}>
        <WorkspaceContextPage workspaceId={activeWorkspaceId || ''} />
      </Panel>
    )
  }

  if (isWorkflowsNavigation(navState)) {
    const wsId = activeWorkspaceId || ''
    switch (navState.details.type) {
      case 'workflow':
        return wrapWithStoplight(
          <Panel variant="grow" className={className}>
            <WorkflowInfoPage workflowSlug={navState.details.workflowSlug} workspaceId={wsId} />
          </Panel>
        )
      case 'workflow-edit':
        return wrapWithStoplight(
          <Panel variant="grow" className={className}>
            <WorkflowEditPage workflowSlug={navState.details.workflowSlug} workspaceId={wsId} />
          </Panel>
        )
      case 'recent-runs':
        return wrapWithStoplight(
          <Panel variant="grow" className={className}>
            <RecentRunsPage workspaceId={wsId} />
          </Panel>
        )
      case 'list':
      default:
        return wrapWithStoplight(
          <Panel variant="grow" className={className}>
            <WorkflowsListPage workspaceId={wsId} />
          </Panel>
        )
    }
  }

  if (isWorkflowRunNavigation(navState)) {
    return wrapWithStoplight(
      <Panel variant="grow" className={className}>
        <WorkflowRunPage runId={navState.runId} workspaceId={activeWorkspaceId || ''} />
      </Panel>
    )
  }

  if (isOutputsNavigation(navState)) {
    if (!navState.outputId) {
      return wrapWithStoplight(
        <Panel variant="grow" className={className}>
          <ResourceRows
            label="Output layer"
            title="Outputs"
            description="Artifacts, files, reports, and receipts created by sessions and workflows."
            outputs={outputs}
            loading={outputsLoading}
            error={outputsError}
            onOpenOutput={(outputId) => navigate(routes.view.output(outputId))}
          />
        </Panel>
      )
    }

    return wrapWithStoplight(
      <Panel variant="grow" className={className}>
        <OutputDetailPage outputId={navState.outputId} workspaceId={activeWorkspaceId || ''} />
      </Panel>
    )
  }

  // Automations navigator - show automation info, multi-select panel, or empty state
  if (isAutomationsNavigation(navState)) {
    if (isAutomationMultiSelectActive) {
      return wrapWithStoplight(
        <Panel variant="grow" className={className}>
          <MultiSelectPanel
            count={automationSelectionCount}
            entityType="automation"
            onSendToWorkspace={hasOtherWorkspaces ? () => openSendDialog('automation', selectedAutomationIds) : undefined}
            onClearSelection={clearAutomationSelection}
          />
        </Panel>
      )
    }
    return wrapWithStoplight(
      <Panel variant="grow" className={className}>
        <ResourceRows
          label="Automation layer"
          title="Automations"
          description="Scheduled, event, and agentic routines configured for this workspace."
          automations={automations}
          automationFilter={navState.filter?.automationType ?? null}
          onDeleteAutomation={onDeleteAutomation}
          onToggleAutomation={onToggleAutomation}
          onTestAutomation={onTestAutomation}
          onDuplicateAutomation={onDuplicateAutomation}
        />
      </Panel>
    )
  }

  // Chats navigator - show chat, multi-select panel, or empty state
  if (isSessionsNavigation(navState)) {
    // Multi-select mode: show batch actions panel
    if (isMultiSelectActive) {
      return wrapWithStoplight(
        <Panel variant="grow" className={className}>
          <MultiSelectPanel
            count={selectionCount}
            sessionStatuses={sessionStatuses}
            activeStatusId={activeStatusId}
            onSetStatus={handleBatchSetStatus}
            labels={labels}
            appliedLabelIds={appliedLabelIds}
            onToggleLabel={handleBatchToggleLabel}
            onArchive={handleBatchArchive}
            onClearSelection={clearMultiSelect}
          />
        </Panel>
      )
    }

    if (navState.details) {
      return wrapWithStoplight(
        <Panel variant="grow" className={className}>
          <ChatPage sessionId={navState.details.sessionId} />
        </Panel>
      )
    }
    // No session selected - empty state
    return wrapWithStoplight(
      <Panel variant="grow" className={className}>
        <div className="flex items-center justify-center h-full text-muted-foreground">
          <p className="text-sm">{t("session.noSessionSelected")}</p>
        </div>
      </Panel>
    )
  }

  // Fallback (should not happen with proper NavigationState)
  return wrapWithStoplight(
    <Panel variant="grow" className={className}>
      <div className="flex items-center justify-center h-full text-muted-foreground">
        <p className="text-sm">{t("session.selectConversation")}</p>
      </div>
    </Panel>
  )
}

type ResourceRowsProps = {
  label: string
  title: string
  description: string
  sources?: LoadedSource[]
  sourceFilter?: string | null
  skills?: LoadedSkill[]
  automations?: AutomationListItem[]
  automationFilter?: string | null
  outputs?: OutputSummaryDTO[]
  loading?: boolean
  error?: string | null
  onDeleteSource?: (sourceSlug: string) => void
  onDeleteSkill?: (skillSlug: string) => void
  onDeleteAutomation?: (automationId: string) => void
  onToggleAutomation?: (automationId: string) => void
  onTestAutomation?: (automationId: string) => void
  onDuplicateAutomation?: (automationId: string) => void
  onOpenOutput?: (outputId: string) => void
}

type ResourceRow = {
  id: string
  kicker: string
  title: string
  summary: string
  disabled: boolean
  onOpen?: () => void
  actions: Array<{ label: string; onClick: () => void }>
}

function ResourceRows({
  label,
  title,
  description,
  sources,
  sourceFilter,
  skills,
  automations,
  automationFilter,
  outputs,
  loading,
  error,
  onDeleteSource,
  onDeleteSkill,
  onDeleteAutomation,
  onToggleAutomation,
  onTestAutomation,
  onDuplicateAutomation,
  onOpenOutput,
}: ResourceRowsProps) {
  const rows = React.useMemo<ResourceRow[]>(() => {
    if (sources) {
      return sources
        .filter((source) => !sourceFilter || source.config.type === sourceFilter)
        .map((source) => ({
          id: source.config.slug,
          kicker: source.config.type.toUpperCase(),
          title: cleanDisplayText(source.config.name),
          summary: cleanDisplayText(source.config.tagline || source.guide?.scope || `${source.config.provider} connection`),
          disabled: false,
          onOpen: undefined,
          actions: onDeleteSource ? [{ label: 'Delete', onClick: () => onDeleteSource(source.config.slug) }] : [],
        }))
    }

    if (skills) {
      return skills.map((skill) => ({
        id: skill.slug,
        kicker: (skill.metadata.category ?? skill.source).replace(/-/g, ' ').toUpperCase(),
        title: cleanDisplayText(skill.metadata.name),
        summary: cleanDisplayText(skill.metadata.description || 'Workspace skill'),
        disabled: false,
        onOpen: undefined,
        actions: onDeleteSkill ? [{ label: 'Delete', onClick: () => onDeleteSkill(skill.slug) }] : [],
      }))
    }

    if (automations) {
      const filteredAutomations = filterAutomations(automations, automationFilter)
      return filteredAutomations.map((automation) => ({
        id: automation.id,
        kicker: getEventDisplayName(automation.event).toUpperCase(),
        title: cleanDisplayText(automation.name),
        summary: cleanDisplayText(automation.summary || 'Automation routine'),
        disabled: !automation.enabled,
        onOpen: undefined,
        actions: [
          onToggleAutomation
            ? { label: automation.enabled ? 'Pause' : 'Enable', onClick: () => onToggleAutomation(automation.id) }
            : null,
          onTestAutomation ? { label: 'Test', onClick: () => onTestAutomation(automation.id) } : null,
          onDuplicateAutomation ? { label: 'Duplicate', onClick: () => onDuplicateAutomation(automation.id) } : null,
          onDeleteAutomation ? { label: 'Delete', onClick: () => onDeleteAutomation(automation.id) } : null,
        ].filter(Boolean) as Array<{ label: string; onClick: () => void }>,
      }))
    }

    return (outputs ?? []).map((output) => ({
      id: output.id,
      kicker: output.status.toUpperCase(),
      title: cleanDisplayText(output.title),
      summary: cleanDisplayText(output.summary || outputProducerLabel(output)),
      disabled: output.status === 'cancelled' || output.status === 'failed',
      onOpen: onOpenOutput ? () => onOpenOutput(output.id) : undefined,
      actions: [],
    }))
  }, [automationFilter, automations, onDeleteAutomation, onDeleteSkill, onDeleteSource, onDuplicateAutomation, onOpenOutput, onTestAutomation, onToggleAutomation, outputs, skills, sourceFilter, sources])

  if (loading) {
    return (
      <div className="h-full overflow-y-auto bg-[radial-gradient(circle_at_50%_8%,rgba(59,130,246,0.10),transparent_30%),#08080a]">
        <div className="mx-auto flex min-h-full max-w-4xl items-center justify-center px-8 py-9 text-sm text-white/42">
          Loading...
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="h-full overflow-y-auto bg-[radial-gradient(circle_at_50%_8%,rgba(59,130,246,0.10),transparent_30%),#08080a]">
        <div className="mx-auto flex min-h-full max-w-4xl items-center justify-center px-8 py-9 text-sm text-red-200/70">
          {error}
        </div>
      </div>
    )
  }

  return (
    <div className="h-full overflow-y-auto bg-[radial-gradient(circle_at_50%_8%,rgba(59,130,246,0.10),transparent_30%),#08080a]">
      <div className="mx-auto flex min-h-full max-w-4xl flex-col px-8 py-9">
        <header className="mb-7">
          <div className="mb-3 font-mono text-[11px] font-semibold uppercase tracking-[0.22em] text-white/35">
            {label}
          </div>
          <h1 className="text-[30px] font-medium leading-tight text-white">{title}</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-white/48">{description}</p>
        </header>

        {rows.length === 0 ? (
          <div className="flex flex-1 items-center justify-center rounded-[16px] border border-dashed border-white/[0.10] bg-white/[0.025] text-sm text-white/42">
            Nothing configured.
          </div>
        ) : (
          <div className="overflow-hidden rounded-[16px] border border-white/[0.075] bg-[#0a0a0a] shadow-[0_0_50px_rgba(0,0,0,0.45)]">
            {rows.map((row, index) => (
              <button
                key={row.id}
                type="button"
                onClick={row.onOpen}
                className={cn(
                  "group flex min-h-[92px] w-full items-center gap-4 px-5 py-4 text-left transition-colors hover:bg-white/[0.035]",
                  index > 0 && "border-t border-white/[0.055]",
                  row.disabled && "opacity-45",
                  !row.onOpen && "cursor-default",
                )}
              >
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] border border-white/[0.08] bg-white/[0.035] font-mono text-[11px] font-semibold text-white/44">
                  {row.title.slice(0, 2).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="mb-1 font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-white/28">
                    {row.kicker}
                  </div>
                  <div className="truncate text-[15px] font-medium text-white/88">{row.title}</div>
                  <p className="mt-1 line-clamp-2 text-[13px] leading-5 text-white/42">{row.summary}</p>
                </div>
                {row.actions.length > 0 && (
                  <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                    {row.actions.map((action) => (
                      <span
                        key={action.label}
                        role="button"
                        tabIndex={0}
                        onClick={(event) => {
                          event.stopPropagation()
                          action.onClick()
                        }}
                        onKeyDown={(event) => {
                          if (event.key !== 'Enter' && event.key !== ' ') return
                          event.preventDefault()
                          event.stopPropagation()
                          action.onClick()
                        }}
                        className="rounded-[7px] border border-white/[0.07] bg-white/[0.035] px-2 py-1 text-[11px] font-medium text-white/48 transition-colors hover:bg-white/[0.075] hover:text-white/82"
                      >
                        {action.label}
                      </span>
                    ))}
                  </div>
                )}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function filterAutomations(automations: AutomationListItem[], automationFilter?: string | null) {
  if (!automationFilter) return automations
  if (automationFilter === 'scheduled') return automations.filter((automation) => automation.event === 'SchedulerTick')
  if (automationFilter === 'external') return automations.filter((automation) => (EXTERNAL_INPUT_EVENTS as string[]).includes(automation.event))
  if (automationFilter === 'agentic') return automations.filter((automation) => (AGENT_EVENTS as string[]).includes(automation.event))
  if (automationFilter === 'event') {
    return automations.filter((automation) =>
      (APP_EVENTS as string[]).includes(automation.event)
      && automation.event !== 'SchedulerTick'
      && !(EXTERNAL_INPUT_EVENTS as string[]).includes(automation.event),
    )
  }
  return automations
}

function outputProducerLabel(output: OutputSummaryDTO) {
  const origin = output.origin
  if (!origin) return output.kind.replace(/-/g, ' ')
  return origin.workflowName
    || origin.agentName
    || origin.workflowSlug
    || origin.agentSlug
    || origin.source
}

function cleanDisplayText(value: string) {
  return value
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
}
