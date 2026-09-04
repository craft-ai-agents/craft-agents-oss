import * as React from 'react'
import { Archive, Check, ChevronDown, Flag, Tag } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import type { LabelTreeNode } from '@craft-agent/shared/labels'
import type { SessionStatus } from '@/config/session-status-config'
import { LabelIcon } from '@/components/ui/label-icon'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuSub,
  StyledDropdownMenuContent,
  StyledDropdownMenuItem,
  StyledDropdownMenuSubContent,
  StyledDropdownMenuSubTrigger,
} from '@/components/ui/styled-dropdown'
import { cn } from '@/lib/utils'

interface SessionSidebarFiltersProps {
  statuses: SessionStatus[]
  activeStatusId: string | null
  flagged: boolean
  labelTree: LabelTreeNode[]
  selectedLabelIds: ReadonlySet<string>
  showFlagged?: boolean
  onSelectStatus: (statusId: string | null) => void
  onToggleFlagged: () => void
  onToggleLabel: (labelId: string) => void
}

export function SessionSidebarFilters({
  statuses,
  activeStatusId,
  flagged,
  labelTree,
  selectedLabelIds,
  showFlagged = true,
  onSelectStatus,
  onToggleFlagged,
  onToggleLabel,
}: SessionSidebarFiltersProps) {
  const { t } = useTranslation()
  const activeStatus = statuses.find(status => status.id === activeStatusId)

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className={cn(
              'flex h-6 max-w-20 items-center gap-0.5 rounded-md px-1.5 text-[11px] text-foreground/50 hover:bg-foreground/[0.05] hover:text-foreground',
              activeStatusId && 'bg-accent/5 text-accent',
            )}
          >
            <span className="truncate">{activeStatus ? t(`status.${activeStatus.id}`, activeStatus.label) : t('sidebar.all')}</span>
            <ChevronDown className="h-3 w-3 shrink-0" />
          </button>
        </DropdownMenuTrigger>
        <StyledDropdownMenuContent align="end" minWidth="min-w-44">
          <StyledDropdownMenuItem onSelect={() => onSelectStatus(null)}>
            <span className="h-3.5 w-3.5" />
            <span className="flex-1">{t('sidebar.all')}</span>
            {!activeStatusId && <Check className="h-3.5 w-3.5" />}
          </StyledDropdownMenuItem>
          {statuses.map(status => (
            <StyledDropdownMenuItem key={status.id} onSelect={() => onSelectStatus(status.id)}>
              <span style={status.iconColorable ? { color: status.resolvedColor } : undefined}>{status.icon}</span>
              <span className="flex-1">{t(`status.${status.id}`, status.label)}</span>
              {activeStatusId === status.id && <Check className="h-3.5 w-3.5" />}
            </StyledDropdownMenuItem>
          ))}
          <StyledDropdownMenuItem onSelect={() => onSelectStatus('archived')}>
            <Archive className="h-3.5 w-3.5" />
            <span className="flex-1">{t('sidebar.archived')}</span>
            {activeStatusId === 'archived' && <Check className="h-3.5 w-3.5" />}
          </StyledDropdownMenuItem>
        </StyledDropdownMenuContent>
      </DropdownMenu>

      {showFlagged && (
        <button
          type="button"
          onClick={onToggleFlagged}
          className={cn(
            'flex h-6 w-6 items-center justify-center rounded-md text-foreground/40 hover:bg-foreground/[0.05] hover:text-foreground',
            flagged && 'bg-accent/5 text-accent',
          )}
          aria-label={t('sidebar.flagged')}
          title={t('sidebar.flagged')}
        >
          <Flag className={cn('h-3.5 w-3.5', flagged && 'fill-current')} />
        </button>
      )}

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className={cn(
              'relative flex h-6 w-6 items-center justify-center rounded-md text-foreground/40 hover:bg-foreground/[0.05] hover:text-foreground',
              selectedLabelIds.size > 0 && 'bg-accent/5 text-accent',
            )}
            aria-label={t('sidebar.labels')}
            title={t('sidebar.labels')}
          >
            <Tag className="h-3.5 w-3.5" />
          </button>
        </DropdownMenuTrigger>
        <StyledDropdownMenuContent align="end" minWidth="min-w-52">
          {labelTree.length === 0 ? (
            <StyledDropdownMenuItem disabled>{t('rightDock.noLabels')}</StyledDropdownMenuItem>
          ) : (
            <LabelTreeItems nodes={labelTree} selected={selectedLabelIds} onToggle={onToggleLabel} />
          )}
        </StyledDropdownMenuContent>
      </DropdownMenu>
    </>
  )
}

function LabelTreeItems({
  nodes,
  selected,
  onToggle,
}: {
  nodes: LabelTreeNode[]
  selected: ReadonlySet<string>
  onToggle: (id: string) => void
}) {
  return nodes.map(node => {
    const row = (
      <>
        <LabelIcon label={node.label} size="lg" />
        <span className="flex-1 truncate">{node.label.name}</span>
        {selected.has(node.fullId) && <Check className="h-3.5 w-3.5" />}
      </>
    )

    if (node.children.length === 0) {
      return (
        <StyledDropdownMenuItem key={node.fullId} onSelect={event => { event.preventDefault(); onToggle(node.fullId) }}>
          {row}
        </StyledDropdownMenuItem>
      )
    }

    return (
      <DropdownMenuSub key={node.fullId}>
        <StyledDropdownMenuSubTrigger onClick={event => { event.preventDefault(); onToggle(node.fullId) }}>
          {row}
        </StyledDropdownMenuSubTrigger>
        <StyledDropdownMenuSubContent minWidth="min-w-52">
          <LabelTreeItems nodes={node.children} selected={selected} onToggle={onToggle} />
        </StyledDropdownMenuSubContent>
      </DropdownMenuSub>
    )
  })
}
