import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import { PromptCompiler } from '@craft-agent/shared/prompts/owner/compiler'
import type { CompileOptions, CompileResult } from '@craft-agent/shared/prompts/owner/types'
import type { RpcServer, RequestContext } from '@craft-agent/server-core/transport'
import type { HandlerDeps } from './handler-deps'
import { getMemoryRepository } from './memory'
import { watch } from 'node:fs'
import { readFile, access, constants } from 'node:fs/promises'
import { join, basename } from 'node:path'

const MAX_CONTEXT_FILE_SIZE = 50_000  // 50 KB cap per file

/** Files to scan for in the workspace root and inject into project-context. */
const CONTEXT_FILE_CANDIDATES = ['AGENTS.md', 'CLAUDE.md']

let compiler: PromptCompiler | null = null

function getCompiler(): PromptCompiler {
  if (!compiler) {
    compiler = new PromptCompiler()
  }
  return compiler
}

/**
 * Resolve the project root directory and scan for AGENTS.md / CLAUDE.md.
 *
 * Strategy:
 *   1. Start with the workspace rootPath (the workspace config/metadata directory
 *      in the ARCHstudio data folder).
 *   2. If no AGENTS.md/CLAUDE.md are found there, walk up looking for a `.git`
 *      directory — a reliable marker for the true project root — and scan there.
 *   3. If even that fails, just report the working directory so the project-context
 *      layer isn't entirely empty.
 *
 * Returns context files ready to inject into CompileOptions.projectContext,
 * or `undefined` when the workspace cannot be resolved.
 */
async function resolveWorkspaceContextFiles(
  ctx: RequestContext,
  deps: HandlerDeps,
): Promise<{ workingDirectory?: string; contextFiles?: { filename: string; content: string }[] } | undefined> {
  if (!ctx.workspaceId) return undefined

  // Find the active workspace
  const workspaces = deps.sessionManager.getWorkspaces()
  const workspace = workspaces.find((w) => w.id === ctx.workspaceId)
  if (!workspace?.rootPath) return undefined

  async function scanDirectory(dir: string): Promise<{ workingDirectory: string; contextFiles?: { filename: string; content: string }[] } | null> {
    const found: { filename: string; content: string }[] = []
    for (const filename of CONTEXT_FILE_CANDIDATES) {
      const fullPath = join(dir, filename)
      try {
        await access(fullPath, constants.R_OK)
        const content = await readFile(fullPath, 'utf-8')
        if (content.length > MAX_CONTEXT_FILE_SIZE) {
          console.warn(`[prompts] ${filename} is ${content.length} bytes — truncating to ${MAX_CONTEXT_FILE_SIZE}`)
        }
        found.push({
          filename,
          content: content.slice(0, MAX_CONTEXT_FILE_SIZE),
        })
      } catch {
        // File doesn't exist or can't be read — skip gracefully
      }
    }
    if (found.length > 0) {
      return { workingDirectory: dir, contextFiles: found }
    }
    return null
  }

  // Phase 1: scan workspace rootPath directly
  const workspaceDir = workspace.rootPath
  const directResult = await scanDirectory(workspaceDir)
  if (directResult) return directResult

  // Phase 2: walk up from workspace rootPath looking for a .git directory,
  // which marks the true project root. Limit to 5 levels to avoid runaway.
  let candidate = workspaceDir
  for (let i = 0; i < 5; i++) {
    const parent = join(candidate, '..')
    const normalized = join(parent, '.git')
    try {
      await access(normalized, constants.R_OK)
      // Found a .git marker — scan the project root
      const result = await scanDirectory(parent)
      if (result) return result
      // .git exists but no AGENTS.md/CLAUDE.md found there — still report
      // the project root as working directory so the layer shows something.
      return { workingDirectory: parent }
    } catch {
      // No .git here — continue walking up
      const prevCandidate = candidate
      candidate = parent
      // Stop if we've hit the filesystem root (parent didn't change)
      if (candidate === prevCandidate) break
    }
  }

  // Phase 3: fallback — report the workspace directory without context files
  return { workingDirectory: workspaceDir }
}

// ── Context file watcher ────────────────────────────────────────────────
// Fires `RPC_CHANNELS.prompts.CONTEXT_FILES_CHANGED` when AGENTS.md or
// CLAUDE.md changes on disk. Idempotent: multiple calls to
// `startContextFileWatcher` replace the previous watcher without leaking
// old handles.

let contextFileWatcher: ReturnType<typeof watch> | null = null

function startContextFileWatcher(watchDir: string, server: RpcServer): void {
  // Clean up any previous watcher
  if (contextFileWatcher) {
    contextFileWatcher.close()
    contextFileWatcher = null
  }

  try {
    contextFileWatcher = watch(watchDir, (eventType, filename) => {
      if (!filename) return
      const name = basename(filename)
      if (name === 'AGENTS.md' || name === 'CLAUDE.md' || name === 'agents.md' || name === 'claude.md') {
        console.log(`[prompts] Context file changed: ${filename} (${eventType})`)
        // Invalidate the compiler cache so the next compile() call
        // re-reads the changed files from disk instead of returning
        // stale cached content for the project-context layer.
        getCompiler().invalidateAll()
        // Push the event to all connected renderers
        server.push(RPC_CHANNELS.prompts.CONTEXT_FILES_CHANGED, { to: 'all' })
      }
    })

    // Listen for errors (e.g. the watched directory was deleted).
    // Log the error, clean up the watcher, and set the reference to null
    // so the next startContextFileWatcher call can start fresh.
    contextFileWatcher.on('error', (err) => {
      console.error(`[prompts] Context file watcher error on ${watchDir}:`, err)
      contextFileWatcher?.close()
      contextFileWatcher = null
    })

    console.log(`[prompts] Context file watcher started on ${watchDir}`)
  } catch (err) {
    console.error('[prompts] Failed to start context file watcher:', err)
  }
}

export const CORE_HANDLED_CHANNELS = [
  RPC_CHANNELS.prompts.COMPILE,
  RPC_CHANNELS.prompts.INVALIDATE,
  RPC_CHANNELS.prompts.RESOLVE_CONTEXT,
] as const

export function registerPromptHandlers(server: RpcServer, deps: HandlerDeps): void {
  server.handle(RPC_CHANNELS.prompts.RESOLVE_CONTEXT, async (ctx) => {
    // Start the file watcher when a client resolves context — this runs when
    // the Prompt Studio mounts. Idempotent: replaces any previous watcher.
    // Start the file watcher only when we can resolve the workspace root
    const workspaceCtx = await resolveWorkspaceContextFiles(ctx, deps)
    if (workspaceCtx?.workingDirectory) {
      startContextFileWatcher(workspaceCtx.workingDirectory, server)
    }
    return workspaceCtx ?? null
  })

  server.handle(RPC_CHANNELS.prompts.INVALIDATE, async (): Promise<{ success: boolean }> => {
    const c = getCompiler()
    c.invalidateAll()
    return { success: true }
  })

  server.handle(RPC_CHANNELS.prompts.COMPILE, async (ctx, options: CompileOptions = {}): Promise<CompileResult> => {
    const c = getCompiler()

    // ── 1. Auto-inject workspace context files (AGENTS.md / CLAUDE.md) ──
    // Only auto-inject when the caller didn't provide their own context files
    // and didn't explicitly set a working directory (which indicates they want
    // full control over the project-context layer).
    const hasExplicitProjectContext = !!(
      options.projectContext?.contextFiles?.length ??
      options.projectContext?.workingDirectory
    )
    if (!hasExplicitProjectContext) {
      try {
        const workspaceCtx = await resolveWorkspaceContextFiles(ctx, deps)
        if (workspaceCtx) {
          options = {
            ...options,
            projectContext: workspaceCtx,
          }
        }
      } catch (err) {
        console.error('[prompts] Failed to resolve workspace context files:', err)
        // Non-fatal — compile without workspace context
      }
    }

    // ── 2. Auto-inject memories from the shared FTS5 repository ──
    const layerOrder = options.layerOrder
    const hasMemoryLayer = !layerOrder || layerOrder.includes('memory')
    if (hasMemoryLayer && !options.memories) {
      try {
        const repo = await getMemoryRepository()
        const results = await repo.searchMemories({
          query: '',
          limit: 10,
          class: undefined,
          scopeId: undefined,
        })
        options = {
          ...options,
          memories: results.map((r) => ({
            title: r.title ?? 'Memory',
            content: r.content ?? '',
            score: r.score ?? 0,
          })),
        }
      } catch (err) {
        console.error('[prompts] Failed to fetch memories:', err)
        // Continue without memories — non-fatal
      }
    }

    return c.compile(options)
  })
}
