/**
 * Page thumbnail capture (Electron main).
 *
 * Renders a page in an offscreen, opaque-sandboxed window exactly like
 * PageFrame (see page-thumbnail-host.ts), captures a poster with
 * `webContents.capturePage`, and writes pages/{slug}/thumbnail.jpg + stamps
 * `PageConfig.thumbnail` via `recordPageThumbnail`. Captures run one-at-a-time
 * through a queue that coalesces duplicate slugs; every failure is swallowed
 * (the page just stays posterless and the grid falls back to the placeholder).
 *
 * This is the only capture surface in the stack — it exists in Electron main
 * only. Headless/WebUI hosts never construct it; SessionManager's
 * `enqueuePageThumbnail` becomes a no-op there and tiles fall back.
 */

import { BrowserWindow } from 'electron'
import { renameSync, writeFileSync } from 'node:fs'
import {
  computePageContentDigest,
  getPageThumbnailPath,
  loadPageConfig,
  loadPageContent,
  readPageDataSnapshot,
  recordPageThumbnail,
} from '@craft-agent/shared/pages'
import {
  THUMB_JPEG_QUALITY,
  THUMB_LOGICAL_HEIGHT,
  THUMB_LOGICAL_WIDTH,
  THUMB_OUTPUT_HEIGHT,
  THUMB_OUTPUT_WIDTH,
  buildThumbnailHostHtml,
} from './page-thumbnail-host'

export interface ThumbnailRequest {
  workspaceId: string
  workspaceRootPath: string
  slug: string
}

export interface PageThumbnailerOptions {
  /** Called after a poster is written + page.json stamped, so the host can broadcast pages:changed. */
  onCaptured?: (req: ThumbnailRequest) => void
  log?: (message: string) => void
}

/** How long to let the iframe load + paint + apply its snapshot before capturing. */
const RENDER_SETTLE_MS = 550
/** Capture retries when the first frame comes back empty (hidden-window paint race). */
const CAPTURE_RETRIES = 3
const CAPTURE_RETRY_DELAY_MS = 250
/** Hard ceiling on one capture so a hung page can't wedge the queue. */
const CAPTURE_TIMEOUT_MS = 15_000

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

export class PageThumbnailer {
  private readonly queue: ThumbnailRequest[] = []
  private readonly pending = new Set<string>()
  private running = false

  constructor(private readonly options: PageThumbnailerOptions = {}) {}

  private key(req: ThumbnailRequest): string {
    return `${req.workspaceRootPath}::${req.slug}`
  }

  /** Queue a (re)capture. Coalesces duplicate slugs; the run reads latest from disk. */
  enqueue(req: ThumbnailRequest): void {
    const key = this.key(req)
    if (this.pending.has(key)) return
    this.pending.add(key)
    this.queue.push(req)
    void this.drain()
  }

  private async drain(): Promise<void> {
    if (this.running) return
    this.running = true
    try {
      while (this.queue.length > 0) {
        const req = this.queue.shift()!
        this.pending.delete(this.key(req))
        try {
          await this.capture(req)
        } catch (error) {
          this.options.log?.(
            `[page-thumbnailer] capture failed for ${req.slug}: ${error instanceof Error ? error.message : String(error)}`,
          )
        }
      }
    } finally {
      this.running = false
    }
  }

  private async capture(req: ThumbnailRequest): Promise<void> {
    const { workspaceRootPath, slug } = req
    const config = loadPageConfig(workspaceRootPath, slug)
    if (!config) return // page deleted between enqueue and run

    const content = loadPageContent(workspaceRootPath, slug)
    if (content === null || content.trim() === '') return // nothing to render

    const digest = config.contentDigest ?? computePageContentDigest(content)
    // Already have a fresh poster (e.g. duplicate enqueue) — skip the work.
    if (config.thumbnail?.digest === digest) return

    const snapshot = readPageDataSnapshot(workspaceRootPath, slug)
    const html = buildThumbnailHostHtml({ content, slug, kind: config.kind, snapshot })

    const win = new BrowserWindow({
      show: false,
      width: THUMB_LOGICAL_WIDTH,
      height: THUMB_LOGICAL_HEIGHT,
      useContentSize: true,
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        // Keep the render deterministic regardless of the user's display.
        zoomFactor: 1,
      },
    })

    try {
      const buffer = await this.withTimeout(this.renderAndCapture(win, html), CAPTURE_TIMEOUT_MS)
      if (!buffer) {
        this.options.log?.(`[page-thumbnailer] empty capture for ${slug}; leaving posterless`)
        return
      }

      const target = getPageThumbnailPath(workspaceRootPath, slug)
      const tmp = `${target}.tmp`
      writeFileSync(tmp, buffer)
      renameSync(tmp, target)

      // Re-check the page still exists (could be deleted mid-capture) before stamping.
      if (!loadPageConfig(workspaceRootPath, slug)) return
      recordPageThumbnail(workspaceRootPath, slug, {
        digest,
        capturedAt: Date.now(),
        width: THUMB_OUTPUT_WIDTH,
        height: THUMB_OUTPUT_HEIGHT,
      })
      this.options.onCaptured?.(req)
      this.options.log?.(`[page-thumbnailer] captured poster for ${slug}`)
    } finally {
      if (!win.isDestroyed()) win.destroy()
    }
  }

  private async renderAndCapture(win: BrowserWindow, html: string): Promise<Buffer | null> {
    await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
    // did-finish-load (awaited above) only covers the host doc; give the
    // sandboxed iframe + its scripts + the snapshot render time to settle.
    await delay(RENDER_SETTLE_MS)

    for (let attempt = 0; attempt < CAPTURE_RETRIES; attempt++) {
      if (win.isDestroyed()) return null
      const image = await win.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })
      if (!image.isEmpty()) {
        const resized = image.resize({
          width: THUMB_OUTPUT_WIDTH,
          height: THUMB_OUTPUT_HEIGHT,
          quality: 'best',
        })
        const jpeg = resized.toJPEG(THUMB_JPEG_QUALITY)
        if (jpeg && jpeg.length > 0) return jpeg
      }
      await delay(CAPTURE_RETRY_DELAY_MS)
    }
    return null
  }

  private withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
    // Keep the losing branch handled: on timeout the caller's finally destroys
    // the window while renderAndCapture's loadURL is still pending, and that
    // later rejection (ERR_ABORTED) would surface as an unhandled rejection.
    promise.catch(() => {})
    return Promise.race([
      promise,
      new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`capture timed out after ${ms}ms`)), ms)),
    ])
  }
}
