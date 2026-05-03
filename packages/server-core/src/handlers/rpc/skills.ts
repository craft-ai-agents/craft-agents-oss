import { join } from 'path'
import { existsSync, readdirSync, statSync } from 'fs'
import { RPC_CHANNELS, type SkillFile } from '@craft-agent/shared/protocol'
import { getWorkspaceByNameOrId } from '@craft-agent/shared/config'
import type { RpcServer } from '@craft-agent/server-core/transport'
import type { HandlerDeps } from '../handler-deps'

export const HANDLED_CHANNELS = [
  RPC_CHANNELS.skills.GET,
  RPC_CHANNELS.skills.LIST_GLOBAL,
  RPC_CHANNELS.skills.GET_ENABLED_GLOBAL,
  RPC_CHANNELS.skills.SET_GLOBAL_ENABLED,
  RPC_CHANNELS.skills.GET_FILES,
  RPC_CHANNELS.skills.DELETE,
  RPC_CHANNELS.skills.OPEN_EDITOR,
  RPC_CHANNELS.skills.OPEN_FINDER,
] as const

export function registerSkillsHandlers(server: RpcServer, deps: HandlerDeps): void {
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
    const skills = loadAllSkills(workspace.rootPath, effectiveWorkingDir)
    deps.platform.logger?.info(`SKILLS_GET: Loaded ${skills.length} skills from ${workspace.rootPath}`)
    return skills
  })

  server.handle(RPC_CHANNELS.skills.LIST_GLOBAL, async (_ctx, workspaceId: string) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) {
      deps.platform.logger?.error(`SKILLS_LIST_GLOBAL: Workspace not found: ${workspaceId}`)
      return []
    }

    const { loadGlobalSkills } = await import('@craft-agent/shared/skills')
    return loadGlobalSkills()
  })

  server.handle(RPC_CHANNELS.skills.GET_ENABLED_GLOBAL, async (_ctx, workspaceId: string) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) {
      deps.platform.logger?.error(`SKILLS_GET_ENABLED_GLOBAL: Workspace not found: ${workspaceId}`)
      return []
    }

    const { listEnabledGlobalSkillSlugs } = await import('@craft-agent/shared/skills')
    return listEnabledGlobalSkillSlugs(workspace.rootPath)
  })

  server.handle(RPC_CHANNELS.skills.SET_GLOBAL_ENABLED, async (_ctx, workspaceId: string, skillSlug: string, enabled: boolean) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error('Workspace not found')

    const {
      listEnabledGlobalSkillSlugs,
      loadAllSkills,
      loadGlobalSkillBySlug,
      setGlobalSkillEnabled,
    } = await import('@craft-agent/shared/skills')
    if (enabled && !loadGlobalSkillBySlug(skillSlug)) {
      throw new Error(`Global skill not found: ${skillSlug}`)
    }

    const enabledGlobalSkills = setGlobalSkillEnabled(workspace.rootPath, skillSlug, enabled)
    const skills = loadAllSkills(workspace.rootPath)
    deps.sessionManager.broadcastSkillsChanged(workspaceId, skills)
    deps.platform.logger?.info(
      `SKILLS_SET_GLOBAL_ENABLED: ${enabled ? 'Enabled' : 'Disabled'} global skill ${skillSlug} for ${workspaceId}`
    )
    return enabledGlobalSkills.length > 0 ? enabledGlobalSkills : listEnabledGlobalSkillSlugs(workspace.rootPath)
  })

  // Get files in a skill directory
  server.handle(RPC_CHANNELS.skills.GET_FILES, async (_ctx, workspaceId: string, skillSlug: string) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) {
      deps.platform.logger?.error(`SKILLS_GET_FILES: Workspace not found: ${workspaceId}`)
      return []
    }

    const { loadSkillBySlug } = await import('@craft-agent/shared/skills')
    const skill = loadSkillBySlug(workspace.rootPath, skillSlug)
    if (!skill) return []

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

    return scanDirectory(skill.path)
  })

  // Delete a skill from a workspace
  server.handle(RPC_CHANNELS.skills.DELETE, async (_ctx, workspaceId: string, skillSlug: string) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error('Workspace not found')

    const { deleteSkill } = await import('@craft-agent/shared/skills')
    deleteSkill(workspace.rootPath, skillSlug)
    deps.platform.logger?.info(`Deleted skill: ${skillSlug}`)
  })

  // Open skill SKILL.md in editor
  server.handle(RPC_CHANNELS.skills.OPEN_EDITOR, async (_ctx, workspaceId: string, skillSlug: string) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error('Workspace not found')
    if (workspace.remoteServer) throw new Error('Open in editor is not available for remote workspaces')

    const { loadSkillBySlug } = await import('@craft-agent/shared/skills')
    const skill = loadSkillBySlug(workspace.rootPath, skillSlug)
    if (!skill) throw new Error('Skill not found')
    const skillFile = join(skill.path, 'SKILL.md')
    await deps.platform.openPath?.(skillFile)
  })

  // Open skill folder in Finder/Explorer
  server.handle(RPC_CHANNELS.skills.OPEN_FINDER, async (_ctx, workspaceId: string, skillSlug: string) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error('Workspace not found')
    if (workspace.remoteServer) throw new Error('Show in Finder is not available for remote workspaces')

    const { loadSkillBySlug } = await import('@craft-agent/shared/skills')
    const skill = loadSkillBySlug(workspace.rootPath, skillSlug)
    if (!skill) throw new Error('Skill not found')
    await deps.platform.showItemInFolder?.(skill.path)
  })
}
