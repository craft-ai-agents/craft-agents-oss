import { resolve } from 'path'
import { join } from 'path'
import { homedir } from 'os'
import { execSync } from 'child_process'
import { existsSync, readFileSync } from 'fs'
import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import type { GitStatusResult, GitStatusFileEntry, GitFileDiffResult } from '@craft-agent/shared/protocol'
import { getWorkspaceByNameOrId, getGitBashPath, setGitBashPath, clearGitBashPath } from '@craft-agent/shared/config'
import { classifyExternalUrl, formatBlockedUrlError } from '@craft-agent/shared/utils/url-safety'
import { isUsableGitBashPath, validateGitBashPath } from '@craft-agent/server-core/services'
import { validateFilePath, getWorkspaceAllowedDirs } from '@craft-agent/server-core/handlers'
import type { RpcServer } from '@craft-agent/server-core/transport'
import type { HandlerDeps } from '../handler-deps'
import {
  requestClientOpenExternal,
  requestClientOpenPath,
  requestClientShowInFolder,
  requestClientOpenFileDialog,
} from '@craft-agent/server-core/transport'

export const CORE_HANDLED_CHANNELS = [
  RPC_CHANNELS.theme.GET_SYSTEM_PREFERENCE,
  RPC_CHANNELS.system.VERSIONS,
  RPC_CHANNELS.system.HOME_DIR,
  RPC_CHANNELS.system.IS_DEBUG_MODE,
  RPC_CHANNELS.debug.LOG,
  RPC_CHANNELS.shell.OPEN_URL,
  RPC_CHANNELS.shell.OPEN_FILE,
  RPC_CHANNELS.shell.SHOW_IN_FOLDER,
  RPC_CHANNELS.releaseNotes.GET,
  RPC_CHANNELS.releaseNotes.GET_LATEST_VERSION,
  RPC_CHANNELS.git.GET_BRANCH,
  RPC_CHANNELS.git.STATUS,
  RPC_CHANNELS.git.FILE_DIFF,
  RPC_CHANNELS.gitbash.CHECK,
  RPC_CHANNELS.gitbash.BROWSE,
  RPC_CHANNELS.gitbash.SET_PATH,
] as const

interface ParsedInternalDeepLink {
  navigation?: {
    view?: string
    action?: string
    actionParams?: Record<string, string>
  }
  workspaceId?: string
  /** Use client shell.openExternal fallback (e.g. window=focused links). */
  requiresExternalOpen?: boolean
  /** True when URL is intentionally consumed without navigation (auth callbacks). */
  handledNoop?: boolean
}

const COMPOUND_ROUTE_PREFIXES = new Set([
  'allSessions',
  'flagged',
  'state',
  'sources',
  'settings',
  'skills',
])

function collectDeepLinkParams(parsed: URL, pathId?: string): Record<string, string> | undefined {
  const params: Record<string, string> = {}
  if (pathId) params.id = pathId

  parsed.searchParams.forEach((value, key) => {
    if (key === 'window' || key === 'sidebar') return
    params[key] = value
  })

  return Object.keys(params).length > 0 ? params : undefined
}

function parseInternalCraftAgentsDeepLink(parsed: URL): ParsedInternalDeepLink | null {
  if (parsed.protocol !== 'craftagents:') return null

  const host = parsed.hostname
  const pathParts = parsed.pathname.split('/').filter(Boolean)
  const windowMode = parsed.searchParams.get('window')

  // Preserve window-specific behavior via OS protocol path.
  if (windowMode === 'focused' || windowMode === 'full') {
    return { requiresExternalOpen: true }
  }

  // OAuth callback links are handled by auth flow code paths.
  if (host === 'auth-callback') {
    return { handledNoop: true }
  }

  if (COMPOUND_ROUTE_PREFIXES.has(host)) {
    const viewRoute = pathParts.length > 0 ? `${host}/${pathParts.join('/')}` : host
    return { navigation: { view: viewRoute } }
  }

  if (host === 'action') {
    const action = pathParts[0]
    if (!action) return null

    const actionParams = collectDeepLinkParams(parsed, pathParts[1])
    return {
      navigation: {
        action,
        actionParams,
      },
    }
  }

  if (host === 'workspace') {
    const workspaceId = pathParts[0]
    if (!workspaceId) return null

    const routeType = pathParts[1]
    if (!routeType) return null

    if (COMPOUND_ROUTE_PREFIXES.has(routeType)) {
      return {
        workspaceId,
        navigation: { view: pathParts.slice(1).join('/') },
      }
    }

    if (routeType === 'action') {
      const action = pathParts[2]
      if (!action) return null

      return {
        workspaceId,
        navigation: {
          action,
          actionParams: collectDeepLinkParams(parsed, pathParts[3]),
        },
      }
    }
  }

  return null
}

/** Guard: reject filesystem-path actions on remote workspaces where local paths are meaningless. */
function assertLocalWorkspace(ctx: { workspaceId: string | null }, action: string): void {
  const ws = getWorkspaceByNameOrId(ctx.workspaceId ?? '')
  if (ws?.remoteServer) {
    throw new Error(`${action} is not available for remote workspaces`)
  }
}

export function registerSystemCoreHandlers(server: RpcServer, deps: HandlerDeps): void {
  const windowManager = deps.windowManager

  // Get system theme preference (dark = true, light = false)
  server.handle(RPC_CHANNELS.theme.GET_SYSTEM_PREFERENCE, async () => {
    return deps.platform.systemDarkMode?.() ?? false
  })

  // Get runtime versions (previously handled locally in preload via process.versions)
  server.handle(RPC_CHANNELS.system.VERSIONS, async () => {
    return {
      node: process.versions.node,
      chrome: process.versions.chrome ?? undefined,
      electron: process.versions.electron ?? undefined,
    }
  })

  // Get user's home directory
  server.handle(RPC_CHANNELS.system.HOME_DIR, async () => {
    return homedir()
  })

  // Check if running in debug mode (from source)
  server.handle(RPC_CHANNELS.system.IS_DEBUG_MODE, async () => {
    return !deps.platform.isPackaged
  })

  // Release notes
  server.handle(RPC_CHANNELS.releaseNotes.GET, async () => {
    const { getCombinedReleaseNotes } = require('@craft-agent/shared/release-notes') as typeof import('@craft-agent/shared/release-notes')
    return getCombinedReleaseNotes()
  })

  server.handle(RPC_CHANNELS.releaseNotes.GET_LATEST_VERSION, async () => {
    const { getLatestReleaseVersion } = require('@craft-agent/shared/release-notes') as typeof import('@craft-agent/shared/release-notes')
    return getLatestReleaseVersion()
  })

  // Get git branch for a directory (returns null if not a git repo or git unavailable)
  server.handle(RPC_CHANNELS.git.GET_BRANCH, async (_ctx, dirPath: string) => {
    try {
      const branch = execSync('git rev-parse --abbrev-ref HEAD', {
        cwd: dirPath,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 5000,
      }).trim()
      return branch || null
    } catch {
      return null
    }
  })

  // Get full git status for a directory (diff stat + untracked files)
  server.handle(RPC_CHANNELS.git.STATUS, async (_ctx, dirPath: string): Promise<GitStatusResult> => {
    const result: GitStatusResult = {
      branch: null,
      dirPath,
      files: [],
    }

    // Quick check: does .git exist?
    const gitDir = join(dirPath, '.git')
    if (!existsSync(gitDir)) {
      return result
    }

    try {
      // Get branch name
      const branch = execSync('git rev-parse --abbrev-ref HEAD', {
        cwd: dirPath,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 5000,
      }).trim()
      result.branch = branch || null
    } catch {
      // Not a git repo or git unavailable
      return result
    }

    try {
      // Get diff stat for tracked files (unstaged + staged combined)
      const diffOutput = execSync('git diff --stat --ignore-submodules HEAD', {
        cwd: dirPath,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 10000,
        maxBuffer: 1024 * 1024,
      }).trim()

      // Helper: convert porcelain XY char to GitStatusFileEntry.status.
      // Returns null for unhandled codes so the caller can skip them.
      // `U` codes (unmerged / merge-conflict) collapse to 'modified' so the
      // rail shows something instead of hiding the conflict entirely.
      const xyCharToStatus = (c: string): GitStatusFileEntry['status'] | null => {
        switch (c) {
          case 'M': return 'modified'
          case 'A': return 'added'
          case 'D': return 'deleted'
          case 'R': return 'renamed'
          case 'C': return 'copied'
          case 'U': return 'modified'
          default: return null
        }
      }

      // Parse diff stat lines:
      //  "src/foo.ts | 15 +++++++---------"
      //  "src/bar.ts | 2 +-"
      //  "3 files changed, 28 insertions(+), 12 deletions(-)"
      // The stats here are TOTAL vs HEAD for each path. When a file appears
      // in both staged and unstaged buckets, both entries inherit the same
      // counts — we don't have a cheap way to apportion them and the total
      // is what users care about anyway.
      const diffLines = diffOutput.split('\n')
      const fileStats = new Map<string, { insertions: number; deletions: number }>()

      for (const line of diffLines) {
        if (/\d+ files? changed/i.test(line)) continue
        if (!line.trim()) continue

        const match = line.match(/^\s*(.*?)\s*\|\s*(\d+)\s*([+-]+)?$/)
        if (match) {
          const [, filePath, countStr, symbols] = match
          const path = filePath.trim()
          if (!path) continue

          let insertions = 0
          let deletions = 0

          if (symbols) {
            for (const ch of symbols) {
              if (ch === '+') insertions++
              else if (ch === '-') deletions++
            }
          }

          // If no symbols but count > 0 (binary or empty), treat all as insertions
          if (insertions === 0 && deletions === 0 && parseInt(countStr) > 0) {
            insertions = parseInt(countStr)
          }

          fileStats.set(path, { insertions, deletions })
        }
      }

      // Get per-file staged/unstaged status via porcelain.
      // Emit up to 2 entries per path — one for the X side (staged) when
      // non-empty, one for the Y side (unstaged) when non-empty. Untracked
      // (`??`) lands in its own third bucket with a single entry.
      const statusOutput = execSync('git status --porcelain', {
        cwd: dirPath,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 10000,
        maxBuffer: 1024 * 1024,
      }).trim()

      const fileEntries: GitStatusFileEntry[] = []
      const seenBuckets = new Set<string>() // `${path}|${bucket}` — dedupe in case of edge cases

      if (statusOutput) {
        for (const line of statusOutput.split('\n')) {
          if (!line.trim()) continue
          // Format: XY path or XY "quoted path" -> path
          // X = staging area, Y = working tree
          const x = line[0]
          const y = line[1]
          const pathPart = line.substring(3).trim()
          const cleanPath = pathPart.startsWith('"') && pathPart.endsWith('"')
            ? pathPart.slice(1, -1)
            : pathPart
          if (!cleanPath) continue

          // Handle renamed: R old -> new (only valid when X=R)
          const renameMatch = cleanPath.match(/^(.*?)\s+->\s+(.*)$/)
          const path = renameMatch ? renameMatch[2].trim() : cleanPath
          const previousPath = renameMatch ? renameMatch[1].trim() : undefined

          // Untracked (XY = '??') — single entry in its own bucket
          if (x === '?' && y === '?') {
            const key = `${path}|untracked`
            if (!seenBuckets.has(key)) {
              seenBuckets.add(key)
              fileEntries.push({
                path,
                bucket: 'untracked',
                status: 'untracked',
                insertions: 0,
                deletions: 0,
              })
            }
            continue
          }

          const counts = fileStats.get(path) ?? { insertions: 0, deletions: 0 }

          // Staged side (X non-space and non-'?')
          if (x !== ' ' && x !== '?') {
            const stagedStatus = xyCharToStatus(x)
            if (stagedStatus) {
              const key = `${path}|staged`
              if (!seenBuckets.has(key)) {
                seenBuckets.add(key)
                fileEntries.push({
                  path,
                  bucket: 'staged',
                  status: stagedStatus,
                  insertions: counts.insertions,
                  deletions: counts.deletions,
                  ...(stagedStatus === 'renamed' || stagedStatus === 'copied' ? { previousPath } : {}),
                })
              }
            }
          }

          // Unstaged side (Y non-space and non-'?')
          if (y !== ' ' && y !== '?') {
            const unstagedStatus = xyCharToStatus(y)
            if (unstagedStatus) {
              const key = `${path}|unstaged`
              if (!seenBuckets.has(key)) {
                seenBuckets.add(key)
                fileEntries.push({
                  path,
                  bucket: 'unstaged',
                  status: unstagedStatus,
                  insertions: counts.insertions,
                  deletions: counts.deletions,
                })
              }
            }
          }
        }
      }

      // Stable sort: bucket order first (staged → unstaged → untracked),
      // then alphabetical within each bucket.
      const bucketOrder: Record<GitStatusFileEntry['bucket'], number> = {
        staged: 0,
        unstaged: 1,
        untracked: 2,
      }
      result.files = fileEntries.sort((a, b) => {
        const oa = bucketOrder[a.bucket] ?? 99
        const ob = bucketOrder[b.bucket] ?? 99
        if (oa !== ob) return oa - ob
        return a.path.localeCompare(b.path)
      })
    } catch {
      // Diff or status failed — return partial result (branch only)
    }

    return result
  })

  // Get full per-file diff for the Shiki diff viewer in the renderer.
  // Returns both the HEAD and working-tree content (and +/- counts) for a
  // single relative path. Both null → untracked-or-deleted; binary files
  // populate isBinary=true but leave strings null so the renderer can
  // show a textual placeholder instead of garbled text.
  server.handle(RPC_CHANNELS.git.FILE_DIFF, async (_ctx, dirPath: string, relPath: string): Promise<GitFileDiffResult> => {
    const result: GitFileDiffResult = {
      original: null,
      modified: null,
      additions: 0,
      deletions: 0,
      isBinary: false,
    }

    if (!dirPath || !relPath) return result

    // Defence-in-depth: the renderer is supposed to pass a path relative to
    // dirPath, but strip any escape attempt. Resolving to absolute and
    // re-checking that we're still under the working tree is the cheapest
    // check we can do without a vendored safe-join library.
    if (relPath.includes('..')) return result
    const base = resolve(dirPath)
    const abs = resolve(base, relPath)
    if (!(abs === base || abs.startsWith(base + '/') || abs.startsWith(base + '\\'))) return result

    const safeRel = relPath.replace(/"/g, '\\"')

    // HEAD content via `git show HEAD:./<rel>`. Fails for untracked/added files,
    // empty repos, or paths that escape — fall through with original=null.
    try {
      const head = execSync(`git show "HEAD:./${safeRel}"`, {
        cwd: dirPath,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 5000,
        maxBuffer: 1024 * 1024,
      }) as string
      result.original = head
    } catch {
      result.original = null
    }

    // Working-tree content via filesystem read. ENOENT (deleted) → modified=null.
    try {
      if (existsSync(abs)) {
        const buf = readFileSync(abs)
        // Binary sniff — NUL byte in the first 8KB indicates not text.
        const head = buf.subarray(0, Math.min(8192, buf.length))
        let nul = false
        for (let i = 0; i < head.length; i++) {
          if (head[i] === 0) { nul = true; break }
        }
        if (nul) {
          result.isBinary = true
        } else {
          result.modified = buf.toString('utf-8')
        }
      }
    } catch {
      result.modified = null
    }

    // +/− counts (numstat). For binary files git returns "-\t-".
    try {
      const numstat = execSync(`git diff --numstat HEAD -- "${safeRel}"`, {
        cwd: dirPath,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 5000,
      }).trim()
      const m = numstat.match(/^(\d+|-)\s+(\d+|-)/)
      if (m) {
        result.additions = m[1] === '-' ? 0 : parseInt(m[1], 10) || 0
        result.deletions = m[2] === '-' ? 0 : parseInt(m[2], 10) || 0
        if (m[1] === '-' || m[2] === '-') result.isBinary = true
      }
    } catch {
      // ignore — counts default to 0
    }

    return result
  })

  // Git Bash detection and configuration (Windows only)
  server.handle(RPC_CHANNELS.gitbash.CHECK, async () => {
    const platform = process.platform as 'win32' | 'darwin' | 'linux'

    if (platform !== 'win32') {
      return { found: true, path: null, platform }
    }

    const commonPaths = [
      'C:\\Program Files\\Git\\bin\\bash.exe',
      'C:\\Program Files (x86)\\Git\\bin\\bash.exe',
      join(process.env.LOCALAPPDATA || '', 'Programs', 'Git', 'bin', 'bash.exe'),
      join(process.env.PROGRAMFILES || '', 'Git', 'bin', 'bash.exe'),
    ]

    const persistedPath = getGitBashPath()
    if (persistedPath) {
      if (await isUsableGitBashPath(persistedPath)) {
        process.env.CLAUDE_CODE_GIT_BASH_PATH = persistedPath.trim()
        return { found: true, path: persistedPath, platform }
      }
      clearGitBashPath()
    }

    for (const bashPath of commonPaths) {
      if (await isUsableGitBashPath(bashPath)) {
        process.env.CLAUDE_CODE_GIT_BASH_PATH = bashPath
        setGitBashPath(bashPath)
        return { found: true, path: bashPath, platform }
      }
    }

    try {
      const result = execSync('where bash', {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 5000,
      }).trim()
      const firstPath = result.split('\n')[0]?.trim()
      if (firstPath && firstPath.toLowerCase().includes('git') && await isUsableGitBashPath(firstPath)) {
        process.env.CLAUDE_CODE_GIT_BASH_PATH = firstPath
        setGitBashPath(firstPath)
        return { found: true, path: firstPath, platform }
      }
    } catch {
      // where command failed
    }

    delete process.env.CLAUDE_CODE_GIT_BASH_PATH
    return { found: false, path: null, platform }
  })

  server.handle(RPC_CHANNELS.gitbash.BROWSE, async (ctx) => {
    const result = await requestClientOpenFileDialog(server, ctx.clientId, {
      title: 'Select bash.exe',
      filters: [{ name: 'Executable', extensions: ['exe'] }],
      properties: ['openFile'],
      defaultPath: 'C:\\Program Files\\Git\\bin',
    })

    if (result.canceled || result.filePaths.length === 0) {
      return null
    }

    return result.filePaths[0]
  })

  server.handle(RPC_CHANNELS.gitbash.SET_PATH, async (_ctx, bashPath: string) => {
    const validation = await validateGitBashPath(bashPath)
    if (!validation.valid) {
      return { success: false, error: validation.error }
    }

    setGitBashPath(validation.path)
    process.env.CLAUDE_CODE_GIT_BASH_PATH = validation.path
    return { success: true }
  })

  // Debug logging from renderer -> main log file (fire-and-forget, no response)
  server.handle(RPC_CHANNELS.debug.LOG, async (_ctx, ...args: unknown[]) => {
    deps.platform.logger.info('[renderer]', ...args)
  })

  // Shell operations - open URL in external browser (or handle craftagents:// internally)
  server.handle(RPC_CHANNELS.shell.OPEN_URL, async (ctx, url: string) => {
    deps.platform.logger.info('[OPEN_URL] Received request:', url)
    try {
      const classification = classifyExternalUrl(url)
      if (classification.kind === 'dangerous') {
        throw new Error(formatBlockedUrlError(classification))
      }

      const parsed = new URL(url)

      if (classification.kind === 'internal-deeplink') {
        const deepLink = parseInternalCraftAgentsDeepLink(parsed)

        if (deepLink?.handledNoop) {
          deps.platform.logger.info('[OPEN_URL] Ignoring auth-callback deep link in OPEN_URL handler')
          return
        }

        if (deepLink?.navigation?.view || deepLink?.navigation?.action) {
          const target = deepLink.workspaceId && deepLink.workspaceId !== ctx.workspaceId
            ? { to: 'workspace' as const, workspaceId: deepLink.workspaceId }
            : { to: 'client' as const, clientId: ctx.clientId }

          deps.platform.logger.info('[OPEN_URL] Routing craftagents:// URL internally via deeplink:navigate')
          server.push(RPC_CHANNELS.deeplink.NAVIGATE, target, deepLink.navigation)
          return
        }

        // For links requiring window management (e.g. window=focused/full), or
        // unknown deep-link shapes, fall back to the client protocol handler.
        deps.platform.logger.info('[OPEN_URL] Falling back to client openExternal for craftagents:// URL')
        const deepLinkResult = await requestClientOpenExternal(server, ctx.clientId, url)
        if (!deepLinkResult.opened) {
          deps.platform.logger.error(`[OPEN_URL] Client capability failed: ${deepLinkResult.error}`)
          throw new Error(`Cannot open URL on client: ${deepLinkResult.error}`)
        }
        return
      }

      const result = await requestClientOpenExternal(server, ctx.clientId, url)
      if (!result.opened) {
        deps.platform.logger.error(`[OPEN_URL] Client capability failed: ${result.error}`)
        throw new Error(`Cannot open URL on client: ${result.error}`)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      deps.platform.logger.error('openUrl error:', message)
      throw new Error(`Failed to open URL: ${message}`)
    }
  })

  server.handle(RPC_CHANNELS.shell.OPEN_FILE, async (ctx, path: string) => {
    assertLocalWorkspace(ctx, 'Open file')
    try {
      // Expand ~ before resolve() — resolve() treats ~ as a literal path component
      const expanded = path.startsWith('~') ? path.replace(/^~/, homedir()) : path
      const absolutePath = resolve(expanded)
      const safePath = await validateFilePath(absolutePath, getWorkspaceAllowedDirs(ctx.workspaceId))
      const result = await requestClientOpenPath(server, ctx.clientId, safePath)
      if (result.error) throw new Error(result.error)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      deps.platform.logger.error('openFile error:', message)
      throw new Error(`Failed to open file: ${message}`)
    }
  })

  server.handle(RPC_CHANNELS.shell.SHOW_IN_FOLDER, async (ctx, path: string) => {
    assertLocalWorkspace(ctx, 'Show in folder')
    try {
      const expanded = path.startsWith('~') ? path.replace(/^~/, homedir()) : path
      const absolutePath = resolve(expanded)
      const safePath = await validateFilePath(absolutePath, getWorkspaceAllowedDirs(ctx.workspaceId))
      await requestClientShowInFolder(server, ctx.clientId, safePath)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      deps.platform.logger.error('showInFolder error:', message)
      throw new Error(`Failed to show in folder: ${message}`)
    }
  })
}
