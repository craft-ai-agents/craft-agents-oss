import { dirname, isAbsolute, join, relative, resolve } from 'path'
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'fs'
import { RPC_CHANNELS, type SkillFile } from '@craft-agent/shared/protocol'
import { getWorkspaceByNameOrId } from '@craft-agent/shared/config'
import type { RpcServer } from '@craft-agent/server-core/transport'
import type { HandlerDeps } from '../handler-deps'

export const HANDLED_CHANNELS = [
  RPC_CHANNELS.skills.GET,
  RPC_CHANNELS.skills.GET_FILES,
  RPC_CHANNELS.skills.DELETE,
  RPC_CHANNELS.skills.EXPORT_BUNDLE,
  RPC_CHANNELS.skills.IMPORT_BUNDLE,
  RPC_CHANNELS.skills.OPEN_EDITOR,
  RPC_CHANNELS.skills.OPEN_FINDER,
] as const

export function registerSkillsHandlers(server: RpcServer, deps: HandlerDeps): void {
  const getUniqueSkillSlug = async (workspaceRoot: string, requestedSlug: string): Promise<string> => {
    const { skillExists } = await import('@craft-agent/shared/skills')
    if (!skillExists(workspaceRoot, requestedSlug)) return requestedSlug

    let counter = 2
    while (skillExists(workspaceRoot, `${requestedSlug}-${counter}`)) {
      counter += 1
    }
    return `${requestedSlug}-${counter}`
  }

  // Get all skills for a workspace (and optionally project-level skills from workingDirectory)
  server.handle(RPC_CHANNELS.skills.GET, async (_ctx, workspaceId: string, workingDirectory?: string) => {
    deps.platform.logger?.info(`SKILLS_GET: Loading skills for workspace: ${workspaceId}${workingDirectory ? `, workingDirectory: ${workingDirectory}` : ''}`)
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) {
      deps.platform.logger?.error(`SKILLS_GET: Workspace not found: ${workspaceId}`)
      return []
    }
    const { loadAllSkills } = await import('@craft-agent/shared/skills')
    const skills = loadAllSkills(workspace.rootPath, workingDirectory)
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

    const { getWorkspaceSkillsPath } = await import('@craft-agent/shared/workspaces')

    const skillsDir = getWorkspaceSkillsPath(workspace.rootPath)
    const skillDir = join(skillsDir, skillSlug)

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

  server.handle(RPC_CHANNELS.skills.EXPORT_BUNDLE, async (_ctx, workspaceId: string, skillSlug: string): Promise<import('@craft-agent/shared/protocol').SkillBundle> => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error('Workspace not found')

    const { loadSkill } = await import('@craft-agent/shared/skills')
    const { getWorkspaceSkillsPath } = await import('@craft-agent/shared/workspaces')
    const skill = loadSkill(workspace.rootPath, skillSlug)
    if (!skill) throw new Error(`Skill not found: ${skillSlug}`)
    if (skill.source !== 'workspace') {
      throw new Error('Only workspace skills can be shared between targets')
    }

    const skillDir = join(getWorkspaceSkillsPath(workspace.rootPath), skillSlug)
    const files: import('@craft-agent/shared/protocol').SkillBundleFile[] = []

    const scan = (currentDir: string, relativePrefix = '') => {
      const entries = readdirSync(currentDir, { withFileTypes: true })
      for (const entry of entries) {
        const fullPath = join(currentDir, entry.name)
        const relativePath = relativePrefix ? join(relativePrefix, entry.name) : entry.name
        if (entry.isDirectory()) {
          scan(fullPath, relativePath)
          continue
        }
        const contentBase64 = readFileSync(fullPath).toString('base64')
        files.push({ relativePath, contentBase64 })
      }
    }

    scan(skillDir)
    return { slug: skill.slug, files }
  })

  server.handle(RPC_CHANNELS.skills.IMPORT_BUNDLE, async (_ctx, workspaceId: string, bundle: import('@craft-agent/shared/protocol').SkillBundle): Promise<{ success: boolean; slug: string; error?: string }> => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error('Workspace not found')

    const { getWorkspaceSkillsPath } = await import('@craft-agent/shared/workspaces')

    try {
      const slug = await getUniqueSkillSlug(workspace.rootPath, bundle.slug)
      const skillDir = join(getWorkspaceSkillsPath(workspace.rootPath), slug)
      mkdirSync(skillDir, { recursive: true })

      for (const file of bundle.files) {
        const fullPath = resolveImportedSkillFilePath(skillDir, file.relativePath)
        mkdirSync(dirname(fullPath), { recursive: true })
        writeFileSync(fullPath, Buffer.from(file.contentBase64, 'base64'))
      }

      return { success: true, slug }
    } catch (error) {
      return {
        success: false,
        slug: bundle.slug,
        error: error instanceof Error ? error.message : 'Failed to import skill',
      }
    }
  })

  // Open skill SKILL.md in editor
  server.handle(RPC_CHANNELS.skills.OPEN_EDITOR, async (_ctx, workspaceId: string, skillSlug: string) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error('Workspace not found')

    const { getWorkspaceSkillsPath } = await import('@craft-agent/shared/workspaces')

    const skillsDir = getWorkspaceSkillsPath(workspace.rootPath)
    const skillFile = join(skillsDir, skillSlug, 'SKILL.md')
    await deps.platform.openPath?.(skillFile)
  })

  // Open skill folder in Finder/Explorer
  server.handle(RPC_CHANNELS.skills.OPEN_FINDER, async (_ctx, workspaceId: string, skillSlug: string) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error('Workspace not found')

    const { getWorkspaceSkillsPath } = await import('@craft-agent/shared/workspaces')

    const skillsDir = getWorkspaceSkillsPath(workspace.rootPath)
    const skillDir = join(skillsDir, skillSlug)
    await deps.platform.showItemInFolder?.(skillDir)
  })
}

export function resolveImportedSkillFilePath(skillDir: string, relativePath: string): string {
  if (!relativePath || relativePath.includes('\0')) {
    throw new Error(`Invalid skill bundle path: ${relativePath || '(empty)'}`)
  }

  const normalizedPath = relativePath.replace(/\\/g, '/')
  const segments = normalizedPath.split('/')
  if (
    normalizedPath.startsWith('/') ||
    segments.some(segment => segment === '' || segment === '.' || segment === '..')
  ) {
    throw new Error(`Invalid skill bundle path: ${relativePath}`)
  }

  const resolvedSkillDir = resolve(skillDir)
  const resolvedPath = resolve(resolvedSkillDir, normalizedPath)
  const relativeToSkillDir = relative(resolvedSkillDir, resolvedPath)
  if (!relativeToSkillDir || relativeToSkillDir.startsWith('..') || isAbsolute(relativeToSkillDir)) {
    throw new Error(`Skill bundle path escapes destination: ${relativePath}`)
  }

  return resolvedPath
}
