/**
 * SkillsListPanel
 *
 * Panel component for displaying workspace skills in the sidebar.
 * Styled to match SourcesListPanel with avatar, title, and subtitle layout.
 */

import * as React from 'react'
import { useState } from 'react'
import { MoreHorizontal, Zap } from 'lucide-react'
import { SkillAvatar } from '@/components/ui/skill-avatar'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle, EmptyDescription, EmptyContent } from '@/components/ui/empty'
import { getDocUrl } from '@craft-agent/shared/docs/doc-links'
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
import { SkillMenu } from './SkillMenu'
import { EditPopover, getEditConfig } from '@/components/ui/EditPopover'
import { cn } from '@/lib/utils'
import type { LoadedSkill } from '../../../shared/types'

export interface SkillsListPanelProps {
  skills: LoadedSkill[]
  onDeleteSkill: (skillSlug: string) => void
  onSkillClick: (skill: LoadedSkill) => void
  selectedSkillSlug?: string | null
  workspaceId?: string
  /** Workspace root path for EditPopover context */
  workspaceRootPath?: string
  className?: string
}

export function SkillsListPanel({
  skills,
  onDeleteSkill,
  onSkillClick,
  selectedSkillSlug,
  workspaceId,
  workspaceRootPath,
  className,
}: SkillsListPanelProps) {
  // Empty state - rendered outside ScrollArea for proper vertical centering
  if (skills.length === 0) {
    return (
      <div className={cn('flex flex-col flex-1', className)}>
        <Empty className="flex-1">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Zap />
            </EmptyMedia>
            <EmptyTitle>No skills configured</EmptyTitle>
            <EmptyDescription>
              Skills are reusable instructions that teach your agent specialized behaviors.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <button
              onClick={() => window.electronAPI.openUrl(getDocUrl('skills'))}
              className="inline-flex items-center h-7 px-3 text-xs font-medium rounded-[8px] bg-foreground/[0.02] shadow-minimal hover:bg-foreground/[0.05] transition-colors"
            >
              Learn more
            </button>
            {workspaceRootPath && (
              <EditPopover
                align="center"
                trigger={
                  <button className="inline-flex items-center h-7 px-3 text-xs font-medium rounded-[8px] bg-background shadow-minimal hover:bg-foreground/[0.03] transition-colors">
                    Add Skill
                  </button>
                }
                {...getEditConfig('add-skill', workspaceRootPath)}
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
            {skills.map((skill, index) => (
              <SkillItem
                key={skill.slug}
                skill={skill}
                isSelected={selectedSkillSlug === skill.slug}
                isFirst={index === 0}
                workspaceId={workspaceId}
                onClick={() => onSkillClick(skill)}
                onDelete={() => onDeleteSkill(skill.slug)}
              />
            ))}
          </div>
        </div>
      </ScrollArea>
    </div>
  )
}

interface SkillItemProps {
  skill: LoadedSkill
  isSelected: boolean
  isFirst: boolean
  workspaceId?: string
  onClick: () => void
  onDelete: () => void
}

function SkillItem({ skill, isSelected, isFirst, workspaceId, onClick, onDelete }: SkillItemProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [contextMenuOpen, setContextMenuOpen] = useState(false)

  return (
    <div className="skill-item" data-selected={isSelected || undefined}>
      {/* Separator - only show if not first */}
      {!isFirst && (
        <div className="skill-separator pl-12 pr-4">
          <Separator />
        </div>
      )}
      {/* Wrapper for button + dropdown + context menu, group for hover state */}
      <ContextMenu modal={true} onOpenChange={setContextMenuOpen}>
        <ContextMenuTrigger asChild>
          <div className="skill-content relative group select-none pl-2 mr-2">
        {/* Skill Avatar - positioned absolutely */}
        <div className="absolute left-[18px] top-3.5 z-10 flex items-center justify-center">
          <SkillAvatar skill={skill} size="sm" workspaceId={workspaceId} />
        </div>
        {/* Main content button */}
        <button
          className={cn(
            "flex w-full items-start gap-2 pl-2 pr-4 py-3 text-left text-sm transition-all outline-none rounded-[8px]",
            isSelected
              ? "bg-foreground/5 hover:bg-foreground/7"
              : "hover:bg-foreground/2"
          )}
          onClick={onClick}
        >
          {/* Spacer for avatar */}
          <div className="w-5 h-5 shrink-0" />
          {/* Content column */}
          <div className="flex flex-col gap-1 min-w-0 flex-1">
            {/* Title - skill name */}
            <div className="flex items-start gap-2 w-full pr-6 min-w-0">
              <div className="font-medium font-sans line-clamp-2 min-w-0 -mb-[2px]">
                {skill.metadata.name}
              </div>
            </div>
            {/* Subtitle - description */}
            <div className="flex items-center gap-1.5 text-xs text-foreground/70 w-full -mb-[2px] pr-6 min-w-0">
              <span className="truncate">
                {skill.metadata.description}
              </span>
            </div>
          </div>
        </button>
        {/* Action buttons - visible on hover or when menu is open */}
        <div
          className={cn(
            "absolute right-2 top-2 transition-opacity z-10",
            menuOpen || contextMenuOpen ? "opacity-100" : "opacity-0 group-hover:opacity-100"
          )}
        >
          {/* More menu */}
          <div className="flex items-center rounded-[8px] overflow-hidden border border-transparent hover:border-border/50">
            <DropdownMenu modal={true} onOpenChange={setMenuOpen}>
              <DropdownMenuTrigger asChild>
                <div className="p-1.5 hover:bg-foreground/10 data-[state=open]:bg-foreground/10 cursor-pointer">
                  <MoreHorizontal className="h-4 w-4 text-muted-foreground" />
                </div>
              </DropdownMenuTrigger>
              <StyledDropdownMenuContent align="end">
                <DropdownMenuProvider>
                  <SkillMenu
                    skillSlug={skill.slug}
                    skillName={skill.metadata.name}
                    onOpenInNewWindow={() => {
                      window.electronAPI.openUrl(`bunnyagents://skills/skill/${skill.slug}?window=focused`)
                    }}
                    onShowInFinder={() => {
                      if (workspaceId) {
                        window.electronAPI.openSkillInFinder(workspaceId, skill.slug)
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
        {/* Context menu - same content as dropdown */}
        <StyledContextMenuContent>
          <ContextMenuProvider>
            <SkillMenu
              skillSlug={skill.slug}
              skillName={skill.metadata.name}
              onOpenInNewWindow={() => {
                window.electronAPI.openUrl(`bunnyagents://skills/skill/${skill.slug}?window=focused`)
              }}
              onShowInFinder={() => {
                if (workspaceId) {
                  window.electronAPI.openSkillInFinder(workspaceId, skill.slug)
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
