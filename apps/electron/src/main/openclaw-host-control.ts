import { randomUUID } from 'node:crypto'

import {
  OPENCLAW_HOST_CONTROL_CHANNELS,
  type OpenClawHostControlApi,
} from '../preload/openclaw-host-control.ts'

const WORKSPACE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,191}$/

type HostControlAction = 'open-panel' | 'copy-setup-credential'

type PreventableEvent = { preventDefault(): void }

type SenderWebContents = { id: number }

type ManagedWindow = {
  isDestroyed(): boolean
  webContents: SenderWebContents
}

type ControlUiWindow = {
  isDestroyed(): boolean
  show(): void
  destroy(): void
  once(event: 'closed', listener: () => void): void
  webContents: {
    loadURL(url: string): Promise<void>
    setWindowOpenHandler(handler: (details: { url: string }) => { action: 'deny' }): void
    on(event: 'will-navigate' | 'will-redirect', listener: (event: PreventableEvent, url: string) => void): void
    on(event: 'will-attach-webview', listener: (event: PreventableEvent) => void): void
  }
}

type IsolatedSession = {
  setPermissionCheckHandler?(handler: () => boolean): void
  setPermissionRequestHandler?(handler: (_webContents: unknown, _permission: string, callback: (allowed: boolean) => void) => void): void
  clearStorageData?(): Promise<void>
  clearCache?(): Promise<void>
  on?(event: 'will-download', listener: (event: PreventableEvent) => void): void
  webRequest?: {
    onBeforeRequest(
      filter: { readonly urls: readonly string[] },
      listener: (details: { readonly url: string }, callback: (result: { readonly cancel: boolean }) => void) => void,
    ): void
  }
}

export interface ControlUiWindowOptions {
  readonly width: number
  readonly height: number
  readonly minWidth: number
  readonly minHeight: number
  readonly show: false
  readonly autoHideMenuBar: true
  readonly webPreferences: {
    readonly session: IsolatedSession
    readonly contextIsolation: true
    readonly sandbox: true
    readonly nodeIntegration: false
    readonly webSecurity: true
    readonly allowRunningInsecureContent: false
    readonly webviewTag: false
    readonly devTools: false
  }
}

export interface OpenClawHostControlIpcDependencies {
  readonly ipcMain: {
    handle(channel: string, listener: (event: { sender: SenderWebContents }, input: unknown) => Promise<void>): void
  }
  readonly windowManager: {
    getWindowByWebContentsId(webContentsId: number): ManagedWindow | null
    getWorkspaceForWindow(webContentsId: number): string | null
  }
  readonly runtimeManager: {
    getControlUiOriginForHostControl(workspaceId: string): Promise<string>
    getGatewayTokenForHostControl(workspaceId: string): Promise<string>
  }
  readonly clipboard: { writeText(value: string): void }
  readonly createEphemeralSession: (partition: string) => IsolatedSession
  readonly createControlUiWindow: (options: ControlUiWindowOptions) => ControlUiWindow
  readonly createPartition?: () => string
  readonly confirm?: (input: {
    readonly action: HostControlAction
    readonly workspaceId: string
    readonly owner: ManagedWindow
  }) => Promise<boolean>
}

export class OpenClawHostControlError extends Error {
  constructor(code: 'OPENCLAW_HOST_CONTROL_DENIED' | 'OPENCLAW_HOST_CONTROL_UNAVAILABLE') {
    super(code)
    this.name = 'OpenClawHostControlError'
  }
}
type HostControlConfirmationMessageKey =
  | 'security.confirm.copySetupCredential.detail'
  | 'security.confirm.copySetupCredential.message'
  | 'security.confirm.copySetupCredential.title'
  | 'security.confirm.openControlUi.detail'
  | 'security.confirm.openControlUi.message'
  | 'security.confirm.openControlUi.title'

const HOST_CONTROL_CONFIRMATION_MESSAGE_KEYS: Record<
  HostControlAction,
  {
    readonly title: HostControlConfirmationMessageKey
    readonly message: HostControlConfirmationMessageKey
    readonly detail: HostControlConfirmationMessageKey
  }
> = {
  'open-panel': {
    title: 'security.confirm.openControlUi.title',
    message: 'security.confirm.openControlUi.message',
    detail: 'security.confirm.openControlUi.detail',
  },
  'copy-setup-credential': {
    title: 'security.confirm.copySetupCredential.title',
    message: 'security.confirm.copySetupCredential.message',
    detail: 'security.confirm.copySetupCredential.detail',
  },
}

type HostControlDialogOptions = {
  readonly type: 'warning'
  readonly title: string
  readonly message: string
  readonly detail: string
  readonly buttons: string[]
  readonly cancelId: 0
  readonly defaultId: 0
  readonly noLink: true
}

interface LocalizedHostControlConfirmationDependencies {
  readonly translate: (
    key: HostControlConfirmationMessageKey | 'common.cancel' | 'common.continue',
    interpolation?: { workspaceId: string },
  ) => string
  readonly showMessageBox: (
    owner: unknown,
    options: HostControlDialogOptions,
  ) => Promise<{ readonly response: number }>
}

/**
 * Builds the native confirmation that guards host-only actions. Translation is
 * resolved at confirmation time so it tracks the current main-process locale.
 */
export function createOpenClawHostControlConfirmation(
  deps: LocalizedHostControlConfirmationDependencies,
): (
  input: {
    readonly action: HostControlAction
    readonly workspaceId: string
    readonly owner: unknown
  },
) => Promise<boolean> {
  return async ({ action, workspaceId, owner }) => {
    const messages = HOST_CONTROL_CONFIRMATION_MESSAGE_KEYS[action]
    try {
      const result = await deps.showMessageBox(owner, {
        type: 'warning',
        title: deps.translate(messages.title),
        message: deps.translate(messages.message),
        detail: deps.translate(messages.detail, { workspaceId }),
        buttons: [deps.translate('common.cancel'), deps.translate('common.continue')],
        cancelId: 0,
        defaultId: 0,
        noLink: true,
      })
      return result.response === 1
    } catch {
      return false
    }
  }
}

function requireWorkspaceId(input: unknown): string {
  if (!input || typeof input !== 'object' || !('workspaceId' in input)) {
    throw new OpenClawHostControlError('OPENCLAW_HOST_CONTROL_DENIED')
  }
  const workspaceId = input.workspaceId
  if (typeof workspaceId !== 'string' || !WORKSPACE_ID_PATTERN.test(workspaceId)) {
    throw new OpenClawHostControlError('OPENCLAW_HOST_CONTROL_DENIED')
  }
  return workspaceId
}

function requireControlledSender(
  event: { sender: SenderWebContents },
  workspaceId: string,
  windowManager: OpenClawHostControlIpcDependencies['windowManager'],
): ManagedWindow {
  const owner = windowManager.getWindowByWebContentsId(event.sender.id)
  if (!owner || owner.isDestroyed() || owner.webContents !== event.sender) {
    throw new OpenClawHostControlError('OPENCLAW_HOST_CONTROL_DENIED')
  }
  if (windowManager.getWorkspaceForWindow(event.sender.id) !== workspaceId) {
    throw new OpenClawHostControlError('OPENCLAW_HOST_CONTROL_DENIED')
  }
  return owner
}

/** A manager-sourced Control-UI root must be canonical, loopback-only, and token-free. */
function requireExactControlUiOrigin(value: string): string {
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    throw new OpenClawHostControlError('OPENCLAW_HOST_CONTROL_UNAVAILABLE')
  }

  const port = Number(parsed.port)
  if (
    parsed.protocol !== 'http:' ||
    parsed.hostname !== '127.0.0.1' ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65_535 ||
    parsed.username ||
    parsed.password ||
    parsed.pathname !== '/' ||
    parsed.search ||
    parsed.hash
  ) {
    throw new OpenClawHostControlError('OPENCLAW_HOST_CONTROL_UNAVAILABLE')
  }
  return `http://127.0.0.1:${port}/`
}

/** Allows same-origin internal routes, but no hostname, port, or protocol changes. */
export function isAllowedControlUiNavigation(url: string, controlOrigin: string): boolean {
  try {
    const expected = new URL(requireExactControlUiOrigin(controlOrigin))
    const candidate = new URL(url)
    return candidate.protocol === 'http:' && !candidate.username && !candidate.password && candidate.origin === expected.origin
  } catch {
    return false
  }
}

function isAllowedControlUiRequest(url: string, controlOrigin: string): boolean {
  try {
    const expected = new URL(requireExactControlUiOrigin(controlOrigin))
    const candidate = new URL(url)
    if (candidate.username || candidate.password) return false
    if (candidate.protocol === 'http:') return candidate.origin === expected.origin
    return candidate.protocol === 'ws:' && candidate.host === expected.host
  } catch {
    return false
  }
}

export function createControlUiWindowOptions(controlSession: IsolatedSession): ControlUiWindowOptions {
  return {
    width: 1280,
    height: 860,
    minWidth: 960,
    minHeight: 640,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      session: controlSession,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
      devTools: false,
    },
  }
}

function attachControlUiPolicy(
  controlWindow: ControlUiWindow,
  controlSession: IsolatedSession,
  controlOrigin: string,
): void {
  const blockOutsideOrigin = (event: PreventableEvent, targetUrl: string) => {
    if (!isAllowedControlUiNavigation(targetUrl, controlOrigin)) event.preventDefault()
  }

  controlSession.setPermissionCheckHandler?.(() => false)
  controlSession.setPermissionRequestHandler?.((_webContents, _permission, callback) => callback(false))
  controlSession.on?.('will-download', event => event.preventDefault())
  controlSession.webRequest?.onBeforeRequest(
    { urls: ['<all_urls>'] },
    (details, callback) => callback({ cancel: !isAllowedControlUiRequest(details.url, controlOrigin) }),
  )
  controlWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  controlWindow.webContents.on('will-navigate', blockOutsideOrigin)
  controlWindow.webContents.on('will-redirect', blockOutsideOrigin)
  controlWindow.webContents.on('will-attach-webview', event => event.preventDefault())
}

async function clearEphemeralSession(controlSession: IsolatedSession): Promise<void> {
  await Promise.allSettled([
    controlSession.clearStorageData?.(),
    controlSession.clearCache?.(),
  ])
}

async function openControlUi(
  workspaceId: string,
  deps: OpenClawHostControlIpcDependencies,
): Promise<void> {
  const controlOrigin = requireExactControlUiOrigin(
    await deps.runtimeManager.getControlUiOriginForHostControl(workspaceId),
  )
  const controlSession = deps.createEphemeralSession(
    deps.createPartition?.() ?? `openclaw-control-${randomUUID()}`,
  )
  let controlWindow: ControlUiWindow | undefined
  try {
    controlWindow = deps.createControlUiWindow(createControlUiWindowOptions(controlSession))
    attachControlUiPolicy(controlWindow, controlSession, controlOrigin)
    controlWindow.once('closed', () => { void clearEphemeralSession(controlSession) })
    await controlWindow.webContents.loadURL(controlOrigin)
    if (!controlWindow.isDestroyed()) controlWindow.show()
  } catch {
    if (controlWindow && !controlWindow.isDestroyed()) controlWindow.destroy()
    await clearEphemeralSession(controlSession)
    throw new OpenClawHostControlError('OPENCLAW_HOST_CONTROL_UNAVAILABLE')
  }
}

async function copySetupCredential(
  workspaceId: string,
  deps: OpenClawHostControlIpcDependencies,
): Promise<void> {
  try {
    const credential = await deps.runtimeManager.getGatewayTokenForHostControl(workspaceId)
    deps.clipboard.writeText(credential)
  } catch {
    throw new OpenClawHostControlError('OPENCLAW_HOST_CONTROL_UNAVAILABLE')
  }
}

/**
 * Registers direct Electron IPC only. These handlers are intentionally omitted
 * from routed RPC and accept a workspace only when it matches a controlled,
 * locally managed Craft window.
 */
export function registerOpenClawHostControlIpc(deps: OpenClawHostControlIpcDependencies): void {
  const handle = (action: HostControlAction, effect: (workspaceId: string) => Promise<void>) =>
    async (event: { sender: SenderWebContents }, input: unknown): Promise<void> => {
      const workspaceId = requireWorkspaceId(input)
      const owner = requireControlledSender(event, workspaceId, deps.windowManager)
      let confirmed = false
      try {
        confirmed = await (deps.confirm?.({ action, workspaceId, owner }) ?? Promise.resolve(false))
      } catch {
        return
      }
      if (!confirmed) return
      await effect(workspaceId)
    }

  deps.ipcMain.handle(
    OPENCLAW_HOST_CONTROL_CHANNELS.OPEN_PANEL,
    handle('open-panel', workspaceId => openControlUi(workspaceId, deps)),
  )
  deps.ipcMain.handle(
    OPENCLAW_HOST_CONTROL_CHANNELS.COPY_SETUP_CREDENTIAL,
    handle('copy-setup-credential', workspaceId => copySetupCredential(workspaceId, deps)),
  )
}

// Re-export the direct-only names for main-process tests and registration.
// They are not part of the routed protocol or channel map.
export { OPENCLAW_HOST_CONTROL_CHANNELS }

export type { OpenClawHostControlApi }
