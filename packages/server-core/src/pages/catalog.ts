/**
 * Craft Pages — workspace page catalog.
 *
 * Page CONTENT is session-scoped (it lives in the session data dir). This index
 * is not: without it a `pageId` cannot be resolved once the owning session is
 * cold, so a page created three weeks ago would 404 after a restart.
 *
 * Two properties this type exists to guarantee:
 *
 * 1. **Serialized mutations.** Every write goes through one promise chain.
 *    Concurrent sessions doing independent read-modify-write on a single JSON
 *    file lose entries even inside one event loop — `await readFile` yields, a
 *    second caller reads the same stale copy, and whichever writes last wins.
 *    The headless server is also a genuinely separate process, so this is a
 *    real interleaving, not a theoretical one.
 *
 * 2. **Rebuildable.** The catalog is an index, never the source of truth — the
 *    per-page `page.json` manifests are. A corrupt or deleted catalog is
 *    recovered by rescanning, not by losing the user's pages.
 */

import { join } from 'node:path'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import type { PageCatalogEntry, PageCatalogInterface } from '@craft-agent/session-tools-core'

const CATALOG_FILE = 'pages-catalog.json'
const CATALOG_VERSION = 1

interface CatalogFile {
  version: number
  entries: PageCatalogEntry[]
}

/** Where a session's pages live, given a workspace root. */
export function sessionPagesRoot(workspaceRootPath: string, sessionId: string): string {
  return join(workspaceRootPath, 'sessions', sessionId, 'data', 'pages')
}

/** Absolute path to a page revision's served root. */
export function pagePublicDir(
  workspaceRootPath: string,
  sessionId: string,
  slug: string,
  rev: number,
): string {
  return join(sessionPagesRoot(workspaceRootPath, sessionId), slug, 'revisions', String(rev), 'public')
}

export class PageCatalogService implements PageCatalogInterface {
  private readonly path: string
  /** Single chain that every mutation is appended to. This IS the lock. */
  private queue: Promise<unknown> = Promise.resolve()

  constructor(private readonly workspaceRootPath: string) {
    this.path = join(workspaceRootPath, CATALOG_FILE)
  }

  /** Append to the mutation chain, isolating callers from each other's failures. */
  private serialize<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn)
    // Swallow rejection on the CHAIN only — the caller still sees it via `run`.
    // Without this, one failed write poisons every subsequent mutation.
    this.queue = run.then(() => undefined, () => undefined)
    return run
  }

  private async read(): Promise<CatalogFile> {
    try {
      const raw = await readFile(this.path, 'utf-8')
      const parsed = JSON.parse(raw) as CatalogFile
      if (!parsed || !Array.isArray(parsed.entries)) throw new Error('shape')
      return parsed
    } catch {
      // Missing or corrupt — an index is disposable, so start empty rather than
      // failing. reconcile() restores it from the manifests.
      return { version: CATALOG_VERSION, entries: [] }
    }
  }

  private async write(file: CatalogFile): Promise<void> {
    await mkdir(this.workspaceRootPath, { recursive: true })
    const tmp = `${this.path}.tmp`
    await writeFile(tmp, JSON.stringify(file, null, 2), 'utf-8')
    await rename(tmp, this.path)
  }

  async register(entry: PageCatalogEntry): Promise<void> {
    return this.serialize(async () => {
      const file = await this.read()
      const others = file.entries.filter(e => e.pageId !== entry.pageId)
      await this.write({ version: CATALOG_VERSION, entries: [...others, entry] })
    })
  }

  async unregister(pageId: string): Promise<void> {
    return this.serialize(async () => {
      const file = await this.read()
      await this.write({
        version: CATALOG_VERSION,
        entries: file.entries.filter(e => e.pageId !== pageId),
      })
    })
  }

  async resolve(pageId: string): Promise<PageCatalogEntry | null> {
    const file = await this.read()
    return file.entries.find(e => e.pageId === pageId) ?? null
  }

  async listForSession(sessionId: string): Promise<PageCatalogEntry[]> {
    const file = await this.read()
    return file.entries.filter(e => e.sessionId === sessionId)
  }

  async list(): Promise<PageCatalogEntry[]> {
    return (await this.read()).entries
  }

  /**
   * Rebuild the index by scanning every session's page manifests, and drop
   * entries whose directory is gone.
   *
   * Run at startup. Deliberately fail-soft: a page directory that cannot be
   * read is skipped with the rest still recovered, because a single bad
   * manifest must not cost the user every other page.
   */
  async reconcile(): Promise<{ kept: number; dropped: number; recovered: number }> {
    return this.serialize(async () => {
      const existing = (await this.read()).entries
      const byId = new Map<string, PageCatalogEntry>()
      let recovered = 0

      const sessionsDir = join(this.workspaceRootPath, 'sessions')
      if (existsSync(sessionsDir)) {
        for (const sessionId of safeReaddir(sessionsDir)) {
          const pagesRoot = sessionPagesRoot(this.workspaceRootPath, sessionId)
          if (!existsSync(pagesRoot)) continue
          for (const slug of safeReaddir(pagesRoot)) {
            if (slug.startsWith('.')) continue
            const manifestPath = join(pagesRoot, slug, 'page.json')
            if (!existsSync(manifestPath)) continue
            try {
              const m = JSON.parse(readFileSync(manifestPath, 'utf-8')) as {
                id?: string; slug?: string; title?: string
              }
              if (!m.id || !m.slug) continue
              const wasKnown = existing.some(e => e.pageId === m.id)
              if (!wasKnown) recovered++
              byId.set(m.id, {
                pageId: m.id,
                sessionId,
                slug: m.slug,
                title: m.title ?? m.slug,
              })
            } catch {
              // Unreadable manifest — skip this page only.
            }
          }
        }
      }

      const kept = byId.size
      const dropped = existing.filter(e => !byId.has(e.pageId)).length
      await this.write({ version: CATALOG_VERSION, entries: [...byId.values()] })
      return { kept, dropped, recovered }
    })
  }
}

function safeReaddir(dir: string): string[] {
  try {
    return readdirSync(dir)
  } catch {
    return []
  }
}
