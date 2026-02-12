/**
 * ProjectHomePage
 *
 * Main content panel for a single project. Shows project info,
 * a list of project sessions, a files section, and project settings.
 */

import * as React from 'react'
import { useCallback, useEffect, useState, useRef } from 'react'
import { Briefcase, MessageSquare, FileText, Plus, Settings, Check } from 'lucide-react'
import { useAtomValue } from 'jotai'
import { sessionMetaMapAtom, type SessionMeta } from '@/atoms/sessions'
import { useNavigation } from '@/contexts/NavigationContext'
import { routes } from '@/lib/navigate'
import { cn } from '@/lib/utils'
import type { ProjectConfig, ProjectFile } from '../../../shared/types'

export interface ProjectHomePageProps {
  projectSlug: string
  workspaceId: string
}

type Tab = 'chats' | 'files' | 'settings'

export function ProjectHomePage({ projectSlug, workspaceId }: ProjectHomePageProps) {
  const [project, setProject] = useState<ProjectConfig | null>(null)
  const [files, setFiles] = useState<ProjectFile[]>([])
  const [activeTab, setActiveTab] = useState<Tab>('chats')
  const { navigate } = useNavigation()
  const sessionMetaMap = useAtomValue(sessionMetaMapAtom)

  // Edit state for settings tab
  const [editName, setEditName] = useState('')
  const [editDescription, setEditDescription] = useState('')
  const [editGuidelines, setEditGuidelines] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [saveMessage, setSaveMessage] = useState<string | null>(null)
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout>>()

  // Load project config
  useEffect(() => {
    if (!workspaceId || !projectSlug) return
    window.electronAPI.getProject(workspaceId, projectSlug).then((config) => {
      setProject(config)
      if (config) {
        setEditName(config.name)
        setEditDescription(config.description || '')
        setEditGuidelines(config.guidelines || '')
      }
    }).catch(err => {
      console.error('[ProjectHomePage] Failed to load project:', err)
    })
  }, [workspaceId, projectSlug])

  // Load project files
  useEffect(() => {
    if (!workspaceId || !projectSlug) return
    window.electronAPI.getProjectFiles(workspaceId, projectSlug).then((projectFiles) => {
      setFiles(projectFiles || [])
    }).catch(err => {
      console.error('[ProjectHomePage] Failed to load files:', err)
    })
  }, [workspaceId, projectSlug])

  // Watch for file changes
  useEffect(() => {
    if (!workspaceId || !projectSlug) return
    window.electronAPI.watchProjectFiles(workspaceId, projectSlug)

    const cleanup = window.electronAPI.onProjectFilesChanged((changedWorkspaceId, changedProjectSlug) => {
      if (changedWorkspaceId === workspaceId && changedProjectSlug === projectSlug) {
        window.electronAPI.getProjectFiles(workspaceId, projectSlug).then((projectFiles) => {
          setFiles(projectFiles || [])
        })
      }
    })

    return () => {
      cleanup()
      window.electronAPI.unwatchProjectFiles(workspaceId, projectSlug)
    }
  }, [workspaceId, projectSlug])

  // Filter sessions belonging to this project
  const projectSessions = React.useMemo(() => {
    if (!project) return []
    const sessions: SessionMeta[] = []
    for (const [, meta] of sessionMetaMap) {
      if (meta.projectId === project.id) {
        sessions.push(meta)
      }
    }
    return sessions.sort((a, b) => (b.lastMessageAt || 0) - (a.lastMessageAt || 0))
  }, [sessionMetaMap, project])

  // Create new chat in this project
  const handleNewChat = useCallback(() => {
    if (!workspaceId || !project) return
    window.electronAPI.createSession(workspaceId, { projectId: project.id }).then((session) => {
      navigate(routes.view.project(projectSlug, session.id))
    }).catch(err => {
      console.error('[ProjectHomePage] Failed to create session:', err)
    })
  }, [workspaceId, project, projectSlug, navigate])

  // Create new file
  const handleNewFile = useCallback(() => {
    if (!workspaceId || !projectSlug) return
    const fileName = `untitled-${Date.now()}.md`
    window.electronAPI.createProjectFile(workspaceId, projectSlug, fileName, '').then(() => {
      // File watcher will update the list
    }).catch(err => {
      console.error('[ProjectHomePage] Failed to create file:', err)
    })
  }, [workspaceId, projectSlug])

  // Save project settings
  const handleSave = useCallback(async () => {
    if (!workspaceId || !projectSlug || !project) return
    setIsSaving(true)
    setSaveMessage(null)
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current)

    try {
      const updates: Partial<Pick<ProjectConfig, 'name' | 'description' | 'guidelines'>> = {}
      if (editName !== project.name) updates.name = editName
      if (editDescription !== (project.description || '')) updates.description = editDescription
      if (editGuidelines !== (project.guidelines || '')) updates.guidelines = editGuidelines

      if (Object.keys(updates).length === 0) {
        setSaveMessage('No changes')
        saveTimeoutRef.current = setTimeout(() => setSaveMessage(null), 2000)
        setIsSaving(false)
        return
      }

      const updated = await window.electronAPI.updateProject(workspaceId, projectSlug, updates)
      if (updated) {
        setProject(updated)
        setSaveMessage('Saved')
        saveTimeoutRef.current = setTimeout(() => setSaveMessage(null), 2000)
      }
    } catch (err) {
      console.error('[ProjectHomePage] Failed to save project:', err)
      setSaveMessage('Save failed')
      saveTimeoutRef.current = setTimeout(() => setSaveMessage(null), 3000)
    } finally {
      setIsSaving(false)
    }
  }, [workspaceId, projectSlug, project, editName, editDescription, editGuidelines])

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current)
    }
  }, [])

  if (!project) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        <p className="text-sm">Loading project...</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      {/* Project header */}
      <div className="shrink-0 px-6 pt-6 pb-4 border-b border-border/50">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-foreground/5 flex items-center justify-center">
            <Briefcase className="h-4 w-4 text-muted-foreground" />
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="text-lg font-semibold truncate">{project.name}</h1>
            {project.description && (
              <p className="text-sm text-muted-foreground truncate">{project.description}</p>
            )}
          </div>
        </div>
      </div>

      {/* Tab navigation */}
      <div className="shrink-0 px-6 border-b border-border/50">
        <div className="flex gap-4">
          <TabButton
            active={activeTab === 'chats'}
            onClick={() => setActiveTab('chats')}
            icon={<MessageSquare className="h-3.5 w-3.5" />}
            label="Chats"
            count={projectSessions.length}
          />
          <TabButton
            active={activeTab === 'files'}
            onClick={() => setActiveTab('files')}
            icon={<FileText className="h-3.5 w-3.5" />}
            label="Files"
            count={files.length}
          />
          <TabButton
            active={activeTab === 'settings'}
            onClick={() => setActiveTab('settings')}
            icon={<Settings className="h-3.5 w-3.5" />}
            label="Settings"
          />
        </div>
      </div>

      {/* Tab content */}
      <div className="flex-1 min-h-0 overflow-auto">
        {activeTab === 'chats' && (
          <div className="p-4">
            <button
              onClick={handleNewChat}
              className="flex items-center gap-1.5 mb-4 h-8 px-3 text-sm font-medium rounded-[8px] bg-foreground/[0.03] hover:bg-foreground/[0.06] transition-colors"
            >
              <Plus className="h-3.5 w-3.5" />
              New Chat
            </button>
            {projectSessions.length === 0 ? (
              <p className="text-sm text-muted-foreground">No conversations in this project yet.</p>
            ) : (
              <div className="space-y-1">
                {projectSessions.map((session) => (
                  <button
                    key={session.id}
                    onClick={() => navigate(routes.view.project(projectSlug, session.id))}
                    className="flex items-start gap-3 w-full px-3 py-2.5 text-left text-sm rounded-[8px] hover:bg-foreground/[0.03] transition-colors"
                  >
                    <MessageSquare className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
                    <div className="min-w-0 flex-1">
                      <div className="font-medium truncate">
                        {session.name || session.preview || 'Untitled'}
                      </div>
                      {session.lastMessageAt && (
                        <div className="text-xs text-muted-foreground mt-0.5">
                          {new Date(session.lastMessageAt).toLocaleDateString()}
                        </div>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === 'files' && (
          <div className="p-4">
            <button
              onClick={handleNewFile}
              className="flex items-center gap-1.5 mb-4 h-8 px-3 text-sm font-medium rounded-[8px] bg-foreground/[0.03] hover:bg-foreground/[0.06] transition-colors"
            >
              <Plus className="h-3.5 w-3.5" />
              New File
            </button>
            {files.length === 0 ? (
              <p className="text-sm text-muted-foreground">No files in this project yet.</p>
            ) : (
              <div className="space-y-1">
                {files.map((file) => (
                  <button
                    key={file.path}
                    onClick={() => navigate(routes.view.projectFile(projectSlug, file.path))}
                    className="flex items-center gap-3 w-full px-3 py-2 text-left text-sm rounded-[8px] hover:bg-foreground/[0.03] transition-colors"
                  >
                    <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                    <span className="truncate">{file.name}</span>
                    <span className="text-xs text-muted-foreground ml-auto shrink-0">
                      {formatFileSize(file.size ?? 0)}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === 'settings' && (
          <div className="p-4 space-y-5 max-w-xl">
            {/* Name */}
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Name</label>
              <input
                type="text"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                className="w-full h-9 px-3 text-sm rounded-[8px] border border-border bg-background focus:outline-none focus:ring-1 focus:ring-foreground/20"
                placeholder="Project name"
              />
            </div>

            {/* Description */}
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Description</label>
              <input
                type="text"
                value={editDescription}
                onChange={(e) => setEditDescription(e.target.value)}
                className="w-full h-9 px-3 text-sm rounded-[8px] border border-border bg-background focus:outline-none focus:ring-1 focus:ring-foreground/20"
                placeholder="Brief description (optional)"
              />
            </div>

            {/* Guidelines */}
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Guidelines</label>
              <p className="text-xs text-muted-foreground">
                Instructions injected into the agent system prompt for all chats in this project.
              </p>
              <textarea
                value={editGuidelines}
                onChange={(e) => setEditGuidelines(e.target.value)}
                rows={8}
                className="w-full px-3 py-2 text-sm rounded-[8px] border border-border bg-background focus:outline-none focus:ring-1 focus:ring-foreground/20 resize-y font-mono"
                placeholder="e.g., Always use TypeScript strict mode. Follow the project's ESLint config..."
              />
            </div>

            {/* Save button */}
            <div className="flex items-center gap-3">
              <button
                onClick={handleSave}
                disabled={isSaving || !editName.trim()}
                className={cn(
                  "flex items-center gap-1.5 h-8 px-4 text-sm font-medium rounded-[8px] transition-colors",
                  isSaving || !editName.trim()
                    ? "bg-foreground/5 text-muted-foreground cursor-not-allowed"
                    : "bg-foreground text-background hover:bg-foreground/90"
                )}
              >
                {isSaving ? 'Saving...' : 'Save'}
              </button>
              {saveMessage && (
                <span className="flex items-center gap-1 text-sm text-muted-foreground">
                  {saveMessage === 'Saved' && <Check className="h-3.5 w-3.5 text-green-500" />}
                  {saveMessage}
                </span>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function TabButton({
  active,
  onClick,
  icon,
  label,
  count,
}: {
  active: boolean
  onClick: () => void
  icon: React.ReactNode
  label: string
  count?: number
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex items-center gap-1.5 px-1 py-2.5 text-sm font-medium border-b-2 transition-colors",
        active
          ? "border-foreground text-foreground"
          : "border-transparent text-muted-foreground hover:text-foreground hover:border-foreground/20"
      )}
    >
      {icon}
      {label}
      {count !== undefined && (
        <span className="text-xs text-muted-foreground">({count})</span>
      )}
    </button>
  )
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
