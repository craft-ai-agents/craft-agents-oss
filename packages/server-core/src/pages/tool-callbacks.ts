/**
 * Pages Tool Callbacks
 *
 * Backend implementation of the agent-facing pages tools (list_pages,
 * get_page, create_page, update_page, write_page_data, delete_page).
 * SessionManager wires one instance per session, bound to the invoking
 * session's workspace, into the session-scoped tool callback registry.
 *
 * Storage flows are the SAME primitives the pages RPC handlers use
 * (@craft-agent/shared/pages) — including deletePageWithUnpublish, shared
 * verbatim with the pages:delete RPC so the two delete paths cannot drift.
 * Every mutation calls deps.onPagesMutated so the host can poke the config
 * watcher and broadcast `pages:changed`, exactly like the RPC handlers do.
 */

import { existsSync, statSync } from 'node:fs'
import type {
  PagesToolCallbacks,
  PageToolSummary,
  PageToolDetails,
  PageToolDataSummary,
  CreatePageToolInput,
  UpdatePageToolPatch,
  PageDataToolPatch,
} from '@craft-agent/session-tools-core'
import type { LoadedPage, PageConfig, PageDataSnapshot, PageKind, PageRefreshSpec, UpdatePagePatch } from '@craft-agent/shared/pages'
import { isPageGrantUsable } from '@craft-agent/shared/pages/types'

export interface PagesToolCallbacksDeps {
  workspaceId: string
  workspaceRootPath: string
  log?: (message: string) => void
  /**
   * Called after every successful mutation (create/update/write/delete) with
   * the page slug. The host notifies the config watcher and broadcasts
   * `pages:changed` here.
   */
  onPagesMutated?: (pageSlug: string) => void | Promise<void>
  /**
   * Called specifically when a page's HTML content changed (create-with-content
   * or update-with-content) so the host can enqueue a thumbnail (re)capture.
   * Not fired for data-only writes (those don't change the content digest).
   */
  onContentChanged?: (pageSlug: string) => void
}

const PAGE_KINDS: readonly string[] = ['static', 'interactive', 'live']

function assertKind(kind: string | undefined): PageKind | undefined {
  if (kind === undefined) return undefined
  if (!PAGE_KINDS.includes(kind)) {
    throw new Error(`Invalid page kind "${kind}" — expected static | interactive | live`)
  }
  return kind as PageKind
}

function toSummary(page: LoadedPage): PageToolSummary {
  const config = page.config
  return {
    slug: config.slug,
    name: config.name,
    description: config.description,
    kind: config.kind,
    projectId: config.projectId,
    createdAt: config.createdAt,
    updatedAt: config.updatedAt,
    hasContent: existsSync(page.contentPath),
    refresh: config.refresh,
    lastRefresh: config.lastRefresh,
    shared: config.share !== undefined,
    folderPath: page.folderPath,
  }
}

function toDataSummary(page: LoadedPage, snapshot: PageDataSnapshot | null): PageToolDataSummary | null {
  if (!snapshot) return null
  return {
    generatedAt: snapshot.generatedAt,
    kvKeys: Object.keys(snapshot.kv),
    series: Object.entries(snapshot.series).map(([name, points]) => ({
      name,
      points: points.length,
      // Snapshot series are ascending by t — the last point is the newest.
      latest: points.length > 0 ? points[points.length - 1] : undefined,
    })),
    snapshotPath: page.snapshotPath,
  }
}

function toDetails(
  page: LoadedPage,
  options: { includeContent: boolean },
  helpers: {
    readSnapshot: () => PageDataSnapshot | null
    loadContent: () => string | null
  },
): PageToolDetails {
  const config = page.config
  const summary = toSummary(page)

  let contentLength: number | undefined
  if (summary.hasContent) {
    try {
      contentLength = statSync(page.contentPath).size
    } catch {
      contentLength = undefined
    }
  }

  const now = Date.now()
  const grants = (config.grants ?? []).map((grant) => ({
    id: grant.id,
    kind: grant.action.kind,
    ...(grant.action.kind === 'script'
      ? { script: grant.action.script }
      : { sourceSlug: grant.action.sourceSlug }),
    description: grant.description,
    expiresAt: grant.expiresAt,
    stale: !isPageGrantUsable(grant, config.contentDigest, now),
  }))

  return {
    ...summary,
    id: config.id,
    contentDigest: config.contentDigest,
    contentLength,
    contentPath: page.contentPath,
    data: toDataSummary(page, helpers.readSnapshot()),
    grants,
    shareUrl: config.share?.url,
    ...(options.includeContent ? { content: helpers.loadContent() ?? undefined } : {}),
  }
}

export function buildPagesToolCallbacks(deps: PagesToolCallbacksDeps): PagesToolCallbacks {
  const { workspaceId, workspaceRootPath } = deps

  async function loadDetails(slug: string, includeContent = false): Promise<PageToolDetails | null> {
    const { loadPage, loadPageById, readPageDataSnapshot, loadPageContent } = await import('@craft-agent/shared/pages')
    const page = loadPage(workspaceRootPath, slug) ?? loadPageById(workspaceRootPath, slug)
    if (!page) return null
    return toDetails(page, { includeContent }, {
      readSnapshot: () => readPageDataSnapshot(workspaceRootPath, page.config.slug),
      loadContent: () => loadPageContent(workspaceRootPath, page.config.slug),
    })
  }

  async function mutated(pageSlug: string): Promise<void> {
    try {
      await deps.onPagesMutated?.(pageSlug)
    } catch (error) {
      deps.log?.(`pages tool: post-mutation notify failed for ${pageSlug}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  return {
    async listPages(): Promise<PageToolSummary[]> {
      const { loadWorkspacePages } = await import('@craft-agent/shared/pages')
      return loadWorkspacePages(workspaceRootPath).map(toSummary)
    },

    async getPage(slug: string, options?: { includeContent?: boolean }): Promise<PageToolDetails | null> {
      return loadDetails(slug, options?.includeContent === true)
    },

    async createPage(input: CreatePageToolInput): Promise<PageToolDetails> {
      const { createPage } = await import('@craft-agent/shared/pages')
      const config = createPage(workspaceRootPath, {
        name: input.name.trim(),
        description: input.description,
        kind: assertKind(input.kind),
        projectId: input.projectId,
        content: input.content,
        refresh: input.refresh as PageRefreshSpec | undefined,
      })
      await mutated(config.slug)
      if (input.content !== undefined) deps.onContentChanged?.(config.slug)
      deps.log?.(`pages tool: created page ${config.slug} in workspace ${workspaceId}`)
      const details = await loadDetails(config.slug)
      if (!details) throw new Error(`Created page ${config.slug} but failed to reload it`)
      return details
    },

    async updatePage(slug: string, patch: UpdatePageToolPatch): Promise<PageToolDetails> {
      const { updatePage, savePageContent, loadPage } = await import('@craft-agent/shared/pages')
      const existing = loadPage(workspaceRootPath, slug)
      if (!existing) throw new Error(`Page not found: ${slug}`)

      // Config patch: only include provided keys. Explicit null passes
      // through — "null clears" is normalized once, inside shared updatePage,
      // so this path and the pages:update RPC cannot drift.
      const configPatch: UpdatePagePatch = {}
      if (patch.name !== undefined) configPatch.name = patch.name.trim()
      if (patch.kind !== undefined) configPatch.kind = assertKind(patch.kind)
      if (patch.description !== undefined) configPatch.description = patch.description
      if (patch.projectId !== undefined) configPatch.projectId = patch.projectId
      if (patch.refresh !== undefined) configPatch.refresh = patch.refresh as PageRefreshSpec | null

      if (Object.keys(configPatch).length > 0) {
        updatePage(workspaceRootPath, existing.config.slug, configPatch)
      }
      if (patch.content !== undefined) {
        savePageContent(workspaceRootPath, existing.config.slug, patch.content)
      }

      await mutated(existing.config.slug)
      if (patch.content !== undefined) deps.onContentChanged?.(existing.config.slug)
      const details = await loadDetails(existing.config.slug)
      if (!details) throw new Error(`Updated page ${slug} but failed to reload it`)
      return details
    },

    async writePageData(slug: string, patch: PageDataToolPatch) {
      const { writePageData } = await import('@craft-agent/shared/pages')
      const { result } = await writePageData(workspaceRootPath, slug, patch)
      await mutated(slug)
      return {
        slug: result.pageSlug,
        kvCount: result.kvCount,
        seriesCount: result.seriesCount,
        generatedAt: result.generatedAt,
        snapshotPath: result.snapshotPath,
        durationMs: result.durationMs,
      }
    },

    async deletePage(slug: string) {
      const { deletePageWithUnpublish, loadPage } = await import('@craft-agent/shared/pages')
      const existing = loadPage(workspaceRootPath, slug)
      if (!existing) throw new Error(`Page not found: ${slug}`)
      const outcome = await deletePageWithUnpublish(workspaceRootPath, workspaceId, existing.config.slug, { log: deps.log })
      await mutated(existing.config.slug)
      deps.log?.(`pages tool: deleted page ${existing.config.slug}`)
      return { deleted: true as const, publicCopyMayRemain: outcome.publicCopyMayRemain }
    },
  }
}
