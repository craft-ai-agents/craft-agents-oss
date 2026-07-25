import { spawn } from 'node:child_process'
import { mkdirSync, readFile, unlink } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type {
  AccessibilityNode,
  AccessibilitySnapshot,
  BrowserConsoleEntry,
  BrowserConsoleOptions,
  BrowserDownloadEntry,
  BrowserDownloadOptions,
  BrowserInstanceSnapshot,
  BrowserKeyArgs,
  BrowserNetworkEntry,
  BrowserNetworkOptions,
  BrowserScreenshotOptions,
  BrowserScreenshotRegionTarget,
  BrowserScreenshotResult,
  BrowserWaitArgs,
  BrowserWaitResult,
  IBrowserPaneManager,
} from '@craft-agent/server-core/handlers'
import type { BrowserInstanceInfo } from '@craft-agent/shared/protocol'

type AgentBrowserResponse<T = unknown> = {
  success?: boolean
  data?: T
  error?: string | null
}

type BrowserState = {
  id: string
  url: string
  title: string
  boundSessionId: string | null
  ownerType: 'session' | 'manual'
  ownerSessionId: string | null
  workspaceId: string | null
  canGoBack: boolean
  canGoForward: boolean
  isVisible: boolean
}

type AgentBrowserOptions = {
  binary?: string
  profileDir?: string
  sessionName?: string
}

function normalizeBrowserUrl(input: string): string {
  const value = input.trim()
  if (!value) return 'about:blank'
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value) || value.startsWith('about:')) return value

  const looksLikeHost = /^(localhost|\d{1,3}(?:\.\d{1,3}){3}|[\w-]+(?:\.[\w-]+)+)(?::\d+)?(?:\/|$)/i.test(value)
  return looksLikeHost
    ? `https://${value}`
    : `https://duckduckgo.com/?q=${encodeURIComponent(value)}`
}

/**
 * Headless browser adapter for the VPS deployment.
 *
 * agent-browser owns the Chrome process and its CDP daemon. Keeping one
 * named session and one persistent profile means the browser can be reused
 * by both the agent and the Web UI, while cookies survive server restarts.
 */
export class VpsBrowserPaneManager implements IBrowserPaneManager {
  private readonly binary: string
  private readonly profileDir: string
  private readonly sessionName: string
  private readonly instanceId = 'vps-browser'
  private state: BrowserState | null = null
  private commandQueue: Promise<void> = Promise.resolve()
  private stateChangeCallback: ((info: BrowserInstanceInfo) => void) | null = null
  private removedCallback: ((id: string) => void) | null = null
  private interactedCallback: ((id: string) => void) | null = null
  private sessionPathResolver: ((sessionId: string) => string | null) | null = null

  constructor(options: AgentBrowserOptions = {}) {
    this.binary = options.binary ?? process.env.CRAFT_AGENT_BROWSER_BIN ?? 'agent-browser'
    this.profileDir = options.profileDir
      ?? process.env.CRAFT_BROWSER_PROFILE
      ?? join(homedir(), '.craft-agent', 'browser-profile')
    this.sessionName = options.sessionName
      ?? process.env.CRAFT_BROWSER_SESSION
      ?? 'craft-vps-browser'
    mkdirSync(this.profileDir, { recursive: true, mode: 0o700 })
  }

  setSessionPathResolver(fn: (sessionId: string) => string | null): void {
    this.sessionPathResolver = fn
  }

  onStateChange(callback: (info: BrowserInstanceInfo) => void): void { this.stateChangeCallback = callback }
  onRemoved(callback: (id: string) => void): void { this.removedCallback = callback }
  onInteracted(callback: (id: string) => void): void { this.interactedCallback = callback }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.commandQueue.then(operation, operation)
    this.commandQueue = next.then(() => undefined, () => undefined)
    return next
  }

  private async runCommand<T = unknown>(args: string[]): Promise<T> {
    const child = spawn(this.binary, [
      '--profile', this.profileDir,
      '--session', this.sessionName,
      '--json',
      ...args,
    ], { stdio: ['ignore', 'pipe', 'pipe'] })

    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString() })
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString() })

    const exitCode = await new Promise<number>((resolve, reject) => {
      child.once('error', reject)
      child.once('close', (code) => resolve(code ?? 1))
    })

    // agent-browser emits one JSON object per command. Taking the last
    // non-empty line also tolerates diagnostic output from older releases.
    const line = stdout.trim().split('\n').filter(Boolean).at(-1)
    let response: AgentBrowserResponse<T> | null = null
    if (line) {
      try { response = JSON.parse(line) as AgentBrowserResponse<T> } catch { /* handled below */ }
    }

    if (exitCode !== 0 || !response || response.success === false) {
      const detail = response?.error || stderr.trim() || stdout.trim() || `exit code ${exitCode}`
      throw new Error(`agent-browser ${args[0] ?? 'command'} failed: ${detail}`)
    }
    return response.data as T
  }

  private async ensureOpenRaw(): Promise<void> {
    try {
      await this.runCommand<{ url: string }>(['get', 'url'])
    } catch {
      await this.runCommand(['open', 'about:blank'])
    }
  }

  private async refreshStateRaw(): Promise<void> {
    await this.ensureOpenRaw()
    const [url, title] = await Promise.all([
      this.runCommand<{ url: string }>(['get', 'url']),
      this.runCommand<{ title: string }>(['get', 'title']),
    ])
    const previous = this.state
    this.state = {
      id: this.instanceId,
      url: url?.url ?? previous?.url ?? 'about:blank',
      title: title?.title ?? previous?.title ?? '',
      boundSessionId: previous?.boundSessionId ?? null,
      ownerType: previous?.ownerType ?? 'manual',
      ownerSessionId: previous?.ownerSessionId ?? null,
      workspaceId: previous?.workspaceId ?? null,
      canGoBack: previous?.canGoBack ?? false,
      canGoForward: previous?.canGoForward ?? false,
      isVisible: true,
    }
    this.emitState()
  }

  private emitState(): void {
    if (!this.state || !this.stateChangeCallback) return
    this.stateChangeCallback(this.toInfo(this.state))
  }

  private toInfo(state: BrowserState): BrowserInstanceInfo {
    return {
      id: state.id,
      url: state.url,
      title: state.title,
      favicon: null,
      isLoading: false,
      canGoBack: state.canGoBack,
      canGoForward: state.canGoForward,
      boundSessionId: state.boundSessionId,
      ownerType: state.ownerType,
      ownerSessionId: state.ownerSessionId,
      isVisible: state.isVisible,
      agentControlActive: false,
      themeColor: null,
      workspaceId: state.workspaceId,
    }
  }

  private requireState(id: string): BrowserState {
    if (id !== this.instanceId || !this.state) throw new Error(`Browser instance not found: ${id}`)
    return this.state
  }

  private async withBrowser<T>(id: string, operation: () => Promise<T>): Promise<T> {
    return this.enqueue(async () => {
      this.requireState(id)
      await this.ensureOpenRaw()
      const result = await operation()
      await this.refreshStateRaw()
      this.interactedCallback?.(id)
      return result
    })
  }

  createInstance(id?: string, options?: { show?: boolean; workspaceId?: string | null }): string {
    const instanceId = id ?? this.instanceId
    if (instanceId !== this.instanceId) throw new Error(`Only ${this.instanceId} is available in VPS browser mode`)
    this.state ??= {
      id: this.instanceId,
      url: 'about:blank',
      title: '',
      boundSessionId: null,
      ownerType: 'manual',
      ownerSessionId: null,
      workspaceId: options?.workspaceId ?? null,
      canGoBack: false,
      canGoForward: false,
      isVisible: options?.show ?? true,
    }
    void this.enqueue(async () => { await this.refreshStateRaw() }).catch(() => undefined)
    return instanceId
  }

  getOrCreateForSession(sessionId: string, options?: { workspaceId?: string | null }): string {
    return this.createForSession(sessionId, { show: true, workspaceId: options?.workspaceId })
  }

  async getOrCreateForSessionAsync(sessionId: string, options?: { workspaceId?: string | null }): Promise<string> {
    return this.enqueue(async () => {
      this.createForSession(sessionId, { show: true, workspaceId: options?.workspaceId })
      await this.refreshStateRaw()
      return this.instanceId
    })
  }

  setAgentControl(_sessionId: string, _meta: { displayName?: string; intent?: string }, _options?: { workspaceId?: string | null }): void {}

  createForSession(sessionId: string, options?: { show?: boolean; workspaceId?: string | null }): string {
    const id = this.createInstance(undefined, options)
    const state = this.state!
    state.boundSessionId = sessionId
    state.ownerSessionId = sessionId
    state.ownerType = 'session'
    state.workspaceId = options?.workspaceId ?? state.workspaceId
    this.emitState()
    return id
  }

  async createForSessionAsync(sessionId: string, options?: { show?: boolean; workspaceId?: string | null }): Promise<string> {
    return this.getOrCreateForSessionAsync(sessionId, options)
  }

  getInstance(id: string): BrowserInstanceSnapshot | undefined {
    if (id !== this.instanceId || !this.state) return undefined
    return {
      ownerType: this.state.ownerType,
      ownerSessionId: this.state.ownerSessionId,
      isVisible: this.state.isVisible,
      title: this.state.title,
      currentUrl: this.state.url,
    }
  }

  async getInstanceAsync(id: string): Promise<BrowserInstanceSnapshot | undefined> {
    if (id !== this.instanceId || !this.state) return undefined
    await this.enqueue(async () => { await this.refreshStateRaw() })
    return this.getInstance(id)
  }

  listInstances(): BrowserInstanceInfo[] { return this.state ? [this.toInfo(this.state)] : [] }
  async listInstancesAsync(): Promise<BrowserInstanceInfo[]> {
    if (this.state) await this.enqueue(async () => { await this.refreshStateRaw() })
    return this.listInstances()
  }

  focusBoundForSession(sessionId: string, options?: { workspaceId?: string | null }): string {
    return this.getOrCreateForSession(sessionId, options)
  }

  async focusBoundForSessionAsync(sessionId: string, options?: { workspaceId?: string | null }): Promise<string> {
    return this.getOrCreateForSessionAsync(sessionId, options)
  }

  bindSession(id: string, sessionId: string, options?: { workspaceId?: string | null }): void {
    const state = this.requireState(id)
    state.boundSessionId = sessionId
    state.ownerSessionId = sessionId
    state.ownerType = 'session'
    state.workspaceId = options?.workspaceId ?? state.workspaceId
    this.emitState()
  }

  focus(_id: string): void {}
  hide(id: string): void { const state = this.requireState(id); state.isVisible = false; this.emitState() }

  destroyInstance(id: string): void {
    if (id !== this.instanceId || !this.state) return
    this.state = null
    void this.enqueue(async () => { await this.runCommand(['close']) }).catch(() => undefined)
    this.removedCallback?.(id)
  }

  destroyForSession(sessionId: string): void {
    if (this.state?.boundSessionId === sessionId) this.unbindAllForSession(sessionId)
  }

  clearVisualsForSession(_sessionId: string): Promise<void> { return Promise.resolve() }
  unbindAllForSession(sessionId: string): void {
    if (!this.state || this.state.boundSessionId !== sessionId) return
    this.state.boundSessionId = null
    this.state.ownerSessionId = null
    this.state.ownerType = 'manual'
    this.emitState()
  }
  clearAgentControl(_sessionId: string): void {}
  clearAgentControlForInstance(_instanceId: string, _sessionId?: string): { released: boolean; reason?: string } {
    return { released: false, reason: 'Agent control overlays are not used in Web browser mode.' }
  }

  navigate(id: string, url: string): Promise<{ url: string; title: string }> {
    return this.withBrowser(id, async () => await this.runCommand<{ title: string; url: string }>(['open', normalizeBrowserUrl(url)]))
  }
  goBack(id: string): Promise<void> { return this.withBrowser(id, async () => { await this.runCommand(['back']); this.state!.canGoBack = true }) }
  goForward(id: string): Promise<void> { return this.withBrowser(id, async () => { await this.runCommand(['forward']); this.state!.canGoForward = true }) }
  reload(id: string): Promise<void> { return this.withBrowser(id, async () => { await this.runCommand(['reload']) }) }
  stop(_id: string): void {}

  async getAccessibilitySnapshot(id: string): Promise<AccessibilitySnapshot> {
    return this.withBrowser(id, async () => {
      const data = await this.runCommand<{ snapshot?: string; refs?: Record<string, { name?: string; role?: string }> }>(['snapshot', '-i'])
      const nodes: AccessibilityNode[] = []
      for (const line of (data?.snapshot ?? '').split('\n')) {
        const ref = line.match(/\[ref=([^\]]+)\]/)?.[1]
        if (!ref) continue
        const role = line.match(/^-\s+([\w-]+)/)?.[1] ?? data?.refs?.[ref]?.role ?? 'unknown'
        const quoted = line.match(/"([^"]*)"/)?.[1]
        const refData = data?.refs?.[ref]
        nodes.push({ ref, role, name: quoted ?? refData?.name ?? '' })
      }
      return { url: this.state!.url, title: this.state!.title, nodes }
    })
  }

  clickElement(id: string, ref: string): Promise<void> { return this.withBrowser(id, async () => { await this.runCommand(['click', ref]) }) }
  clickAtCoordinates(id: string, x: number, y: number): Promise<void> {
    return this.withBrowser(id, async () => {
      await this.runCommand(['mouse', 'move', String(Math.round(x)), String(Math.round(y))])
      await this.runCommand(['mouse', 'down'])
      await this.runCommand(['mouse', 'up'])
    })
  }
  drag(id: string, x1: number, y1: number, x2: number, y2: number): Promise<void> {
    return this.withBrowser(id, async () => {
      await this.runCommand(['mouse', 'move', String(x1), String(y1)])
      await this.runCommand(['mouse', 'down'])
      await this.runCommand(['mouse', 'move', String(x2), String(y2)])
      await this.runCommand(['mouse', 'up'])
    })
  }
  fillElement(id: string, ref: string, value: string): Promise<void> { return this.withBrowser(id, async () => { await this.runCommand(['fill', ref, value]) }) }
  typeText(id: string, text: string): Promise<void> { return this.withBrowser(id, async () => { await this.runCommand(['keyboard', 'type', text]) }) }
  selectOption(id: string, ref: string, value: string): Promise<void> { return this.withBrowser(id, async () => { await this.runCommand(['select', ref, value]) }) }
  setClipboard(_id: string, _text: string): Promise<void> { return Promise.resolve() }
  async getClipboard(_id: string): Promise<string> { return '' }
  scroll(id: string, direction: 'up' | 'down' | 'left' | 'right', amount?: number): Promise<void> {
    return this.withBrowser(id, async () => { await this.runCommand(['scroll', direction, String(amount ?? 600)]) })
  }
  sendKey(id: string, args: BrowserKeyArgs): Promise<void> {
    const key = [...(args.modifiers ?? []).map(m => m === 'control' ? 'Control' : m[0].toUpperCase() + m.slice(1)), args.key].join('+')
    return this.withBrowser(id, async () => { await this.runCommand(['press', key]) })
  }
  uploadFile(_id: string, _ref: string, _filePaths: string[]): Promise<unknown> { return Promise.reject(new Error('File upload from the Web UI is not supported yet.')) }
  evaluate(id: string, expression: string): Promise<unknown> { return this.withBrowser(id, async () => await this.runCommand(['eval', expression])) }

  async screenshot(id: string, options?: BrowserScreenshotOptions): Promise<BrowserScreenshotResult> {
    return this.enqueue(async () => {
      this.requireState(id)
      await this.ensureOpenRaw()
      const format = options?.format ?? 'png'
      const path = join(this.profileDir, `.craft-screenshot-${randomUUID()}.${format}`)
      try {
        const args = format === 'jpeg'
          ? ['--screenshot-format', 'jpeg', ...(options?.jpegQuality ? ['--screenshot-quality', String(options.jpegQuality)] : []), 'screenshot', path]
          : ['screenshot', path]
        if (options?.annotate) args.unshift('--annotate')
        await this.runCommand(args)
        const imageBuffer = await new Promise<Buffer>((resolve, reject) => readFile(path, (error, data) => error ? reject(error) : resolve(data)))
        return { imageBuffer, imageFormat: format }
      } finally {
        await new Promise<void>((resolve) => unlink(path, () => resolve()))
      }
    })
  }
  screenshotRegion(id: string, _target: BrowserScreenshotRegionTarget): Promise<BrowserScreenshotResult> { return this.screenshot(id) }

  getConsoleLogs(_id: string, _options?: BrowserConsoleOptions): BrowserConsoleEntry[] { return [] }
  windowResize(id: string, width: number, height: number): { width: number; height: number } {
    void this.enqueue(async () => { this.requireState(id); await this.runCommand(['set', 'viewport', String(width), String(height)]) }).catch(() => undefined)
    return { width, height }
  }
  getNetworkLogs(_id: string, _options?: BrowserNetworkOptions): BrowserNetworkEntry[] { return [] }
  async waitFor(id: string, args: BrowserWaitArgs): Promise<BrowserWaitResult> {
    const started = Date.now()
    const timeout = args.timeoutMs ?? 25_000
    await this.withBrowser(id, async () => {
      if (args.kind === 'url' && args.value) {
        while (Date.now() - started < timeout) {
          const data = await this.runCommand<{ url: string }>(['get', 'url'])
          if (data?.url === args.value || data?.url.includes(args.value)) return
          await new Promise(resolve => setTimeout(resolve, args.pollMs ?? 250))
        }
      } else if (args.value) {
        await this.runCommand(['wait', args.value])
      } else {
        await this.runCommand(['wait', String(Math.min(timeout, 1000))])
      }
    })
    return { ok: true, kind: args.kind, elapsedMs: Date.now() - started, detail: args.value ?? '' }
  }
  async getDownloads(_id: string, _options?: BrowserDownloadOptions): Promise<BrowserDownloadEntry[]> { return [] }
  async detectSecurityChallenge(_id: string): Promise<{ detected: boolean; provider: string; signals: string[] }> {
    return { detected: false, provider: 'none', signals: [] }
  }

  getProfileDir(): string { return this.profileDir }
  getSessionPathResolver(): ((sessionId: string) => string | null) | null { return this.sessionPathResolver }
}
