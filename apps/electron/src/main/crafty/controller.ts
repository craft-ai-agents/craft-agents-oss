import { app, BrowserWindow, globalShortcut, screen, shell, systemPreferences, type Rectangle } from 'electron'
import { randomUUID } from 'crypto'
import { join } from 'path'
import {
  getPersistedCraftyDoubleTap,
  getPersistedCraftyEnabled,
  getPersistedCraftyOpenWith,
  getPersistedCraftyRecentLanguages,
  getPersistedCraftyTarget,
  getWorkspaceByNameOrId,
  getWorkspaces,
  rememberCraftyLanguage,
  setPersistedCraftyDoubleTap,
  setPersistedCraftyOpenWith,
  setPersistedCraftyTarget,
} from '@craft-agent/shared/config'
import type { Workspace } from '@craft-agent/core/types'
import type { SessionManager } from '@craft-agent/server-core/sessions'
import { mainLog } from '../logger'
import type { WindowManager } from '../window-manager'
import type { InputEvent } from '../../crafty-native/protocol'
import {
  CRAFTY_SHORTCUT,
  type CraftyCreateSessionResult,
  type CraftyDoubleTap,
  type CraftyEvent,
  type CraftyFollowStrategy,
  type CraftyInsertRequest,
  type CraftyInsertResult,
  type CraftyMetric,
  type CraftyPermissionKind,
  type CraftyPoint,
  type CraftyProvenance,
  type CraftyRecentScreenshot,
  type CraftyScreenshot,
  type CraftySessionModel,
  type CraftySessionSummary,
  type CraftyStatus,
  type CraftyTargetRef,
  type CraftyTargetState,
  type CraftyTransformRequest,
  type CraftyTransformResult,
  type CraftyTriggerSource,
  type CraftyOpenWith,
} from '../../shared/crafty'
import { CraftyNativeHost } from './native-host'
import { afterTapRefused } from './double-tap-sync'
import { getBrowserUrl, getFrontmostInfo, insertText, isBrowser } from './jxa'
import { chooseInsertMode } from './insert-mode'
import { CraftyMetrics } from './metrics'
import { captureRegion, findRecentScreenshot, toScreenshot } from './screenshots'
import { reduceTrigger, TRIGGER_IDLE, type TriggerState } from './trigger-detect'
import { buildTransformPrompt, cleanTransformResult } from './transform-prompt'
import { localCraftySessions, remoteCraftySessions, type CraftySessions } from './sessions'
import { openRemoteClient, RemoteConnections } from './remote-connections'

const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL

/** How long main waits for the window to animate out before hiding it anyway. */
const FORCED_HIDE_MS = 400

/** The target menu's rows; its search looks through these. */
const MAX_LISTED_SESSIONS = 200

/** A trigger this soon after Crafty opened doesn't close it: a held ⌃⌥Space must never toggle it shut. */
const REPEAT_GUARD_MS = 400

/** While the double-tap is on but its tap can't run (no Accessibility yet), try again this often. */
const INPUT_RETRY_MS = 5000

/**
 * In the Crafty window ⌘ only goes with these keys: editing in the composer, and the pie's keys
 * while ⌘ is held. Any other ⌘ shortcut would reach Craft's menu: ⌘Q quits Craft, ⌘W closes the
 * window.
 */
const META_KEYS_ALLOWED = new Set([
  'a', 'c', 'v', 'x', 'z', '1', '2', '3', '4', '5', '6', '7', '8',
  'escape', 'enter', 'backspace', 'arrowleft', 'arrowright', 'arrowup', 'arrowdown', 'meta',
])

function sameTarget(a: CraftyTargetRef | null, b: CraftyTargetRef | null): boolean {
  return a?.sessionId === b?.sessionId && a?.workspaceId === b?.workspaceId
}

/**
 * What the Crafty window's preload connected to: its workspace and, for a remote one, that
 * workspace's server. When it changes (another workspace, a new address or token) the page reloads.
 */
function windowRoute(workspace: Workspace | null): string {
  const server = workspace?.remoteServer
  return server ? [workspace.id, server.url, server.remoteWorkspaceId, server.token].join('\n') : workspace?.id ?? ''
}

const PERMISSION_PANES: Record<CraftyPermissionKind, string> = {
  accessibility: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility',
  screen: 'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture',
  automation: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Automation',
}

export interface CraftyDeps {
  windowManager: WindowManager
  /** Null in thin-client mode, where Crafty is unavailable. */
  sessionManager: SessionManager | null
  /** Focus the session in a main window (deep link), Craft in front. */
  openSession(workspaceId: string, sessionId: string): Promise<void>
  /** Bring up the workspace's main window as it is (else the last one used), Craft in front. */
  openCraft(workspaceId: string | null): Promise<void>
}

interface Invocation {
  id: string
  at: number
  workspaceId: string | null
  bounds: Rectangle
  source: { pid: number | null; bundleId: string | null; appName: string | null } | null
  recentScreenshot: CraftyRecentScreenshot | null
  trigger: CraftyTriggerSource
  /** The `invoke` event is in the queue: a release before it waits in `pendingRelease`. */
  invokePushed: boolean
  pendingRelease: { heldMs: number; interrupted: boolean } | null
  /** The double-tap's key went up (a later release belongs to a press that closed Crafty). */
  released: boolean
}

/**
 * A single-consumer queue the Crafty window drains with `crafty:nextEvent` (a long poll), so main
 * never has to push into the window.
 */
class EventQueue {
  private items: CraftyEvent[] = []
  private waiter: ((event: CraftyEvent) => void) | null = null

  push(event: CraftyEvent): void {
    const waiter = this.waiter
    if (waiter) {
      this.waiter = null
      waiter(event)
    } else {
      this.items.push(event)
    }
  }

  next(): Promise<CraftyEvent> {
    const item = this.items.shift()
    if (item) return Promise.resolve(item)
    return new Promise(resolve => { this.waiter = resolve })
  }

  /** The page reloaded: its pending poll is gone, so later events wait in the queue. */
  dropWaiter(): void {
    this.waiter = null
  }

  clear(): void {
    this.items = []
    this.waiter = null
  }
}

/**
 * Crafty (spike): the system-wide helper. Owns the global shortcut, the overlay window (one
 * transparent, non-activating panel covering the pointer's display), the native host and the
 * metrics log. See `shared/crafty.ts` for the protocol with the window.
 */
export class CraftyController {
  readonly metrics = new CraftyMetrics()
  private readonly native = new CraftyNativeHost()
  private readonly events = new EventQueue()
  private window: BrowserWindow | null = null
  private windowBounds: Rectangle | null = null
  private windowWorkspaceId: string | null = null
  /** See `windowRoute`. */
  private windowRouteKey: string | null = null
  private windowLoaded: Promise<void> | null = null
  /** Connections to remote workspaces' servers, for the session work main does there. */
  private readonly remote = new RemoteConnections(openRemoteClient)
  /** The stored target's last known summary: a remote one shows it while its server is asked again. */
  private targetSummary: CraftySessionSummary | null = null
  private invocation: Invocation | null = null
  private running = false
  private shortcutRegistered = false
  private panelOpen = false
  private shown = false
  private shownAt = 0
  private follow: CraftyFollowStrategy = 'off'
  /** The last focused Craft window (webContents id): Crafty works in the workspace it shows now. */
  private lastFocusedWindowId: number | null = null
  private forcedHideTimer: NodeJS.Timeout | null = null
  // The double-tap (the input addon's tap, fed through trigger-detect)
  private doubleTap: CraftyDoubleTap = getPersistedCraftyDoubleTap()
  private triggerState: TriggerState = TRIGGER_IDLE
  private inputRunning = false
  private inputProblem: CraftyStatus['doubleTapProblem'] = undefined
  private inputRetryTimer: NodeJS.Timeout | null = null
  /** The helper was restarted for the current grant (`afterTapRefused`). */
  private inputRestartedForGrant = false
  /** The double-tap syncs, run one at a time. */
  private inputSync: Promise<void> = Promise.resolve()
  /** Changes at every start and stop, so a sync that spans one drops its result. */
  private runId = 0

  constructor(private readonly deps: CraftyDeps) {
    app.on('browser-window-focus', (_event, window) => {
      if (window === this.window) return
      // The window, not its workspace: a window switches workspaces without being focused again
      const id = window.webContents.id
      if (this.deps.windowManager.getWorkspaceForWindow(id)) this.lastFocusedWindowId = id
    })
    this.native.onInput(event => this.onInputEvent(event))
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  get unavailableReason(): string | undefined {
    if (process.platform !== 'darwin') return 'Crafty is available on macOS only.'
    if (!this.deps.sessionManager) return 'Crafty needs the local server; it is off in thin-client mode.'
    return undefined
  }

  start(): void {
    if (this.running || this.unavailableReason) return
    this.running = true
    this.runId++
    this.shortcutRegistered = globalShortcut.register(CRAFTY_SHORTCUT, () => { void this.onTrigger('shortcut') })
    if (!this.shortcutRegistered) mainLog.warn('[crafty] could not register the shortcut', CRAFTY_SHORTCUT)
    this.native.warmUp()
    void this.syncDoubleTap()
    void this.ensureWindow(this.resolveWorkspace())
    // A remote target's name and state, for the first shortcut (which doesn't wait for its server)
    const stored = getPersistedCraftyTarget()
    if (stored && getWorkspaceByNameOrId(stored.workspaceId)?.remoteServer) void this.refreshTarget(stored, null)
    this.metrics.record('start', {
      shortcut: CRAFTY_SHORTCUT,
      shortcutRegistered: this.shortcutRegistered,
      doubleTap: this.doubleTap,
      openWith: getPersistedCraftyOpenWith(),
      accessibility: systemPreferences.isTrustedAccessibilityClient(false),
      screenRecording: systemPreferences.getMediaAccessStatus('screen'),
      packaged: app.isPackaged,
      macos: process.getSystemVersion(),
    })
    mainLog.info('[crafty] started', { metrics: this.metrics.path })
  }

  stop(): void {
    if (!this.running) return
    this.running = false
    this.runId++
    if (this.shortcutRegistered) globalShortcut.unregister(CRAFTY_SHORTCUT)
    this.shortcutRegistered = false
    this.clearForcedHide()
    this.window?.destroy()
    this.window = null
    this.windowLoaded = null
    this.windowWorkspaceId = null
    this.windowRouteKey = null
    this.remote.dispose()
    this.shown = false
    this.panelOpen = false
    this.follow = 'off'
    this.events.clear()
    this.clearInputRetry()
    this.triggerState = TRIGGER_IDLE
    this.inputRunning = false
    this.inputProblem = undefined
    this.inputRestartedForGrant = false
    // Kills the host, and the input tap with it
    this.native.stop()
    this.metrics.record('stop')
    this.metrics.dispose()
    mainLog.info('[crafty] stopped')
  }

  /** Start or stop to match the stored setting. */
  syncWithSetting(): void {
    if (getPersistedCraftyEnabled()) this.start()
    else this.stop()
  }

  status(): CraftyStatus {
    const unavailableReason = this.unavailableReason
    return {
      supported: !unavailableReason,
      enabled: getPersistedCraftyEnabled(),
      running: this.running,
      shortcut: CRAFTY_SHORTCUT,
      shortcutRegistered: this.shortcutRegistered,
      accessibility: process.platform === 'darwin' && systemPreferences.isTrustedAccessibilityClient(false),
      screenRecording: process.platform === 'darwin' ? systemPreferences.getMediaAccessStatus('screen') : 'unknown',
      packaged: app.isPackaged,
      follow: this.follow,
      target: getPersistedCraftyTarget(),
      metricsPath: this.metrics.path,
      unavailableReason,
      doubleTap: this.doubleTap,
      openWith: getPersistedCraftyOpenWith(),
      doubleTapRunning: this.inputRunning,
      doubleTapProblem: this.inputProblem,
    }
  }

  /** Settings → Crafty → Double-tap to open. */
  async setDoubleTap(value: CraftyDoubleTap): Promise<CraftyStatus> {
    setPersistedCraftyDoubleTap(value)
    this.doubleTap = value
    await this.syncDoubleTap()
    return this.status()
  }

  /** Settings → Crafty → Opens: the pie or the panel. */
  setOpenWith(value: CraftyOpenWith): CraftyStatus {
    setPersistedCraftyOpenWith(value)
    this.metrics.record('open-with', { value })
    return this.status()
  }

  // ---------------------------------------------------------------------------
  // Double-tap (the input addon's tap)
  // ---------------------------------------------------------------------------

  /**
   * Start or stop the tap to match the setting. Without Accessibility the addon refuses to create
   * it (no prompt), so this tries again every few seconds until the grant arrives, and restarts the
   * helper for a grant it missed (`afterTapRefused`). One sync at a time: a restart takes a moment,
   * and the setting can change meanwhile.
   */
  private syncDoubleTap(): Promise<void> {
    const sync = this.inputSync.then(() => this.applyDoubleTap())
    this.inputSync = sync.catch(() => undefined)
    return sync
  }

  private async applyDoubleTap(): Promise<void> {
    this.clearInputRetry()
    this.triggerState = TRIGGER_IDLE
    const runId = this.runId
    const before = `${this.inputRunning}:${this.inputProblem}`
    let restartedForGrant = false
    if (!this.running || this.doubleTap === 'off') {
      this.inputProblem = undefined
      if (this.inputRunning) await this.native.stopInput().catch(error => mainLog.warn('[crafty] could not stop the input tap', error))
      this.inputRunning = false
    } else {
      let running = false
      let problem: CraftyStatus['doubleTapProblem']
      try {
        const status = await this.native.inputStatus()
        // Stopped meanwhile: starting the tap now would start a new helper for a Crafty that's off
        if (runId !== this.runId) return
        if (!status.available) {
          // Not built (dev without the Xcode tools) or failed to load: it won't come back by retrying
          problem = 'unavailable'
          mainLog.warn('[crafty] input addon unavailable; only the shortcut opens Crafty', status.error)
        } else {
          running = status.running || await this.native.startInput()
          if (!running && runId === this.runId) {
            const step = afterTapRefused({
              mainTrusted: systemPreferences.isTrustedAccessibilityClient(false),
              restarted: this.inputRestartedForGrant,
              busy: this.panelOpen,
            })
            this.inputRestartedForGrant = step.restarted
            if (step.action === 'restart') {
              restartedForGrant = true
              await this.native.restart()
              running = runId === this.runId && await this.native.startInput()
            }
          }
          if (!running) problem = 'accessibility'
        }
      } catch (error) {
        running = false
        problem = 'unavailable'
        mainLog.warn('[crafty] could not start the input tap', error)
      }
      // Stopped (or stopped and started again) meanwhile: that run's own sync takes over
      if (runId !== this.runId) return
      this.inputRunning = running
      this.inputProblem = problem
      if (problem === 'accessibility') this.inputRetryTimer = setTimeout(() => void this.syncDoubleTap(), INPUT_RETRY_MS)
    }
    if (`${this.inputRunning}:${this.inputProblem}` !== before || restartedForGrant) {
      this.metrics.record('double-tap', {
        key: this.doubleTap,
        running: this.inputRunning,
        problem: this.inputProblem ?? null,
        ...(restartedForGrant && { restartedForGrant: true }),
      })
    }
  }

  private clearInputRetry(): void {
    if (this.inputRetryTimer) clearTimeout(this.inputRetryTimer)
    this.inputRetryTimer = null
  }

  private onInputEvent(event: InputEvent): void {
    if (event.type === 'tap') {
      this.metrics.record('double-tap', { state: event.state })
      // Accessibility was revoked and the addon stopped its tap: wait for the grant to come back
      if (event.state === 'stopped-untrusted') void this.syncDoubleTap()
      return
    }
    if (this.doubleTap === 'off' || !this.running) return
    const { state, output } = reduceTrigger(this.triggerState, event, this.doubleTap)
    this.triggerState = state
    if (output?.type === 'press') void this.onTrigger('double-tap')
    else if (output?.type === 'release') this.onTriggerRelease(output.heldMs, output.interrupted)
  }

  /** The double-tap's second press ended: the pie picks, stays open, or (interrupted) closes. */
  private onTriggerRelease(heldMs: number, interrupted: boolean): void {
    const invocation = this.invocation
    const ours = !!invocation && this.panelOpen && invocation.trigger === 'double-tap' && !invocation.released
    this.metrics.record('trigger-release', { id: ours ? invocation.id : null, heldMs: Math.round(heldMs), interrupted })
    if (!ours) return
    invocation.released = true
    if (!invocation.invokePushed) {
      invocation.pendingRelease = { heldMs, interrupted }
      return
    }
    this.events.push({ type: 'trigger-release', invocationId: invocation.id, heldMs, interrupted })
  }

  // ---------------------------------------------------------------------------
  // Target ("Send Crafty here")
  // ---------------------------------------------------------------------------

  /**
   * The session behind a target, if it can still take Crafty's questions (not archived or hidden);
   * null when it or its workspace is gone. Throws when a remote workspace's server can't be reached.
   */
  private async findSession(ref: CraftyTargetRef): Promise<CraftySessionSummary | null> {
    const workspace = getWorkspaceByNameOrId(ref.workspaceId)
    return workspace ? this.sessionsOf(workspace).find(ref.sessionId) : null
  }

  /** Store it and tell Craft's windows (the session menu's check, the composer chip) and the panel. */
  private storeTarget(target: CraftyTargetRef | null, summary: CraftySessionSummary | null, reason: string): void {
    this.targetSummary = summary
    const previous = getPersistedCraftyTarget()
    setPersistedCraftyTarget(target)
    if (sameTarget(previous, target)) return
    this.broadcastTarget()
    // The open panel talks to its own workspace's server, where another workspace's session isn't:
    // a target picked there waits for the next invocation
    if (this.panelOpen && (!target || target.workspaceId === this.invocation?.workspaceId)) {
      this.events.push({ type: 'target', target: summary })
    }
    this.metrics.record('target', { reason, attached: !!target })
  }

  /** Craft's windows show the target while Crafty is on; switched off, no session is its target. */
  broadcastTarget(): void {
    const enabled = getPersistedCraftyEnabled()
    const state: CraftyTargetState = { enabled, target: enabled ? getPersistedCraftyTarget() : null }
    for (const managed of this.deps.windowManager.getAllWindows()) {
      const contents = managed.window.webContents
      if (!contents.isDestroyed()) contents.send('crafty:targetChanged', state)
    }
  }

  /** "Send Crafty here", or null for a new session each time. Refuses a session that can't take it. */
  async setTarget(target: CraftyTargetRef | null, reason: string): Promise<CraftyTargetRef | null> {
    if (!target) {
      this.storeTarget(null, null, reason)
      return null
    }
    const summary = await this.findSession(target)
    if (!summary) throw new Error('Crafty can only send to a session that still exists and isn\'t archived.')
    this.storeTarget(target, summary, reason)
    return target
  }

  /**
   * The stored target, checked; one that was archived or deleted falls back to a new session. A
   * remote target can't be checked before the panel opens (its server may be slow or unreachable),
   * so it opens with what was last known and the panel hears from `refreshTarget`.
   */
  private async currentTarget(invocationId: string): Promise<CraftySessionSummary | null> {
    const stored = getPersistedCraftyTarget()
    if (!stored) return null
    const workspace = getWorkspaceByNameOrId(stored.workspaceId)
    if (!workspace) {
      this.storeTarget(null, null, 'unavailable')
      return null
    }
    if (workspace.remoteServer) {
      void this.refreshTarget(stored, invocationId)
      return this.knownSummary(stored)
    }
    try {
      const summary = await this.findSession(stored)
      if (summary) this.targetSummary = summary
      else this.storeTarget(null, null, 'unavailable')
      return summary
    } catch (error) {
      // Sessions failed to load: keep the target for later, use a new session this time
      mainLog.warn('[crafty] could not check the target', error)
      return null
    }
  }

  /** The target's last known summary, else just its reference: the panel names it once it's checked. */
  private knownSummary(ref: CraftyTargetRef): CraftySessionSummary {
    const known = this.targetSummary
    if (known && sameTarget(known, ref)) return known
    return { ...ref, name: null, preview: null, lastMessageAt: null, isProcessing: false }
  }

  /**
   * Ask a remote target's server about it: gone (archived, deleted) → a new session from now on;
   * there → its fresh summary for the open panel (its title, whether a turn runs). When the server
   * can't be reached nothing changes: sending fails and says so.
   */
  private async refreshTarget(ref: CraftyTargetRef, invocationId: string | null): Promise<void> {
    let summary: CraftySessionSummary | null
    try {
      summary = await this.findSession(ref)
    } catch (error) {
      mainLog.warn('[crafty] could not check the target', error)
      return
    }
    // Changed meanwhile (another target, or none): this answer is about the old one
    if (!sameTarget(getPersistedCraftyTarget(), ref)) return
    if (!summary) {
      this.storeTarget(null, null, 'unavailable')
      return
    }
    this.targetSummary = summary
    // Before its `invoke` the panel would take this for the previous invocation's (and the invoke
    // then overwrites it): `onTrigger` reads the summary from `targetSummary` instead
    const invocation = this.invocation
    if (invocationId !== null && this.panelOpen && invocation?.id === invocationId && invocation.invokePushed) {
      this.events.push({ type: 'target', target: summary })
    }
  }

  async openPermissionSettings(kind: CraftyPermissionKind): Promise<void> {
    await shell.openExternal(PERMISSION_PANES[kind])
  }

  /** Shows macOS's own prompt (and adds the app to the Accessibility list) when not yet trusted. */
  requestAccessibility(): boolean {
    return systemPreferences.isTrustedAccessibilityClient(true)
  }

  /** Answers the preload's `__get-workspace-id` for the Crafty window. */
  workspaceForWebContents(webContentsId: number): string | null {
    const window = this.window
    if (!window || window.isDestroyed() || window.webContents.id !== webContentsId) return null
    return this.windowWorkspaceId ?? ''
  }

  isCraftyWebContents(webContentsId: number): boolean {
    const window = this.window
    return !!window && !window.isDestroyed() && window.webContents.id === webContentsId
  }

  // ---------------------------------------------------------------------------
  // Window
  // ---------------------------------------------------------------------------

  /**
   * The workspace (local or remote) of the last focused Craft window, as it is now; else of any open
   * window; else the first local workspace (no window says which, and it needs no network); else the
   * first.
   */
  private resolveWorkspace(workspaces: Workspace[] = getWorkspaces()): Workspace | null {
    const windows = this.deps.windowManager
    const find = (id: string | null) => (id ? workspaces.find(workspace => workspace.id === id) : undefined)
    const focused = this.lastFocusedWindowId === null ? undefined : find(windows.getWorkspaceForWindow(this.lastFocusedWindowId))
    if (focused) return focused
    for (const managed of windows.getAllWindows()) {
      const open = find(windows.getWorkspaceForWindow(managed.window.webContents.id))
      if (open) return open
    }
    return workspaces.find(workspace => !workspace.remoteServer) ?? workspaces[0] ?? null
  }

  /**
   * The window is created once and kept warm. Its preload connects once at load, to its workspace's
   * server (this process's for a local workspace), so a different workspace, or a new address or
   * token for a remote one, reloads it.
   */
  private async ensureWindow(workspace: Workspace | null): Promise<{ window: BrowserWindow; reloaded: boolean }> {
    let reloaded = false
    const route = windowRoute(workspace)
    if (!this.window || this.window.isDestroyed()) {
      this.window = this.createWindow()
      this.windowWorkspaceId = workspace?.id ?? null
      this.windowRouteKey = route
      this.windowLoaded = this.load(this.window)
    } else if (route !== this.windowRouteKey) {
      this.windowWorkspaceId = workspace?.id ?? null
      this.windowRouteKey = route
      this.windowLoaded = this.load(this.window)
      reloaded = true
    }
    await this.windowLoaded
    return { window: this.window, reloaded }
  }

  private createWindow(): BrowserWindow {
    const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
    const window = new BrowserWindow({
      ...display.bounds,
      // NSPanel with NSWindowStyleMaskNonactivatingPanel: it can become key without activating
      // Craft, so the app you came from keeps its caret and menu bar.
      type: 'panel',
      show: false,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      hasShadow: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      hiddenInMissionControl: true,
      roundedCorners: false,
      enableLargerThanScreen: true,
      alwaysOnTop: true,
      title: 'Crafty',
      webPreferences: {
        preload: join(__dirname, 'bootstrap-preload.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
        webviewTag: false,
        spellcheck: false,
      },
    })
    this.windowBounds = display.bounds
    window.excludedFromShownWindowsMenu = true
    window.setAlwaysOnTop(true, 'screen-saver')
    // Over full-screen apps and on every Space. skipTransformProcessType keeps the Dock icon.
    window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true })
    window.setIgnoreMouseEvents(true, { forward: true })
    window.webContents.on('before-input-event', (event, input) => {
      if (input.type === 'keyDown' && input.meta && !META_KEYS_ALLOWED.has(input.key.toLowerCase())) event.preventDefault()
    })
    window.webContents.on('did-start-loading', () => this.events.dropWaiter())
    window.webContents.on('render-process-gone', (_event, details) => {
      mainLog.warn('[crafty] renderer gone', details)
      this.metrics.record('renderer-gone', { reason: details.reason })
    })
    window.on('closed', () => {
      if (this.window === window) {
        this.window = null
        this.windowLoaded = null
      }
    })
    return window
  }

  private load(window: BrowserWindow): Promise<void> {
    const loaded = VITE_DEV_SERVER_URL
      ? window.loadURL(`${VITE_DEV_SERVER_URL}/crafty.html`)
      : window.loadFile(join(__dirname, 'renderer/crafty.html'))
    return loaded
      .then(() => {
        // A reloaded page starts with follow off; tell it what Settings chose
        if (this.follow !== 'off') this.events.push({ type: 'follow', strategy: this.follow })
      })
      .catch((error: unknown) => {
        mainLog.error('[crafty] window failed to load', error)
      })
  }

  private moveToDisplay(window: BrowserWindow, bounds: Rectangle): void {
    const current = this.windowBounds
    if (current && current.x === bounds.x && current.y === bounds.y && current.width === bounds.width && current.height === bounds.height) return
    window.setBounds(bounds)
    this.windowBounds = bounds
  }

  /** Cherry Studio's sequence: never `focusable: false`, re-apply the level after each show. */
  private showWindow(window: BrowserWindow): void {
    this.clearForcedHide()
    window.setAlwaysOnTop(true, 'screen-saver')
    if (!this.shown) {
      window.setFocusable(false)
      window.showInactive()
      window.setFocusable(true)
      this.shown = true
      this.shownAt = Date.now()
      this.metrics.startSampling(window.webContents, () => (!this.shown ? 'hidden' : this.panelOpen ? 'panel' : 'companion'))
    }
    window.setIgnoreMouseEvents(true, { forward: true })
  }

  /** `toCraft`: a Craft window takes over, so the others stay focusable for it. */
  private hideWindow(reason: string, { toCraft = false }: { toCraft?: boolean } = {}): void {
    this.clearForcedHide()
    const window = this.window
    if (!window || window.isDestroyed() || !this.shown) return
    // Cherry Studio: while the panel resigns key, keep macOS from making another Craft window
    // key, which would activate Craft and raise the main window over the app you came from.
    // Not when opening Craft: a window made unfocusable for those 50 ms ignores focus().
    const others = toCraft ? [] : BrowserWindow.getAllWindows().filter(w => w !== window && !w.isDestroyed() && w.isFocusable())
    for (const other of others) other.setFocusable(false)
    window.setIgnoreMouseEvents(true, { forward: true })
    window.hide()
    setTimeout(() => {
      for (const other of others) if (!other.isDestroyed()) other.setFocusable(true)
    }, 50)
    this.shown = false
    this.metrics.stopSampling()
    this.metrics.record('hide', { id: this.invocation?.id, reason, visibleMs: Date.now() - this.shownAt })
  }

  private clearForcedHide(): void {
    if (this.forcedHideTimer) clearTimeout(this.forcedHideTimer)
    this.forcedHideTimer = null
  }

  // ---------------------------------------------------------------------------
  // Trigger (⌃⌥Space or the double-tap) → capture
  // ---------------------------------------------------------------------------

  private async onTrigger(trigger: CraftyTriggerSource): Promise<void> {
    const at = Date.now()
    if (this.panelOpen) {
      // Still loading the window for the last press: a dismiss now would reach the window before
      // that invocation, and the forced hide would then close the panel it opens.
      if (!this.shown) return
      if (this.invocation && at - this.invocation.at < REPEAT_GUARD_MS) return
      // Pressing it again closes the pie or panel. The window animates out, then calls hide.
      this.events.push({ type: 'dismiss', reason: 'shortcut' })
      this.clearForcedHide()
      this.forcedHideTimer = setTimeout(() => this.closePanel('shortcut-timeout'), FORCED_HIDE_MS)
      return
    }

    const cursor = screen.getCursorScreenPoint()
    const display = screen.getDisplayNearestPoint(cursor)
    const id = randomUUID()
    const origin = { x: display.bounds.x, y: display.bounds.y }
    // Without it the selection read returns nothing at once; the panel says why instead of "No selection"
    const accessibility = systemPreferences.isTrustedAccessibilityClient(false)

    // Capture first, before the window shows: the panel never takes focus before these finish.
    const selection = this.native.getSelection(origin)
    const frontmost = getFrontmostInfo({ title: true, pasteboard: true })
    const recent = findRecentScreenshot()

    const invocation: Invocation = {
      id,
      at,
      workspaceId: null,
      bounds: display.bounds,
      source: null,
      recentScreenshot: null,
      trigger,
      invokePushed: false,
      pendingRelease: null,
      released: false,
    }
    this.invocation = invocation
    this.panelOpen = true
    const surface = getPersistedCraftyOpenWith()

    // A target takes Crafty to its workspace; the window reloads for it if it was on another
    const checked = await this.currentTarget(id)
    const workspaces = getWorkspaces()
    const workspace = checked
      ? workspaces.find(candidate => candidate.id === checked.workspaceId) ?? null
      : this.resolveWorkspace(workspaces)
    const workspaceId = workspace?.id ?? null
    if (this.invocation?.id === id) this.invocation.workspaceId = workspaceId

    const { window, reloaded } = await this.ensureWindow(workspace)
    // A remote target's background check can finish while the window loads (`refreshTarget` only
    // tells a panel that has its invocation): take what it found, a fresh summary or no target
    const target = checked && sameTarget(getPersistedCraftyTarget(), checked) ? this.knownSummary(checked) : null
    this.moveToDisplay(window, display.bounds)
    this.events.push({
      type: 'invoke',
      invocation: {
        id,
        at,
        workspaceId,
        // With one workspace there's nothing to tell apart
        workspaceLabel: workspaces.length > 1 ? workspace?.name ?? null : null,
        target,
        cursor: { x: cursor.x - display.bounds.x, y: cursor.y - display.bounds.y },
        windowSize: { width: display.bounds.width, height: display.bounds.height },
        reloaded,
        accessibility,
        packaged: app.isPackaged,
        surface,
        trigger,
        languages: [...getPersistedCraftyRecentLanguages(), ...app.getPreferredSystemLanguages()],
      },
    })
    invocation.invokePushed = true
    // A quick tap's release can beat the invoke (the window's load and the target check take a moment)
    const release = invocation.pendingRelease
    if (release && this.invocation?.id === id) {
      invocation.pendingRelease = null
      this.events.push({ type: 'trigger-release', invocationId: id, ...release })
    }
    this.showWindow(window)
    this.metrics.record('invoke', {
      id,
      trigger,
      surface,
      workspaceId,
      remote: !!workspace?.remoteServer,
      attached: !!target,
      targetBusy: target?.isProcessing ?? null,
      reloaded,
      accessibility,
      showMs: Date.now() - at,
      display: { id: display.id, scaleFactor: display.scaleFactor, width: display.bounds.width, height: display.bounds.height },
      follow: this.follow,
    })

    void selection.then(result => {
      if (this.invocation?.id !== id) return
      this.events.push({ type: 'selection', invocationId: id, result })
      const s = result.selection
      this.metrics.record('capture', {
        id,
        found: !!s,
        method: s?.method ?? null,
        rawMethod: s?.rawMethod ?? null,
        posLevel: s?.posLevel ?? null,
        hookLatencyMs: result.latencyMs,
        roundTripMs: Date.now() - at,
        textLength: s?.text.length ?? 0,
        bounds: s?.bounds ?? null,
        programName: s?.programName ?? null,
        isFullscreen: s?.isFullscreen ?? null,
        // The ⌘C fallback: posted, whether the app copied, and whether the clipboard came back
        copy: result.copy ?? null,
        error: result.error ?? null,
      })
    })

    void Promise.all([frontmost.then(r => ({ ok: true as const, r }), (error: unknown) => ({ ok: false as const, error })), recent])
      .then(async ([front, recentScreenshot]) => {
        if (this.invocation?.id !== id) return
        this.invocation.recentScreenshot = recentScreenshot
        const provenance: CraftyProvenance = front.ok
          ? {
            pid: front.r.value.pid,
            bundleId: front.r.value.bundleId,
            appName: front.r.value.appName,
            windowTitle: front.r.value.windowTitle,
            url: null,
            notes: front.r.value.notes,
            latencyMs: front.r.durationMs,
            urlPending: isBrowser(front.r.value.bundleId),
          }
          : { pid: null, bundleId: null, appName: null, windowTitle: null, url: null, notes: [`provenance: ${String(front.error)}`], latencyMs: Date.now() - at }
        this.invocation.source = { pid: provenance.pid, bundleId: provenance.bundleId, appName: provenance.appName }
        this.events.push({ type: 'provenance', invocationId: id, provenance, recentScreenshot })
        void this.checkEditable(id, provenance.pid)
        this.metrics.record('provenance', {
          id,
          bundleId: provenance.bundleId,
          appName: provenance.appName,
          hasWindowTitle: !!provenance.windowTitle,
          notes: provenance.notes,
          latencyMs: provenance.latencyMs,
          pasteboard: front.ok ? front.r.value.pasteboard : null,
          trustedInOsascript: front.ok ? front.r.value.trusted : null,
          recentScreenshotAgeS: recentScreenshot?.ageSeconds ?? null,
        })

        if (!isBrowser(provenance.bundleId)) return
        try {
          const { value, durationMs } = await getBrowserUrl(provenance.bundleId!)
          if (this.invocation?.id !== id) return
          this.events.push({ type: 'provenance', invocationId: id, provenance: { ...provenance, url: value.url, urlPending: false }, recentScreenshot })
          this.metrics.record('browser-url', { id, bundleId: provenance.bundleId, ok: true, hasUrl: !!value.url, latencyMs: durationMs })
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          if (this.invocation?.id === id) {
            this.events.push({
              type: 'provenance',
              invocationId: id,
              provenance: { ...provenance, notes: [...provenance.notes, `url: ${message}`], urlPending: false },
              recentScreenshot,
            })
          }
          this.metrics.record('browser-url', { id, bundleId: provenance.bundleId, ok: false, error: message })
        }
      })
  }

  /**
   * Whether the source app's focused element takes text, so the pie offers Replace and not only
   * Copy. Asked of the app by pid, which holds while Crafty's panel is key.
   */
  private async checkEditable(invocationId: string, pid: number | null): Promise<void> {
    // Crafty called from Craft itself: its focused element becomes the panel's composer
    if (!pid || pid === process.pid) {
      this.events.push({ type: 'editable', invocationId, editable: false })
      return
    }
    try {
      const focused = await this.native.focusedEditable(pid)
      if (this.invocation?.id !== invocationId) return
      this.events.push({ type: 'editable', invocationId, editable: focused.editable })
      this.metrics.record('editable', { id: invocationId, editable: focused.editable, role: focused.role, subrole: focused.subrole, axError: focused.error })
    } catch (error) {
      if (this.invocation?.id === invocationId) this.events.push({ type: 'editable', invocationId, editable: false })
      this.metrics.record('editable', { id: invocationId, editable: false, error: error instanceof Error ? error.message : String(error) })
    }
  }

  // ---------------------------------------------------------------------------
  // Window requests (crafty:* IPC, Crafty window only)
  // ---------------------------------------------------------------------------

  nextEvent(): Promise<CraftyEvent> {
    return this.events.next()
  }

  cursor(): CraftyPoint {
    const point = screen.getCursorScreenPoint()
    const bounds = this.windowBounds ?? { x: 0, y: 0 }
    return { x: point.x - bounds.x, y: point.y - bounds.y }
  }

  setInteractive(interactive: boolean): void {
    const window = this.window
    if (!window || window.isDestroyed()) return
    window.setIgnoreMouseEvents(!interactive, { forward: true })
  }

  /**
   * Make the panel the key window so you can type, without activating Craft. Then check which
   * app macOS considers frontmost: the spike's pass condition is that it's still the source app.
   */
  focusPanel(invocationId: string): void {
    const window = this.window
    if (!window || window.isDestroyed()) return
    window.focus()
    window.webContents.focus()
    setTimeout(() => {
      // Read the source app now, not at the call: the panel asks for focus before provenance
      // (osascript, ~100 ms) has said which app that is
      const sourcePid = this.invocation?.id === invocationId ? this.invocation.source?.pid ?? null : null
      getFrontmostInfo().then(({ value }) => {
        this.metrics.record('focus-check', {
          id: invocationId,
          frontPid: value.pid,
          frontBundleId: value.bundleId,
          sourcePid,
          sourceStillFrontmost: sourcePid === null ? null : value.pid === sourcePid,
          craftActivated: value.pid === process.pid,
          panelIsKey: window.isDestroyed() ? null : window.isFocused(),
        })
      }).catch(error => this.metrics.record('focus-check', { id: invocationId, error: String(error) }))
    }, 300)
  }

  /**
   * Hand the keyboard back to the app underneath but stay up, click-through: the window shows a
   * notice after the pie sent something. The next trigger starts a new invocation.
   */
  resignKey(invocationId: string): void {
    const window = this.window
    if (this.invocation?.id !== invocationId || !this.shown || !window || window.isDestroyed()) return
    this.panelOpen = false
    this.hideWindow('notice')
    this.showWindow(window)
  }

  /** The window finished its exit animation (or Esc). Keeps it up as a companion while following. */
  closePanel(reason: string): void {
    this.panelOpen = false
    if (this.follow !== 'off' && this.window && !this.window.isDestroyed()) {
      // Resign key so typing goes back to the app underneath, but keep following the cursor.
      this.hideWindow(reason)
      this.showWindow(this.window)
      return
    }
    this.hideWindow(reason)
  }

  /** From Settings: the window runs the tracking, so it hears about the change first. */
  async setFollow(strategy: CraftyFollowStrategy): Promise<void> {
    if (!this.running) return
    this.follow = strategy
    this.events.push({ type: 'follow', strategy })
    this.metrics.record('follow', { strategy })
    if (strategy === 'off') {
      if (!this.panelOpen) this.hideWindow('follow-off')
      return
    }
    if (!this.shown) {
      const current = this.windowWorkspaceId ? getWorkspaceByNameOrId(this.windowWorkspaceId) : null
      const { window } = await this.ensureWindow(current ?? this.resolveWorkspace())
      this.moveToDisplay(window, screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).bounds)
      this.showWindow(window)
    }
  }

  /** Crafty's session work in a workspace: in this process for a local one, on its server for a remote one. */
  private sessionsOf(workspace: Workspace): CraftySessions {
    const server = workspace.remoteServer
    if (server) {
      return remoteCraftySessions(workspace, server, {
        get: () => this.remote.get(workspace.id, server),
        discard: client => this.remote.discard(workspace.id, client),
      })
    }
    if (!this.deps.sessionManager) throw new Error('Crafty needs the local server.')
    return localCraftySessions(this.deps.sessionManager, workspace)
  }

  /** The invocation's workspace (else the window's): where the panel's session work goes. */
  private invocationWorkspace(invocationId: string): Workspace {
    const workspaceId = this.invocation?.id === invocationId ? this.invocation.workspaceId : this.windowWorkspaceId
    const workspace = workspaceId ? getWorkspaceByNameOrId(workspaceId) : null
    if (!workspace) throw new Error('Crafty has no workspace to work in.')
    return workspace
  }

  /** `model` is the panel's pick; unset fields take the workspace's defaults, like any new session. */
  async createSession(invocationId: string, model: CraftySessionModel = {}): Promise<CraftyCreateSessionResult> {
    const workspace = this.invocationWorkspace(invocationId)
    const session = await this.sessionsOf(workspace).create(model)
    // The model goes in the measurements: first-token latency depends on it
    this.metrics.record('session', {
      id: invocationId,
      sessionId: session.sessionId,
      workspaceId: workspace.id,
      remote: !!workspace.remoteServer,
      picked: !!model.llmConnection || !!model.model,
      connection: session.llmConnection ?? null,
      model: session.model ?? null,
      thinkingLevel: session.thinkingLevel ?? null,
    })
    return session
  }

  /** The invocation's workspace sessions that can take Crafty's questions, most recent first. */
  async listSessions(invocationId: string): Promise<CraftySessionSummary[]> {
    return this.sessionsOf(this.invocationWorkspace(invocationId)).list(MAX_LISTED_SESSIONS)
  }

  async insert(request: CraftyInsertRequest): Promise<CraftyInsertResult> {
    const started = Date.now()
    const source = this.invocation?.id === request.invocationId ? this.invocation.source : null
    const text = request.text
    const mode = chooseInsertMode(request.mode, text, source?.bundleId ?? null)
    const following = this.follow
    this.panelOpen = false
    this.hideWindow('insert')
    // Give macOS a moment to hand key status back to the app underneath.
    await new Promise(resolve => setTimeout(resolve, 60))
    let result: CraftyInsertResult
    try {
      const { value, durationMs } = await insertText({ pid: source?.pid ?? null, text, mode, restore: true, restoreDelayMs: 250 })
      result = {
        ok: value.ok,
        mode,
        error: value.error,
        reactivated: value.reactivated,
        clipboardRestored: value.clipboardRestored ?? undefined,
        durationMs: Date.now() - started,
      }
      this.metrics.record('insert', {
        id: request.invocationId,
        ok: value.ok,
        mode,
        requestedMode: request.mode,
        textLength: text.length,
        bundleId: source?.bundleId ?? null,
        reactivated: value.reactivated,
        frontBefore: value.frontBefore ?? null,
        sourcePid: source?.pid ?? null,
        clipboardRestored: value.clipboardRestored,
        accessBehavior: value.accessBehavior,
        scriptMs: durationMs,
        totalMs: result.durationMs,
        error: value.error ?? null,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      result = { ok: false, mode, error: message, durationMs: Date.now() - started }
      this.metrics.record('insert', { id: request.invocationId, ok: false, mode, error: message })
    }
    const window = this.window
    if (window && !window.isDestroyed()) {
      // A failed insert brings the panel back to say why (the answer is still there to copy); a
      // confirmed one comes back click-through for the window's notice ("Replaced · ⌘Z undoes it")
      if (!result.ok) this.panelOpen = true
      if (!result.ok || following !== 'off' || request.confirm) this.showWindow(window)
    }
    return result
  }

  /** Hide the panel while macOS's region picker runs, then bring it back with the capture. */
  async captureRegion(invocationId: string): Promise<CraftyScreenshot | null> {
    const window = this.window
    if (!window || window.isDestroyed()) return null
    this.hideWindow('capture-region')
    const started = Date.now()
    let screenshot: CraftyScreenshot | null = null
    try {
      const path = await captureRegion()
      screenshot = path ? await toScreenshot(path, 'Screen region.png') : null
    } finally {
      this.metrics.record('region', {
        id: invocationId,
        captured: !!screenshot,
        bytes: screenshot?.attachment.size ?? 0,
        ms: Date.now() - started,
        screenRecording: systemPreferences.getMediaAccessStatus('screen'),
      })
      if (!window.isDestroyed()) this.showWindow(window)
    }
    return screenshot
  }

  async useRecentScreenshot(invocationId: string): Promise<CraftyScreenshot | null> {
    const recent = this.invocation?.id === invocationId ? this.invocation.recentScreenshot : null
    if (!recent) return null
    this.metrics.record('recent-screenshot', { id: invocationId, ageSeconds: recent.ageSeconds })
    return toScreenshot(recent.path, recent.name)
  }

  async openInCraft(workspaceId: string, sessionId: string): Promise<void> {
    this.panelOpen = false
    this.hideWindow('open-in-craft', { toCraft: true })
    this.metrics.record('open-in-craft', { id: this.invocation?.id, sessionId })
    await this.deps.openSession(workspaceId, sessionId)
  }

  /** The pie hub's Craft mark: Craft Agents itself, in Crafty's workspace, showing what it showed. */
  async openCraft(invocationId: string): Promise<void> {
    const workspaceId = (this.invocation?.id === invocationId ? this.invocation.workspaceId : null) ?? this.resolveWorkspace()?.id ?? null
    this.panelOpen = false
    this.hideWindow('open-craft', { toCraft: true })
    this.metrics.record('open-craft', { id: invocationId, workspaceId })
    await this.deps.openCraft(workspaceId)
  }

  /** Move the pointer to a point in the window: the pie moved in from a screen edge. */
  async warp(invocationId: string, point: CraftyPoint): Promise<boolean> {
    const bounds = this.windowBounds
    if (this.invocation?.id !== invocationId || !bounds) return false
    try {
      const ok = await this.native.warp(bounds.x + point.x, bounds.y + point.y)
      this.metrics.record('warp', { id: invocationId, ok })
      return ok
    } catch (error) {
      this.metrics.record('warp', { id: invocationId, ok: false, error: error instanceof Error ? error.message : String(error) })
      return false
    }
  }

  /** Rewrite or translate the selection: one completion on a throwaway agent (on the workspace's server), no session. */
  async transform(request: CraftyTransformRequest): Promise<CraftyTransformResult> {
    const workspace = this.invocationWorkspace(request.invocationId)
    const started = Date.now()
    const { transform } = request
    const detail = { ...(transform.kind === 'rewrite' ? { style: transform.style } : { language: transform.language }), remote: !!workspace.remoteServer }
    try {
      const raw = await this.sessionsOf(workspace).complete(buildTransformPrompt(transform, request.text), request.model ?? {})
      const text = cleanTransformResult(raw, request.text)
      const durationMs = Date.now() - started
      if (request.languageCode) rememberCraftyLanguage(request.languageCode)
      this.metrics.record('transform', { id: request.invocationId, kind: transform.kind, ...detail, ok: true, ms: durationMs, inputLength: request.text.length, outputLength: text.length })
      return { text, durationMs }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.metrics.record('transform', { id: request.invocationId, kind: transform.kind, ...detail, ok: false, ms: Date.now() - started, error: message })
      throw error
    }
  }

  rendererMetric(metric: CraftyMetric): void {
    const { kind, ...rest } = metric
    this.metrics.record(`window:${String(kind)}`, rest)
  }

  dispose(): void {
    this.stop()
  }
}
