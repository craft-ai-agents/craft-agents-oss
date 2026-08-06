/**
 * ProjectInfoPage
 *
 * Workspace-project detail page with three tabs: Sessions, Assets, Settings.
 * v1 scope only — no memory tab, no provider selection, no plugin marketplace.
 */

import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { useEffect, useState, useCallback, useMemo } from 'react'
import { useAtomValue } from 'jotai'
import { FolderKanban, FolderOpen, Plus, Trash2, Upload } from 'lucide-react'
import { toast } from 'sonner'
import { useActiveWorkspace, useAppShellContext } from '@/context/AppShellContext'
import { navigate, routes } from '@/lib/navigate'
import { sessionMetaMapAtom } from '@/atoms/sessions'
import {
  Info_Page,
  Info_Section,
  Info_Table,
} from '@/components/info'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'
import { Tooltip, TooltipContent, TooltipTrigger } from '@craft-agent/ui'
import { cn } from '@/lib/utils'
import { PROJECT_COLOR_PALETTE } from '@/utils/project-colors'
import { InlineColorPickerRow } from '@/components/ui/inline-color-picker-row'
import type { LoadedProject, ProjectAsset } from '@craft-agent/shared/projects/types'

interface ProjectInfoPageProps {
  projectSlug: string
}

type TabKey = 'sessions' | 'assets' | 'settings'

export default function ProjectInfoPage({ projectSlug }: ProjectInfoPageProps) {
  const { t } = useTranslation()
  const workspace = useActiveWorkspace()
  const workspaceId = workspace?.id
  const sessionMetaMap = useAtomValue(sessionMetaMapAtom)
  const { onCreateSession } = useAppShellContext()

  const [project, setProject] = useState<LoadedProject | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<TabKey>('sessions')
  const [assets, setAssets] = useState<ProjectAsset[]>([])
  const [editName, setEditName] = useState('')
  const [editDescription, setEditDescription] = useState('')
  const [editWorkingDir, setEditWorkingDir] = useState('')
  const [editDetails, setEditDetails] = useState('')
  const [editColor, setEditColor] = useState<string>('')
  const [saving, setSaving] = useState(false)

  // Load project (and re-load on broadcast)
  const loadProject = useCallback(async () => {
    if (!workspaceId) return
    setLoading(true)
    setError(null)
    try {
      const result = await window.electronAPI.getProject(workspaceId, projectSlug)
      if (!result) {
        setError(t('projectInfo.notFound'))
        setProject(null)
        return
      }
      const loaded = result as LoadedProject
      setProject(loaded)
      setEditName(loaded.config.name)
      setEditDescription(loaded.config.description ?? '')
      setEditWorkingDir(loaded.config.workingDirectory ?? '')
      setEditDetails(loaded.config.details ?? '')
      setEditColor(loaded.config.color ?? '')
    } catch (err) {
      console.error('[ProjectInfoPage] Failed to load project:', err)
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [workspaceId, projectSlug, t])

  useEffect(() => {
    loadProject()
  }, [loadProject])

  useEffect(() => {
    if (!workspaceId) return
    const off = window.electronAPI.onProjectsChanged((wsId: string) => {
      if (wsId === workspaceId) loadProject()
    })
    return () => {
      if (typeof off === 'function') off()
    }
  }, [workspaceId, loadProject])

  // Load assets when entering Assets tab
  const refreshAssets = useCallback(async () => {
    if (!workspaceId) return
    try {
      const list = await window.electronAPI.listProjectAssets(workspaceId, projectSlug)
      setAssets(Array.isArray(list) ? (list as ProjectAsset[]) : [])
    } catch (err) {
      console.error('[ProjectInfoPage] Failed to load assets:', err)
    }
  }, [workspaceId, projectSlug])

  useEffect(() => {
    if (tab === 'assets') refreshAssets()
  }, [tab, refreshAssets])

  const projectSessions = useMemo(() => {
    if (!project) return []
    const result: { id: string; name: string }[] = []
    for (const meta of sessionMetaMap.values()) {
      if ((meta as { projectId?: string }).projectId === project.config.id) {
        result.push({ id: meta.id, name: meta.name ?? meta.id })
      }
    }
    return result
  }, [project, sessionMetaMap])

  const handleStartSession = useCallback(async () => {
    if (!workspaceId || !project) return
    try {
      const session = await onCreateSession(workspaceId, { projectId: project.config.id })
      if (session?.id) {
        navigate(routes.view.allSessions(session.id))
      }
    } catch (err) {
      console.error('[ProjectInfoPage] Failed to create session:', err)
      toast.error(t('projectInfo.newSessionFailed'))
    }
  }, [workspaceId, project, onCreateSession, t])

  const handlePickWorkingDirectory = useCallback(async () => {
    try {
      const picked = await window.electronAPI.openFolderDialog?.()
      if (typeof picked === 'string' && picked.trim()) {
        setEditWorkingDir(picked)
      }
    } catch (err) {
      console.error('[ProjectInfoPage] Folder picker failed:', err)
    }
  }, [])

  const handleSaveSettings = useCallback(async () => {
    if (!workspaceId || !project) return
    setSaving(true)
    try {
      await window.electronAPI.updateProject(workspaceId, project.config.slug, {
        name: editName.trim() || project.config.name,
        description: editDescription.trim() || undefined,
        workingDirectory: editWorkingDir.trim() || undefined,
        details: editDetails.trim() || undefined,
        color: editColor.trim() || undefined,
      })
      toast.success(t('projectInfo.saved'))
    } catch (err) {
      console.error('[ProjectInfoPage] Save failed:', err)
      toast.error(t('projectInfo.saveFailed'))
    } finally {
      setSaving(false)
    }
  }, [workspaceId, project, editName, editDescription, editWorkingDir, editDetails, editColor, t])

  const handleDeleteProject = useCallback(async () => {
    if (!workspaceId || !project) return
    if (!window.confirm(t('projectInfo.deleteConfirm', { name: project.config.name }))) return
    try {
      await window.electronAPI.deleteProject(workspaceId, project.config.slug)
      navigate(routes.view.projects())
    } catch (err) {
      console.error('[ProjectInfoPage] Delete failed:', err)
      toast.error(t('projectInfo.deleteFailed'))
    }
  }, [workspaceId, project, t])

  const handleUpload = useCallback(async (file: File) => {
    if (!workspaceId || !project) return
    try {
      const arrayBuffer = await file.arrayBuffer()
      const base64 = btoa(String.fromCharCode(...new Uint8Array(arrayBuffer)))
      await window.electronAPI.uploadProjectAsset(workspaceId, project.config.slug, {
        filename: file.name,
        base64,
      })
      await refreshAssets()
      toast.success(t('projectInfo.assetUploaded', { name: file.name }))
    } catch (err) {
      console.error('[ProjectInfoPage] Upload failed:', err)
      toast.error(t('projectInfo.uploadFailed'))
    }
  }, [workspaceId, project, refreshAssets, t])

  const handleDeleteAsset = useCallback(async (asset: ProjectAsset) => {
    if (!workspaceId || !project) return
    if (!window.confirm(t('projectInfo.deleteAssetConfirm', { name: asset.filename }))) return
    try {
      await window.electronAPI.deleteProjectAsset(workspaceId, project.config.slug, asset.filename)
      await refreshAssets()
    } catch (err) {
      console.error('[ProjectInfoPage] Asset delete failed:', err)
      toast.error(t('projectInfo.deleteAssetFailed'))
    }
  }, [workspaceId, project, refreshAssets, t])

  return (
    <Info_Page
      loading={loading}
      error={error ?? undefined}
      empty={!project && !loading && !error ? t('projectInfo.notFound') : undefined}
    >
      <Info_Page.Header title={project?.config.name ?? ''} />
      {project && (
        <Info_Page.Content>
          <Info_Page.Hero
            avatar={<FolderKanban className="h-6 w-6 text-foreground/60" />}
            title={project.config.name}
            tagline={project.config.description ?? t('projectInfo.taglineFallback')}
          />

          {/* Tab bar */}
          <div className="flex items-center gap-1 border-b border-border/50 px-2 mb-4">
            <TabButton active={tab === 'sessions'} onClick={() => setTab('sessions')}>
              {t('projectInfo.tabSessions')}
            </TabButton>
            <TabButton active={tab === 'assets'} onClick={() => setTab('assets')}>
              {t('projectInfo.tabAssets')}
            </TabButton>
            <TabButton active={tab === 'settings'} onClick={() => setTab('settings')}>
              {t('projectInfo.tabSettings')}
            </TabButton>
          </div>

          {/* Sessions tab */}
          {tab === 'sessions' && (
            <Info_Section
              title={t('projectInfo.tabSessions')}
              actions={
                <Button size="sm" variant="ghost" onClick={handleStartSession}>
                  <Plus className="h-3.5 w-3.5 mr-1" />
                  {t('projectInfo.newSessionButton', { name: project.config.name })}
                </Button>
              }
            >
              {projectSessions.length === 0 ? (
                <div className="px-4 py-6 text-sm text-muted-foreground">
                  {t('projectInfo.noSessions')}
                </div>
              ) : (
                <ul className="divide-y divide-border/50">
                  {projectSessions.map((s) => (
                    <li key={s.id} className="px-4 py-2">
                      <button
                        type="button"
                        className="text-sm text-foreground hover:underline text-left"
                        onClick={() => navigate(routes.view.allSessions(s.id))}
                      >
                        {s.name}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </Info_Section>
          )}

          {/* Assets tab */}
          {tab === 'assets' && (
            <Info_Section
              title={t('projectInfo.tabAssets')}
              actions={
                <label
                  className="inline-flex items-center gap-1 h-7 px-3 text-xs font-medium rounded-[8px] bg-background shadow-minimal hover:bg-foreground/[0.03] transition-colors cursor-pointer"
                >
                  <Upload className="h-3.5 w-3.5" />
                  {t('projectInfo.uploadAssets')}
                  <input
                    type="file"
                    className="hidden"
                    multiple
                    onChange={async (e) => {
                      const files = Array.from(e.target.files ?? [])
                      for (const f of files) await handleUpload(f)
                      e.target.value = ''
                    }}
                  />
                </label>
              }
            >
              {assets.length === 0 ? (
                <div className="px-4 py-6 text-sm text-muted-foreground">
                  {t('projectInfo.noAssets')}
                </div>
              ) : (
                <ul className="divide-y divide-border/50">
                  {assets.map((a) => (
                    <li key={a.filename} className="px-4 py-2 flex items-center gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="text-sm truncate">{a.filename}</div>
                        <div className="text-xs text-foreground/50">
                          {(a.sizeBytes / 1024).toFixed(1)} KB · {a.mimeType}
                        </div>
                      </div>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleDeleteAsset(a)}
                        className="text-destructive hover:text-destructive"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </Info_Section>
          )}

          {/* Settings tab */}
          {tab === 'settings' && (
            <Info_Section title={t('projectInfo.tabSettings')}>
              <div className="space-y-4 px-4 py-3">
                <Field label={t('projectInfo.title')}>
                  <Input
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    placeholder={project.config.name}
                  />
                </Field>
                <Field label={t('projectInfo.description')}>
                  <Input
                    value={editDescription}
                    onChange={(e) => setEditDescription(e.target.value)}
                    placeholder={t('projectInfo.descriptionPlaceholder')}
                  />
                </Field>
                <Field label={t('projectInfo.workingDirectory')}>
                  <div className="flex gap-2">
                    <Input
                      value={editWorkingDir}
                      onChange={(e) => setEditWorkingDir(e.target.value)}
                      placeholder={t('projectInfo.workingDirectoryPlaceholder')}
                      className="flex-1"
                    />
                    <Button size="sm" variant="outline" onClick={handlePickWorkingDirectory}>
                      <FolderOpen className="h-3.5 w-3.5 mr-1" />
                      {t('projectInfo.workingDirectoryPicker')}
                    </Button>
                  </div>
                </Field>
                <Field
                  label={t('projectInfo.color')}
                  hint={t('projectInfo.colorHint')}
                >
                  <InlineColorPickerRow
                    value={editColor}
                    onChange={setEditColor}
                    presets={PROJECT_COLOR_PALETTE}
                    onClear={() => setEditColor('')}
                    clearLabel={t('projectInfo.colorClear')}
                    customAriaLabel={t('projectInfo.colorCustom')}
                  />
                </Field>
                <Field
                  label={t('projectInfo.details')}
                  hint={t('projectInfo.detailsHelpText')}
                >
                  <Textarea
                    value={editDetails}
                    onChange={(e) => setEditDetails(e.target.value)}
                    rows={6}
                    placeholder={t('projectInfo.detailsPlaceholder')}
                  />
                </Field>
                <div className="flex justify-between pt-2">
                  <Button
                    variant="ghost"
                    onClick={handleDeleteProject}
                    className="text-destructive hover:text-destructive"
                  >
                    <Trash2 className="h-3.5 w-3.5 mr-1" />
                    {t('projectInfo.deleteProject')}
                  </Button>
                  <Button onClick={handleSaveSettings} disabled={saving}>
                    {saving ? t('common.saving') : t('common.save')}
                  </Button>
                </div>
              </div>
            </Info_Section>
          )}

          {/* Metadata read-out for quick reference */}
          <Info_Section title={t('projectInfo.metadata')}>
            <Info_Table>
              <Info_Table.Row label={t('common.slug')} value={project.config.slug} />
              <Info_Table.Row label={t('common.location')}>
                <div className="flex items-center gap-2 min-w-0">
                  <span className="flex-1 min-w-0 truncate font-mono text-xs">{project.folderPath}</span>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        onClick={() => window.electronAPI.openFile(project.folderPath)}
                        className="shrink-0 inline-flex h-6 w-6 items-center justify-center rounded text-foreground/50 hover:text-foreground hover:bg-foreground/5 transition-colors"
                        aria-label={t('projectInfo.openLocation')}
                      >
                        <FolderOpen className="h-3.5 w-3.5" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent>{t('projectInfo.openLocation')}</TooltipContent>
                  </Tooltip>
                </div>
              </Info_Table.Row>
            </Info_Table>
          </Info_Section>
        </Info_Page.Content>
      )}
    </Info_Page>
  )
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'px-3 py-1.5 text-sm rounded-t-md border-b-2',
        active
          ? 'border-foreground/80 text-foreground'
          : 'border-transparent text-foreground/60 hover:text-foreground/80'
      )}
    >
      {children}
    </button>
  )
}

function Field({
  label,
  hint,
  children,
}: {
  label: React.ReactNode
  hint?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <label className="block">
      <div className="text-xs font-medium text-foreground/70 mb-1">{label}</div>
      {children}
      {hint && <div className="mt-1 text-xs text-foreground/50">{hint}</div>}
    </label>
  )
}
