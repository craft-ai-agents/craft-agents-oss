/**
 * RemoteBrowserPaneManager
 *
 * Thin proxy that implements `IBrowserPaneManager` for a single remote session.
 * Every method packages its args into a `BrowserCapabilityRequest` and ships it
 * to the user's desktop client via `server.invokeClient(...)`. The local
 * `BrowserPaneManager` dispatcher (in `apps/electron`) executes the call and
 * returns the result through the same WS RPC channel.
 *
 * One instance per (sessionId, workspaceId). Stored on `SessionManager` in a
 * `Map<sessionId, RemoteBrowserPaneManager>` and torn down on session destroy.
 *
 * See docs/adr-transport-locality.md for the locality boundary definition.
 */

import { CodedError } from '@craft-agent/shared/protocol'
import type { BrowserInstanceInfo } from '@craft-agent/shared/protocol'
import type {
  IBrowserPaneManager,
  BrowserScreenshotOptions,
  BrowserScreenshotRegionTarget,
  BrowserScreenshotResult,
  BrowserConsoleOptions,
  BrowserConsoleEntry,
  BrowserNetworkOptions,
  BrowserNetworkEntry,
  BrowserKeyArgs,
  BrowserWaitArgs,
  BrowserWaitResult,
  BrowserDownloadOptions,
  BrowserDownloadEntry,
  BrowserInstanceSnapshot,
  AccessibilitySnapshot,
} from '../handlers/browser-pane-manager-interface'
import {
  CLIENT_BROWSER_INVOKE,
  requestClientBrowserInvoke,
  type BrowserCapabilityMethod,
  type ScreenshotResultWire,
} from '../transport'
import type { RpcServer } from '../transport/types'

export interface RemoteBrowserPaneManagerDeps {
  readonly sessionId: string
  readonly workspaceId: string
  readonly rpcServer: RpcServer
  /**
   * Resolves the desktop client that should host this session's browser.
   * Returns null when no capable client is connected. SessionManager handles
   * pin + fallback selection so the bridge stays agnostic of routing policy.
   */
  readonly getHostClient: () => string | null
}

export class RemoteBrowserPaneManager implements IBrowserPaneManager {
  private readonly sessionId: string
  private readonly workspaceId: string
  private readonly rpcServer: RpcServer
  private readonly getHostClient: () => string | null

  constructor(deps: RemoteBrowserPaneManagerDeps) {
    this.sessionId = deps.sessionId
    this.workspaceId = deps.workspaceId
    this.rpcServer = deps.rpcServer
    this.getHostClient = deps.getHostClient
  }

  // ---------------------------------------------------------------------------
  // Internal: package and ship one IBrowserPaneManager call.
  // ---------------------------------------------------------------------------

  private async invoke<T>(method: BrowserCapabilityMethod, args: unknown[]): Promise<T> {
    const clientId = this.getHostClient()
    if (!clientId) {
      throw new CodedError(
        'BROWSER_NO_CAPABLE_CLIENT',
        'No connected desktop client supports browser tools for this session. ' +
        'Open this workspace from the Craft Agent desktop app and try again.',
      )
    }
    if (!this.rpcServer.hasClientCapability(clientId, CLIENT_BROWSER_INVOKE)) {
      throw new CodedError(
        'CAPABILITY_UNAVAILABLE',
        `Client ${clientId} does not advertise the ${CLIENT_BROWSER_INVOKE} capability.`,
      )
    }
    return await requestClientBrowserInvoke<T>(this.rpcServer, clientId, {
      v: 1,
      method,
      args,
      sessionId: this.sessionId,
      workspaceId: this.workspaceId,
    })
  }

  /** Synchronous methods on IBPM are emulated by awaiting in callers; here we
   * preserve a `void` return for fire-and-forget paths used by SessionManager. */
  private invokeSync(method: BrowserCapabilityMethod, args: unknown[]): void {
    this.invoke<unknown>(method, args).catch(() => {
      // Swallow — callers like setAgentControl / unbindAllForSession don't await.
      // The remote agent will surface the error on the next awaited call if
      // something is genuinely broken.
    })
  }

  // ---------------------------------------------------------------------------
  // IBrowserPaneManager — session lifecycle
  // ---------------------------------------------------------------------------

  setSessionPathResolver(_fn: (sessionId: string) => string | null): void {
    // No-op: path resolution belongs to the remote server, not the client BPM.
    // Calls into this method from the server side are still useful locally for
    // metadata, but the BPM itself doesn't need them on a remote bridge.
  }

  destroyForSession(sessionId: string): void {
    this.invokeSync('destroyForSession', [sessionId])
  }

  async clearVisualsForSession(sessionId: string): Promise<void> {
    await this.invoke<void>('clearVisualsForSession', [sessionId])
  }

  unbindAllForSession(sessionId: string): void {
    this.invokeSync('unbindAllForSession', [sessionId])
  }

  /**
   * IBPM declares `getOrCreateForSession` as synchronous. The async work is
   * fired-and-forgot here; SessionManager's tool runtime always follows with
   * an awaited call (navigate, screenshot, …) that surfaces real errors.
   *
   * Callers that need the actual instanceId should use the async-friendly
   * `createForSession` path via the browser-tool-runtime, which awaits.
   */
  getOrCreateForSession(sessionId: string, _options?: { workspaceId?: string | null }): string {
    // The remote bridge can't synchronously block on a WS round-trip. Return
    // an opaque sentinel — async-aware callers should use `getOrCreateForSessionAsync`.
    // workspaceId is carried on the wire via `BrowserCapabilityRequest.workspaceId`
    // (set from `this.workspaceId`), so the dispatcher already knows it.
    this.invokeSync('getOrCreateForSession', [sessionId])
    return `remote-pending:${sessionId}`
  }

  async getOrCreateForSessionAsync(sessionId: string, _options?: { workspaceId?: string | null }): Promise<string> {
    return await this.invoke('getOrCreateForSession', [sessionId])
  }

  setAgentControl(
    sessionId: string,
    meta: { displayName?: string; intent?: string },
    _options?: { workspaceId?: string | null },
  ): void {
    this.invokeSync('setAgentControl', [sessionId, meta])
  }

  // ---------------------------------------------------------------------------
  // IBrowserPaneManager — instance management
  // ---------------------------------------------------------------------------

  createForSession(sessionId: string, options?: { show?: boolean; workspaceId?: string | null }): string {
    this.invokeSync('createForSession', [sessionId, options])
    return `remote-pending:${sessionId}`
  }

  async createForSessionAsync(sessionId: string, options?: { show?: boolean; workspaceId?: string | null }): Promise<string> {
    return await this.invoke('createForSession', [sessionId, options])
  }

  getInstance(_id: string): BrowserInstanceSnapshot | undefined {
    // Synchronous accessor — bridge cannot make a WS round-trip here. Callers
    // who need this info should use the async-friendly `getInstanceAsync`.
    return undefined
  }

  async getInstanceAsync(id: string): Promise<BrowserInstanceSnapshot | undefined> {
    return await this.invoke('getInstance', [id])
  }

  listInstances(): BrowserInstanceInfo[] {
    // Sync surface returns []; remote-aware code uses `listInstancesAsync`.
    return []
  }

  async listInstancesAsync(): Promise<BrowserInstanceInfo[]> {
    return await this.invoke('listInstances', [])
  }

  focusBoundForSession(sessionId: string, _options?: { workspaceId?: string | null }): string {
    this.invokeSync('focusBoundForSession', [sessionId])
    return `remote-pending:${sessionId}`
  }

  async focusBoundForSessionAsync(sessionId: string, _options?: { workspaceId?: string | null }): Promise<string> {
    return await this.invoke('focusBoundForSession', [sessionId])
  }

  bindSession(id: string, sessionId: string, _options?: { workspaceId?: string | null }): void {
    this.invokeSync('bindSession', [id, sessionId])
  }

  focus(id: string): void {
    this.invokeSync('focus', [id])
  }

  destroyInstance(id: string): void {
    this.invokeSync('destroyInstance', [id])
  }

  hide(id: string): void {
    this.invokeSync('hide', [id])
  }

  clearAgentControl(sessionId: string): void {
    this.invokeSync('clearAgentControl', [sessionId])
  }

  clearAgentControlForInstance(
    instanceId: string,
    sessionId?: string,
  ): { released: boolean; reason?: string } {
    // Synchronous IBPM return — fire-and-forget the actual call. Callers in
    // forced-stop flows treat a successful local cleanup as best-effort.
    this.invokeSync('clearAgentControlForInstance', [instanceId, sessionId])
    return { released: true }
  }

  // ---------------------------------------------------------------------------
  // Async methods — these are the ones that actually matter to the agent.
  // ---------------------------------------------------------------------------

  async navigate(id: string, url: string): Promise<{ url: string; title: string }> {
    return await this.invoke('navigate', [id, url])
  }
  async goBack(id: string): Promise<void> {
    await this.invoke('goBack', [id])
  }
  async goForward(id: string): Promise<void> {
    await this.invoke('goForward', [id])
  }

  async getAccessibilitySnapshot(id: string): Promise<AccessibilitySnapshot> {
    return await this.invoke('getAccessibilitySnapshot', [id])
  }
  async clickElement(
    id: string, ref: string,
    options?: { waitFor?: 'none' | 'navigation' | 'network-idle'; timeoutMs?: number },
  ): Promise<void> {
    await this.invoke('clickElement', [id, ref, options])
  }
  async clickAtCoordinates(id: string, x: number, y: number): Promise<void> {
    await this.invoke('clickAtCoordinates', [id, x, y])
  }
  async drag(id: string, x1: number, y1: number, x2: number, y2: number): Promise<void> {
    await this.invoke('drag', [id, x1, y1, x2, y2])
  }
  async fillElement(id: string, ref: string, value: string): Promise<void> {
    await this.invoke('fillElement', [id, ref, value])
  }
  async typeText(id: string, text: string): Promise<void> {
    await this.invoke('typeText', [id, text])
  }
  async selectOption(id: string, ref: string, value: string): Promise<void> {
    await this.invoke('selectOption', [id, ref, value])
  }
  async setClipboard(id: string, text: string): Promise<void> {
    await this.invoke('setClipboard', [id, text])
  }
  async getClipboard(id: string): Promise<string> {
    return await this.invoke('getClipboard', [id])
  }
  async scroll(id: string, direction: 'up' | 'down' | 'left' | 'right', amount?: number): Promise<void> {
    await this.invoke('scroll', [id, direction, amount])
  }
  async sendKey(id: string, args: BrowserKeyArgs): Promise<void> {
    await this.invoke('sendKey', [id, args])
  }
  async uploadFile(_id: string, _ref: string, _filePaths: string[]): Promise<unknown> {
    throw new CodedError(
      'BROWSER_REMOTE_UPLOAD_NOT_SUPPORTED',
      'File upload from a remote agent is not supported. ' +
      'Ask the user to attach the file to the session instead.',
    )
  }
  async evaluate(id: string, expression: string): Promise<unknown> {
    return await this.invoke('evaluate', [id, expression])
  }

  async screenshot(id: string, options?: BrowserScreenshotOptions): Promise<BrowserScreenshotResult> {
    const wire = await this.invoke<ScreenshotResultWire>('screenshot', [id, options])
    return this.fromScreenshotWire(wire)
  }
  async screenshotRegion(id: string, target: BrowserScreenshotRegionTarget): Promise<BrowserScreenshotResult> {
    const wire = await this.invoke<ScreenshotResultWire>('screenshotRegion', [id, target])
    return this.fromScreenshotWire(wire)
  }

  getConsoleLogs(id: string, options?: BrowserConsoleOptions): BrowserConsoleEntry[] {
    // IBPM declares sync. The async result is awaited inside the runtime layer
    // that consumes consoleLogs; returning [] here keeps the sync surface intact.
    void this.invoke<BrowserConsoleEntry[]>('getConsoleLogs', [id, options]).catch(() => {})
    return []
  }
  windowResize(id: string, width: number, height: number): { width: number; height: number } {
    void this.invoke<{ width: number; height: number }>('windowResize', [id, width, height]).catch(() => {})
    return { width, height }
  }
  getNetworkLogs(id: string, options?: BrowserNetworkOptions): BrowserNetworkEntry[] {
    void this.invoke<BrowserNetworkEntry[]>('getNetworkLogs', [id, options]).catch(() => {})
    return []
  }
  async waitFor(id: string, args: BrowserWaitArgs): Promise<BrowserWaitResult> {
    return await this.invoke('waitFor', [id, args])
  }
  async getDownloads(id: string, options?: BrowserDownloadOptions): Promise<BrowserDownloadEntry[]> {
    return await this.invoke('getDownloads', [id, options])
  }
  async detectSecurityChallenge(id: string): Promise<{ detected: boolean; provider: string; signals: string[] }> {
    return await this.invoke('detectSecurityChallenge', [id])
  }

  // ---------------------------------------------------------------------------
  // Wire conversions
  // ---------------------------------------------------------------------------

  private fromScreenshotWire(wire: ScreenshotResultWire): BrowserScreenshotResult {
    const bytes = wire.imageBytes
    // Structured clone on the WS layer may deliver this as a Uint8Array or as
    // a serialized object with `data` field — accept both.
    let buffer: Buffer
    if (bytes instanceof Uint8Array) {
      buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    } else if (bytes && typeof bytes === 'object' && 'data' in (bytes as object)) {
      buffer = Buffer.from((bytes as { data: number[] }).data)
    } else {
      buffer = Buffer.from(bytes as unknown as ArrayBufferLike)
    }
    return {
      imageBuffer: buffer,
      imageFormat: wire.imageFormat,
      metadata: wire.metadata,
    }
  }
}
