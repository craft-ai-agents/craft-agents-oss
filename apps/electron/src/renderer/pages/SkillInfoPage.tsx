/**
 * SkillInfoPage
 *
 * Displays comprehensive skill details including metadata,
 * permission modes, and instructions.
 * Uses the Info_ component system for consistent styling with SourceInfoPage.
 */

import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { useEffect, useState, useCallback } from 'react'
import { Check, X, Minus } from 'lucide-react'
import { EditPopover, EditButton, getEditConfig } from '@/components/ui/EditPopover'
import { toast } from 'sonner'
import { SkillMenu } from '@/components/app-shell/SkillMenu'
import { LocalSkillMarketplaceStatus } from '@/components/app-shell/SkillMarketplacePage'
import { SkillAvatar } from '@/components/ui/skill-avatar'
import { routes, navigate } from '@/lib/navigate'
import { useActiveWorkspace } from '@/context/AppShellContext'
import {
  PRODUCT_MARKETPLACE_CATEGORIES,
  suggestMarketplaceSlug,
  type MarketplacePublishLocalResult,
} from '@craft-agent/shared/skills'
import {
  Info_Page,
  Info_Section,
  Info_Table,
  Info_Markdown,
} from '@/components/info'
import type { LoadedSkill } from '../../shared/types'

interface SkillInfoPageProps {
  skillSlug: string
  workspaceId: string
  workingDirectory?: string
  currentUserId?: string | null
}

export default function SkillInfoPage({ skillSlug, workspaceId, workingDirectory, currentUserId = workspaceId ? 'local-marketplace-user' : null }: SkillInfoPageProps) {
  const { t } = useTranslation()
  const [skill, setSkill] = useState<LoadedSkill | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [publishDialogOpen, setPublishDialogOpen] = useState(false)
  const [marketplaceSlug, setMarketplaceSlug] = useState('')
  const [version, setVersion] = useState('1.0.0')
  const [category, setCategory] = useState<string>(PRODUCT_MARKETPLACE_CATEGORIES[0])
  const [tags, setTags] = useState('')
  const [releaseNotes, setReleaseNotes] = useState('')
  const [publishState, setPublishState] = useState<MarketplacePublishLocalResult | { status: 'idle' | 'publishing' }>({ status: 'idle' })
  const activeWorkspace = useActiveWorkspace()
  const canRevealLocally = !activeWorkspace?.remoteServer

  // Load skill data
  useEffect(() => {
    let isMounted = true
    setLoading(true)
    setError(null)

    const loadSkill = async () => {
      try {
        const skills = await window.electronAPI.getSkills(workspaceId, workingDirectory)

        if (!isMounted) return

        // Find the skill by slug
        const found = skills.find((s) => s.slug === skillSlug)
        if (found) {
          setSkill(found)
          setMarketplaceSlug(suggestMarketplaceSlug(found.metadata))
        } else {
          setError(t('skillInfo.notFound'))
        }
      } catch (err) {
        if (!isMounted) return
        setError(err instanceof Error ? err.message : t('skillInfo.failedToLoad'))
      } finally {
        if (isMounted) setLoading(false)
      }
    }

    loadSkill()

    // Subscribe to skill changes
    const unsubscribe = window.electronAPI.onSkillsChanged?.((changedWorkspaceId, skills) => {
      if (changedWorkspaceId !== workspaceId) return
      const updated = skills.find((s) => s.slug === skillSlug)
      if (updated) {
        setSkill(updated)
      }
    })

    return () => {
      isMounted = false
      unsubscribe?.()
    }
  }, [workspaceId, skillSlug, workingDirectory])

  // Handle open in finder
  const handleOpenInFinder = useCallback(async () => {
    if (!skill) return

    try {
      if (!canRevealLocally) return
      await window.electronAPI.showInFolder(`${skill.path}/SKILL.md`)
    } catch (err) {
      console.error('Failed to open skill in finder:', err)
    }
  }, [canRevealLocally, skill])

  // Handle delete
  const handleDelete = useCallback(async () => {
    if (!skill) return

    try {
      if (skill.source !== 'workspace') return
      await window.electronAPI.deleteSkill(workspaceId, skillSlug)
      toast.success(t('skillInfo.deletedSkill', { name: skill.metadata.name }))
      navigate(routes.view.skills())
    } catch (err) {
      toast.error(t('skillInfo.failedToDelete'), {
        description: err instanceof Error ? err.message : undefined,
      })
    }
  }, [skill, workspaceId, skillSlug])

  // Handle opening in new window
  const handleOpenInNewWindow = useCallback(() => {
    window.electronAPI.openUrl(`craftagents://skills/skill/${skillSlug}?window=focused`)
  }, [skillSlug])

  const handlePublish = useCallback(async () => {
    if (!skill) return
    if (!currentUserId) {
      setPublishState({ status: 'idle' })
      toast.error('Sign in is required to publish Marketplace Skills.')
      return
    }

    setPublishState({ status: 'publishing' })
    try {
      const result = await window.electronAPI.publishMarketplaceSkill(workspaceId, {
        userId: currentUserId,
        skillSlug: skill.slug,
        marketplaceSlug,
        version,
        category,
        tags: tags.split(',').map((tag) => tag.trim()).filter(Boolean),
        releaseNotes: releaseNotes.trim() || undefined,
      })
      setPublishState(result)
      if (result.status === 'published') {
        setPublishDialogOpen(false)
        toast.success('Published Skill to Marketplace')
      } else {
        toast.error(result.message)
      }
    } catch (err) {
      setPublishState({ status: 'idle' })
      toast.error('Failed to publish Skill', {
        description: err instanceof Error ? err.message : undefined,
      })
    }
  }, [category, currentUserId, marketplaceSlug, releaseNotes, skill, tags, version, workspaceId])

  // Get skill name for header
  const skillName = skill?.metadata.name || skillSlug
  const canDeleteSkill = skill?.source === 'workspace'

  // Format path to show just the skill-relative portion (skills/{slug}/)
  const formatPath = (path: string) => {
    const skillsIndex = path.indexOf('/skills/')
    if (skillsIndex !== -1) {
      return path.slice(skillsIndex + 1) // Remove leading slash, keep "skills/{slug}/..."
    }
    return path
  }

  // Open the skill folder in Finder with SKILL.md selected
  const handleLocationClick = () => {
    if (!skill) return
    // Show the SKILL.md file in Finder (this reveals the enclosing folder with file focused)
    if (!canRevealLocally) return
    window.electronAPI.showInFolder(`${skill.path}/SKILL.md`)
  }

  return (
    <Info_Page
      loading={loading}
      error={error ?? undefined}
      empty={!skill && !loading && !error ? t('skillInfo.notFound') : undefined}
    >
      <Info_Page.Header
        title={skillName}
        titleMenu={
          <SkillMenu
            skillSlug={skillSlug}
            skillName={skillName}
            onOpenInNewWindow={handleOpenInNewWindow}
            onShowInFinder={handleOpenInFinder}
            canShowInFinder={canRevealLocally}
            onDelete={canDeleteSkill ? handleDelete : undefined}
            canDelete={canDeleteSkill}
            deleteLabel={canDeleteSkill ? t('skillInfo.deleteSkill') : t('skillInfo.managedByProject')}
            onPublishSkill={canDeleteSkill ? () => setPublishDialogOpen(true) : undefined}
            canPublishSkill={canDeleteSkill}
          />
        }
      />

      {skill && (
        <Info_Page.Content>
          {/* Hero: Avatar, title, and description */}
          <Info_Page.Hero
            avatar={<SkillAvatar skill={skill} fluid workspaceId={workspaceId} />}
            title={skill.metadata.name}
            tagline={skill.metadata.description}
          />

          <Info_Section
            title="Marketplace"
            actions={
              <button
                type="button"
                onClick={() => setPublishDialogOpen(true)}
                className="inline-flex h-7 items-center rounded-md border border-border bg-background px-3 text-xs font-medium hover:bg-muted disabled:bg-muted disabled:text-muted-foreground"
                disabled={skill.source !== 'workspace'}
              >
                Publish Skill
              </button>
            }
          >
            <div className="px-4 py-3">
              <LocalSkillMarketplaceStatus publishState={publishState} />
            </div>
          </Info_Section>

          {/* Metadata */}
          <Info_Section
            title={t('skillInfo.metadata')}
            actions={
              // EditPopover for AI-assisted metadata editing (name, description in frontmatter)
              <EditPopover
                trigger={<EditButton />}
                {...getEditConfig('skill-metadata', skill.path)}
                secondaryAction={{
                  label: t('common.editFile'),
                  filePath: `${skill.path}/SKILL.md`,
                }}
              />
            }
          >
            <Info_Table>
              <Info_Table.Row label={t('common.slug')} value={skill.slug} />
              <Info_Table.Row label={t('common.name')}>{skill.metadata.name}</Info_Table.Row>
              <Info_Table.Row label={t('common.description')}>
                {skill.metadata.description}
              </Info_Table.Row>
              <Info_Table.Row label={t('common.source')}>
                {skill.source === 'project' ? t('skillInfo.sourceProject') :
                 skill.source === 'global' ? t('skillInfo.sourceGlobal') :
                 t('skillInfo.sourceWorkspace')}
              </Info_Table.Row>
              <Info_Table.Row label={t('common.location')}>
                <button
                  onClick={handleLocationClick}
                  className="hover:underline cursor-pointer text-left"
                >
                  {formatPath(skill.path)}
                </button>
              </Info_Table.Row>
              {skill.metadata.requiredSources && skill.metadata.requiredSources.length > 0 && (
                <Info_Table.Row label={t('skillInfo.requiredSources')}>
                  {skill.metadata.requiredSources.join(', ')}
                </Info_Table.Row>
              )}
            </Info_Table>
          </Info_Section>

          {/* Permission Modes */}
          {skill.metadata.alwaysAllow && skill.metadata.alwaysAllow.length > 0 && (
            <Info_Section title={t('skillInfo.permissionModes')}>
              <div className="space-y-2 px-4 py-3">
                <p className="text-xs text-muted-foreground mb-3">
                  {t('skillInfo.permissionModesDesc')}
                </p>
                <div className="rounded-[8px] border border-border/50 overflow-hidden">
                  <table className="w-full text-sm">
                    <tbody>
                      <tr className="border-b border-border/30">
                        <td className="px-3 py-2 font-medium text-muted-foreground w-[140px]">{t('skillInfo.explore')}</td>
                        <td className="px-3 py-2 flex items-center gap-2">
                          <X className="h-3.5 w-3.5 text-destructive shrink-0" />
                          <span className="text-foreground/80">{t('skillInfo.exploreDesc')}</span>
                        </td>
                      </tr>
                      <tr className="border-b border-border/30">
                        <td className="px-3 py-2 font-medium text-muted-foreground">{t('skillInfo.askToEdit')}</td>
                        <td className="px-3 py-2 flex items-center gap-2">
                          <Check className="h-3.5 w-3.5 text-success shrink-0" />
                          <span className="text-foreground/80">{t('skillInfo.askToEditDesc')}</span>
                        </td>
                      </tr>
                      <tr>
                        <td className="px-3 py-2 font-medium text-muted-foreground">{t('skillInfo.auto')}</td>
                        <td className="px-3 py-2 flex items-center gap-2">
                          <Minus className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                          <span className="text-foreground/80">{t('skillInfo.autoDesc')}</span>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </Info_Section>
          )}

          {/* Instructions */}
          <Info_Section
            title={t('skillInfo.instructions')}
            actions={
              // EditPopover for AI-assisted editing with "Edit File" as secondary action
              <EditPopover
                trigger={<EditButton />}
                {...getEditConfig('skill-instructions', skill.path)}
                secondaryAction={{
                  label: t('common.editFile'),
                  filePath: `${skill.path}/SKILL.md`,
                }}
              />
            }
          >
            <Info_Markdown maxHeight={540} fullscreen>
              {skill.content || t('skillInfo.noInstructions')}
            </Info_Markdown>
          </Info_Section>

        </Info_Page.Content>
      )}

      {skill && publishDialogOpen && (
        <div className="fixed inset-0 z-modal flex items-center justify-center bg-black/30 p-4">
          <div className="w-full max-w-lg rounded-lg border border-border bg-background p-4 shadow-lg">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold">Publish Skill</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Publish {skill.metadata.name} as an immutable Marketplace version.
                </p>
              </div>
              <button type="button" className="text-sm text-muted-foreground hover:text-foreground" onClick={() => setPublishDialogOpen(false)}>
                Close
              </button>
            </div>
            <div className="mt-4 grid gap-3">
              <label className="grid gap-1 text-xs font-medium">
                Marketplace slug
                <input className="h-8 rounded-md border border-border bg-background px-2 font-normal" value={marketplaceSlug} onChange={(event) => setMarketplaceSlug(event.target.value)} />
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="grid gap-1 text-xs font-medium">
                  Version
                  <input className="h-8 rounded-md border border-border bg-background px-2 font-normal" value={version} onChange={(event) => setVersion(event.target.value)} />
                </label>
                <label className="grid gap-1 text-xs font-medium">
                  Category
                  <select className="h-8 rounded-md border border-border bg-background px-2 font-normal" value={category} onChange={(event) => setCategory(event.target.value)}>
                    {PRODUCT_MARKETPLACE_CATEGORIES.map((candidate) => (
                      <option key={candidate} value={candidate}>{candidate}</option>
                    ))}
                  </select>
                </label>
              </div>
              <label className="grid gap-1 text-xs font-medium">
                Tags
                <input className="h-8 rounded-md border border-border bg-background px-2 font-normal" value={tags} onChange={(event) => setTags(event.target.value)} placeholder="review, ci" />
              </label>
              <label className="grid gap-1 text-xs font-medium">
                Release notes
                <textarea className="min-h-20 rounded-md border border-border bg-background px-2 py-2 font-normal" value={releaseNotes} onChange={(event) => setReleaseNotes(event.target.value)} />
              </label>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" className="h-8 rounded-md border border-border px-3 text-xs font-medium hover:bg-muted" onClick={() => setPublishDialogOpen(false)}>
                Cancel
              </button>
              <button type="button" className="h-8 rounded-md border border-border bg-foreground px-3 text-xs font-medium text-background disabled:bg-muted disabled:text-muted-foreground" disabled={publishState.status === 'publishing'} onClick={handlePublish}>
                {publishState.status === 'publishing' ? 'Publishing...' : 'Publish Skill'}
              </button>
            </div>
          </div>
        </div>
      )}
    </Info_Page>
  )
}
