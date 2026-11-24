/**
 * AutomationsListPanel
 *
 * Navigator panel for displaying automations in the 2nd column.
 * Follows the SourcesListPanel pattern with avatar, title, subtitle, badges.
 * Title and Plus button are handled by the shared PanelHeader in AppShell.
 *
 * Supports CMD/CTRL+click multi-select and Shift+click range select,
 * using the shared EntityRow + createEntitySelection infrastructure.
 */

import * as React from 'react'
import { useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useAtomValue } from 'jotai'
import { AlertCircle, Webhook } from 'lucide-react'
import { automationLoadIssuesAtom } from '@/atoms/automations'
import { Info_Alert } from '@/components/info/Info_Alert'
import { Info_Badge } from '@/components/info/Info_Badge'
import { Tooltip, TooltipTrigger, TooltipContent } from '@craft-agent/ui'
import { ScrollArea } from '@/components/ui/scroll-area'
import { EntityListEmptyScreen } from '@/components/ui/entity-list-empty'
import { EntityRow } from '@/components/ui/entity-row'
import { EditPopover, getEditConfig } from '@/components/ui/EditPopover'
import { SessionSearchHeader } from '@/components/app-shell/SessionSearchHeader'
import { AutomationMenu } from './AutomationMenu'
import { BatchAutomationMenu } from './BatchAutomationMenu'
import { AutomationAvatar } from './AutomationAvatar'
import { SendResourceToWorkspaceDialog } from '@/components/app-shell/SendResourceToWorkspaceDialog'
import { useAppShellContext } from '@/context/AppShellContext'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { automationSelection } from '@/hooks/useEntitySelection'
import { APP_EVENTS, AGENT_EVENTS, getEventDisplayName, type AutomationListItem, type AutomationListFilter } from './types'
import { formatShortRelativeTime } from './utils'

const {
  useSelection: useAutomationSelection,
} = automationSelection


// ============================================================================
// Automation Item
// ============================================================================

interface AutomationItemProps {
  automation: AutomationListItem
  isSelected: boolean
  isInMultiSelect: boolean
  isMultiSelectActive: boolean
  isFirst: boolean
  onClick: () => void
  onToggleSelect?: () => void
  onRangeSelect?: () => void
  onDelete: () => void
  onToggleEnabled: () => void
  onTest: () => void
  onDuplicate: () => void
  onSendToWorkspace?: () => void
}

function AutomationItem({
  automation,
  isSelected,
  isInMultiSelect,
  isMultiSelectActive,
  isFirst,
  onClick,
  onToggleSelect,
  onRangeSelect,
  onDelete,
  onToggleEnabled,
  onTest,
  onDuplicate,
  onSendToWorkspace,
}: AutomationItemProps) {
  const { t } = useTranslation()
  const handleClick = useCallback((e: React.MouseEvent) => {
    if (e.button === 2) {
      // Right-click: auto-add to selection if multi-select active
      if (isMultiSelectActive && !isInMultiSelect && onToggleSelect) onToggleSelect()
      return
    }
    if ((e.metaKey || e.ctrlKey) && onToggleSelect) {
      e.preventDefault()
      onToggleSelect()
      return
    }
    if (e.shiftKey && onRangeSelect) {
      e.preventDefault()
      onRangeSelect()
      return
    }
    onClick()
  }, [isMultiSelectActive, isInMultiSelect, onToggleSelect, onRangeSelect, onClick])

  return (
    <EntityRow
      className="automation-item"
      // Disabled automations read dimmer through the solved tertiary text (AA), not a 50% opacity row
      titleClassName={!automation.enabled ? 'text-tertiary' : undefined}
      showSeparator={!isFirst}
      separatorClassName="pl-10 pr-4"
      isSelected={isSelected}
      isInMultiSelect={isInMultiSelect}
      onMouseDown={handleClick}
      icon={<AutomationAvatar event={automation.event} size="sm" className={!automation.enabled ? 'opacity-50' : undefined} />}
      title={automation.name}
      // Trigger · actions as one quiet line (it was two pills per row): the same anatomy as the session
      // and source rows, with the last run as the title line's meta.
      subtitle={[
        getEventDisplayName(automation.event),
        automation.actions.some(a => a.type === 'prompt') ? t('automations.badgePrompt') : null,
        automation.actions.some(a => a.type === 'webhook') ? t('automations.badgeWebhook') : null,
        automation.actions.some(a => a.type === 'script') ? t('automations.badgeScript') : null,
      ].filter(Boolean).join(' · ')}
      subtitleTrailing={automation.issues ? (
        // ml-auto: a status, so it sits on the row's right edge (the trailing slot is a left-filled 55% label budget)
        <Info_Badge color="destructive" className="ml-auto shrink-0">{t('automations.notRunning')}</Info_Badge>
      ) : undefined}
      titleTrailing={
        automation.lastExecutedAt ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="shrink-0 cursor-default whitespace-nowrap text-label-sm text-tertiary tabular-nums">
                {formatShortRelativeTime(automation.lastExecutedAt)}
              </span>
            </TooltipTrigger>
            <TooltipContent side="bottom" sideOffset={4}>
              {t('automations.lastRan', { time: formatShortRelativeTime(automation.lastExecutedAt) })}
            </TooltipContent>
          </Tooltip>
        ) : undefined
      }
      menuContent={
        <AutomationMenu
          automationId={automation.id}
          automationName={automation.name}
          enabled={automation.enabled}
          onToggleEnabled={onToggleEnabled}
          onTest={onTest}
          onDuplicate={onDuplicate}
          onDelete={onDelete}
          onSendToWorkspace={onSendToWorkspace}
        />
      }
      contextMenuContent={isMultiSelectActive && isInMultiSelect ? <BatchAutomationMenu /> : undefined}
    />
  )
}

// ============================================================================
// NotRunningBanner
// ============================================================================

/**
 * Shown when something in automations.json won't run. Rows that won't run carry
 * a "Not running" chip (their detail page says why); problems no row can show —
 * e.g. the file isn't valid JSON — are listed here.
 */
function NotRunningBanner({ fileIssues, hasRowIssues }: { fileIssues: string[]; hasRowIssues: boolean }) {
  const { t } = useTranslation()
  if (fileIssues.length === 0 && !hasRowIssues) return null
  return (
    <div className="px-gutter pt-2 pb-1">
      <Info_Alert variant="error" inline icon={<AlertCircle />}>
        <Info_Alert.Title>{t('automations.notRunningBannerTitle')}</Info_Alert.Title>
        <Info_Alert.Description>
          {fileIssues.map((message, i) => (
            <span key={i} className="block break-words">{message}</span>
          ))}
          <span className="block">{t('automations.notRunningBannerHint')}</span>
        </Info_Alert.Description>
      </Info_Alert>
    </div>
  )
}

// ============================================================================
// AutomationsListPanel
// ============================================================================

export interface AutomationsListPanelProps {
  automations: AutomationListItem[]
  automationFilter?: AutomationListFilter | null
  onAutomationClick: (automationId: string) => void
  onDeleteAutomation?: (automationId: string) => void
  onToggleAutomation?: (automationId: string) => void
  onTestAutomation?: (automationId: string) => void
  onDuplicateAutomation?: (automationId: string) => void
  selectedAutomationId?: string | null
  workspaceRootPath?: string
  className?: string
}

export function AutomationsListPanel({
  automations,
  automationFilter,
  onAutomationClick,
  onDeleteAutomation,
  onToggleAutomation,
  onTestAutomation,
  onDuplicateAutomation,
  selectedAutomationId,
  workspaceRootPath,
  className,
}: AutomationsListPanelProps) {
  const { t } = useTranslation()
  const [searchQuery, setSearchQuery] = useState('')
  const [searchActive, setSearchActive] = useState(false)
  const { workspaces, activeWorkspaceId } = useAppShellContext()
  const hasOtherWorkspaces = workspaces.length > 1

  // Send to Workspace dialog state
  const [sendDialogOpen, setSendDialogOpen] = useState(false)
  const [sendResourceId, setSendResourceId] = useState<string | null>(null)
  const [sendResourceLabel, setSendResourceLabel] = useState('')

  const {
    select: selectAutomation,
    toggle: toggleAutomation,
    selectRange,
    isMultiSelectActive,
    isSelected: isInSelection,
  } = useAutomationSelection()

  const fileIssues = useAtomValue(automationLoadIssuesAtom)
  const banner = <NotRunningBanner fileIssues={fileIssues} hasRowIssues={automations.some(a => a.issues)} />

  const isSearchMode = searchActive && searchQuery.length >= 2

  // Filter automations based on sidebar-driven filter (from route)
  const categoryFiltered = React.useMemo(() => {
    const kind = automationFilter?.kind ?? 'all'
    if (kind === 'all') return automations
    if (kind === 'scheduled') return automations.filter(a => a.event === 'SchedulerTick')
    if (kind === 'app') return automations.filter(a => (APP_EVENTS as string[]).includes(a.event) && a.event !== 'SchedulerTick')
    if (kind === 'agent') return automations.filter(a => (AGENT_EVENTS as string[]).includes(a.event))
    return automations
  }, [automations, automationFilter?.kind])

  // Further filter by search query (name, summary, event display name)
  const searchFiltered = React.useMemo(() => {
    if (!isSearchMode) return categoryFiltered
    const q = searchQuery.toLowerCase()
    return categoryFiltered.filter(a =>
      a.name.toLowerCase().includes(q) ||
      a.summary.toLowerCase().includes(q) ||
      getEventDisplayName(a.event).toLowerCase().includes(q)
    )
  }, [categoryFiltered, isSearchMode, searchQuery])

  // Sort: most recently executed first, never-run at the bottom
  const filteredAutomations = React.useMemo(() => {
    return [...searchFiltered].sort((a, b) => {
      if (!a.lastExecutedAt && !b.lastExecutedAt) return 0
      if (!a.lastExecutedAt) return 1
      if (!b.lastExecutedAt) return -1
      return new Date(b.lastExecutedAt).getTime() - new Date(a.lastExecutedAt).getTime()
    })
  }, [searchFiltered])

  const handleItemClick = useCallback((automationId: string, index: number) => {
    selectAutomation(automationId, index)
    onAutomationClick(automationId)
  }, [selectAutomation, onAutomationClick])

  const handleToggleSelect = useCallback((automationId: string, index: number) => {
    toggleAutomation(automationId, index)
  }, [toggleAutomation])

  const handleRangeSelect = useCallback((toIndex: number) => {
    const allIds = filteredAutomations.map(a => a.id)
    selectRange(toIndex, allIds)
  }, [filteredAutomations, selectRange])

  // Empty state
  if (automations.length === 0) {
    return (
      <div className={cn('flex flex-col flex-1 min-h-0', className)}>
        {banner}
        <EntityListEmptyScreen
          icon={<Webhook />}
          title={t('automations.noAutomationsConfigured')}
          description={t('automations.emptyDescription')}
          docKey="automations"
        >
          {workspaceRootPath && (
            <EditPopover
              align="center"
              trigger={
                <Button variant="secondary" size="md">
                  {t('automations.addAutomation')}
                </Button>
              }
              {...getEditConfig('automation-config', workspaceRootPath)}
            />
          )}
        </EntityListEmptyScreen>
      </div>
    )
  }

  return (
    <div className={cn('flex flex-col flex-1 min-h-0', className)}>
      {/* Search header */}
      {searchActive && (
        <SessionSearchHeader
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          onSearchClose={() => {
            setSearchActive(false)
            setSearchQuery('')
          }}
          placeholder={t('automations.searchPlaceholder')}
          resultCount={isSearchMode ? filteredAutomations.length : undefined}
        />
      )}

      {banner}

      {/* Filtered empty state */}
      {filteredAutomations.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-1">
          <p className="text-label text-tertiary">
            {isSearchMode ? t('automations.noAutomationsFound') : t('automations.noAutomationsConfigured')}
          </p>
          {isSearchMode && (
            <button
              onClick={() => setSearchQuery('')}
              className="rounded-xs text-label-sm text-accent hover:underline"
            >
              {t('automations.clearSearch')}
            </button>
          )}
        </div>
      ) : (
        <ScrollArea className="flex-1">
          <div className="pb-2" data-list-role="automations">
            <div className="pt-1">
              {filteredAutomations.map((automation, index) => (
                <AutomationItem
                  key={automation.id}
                  automation={automation}
                  isSelected={selectedAutomationId === automation.id}
                  isInMultiSelect={isMultiSelectActive && isInSelection(automation.id)}
                  isMultiSelectActive={isMultiSelectActive}
                  isFirst={index === 0}
                  onClick={() => handleItemClick(automation.id, index)}
                  onToggleSelect={() => handleToggleSelect(automation.id, index)}
                  onRangeSelect={() => handleRangeSelect(index)}
                  onDelete={() => onDeleteAutomation?.(automation.id)}
                  onToggleEnabled={() => onToggleAutomation?.(automation.id)}
                  onTest={() => onTestAutomation?.(automation.id)}
                  onDuplicate={() => onDuplicateAutomation?.(automation.id)}
                  onSendToWorkspace={hasOtherWorkspaces ? () => {
                    setSendResourceId(automation.id)
                    setSendResourceLabel(automation.name)
                    setSendDialogOpen(true)
                  } : undefined}
                />
              ))}
            </div>
          </div>
        </ScrollArea>
      )}

      {/* Send to Workspace dialog */}
      {sendResourceId && (
        <SendResourceToWorkspaceDialog
          open={sendDialogOpen}
          onOpenChange={setSendDialogOpen}
          resourceType="automation"
          resourceIds={[sendResourceId]}
          resourceLabel={sendResourceLabel}
          workspaces={workspaces}
          activeWorkspaceId={activeWorkspaceId}
        />
      )}
    </div>
  )
}
