import * as React from 'react'
import { Zap } from 'lucide-react'
import { SkillAvatar } from '@/components/ui/skill-avatar'
import { EntityPanel } from '@/components/ui/entity-panel'
import { EntityListEmptyScreen } from '@/components/ui/entity-list-empty'
import { skillSelection } from '@/hooks/useEntitySelection'
import { SkillMenu } from './SkillMenu'
import { EditPopover, getEditConfig } from '@/components/ui/EditPopover'
import { useAppShellContext } from '@/context/AppShellContext'
import { toast } from 'sonner'
import type { LoadedSkill } from '../../../shared/types'

export interface SkillsListPanelProps {
  skills: LoadedSkill[]
  onDeleteSkill: (skillSlug: string) => void
  onSkillClick: (skill: LoadedSkill) => void
  selectedSkillSlug?: string | null
  workspaceId?: string
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
  const { workspaces } = useAppShellContext()
  const currentWorkspace = workspaces.find(workspace => workspace.id === workspaceId) ?? null
  const canRevealPaths = !currentWorkspace?.isRemote
  const shareDestinations = workspaces
    .filter(workspace => workspace.id !== workspaceId)
    .map(workspace => ({
      key: workspace.id,
      label: workspace.name,
      description: workspace.isRemote ? `${workspace.remoteServerName || 'Remote server'}` : 'This device',
    }))

  return (
    <EntityPanel<LoadedSkill>
      items={skills}
      getId={(s) => s.slug}
      selection={skillSelection}
      selectedId={selectedSkillSlug}
      onItemClick={onSkillClick}
      className={className}
      emptyState={
        <EntityListEmptyScreen
          icon={<Zap />}
          title="No skills configured"
          description="Skills are reusable instructions that teach your agent specialized behaviors."
          docKey="skills"
        >
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
        </EntityListEmptyScreen>
      }
      mapItem={(skill) => ({
        icon: <SkillAvatar skill={skill} size="sm" workspaceId={workspaceId} />,
        title: skill.metadata.name,
        badges: <span className="truncate">{skill.metadata.description}</span>,
        menu: (
          <SkillMenu
            skillSlug={skill.slug}
            skillName={skill.metadata.name}
            onOpenInNewWindow={() => window.electronAPI.openUrl(`craftagents://skills/skill/${skill.slug}?window=focused`)}
            onShowInFinder={canRevealPaths ? () => { if (workspaceId) window.electronAPI.openSkillInFinder(workspaceId, skill.slug) } : undefined}
            shareDestinations={skill.source === 'workspace' ? shareDestinations : []}
            onShare={skill.source === 'workspace' && workspaceId ? async (destinationWorkspaceId) => {
              const result = await window.electronAPI.shareSkillToWorkspace(workspaceId, skill.slug, destinationWorkspaceId)
              if (!result.success) {
                toast.error('Failed to share skill', {
                  description: result.error || 'Unknown error',
                })
                return
              }
              toast.success('Skill shared')
            } : undefined}
            onDelete={() => onDeleteSkill(skill.slug)}
          />
        ),
      })}
    />
  )
}
