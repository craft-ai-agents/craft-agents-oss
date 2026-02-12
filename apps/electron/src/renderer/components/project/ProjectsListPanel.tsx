/**
 * ProjectsListPanel
 *
 * Panel component for displaying workspace projects in the sidebar navigator.
 * Shows project name, description, session count, and file count.
 */

import * as React from 'react'
import { Briefcase, Plus, Trash2 } from 'lucide-react'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle, EmptyDescription, EmptyContent } from '@/components/ui/empty'
import { Separator } from '@/components/ui/separator'
import { cn } from '@/lib/utils'
import type { ProjectSummary } from '../../../shared/types'

export interface ProjectsListPanelProps {
  projects: ProjectSummary[]
  workspaceId: string
  onProjectClick: (projectSlug: string) => void
  onNewProject: () => void
  onDeleteProject: (projectSlug: string) => void
  selectedProjectSlug?: string | null
  className?: string
}

export function ProjectsListPanel({
  projects,
  workspaceId,
  onProjectClick,
  onNewProject,
  onDeleteProject,
  selectedProjectSlug,
  className,
}: ProjectsListPanelProps) {
  // Empty state
  if (projects.length === 0) {
    return (
      <div className={cn('flex flex-col flex-1', className)}>
        <Empty className="flex-1">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Briefcase />
            </EmptyMedia>
            <EmptyTitle>No projects yet</EmptyTitle>
            <EmptyDescription>
              Create a project to organize your conversations and files around a specific goal.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <button
              onClick={onNewProject}
              className="inline-flex items-center gap-1.5 h-7 px-3 text-xs font-medium rounded-[8px] bg-foreground/[0.02] shadow-minimal hover:bg-foreground/[0.05] transition-colors"
            >
              <Plus className="h-3 w-3" />
              New Project
            </button>
          </EmptyContent>
        </Empty>
      </div>
    )
  }

  return (
    <div className={cn('flex flex-col flex-1 min-h-0', className)}>
      {/* New project button */}
      <div className="px-3 pt-2 pb-1">
        <button
          onClick={onNewProject}
          className="flex items-center gap-1.5 w-full h-7 px-2 text-xs font-medium text-muted-foreground hover:text-foreground rounded-[6px] hover:bg-foreground/5 transition-colors"
        >
          <Plus className="h-3 w-3" />
          New Project
        </button>
      </div>
      <ScrollArea className="flex-1">
        <div className="pb-2">
          <div className="pt-1">
            {projects.map((project, index) => (
              <ProjectItem
                key={project.id}
                project={project}
                isSelected={selectedProjectSlug === project.slug}
                isFirst={index === 0}
                onClick={() => onProjectClick(project.slug)}
                onDelete={() => onDeleteProject(project.slug)}
              />
            ))}
          </div>
        </div>
      </ScrollArea>
    </div>
  )
}

interface ProjectItemProps {
  project: ProjectSummary
  isSelected: boolean
  isFirst: boolean
  onClick: () => void
  onDelete: () => void
}

function ProjectItem({ project, isSelected, isFirst, onClick, onDelete }: ProjectItemProps) {
  return (
    <div className="project-item" data-selected={isSelected || undefined}>
      {!isFirst && (
        <div className="project-separator pl-12 pr-4">
          <Separator />
        </div>
      )}
      <div className="project-content relative group select-none pl-2 mr-2">
        {/* Project icon */}
        <div className="absolute left-[18px] top-3.5 z-10 flex items-center justify-center">
          <div className="w-5 h-5 rounded-[4px] bg-foreground/5 flex items-center justify-center">
            <Briefcase className="h-3 w-3 text-muted-foreground" />
          </div>
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
          {/* Spacer for icon */}
          <div className="w-5 h-5 shrink-0" />
          {/* Content column */}
          <div className="flex flex-col gap-1 min-w-0 flex-1">
            <div className="flex items-start gap-2 w-full pr-6 min-w-0">
              <div className="font-medium font-sans line-clamp-2 min-w-0 -mb-[2px]">
                {project.name}
              </div>
            </div>
            {project.description && (
              <div className="flex items-center gap-1.5 text-xs text-foreground/70 w-full -mb-[2px] pr-6 min-w-0">
                <span className="truncate">{project.description}</span>
              </div>
            )}
            <div className="flex items-center gap-3 text-xs text-foreground/50">
              <span>{project.sessionCount} chats</span>
              <span>{project.fileCount} files</span>
            </div>
          </div>
        </button>
        {/* Delete button - visible on hover */}
        <div className="absolute right-2 top-2 transition-opacity z-10 opacity-0 group-hover:opacity-100">
          <button
            onClick={(e) => {
              e.stopPropagation()
              onDelete()
            }}
            className="p-1.5 rounded-[6px] hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
            title="Delete project"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  )
}
