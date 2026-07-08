import * as React from 'react'
import { Check } from 'lucide-react'
import { FilterableSelectPopover } from '@craft-agent/ui'

import { cn } from '@/lib/utils'
import { SkillAvatar } from '@/components/ui/skill-avatar'
import type { LoadedSkill } from '../../../shared/types'

export interface SkillSelectorPopoverProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  anchorRef: React.RefObject<HTMLButtonElement | null>
  skills: LoadedSkill[]
  selectedSlugs: string[]
  onToggleSlug: (slug: string) => void
  /** Workspace id — resolves local skill icons via SkillAvatar. */
  workspaceId?: string
}

/**
 * SkillSelectorPopover — skill multi-select mirroring {@link SourceSelectorPopover}.
 *
 * Same FilterableSelectPopover chrome (filter box, avatar rows, trailing check
 * circle) so the sources and skills pickers stay visually identical; only the
 * avatar (SkillAvatar vs SourceAvatar) and the resolved key/label differ.
 */
export function SkillSelectorPopover({
  open,
  onOpenChange,
  anchorRef,
  skills,
  selectedSlugs,
  onToggleSlug,
  workspaceId,
}: SkillSelectorPopoverProps) {
  return (
    <FilterableSelectPopover
      open={open}
      onOpenChange={onOpenChange}
      anchorRef={anchorRef}
      items={skills}
      getKey={(skill) => skill.slug}
      getLabel={(skill) => skill.metadata.name}
      isSelected={(skill) => selectedSlugs.includes(skill.slug)}
      onToggle={(skill) => onToggleSlug(skill.slug)}
      filterPlaceholder="Search skills..."
      emptyState={(
        <>
          No skills configured.
          <br />
          Add skills in Settings.
        </>
      )}
      noResultsState="No matching skills."
      minWidth={200}
      maxWidth={320}
      renderItem={(skill, state) => (
        <div
          className={cn(
            'flex cursor-pointer select-none items-center gap-3 rounded-[6px] px-3 py-2 text-[13px]',
            state.highlighted && 'bg-foreground/5',
            state.selected && 'bg-foreground/3',
          )}
        >
          <div className="shrink-0 text-muted-foreground flex items-center">
            <SkillAvatar skill={skill} size="sm" workspaceId={workspaceId} />
          </div>
          <div className="flex-1 min-w-0 truncate">{skill.metadata.name}</div>
          <div
            className={cn(
              'shrink-0 h-4 w-4 rounded-full bg-current flex items-center justify-center',
              !state.selected && 'opacity-0',
            )}
          >
            <Check className="h-2.5 w-2.5 text-white dark:text-black" strokeWidth={3} />
          </div>
        </div>
      )}
    />
  )
}
