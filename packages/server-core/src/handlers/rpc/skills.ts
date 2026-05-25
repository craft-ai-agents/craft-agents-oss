import { join } from 'path'
import { existsSync, readdirSync, statSync } from 'fs'
import { RPC_CHANNELS, type SkillFile } from '@craft-agent/shared/protocol'
import { getWorkspaceByNameOrId } from '@craft-agent/shared/config'
import type { SkillMetadata } from '@craft-agent/shared/skills'
import { loadWorkspaceSources } from '@craft-agent/shared/sources'
import { loadWorkspaceConfig, saveWorkspaceConfig } from '@craft-agent/shared/workspaces'
import { pushTyped, type RpcServer } from '@craft-agent/server-core/transport'
import type { HandlerDeps } from '../handler-deps'

export const HANDLED_CHANNELS = [
  RPC_CHANNELS.skills.GET,
  RPC_CHANNELS.skills.GET_FILES,
  RPC_CHANNELS.skills.CREATE,
  RPC_CHANNELS.skills.FORCE_WRITE,
  RPC_CHANNELS.skills.DELETE,
  RPC_CHANNELS.skills.OPEN_EDITOR,
  RPC_CHANNELS.skills.OPEN_FINDER,
  RPC_CHANNELS.skills.EXTRACT_ZIP,
  RPC_CHANNELS.skills.RESOLVE_REMOTE,
  RPC_CHANNELS.skills.INSTALL_MARKETPLACE,
  RPC_CHANNELS.skills.UPDATE_MARKETPLACE,
  RPC_CHANNELS.skills.PUBLISH_MARKETPLACE,
  RPC_CHANNELS.skills.PUBLISH_DIRECT_MARKETPLACE,
  RPC_CHANNELS.skills.LIST_MARKET,
  RPC_CHANNELS.skills.UPLOAD_MARKET,
  RPC_CHANNELS.skills.INSTALL_MARKET,
  RPC_CHANNELS.skills.DELETE_MARKET,
  RPC_CHANNELS.skills.FETCH_MARKET_CONTENT,
  RPC_CHANNELS.skills.INSTALL_LOCAL_ZIP,
] as const

export function registerSkillsHandlers(server: RpcServer, deps: HandlerDeps): void {
  async function pushSkillsChanged(workspaceId: string, workspaceRoot: string): Promise<void> {
    const { loadAllSkills } = await import('@craft-agent/shared/skills')
    const skills = loadAllSkills(workspaceRoot)
    pushTyped(server, RPC_CHANNELS.skills.CHANGED, { to: 'workspace', workspaceId }, workspaceId, skills)
  }

  async function installSkillMcpSources(workspaceId: string, workspaceRoot: string, metadata: SkillMetadata): Promise<void> {
    const {
      createMcpSourcesFromCandidates,
      defaultMcpPostCreateConnectionTester,
      stdioCommandFingerprint,
    } = await import('@craft-agent/shared/sources')
    const { extractMcpSourceCandidatesFromSkillMetadata } = await import('@craft-agent/shared/skills')

    const candidates = extractMcpSourceCandidatesFromSkillMetadata(metadata, workspaceRoot)
    if (candidates.length === 0) return

    const confirmedStdioCommands: Record<string, true> = {}
    const importCandidates = candidates.map((candidate) => {
      if (candidate.duplicate?.sourceSlug) {
        addSlugToWorkspaceDefaults(workspaceRoot, candidate.duplicate.sourceSlug)
        return { ...candidate, action: { type: 'skip' as const } }
      }
      if (candidate.input.mcp?.transport === 'stdio' && candidate.input.mcp.command) {
        const fingerprint = stdioCommandFingerprint(candidate.input.mcp.command, candidate.input.mcp.args)
        confirmedStdioCommands[fingerprint] = true
      }
      return candidate
    })

    const result = await createMcpSourcesFromCandidates(workspaceRoot, importCandidates, {
      connectionTester: defaultMcpPostCreateConnectionTester,
      confirmedStdioCommands: Object.keys(confirmedStdioCommands).length > 0 ? confirmedStdioCommands : undefined,
    })

    for (const created of result.results) {
      if (!created.success || 'skipped' in created) continue
      addSlugToWorkspaceDefaults(workspaceRoot, created.sourceSlug)
    }

    pushTyped(server, RPC_CHANNELS.sources.CHANGED, { to: 'workspace', workspaceId }, workspaceId, loadWorkspaceSources(workspaceRoot))
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
    const { loadAllSkills, invalidateSkillsCache } = await import('@craft-agent/shared/skills')
    invalidateSkillsCache()
    const skills = loadAllSkills(workspace.rootPath, effectiveWorkingDir)
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

  // Create a skill (defaults to global ~/.agents/skills)
  server.handle(
    RPC_CHANNELS.skills.CREATE,
    async (_ctx, workspaceId: string, slug: string, metadata: SkillMetadata, content: string, scope: 'global' | 'workspace' = 'global') => {
      const workspace = getWorkspaceByNameOrId(workspaceId)
      if (!workspace) throw new Error('Workspace not found')

      const { createSkill, GLOBAL_AGENT_SKILLS_DIR } = await import('@craft-agent/shared/skills')
      const rootPath = scope === 'global' ? join(GLOBAL_AGENT_SKILLS_DIR, '..') : workspace.rootPath
      const result = createSkill(rootPath, slug, metadata, content)
      if ('created' in result) {
        await installSkillMcpSources(workspace.id, workspace.rootPath, metadata)
        await pushSkillsChanged(workspace.id, workspace.rootPath)
      }
      return result
    }
  )

  // Create or replace a skill (defaults to global ~/.agents/skills)
  server.handle(
    RPC_CHANNELS.skills.FORCE_WRITE,
    async (_ctx, workspaceId: string, slug: string, metadata: SkillMetadata, content: string, scope: 'global' | 'workspace' = 'global') => {
      const workspace = getWorkspaceByNameOrId(workspaceId)
      if (!workspace) throw new Error('Workspace not found')

      const { forceWriteSkill, GLOBAL_AGENT_SKILLS_DIR } = await import('@craft-agent/shared/skills')
      const rootPath = scope === 'global' ? join(GLOBAL_AGENT_SKILLS_DIR, '..') : workspace.rootPath
      const result = forceWriteSkill(rootPath, slug, metadata, content)
      await installSkillMcpSources(workspace.id, workspace.rootPath, metadata)
      await pushSkillsChanged(workspace.id, workspace.rootPath)
      return result
    }
  )

  // Delete a skill — routes by source to the correct directory
  server.handle(RPC_CHANNELS.skills.DELETE, async (
    _ctx,
    workspaceId: string,
    skillSlug: string,
    source: 'global' | 'workspace' | 'project' = 'workspace',
    skillPath?: string,
  ) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error('Workspace not found')

    const { deleteSkill, GLOBAL_AGENT_SKILLS_DIR, invalidateSkillsCache } = await import('@craft-agent/shared/skills')

    if (source === 'global') {
      deleteSkill(join(GLOBAL_AGENT_SKILLS_DIR, '..'), skillSlug)
    } else if (source === 'workspace') {
      deleteSkill(workspace.rootPath, skillSlug)
    } else if (source === 'project' && skillPath) {
      const { rmSync } = await import('fs')
      if (existsSync(skillPath)) {
        rmSync(skillPath, { recursive: true })
        invalidateSkillsCache()
      }
    }

    deps.platform.logger?.info(`Deleted skill: ${skillSlug} (source: ${source})`)
    await pushSkillsChanged(workspace.id, workspace.rootPath)
  })

  // Open skill SKILL.md in editor
  server.handle(RPC_CHANNELS.skills.OPEN_EDITOR, async (_ctx, workspaceId: string, skillSlug: string) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error('Workspace not found')
    if (workspace.remoteServer) throw new Error('Open in editor is not available for remote workspaces')

    const { getWorkspaceSkillsPath } = await import('@craft-agent/shared/workspaces')
    const { GLOBAL_AGENT_SKILLS_DIR } = await import('@craft-agent/shared/skills')

    const workspaceSkillFile = join(getWorkspaceSkillsPath(workspace.rootPath), skillSlug, 'SKILL.md')
    const globalSkillFile = join(GLOBAL_AGENT_SKILLS_DIR, skillSlug, 'SKILL.md')
    const skillFile = existsSync(workspaceSkillFile) ? workspaceSkillFile : globalSkillFile
    await deps.platform.openPath?.(skillFile)
  })

  // Open skill folder in Finder/Explorer
  server.handle(RPC_CHANNELS.skills.OPEN_FINDER, async (_ctx, workspaceId: string, skillSlug: string) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error('Workspace not found')
    if (workspace.remoteServer) throw new Error('Show in Finder is not available for remote workspaces')

    const { getWorkspaceSkillsPath } = await import('@craft-agent/shared/workspaces')
    const { GLOBAL_AGENT_SKILLS_DIR } = await import('@craft-agent/shared/skills')

    const workspaceSkillDir = join(getWorkspaceSkillsPath(workspace.rootPath), skillSlug)
    const globalSkillDir = join(GLOBAL_AGENT_SKILLS_DIR, skillSlug)
    const skillDir = existsSync(workspaceSkillDir) ? workspaceSkillDir : globalSkillDir
    await deps.platform.showItemInFolder?.(skillDir)
  })

  // Extract skills from a local .zip file
  server.handle(RPC_CHANNELS.skills.EXTRACT_ZIP, async (_ctx, zipPath: string) => {
    const { extractSkillsFromZip } = await import('@craft-agent/shared/skills')
    return extractSkillsFromZip(zipPath)
  })

  // Resolve skills from a remote URL, shorthand, or git remote
  server.handle(RPC_CHANNELS.skills.RESOLVE_REMOTE, async (_ctx, input: string) => {
    const { resolveRemoteSkills } = await import('@craft-agent/shared/skills')
    return resolveRemoteSkills(input)
  })

  server.handle(RPC_CHANNELS.skills.INSTALL_MARKETPLACE, async (_ctx, workspaceId: string, input: import('@craft-agent/shared/skills').MarketplaceSkillInstallInput) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error('Workspace not found')

    const { installMarketplaceSkillFromIntent, loadSkill } = await import('@craft-agent/shared/skills')
    const result = await installMarketplaceSkillFromIntent(workspace.rootPath, input)
    if (result.status === 'installed' || result.status === 'install-complete-failed') {
      const skill = loadSkill(workspace.rootPath, result.slug)
      if (skill) {
        await installSkillMcpSources(workspace.id, workspace.rootPath, skill.metadata)
      }
      await pushSkillsChanged(workspace.id, workspace.rootPath)
    }
    return result
  })

  server.handle(RPC_CHANNELS.skills.UPDATE_MARKETPLACE, async (_ctx, workspaceId: string, input: import('@craft-agent/shared/skills').MarketplaceSkillUpdateInput) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error('Workspace not found')

    const { applyMarketplaceSkillUpdateFromIntent, loadSkill } = await import('@craft-agent/shared/skills')
    const result = await applyMarketplaceSkillUpdateFromIntent(workspace.rootPath, input)
    if (result.status === 'installed' || result.status === 'install-complete-failed') {
      const skill = loadSkill(workspace.rootPath, result.slug)
      if (skill) {
        await installSkillMcpSources(workspace.id, workspace.rootPath, skill.metadata)
      }
      await pushSkillsChanged(workspace.id, workspace.rootPath)
    }
    return result
  })

  server.handle(RPC_CHANNELS.skills.PUBLISH_MARKETPLACE, async (_ctx, workspaceId: string, input: import('@craft-agent/shared/skills').MarketplaceLocalSkillPublishInput) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error('Workspace not found')

    const { publishLocalSkillToMarketplaceService, resolveMarketplaceServiceConfig } = await import('@craft-agent/shared/skills')
    const serviceConfig = resolveMarketplaceServiceConfig()
    const result = await publishLocalSkillToMarketplaceService(workspace.rootPath, input, {
      baseUrl: serviceConfig.baseUrl,
    })
    if (result.status === 'published') {
      await pushSkillsChanged(workspace.id, workspace.rootPath)
    }
    return result
  })

  server.handle(RPC_CHANNELS.skills.PUBLISH_DIRECT_MARKETPLACE, async (_ctx, workspaceId: string, input: import('@craft-agent/shared/skills').MarketplaceDirectSkillPublishInput) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error('Workspace not found')

    const { publishDirectSkillToMarketplaceService, resolveMarketplaceServiceConfig } = await import('@craft-agent/shared/skills')
    const serviceConfig = resolveMarketplaceServiceConfig()
    return publishDirectSkillToMarketplaceService(input, {
      baseUrl: serviceConfig.baseUrl,
    })
  })

  // ── CoPaw market service handlers ──────────────────────────────────────────

  /** Fetch the full catalogue from the CoPaw market service. */
  server.handle(RPC_CHANNELS.skills.LIST_MARKET, async () => {
    const { SsoCredentialStore } = await import('@craft-agent/shared/auth')
    const { listCopawMarketSkills, COPAW_MARKET_BASE_URL } = await import('@craft-agent/shared/skills')

    const session = await new SsoCredentialStore().load()
    if (!session) throw new Error('未登录，无法获取市场技能列表')

    return listCopawMarketSkills(COPAW_MARKET_BASE_URL, session.token)
  })

  /** Upload/publish a skill to the CoPaw market service. */
  server.handle(RPC_CHANNELS.skills.UPLOAD_MARKET, async (_ctx, input: import('@craft-agent/shared/skills').CopawMarketUploadInput) => {
    const { SsoCredentialStore } = await import('@craft-agent/shared/auth')
    const {
      uploadCopawMarketSkill,
      generateMarketSkillVersion,
      COPAW_MARKET_BASE_URL,
      bundleSkillDir,
      GLOBAL_AGENT_SKILLS_DIR,
    } = await import('@craft-agent/shared/skills')

    const session = await new SsoCredentialStore().load()
    if (!session) throw new Error('未登录，无法发布技能')

    const version = generateMarketSkillVersion()

    let zipBytes: Uint8Array
    if (input.zipBytes && input.zipBytes.length > 0) {
      // Path B: user uploaded a zip file directly
      zipBytes = input.zipBytes
    } else if (input.skillSlug) {
      // Path A: bundle from an existing local skill directory
      const { join } = await import('path')
      let skillDir: string
      if (input.skillSource === 'global') {
        skillDir = join(GLOBAL_AGENT_SKILLS_DIR, input.skillSlug)
      } else if (input.workspaceId) {
        const workspace = getWorkspaceByNameOrId(input.workspaceId)
        if (!workspace) throw new Error('Workspace not found')
        const { getWorkspaceSkillsPath } = await import('@craft-agent/shared/workspaces')
        skillDir = join(getWorkspaceSkillsPath(workspace.rootPath), input.skillSlug)
      } else {
        throw new Error('workspaceId is required for non-global skills')
      }
      zipBytes = bundleSkillDir(skillDir)
    } else {
      throw new Error('zipBytes 或 skillSlug 必须提供其中一个')
    }

    return uploadCopawMarketSkill(
      {
        name: input.name,
        chineseName: input.chineseName,
        description: input.description,
        tag: input.tag,
        userName: session.userName,
        employeeId: session.employeeId,
        version,
      },
      zipBytes,
      COPAW_MARKET_BASE_URL,
      session.token,
    )
  })

  /**
   * Install a market skill locally.
   * Downloads the zip and extracts all files as-is into the global skills directory,
   * preserving the original SKILL.md content and all other files without modification.
   */
  server.handle(RPC_CHANNELS.skills.INSTALL_MARKET, async (
    _ctx,
    workspaceId: string,
    skillName: string,
    chineseName: string,
    description: string,
    version?: string,
  ) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error('Workspace not found')

    const { SsoCredentialStore } = await import('@craft-agent/shared/auth')
    const { downloadCopawMarketSkillZip, COPAW_MARKET_BASE_URL, GLOBAL_AGENT_SKILLS_DIR, invalidateSkillsCache, extractSkillsFromZipBytes, unzipSyncEncoding } = await import('@craft-agent/shared/skills')
    const { join, dirname, isAbsolute } = await import('path')
    const { mkdirSync, writeFileSync } = await import('fs')

    const session = await new SsoCredentialStore().load()
    if (!session) throw new Error('未登录，无法安装技能')

    // Download zip from market
    const zipBytes = await downloadCopawMarketSkillZip(skillName, COPAW_MARKET_BASE_URL, session.token, version)
    const unzipped = unzipSyncEncoding(zipBytes)

    // Collect valid entries (filter __MACOSX and path traversal)
    const entries: Array<{ relPath: string; data: Uint8Array }> = []
    for (const [filePath, data] of Object.entries(unzipped)) {
      const normalized = filePath.replace(/\\/g, '/')
      if (normalized.startsWith('__MACOSX/') || normalized.includes('/__MACOSX/')) continue
      if (isAbsolute(normalized) || normalized.split('/').some((p) => p === '..')) continue
      if (normalized.endsWith('/')) continue
      entries.push({ relPath: normalized, data })
    }

    // Strip subdirectory wrapper if SKILL.md is not at root (e.g. zip has A/SKILL.md instead of SKILL.md)
    let stripPrefix = ''
    const hasRootSkillMd = entries.some((e) => e.relPath.toLowerCase() === 'skill.md')
    if (!hasRootSkillMd) {
      const wrapped = entries.find((e) => /^[^/]+\/skill\.md$/i.test(e.relPath))
      if (wrapped) stripPrefix = wrapped.relPath.slice(0, wrapped.relPath.lastIndexOf('/') + 1)
    }

    // Write all files to skill directory
    const skillDir = join(GLOBAL_AGENT_SKILLS_DIR, skillName)
    mkdirSync(skillDir, { recursive: true })

    for (const { relPath, data } of entries) {
      let destRelPath = relPath
      if (stripPrefix) {
        if (!relPath.startsWith(stripPrefix)) continue
        destRelPath = relPath.slice(stripPrefix.length)
      }
      if (!destRelPath) continue

      const destPath = join(skillDir, destRelPath)
      mkdirSync(dirname(destPath), { recursive: true })
      writeFileSync(destPath, data)
    }

    // Sync display_name with chineseName from marketplace database
    const { readFileSync: readFS, existsSync: existsFS } = await import('fs')
    const skillMdPath = join(skillDir, 'SKILL.md')
    if (existsFS(skillMdPath) && chineseName) {
      const { default: matter } = await import('gray-matter')
      const parsed = matter(readFS(skillMdPath, 'utf-8'))
      if (parsed.data.display_name !== chineseName) {
        parsed.data.display_name = chineseName
        writeFileSync(skillMdPath, matter.stringify(parsed.content, parsed.data))
      }
    }

    const discoveredSkills = extractSkillsFromZipBytes(zipBytes, {
      sourcePath: `${skillName}.zip`,
      rootSlug: skillName,
    })
    const discoveredSkill = discoveredSkills.find((skill) => skill.slug === skillName) ?? discoveredSkills[0]

    invalidateSkillsCache()
    if (discoveredSkill) {
      await installSkillMcpSources(workspace.id, workspace.rootPath, discoveredSkill.metadata)
    }
    await pushSkillsChanged(workspace.id, workspace.rootPath)

    return { imported: [skillName], count: 1, conflicts: [] }
  })

  /**
   * Fetch SKILL.md content for a market skill preview.
   * Downloads the zip in-memory, extracts SKILL.md, returns the content string.
   * Nothing is written to disk.
   */
  server.handle(RPC_CHANNELS.skills.FETCH_MARKET_CONTENT, async (_ctx, skillName: string, version?: string) => {
    const { SsoCredentialStore } = await import('@craft-agent/shared/auth')
    const { downloadCopawMarketSkillZip, COPAW_MARKET_BASE_URL, unzipSyncEncoding } = await import('@craft-agent/shared/skills')

    const session = await new SsoCredentialStore().load()
    if (!session) throw new Error('未登录，无法获取技能内容')

    const zipBytes = await downloadCopawMarketSkillZip(skillName, COPAW_MARKET_BASE_URL, session.token, version)
    const unzipped = unzipSyncEncoding(zipBytes)

    const skillMdKey = Object.keys(unzipped).find((k) =>
      k.toLowerCase() === 'skill.md' || k.toLowerCase().match(/^[^/]+\/skill\.md$/)
    )
    if (!skillMdKey) throw new Error('zip 中未找到 SKILL.md 文件')

    const raw = new TextDecoder().decode(unzipped[skillMdKey])
    try {
      const { default: matter } = await import('gray-matter')
      const parsed = matter(raw)
      const extraMetadata = parsed.data.metadata as Record<string, unknown> | undefined
      return { content: parsed.content, extraMetadata }
    } catch {
      return { content: raw }
    }
  })

  /**
   * Install a skill from raw zip bytes into the global skills directory.
   * Writes all zip entries as-is — no SKILL.md parsing or matter.stringify.
   * Used by the local skill upload flow to preserve all SKILL.md frontmatter fields.
   */
  server.handle(RPC_CHANNELS.skills.INSTALL_LOCAL_ZIP, async (
    _ctx,
    workspaceId: string,
    skillName: string,
    zipBytes: Uint8Array,
  ) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error('Workspace not found')

    const { GLOBAL_AGENT_SKILLS_DIR, invalidateSkillsCache, extractSkillsFromZipBytes, unzipSyncEncoding } = await import('@craft-agent/shared/skills')
    const { join, dirname, isAbsolute } = await import('path')
    const { mkdirSync, writeFileSync } = await import('fs')

    const unzipped = unzipSyncEncoding(zipBytes)

    // Collect valid entries (filter __MACOSX and path traversal)
    const entries: Array<{ relPath: string; data: Uint8Array }> = []
    for (const [filePath, data] of Object.entries(unzipped)) {
      const normalized = filePath.replace(/\\/g, '/')
      if (normalized.startsWith('__MACOSX/') || normalized.includes('/__MACOSX/')) continue
      if (isAbsolute(normalized) || normalized.split('/').some((p) => p === '..')) continue
      if (normalized.endsWith('/')) continue
      entries.push({ relPath: normalized, data })
    }

    // Strip subdirectory wrapper if SKILL.md is not at root (e.g. zip has slug/SKILL.md)
    let stripPrefix = ''
    const hasRootSkillMd = entries.some((e) => e.relPath.toLowerCase() === 'skill.md')
    if (!hasRootSkillMd) {
      const wrapped = entries.find((e) => /^[^/]+\/skill\.md$/i.test(e.relPath))
      if (wrapped) stripPrefix = wrapped.relPath.slice(0, wrapped.relPath.lastIndexOf('/') + 1)
    }

    // Write all files to skill directory preserving original bytes
    const skillDir = join(GLOBAL_AGENT_SKILLS_DIR, skillName)
    mkdirSync(skillDir, { recursive: true })

    for (const { relPath, data } of entries) {
      let destRelPath = relPath
      if (stripPrefix) {
        if (!relPath.startsWith(stripPrefix)) continue
        destRelPath = relPath.slice(stripPrefix.length)
      }
      if (!destRelPath) continue

      const destPath = join(skillDir, destRelPath)
      mkdirSync(dirname(destPath), { recursive: true })
      writeFileSync(destPath, data)
    }

    const discoveredSkills = extractSkillsFromZipBytes(zipBytes, {
      sourcePath: `${skillName}.zip`,
      rootSlug: skillName,
    })
    const discoveredSkill = discoveredSkills.find((skill) => skill.slug === skillName) ?? discoveredSkills[0]

    invalidateSkillsCache()
    if (discoveredSkill) {
      await installSkillMcpSources(workspace.id, workspace.rootPath, discoveredSkill.metadata)
    }
    await pushSkillsChanged(workspace.id, workspace.rootPath)

    return { slug: skillName }
  })

  /** Delete a skill from the CoPaw market service. */
  server.handle(RPC_CHANNELS.skills.DELETE_MARKET, async (_ctx, skillName: string) => {
    const { SsoCredentialStore } = await import('@craft-agent/shared/auth')
    const { deleteCopawMarketSkill, COPAW_MARKET_BASE_URL } = await import('@craft-agent/shared/skills')

    const session = await new SsoCredentialStore().load()
    if (!session) throw new Error('未登录，无法删除技能')

    await deleteCopawMarketSkill(skillName, COPAW_MARKET_BASE_URL, session.token)
    return { success: true }
  })
}

function addSlugToWorkspaceDefaults(workspaceRootPath: string, slug: string): void {
  const wsConfig = loadWorkspaceConfig(workspaceRootPath)
  if (!wsConfig) return
  wsConfig.defaults ??= {}
  wsConfig.defaults.enabledSourceSlugs ??= []
  if (!wsConfig.defaults.enabledSourceSlugs.includes(slug)) {
    wsConfig.defaults.enabledSourceSlugs.push(slug)
    saveWorkspaceConfig(workspaceRootPath, wsConfig)
  }
}
