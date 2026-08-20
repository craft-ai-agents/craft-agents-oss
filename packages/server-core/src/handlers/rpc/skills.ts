import { join } from 'path'
import { cpSync, existsSync, readdirSync, statSync } from 'fs'
import { RPC_CHANNELS, type SkillFile } from '@craft-agent/shared/protocol'
import type { SkillExportResult, SkillPruneResult, SkillUsageMap } from '@craft-agent/shared/memory/types'
import { getWorkspaceByNameOrId } from '@craft-agent/shared/config'
import type { RpcServer } from '@craft-agent/server-core/transport'
import { pushTyped } from '@craft-agent/server-core/transport'
import type { HandlerDeps } from '../handler-deps'
import { exportSkillToProject, pruneUnusedSkills, readUsage } from '../../memory/skill-usage'

export const HANDLED_CHANNELS = [
  RPC_CHANNELS.skills.GET,
  RPC_CHANNELS.skills.GET_FILES,
  RPC_CHANNELS.skills.UPDATE,
  RPC_CHANNELS.skills.DELETE,
  RPC_CHANNELS.skills.OPEN_EDITOR,
  RPC_CHANNELS.skills.OPEN_FINDER,
  RPC_CHANNELS.skills.IMPORT_OMP,
  RPC_CHANNELS.skills.GET_USAGE,
  RPC_CHANNELS.skills.PRUNE_UNUSED,
  RPC_CHANNELS.skills.EXPORT_TO_PROJECT,
] as const

export function registerSkillsHandlers(server: RpcServer, deps: HandlerDeps): void {
  // Panel refresh after mutations: same payload shape as SessionManager's
  // fs-watcher broadcast (workspaceId, skills) that AppShell subscribes to.
  const broadcastSkillsChanged = async (workspaceId: string, workspaceRoot: string): Promise<void> => {
    const { loadAllSkills } = await import('@craft-agent/shared/skills')
    pushTyped(server, RPC_CHANNELS.skills.CHANGED, { to: 'workspace', workspaceId }, workspaceId, loadAllSkills(workspaceRoot))
  }

  // Get all skills for a workspace (and optionally project-level skills from workingDirectory)
  server.handle(RPC_CHANNELS.skills.GET, async (_ctx, workspaceId: string, workingDirectory?: string) => {
    deps.platform.logger?.info(`SKILLS_GET: Loading skills for workspace: ${workspaceId}${workingDirectory ? `, workingDirectory: ${workingDirectory}` : ''}`)
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) {
      deps.platform.logger?.error(`SKILLS_GET: Workspace not found: ${workspaceId}`)
      return []
    }
    // Validate workingDirectory exists on this server — a thin client may pass
    // its local path which doesn't exist on the remote server's filesystem.
    const effectiveWorkingDir = workingDirectory && existsSync(workingDirectory)
      ? workingDirectory
      : undefined
    const { loadAllSkills } = await import('@craft-agent/shared/skills')
    // includeShadowedOmp: the skills panel shows OMP variants shadowed by a
    // craft skill of the same slug as inactive (craft-wins) with an explanation.
    const skills = loadAllSkills(workspace.rootPath, effectiveWorkingDir, { includeOmp: true, includeShadowedOmp: true })
    deps.platform.logger?.info(`SKILLS_GET: Loaded ${skills.length} skills from ${workspace.rootPath}`)
    return skills
  })

  // Get files in a skill directory
  server.handle(RPC_CHANNELS.skills.GET_FILES, async (_ctx, workspaceId: string, skillSlug: string) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) {
      deps.platform.logger?.error(`SKILLS_GET_FILES: Workspace not found: ${workspaceId}`)
      return []
    }

    const { resolveWorkspaceSkillDir } = await import('@craft-agent/shared/skills')

    let skillDir: string
    try {
      skillDir = resolveWorkspaceSkillDir(workspace.rootPath, skillSlug)
    } catch (err) {
      deps.platform.logger?.error(`SKILLS_GET_FILES: invalid skill slug: ${skillSlug}`, err)
      return []
    }

    function scanDirectory(dirPath: string): SkillFile[] {
      try {
        const entries = readdirSync(dirPath, { withFileTypes: true })
        return entries
          .filter(entry => !entry.name.startsWith('.')) // Skip hidden files
          .map(entry => {
            const fullPath = join(dirPath, entry.name)
            if (entry.isDirectory()) {
              return {
                name: entry.name,
                type: 'directory' as const,
                children: scanDirectory(fullPath),
              }
            } else {
              const stats = statSync(fullPath)
              return {
                name: entry.name,
                type: 'file' as const,
                size: stats.size,
              }
            }
          })
          .sort((a, b) => {
            // Directories first, then files
            if (a.type !== b.type) return a.type === 'directory' ? -1 : 1
            return a.name.localeCompare(b.name)
          })
      } catch (err) {
        deps.platform.logger?.error(`SKILLS_GET_FILES: Error scanning ${dirPath}:`, err)
        return []
      }
    }

    return scanDirectory(skillDir)
  })

  // Delete a skill from a workspace
  server.handle(RPC_CHANNELS.skills.DELETE, async (_ctx, workspaceId: string, skillSlug: string) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error('Workspace not found')

    const { deleteSkill } = await import('@craft-agent/shared/skills')
    deleteSkill(workspace.rootPath, skillSlug)
    deps.platform.logger?.info(`Deleted skill: ${skillSlug}`)
  })

  // Native edit: update workspace skill frontmatter + body
  server.handle(RPC_CHANNELS.skills.UPDATE, async (
    _ctx,
    workspaceId: string,
    skillSlug: string,
    updates: import('@craft-agent/shared/skills').UpdateSkillContentInput,
  ) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error('Workspace not found')

    const { updateSkillContent } = await import('@craft-agent/shared/skills')
    const skill = updateSkillContent(workspace.rootPath, skillSlug, updates)
    if (!skill) throw new Error(`Skill not found: ${skillSlug}`)

    await broadcastSkillsChanged(workspaceId, workspace.rootPath)
    deps.platform.logger?.info(`Updated skill: ${skillSlug}`)
    return skill
  })

  // Import an OMP skill into the workspace as a regular craft skill.
  // Copies SKILL.md + all resources; on slug conflict appends `-omp` (then a counter).
  server.handle(RPC_CHANNELS.skills.IMPORT_OMP, async (_ctx, workspaceId: string, slug: string) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error('Workspace not found')

    const { listOmpSkills, isOmpSkillPath, invalidateSkillsCache } = await import('@craft-agent/shared/skills')
    const { getWorkspaceSkillsPath } = await import('@craft-agent/shared/workspaces')

    const ompSkill = listOmpSkills(workspace.rootPath).find(s => s.slug === slug)
    if (!ompSkill || !isOmpSkillPath(ompSkill.path, workspace.rootPath)) {
      throw new Error(`OMP skill not found: ${slug}`)
    }

    const skillsDir = getWorkspaceSkillsPath(workspace.rootPath)
    let targetSlug = slug
    if (existsSync(join(skillsDir, targetSlug))) {
      targetSlug = `${slug}-omp`
      let n = 2
      while (existsSync(join(skillsDir, targetSlug))) targetSlug = `${slug}-omp-${n++}`
    }
    const targetDir = join(skillsDir, targetSlug)
    cpSync(ompSkill.path, targetDir, { recursive: true })
    invalidateSkillsCache()
    deps.platform.logger?.info(`Imported OMP skill ${slug} → ${targetDir}${targetSlug !== slug ? ' (renamed, slug conflict)' : ''}`)

    return { slug: targetSlug, path: targetDir, renamed: targetSlug !== slug }
  })

  // Open skill SKILL.md in editor
  server.handle(RPC_CHANNELS.skills.OPEN_EDITOR, async (_ctx, workspaceId: string, skillSlug: string) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error('Workspace not found')
    if (workspace.remoteServer) throw new Error('Open in editor is not available for remote workspaces')

    const { resolveWorkspaceSkillDir } = await import('@craft-agent/shared/skills')
    const skillDir = resolveWorkspaceSkillDir(workspace.rootPath, skillSlug)
    const skillFile = join(skillDir, 'SKILL.md')
    await deps.platform.openPath?.(skillFile)
  })

  // Open skill folder in Finder/Explorer
  server.handle(RPC_CHANNELS.skills.OPEN_FINDER, async (_ctx, workspaceId: string, skillSlug: string) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error('Workspace not found')
    if (workspace.remoteServer) throw new Error('Show in Finder is not available for remote workspaces')

    const { resolveWorkspaceSkillDir } = await import('@craft-agent/shared/skills')
    const skillDir = resolveWorkspaceSkillDir(workspace.rootPath, skillSlug)
    await deps.platform.showItemInFolder?.(skillDir)
  })

  // S4: usage stats per slug aggregated from {workspace}/skills/.usage.jsonl
  server.handle(RPC_CHANNELS.skills.GET_USAGE, async (_ctx, workspaceId: string): Promise<SkillUsageMap> => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error('Workspace not found')
    return readUsage(workspace.rootPath)
  })

  // S4: archive (never delete) unused workspace skills. When `slugs` is
  // provided the callers (panel) pre-confirmed the list and olderThanDays is
  // ignored; otherwise candidates are computed from the usage ledger.
  server.handle(RPC_CHANNELS.skills.PRUNE_UNUSED, async (_ctx, workspaceId: string, olderThanDays?: number, slugs?: string[]): Promise<SkillPruneResult> => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error('Workspace not found')
    const result = pruneUnusedSkills(workspace.rootPath, { olderThanDays, slugs })
    if (result.archived.length > 0) await broadcastSkillsChanged(workspaceId, workspace.rootPath)
    return result
  })

  // T1: copy a workspace skill into {projectRoot}/.agents/skills/<slug>.
  // Never overwrites a differing existing target (see lib guards).
  server.handle(RPC_CHANNELS.skills.EXPORT_TO_PROJECT, async (_ctx, workspaceId: string, skillSlug: string, projectRoot: string): Promise<SkillExportResult> => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error('Workspace not found')
    return exportSkillToProject(workspace.rootPath, skillSlug, projectRoot)
  })
}
