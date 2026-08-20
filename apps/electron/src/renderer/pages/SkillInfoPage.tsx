/**
 * SkillInfoPage
 *
 * Displays comprehensive skill details including metadata,
 * permission modes, and instructions.
 * Native-first editors for metadata + instructions; AI secondary «Спросить ИИ».
 */

import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { useEffect, useState, useCallback } from 'react'
import { Check, X, Minus } from 'lucide-react'
import { EditPopover, getEditConfig } from '@/components/ui/EditPopover'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { toast } from 'sonner'
import { SkillMenu } from '@/components/app-shell/SkillMenu'
import { SkillAvatar } from '@/components/ui/skill-avatar'
import { routes, navigate } from '@/lib/navigate'
import { useActiveWorkspace } from '@/context/AppShellContext'
import {
  Info_Page,
  Info_Section,
  Info_Table,
} from '@/components/info'
import type { LoadedSkill } from '../../shared/types'

interface SkillInfoPageProps {
  skillSlug: string
  workspaceId: string
  workingDirectory?: string
}

export default function SkillInfoPage({ skillSlug, workspaceId, workingDirectory }: SkillInfoPageProps) {
  const { t } = useTranslation()
  const [skill, setSkill] = useState<LoadedSkill | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const activeWorkspace = useActiveWorkspace()
  const canRevealLocally = !activeWorkspace?.remoteServer

  const [editName, setEditName] = useState('')
  const [editDescription, setEditDescription] = useState('')
  const [editContent, setEditContent] = useState('')
  const [saving, setSaving] = useState(false)

  // Load skill data
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)

    ;(async () => {
      try {
        const skills = await window.electronAPI.getSkills(workspaceId, workingDirectory)
        if (cancelled) return
        const found = skills.find((s) => s.slug === skillSlug) ?? null
        if (!found) {
          setError(t('skillInfo.notFound'))
          setSkill(null)
          return
        }
        setSkill(found)
        setEditName(found.metadata.name)
        setEditDescription(found.metadata.description)
        setEditContent(found.content || '')
      } catch (err) {
        if (cancelled) return
        setError(err instanceof Error ? err.message : t('skillInfo.failedToLoad'))
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [workspaceId, skillSlug, workingDirectory, t])

  // Live updates
  useEffect(() => {
    if (!window.electronAPI?.onSkillsChanged) return
    return window.electronAPI.onSkillsChanged((changedWorkspaceId, skills) => {
      if (changedWorkspaceId !== workspaceId) return
      const found = skills.find((s) => s.slug === skillSlug)
      if (found) {
        setSkill(found)
        setEditName(found.metadata.name)
        setEditDescription(found.metadata.description)
        setEditContent(found.content || '')
      }
    })
  }, [workspaceId, skillSlug])

  const handleOpenInFinder = useCallback(async () => {
    if (!canRevealLocally || !skill) return
    try {
      await window.electronAPI.openSkillInFinder(workspaceId, skillSlug)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('common.error'))
    }
  }, [canRevealLocally, skill, workspaceId, skillSlug, t])

  const handleDelete = useCallback(async () => {
    if (!skill) return
    try {
      await window.electronAPI.deleteSkill(workspaceId, skillSlug)
      toast.success(t('skillInfo.deletedSkill', { name: skill.metadata.name }))
      navigate(routes.view.skills())
    } catch (err) {
      toast.error(t('skillInfo.failedToDelete'), {
        description: err instanceof Error ? err.message : undefined,
      })
    }
  }, [skill, workspaceId, skillSlug, t])

  const handleOpenInNewWindow = useCallback(() => {
    window.electronAPI.openUrl(`craftagents://skills/skill/${skillSlug}?window=focused`)
  }, [skillSlug])

  const handleSave = useCallback(async () => {
    if (!skill || skill.source !== 'workspace') return
    const name = editName.trim()
    const description = editDescription.trim()
    if (!name || !description) {
      toast.error(t('skillInfo.nameDescriptionRequired'))
      return
    }
    setSaving(true)
    try {
      const updated = await window.electronAPI.updateSkill(workspaceId, skillSlug, {
        name,
        description,
        content: editContent,
      })
      setSkill(updated)
      toast.success(t('skillInfo.saved'))
    } catch (err) {
      toast.error(t('skillInfo.saveFailed'), {
        description: err instanceof Error ? err.message : undefined,
      })
    } finally {
      setSaving(false)
    }
  }, [skill, editName, editDescription, editContent, workspaceId, skillSlug, t])

  const skillName = skill?.metadata.name || skillSlug
  const canDeleteSkill = skill?.source === 'workspace'
  const canEditNative = skill?.source === 'workspace'

  const formatPath = (path: string) => {
    const marker = '/skills/'
    const idx = path.lastIndexOf(marker)
    return idx >= 0 ? path.slice(idx + 1) : path
  }

  const handleLocationClick = async () => {
    if (!skill || !canRevealLocally) return
    try {
      await window.electronAPI.showInFolder(skill.path)
    } catch {
      // ignore
    }
  }

  const askAiTrigger = (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="h-8 px-3 rounded-[6px] bg-background/60 shadow-minimal text-foreground/60 hover:text-foreground"
    >
      {t('common.askAi')}
    </Button>
  )

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
          />
        }
      />

      {skill && (
        <Info_Page.Content>
          <Info_Page.Hero
            avatar={<SkillAvatar skill={skill} fluid workspaceId={workspaceId} />}
            title={editName || skill.metadata.name}
            tagline={editDescription || skill.metadata.description}
          />

          {/* Metadata — native form when workspace-owned */}
          <Info_Section
            title={t('skillInfo.metadata')}
            actions={
              <div className="flex items-center gap-1.5">
                {canEditNative && (
                  <Button
                    type="button"
                    size="sm"
                    className="h-8 px-3 rounded-[6px]"
                    disabled={saving}
                    onClick={() => void handleSave()}
                  >
                    {saving ? t('common.saving') : t('common.save')}
                  </Button>
                )}
                <EditPopover
                  trigger={askAiTrigger}
                  {...getEditConfig('skill-metadata', skill.path)}
                  secondaryAction={{
                    label: t('common.editFile'),
                    filePath: `${skill.path}/SKILL.md`,
                  }}
                />
              </div>
            }
          >
            {canEditNative ? (
              <div className="space-y-3 px-4 py-3">
                <div className="grid gap-1.5">
                  <label className="text-xs font-medium text-muted-foreground">{t('common.slug')}</label>
                  <Input value={skill.slug} disabled className="h-8 bg-muted/20 border-border/40 opacity-80 font-mono text-xs" />
                </div>
                <div className="grid gap-1.5">
                  <label className="text-xs font-medium text-muted-foreground">{t('common.name')}</label>
                  <Input
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    className="h-8 bg-muted/30 border-border/50"
                  />
                </div>
                <div className="grid gap-1.5">
                  <label className="text-xs font-medium text-muted-foreground">{t('common.description')}</label>
                  <Textarea
                    value={editDescription}
                    onChange={(e) => setEditDescription(e.target.value)}
                    rows={3}
                    className="bg-muted/30 border-border/50 text-sm"
                  />
                </div>
                <div className="grid gap-1.5">
                  <label className="text-xs font-medium text-muted-foreground">{t('common.source')}</label>
                  <Input
                    value={
                      skill.source === 'project'
                        ? t('skillInfo.sourceProject')
                        : skill.source === 'global'
                          ? t('skillInfo.sourceGlobal')
                          : t('skillInfo.sourceWorkspace')
                    }
                    disabled
                    className="h-8 bg-muted/20 border-border/40 opacity-80"
                  />
                </div>
                <div className="grid gap-1.5">
                  <label className="text-xs font-medium text-muted-foreground">{t('common.location')}</label>
                  <button
                    type="button"
                    onClick={handleLocationClick}
                    className="text-left text-xs font-mono text-foreground/80 hover:underline truncate"
                  >
                    {formatPath(skill.path)}
                  </button>
                </div>
                {skill.metadata.requiredSources && skill.metadata.requiredSources.length > 0 && (
                  <div className="grid gap-1.5">
                    <label className="text-xs font-medium text-muted-foreground">{t('skillInfo.requiredSources')}</label>
                    <p className="text-sm text-foreground/80">{skill.metadata.requiredSources.join(', ')}</p>
                  </div>
                )}
              </div>
            ) : (
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
            )}
          </Info_Section>

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

          {/* Instructions — native markdown editor for workspace skills */}
          <Info_Section
            title={t('skillInfo.instructions')}
            actions={
              <div className="flex items-center gap-1.5">
                {canEditNative && (
                  <Button
                    type="button"
                    size="sm"
                    className="h-8 px-3 rounded-[6px]"
                    disabled={saving}
                    onClick={() => void handleSave()}
                  >
                    {saving ? t('common.saving') : t('common.save')}
                  </Button>
                )}
                <EditPopover
                  trigger={askAiTrigger}
                  {...getEditConfig('skill-instructions', skill.path)}
                  secondaryAction={{
                    label: t('common.editFile'),
                    filePath: `${skill.path}/SKILL.md`,
                  }}
                />
              </div>
            }
          >
            {canEditNative ? (
              <div className="px-4 py-3">
                <Textarea
                  value={editContent}
                  onChange={(e) => setEditContent(e.target.value)}
                  rows={16}
                  placeholder={t('skillInfo.noInstructions')}
                  className="min-h-[280px] max-h-[540px] overflow-y-auto bg-muted/30 border-border/50 font-mono text-xs leading-relaxed"
                />
              </div>
            ) : (
              <div className="px-4 py-3">
                <pre className="whitespace-pre-wrap text-sm text-foreground/80 font-mono bg-muted/20 rounded-md p-3 max-h-[540px] overflow-y-auto border border-border/40">
                  {skill.content || t('skillInfo.noInstructions')}
                </pre>
              </div>
            )}
          </Info_Section>
        </Info_Page.Content>
      )}
    </Info_Page>
  )
}
