import { describe, expect, it, mock } from 'bun:test'
import { LOCALE_REGISTRY } from '@craft-agent/shared/i18n'
import {
  createOpenClawHostControlConfirmation,
  isAllowedControlUiNavigation,
  OPENCLAW_HOST_CONTROL_CHANNELS,
  registerOpenClawHostControlIpc,
} from './openclaw-host-control.ts'

type Handler = (event: { sender: { id: number } }, input: unknown) => Promise<unknown>

function createHarness(options: { confirmed?: boolean; confirmationError?: boolean } = {}) {
  const handlers = new Map<string, Handler>()
  const confirmation = mock(async () => {
    if (options.confirmationError) throw new Error('native confirmation unavailable')
    return options.confirmed ?? true
  })
  const copied: string[] = []
  const token = 'gateway-token-must-stay-in-main'
  const origin = 'http://127.0.0.1:42672/'
  const mainWindow = {
    isDestroyed: mock(() => false),
    webContents: { id: 7 },
  }
  const mainWebContents = mainWindow.webContents
  const controlListeners = new Map<string, Function>()
  let windowOpenHandler: ((details: { url: string }) => { action: 'deny' }) | undefined
  let controlOptions: unknown
  const loaded: string[] = []
  let requestHandler: ((details: { url: string }, callback: (result: { cancel: boolean }) => void) => void) | undefined
  const controlWindow = {
    isDestroyed: mock(() => false),
    show: mock(() => {}),
    destroy: mock(() => {}),
    once: mock((event: string, listener: Function) => controlListeners.set(event, listener)),
    webContents: {
      loadURL: mock(async (url: string) => { loaded.push(url) }),
      setWindowOpenHandler: mock((handler: (details: { url: string }) => { action: 'deny' }) => {
        windowOpenHandler = handler
      }),
      on: mock((event: string, listener: Function) => controlListeners.set(event, listener)),
    },
  }
  const isolatedSession = {
    setPermissionCheckHandler: mock(() => {}),
    setPermissionRequestHandler: mock(() => {}),
    clearStorageData: mock(async () => {}),
    clearCache: mock(async () => {}),
    on: mock(() => {}),
    webRequest: {
      onBeforeRequest: mock((_filter: unknown, listener: (details: { url: string }, callback: (result: { cancel: boolean }) => void) => void) => {
        requestHandler = listener
      }),
    },
  }
  const manager = {
    getControlUiOriginForHostControl: mock(async () => origin),
    getGatewayTokenForHostControl: mock(async () => token),
  }

  registerOpenClawHostControlIpc({
    ipcMain: { handle: (channel: string, handler: Handler) => handlers.set(channel, handler) },
    windowManager: {
      getWindowByWebContentsId: (id: number) => id === mainWebContents.id ? mainWindow : null,
      getWorkspaceForWindow: (id: number) => id === mainWebContents.id ? 'workspace-1' : null,
    },
    runtimeManager: manager,
    confirm: confirmation,
    clipboard: { writeText: (value: string) => copied.push(value) },
    createEphemeralSession: () => isolatedSession,
    createControlUiWindow: (value: unknown) => {
      controlOptions = value
      return controlWindow
    },
    createPartition: () => 'openclaw-control-test',
  })

  return {
    handlers,
    confirmation,
    copied,
    token,
    origin,
    mainWebContents,
    controlListeners,
    getWindowOpenHandler: () => windowOpenHandler,
    getControlOptions: () => controlOptions,
    getRequestHandler: () => requestHandler,
    loaded,
    controlWindow,
    isolatedSession,
    manager,
  }
}

function translateRussianHostControlConfirmation(
  key: keyof typeof LOCALE_REGISTRY.ru.messages,
  interpolation?: { workspaceId: string },
): string {
  const message = LOCALE_REGISTRY.ru.messages[key]
  if (!message) throw new Error(`Missing Russian translation: ${key}`)
  return message.replace('{{workspaceId}}', interpolation?.workspaceId ?? '')
}

describe('OpenClaw native confirmation localization', () => {
  it('passes Russian action-specific copy to the native dialog without English fallback text', async () => {
    const owner = { id: 'local-host-owner' }
    const workspaceId = 'workspace-1'
    const translate = mock(translateRussianHostControlConfirmation)
    const showMessageBox = mock(async () => ({ response: 1 }))
    const confirm = createOpenClawHostControlConfirmation({ translate, showMessageBox })

    await expect(confirm({ action: 'open-panel', workspaceId, owner })).resolves.toBe(true)
    await expect(confirm({ action: 'copy-setup-credential', workspaceId, owner })).resolves.toBe(true)

    expect(showMessageBox).toHaveBeenNthCalledWith(1, owner, {
      type: 'warning',
      title: 'Интерфейс управления OpenClaw',
      message: 'Открыть локальный интерфейс управления OpenClaw?',
      detail: 'Будет открыто изолированное локальное окно для рабочего пространства workspace-1.',
      buttons: ['Отмена', 'Продолжить'],
      cancelId: 0,
      defaultId: 0,
      noLink: true,
    })
    expect(showMessageBox).toHaveBeenNthCalledWith(2, owner, {
      type: 'warning',
      title: 'Учётные данные настройки OpenClaw',
      message: 'Скопировать учётные данные настройки OpenClaw в системный буфер обмена?',
      detail: 'Учётные данные рабочего пространства workspace-1 можно вставить в локальный интерфейс управления. Их может прочитать любой, у кого есть доступ к буферу обмена.',
      buttons: ['Отмена', 'Продолжить'],
      cancelId: 0,
      defaultId: 0,
      noLink: true,
    })

    expect(translate).toHaveBeenCalledWith('security.confirm.openControlUi.title')
    expect(translate).toHaveBeenCalledWith('security.confirm.openControlUi.message')
    expect(translate).toHaveBeenCalledWith('security.confirm.openControlUi.detail', { workspaceId })
    expect(translate).toHaveBeenCalledWith('security.confirm.copySetupCredential.title')
    expect(translate).toHaveBeenCalledWith('security.confirm.copySetupCredential.message')
    expect(translate).toHaveBeenCalledWith('security.confirm.copySetupCredential.detail', { workspaceId })

    const dialogs = JSON.stringify(showMessageBox.mock.calls)
    expect(dialogs).not.toContain('Open the local OpenClaw Control UI?')
    expect(dialogs).not.toContain('Copy the OpenClaw setup credential to the system clipboard?')
    expect(dialogs).not.toContain('This opens an isolated local window for workspace')
    expect(dialogs).not.toContain('The credential for workspace')
  })
})

describe('OpenClaw host-only direct IPC', () => {
  it('rejects an unknown sender before confirmation or any host effect', async () => {
    const harness = createHarness()
    const handler = harness.handlers.get(OPENCLAW_HOST_CONTROL_CHANNELS.OPEN_PANEL)!

    await expect(handler({ sender: { id: 999 } }, { workspaceId: 'workspace-1' })).rejects.toThrow(
      'OPENCLAW_HOST_CONTROL_DENIED',
    )
    await expect(handler({ sender: { id: harness.mainWebContents.id } }, { workspaceId: 'workspace-1' })).rejects.toThrow(
      'OPENCLAW_HOST_CONTROL_DENIED',
    )
    expect(harness.confirmation).not.toHaveBeenCalled()
    expect(harness.manager.getControlUiOriginForHostControl).not.toHaveBeenCalled()
    expect(harness.loaded).toEqual([])
  })

  it('treats confirmation cancellation as a void no-op', async () => {
    const harness = createHarness({ confirmed: false })
    const handler = harness.handlers.get(OPENCLAW_HOST_CONTROL_CHANNELS.COPY_SETUP_CREDENTIAL)!

    await expect(handler({ sender: harness.mainWebContents }, { workspaceId: 'workspace-1' })).resolves.toBeUndefined()
    expect(harness.confirmation).toHaveBeenCalledTimes(1)
    expect(harness.manager.getGatewayTokenForHostControl).not.toHaveBeenCalled()
    expect(harness.copied).toEqual([])
  })

  it('fails closed when the main-side confirmation cannot be completed', async () => {
    const harness = createHarness({ confirmationError: true })
    const handler = harness.handlers.get(OPENCLAW_HOST_CONTROL_CHANNELS.OPEN_PANEL)!

    await expect(handler({ sender: harness.mainWebContents }, { workspaceId: 'workspace-1' })).resolves.toBeUndefined()
    expect(harness.manager.getControlUiOriginForHostControl).not.toHaveBeenCalled()
    expect(harness.loaded).toEqual([])
  })

  it('uses an isolated, exact-origin browser policy and returns void-only results without serializing the credential', async () => {
    const harness = createHarness()
    const open = harness.handlers.get(OPENCLAW_HOST_CONTROL_CHANNELS.OPEN_PANEL)!
    const copy = harness.handlers.get(OPENCLAW_HOST_CONTROL_CHANNELS.COPY_SETUP_CREDENTIAL)!

    const opened = await open({ sender: harness.mainWebContents }, { workspaceId: 'workspace-1' })
    const copied = await copy({ sender: harness.mainWebContents }, { workspaceId: 'workspace-1' })

    expect(opened).toBeUndefined()
    expect(copied).toBeUndefined()
    expect(harness.loaded).toEqual([harness.origin])
    expect(harness.getControlOptions()).toMatchObject({
      webPreferences: {
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
      },
    })
    expect(harness.copied).toEqual([harness.token])
    expect(JSON.stringify({ opened, copied })).not.toContain(harness.token)

    const navigation = harness.controlListeners.get('will-navigate')!
    const blocked = { preventDefault: mock(() => {}) }
    navigation(blocked, 'https://example.invalid/')
    expect(blocked.preventDefault).toHaveBeenCalled()

    const allowed = { preventDefault: mock(() => {}) }
    navigation(allowed, 'http://127.0.0.1:42672/settings')
    expect(allowed.preventDefault).not.toHaveBeenCalled()

    const redirect = harness.controlListeners.get('will-redirect')!
    const redirectBlocked = { preventDefault: mock(() => {}) }
    redirect(redirectBlocked, 'https://example.invalid/redirect')
    expect(redirectBlocked.preventDefault).toHaveBeenCalled()

    const redirectAllowed = { preventDefault: mock(() => {}) }
    redirect(redirectAllowed, 'http://127.0.0.1:42672/after-login')
    expect(redirectAllowed.preventDefault).not.toHaveBeenCalled()
    expect(harness.getWindowOpenHandler()!({ url: 'https://example.invalid/' })).toEqual({ action: 'deny' })

    const request = harness.getRequestHandler()!
    let remoteRequest: { cancel: boolean } | undefined
    request({ url: 'https://example.invalid/asset.js' }, result => { remoteRequest = result })
    expect(remoteRequest).toEqual({ cancel: true })

    let loopbackRequest: { cancel: boolean } | undefined
    request({ url: 'http://127.0.0.1:42672/app.js' }, result => { loopbackRequest = result })
    expect(loopbackRequest).toEqual({ cancel: false })
    expect(harness.isolatedSession.setPermissionCheckHandler).toHaveBeenCalled()
    expect(harness.isolatedSession.setPermissionRequestHandler).toHaveBeenCalled()
    const closed = harness.controlListeners.get('closed')!
    closed()
    await Promise.resolve()
    expect(harness.isolatedSession.clearStorageData).toHaveBeenCalled()
    expect(harness.isolatedSession.clearCache).toHaveBeenCalled()
  })

  it('allows only the manager-sourced loopback origin for Control-UI navigation', () => {
    const origin = 'http://127.0.0.1:42672/'

    expect(isAllowedControlUiNavigation('http://127.0.0.1:42672/', origin)).toBe(true)
    expect(isAllowedControlUiNavigation('http://127.0.0.1:42672/settings', origin)).toBe(true)
    expect(isAllowedControlUiNavigation('http://localhost:42672/', origin)).toBe(false)
    expect(isAllowedControlUiNavigation('https://127.0.0.1:42672/', origin)).toBe(false)
    expect(isAllowedControlUiNavigation('http://127.0.0.1:42673/', origin)).toBe(false)
  })
})
