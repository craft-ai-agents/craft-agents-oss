/**
 * Tests for BrowserPaneManager.
 *
 * Mocks Electron BrowserWindow and session modules to validate lifecycle,
 * session binding, and navigation behavior.
 */

import { describe, it, expect, beforeEach, mock } from 'bun:test'

const createdWindows: any[] = []
let toolbarLoadFailuresRemaining = 0
const mockShellOpenExternal = mock(async () => {})
const mockIpcMainHandle = mock(() => {})

// Electron assigns every webContents a unique numeric id; the manager keys popup
// and page lookups on it, so the mock must too.
let nextMockWebContentsId = 1

function createMockWebContents() {
  const listeners: Record<string, Function[]> = {}
  let currentUrl = 'about:blank'
  return {
    id: nextMockWebContentsId++,
    userAgent: 'Mock Chrome Electron/99.0.0',
    session: {},
    isDestroyed: mock(() => false),
    on: (event: string, cb: Function) => {
      if (!listeners[event]) listeners[event] = []
      listeners[event].push(cb)
    },
    loadURL: mock(async (url: string) => {
      currentUrl = url
      const isToolbarUrl = typeof url === 'string' && url.includes('browser-toolbar.html')
      if (isToolbarUrl && toolbarLoadFailuresRemaining > 0) {
        toolbarLoadFailuresRemaining--
        throw new Error('mock toolbar load failure')
      }
    }),
    loadFile: mock(async (_path: string, _opts?: unknown) => {
      if (toolbarLoadFailuresRemaining > 0) {
        toolbarLoadFailuresRemaining--
        throw new Error('mock toolbar load failure')
      }
    }),
    getTitle: mock(() => 'Test Page'),
    getURL: mock(() => currentUrl),
    canGoBack: mock(() => false),
    canGoForward: mock(() => false),
    goBack: mock(() => {}),
    goForward: mock(() => {}),
    reload: mock(() => {}),
    stop: mock(() => {}),
    setUserAgent: mock(() => {}),
    setBackgroundColor: mock(() => {}),
    capturePage: mock(async () => {
      const img = {
        isEmpty: () => false,
        getSize: () => ({ width: 2400, height: 1800 }),
        resize: (_opts: any) => img,
        toPNG: () => Buffer.from('fake-png'),
        toJPEG: (_quality: number) => Buffer.from('fake-jpeg'),
      }
      return img
    }),
    // The paint probe (two animation frames) resolves at once; tests that need a page that isn't
    // painting override it.
    executeJavaScript: mock(async (expr: string) => (expr.includes('requestAnimationFrame') ? true : eval(expr))),
    setBackgroundThrottling: mock((_allowed: boolean) => {}),
    focus: mock(() => {}),
    setWindowOpenHandler: mock((_handler: any) => {}),
    send: mock((_channel: string, _payload?: unknown) => {}),
    debugger: {
      attach: mock(() => {}),
      detach: mock(() => {}),
      sendCommand: mock(async () => ({ nodes: [] })),
      on: mock(() => {}),
    },
    _listeners: listeners,
    _emit: (event: string, ...args: any[]) => {
      for (const cb of listeners[event] || []) cb({}, ...args)
    },
  }
}

/**
 * Electron's `did-create-window` handler signature is `(window, details)` with no
 * leading event object, unlike most webContents events, so it cannot go through
 * the mock's `_emit` (which prepends one).
 */
function emitDidCreateWindow(webContents: any, popupWindow: any, details: { url?: string }): void {
  for (const cb of webContents._listeners['did-create-window'] || []) cb(popupWindow, details)
}

function createMockBrowserView() {
  const webContents = createMockWebContents()
  return {
    webContents,
    setBounds: mock(() => {}),
    setAutoResize: mock(() => {}),
  }
}

function createMockWindow(opts?: { width?: number; height?: number; minWidth?: number; minHeight?: number }) {
  const listeners: Record<string, Function[]> = {}
  const webContents = createMockWebContents()
  let contentWidth = opts?.width ?? 1200
  let contentHeight = opts?.height ?? 900
  const minWidth = opts?.minWidth ?? 0
  const minHeight = opts?.minHeight ?? 0

  const win = {
    webContents,
    on: (event: string, cb: Function) => {
      if (!listeners[event]) listeners[event] = []
      listeners[event].push(cb)
    },
    once: (event: string, cb: Function) => {
      const wrapped = (...args: any[]) => {
        listeners[event] = (listeners[event] || []).filter(fn => fn !== wrapped)
        cb(...args)
      }
      if (!listeners[event]) listeners[event] = []
      listeners[event].push(wrapped)
    },
    _emit: (event: string, ...args: any[]) => {
      for (const cb of listeners[event] || []) cb(...args)
    },
    isDestroyed: mock(() => false),
    isMinimized: mock(() => false),
    restore: mock(() => {}),
    show: mock(() => {}),
    showInactive: mock(() => {}),
    moveTop: mock(() => {}),
    getOpacity: mock(() => 1),
    setOpacity: mock((_opacity: number) => {}),
    getBounds: mock(() => ({ x: 40, y: 60, width: contentWidth, height: contentHeight })),
    setBounds: mock((_bounds: { x: number; y: number; width: number; height: number }) => {}),
    setPosition: mock((_x: number, _y: number) => {}),
    setSkipTaskbar: mock((_skip: boolean) => {}),
    setIgnoreMouseEvents: mock((_ignore: boolean) => {}),
    setAlwaysOnTop: mock((_flag: boolean, _level?: string) => {}),
    setWindowButtonVisibility: mock((_visible: boolean) => {}),
    hide: mock(() => {
      win._emit('hide')
    }),
    focus: mock(() => {}),
    destroy: mock(() => {
      win._emit('closed')
    }),
    setBrowserView: mock((_view: any) => {}),
    addBrowserView: mock((_view: any) => {}),
    setTopBrowserView: mock((_view: any) => {}),
    getContentSize: mock(() => [contentWidth, contentHeight]),
    setContentSize: mock((width: number, height: number) => {
      contentWidth = Math.max(minWidth, Math.floor(width))
      contentHeight = Math.max(minHeight, Math.floor(height))
    }),
    loadURL: mock(async (_url: string) => {}),
  }
  createdWindows.push(win)
  return win
}

mock.module('electron', () => ({
  app: {
    getPath: mock((name: string) => name === 'downloads' ? '/tmp/mock-downloads' : `/tmp/mock-${name}`),
  },
  BrowserWindow: class MockBrowserWindow {
    webContents: any
    constructor(opts?: any) {
      const win = createMockWindow(opts)
      this.webContents = win.webContents
      Object.assign(this, win)
    }
  },
  BrowserView: class MockBrowserView {
    webContents: any
    constructor(_opts?: any) {
      const view = createMockBrowserView()
      this.webContents = view.webContents
      Object.assign(this, view)
    }
  },
  ipcMain: {
    handle: mockIpcMainHandle,
  },
  Menu: {
    buildFromTemplate: mock(() => ({
      popup: mock(() => {}),
    })),
  },
  nativeTheme: {
    shouldUseDarkColors: false,
  },
  screen: {
    getAllDisplays: mock(() => [
      { bounds: { x: 0, y: 0, width: 1920, height: 1080 } },
      { bounds: { x: 1920, y: 0, width: 2560, height: 1440 } },
    ]),
  },
  shell: {
    openExternal: mockShellOpenExternal,
  },
  session: {
    fromPartition: mock(() => ({
      setPermissionCheckHandler: mock(() => {}),
      setPermissionRequestHandler: mock(() => {}),
      webRequest: {
        onBeforeRequest: mock((_cb: any) => {}),
        onCompleted: mock((_cb: any) => {}),
        onErrorOccurred: mock((_cb: any) => {}),
      },
      on: mock((_event: string, _cb: any) => {}),
    })),
  },
}))

mock.module('../logger', () => {
  const stubLog = { info: () => {}, error: () => {}, warn: () => {}, debug: () => {} }
  return {
    mainLog: stubLog,
    sessionLog: stubLog,
    handlerLog: stubLog,
    windowLog: stubLog,
    agentLog: stubLog,
    searchLog: stubLog,
    isDebugMode: false,
    getLogFilePath: () => '/tmp/main.log',
  }
})

mock.module('../browser-cdp', () => ({
  BrowserCDP: class MockBrowserCDP {
    detach = mock(() => {})
    getAccessibilitySnapshot = mock(async () => ({
      url: 'https://example.com',
      title: 'Example',
      nodes: [],
    }))
    clickElement = mock(async () => ({
      ref: '@e1',
      box: { x: 0, y: 0, width: 10, height: 10 },
      clickPoint: { x: 5, y: 5 },
    }))
    fillElement = mock(async () => ({
      ref: '@e1',
      box: { x: 0, y: 0, width: 10, height: 10 },
      clickPoint: { x: 5, y: 5 },
    }))
    selectOption = mock(async () => ({
      ref: '@e1',
      box: { x: 0, y: 0, width: 10, height: 10 },
      clickPoint: { x: 5, y: 5 },
    }))
    renderTemporaryOverlay = mock(async () => {})
    clearTemporaryOverlay = mock(async () => {})
    getViewportMetrics = mock(async () => ({ width: 1200, height: 900, dpr: 2, scrollX: 0, scrollY: 0 }))
    getElementGeometry = mock(async () => ({
      ref: '@e1',
      box: { x: 0, y: 0, width: 10, height: 10 },
      clickPoint: { x: 5, y: 5 },
    }))
    getElementGeometryBySelector = mock(async () => ({
      ref: 'selector:div.card',
      box: { x: 5, y: 5, width: 20, height: 20 },
      clickPoint: { x: 15, y: 15 },
    }))
  },
}))

const { BrowserPaneManager, isSignInPopupUrl } = await import('../browser-pane-manager')

describe('BrowserPaneManager', () => {
  let manager: InstanceType<typeof BrowserPaneManager>

  beforeEach(() => {
    createdWindows.length = 0
    toolbarLoadFailuresRemaining = 0
    mockShellOpenExternal.mockClear()
    mockIpcMainHandle.mockClear()
    manager = new BrowserPaneManager()
  })

  it('creates and lists instances', () => {
    const id = manager.createInstance('test-1')
    const list = manager.listInstances()
    expect(id).toBe('test-1')
    expect(list).toHaveLength(1)
    expect(list[0].id).toBe('test-1')
    expect(list[0].agentControlActive).toBe(false)
  })

  it('is idempotent when explicit ID already exists', () => {
    const first = manager.createInstance('same-id')
    const second = manager.createInstance('same-id')
    expect(first).toBe('same-id')
    expect(second).toBe('same-id')
    expect(manager.listInstances()).toHaveLength(1)
  })

  it('allows http(s) popups with shared browser partition', () => {
    manager.createInstance('popup-allow')
    const instance = (manager as any).instances.get('popup-allow')
    const openHandler = instance.pageView.webContents.setWindowOpenHandler.mock.calls[0][0]

    const result = openHandler({
      url: 'https://accounts.google.com/o/oauth2/v2/auth',
      disposition: 'new-popup',
      frameName: 'oauth-popup',
    })

    expect(result.action).toBe('allow')
    expect(result.overrideBrowserWindowOptions?.webPreferences?.partition).toBe('persist:browser-pane')
    expect(result.overrideBrowserWindowOptions?.webPreferences?.nodeIntegration).toBe(false)
    expect(result.overrideBrowserWindowOptions?.webPreferences?.contextIsolation).toBe(true)
  })

  it('denies app deep-link popups and forwards to deep-link handler', async () => {
    manager.createInstance('popup-deeplink')
    const instance = (manager as any).instances.get('popup-deeplink')
    const openHandler = instance.pageView.webContents.setWindowOpenHandler.mock.calls[0][0]

    const result = openHandler({
      url: 'craftagents://settings',
      disposition: 'new-popup',
      frameName: '',
    })

    expect(result).toEqual({ action: 'deny' })
    await Bun.sleep(0)
    expect(mockShellOpenExternal).toHaveBeenCalledWith('craftagents://settings')
  })

  it('destroys child popups when parent instance is destroyed', () => {
    manager.createInstance('popup-parent')
    const instance = (manager as any).instances.get('popup-parent')

    const popupWindow = createMockWindow({ width: 520, height: 720 })
    emitDidCreateWindow(instance.pageView.webContents, popupWindow, { url: 'https://accounts.google.com/signin' })

    expect((manager as any).popupWindowsByParentInstanceId.get('popup-parent')?.size).toBe(1)

    manager.destroyInstance('popup-parent')

    expect(popupWindow.destroy).toHaveBeenCalledTimes(1)
    expect((manager as any).popupWindowsByParentInstanceId.has('popup-parent')).toBe(false)
  })

  it('destroys instances', () => {
    manager.createInstance('d1')
    manager.destroyInstance('d1')
    expect(manager.listInstances()).toHaveLength(0)
  })

  it('destroys instance via toolbar destroy IPC handler', async () => {
    manager.createInstance('d-ipc-destroy')
    manager.registerToolbarIpc()

    const destroyRegistration = (
      mockIpcMainHandle.mock.calls as unknown as Array<[
        string,
        (_event: unknown, instanceId: string) => Promise<void>,
      ]>
    ).find(([channel]) => channel === 'browser-toolbar:destroy')

    expect(destroyRegistration).toBeTruthy()
    if (!destroyRegistration) throw new Error('Expected browser-toolbar:destroy IPC registration')

    const [, destroyHandler] = destroyRegistration
    await destroyHandler({}, 'd-ipc-destroy')

    expect(manager.listInstances()).toHaveLength(0)
  })

  it('emits removed callback exactly once when destroy triggers closed', () => {
    const removed: string[] = []
    manager.onRemoved((id) => removed.push(id))

    manager.createInstance('d-removed-once')
    manager.destroyInstance('d-removed-once')

    expect(removed).toEqual(['d-removed-once'])
    expect(manager.listInstances()).toHaveLength(0)
  })

  it('ignores late state events after instance was removed', () => {
    const states: string[] = []
    manager.onStateChange((info) => states.push(info.id))

    manager.createInstance('d-late-state')
    const instance = (manager as any).instances.get('d-late-state')
    states.length = 0

    manager.destroyInstance('d-late-state')
    const countAfterDestroy = states.length

    instance.window._emit('hide')
    instance.window._emit('show')

    expect(states.length).toBe(countAfterDestroy)
  })

  it('binds and unbinds sessions', () => {
    manager.createInstance('b1')
    manager.bindSession('b1', 'session-abc')
    expect(manager.listInstances()[0].boundSessionId).toBe('session-abc')
    expect(manager.listInstances()[0].ownerType).toBe('session')

    manager.unbindSession('b1')
    expect(manager.listInstances()[0].boundSessionId).toBeNull()
    expect(manager.listInstances()[0].ownerType).toBe('manual')
  })

  it('createForSession returns canonical bound instance', () => {
    const id1 = manager.createForSession('sess-1')
    const id2 = manager.createForSession('sess-1')
    const info = manager.listInstances()[0]

    expect(id1).toBe(id2)
    expect(info.ownerType).toBe('session')
    expect(info.ownerSessionId).toBe('sess-1')
    expect(manager.listInstances()).toHaveLength(1)
  })

  it('getOrCreateForSession reuses existing instance', () => {
    const id1 = manager.getOrCreateForSession('sess-1')
    const id2 = manager.getOrCreateForSession('sess-1')
    expect(id1).toBe(id2)
    expect(manager.listInstances()).toHaveLength(1)
  })

  it('createForSession reuses an unbound manual window before creating new', () => {
    manager.createInstance('manual-1')

    const id = manager.createForSession('sess-reuse')

    expect(id).toBe('manual-1')
    const info = manager.listInstances()[0]
    expect(info.ownerType).toBe('session')
    expect(info.ownerSessionId).toBe('sess-reuse')
    expect(info.boundSessionId).toBe('sess-reuse')
    expect(manager.listInstances()).toHaveLength(1)
  })

  describe('workspaceId stamping', () => {
    it('createForSession with workspaceId stamps the field on a new instance', () => {
      const id = manager.createForSession('sess-ws', { workspaceId: 'ws-alpha' })
      const info = manager.listInstances().find((i) => i.id === id)
      expect(info?.workspaceId).toBe('ws-alpha')
    })

    it('createForSession without workspaceId defaults to null', () => {
      const id = manager.createForSession('sess-plain')
      const info = manager.listInstances().find((i) => i.id === id)
      expect(info?.workspaceId).toBeNull()
    })

    it('manual createInstance with no options leaves workspaceId null (unbound window)', () => {
      manager.createInstance('manual-ws')
      const info = manager.listInstances().find((i) => i.id === 'manual-ws')
      expect(info?.workspaceId).toBeNull()
    })

    it('manual createInstance accepts workspaceId option (TopBar manual open)', () => {
      // The browser-pane CREATE handler passes ctx.workspaceId so TopBar-
      // opened windows stay scoped to the workspace the user clicked from,
      // rather than being broadcast to every workspace.
      manager.createInstance('manual-scoped', { workspaceId: 'ws-toolbar' })
      const info = manager.listInstances().find((i) => i.id === 'manual-scoped')
      expect(info?.workspaceId).toBe('ws-toolbar')
    })

    it('reusing an unbound manual window adopts the new binder workspace', () => {
      manager.createInstance('manual-reuse')
      expect(manager.listInstances().find((i) => i.id === 'manual-reuse')?.workspaceId).toBeNull()

      const id = manager.createForSession('sess-reuse-ws', { workspaceId: 'ws-beta' })
      expect(id).toBe('manual-reuse')

      const info = manager.listInstances().find((i) => i.id === 'manual-reuse')
      expect(info?.workspaceId).toBe('ws-beta')
      expect(info?.ownerSessionId).toBe('sess-reuse-ws')
    })

    it('bindSession with workspaceId overwrites the instance workspaceId', () => {
      manager.createInstance('bind-ws')
      manager.bindSession('bind-ws', 'sess-bound', { workspaceId: 'ws-gamma' })
      const info = manager.listInstances().find((i) => i.id === 'bind-ws')
      expect(info?.workspaceId).toBe('ws-gamma')
      expect(info?.boundSessionId).toBe('sess-bound')
    })

    it('setAgentControl backfills workspaceId when previously null', () => {
      // Legacy path: instance was created without a workspace, then the overlay
      // path supplies it. Backfill should stamp it.
      manager.createInstance('legacy-overlay')
      manager.bindSession('legacy-overlay', 'sess-legacy')
      manager.setAgentControl('sess-legacy', { displayName: 'browser_navigate' }, { workspaceId: 'ws-delta' })

      const info = manager.listInstances().find((i) => i.id === 'legacy-overlay')
      expect(info?.workspaceId).toBe('ws-delta')
    })

    it('toInfo emits workspaceId on the DTO', () => {
      manager.createForSession('sess-dto', { workspaceId: 'ws-epsilon' })
      const dto = manager.listInstances().find((i) => i.ownerSessionId === 'sess-dto')
      expect(dto).toBeDefined()
      expect(dto).toHaveProperty('workspaceId', 'ws-epsilon')
    })

    describe('cross-workspace reuse', () => {
      it('does NOT reuse an unbound session window from another workspace', () => {
        // Session in workspace A opens a window, then its turn ends — the
        // unbind path sets ownerType='manual' and clears boundSessionId, but
        // workspaceId stays = A. A session in workspace B asking for a window
        // must NOT pick it up; that would "move" the window across workspaces.
        const wsA = manager.createForSession('sess-a', { workspaceId: 'ws-a' })
        manager.unbindAllForSession('sess-a')

        // Sanity: instance is now unbound + manual but retains workspaceId=A.
        const after = manager.listInstances().find((i) => i.id === wsA)
        expect(after?.boundSessionId).toBeNull()
        expect(after?.ownerType).toBe('manual')
        expect(after?.workspaceId).toBe('ws-a')

        const wsB = manager.createForSession('sess-b', { workspaceId: 'ws-b' })
        expect(wsB).not.toBe(wsA)
        expect(manager.listInstances()).toHaveLength(2)

        // Workspace-A's window still belongs to A.
        const stillA = manager.listInstances().find((i) => i.id === wsA)
        expect(stillA?.workspaceId).toBe('ws-a')
      })

      it('reuses an unbound window for the same session on its next turn', () => {
        const original = manager.createForSession('sess-a1', { workspaceId: 'ws-a' })
        manager.unbindAllForSession('sess-a1')

        const reused = manager.createForSession('sess-a1', { workspaceId: 'ws-a' })
        expect(reused).toBe(original)
        expect(manager.listInstances()).toHaveLength(1)

        const info = manager.listInstances()[0]
        expect(info.boundSessionId).toBe('sess-a1')
        expect(info.ownerSessionId).toBe('sess-a1')
      })

      it('does NOT reuse an unbound window for another session in the same workspace', () => {
        const original = manager.createForSession('sess-a1', { workspaceId: 'ws-a' })
        manager.unbindAllForSession('sess-a1')

        const next = manager.createForSession('sess-a2', { workspaceId: 'ws-a' })
        expect(next).not.toBe(original)
        expect(manager.listInstances()).toHaveLength(2)

        const previous = manager.listInstances().find((i) => i.id === original)
        expect(previous?.boundSessionId).toBeNull()
        expect(previous?.ownerSessionId).toBe('sess-a1')
        expect(previous?.workspaceId).toBe('ws-a')

        const current = manager.listInstances().find((i) => i.id === next)
        expect(current?.boundSessionId).toBe('sess-a2')
        expect(current?.ownerSessionId).toBe('sess-a2')
        expect(current?.workspaceId).toBe('ws-a')
      })

      it('lets any workspace adopt a truly unbound (workspaceId=null) manual window', () => {
        manager.createInstance('manual-anyworkspace')
        expect(manager.listInstances().find((i) => i.id === 'manual-anyworkspace')?.workspaceId).toBeNull()

        const adopted = manager.createForSession('sess-c', { workspaceId: 'ws-c' })
        expect(adopted).toBe('manual-anyworkspace')
        expect(manager.listInstances().find((i) => i.id === 'manual-anyworkspace')?.workspaceId).toBe('ws-c')
      })

      it('does NOT reuse a workspaceId=null unbound window when allowReuseManual=false', () => {
        // Remote-bridge dispatcher path: every lifecycle call passes
        // allowReuseManual=false so a stale window from before workspace
        // stamping (workspaceId=null) cannot get hijacked by a remote agent
        // for an unrelated workspace.
        manager.createInstance('legacy-unstamped')
        expect(manager.listInstances().find((i) => i.id === 'legacy-unstamped')?.workspaceId).toBeNull()

        const fresh = manager.createForSession('sess-d', {
          workspaceId: 'ws-d',
          allowReuseManual: false,
        })
        expect(fresh).not.toBe('legacy-unstamped')
        // Legacy window is left untouched.
        expect(manager.listInstances().find((i) => i.id === 'legacy-unstamped')?.workspaceId).toBeNull()
        // A new instance was created for the remote session.
        expect(manager.listInstances().find((i) => i.id === fresh)?.ownerSessionId).toBe('sess-d')
      })
    })
  })

  it('navigate normalizes hostnames to https', async () => {
    manager.createInstance('nav-1')
    await manager.navigate('nav-1', 'example.com')
    const instance = (manager as any).instances.get('nav-1')
    expect(instance.pageView.webContents.loadURL).toHaveBeenCalledWith('https://example.com')
  })

  it('navigate treats plain text as search query', async () => {
    manager.createInstance('nav-2')
    await manager.navigate('nav-2', 'craft agents browser tools')
    const instance = (manager as any).instances.get('nav-2')
    expect(instance.pageView.webContents.loadURL).toHaveBeenCalledWith(
      'https://duckduckgo.com/?q=craft%20agents%20browser%20tools'
    )
  })

  it('clears navigation timeout timer on success', async () => {
    manager.createInstance('nav-timeout')

    const originalClearTimeout = globalThis.clearTimeout
    const clearTimeoutSpy = mock((handle: Parameters<typeof clearTimeout>[0]) => originalClearTimeout(handle))
    ;(globalThis as any).clearTimeout = clearTimeoutSpy

    try {
      await manager.navigate('nav-timeout', 'https://example.com')
      expect(clearTimeoutSpy.mock.calls.length).toBeGreaterThan(0)
    } finally {
      ;(globalThis as any).clearTimeout = originalClearTimeout
    }
  })

  it('focus brings the instance window to front', () => {
    manager.createInstance('f1')
    manager.focus('f1')

    const instance = (manager as any).instances.get('f1')
    instance.window._emit('ready-to-show')

    expect(instance.window.show).toHaveBeenCalled()
    expect(instance.window.focus).toHaveBeenCalled()
  })

  it('dedupes repeated focus calls before ready-to-show', () => {
    manager.createInstance('f2')

    manager.focus('f2')
    manager.focus('f2')
    manager.focus('f2')

    const instance = (manager as any).instances.get('f2')
    instance.window._emit('ready-to-show')

    expect(instance.window.show.mock.calls.length).toBe(1)
    expect(instance.window.focus.mock.calls.length).toBe(1)
  })

  it('cancels deferred pre-ready focus when hide happens first', () => {
    manager.createInstance('f-hide-race')

    manager.focus('f-hide-race')
    manager.hide('f-hide-race')

    const instance = (manager as any).instances.get('f-hide-race')
    const showCallsBeforeReady = instance.window.show.mock.calls.length
    const focusCallsBeforeReady = instance.window.focus.mock.calls.length

    instance.window._emit('ready-to-show')

    expect(instance.window.show.mock.calls.length).toBe(showCallsBeforeReady)
    expect(instance.window.focus.mock.calls.length).toBe(focusCallsBeforeReady)
  })

  it('user close hides window and keeps instance alive', () => {
    manager.createInstance('h1')
    const instance = (manager as any).instances.get('h1')

    const closeEvent = { preventDefault: mock(() => {}) }
    instance.window._emit('close', closeEvent)

    expect(closeEvent.preventDefault).toHaveBeenCalled()
    expect(instance.window.hide).toHaveBeenCalled()
    expect(manager.listInstances()).toHaveLength(1)
    expect(manager.listInstances()[0].isVisible).toBe(false)
  })

  it('does not intercept close when destroy is explicit', () => {
    manager.createInstance('h-explicit-destroy')
    const instance = (manager as any).instances.get('h-explicit-destroy')

    ;(manager as any).destroyingIds.add('h-explicit-destroy')

    const closeEvent = { preventDefault: mock(() => {}) }
    instance.window._emit('close', closeEvent)

    expect(closeEvent.preventDefault).not.toHaveBeenCalled()
    expect(instance.window.hide).not.toHaveBeenCalled()
  })

  it('still destroys instance when cleanup throws', () => {
    manager.createInstance('destroy-cleanup-throw')
    const instance = (manager as any).instances.get('destroy-cleanup-throw')

    ;(manager as any).updateNativeOverlayState = () => {
      throw new Error('mock overlay cleanup failure')
    }

    expect(() => manager.destroyInstance('destroy-cleanup-throw')).not.toThrow()
    expect(instance.window.destroy).toHaveBeenCalledTimes(1)
    expect(manager.listInstances()).toHaveLength(0)
  })

  it('emits removed callback when window closes', () => {
    const removed: string[] = []
    manager.onRemoved((id) => removed.push(id))
    manager.createInstance('r1')

    const instance = (manager as any).instances.get('r1')
    instance.window._emit('closed')

    expect(removed).toEqual(['r1'])
    expect(manager.listInstances()).toHaveLength(0)
  })

  it('retries toolbar load and recovers', async () => {
    toolbarLoadFailuresRemaining = 2
    manager.createInstance('retry-toolbar')

    await Bun.sleep(1400)

    const toolbarWindow = createdWindows[0]
    const fileAttempts = toolbarWindow.webContents.loadFile.mock.calls.length
    const toolbarUrlAttempts = toolbarWindow.webContents.loadURL.mock.calls
      .filter((args: [string]) => args[0]?.includes('browser-toolbar.html')).length
    const totalAttempts = fileAttempts + toolbarUrlAttempts

    expect(totalAttempts).toBe(3)
    expect(toolbarWindow.webContents.loadURL).not.toHaveBeenCalledWith(expect.stringContaining('data:text/html'))
  })

  it('loads toolbar fallback page after retry exhaustion', async () => {
    toolbarLoadFailuresRemaining = 20
    manager.createInstance('fallback-toolbar')

    await Bun.sleep(3200)

    const toolbarWindow = createdWindows[0]
    const fileAttempts = toolbarWindow.webContents.loadFile.mock.calls.length
    const toolbarUrlAttempts = toolbarWindow.webContents.loadURL.mock.calls
      .filter((args: [string]) => args[0]?.includes('browser-toolbar.html')).length
    const totalAttempts = fileAttempts + toolbarUrlAttempts

    expect(totalAttempts).toBe(5)
    expect(toolbarWindow.webContents.loadURL).toHaveBeenCalledWith(expect.stringContaining('data:text/html'))
  })

  it('captures and filters console entries', () => {
    manager.createInstance('console-1')
    const instance = (manager as any).instances.get('console-1')
    // Off the app's empty-state page, whose console output is never logged
    instance.pageView.webContents._emit('did-start-navigation', 'https://example.com/', false, true)

    instance.pageView.webContents._emit('console-message', 2, 'warn message')
    instance.pageView.webContents._emit('console-message', 3, 'error message')

    const allEntries = manager.getConsoleLogs('console-1', { level: 'all', limit: 10 })
    expect(allEntries).toHaveLength(2)

    const warnEntries = manager.getConsoleLogs('console-1', { level: 'warn', limit: 10 })
    expect(warnEntries).toHaveLength(1)
    expect(warnEntries[0].message).toBe('warn message')
  })

  it('applies observer theme signal and skips regular console logging for it', () => {
    manager.createInstance('theme-signal')
    const instance = (manager as any).instances.get('theme-signal')
    instance.themeObserverToken = 'tok-1'

    instance.pageView.webContents._emit('console-message', 1, '__craft_theme_color__:tok-1:#123456')

    expect(manager.listInstances().find(i => i.id === 'theme-signal')?.themeColor).toBe('#123456')
    expect(manager.getConsoleLogs('theme-signal', { level: 'all', limit: 10 })).toHaveLength(0)
  })

  it('dedupes repeated observer theme signals', () => {
    manager.createInstance('theme-dedupe')
    const instance = (manager as any).instances.get('theme-dedupe')
    instance.themeObserverToken = 'tok-2'

    instance.pageView.webContents._emit('console-message', 1, '__craft_theme_color__:tok-2:#445566')
    const sendCallsAfterFirst = instance.window.webContents.send.mock.calls.length

    instance.pageView.webContents._emit('console-message', 1, '__craft_theme_color__:tok-2:#445566')
    const sendCallsAfterSecond = instance.window.webContents.send.mock.calls.length

    expect(sendCallsAfterSecond).toBe(sendCallsAfterFirst)
  })

  it('ignores observer theme signals from stale token', () => {
    manager.createInstance('theme-stale-token')
    const instance = (manager as any).instances.get('theme-stale-token')
    instance.themeObserverToken = 'tok-current'
    instance.themeColor = '#aaaaaa'

    instance.pageView.webContents._emit('console-message', 1, '__craft_theme_color__:tok-old:#bbccdd')

    expect(manager.listInstances().find(i => i.id === 'theme-stale-token')?.themeColor).toBe('#aaaaaa')
  })

  it('clears theme on explicit null sentinel signal', () => {
    manager.createInstance('theme-null')
    const instance = (manager as any).instances.get('theme-null')
    instance.themeObserverToken = 'tok-null'

    instance.pageView.webContents._emit('console-message', 1, '__craft_theme_color__:tok-null:#223344')
    expect(manager.listInstances().find(i => i.id === 'theme-null')?.themeColor).toBe('#223344')

    instance.pageView.webContents._emit('console-message', 1, '__craft_theme_color__:tok-null:__NULL__')
    expect(manager.listInstances().find(i => i.id === 'theme-null')?.themeColor).toBeNull()
  })

  it('replays toolbar state with theme color when window is shown', () => {
    manager.createInstance('theme-show-replay')
    const instance = (manager as any).instances.get('theme-show-replay')

    instance.currentUrl = 'https://example.com'
    instance.title = 'Example'
    instance.canGoBack = true
    instance.canGoForward = false
    instance.themeColor = '#123456'

    const sendsBeforeShow = instance.window.webContents.send.mock.calls.length
    instance.window._emit('show')

    const sendCallsAfterShow = instance.window.webContents.send.mock.calls.slice(sendsBeforeShow)
    expect(sendCallsAfterShow).toContainEqual([
      'browser-toolbar:state-update',
      {
        url: 'https://example.com',
        title: 'Example',
        isLoading: false,
        canGoBack: true,
        canGoForward: false,
        themeColor: '#123456',
      },
    ])
  })

  it('replays full toolbar state when toolbar renderer finishes loading', () => {
    toolbarLoadFailuresRemaining = 20
    manager.createInstance('toolbar-finish-load-replay')
    const instance = (manager as any).instances.get('toolbar-finish-load-replay')

    instance.currentUrl = 'https://craft.do'
    instance.title = 'Craft'
    instance.isLoading = true
    instance.canGoBack = true
    instance.canGoForward = true
    instance.themeColor = '#654321'

    instance.toolbarView.webContents.getURL = mock(() => 'http://localhost:5173/browser-toolbar.html?instanceId=toolbar-finish-load-replay')

    const sendsBeforeFinishLoad = instance.window.webContents.send.mock.calls.length
    instance.toolbarView.webContents._emit('did-finish-load')

    const sendCallsAfterFinishLoad = instance.window.webContents.send.mock.calls.slice(sendsBeforeFinishLoad)
    expect(sendCallsAfterFinishLoad).toContainEqual([
      'browser-toolbar:state-update',
      {
        url: 'https://craft.do',
        title: 'Craft',
        isLoading: true,
        canGoBack: true,
        canGoForward: true,
        themeColor: '#654321',
      },
    ])
  })

  it('does not mark toolbar ready for about:blank did-finish-load', () => {
    toolbarLoadFailuresRemaining = 20
    manager.createInstance('toolbar-ignore-about-blank')
    const instance = (manager as any).instances.get('toolbar-ignore-about-blank')

    instance.toolbarView.webContents.getURL = mock(() => 'about:blank')
    instance.toolbarView.webContents._emit('did-finish-load')

    expect(instance.toolbarReady).toBe(false)
  })

  it('marks toolbar ready for fallback data page did-finish-load', () => {
    toolbarLoadFailuresRemaining = 20
    manager.createInstance('toolbar-fallback-ready')
    const instance = (manager as any).instances.get('toolbar-fallback-ready')

    instance.toolbarView.webContents.getURL = mock(() => 'data:text/html;charset=UTF-8,%3Chtml%3E%3C%2Fhtml%3E')
    instance.toolbarView.webContents._emit('did-finish-load')

    expect(instance.toolbarReady).toBe(true)
  })

  it('keeps focus deferred until a valid toolbar document loads', () => {
    toolbarLoadFailuresRemaining = 20
    manager.createInstance('toolbar-focus-guard')
    const instance = (manager as any).instances.get('toolbar-focus-guard')

    manager.focus('toolbar-focus-guard')
    expect(instance.pendingShowOnReady).toBe(true)
    expect(instance.window.show).toHaveBeenCalledTimes(0)

    instance.toolbarView.webContents.getURL = mock(() => 'about:blank')
    instance.toolbarView.webContents._emit('did-finish-load')
    expect(instance.window.show).toHaveBeenCalledTimes(0)

    instance.toolbarView.webContents.getURL = mock(() => 'file:///mock/renderer/browser-toolbar.html')
    instance.toolbarView.webContents._emit('did-finish-load')

    expect(instance.toolbarReady).toBe(true)
    expect(instance.window.show).toHaveBeenCalledTimes(1)
    expect(instance.window.focus).toHaveBeenCalledTimes(1)
  })

  it('runs early theme extraction shortly after navigation', async () => {
    manager.createInstance('theme-early')
    const instance = (manager as any).instances.get('theme-early')
    instance.pageView.webContents.executeJavaScript = mock(async () => '#0f1e2d')

    instance.pageView.webContents._emit('did-navigate', 'https://example.com')

    await Bun.sleep(140)

    expect(manager.listInstances().find(i => i.id === 'theme-early')?.themeColor).toBe('#0f1e2d')
  })

  it('clears pending in-page theme timer on full navigation', async () => {
    manager.createInstance('theme-timer-clear')
    const instance = (manager as any).instances.get('theme-timer-clear')

    instance.pageView.webContents._emit('did-navigate-in-page', 'https://example.com/route-a')
    await Bun.sleep(0)
    expect(instance.inPageThemeTimer).not.toBeNull()

    instance.pageView.webContents._emit('did-navigate', 'https://example.com/full-nav')
    expect(instance.inPageThemeTimer).toBeNull()
  })

  it('throws when screenshot capture returns empty NativeImage', async () => {
    manager.createInstance('screenshot-empty-image')
    const instance = (manager as any).instances.get('screenshot-empty-image')
    instance.pageView.webContents.capturePage = mock(async () => ({
      isEmpty: () => true,
      getSize: () => ({ width: 0, height: 0 }),
      resize: function() { return this },
      toPNG: () => Buffer.from('ignored'),
      toJPEG: () => Buffer.from('ignored'),
    }))

    await expect(manager.screenshot('screenshot-empty-image')).rejects.toThrow('Failed to capture screenshot: empty image buffer')
  })

  it('throws when screenshot capture returns empty PNG buffer', async () => {
    manager.createInstance('screenshot-empty-png')
    const instance = (manager as any).instances.get('screenshot-empty-png')
    instance.pageView.webContents.capturePage = mock(async () => ({
      isEmpty: () => false,
      getSize: () => ({ width: 2400, height: 1800 }),
      resize: function() { return this },
      toPNG: () => Buffer.alloc(0),
      toJPEG: () => Buffer.alloc(0),
    }))

    await expect(manager.screenshot('screenshot-empty-png')).rejects.toThrow('Failed to capture screenshot: empty image buffer')
  })

  it('recovers screenshot via non-disruptive inactive reveal and restores hidden state', async () => {
    manager.createInstance('screenshot-rescue-success')
    const instance = (manager as any).instances.get('screenshot-rescue-success')

    let captureCalls = 0
    instance.pageView.webContents.capturePage = mock(async () => {
      captureCalls += 1
      if (captureCalls <= 3) {
        return {
          isEmpty: () => true,
          getSize: () => ({ width: 0, height: 0 }),
          resize: function() { return this },
          toPNG: () => Buffer.alloc(0),
          toJPEG: () => Buffer.alloc(0),
        }
      }

      const img = {
        isEmpty: () => false,
        getSize: () => ({ width: 2400, height: 1800 }),
        resize: () => img,
        toPNG: () => Buffer.from('rescued-png'),
        toJPEG: (_q: number) => Buffer.from('rescued-jpeg'),
      }
      return img
    })

    const result = await manager.screenshot('screenshot-rescue-success', { includeMetadata: true })

    expect(result.imageBuffer.toString()).toBe('rescued-png')
    expect(instance.window.showInactive).toHaveBeenCalledTimes(1)
    expect(instance.window.focus).not.toHaveBeenCalled()
    expect(instance.window.hide).toHaveBeenCalled()
    expect(result.metadata?.warnings?.some((w: string) => w.includes('shown invisibly'))).toBe(true)
    // Invisible and click-through while shown, then restored
    expect(instance.window.setOpacity.mock.calls).toEqual([[0], [1]])
    expect(instance.window.setIgnoreMouseEvents.mock.calls).toEqual([[true], [false]])
    expect(instance.window.setAlwaysOnTop.mock.calls).toEqual([[true, 'floating'], [false]])
  })

  it('throws when region screenshot capture returns empty NativeImage', async () => {
    manager.createInstance('region-empty-image')
    const instance = (manager as any).instances.get('region-empty-image')
    instance.pageView.webContents.capturePage = mock(async () => ({
      isEmpty: () => true,
      getSize: () => ({ width: 0, height: 0 }),
      resize: function() { return this },
      toPNG: () => Buffer.from('ignored'),
      toJPEG: () => Buffer.from('ignored'),
    }))

    await expect(manager.screenshotRegion('region-empty-image', { x: 10, y: 20, width: 120, height: 80 })).rejects.toThrow(
      'Failed to capture region screenshot: empty image buffer'
    )
  })

  it('throws when region screenshot capture returns empty PNG buffer', async () => {
    manager.createInstance('region-empty-png')
    const instance = (manager as any).instances.get('region-empty-png')
    instance.pageView.webContents.capturePage = mock(async () => ({
      isEmpty: () => false,
      getSize: () => ({ width: 2400, height: 1800 }),
      resize: function() { return this },
      toPNG: () => Buffer.alloc(0),
      toJPEG: () => Buffer.alloc(0),
    }))

    await expect(manager.screenshotRegion('region-empty-png', { x: 10, y: 20, width: 120, height: 80 })).rejects.toThrow(
      'Failed to capture region screenshot: empty image buffer'
    )
  })

  it('captures screenshot region from ref target', async () => {
    manager.createInstance('region-ref')
    const result = await manager.screenshotRegion('region-ref', { ref: '@e1' })

    expect(result.imageBuffer).toBeInstanceOf(Buffer)
    expect(result.metadata?.targetMode).toBe('ref')
  })

  it('captures screenshot region from selector target', async () => {
    manager.createInstance('region-selector')
    const result = await manager.screenshotRegion('region-selector', { selector: 'div.card', padding: 4 })

    expect(result.imageBuffer).toBeInstanceOf(Buffer)
    expect(result.metadata?.targetMode).toBe('selector')
  })

  it('throws for ambiguous screenshot region target modes', async () => {
    manager.createInstance('region-ambiguous')

    await expect(
      manager.screenshotRegion('region-ambiguous', { ref: '@e1', selector: 'div.card' })
    ).rejects.toThrow('Region screenshot target is ambiguous')
  })

  it('throws when selector target cannot be resolved', async () => {
    manager.createInstance('region-selector-missing')
    const instance = (manager as any).instances.get('region-selector-missing')
    instance.cdp.getElementGeometryBySelector = mock(async () => {
      throw new Error('No element found for selector "div.missing"')
    })

    await expect(
      manager.screenshotRegion('region-selector-missing', { selector: 'div.missing' })
    ).rejects.toThrow('No element found for selector "div.missing"')
  })

  it('throws when resolved region is outside viewport', async () => {
    manager.createInstance('region-oob')

    await expect(
      manager.screenshotRegion('region-oob', { x: 5000, y: 5000, width: 100, height: 100 })
    ).rejects.toThrow('Resolved screenshot region is outside the current viewport')
  })

  it('resizes browser window viewport and returns effective applied size', () => {
    manager.createInstance('resize-1')
    const resized = manager.windowResize('resize-1', 1280, 720)

    const instance = (manager as any).instances.get('resize-1')
    expect(instance.window.setContentSize).toHaveBeenCalledWith(1280, 768)
    expect(resized).toEqual({ width: 1280, height: 720 })
  })

  it('returns effective viewport size when min window constraints apply', () => {
    manager.createInstance('resize-min')
    const resized = manager.windowResize('resize-min', 200, 200)

    // BrowserWindow minHeight is 500, toolbar is 48, so effective viewport height is 452.
    expect(resized).toEqual({ width: 700, height: 452 })
  })

  // Found 2026-10-11: parallel sessions each opened their own Google sign-in popup, though all
  // browser windows share one cookie partition.
  describe('sign-in popups across browser windows', () => {
    const HANDLER = 'https://liza.firebaseapp.com/__/auth/handler?providerId=google.com'
    const openHandlerOf = (instance: any) => instance.pageView.webContents.setWindowOpenHandler.mock.calls[0][0]

    it('lets one open sign-in popup serve every window', () => {
      manager.createInstance('signin-a')
      manager.createInstance('signin-b')
      const a = (manager as any).instances.get('signin-a')
      const b = (manager as any).instances.get('signin-b')
      const popupWindow = createMockWindow({ width: 520, height: 720 })
      emitDidCreateWindow(a.pageView.webContents, popupWindow, { url: HANDLER })

      expect(openHandlerOf(b)({ url: HANDLER, disposition: 'new-popup' })).toEqual({ action: 'deny' })
      expect(popupWindow.moveTop).toHaveBeenCalledTimes(1)
      // Other popups, and the owner's own retries, still open.
      expect(openHandlerOf(b)({ url: 'https://example.com/share', disposition: 'new-popup' }).action).toBe('allow')
      expect(openHandlerOf(a)({ url: HANDLER, disposition: 'new-popup' }).action).toBe('allow')

      popupWindow.destroy() // closed: the next window may sign in itself
      expect(openHandlerOf(b)({ url: HANDLER, disposition: 'new-popup' }).action).toBe('allow')
    })

    it('tells the agent what a click did with popups', async () => {
      manager.createInstance('signin-owner')
      manager.createInstance('signin-click')
      const owner = (manager as any).instances.get('signin-owner')
      const clicker = (manager as any).instances.get('signin-click')
      const geometry = { ref: '@e1', box: { x: 0, y: 0, width: 10, height: 10 }, clickPoint: { x: 5, y: 5 }, via: 'mouse' }

      owner.cdp.clickElement = mock(async () => {
        emitDidCreateWindow(owner.pageView.webContents, createMockWindow(), { url: HANDLER })
        return geometry
      })
      const opened = await manager.clickElement('signin-owner', '@e1')
      expect(opened.popup).toContain(`The page opened a popup window (${HANDLER})`)

      clicker.cdp.clickElement = mock(async () => {
        openHandlerOf(clicker)({ url: HANDLER, disposition: 'new-popup' })
        return geometry
      })
      const joined = await manager.clickElement('signin-click', '@e1')
      expect(joined.popup).toContain('already open from another browser window (signin-owner)')

      clicker.cdp.clickElement = mock(async () => geometry)
      expect((await manager.clickElement('signin-click', '@e1')).popup).toBeUndefined()
    })

    it('recognizes sign-in popup URLs', () => {
      expect(isSignInPopupUrl(HANDLER)).toBe(true)
      expect(isSignInPopupUrl('https://accounts.google.com/o/oauth2/v2/auth?x=1')).toBe(true)
      expect(isSignInPopupUrl('https://github.com/login/oauth/authorize')).toBe(true)
      expect(isSignInPopupUrl('https://app.example.com/login')).toBe(true)
      expect(isSignInPopupUrl('https://example.com/share?u=1')).toBe(false)
      expect(isSignInPopupUrl('https://example.com/authors')).toBe(false)
    })
  })

  // Found 2026-10-11: the network log of a site's window also held the app's own localhost:5173
  // requests (its empty-state page), and console entries from the previous site.
  describe('console and network logs', () => {
    const electron = () => require('electron') as any
    const observers = () => {
      const results = electron().session.fromPartition.mock.results
      for (let i = results.length - 1; i >= 0; i--) {
        const ses = results[i].value
        const before = ses.webRequest.onBeforeRequest.mock.calls[0]?.[0]
        if (before) return { before, completed: ses.webRequest.onCompleted.mock.calls[0][0] }
      }
      throw new Error('no partition observers registered')
    }

    it('skips the empty-state page and keeps only the current site', async () => {
      manager.createInstance('logs')
      const instance = (manager as any).instances.get('logs')
      const wc = instance.pageView.webContents
      const { before, completed } = observers()
      let id = 0
      const request = (url: string) => {
        const details = { id: ++id, url, webContentsId: wc.id, method: 'GET', statusCode: 200, resourceType: 'script' }
        before(details, () => {})
        completed(details)
      }
      const navigate = async (url: string) => {
        await Bun.sleep(2) // distinct millisecond timestamps
        wc._emit('did-start-navigation', url, false, true)
        await Bun.sleep(1)
        request(url)
        await wc.loadURL(url)
        wc._emit('did-navigate', url)
      }
      const urls = () => manager.getNetworkLogs('logs').map((entry: any) => entry.url)

      // The empty-state page (the Vite dev server in development) is loaded first.
      request('http://localhost:5173/@vite/client')
      wc._emit('console-message', 1, '[vite] connected.')
      expect(urls()).toEqual([])
      expect(manager.getConsoleLogs('logs')).toEqual([])

      await navigate('https://slack.com/invite')
      wc._emit('console-message', 2, 'slack warning')
      await navigate('https://slack.com/welcome') // same site: history kept
      expect(urls()).toEqual(['https://slack.com/invite', 'https://slack.com/welcome'])

      await navigate('https://platform.example.com/')
      request('https://platform.example.com/app.js')
      expect(urls()).toEqual(['https://platform.example.com/', 'https://platform.example.com/app.js'])
      expect(manager.getConsoleLogs('logs')).toEqual([])
    })
  })

  it('annotates the elements on screen, not the first ones in the document', async () => {
    manager.createInstance('annotate-viewport')
    const instance = (manager as any).instances.get('annotate-viewport')
    const box = (y: number, height = 20) => ({ x: 10, y, width: 100, height })
    const boxes: Record<string, { x: number; y: number; width: number; height: number }> = {
      '@e1': box(-200), // scrolled past
      '@e2': box(100),
      '@e3': box(2000), // below the fold
      '@e4': box(300, 0), // collapsed
    }
    instance.cdp.getAccessibilitySnapshot = mock(async () => ({ url: 'https://example.com', title: 'Example', nodes: Object.keys(boxes).map((ref) => ({ ref, role: 'button', name: ref })) }))
    instance.cdp.getElementGeometry = mock(async (ref: string) => ({ ref, box: boxes[ref], clickPoint: { x: 60, y: boxes[ref]!.y + 10 } }))
    instance.cdp.getViewportMetrics = mock(async () => ({ width: 1000, height: 800, dpr: 1, scrollX: 0, scrollY: 0 }))

    const result = await manager.screenshot('annotate-viewport', { annotate: true })

    expect((result.metadata?.targets as Array<{ ref: string }>).map((t) => t.ref)).toEqual(['@e2'])
  })

  // Found 2026-10-11: screenshots of a hidden window showed an old frame. A throttled background
  // page stops painting and capturePage copies its last composited frame.
  describe('captures of a hidden page', () => {
    const image = (label: string) => {
      const img = {
        isEmpty: () => false,
        getSize: () => ({ width: 2400, height: 1800 }),
        resize: () => img,
        toPNG: () => Buffer.from(label),
        toJPEG: (_q: number) => Buffer.from(label),
      }
      return img
    }
    /** The paint probe never resolves until `paints()` is called (a hidden, throttled page). */
    const paintProbe = (instance: any) => {
      let painting = false
      const original = instance.pageView.webContents.executeJavaScript
      instance.pageView.webContents.executeJavaScript = mock(async (expr: string) => {
        if (!expr.includes('requestAnimationFrame')) return original(expr)
        return painting ? true : new Promise(() => {})
      })
      return { paints: () => { painting = true } }
    }

    it('lets the page render for the capture and throttles it again afterwards', async () => {
      manager.createInstance('cap-throttle')
      const instance = (manager as any).instances.get('cap-throttle')

      await manager.screenshot('cap-throttle')

      expect(instance.pageView.webContents.setBackgroundThrottling.mock.calls).toEqual([[false], [true]])
      expect(instance.rendersWhileHidden).toBe(false)
    })

    it('keeps the page rendering while an agent controls the window', () => {
      manager.createInstance('cap-agent')
      manager.bindSession('cap-agent', 'sess-cap')
      const instance = (manager as any).instances.get('cap-agent')

      manager.setAgentControl('sess-cap', { displayName: 'Browser' })
      expect(instance.pageView.webContents.setBackgroundThrottling).toHaveBeenLastCalledWith(false)

      manager.clearAgentControl('sess-cap')
      expect(instance.pageView.webContents.setBackgroundThrottling).toHaveBeenLastCalledWith(true)
    })

    it('skips hidden captures of a page that is not painting and reveals it briefly instead', async () => {
      manager.createInstance('cap-stale')
      const instance = (manager as any).instances.get('cap-stale')
      const probe = paintProbe(instance)
      instance.window.showInactive = mock(() => { probe.paints() })
      instance.pageView.webContents.capturePage = mock(async (_rect: unknown, opts: unknown) => image(opts ? 'stale-hidden' : 'fresh'))

      const result = await manager.screenshot('cap-stale')

      expect(result.imageBuffer.toString()).toBe('fresh')
      expect(instance.pageView.webContents.capturePage).toHaveBeenCalledTimes(1)
      expect(instance.window.showInactive).toHaveBeenCalledTimes(1)
      expect(instance.window.hide).toHaveBeenCalled()
      // Raw screenshots report warnings without includeMetadata.
      expect(result.metadata?.warnings?.some((w: string) => w.includes('shown invisibly'))).toBe(true)
    })

    // setOpacity does nothing on Linux, so a transparent reveal would flash the window there.
    it('parks the window beyond every display on Linux instead of making it transparent', async () => {
      const platform = Object.getOwnPropertyDescriptor(process, 'platform')!
      Object.defineProperty(process, 'platform', { value: 'linux' })
      try {
        manager.createInstance('cap-linux')
        const instance = (manager as any).instances.get('cap-linux')
        const probe = paintProbe(instance)
        instance.window.showInactive = mock(() => { probe.paints() })

        await manager.screenshot('cap-linux')

        expect(instance.window.setOpacity).not.toHaveBeenCalled()
        expect(instance.window.setPosition).toHaveBeenCalledWith(4580, 60) // right of both displays
        expect(instance.window.setSkipTaskbar.mock.calls).toEqual([[true], [false]])
        expect(instance.window.setBounds).toHaveBeenCalledWith({ x: 40, y: 60, width: 1200, height: 900 })
        expect(instance.window.hide).toHaveBeenCalled()
      } finally {
        Object.defineProperty(process, 'platform', platform)
      }
    })

    it('warns when even a reveal produced no new frame', async () => {
      manager.createInstance('cap-never')
      const instance = (manager as any).instances.get('cap-never')
      paintProbe(instance)

      const result = await manager.screenshot('cap-never')

      expect(result.metadata?.warnings).toContain('The page did not paint a new frame, so this capture may show an older one.')
    })
  })

  describe('agent control overlay', () => {
    it('setAgentControl activates native overlay on bound instance', async () => {
      manager.createInstance('ac-1')
      manager.bindSession('ac-1', 'sess-1')

      manager.setAgentControl('sess-1', { displayName: 'Navigate Page', intent: 'Loading example.com' })
      await Promise.resolve()

      const instance = (manager as any).instances.get('ac-1')
      expect(instance.agentControl).toEqual({
        active: true,
        sessionId: 'sess-1',
        displayName: 'Navigate Page',
        intent: 'Loading example.com',
      })
      expect(instance.nativeOverlayView.webContents.executeJavaScript).toHaveBeenCalled()
      expect(instance.nativeOverlayView.webContents.focus).not.toHaveBeenCalled()
      expect(manager.listInstances().find(i => i.id === 'ac-1')?.agentControlActive).toBe(true)
    })

    it('keeps native overlay visible for active session control', async () => {
      manager.createInstance('ac-idle')
      manager.bindSession('ac-idle', 'sess-idle')

      manager.setAgentControl('sess-idle', {
        displayName: 'Browser',
        intent: 'Session controls this window',
      })
      await Promise.resolve()

      const instance = (manager as any).instances.get('ac-idle')
      expect(instance.nativeOverlayView.setBounds).toHaveBeenCalledWith({ x: 0, y: 48, width: 1200, height: 852 })
      expect(instance.nativeOverlayView.webContents.focus).not.toHaveBeenCalled()
      expect(manager.listInstances().find(i => i.id === 'ac-idle')?.agentControlActive).toBe(true)
    })

    it('emits state change when agent control is set and cleared', () => {
      const stateEvents: any[] = []
      manager.onStateChange((info) => stateEvents.push(info))

      manager.createInstance('ac-state')
      manager.bindSession('ac-state', 'sess-state')

      manager.setAgentControl('sess-state', { displayName: 'Browser Snapshot' })
      manager.clearAgentControl('sess-state')

      const acStateEvents = stateEvents.filter((event) => event.id === 'ac-state')
      expect(acStateEvents.some((event) => event.agentControlActive === true)).toBe(true)
      expect(acStateEvents.some((event) => event.agentControlActive === false)).toBe(true)
    })

    it('reapplies native overlay after did-stop-loading while control is active', async () => {
      manager.createInstance('ac-reapply')
      manager.bindSession('ac-reapply', 'sess-reapply')

      manager.setAgentControl('sess-reapply', { displayName: 'Navigate Page', intent: 'Loading example.com' })
      await Promise.resolve()

      const instance = (manager as any).instances.get('ac-reapply')
      const callCountAfterSet = instance.nativeOverlayView.webContents.executeJavaScript.mock.calls.length

      instance.pageView.webContents._emit('did-stop-loading')
      await Promise.resolve()

      expect(instance.nativeOverlayView.webContents.executeJavaScript.mock.calls.length).toBeGreaterThan(callCountAfterSet)
    })

    it('reapplies native overlay after hide/show while control is active', async () => {
      manager.createInstance('ac-show-reapply')
      manager.bindSession('ac-show-reapply', 'sess-show-reapply')

      manager.setAgentControl('sess-show-reapply', { displayName: 'Click Button', intent: 'Clicking submit' })
      await Promise.resolve()

      const instance = (manager as any).instances.get('ac-show-reapply')
      const callCountAfterSet = instance.nativeOverlayView.webContents.executeJavaScript.mock.calls.length

      instance.window._emit('hide')
      instance.window._emit('show')
      await Promise.resolve()

      expect(instance.nativeOverlayView.webContents.executeJavaScript.mock.calls.length).toBeGreaterThan(callCountAfterSet)
    })

    it('setAgentControl uses fallback label when no intent', async () => {
      manager.createInstance('ac-2')
      manager.bindSession('ac-2', 'sess-2')

      manager.setAgentControl('sess-2', { displayName: 'Browser Snapshot' })
      await Promise.resolve()

      const instance = (manager as any).instances.get('ac-2')
      const calls = instance.nativeOverlayView.webContents.executeJavaScript.mock.calls
      expect(calls.length).toBeGreaterThan(0)
      expect(String(calls[calls.length - 1][0])).toContain('Browser Snapshot')
    })

    it('setAgentControl uses default label when no metadata', async () => {
      manager.createInstance('ac-3')
      manager.bindSession('ac-3', 'sess-3')

      manager.setAgentControl('sess-3', {})
      await Promise.resolve()

      const instance = (manager as any).instances.get('ac-3')
      const calls = instance.nativeOverlayView.webContents.executeJavaScript.mock.calls
      expect(calls.length).toBeGreaterThan(0)
      expect(String(calls[calls.length - 1][0])).toContain('Agent is working…')
    })

    it('clearAgentControl dismisses native overlay', () => {
      manager.createInstance('ac-4')
      manager.bindSession('ac-4', 'sess-4')

      manager.setAgentControl('sess-4', { displayName: 'Click Button', intent: 'Clicking submit' })
      manager.clearAgentControl('sess-4')

      const instance = (manager as any).instances.get('ac-4')
      expect(instance.agentControl).toBeNull()
      expect(instance.nativeOverlayView.setBounds).toHaveBeenCalledWith({ x: 0, y: 0, width: 0, height: 0 })
    })

    it('clearAgentControl is a no-op when not active', () => {
      manager.createInstance('ac-5')
      manager.bindSession('ac-5', 'sess-5')

      manager.clearAgentControl('sess-5')

      const instance = (manager as any).instances.get('ac-5')
      expect(instance.nativeOverlayView.webContents.executeJavaScript).not.toHaveBeenCalled()
    })

    it('clearVisualsForSession resets agent control state', async () => {
      manager.createInstance('ac-6')
      manager.bindSession('ac-6', 'sess-6')

      manager.setAgentControl('sess-6', { displayName: 'Fill Input', intent: 'Typing email' })
      await manager.clearVisualsForSession('sess-6')

      const instance = (manager as any).instances.get('ac-6')
      expect(instance.agentControl).toBeNull()
      expect(instance.nativeOverlayView.setBounds).toHaveBeenCalledWith({ x: 0, y: 0, width: 0, height: 0 })
    })

    it('setAgentControl ignores unbound sessions', () => {
      manager.createInstance('ac-7')

      manager.setAgentControl('nonexistent-session', { displayName: 'Test' })

      const instance = (manager as any).instances.get('ac-7')
      expect(instance.agentControl).toBeNull()
      expect(instance.nativeOverlayView.webContents.executeJavaScript).not.toHaveBeenCalled()
    })

    it('navigate does not trigger overlay by itself', async () => {
      manager.createInstance('ac-8')
      manager.bindSession('ac-8', 'sess-8')

      await manager.navigate('ac-8', 'https://example.com')

      const instance = (manager as any).instances.get('ac-8')
      expect(instance.agentControl).toBeNull()
      expect(instance.nativeOverlayView.webContents.executeJavaScript).not.toHaveBeenCalled()
    })
  })

  describe('security challenge detection', () => {
    const NONE = { detected: false, provider: 'none', signals: [], suspected: false }
    const ordinaryPage = {
      readyState: 'complete',
      title: 'Example',
      cfChallengeOptions: false,
      challengeForm: false,
      challengeStage: false,
      text: 'Welcome',
      frames: [],
      turnstile: [],
      pxCaptcha: null,
      overlayOpen: false,
    }
    const interstitial = { ...ordinaryPage, title: 'Just a moment...', cfChallengeOptions: true }

    /** A settled page whose page script returns `pages` in turn; the confirm delay is stubbed out. */
    function setUpPage(id: string, pages: unknown[], options: { loading?: boolean } = {}) {
      manager.createInstance(id)
      const instance = (manager as any).instances.get(id)
      instance.currentUrl = 'https://example.com/'
      instance.pageView.webContents.isLoading = mock(() => options.loading ?? false)
      let call = 0
      instance.pageView.webContents.executeJavaScript = mock(async () => pages[Math.min(call++, pages.length - 1)])
      const sleep = mock(async (_ms: number) => {})
      ;(manager as any).sleep = sleep
      return { instance, sleep }
    }

    it('gives no verdict while the page is loading', async () => {
      const { instance, sleep } = setUpPage('sc-loading', [interstitial], { loading: true })

      expect(await manager.detectSecurityChallenge('sc-loading')).toEqual(NONE)
      expect(instance.pageView.webContents.executeJavaScript).not.toHaveBeenCalled()
      expect(sleep).not.toHaveBeenCalled()
    })

    it('does not flag a sparse page that shows no challenge', async () => {
      const { instance, sleep } = setUpPage('sc-sparse', [{ ...ordinaryPage, text: 'Invalid connect link' }])
      instance.cdp.getAccessibilitySnapshot = mock(async () => ({
        url: 'https://example.com/',
        title: 'Example',
        nodes: [
          { ref: '@e1', role: 'heading', name: 'Invalid connect link' },
          { ref: '@e2', role: 'paragraph', name: 'Ask for a new one.' },
          { ref: '@e3', role: 'link', name: 'Home' },
        ],
      }))

      expect(await manager.detectSecurityChallenge('sc-sparse')).toEqual({ ...NONE, signals: ['ax:near-empty(1/3)'] })
      expect(sleep).not.toHaveBeenCalled()
    })

    it('reports a challenge only after a second look confirms it', async () => {
      const { SECURITY_CHALLENGE_CONFIRM_DELAY_MS } = await import('../security-challenge')
      const { instance, sleep } = setUpPage('sc-confirmed', [interstitial, interstitial])

      const verdict = await manager.detectSecurityChallenge('sc-confirmed')

      expect(verdict).toEqual({ detected: true, provider: 'cloudflare', signals: ['js:cf-chl-opt', 'title:just-a-moment'], suspected: false })
      expect(sleep).toHaveBeenCalledTimes(1)
      expect(sleep).toHaveBeenCalledWith(SECURITY_CHALLENGE_CONFIRM_DELAY_MS)
      expect(instance.pageView.webContents.executeJavaScript).toHaveBeenCalledTimes(2)
    })

    it('drops a verdict that does not hold on the second look', async () => {
      const { sleep } = setUpPage('sc-passed', [interstitial, ordinaryPage])

      expect(await manager.detectSecurityChallenge('sc-passed')).toEqual(NONE)
      expect(sleep).toHaveBeenCalledTimes(1)
    })

    it('gives no verdict when the URL changes while facts are collected', async () => {
      const { instance } = setUpPage('sc-moved', [])
      instance.pageView.webContents.executeJavaScript = mock(async () => {
        instance.currentUrl = 'https://example.com/next'
        return interstitial
      })

      expect(await manager.detectSecurityChallenge('sc-moved')).toEqual(NONE)
    })

    it('gives no verdict when the page script fails or the instance is gone', async () => {
      const { instance } = setUpPage('sc-script-error', [])
      instance.pageView.webContents.executeJavaScript = mock(async () => { throw new Error('Script failed to execute') })

      expect(await manager.detectSecurityChallenge('sc-script-error')).toEqual(NONE)
      expect(await manager.detectSecurityChallenge('sc-missing')).toEqual(NONE)
    })
  })

  describe('failed interaction tracking', () => {
    it('clickElement records failed lastAction on error', async () => {
      manager.createInstance('fail-click')
      const instance = (manager as any).instances.get('fail-click')
      instance.cdp.clickElement = mock(async () => { throw new Error('click failed') })

      await expect(manager.clickElement('fail-click', '@e1')).rejects.toThrow('click failed')

      expect(instance.lastAction).toMatchObject({
        tool: 'browser_click',
        ref: '@e1',
        status: 'failed',
      })
    })

    it('fillElement records failed lastAction on error', async () => {
      manager.createInstance('fail-fill')
      const instance = (manager as any).instances.get('fail-fill')
      instance.cdp.fillElement = mock(async () => { throw new Error('fill failed') })

      await expect(manager.fillElement('fail-fill', '@e2', 'hello')).rejects.toThrow('fill failed')

      expect(instance.lastAction).toMatchObject({
        tool: 'browser_fill',
        ref: '@e2',
        status: 'failed',
      })
    })

    it('selectOption records failed lastAction on error', async () => {
      manager.createInstance('fail-select')
      const instance = (manager as any).instances.get('fail-select')
      instance.cdp.selectOption = mock(async () => { throw new Error('select failed') })

      await expect(manager.selectOption('fail-select', '@e3', 'opt-1')).rejects.toThrow('select failed')

      expect(instance.lastAction).toMatchObject({
        tool: 'browser_select',
        ref: '@e3',
        status: 'failed',
      })
    })
  })
})

// Regression for OSS #1059: closing a popup destroys its BrowserWindow, after
// which reading `webContents` throws "Object has been destroyed". Cleanup used
// to read it, so the popup stayed registered, the parent's teardown threw before
// removing the instance, and every later browser_tool call hit the dead window.
describe('BrowserPaneManager popup teardown after the popup window was destroyed', () => {
  let manager: InstanceType<typeof BrowserPaneManager>

  beforeEach(() => {
    createdWindows.length = 0
    toolbarLoadFailuresRemaining = 0
    manager = new BrowserPaneManager()
  })

  /** Make a mock window behave like a destroyed Electron BrowserWindow. */
  function markDestroyed(win: any): void {
    win.isDestroyed = mock(() => true)
    Object.defineProperty(win, 'webContents', {
      configurable: true,
      get() {
        throw new Error('Object has been destroyed')
      },
    })
  }

  function openPopup(parentId: string) {
    const instance = (manager as any).instances.get(parentId)
    const popupWindow = createMockWindow({ width: 520, height: 720 })
    emitDidCreateWindow(instance.pageView.webContents, popupWindow, { url: 'https://accounts.google.com/signin' })
    return popupWindow
  }

  it('unregisters a popup whose window is already destroyed when closed fires', () => {
    manager.createInstance('popup-closed')
    const popupWindow = openPopup('popup-closed')
    const popupWcId = popupWindow.webContents.id
    expect((manager as any).popupParentByWebContentsId.get(popupWcId)).toBe('popup-closed')

    markDestroyed(popupWindow)
    expect(() => popupWindow._emit('closed')).not.toThrow()

    expect((manager as any).popupParentByWebContentsId.has(popupWcId)).toBe(false)
    expect((manager as any).popupWindowsByParentInstanceId.has('popup-closed')).toBe(false)
  })

  it('terminating the parent after closing a popup removes the instance and allows a fresh one', () => {
    const removed: string[] = []
    manager.onRemoved((id) => removed.push(id))
    manager.createInstance('popup-then-terminate')
    const popupWindow = openPopup('popup-then-terminate')

    markDestroyed(popupWindow)
    popupWindow._emit('closed')

    expect(() => manager.destroyInstance('popup-then-terminate')).not.toThrow()
    expect(manager.listInstances()).toHaveLength(0)
    expect(removed).toEqual(['popup-then-terminate'])

    // The next browser_tool open must get a working window.
    manager.createInstance('popup-then-terminate')
    expect(manager.listInstances()).toHaveLength(1)
  })

  it('tears down a parent whose still-registered popup was destroyed out of band', () => {
    manager.createInstance('popup-stale')
    const popupWindow = openPopup('popup-stale')
    // Destroyed without `closed` reaching us (e.g. crash of the popup renderer).
    markDestroyed(popupWindow)

    expect(() => manager.destroyInstance('popup-stale')).not.toThrow()
    expect(manager.listInstances()).toHaveLength(0)
    expect(popupWindow.destroy).not.toHaveBeenCalled()
    expect((manager as any).popupWindowsByParentInstanceId.has('popup-stale')).toBe(false)
  })

  it('removes the instance even when a teardown step throws', () => {
    const removed: string[] = []
    manager.onRemoved((id) => removed.push(id))
    manager.createInstance('teardown-throws')
    const instance = (manager as any).instances.get('teardown-throws')
    instance.cdp.detach = mock(() => {
      throw new Error('Object has been destroyed')
    })

    expect(() => manager.destroyInstance('teardown-throws')).not.toThrow()
    expect(manager.listInstances()).toHaveLength(0)
    expect(removed).toEqual(['teardown-throws'])
  })

  it('resolves instances by page webContents id without touching destroyed webContents', () => {
    manager.createInstance('lookup-safe')
    const instance = (manager as any).instances.get('lookup-safe')
    const wcId = instance.pageWebContentsId
    Object.defineProperty(instance.pageView, 'webContents', {
      configurable: true,
      get() {
        throw new Error('Object has been destroyed')
      },
    })
    expect((manager as any).findInstanceByPageWebContentsId(wcId)).toBe(instance)
    expect((manager as any).findInstanceByPageWebContentsId(wcId + 1000)).toBeUndefined()
  })
})
