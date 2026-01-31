/**
 * LabProjectListPanel
 *
 * Displays the list of Lab projects in the navigator panel.
 * Follows the same pattern as SourcesListPanel and SkillsListPanel.
 */

import { useState, useCallback } from 'react'
import { FlaskConical, Plus, MoreHorizontal, Trash2, FolderOpen } from 'lucide-react'
import { cn } from '@/lib/utils'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle, EmptyDescription, EmptyContent } from '@/components/ui/empty'
import { Separator } from '@/components/ui/separator'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  StyledDropdownMenuContent,
  StyledDropdownMenuItem,
  StyledDropdownMenuSeparator,
} from '@/components/ui/styled-dropdown'
import {
  ContextMenu,
  ContextMenuTrigger,
  StyledContextMenuContent,
} from '@/components/ui/styled-context-menu'
import { DropdownMenuProvider, ContextMenuProvider } from '@/components/ui/menu-context'
import type { LabProject } from '@craft-agent/shared/lab/types'

interface LabProjectListPanelProps {
  projects: LabProject[]
  selectedProjectId?: string | null
  onProjectClick: (project: LabProject) => void
  onCreateProject: () => void
  onDeleteProject: (projectId: string) => void
}

export function LabProjectListPanel({
  projects,
  selectedProjectId,
  onProjectClick,
  onCreateProject,
  onDeleteProject,
}: LabProjectListPanelProps) {
  // Empty state
  if (projects.length === 0) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyMedia>
            <FlaskConical className="h-10 w-10 text-muted-foreground/50" />
          </EmptyMedia>
          <EmptyTitle>No projects yet</EmptyTitle>
          <EmptyDescription>
            Create a Lab project to orchestrate multi-agent teams
            with specialized personas.
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button size="sm" onClick={onCreateProject}>
            <Plus className="h-3.5 w-3.5 mr-1.5" />
            New Project
          </Button>
        </EmptyContent>
      </Empty>
    )
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border/50">
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          Projects
        </span>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 w-6 p-0"
          onClick={onCreateProject}
        >
          <Plus className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* Project list */}
      <ScrollArea className="flex-1">
        <div className="py-1">
          {projects.map((project, index) => (
            <ProjectItem
              key={project.id}
              project={project}
              isSelected={selectedProjectId === project.id}
              showSeparator={index > 0}
              onClick={() => onProjectClick(project)}
              onDelete={() => onDeleteProject(project.id)}
            />
          ))}
        </div>
      </ScrollArea>
    </div>
  )
}

// ============================================================
// Project Item
// ============================================================

interface ProjectItemProps {
  project: LabProject
  isSelected: boolean
  showSeparator: boolean
  onClick: () => void
  onDelete: () => void
}

function ProjectItem({
  project,
  isSelected,
  showSeparator,
  onClick,
  onDelete,
}: ProjectItemProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [contextMenuOpen, setContextMenuOpen] = useState(false)

  const menuContent = (
    <>
      <StyledDropdownMenuItem
        onClick={(e) => {
          e.stopPropagation()
          onDelete()
        }}
        className="text-destructive"
      >
        <Trash2 className="h-3.5 w-3.5 mr-2" />
        Delete Project
      </StyledDropdownMenuItem>
    </>
  )

  return (
    <ContextMenuProvider isOpen={contextMenuOpen}>
      <ContextMenu onOpenChange={setContextMenuOpen}>
        <ContextMenuTrigger asChild>
          <div
            role="button"
            tabIndex={0}
            className={cn(
              'group relative flex items-start gap-3 px-3 py-2.5 cursor-pointer transition-colors',
              isSelected
                ? 'bg-foreground/5 hover:bg-foreground/7'
                : 'hover:bg-foreground/2',
            )}
            onClick={onClick}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                onClick()
              }
            }}
          >
            {showSeparator && (
              <Separator className="absolute top-0 left-3 right-3" />
            )}

            {/* Project icon */}
            <div className="shrink-0 mt-0.5 h-8 w-8 rounded-md bg-accent/10 flex items-center justify-center">
              <FlaskConical className="h-4 w-4 text-accent" />
            </div>

            {/* Content */}
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium truncate">
                {project.name}
              </div>
              <div className="text-xs text-muted-foreground truncate mt-0.5">
                {project.description || 'No description'}
              </div>
              {project.personaIds.length > 0 && (
                <div className="text-[10px] text-muted-foreground/70 mt-1">
                  {project.personaIds.length} persona{project.personaIds.length !== 1 ? 's' : ''}
                  {project.goals.length > 0 && ` · ${project.goals.length} goal${project.goals.length !== 1 ? 's' : ''}`}
                </div>
              )}
            </div>

            {/* More button */}
            <DropdownMenuProvider isOpen={menuOpen}>
              <DropdownMenu onOpenChange={setMenuOpen}>
                <DropdownMenuTrigger asChild>
                  <button
                    className={cn(
                      'shrink-0 h-6 w-6 rounded-md flex items-center justify-center transition-opacity',
                      menuOpen
                        ? 'opacity-100 bg-foreground/5'
                        : 'opacity-0 group-hover:opacity-100 hover:bg-foreground/5',
                    )}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <MoreHorizontal className="h-3.5 w-3.5 text-muted-foreground" />
                  </button>
                </DropdownMenuTrigger>
                <StyledDropdownMenuContent align="end">
                  {menuContent}
                </StyledDropdownMenuContent>
              </DropdownMenu>
            </DropdownMenuProvider>
          </div>
        </ContextMenuTrigger>
        <StyledContextMenuContent>
          {menuContent}
        </StyledContextMenuContent>
      </ContextMenu>
    </ContextMenuProvider>
  )
}
