/**
 * SkillInfoPage
 *
 * Displays comprehensive skill details including metadata, configuration,
 * permission modes, instructions, files, and statistics.
 * Uses the Info_ component system for consistent styling with SourceInfoPage.
 */

import * as React from 'react'
import { useEffect, useState, useCallback } from 'react'
import {
  FileText,
  Folder,
  Image,
  Check,
  X,
  Minus,
} from 'lucide-react'
import { toast } from 'sonner'
import { SkillMenu } from '@/components/app-shell/SkillMenu'
import { SkillAvatar } from '@/components/ui/skill-avatar'
import { routes, navigate } from '@/lib/navigate'
import {
  Info_Page,
  Info_Section,
  Info_Table,
  Info_Markdown,
} from '@/components/info'
import { cn } from '@/lib/utils'
import type { LoadedSkill, SkillFile } from '../../shared/types'

interface SkillInfoPageProps {
  skillSlug: string
  workspaceId: string
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`
}

function getFileIcon(file: SkillFile): React.ReactNode {
  if (file.type === 'directory') {
    return <Folder className="h-3.5 w-3.5 text-info" />
  }
  if (file.name.match(/\.(svg|png|jpg|jpeg|gif|webp)$/i)) {
    return <Image className="h-3.5 w-3.5 text-accent" />
  }
  return <FileText className="h-3.5 w-3.5 text-muted-foreground" />
}

export default function SkillInfoPage({ skillSlug, workspaceId }: SkillInfoPageProps) {
  const [skill, setSkill] = useState<LoadedSkill | null>(null)
  const [skillFiles, setSkillFiles] = useState<SkillFile[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Load skill data
  useEffect(() => {
    let isMounted = true
    setLoading(true)
    setError(null)

    const loadSkill = async () => {
      try {
        const skills = await window.electronAPI.getSkills(workspaceId)

        if (!isMounted) return

        // Find the skill by slug
        const found = skills.find((s) => s.slug === skillSlug)
        if (found) {
          setSkill(found)

          // Load skill files
          try {
            const files = await window.electronAPI.getSkillFiles?.(workspaceId, skillSlug)
            if (files && isMounted) {
              setSkillFiles(files)
            }
          } catch {
            // File listing is optional, don't fail if not available
          }
        } else {
          setError('Skill not found')
        }
      } catch (err) {
        if (!isMounted) return
        setError(err instanceof Error ? err.message : 'Failed to load skill')
      } finally {
        if (isMounted) setLoading(false)
      }
    }

    loadSkill()

    // Subscribe to skill changes
    const unsubscribe = window.electronAPI.onSkillsChanged?.((skills) => {
      const updated = skills.find((s) => s.slug === skillSlug)
      if (updated) {
        setSkill(updated)
      }
    })

    return () => {
      isMounted = false
      unsubscribe?.()
    }
  }, [workspaceId, skillSlug])

  // Handle edit button click
  const handleEdit = useCallback(async () => {
    if (!skill) return

    try {
      await window.electronAPI.openSkillInEditor(workspaceId, skillSlug)
    } catch (err) {
      console.error('Failed to open skill in editor:', err)
    }
  }, [skill, workspaceId, skillSlug])

  // Handle open in finder
  const handleOpenInFinder = useCallback(async () => {
    if (!skill) return

    try {
      await window.electronAPI.openSkillInFinder(workspaceId, skillSlug)
    } catch (err) {
      console.error('Failed to open skill in finder:', err)
    }
  }, [skill, workspaceId, skillSlug])

  // Handle delete
  const handleDelete = useCallback(async () => {
    if (!skill) return

    try {
      await window.electronAPI.deleteSkill(workspaceId, skillSlug)
      toast.success(`Deleted skill: ${skill.metadata.name}`)
      navigate(routes.view.skills())
    } catch (err) {
      toast.error('Failed to delete skill', {
        description: err instanceof Error ? err.message : 'Unknown error',
      })
    }
  }, [skill, workspaceId, skillSlug])

  // Handle opening in new window
  const handleOpenInNewWindow = useCallback(() => {
    window.electronAPI.openUrl(`craftagents://skills/skill/${skillSlug}?window=focused`)
  }, [skillSlug])

  // Get skill name for header
  const skillName = skill?.metadata.name || skillSlug

  // Extract icon filename from path
  const iconFilename = skill?.iconPath?.split('/').pop()

  // Format path with tilde for home directory
  const formatPath = (path: string) => {
    const home = '/Users/'
    if (path.startsWith(home)) {
      const afterUsers = path.slice(home.length)
      const slashIndex = afterUsers.indexOf('/')
      if (slashIndex !== -1) {
        return '~' + afterUsers.slice(slashIndex)
      }
    }
    return path
  }

  return (
    <Info_Page
      loading={loading}
      error={error ?? undefined}
      empty={!skill && !loading && !error ? 'Skill not found' : undefined}
    >
      <Info_Page.Header
        title={skillName}
        titleMenu={
          <SkillMenu
            skillSlug={skillSlug}
            skillName={skillName}
            onEdit={handleEdit}
            onOpenInNewWindow={handleOpenInNewWindow}
            onShowInFinder={handleOpenInFinder}
            onDelete={handleDelete}
          />
        }
      />

      {skill && (
        <Info_Page.Content>
          {/* Hero: Avatar, title, and description */}
          <Info_Page.Hero
            avatar={<SkillAvatar skill={skill} size="lg" workspaceId={workspaceId} />}
            title={skill.metadata.name}
            tagline={skill.metadata.description}
          />

          {/* Metadata */}
          <Info_Section title="Metadata" description="Identity from SKILL.md frontmatter.">
            <Info_Table>
              <Info_Table.Row label="Slug" value={skill.slug} />
              <Info_Table.Row label="Name">{skill.metadata.name}</Info_Table.Row>
              <Info_Table.Row label="Description">
                <span className="text-foreground/80">{skill.metadata.description}</span>
              </Info_Table.Row>
              <Info_Table.Row label="Location">
                <span className="font-mono text-xs text-muted-foreground break-all">{formatPath(skill.path)}</span>
              </Info_Table.Row>
            </Info_Table>
          </Info_Section>

          {/* Configuration */}
          <Info_Section title="Configuration" description="Trigger patterns and auto-approved tools.">
            <div className="space-y-4">
              {/* Icon status */}
              <Info_Table>
                <Info_Table.Row label="Icon">
                  {skill.iconPath ? (
                    <span className="text-success flex items-center gap-1.5">
                      <Check className="h-3.5 w-3.5" />
                      {iconFilename}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">No icon file</span>
                  )}
                </Info_Table.Row>
              </Info_Table>

              {/* File Patterns (globs) */}
              {skill.metadata.globs && skill.metadata.globs.length > 0 && (
                <div className="px-4 pb-2">
                  <p className="text-sm font-medium mb-1">File Patterns</p>
                  <p className="text-xs text-muted-foreground mb-2">
                    When working with matching files, this skill may be suggested.
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {skill.metadata.globs.map((glob, i) => (
                      <span
                        key={i}
                        className="px-2 py-0.5 text-xs bg-foreground/5 rounded font-mono"
                      >
                        {glob}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Always Allowed Tools */}
              {skill.metadata.alwaysAllow && skill.metadata.alwaysAllow.length > 0 && (
                <div className="px-4 pb-2">
                  <p className="text-sm font-medium mb-1">Always Allowed Tools</p>
                  <p className="text-xs text-muted-foreground mb-2">
                    These tools run without permission prompts when skill is active.
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {skill.metadata.alwaysAllow.map((tool, i) => (
                      <span
                        key={i}
                        className="px-2 py-0.5 text-xs bg-success/10 text-success rounded font-mono"
                      >
                        {tool}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Show message if no configuration */}
              {!skill.metadata.globs?.length && !skill.metadata.alwaysAllow?.length && !skill.iconPath && (
                <p className="text-sm text-muted-foreground px-4 pb-2">
                  No file patterns or tool permissions configured.
                </p>
              )}
            </div>
          </Info_Section>

          {/* Permission Modes */}
          {skill.metadata.alwaysAllow && skill.metadata.alwaysAllow.length > 0 && (
            <Info_Section title="Permission Modes" description="How auto-approved tools behave in each mode.">
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground mb-3">
                  How "Always Allowed Tools" interacts with permission modes:
                </p>
                <div className="rounded-[8px] border border-border/50 overflow-hidden">
                  <table className="w-full text-sm">
                    <tbody>
                      <tr className="border-b border-border/30">
                        <td className="px-3 py-2 font-medium text-muted-foreground w-[140px]">Explore</td>
                        <td className="px-3 py-2 flex items-center gap-2">
                          <X className="h-3.5 w-3.5 text-destructive shrink-0" />
                          <span className="text-foreground/80">Blocked — write tools blocked regardless</span>
                        </td>
                      </tr>
                      <tr className="border-b border-border/30">
                        <td className="px-3 py-2 font-medium text-muted-foreground">Ask to Edit</td>
                        <td className="px-3 py-2 flex items-center gap-2">
                          <Check className="h-3.5 w-3.5 text-success shrink-0" />
                          <span className="text-foreground/80">Auto-approved — no prompts for allowed tools</span>
                        </td>
                      </tr>
                      <tr>
                        <td className="px-3 py-2 font-medium text-muted-foreground">Auto</td>
                        <td className="px-3 py-2 flex items-center gap-2">
                          <Minus className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                          <span className="text-foreground/80">No effect — all tools already auto-approved</span>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </Info_Section>
          )}

          {/* Files */}
          {skillFiles.length > 0 && (
            <Info_Section title="Files" description="Contents of the skill folder.">
              <div className="rounded-lg border border-border/50 overflow-hidden divide-y divide-border/30">
                {skillFiles.map((file, i) => (
                  <FileTreeItem key={i} file={file} depth={0} basePath={skill.path} />
                ))}
              </div>
            </Info_Section>
          )}

          {/* Instructions */}
          <Info_Section
            title="Instructions"
            description="Prompt injected when this skill is active."
            actions={
              <button
                onClick={handleEdit}
                className="transition-colors text-[13px] cursor-pointer text-muted-foreground hover:text-foreground hover:underline focus:outline-none focus-visible:underline"
              >
                Edit
              </button>
            }
          >
            <Info_Markdown maxHeight={540}>
              {skill.content || '*No instructions provided.*'}
            </Info_Markdown>
          </Info_Section>

        </Info_Page.Content>
      )}
    </Info_Page>
  )
}

// File tree item component
function FileTreeItem({ file, depth, basePath }: { file: SkillFile; depth: number; basePath: string }) {
  const [expanded, setExpanded] = useState(true)
  const isDirectory = file.type === 'directory'
  const hasChildren = isDirectory && file.children && file.children.length > 0
  const filePath = `${basePath}/${file.name}`

  const handleClick = () => {
    if (isDirectory) {
      setExpanded(!expanded)
    } else {
      // Open file in Finder
      window.electronAPI.showInFolder(filePath)
    }
  }

  return (
    <>
      <div
        className={cn(
          'flex items-center gap-3 py-2.5 px-4 text-sm transition-colors cursor-pointer hover:bg-foreground/[0.02]'
        )}
        style={{ paddingLeft: `${depth * 20 + 16}px` }}
        onClick={handleClick}
      >
        <span className="shrink-0">{getFileIcon(file)}</span>
        <span className={cn('font-mono text-[13px] flex-1 truncate', isDirectory && 'font-medium')}>
          {file.name}
        </span>
        {file.size !== undefined && (
          <span className="text-xs text-muted-foreground tabular-nums">{formatBytes(file.size)}</span>
        )}
        {hasChildren && (
          <span className="text-xs text-muted-foreground">
            {file.children!.length}
          </span>
        )}
      </div>
      {isDirectory && expanded && file.children && (
        <>
          {file.children.map((child, i) => (
            <FileTreeItem
              key={i}
              file={child}
              depth={depth + 1}
              basePath={filePath}
            />
          ))}
        </>
      )}
    </>
  )
}
