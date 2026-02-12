/**
 * WorkflowsListPanel
 *
 * Panel component for displaying workspace workflows in the sidebar.
 * Styled to match SkillsListPanel with avatar, title, and subtitle layout.
 */

import * as React from 'react'
import { useState } from 'react'
import { MoreHorizontal, Workflow } from 'lucide-react'
import { WorkflowAvatar } from '@/components/ui/workflow-avatar'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle, EmptyDescription, EmptyContent } from '@/components/ui/empty'
import { Separator } from '@/components/ui/separator'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  StyledDropdownMenuContent,
} from '@/components/ui/styled-dropdown'
import {
  ContextMenu,
  ContextMenuTrigger,
  StyledContextMenuContent,
} from '@/components/ui/styled-context-menu'
import { DropdownMenuProvider, ContextMenuProvider } from '@/components/ui/menu-context'
import { WorkflowMenu } from './WorkflowMenu'
import { EditPopover, getEditConfig } from '@/components/ui/EditPopover'
import { cn } from '@/lib/utils'
import type { LoadedWorkflow } from '../../../shared/types'

export interface WorkflowsListPanelProps {
  workflows: LoadedWorkflow[]
  onDeleteWorkflow: (workflowSlug: string) => void
  onWorkflowClick: (workflow: LoadedWorkflow) => void
  selectedWorkflowSlug?: string | null
  workspaceId?: string
  /** Workspace root path for EditPopover context */
  workspaceRootPath?: string
  className?: string
}

export function WorkflowsListPanel({
  workflows,
  onDeleteWorkflow,
  onWorkflowClick,
  selectedWorkflowSlug,
  workspaceId,
  workspaceRootPath,
  className,
}: WorkflowsListPanelProps) {
  // Empty state
  if (workflows.length === 0) {
    return (
      <div className={cn('flex flex-col flex-1', className)}>
        <Empty className="flex-1">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Workflow />
            </EmptyMedia>
            <EmptyTitle>No workflows configured</EmptyTitle>
            <EmptyDescription>
              Workflows are reusable instruction sets you invoke via /slug in the chat.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            {workspaceRootPath && (
              <EditPopover
                align="center"
                trigger={
                  <button className="inline-flex items-center h-7 px-3 text-xs font-medium rounded-[8px] bg-background shadow-minimal hover:bg-foreground/[0.03] transition-colors">
                    Add Workflow
                  </button>
                }
                {...getEditConfig('add-workflow', workspaceRootPath)}
              />
            )}
          </EmptyContent>
        </Empty>
      </div>
    )
  }

  return (
    <div className={cn('flex flex-col flex-1 min-h-0', className)}>
      <ScrollArea className="flex-1">
        <div className="pb-2">
          <div className="pt-2">
            {workflows.map((workflow, index) => (
              <WorkflowItem
                key={workflow.slug}
                workflow={workflow}
                isSelected={selectedWorkflowSlug === workflow.slug}
                isFirst={index === 0}
                workspaceId={workspaceId}
                onClick={() => onWorkflowClick(workflow)}
                onDelete={() => onDeleteWorkflow(workflow.slug)}
              />
            ))}
          </div>
        </div>
      </ScrollArea>
    </div>
  )
}

interface WorkflowItemProps {
  workflow: LoadedWorkflow
  isSelected: boolean
  isFirst: boolean
  workspaceId?: string
  onClick: () => void
  onDelete: () => void
}

function WorkflowItem({ workflow, isSelected, isFirst, workspaceId, onClick, onDelete }: WorkflowItemProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [contextMenuOpen, setContextMenuOpen] = useState(false)

  return (
    <div className="workflow-item" data-selected={isSelected || undefined}>
      {!isFirst && (
        <div className="workflow-separator pl-12 pr-4">
          <Separator />
        </div>
      )}
      <ContextMenu modal={true} onOpenChange={setContextMenuOpen}>
        <ContextMenuTrigger asChild>
          <div className="workflow-content relative group select-none pl-2 mr-2">
        <div className="absolute left-[18px] top-3.5 z-10 flex items-center justify-center">
          <WorkflowAvatar workflow={workflow} size="sm" workspaceId={workspaceId} />
        </div>
        <button
          className={cn(
            "flex w-full items-start gap-2 pl-2 pr-4 py-3 text-left text-sm transition-all outline-none rounded-[8px]",
            isSelected
              ? "bg-foreground/5 hover:bg-foreground/7"
              : "hover:bg-foreground/2"
          )}
          onClick={onClick}
        >
          <div className="w-5 h-5 shrink-0" />
          <div className="flex flex-col gap-1 min-w-0 flex-1">
            <div className="flex items-start gap-2 w-full pr-6 min-w-0">
              <div className="font-medium font-sans line-clamp-2 min-w-0 -mb-[2px]">
                {workflow.metadata.name}
              </div>
            </div>
            <div className="flex items-center gap-1.5 text-xs text-foreground/70 w-full -mb-[2px] pr-6 min-w-0">
              <span className="truncate">
                {workflow.metadata.description}
              </span>
            </div>
          </div>
        </button>
        <div
          className={cn(
            "absolute right-2 top-2 transition-opacity z-10",
            menuOpen || contextMenuOpen ? "opacity-100" : "opacity-0 group-hover:opacity-100"
          )}
        >
          <div className="flex items-center rounded-[8px] overflow-hidden border border-transparent hover:border-border/50">
            <DropdownMenu modal={true} onOpenChange={setMenuOpen}>
              <DropdownMenuTrigger asChild>
                <div className="p-1.5 hover:bg-foreground/10 data-[state=open]:bg-foreground/10 cursor-pointer">
                  <MoreHorizontal className="h-4 w-4 text-muted-foreground" />
                </div>
              </DropdownMenuTrigger>
              <StyledDropdownMenuContent align="end">
                <DropdownMenuProvider>
                  <WorkflowMenu
                    workflowSlug={workflow.slug}
                    workflowName={workflow.metadata.name}
                    onOpenInNewWindow={() => {
                      window.electronAPI.openUrl(`g4os://workflows/workflow/${workflow.slug}?window=focused`)
                    }}
                    onShowInFinder={() => {
                      if (workspaceId) {
                        window.electronAPI.openWorkflowInFinder(workspaceId, workflow.slug)
                      }
                    }}
                    onDelete={onDelete}
                  />
                </DropdownMenuProvider>
              </StyledDropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
          </div>
        </ContextMenuTrigger>
        <StyledContextMenuContent>
          <ContextMenuProvider>
            <WorkflowMenu
              workflowSlug={workflow.slug}
              workflowName={workflow.metadata.name}
              onOpenInNewWindow={() => {
                window.electronAPI.openUrl(`g4os://workflows/workflow/${workflow.slug}?window=focused`)
              }}
              onShowInFinder={() => {
                if (workspaceId) {
                  window.electronAPI.openWorkflowInFinder(workspaceId, workflow.slug)
                }
              }}
              onDelete={onDelete}
            />
          </ContextMenuProvider>
        </StyledContextMenuContent>
      </ContextMenu>
    </div>
  )
}
