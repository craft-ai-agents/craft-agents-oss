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
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import { useTranslation } from 'react-i18next'
import { Panel } from './Panel'
import { MultiSelectPanel } from './MultiSelectPanel'
import { useAppShellContext } from '@/context/AppShellContext'
import { sessionMetaMapAtom, type SessionMeta } from '@/atoms/sessions'
import { StoplightProvider } from '@/context/StoplightContext'
import {
  useNavigationState,
  isSessionsNavigation,
  isSourcesNavigation,
  isSettingsNavigation,
  isSkillsNavigation,
  isMemoryNavigation,
  isNotesNavigation,
  isAutomationsNavigation,
  isProjectsNavigation,
  isBrowserNavigation,
  isKnowledgeNavigation,
  isDiffNavigation,
  isExtensionNavigation,
  isConnectionsNavigation,
} from '@/contexts/NavigationContext'
import { useSessionSelection, useIsMultiSelectActive, useSelectedIds, useSelectionCount } from '@/hooks/useSession'
import { sourceSelection, skillSelection, automationSelection } from '@/hooks/useEntitySelection'
import { extractLabelId } from '@craft-agent/shared/labels'
import type { SessionStatusId } from '@/config/session-status-config'
import { SourceInfoPage, ChatPage, BrowserPanelPage, KnowledgeSurfacePage, ExtensionSurfacePage } from '@/pages'
import NotesPage from '@/pages/NotesPage'
import ConnectionsPage from '@/pages/ConnectionsPage'
import KnowledgeEntityPage from '@/pages/KnowledgeEntityPage'
import SkillInfoPage from '@/pages/SkillInfoPage'
import { getSettingsPageComponent } from '@/pages/settings/settings-pages'
import { AutomationInfoPage } from '../automations/AutomationInfoPage'
import { AutomationGraphWorkspaceEditor } from '../automations/AutomationGraphWorkspaceEditor'
import ProjectInfoPage from '@/pages/ProjectInfoPage'
import { KanbanBoardContainer } from './kanban/KanbanBoardContainer'
import { SessionTableHost } from './session-table/SessionTableHost'
import type { ExecutionEntry } from '../automations/types'
import { automationsAtom } from '@/atoms/automations'
import { SendResourceToWorkspaceDialog, type SendResourceType } from './SendResourceToWorkspaceDialog'
import { KnowledgeDiff } from '../../knowledge/KnowledgeDiff'
import {
  KnowledgeHome,
  knowledgeActiveViewIdAtom,
  knowledgeHomeViewAtom,
} from '../../knowledge/KnowledgeHome'
import { KnowledgeProposals } from '../../knowledge/KnowledgeProposals'

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
  /** Owning panel id in the panel stack (used by embedded surfaces like browser panels) */
  panelId?: string
}

export function MainContentPanel({
  isSidebarAndNavigatorHidden = false,
  className,
  navStateOverride,
  panelId,
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
    projects,
    labels,
    onTestAutomation,
    onToggleAutomation,
    onDuplicateAutomation,
    onDeleteAutomation,
    onReplayAutomation,
    automationTestResults,
    getAutomationHistory,
    activeSessionWorkingDirectory,
  } = useAppShellContext()

  // Session multi-select state
  const isMultiSelectActive = useIsMultiSelectActive()
  const selectedIds = useSelectedIds()
  const selectionCount = useSelectionCount()
  const { clearMultiSelect } = useSessionSelection()
  const sessionMetaMap = useAtomValue(sessionMetaMapAtom)
  const automations = useAtomValue(automationsAtom)
  const setKnowledgeHomeView = useSetAtom(knowledgeHomeViewAtom)
  const setKnowledgeActiveViewId = useSetAtom(knowledgeActiveViewIdAtom)

  // P5: deep-link knowledge/view/{viewId} → KnowledgeHome saved-view surface.
  // Leaving a view route (bare knowledge nav or other knowledge details) clears the atom.
  useEffect(() => {
    if (!isKnowledgeNavigation(navState)) return
    if (navState.details?.type === 'knowledge-view') {
      setKnowledgeActiveViewId(navState.details.viewId)
      setKnowledgeHomeView('view')
      return
    }
    setKnowledgeActiveViewId(null)
    // Leaving a view deep-link returns to search (proposals stays if user toggled it).
    setKnowledgeHomeView('search')
  }, [navState, setKnowledgeActiveViewId, setKnowledgeHomeView])

  // Execution history for the selected automation
  const selectedAutomationId = isAutomationsNavigation(navState) ? navState.details?.automationId : undefined
  const [executions, setExecutions] = useState<ExecutionEntry[]>([])
  useEffect(() => {
    if (!selectedAutomationId || !getAutomationHistory) {
      setExecutions([])
      return
    }
    let stale = false

    // Initial fetch
    getAutomationHistory(selectedAutomationId).then(entries => {
      if (!stale) setExecutions(entries)
    })

    // Re-fetch on automation changes (live updates when automations fire)
    const cleanup = window.electronAPI.onAutomationsChanged(() => {
      if (!stale) {
        getAutomationHistory(selectedAutomationId).then(entries => {
          if (!stale) setExecutions(entries)
        })
      }
    })

    return () => { stale = true; cleanup() }
  }, [selectedAutomationId, getAutomationHistory])

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

  // Settings navigator - uses component map from settings-pages.ts.
  // Bare `settings` route (subpage === null) means navigator-only view in compact mode;
  // PanelStackContainer hides the content panel entirely. On desktop the panel still
  // mounts, so fall back to the App page so it isn't empty.
  if (isSettingsNavigation(navState)) {
    const subpage = navState.subpage ?? 'app'
    const SettingsPageComponent = getSettingsPageComponent(subpage)
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
    if (navState.details) {
      return wrapWithStoplight(
        <Panel variant="grow" className={className}>
          <SourceInfoPage
            sourceSlug={navState.details.sourceSlug}
            workspaceId={activeWorkspaceId || ''}
          />
        </Panel>
      )
    }
    // No source selected - empty state
    return wrapWithStoplight(
      <Panel variant="grow" className={className}>
        <div className="flex items-center justify-center h-full text-muted-foreground">
          <p className="text-sm">{t("sourcesList.noSourcesConfigured")}</p>
        </div>
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
    if (navState.details?.type === 'skill') {
      return wrapWithStoplight(
        <Panel variant="grow" className={className}>
          <SkillInfoPage
            skillSlug={navState.details.skillSlug}
            workspaceId={activeWorkspaceId || ''}
            workingDirectory={activeSessionWorkingDirectory}
          />
        </Panel>
      )
    }
    // No skill selected - empty state
    return wrapWithStoplight(
      <Panel variant="grow" className={className}>
        <div className="flex items-center justify-center h-full text-muted-foreground">
          <p className="text-sm">{t("skillsList.noSkillsConfigured")}</p>
        </div>
      </Panel>
    )
  }

  // Memory navigator - the panel lives in the navigator column; main content shows a hint
  if (isMemoryNavigation(navState)) {
    return wrapWithStoplight(
      <Panel variant="grow" className={className}>
        <div className="flex items-center justify-center h-full text-muted-foreground">
          <p className="text-sm">{t("memory.emptyHint")}</p>
        </div>
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
    if (navState.details) {
      const automation = automations.find(h => h.id === navState.details!.automationId)
      if (automation) {
        return wrapWithStoplight(
          <Panel variant="grow" className={className}>
            <AutomationInfoPage
              automation={automation}
              executions={executions}
              testResult={automationTestResults?.[automation.id]}
              onTest={onTestAutomation ? () => onTestAutomation(automation.id) : undefined}
              onToggleEnabled={onToggleAutomation ? () => onToggleAutomation(automation.id) : undefined}
              onDuplicate={onDuplicateAutomation ? () => onDuplicateAutomation(automation.id) : undefined}
              onDelete={onDeleteAutomation ? () => onDeleteAutomation(automation.id) : undefined}
              onReplay={onReplayAutomation}
            />
          </Panel>
        )
      }
    }
    return wrapWithStoplight(
      <Panel variant="grow" className={className}>
        <div className="flex h-full min-h-0 flex-col gap-3 p-4">
          <div className="shrink-0">
            <h1 className="text-lg font-semibold">{t('entityView.graph')}</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {t('automations.emptyDescription')}
            </p>
          </div>
          <AutomationGraphWorkspaceEditor
            workspaceId={activeWorkspaceId}
            className="min-h-0 flex-1"
          />
        </div>
      </Panel>
    )
  }

  // Projects navigator - show project detail page or empty state
  if (isProjectsNavigation(navState)) {
    const projectDetails = navState.details
    if (projectDetails && projectDetails.type === 'project') {
      return wrapWithStoplight(
        <Panel variant="grow" className={className}>
          <ProjectInfoPage projectSlug={projectDetails.projectSlug} />
        </Panel>
      )
    }
    return wrapWithStoplight(
      <Panel variant="grow" className={className}>
        <div className="flex items-center justify-center h-full text-muted-foreground">
          <p className="text-sm">{t("projectsList.noProjectSelected")}</p>
        </div>
      </Panel>
    )
  }

  // Browser navigator - embedded browser instance panel
  if (isBrowserNavigation(navState)) {
    const instanceId = navState.details?.type === 'browser' ? navState.details.id : null
    if (instanceId) {
      return wrapWithStoplight(
        <Panel variant="grow" className={className}>
          <BrowserPanelPage instanceId={instanceId} panelId={panelId} />
        </Panel>
      )
    }
    return wrapWithStoplight(
      <Panel variant="grow" className={className}>
        <div className="flex items-center justify-center h-full text-muted-foreground">
          <p className="text-sm">{t('browser.noInstanceSelected', { defaultValue: 'No browser instance selected' })}</p>
        </div>
      </Panel>
    )
  }

  // Knowledge navigator - embedded SiYuan surface panel (W2)
  if (isKnowledgeNavigation(navState)) {
    const details = navState.details?.type === 'knowledge' ? navState.details : null
    if (details) {
      return wrapWithStoplight(
        <Panel variant="grow" className={className}>
          <KnowledgeEntityPage kind={details.kind} id={details.id} panelId={panelId} />
        </Panel>
      )
    }
    return wrapWithStoplight(
      <Panel variant="grow" className={className}>
        <KnowledgeHome />
      </Panel>
    )
  }

  // Extension navigator - sandboxed extension UI surface (S-05)
  if (isExtensionNavigation(navState)) {
    const details = navState.details?.type === 'extension' ? navState.details : null
    if (details?.extensionId && details.viewId) {
      return wrapWithStoplight(
        <Panel variant="grow" className={className}>
          <ExtensionSurfacePage
            extensionId={details.extensionId}
            viewId={details.viewId}
            panelId={panelId}
          />
        </Panel>
      )
    }
    return wrapWithStoplight(
      <Panel variant="grow" className={className}>
        <div className="flex items-center justify-center h-full text-muted-foreground">
          <p className="text-sm">
            {t('extensions.surface.noViewSelected', {
              defaultValue: 'Select an extension view to open',
            })}
          </p>
        </div>
      </Panel>
    )
  }

  // Diff navigator - mutation-proposal review/conflict surface (P3, spec K-05 §3.5)
  if (isDiffNavigation(navState)) {
    const proposalId = navState.details?.type === 'diff' ? navState.details.proposalId : null
    return wrapWithStoplight(
      <Panel variant="grow" className={className}>
        {proposalId ? <KnowledgeDiff proposalId={proposalId} /> : <KnowledgeProposals className="h-full" />}
      </Panel>
    )
  }

  if (isConnectionsNavigation(navState)) {
    return wrapWithStoplight(
      <Panel variant="grow" className={className}>
        <ConnectionsPage />
      </Panel>
    )
  }

  // Notes navigator - self-contained notes workspace
  if (isNotesNavigation(navState)) {
    return wrapWithStoplight(
      <Panel variant="grow" className={className}>
        <NotesPage selectedNoteId={navState.details?.type === 'note' ? navState.details.noteId : null} />
      </Panel>
    )
  }

  // Chats navigator - show chat, multi-select panel, or empty state
  if (isSessionsNavigation(navState)) {
    // Board view: full-width Kanban over all sessions (placement independent of status)
    if (navState.viewMode === 'board') {
      return wrapWithStoplight(
        <Panel variant="grow" className={className}>
          <KanbanBoardContainer />
        </Panel>
      )
    }

    // Table view: full-width sessions table shell (B0 placeholder host)
    if (navState.viewMode === 'table') {
      return wrapWithStoplight(
        <Panel variant="grow" className={className}>
          <SessionTableHost />
        </Panel>
      )
    }

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
