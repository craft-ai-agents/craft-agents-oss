/**
 * BrowserPaneManager
 *
 * Owns browser instances as dedicated BrowserWindow objects.
 * Each instance maps 1:1 to a full native window while preserving
 * shared session/cookie partition and CDP automation support.
 */

import { BrowserWindow, session, type Session as ElectronSession } from 'electron'
import { mainLog } from './logger'
import { BrowserCDP, type AccessibilitySnapshot } from './browser-cdp'
import type { BrowserInstanceInfo } from '../shared/types'

export type { BrowserInstanceInfo }

const SESSION_PARTITION = 'persist:browser-pane'

interface BrowserInstance {
  id: string
  window: BrowserWindow
  cdp: BrowserCDP
  currentUrl: string
  title: string
  favicon: string | null
  isLoading: boolean
  canGoBack: boolean
  canGoForward: boolean
  boundSessionId: string | null
}

interface CreateBrowserInstanceOptions {
  show?: boolean
}

let instanceCounter = 0

export class BrowserPaneManager {
  private instances: Map<string, BrowserInstance> = new Map()
  private stateChangeCallback: ((info: BrowserInstanceInfo) => void) | null = null
  private removedCallback: ((id: string) => void) | null = null
  private interactedCallback: ((id: string) => void) | null = null
  private partitionPermissionsInitialized = false

  onStateChange(callback: (info: BrowserInstanceInfo) => void): void {
    this.stateChangeCallback = callback
  }

  onRemoved(callback: (id: string) => void): void {
    this.removedCallback = callback
  }

  onInteracted(callback: (id: string) => void): void {
    this.interactedCallback = callback
  }

  createInstance(id?: string, options?: CreateBrowserInstanceOptions): string {
    const instanceId = id || `browser-${++instanceCounter}`
    const shouldShow = options?.show ?? false

    if (this.instances.has(instanceId)) {
      mainLog.warn(`[browser-pane] Instance already exists, reusing: ${instanceId}`)
      return instanceId
    }

    const ses = session.fromPartition(SESSION_PARTITION)
    this.setupSessionPermissions(ses)

    const window = new BrowserWindow({
      width: 1200,
      height: 900,
      minWidth: 700,
      minHeight: 500,
      show: shouldShow,
      backgroundColor: '#111111',
      webPreferences: {
        partition: SESSION_PARTITION,
        session: ses,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    })

    const cdp = new BrowserCDP(window.webContents)

    const instance: BrowserInstance = {
      id: instanceId,
      window,
      cdp,
      currentUrl: 'about:blank',
      title: 'New Tab',
      favicon: null,
      isLoading: false,
      canGoBack: false,
      canGoForward: false,
      boundSessionId: null,
    }

    const defaultUa = window.webContents.userAgent || ''
    const sanitizedUa = defaultUa.replace(/\sElectron\/[^\s]+/g, '')
    if (sanitizedUa && sanitizedUa !== defaultUa) {
      window.webContents.setUserAgent(sanitizedUa)
    }

    this.setupWindowListeners(instance)
    this.instances.set(instanceId, instance)
    this.emitStateChange(instance)
    mainLog.info(`[browser-pane] Created instance: ${instanceId} (show=${shouldShow})`)

    // Keep initial page deterministic for browser tool flows
    void window.loadURL('about:blank')

    return instanceId
  }

  destroyInstance(id: string): void {
    const instance = this.instances.get(id)
    if (!instance) return

    instance.cdp.detach()

    if (!instance.window.isDestroyed()) {
      instance.window.destroy()
    }

    // closed handler finalizes map cleanup; force cleanup if needed
    if (this.instances.has(id)) {
      this.instances.delete(id)
      this.removedCallback?.(id)
    }

    mainLog.info(`[browser-pane] Destroyed instance: ${id}`)
  }

  getInstance(id: string): BrowserInstance | undefined {
    return this.instances.get(id)
  }

  listInstances(): BrowserInstanceInfo[] {
    return Array.from(this.instances.values()).map(i => this.toInfo(i))
  }

  getWindowCount(): number {
    return this.instances.size
  }

  getBrowserWindows(): BrowserWindow[] {
    return Array.from(this.instances.values())
      .map((instance) => instance.window)
      .filter((win) => !win.isDestroyed())
  }

  async navigate(id: string, url: string): Promise<{ url: string; title: string }> {
    const instance = this.instances.get(id)
    if (!instance) throw new Error(`Browser instance not found: ${id}`)

    let normalizedUrl = url.trim()
    const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(normalizedUrl)
    const isAbout = normalizedUrl.startsWith('about:')
    if (!hasScheme && !isAbout) {
      const looksLikeHost = /^(localhost|\d{1,3}(?:\.\d{1,3}){3}|[\w-]+(?:\.[\w-]+)+)(?::\d+)?(?:\/|$)/i.test(normalizedUrl)
      if (looksLikeHost) {
        normalizedUrl = `https://${normalizedUrl}`
      } else {
        normalizedUrl = `https://duckduckgo.com/?q=${encodeURIComponent(normalizedUrl)}`
      }
    }

    const timeoutMs = 30_000
    const loaded = instance.window.webContents.loadURL(normalizedUrl)
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`Navigation timed out after ${timeoutMs / 1000}s`)), timeoutMs)
    )
    await Promise.race([loaded, timeout])

    return { url: instance.currentUrl, title: instance.title }
  }

  async goBack(id: string): Promise<void> {
    const instance = this.instances.get(id)
    if (!instance) throw new Error(`Browser instance not found: ${id}`)
    if (instance.window.webContents.canGoBack()) {
      instance.window.webContents.goBack()
    }
  }

  async goForward(id: string): Promise<void> {
    const instance = this.instances.get(id)
    if (!instance) throw new Error(`Browser instance not found: ${id}`)
    if (instance.window.webContents.canGoForward()) {
      instance.window.webContents.goForward()
    }
  }

  reload(id: string): void {
    const instance = this.instances.get(id)
    if (!instance) return
    instance.window.webContents.reload()
  }

  stop(id: string): void {
    const instance = this.instances.get(id)
    if (!instance) return
    instance.window.webContents.stop()
  }

  focus(id: string): void {
    const instance = this.instances.get(id)
    if (!instance) return

    const win = instance.window
    if (win.isDestroyed()) return
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
  }

  async getAccessibilitySnapshot(id: string): Promise<AccessibilitySnapshot> {
    const instance = this.instances.get(id)
    if (!instance) throw new Error(`Browser instance not found: ${id}`)
    return instance.cdp.getAccessibilitySnapshot()
  }

  async clickElement(id: string, ref: string): Promise<void> {
    const instance = this.instances.get(id)
    if (!instance) throw new Error(`Browser instance not found: ${id}`)
    return instance.cdp.clickElement(ref)
  }

  async fillElement(id: string, ref: string, value: string): Promise<void> {
    const instance = this.instances.get(id)
    if (!instance) throw new Error(`Browser instance not found: ${id}`)
    return instance.cdp.fillElement(ref, value)
  }

  async selectOption(id: string, ref: string, value: string): Promise<void> {
    const instance = this.instances.get(id)
    if (!instance) throw new Error(`Browser instance not found: ${id}`)
    return instance.cdp.selectOption(ref, value)
  }

  async screenshot(id: string): Promise<Buffer> {
    const instance = this.instances.get(id)
    if (!instance) throw new Error(`Browser instance not found: ${id}`)
    const image = await instance.window.webContents.capturePage()
    return image.toPNG()
  }

  async evaluate(id: string, expression: string): Promise<unknown> {
    const instance = this.instances.get(id)
    if (!instance) throw new Error(`Browser instance not found: ${id}`)
    return instance.window.webContents.executeJavaScript(expression)
  }

  async scroll(id: string, direction: 'up' | 'down' | 'left' | 'right', amount = 500): Promise<void> {
    const instance = this.instances.get(id)
    if (!instance) throw new Error(`Browser instance not found: ${id}`)

    const deltaX = direction === 'left' ? -amount : direction === 'right' ? amount : 0
    const deltaY = direction === 'up' ? -amount : direction === 'down' ? amount : 0

    await instance.window.webContents.executeJavaScript(`window.scrollBy(${deltaX}, ${deltaY})`)
  }

  bindSession(id: string, sessionId: string): void {
    const instance = this.instances.get(id)
    if (instance) {
      instance.boundSessionId = sessionId
      this.emitStateChange(instance)
    }
  }

  unbindSession(id: string): void {
    const instance = this.instances.get(id)
    if (instance) {
      instance.boundSessionId = null
      this.emitStateChange(instance)
    }
  }

  getOrCreateForSession(sessionId: string): string {
    for (const instance of this.instances.values()) {
      if (instance.boundSessionId === sessionId) {
        return instance.id
      }
    }

    const id = this.createInstance(undefined, { show: false })
    this.bindSession(id, sessionId)
    return id
  }

  destroyForSession(sessionId: string): void {
    for (const [id, instance] of this.instances) {
      if (instance.boundSessionId === sessionId) {
        this.destroyInstance(id)
      }
    }
  }

  destroyAll(): void {
    for (const id of [...this.instances.keys()]) {
      this.destroyInstance(id)
    }
  }

  private setupSessionPermissions(ses: ElectronSession): void {
    if (this.partitionPermissionsInitialized) return
    this.partitionPermissionsInitialized = true

    const allow = new Set([
      'fullscreen',
      'pointerLock',
      'window-management',
      'notifications',
      'geolocation',
      'media',
      'clipboard-read',
      'clipboard-sanitized-write',
      'idle-detection',
    ])

    if (typeof ses.setPermissionCheckHandler === 'function') {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ses.setPermissionCheckHandler((_webContents, permission: string, requestingOrigin: string, _details: any) => {
        const allowed = allow.has(permission)
        if (!allowed) {
          mainLog.warn(`[browser-pane] permission denied (check): ${permission} origin=${requestingOrigin}`)
        }
        return allowed
      })
    }

    if (typeof ses.setPermissionRequestHandler === 'function') {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ses.setPermissionRequestHandler((_webContents, permission: string, callback: (allow: boolean) => void, details: any) => {
        const allowed = allow.has(permission)
        if (!allowed) {
          mainLog.warn(`[browser-pane] permission denied (request): ${permission} origin=${details?.requestingOrigin ?? 'unknown'}`)
        }
        callback(allowed)
      })
    }
  }

  private setupWindowListeners(instance: BrowserInstance): void {
    const wc = instance.window.webContents

    wc.on('did-start-loading', () => {
      instance.isLoading = true
      this.emitStateChange(instance)
    })

    wc.on('did-stop-loading', () => {
      instance.isLoading = false
      instance.canGoBack = wc.canGoBack()
      instance.canGoForward = wc.canGoForward()
      this.emitStateChange(instance)
    })

    wc.on('did-navigate', (_event, url) => {
      instance.currentUrl = url
      instance.title = wc.getTitle()
      instance.canGoBack = wc.canGoBack()
      instance.canGoForward = wc.canGoForward()
      this.emitStateChange(instance)
    })

    wc.on('did-navigate-in-page', (_event, url) => {
      instance.currentUrl = url
      instance.canGoBack = wc.canGoBack()
      instance.canGoForward = wc.canGoForward()
      this.emitStateChange(instance)
    })

    wc.on('page-title-updated', (_event, title) => {
      instance.title = title
      this.emitStateChange(instance)
    })

    wc.on('page-favicon-updated', (_event, favicons) => {
      instance.favicon = favicons[0] || null
      this.emitStateChange(instance)
    })

    wc.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
      mainLog.warn(`[browser-pane] did-fail-load id=${instance.id} code=${errorCode} url=${validatedURL} error=${errorDescription}`)
    })

    wc.on('console-message', (_event, level, message) => {
      if (level >= 2) {
        mainLog.warn(`[browser-pane] console id=${instance.id} level=${level}: ${message}`)
      }
    })

    // Keep popups in the same browser window
    wc.setWindowOpenHandler((details) => {
      wc.loadURL(details.url)
      return { action: 'deny' }
    })

    wc.on('focus', () => {
      this.interactedCallback?.(instance.id)
    })

    instance.window.on('focus', () => {
      this.interactedCallback?.(instance.id)
    })

    instance.window.on('closed', () => {
      if (!this.instances.has(instance.id)) return
      instance.cdp.detach()
      this.instances.delete(instance.id)
      this.removedCallback?.(instance.id)
      mainLog.info(`[browser-pane] Destroyed instance: ${instance.id}`)
    })
  }

  private toInfo(instance: BrowserInstance): BrowserInstanceInfo {
    return {
      id: instance.id,
      url: instance.currentUrl,
      title: instance.title,
      favicon: instance.favicon,
      isLoading: instance.isLoading,
      canGoBack: instance.canGoBack,
      canGoForward: instance.canGoForward,
      boundSessionId: instance.boundSessionId,
    }
  }

  private emitStateChange(instance: BrowserInstance): void {
    this.stateChangeCallback?.(this.toInfo(instance))
  }
}
