import { beforeEach, describe, expect, it, mock } from 'bun:test'

const createdOptions: any[] = []
const createdWindows: any[] = []
let lastMenuTemplate: any[] | null = null
let lastPopupArgs: any = null
const addWordToSpellCheckerDictionary = mock((_word: string) => {})
const replaceMisspelling = mock((_word: string) => {})
const cut = mock(() => {})
const copy = mock(() => {})
const paste = mock(() => {})
const selectAll = mock(() => {})

function createMockWebContents() {
  const listeners: Record<string, Function[]> = {}

  return {
    id: createdWindows.length + 1,
    mainFrame: {},
    session: {
      addWordToSpellCheckerDictionary,
    },
    replaceMisspelling,
    cut,
    copy,
    paste,
    selectAll,
    setWindowOpenHandler: mock((_handler: unknown) => {}),
    on: (event: string, cb: Function) => {
      if (!listeners[event]) listeners[event] = []
      listeners[event].push(cb)
    },
    send: mock((_channel: string, ..._args: unknown[]) => {}),
    isDestroyed: mock(() => false),
    _listeners: listeners,
  }
}

function createMockWindow(options?: any) {
  const listeners: Record<string, Function[]> = {}
  const win = {
    webContents: createMockWebContents(),
    on: (event: string, cb: Function) => {
      if (!listeners[event]) listeners[event] = []
      listeners[event].push(cb)
    },
    once: (event: string, cb: Function) => {
      if (!listeners[event]) listeners[event] = []
      listeners[event].push(cb)
    },
    loadFile: mock(async (_path: string, _options?: unknown) => {}),
    loadURL: mock(async (_url: string) => {}),
    show: mock(() => {}),
    isDestroyed: mock(() => false),
    isMinimized: mock(() => false),
    restore: mock(() => {}),
    focus: mock(() => {}),
    destroy: mock(() => {}),
    setWindowButtonVisibility: mock((_visible: boolean) => {}),
    _listeners: listeners,
    _options: options,
  }

  createdWindows.push(win)
  return win
}

mock.module('electron', () => ({
  BrowserWindow: class MockBrowserWindow {
    constructor(options?: any) {
      createdOptions.push(options)
      Object.assign(this, createMockWindow(options))
    }
  },
  Menu: {
    buildFromTemplate: mock((template: any[]) => {
      lastMenuTemplate = template
      return {
        popup: mock((args?: unknown) => {
          lastPopupArgs = args
        }),
      }
    }),
  },
  nativeTheme: {
    shouldUseDarkColors: false,
    on: mock((_event: string, _cb: Function) => {}),
    removeListener: mock((_event: string, _cb: Function) => {}),
  },
  shell: {
    openExternal: mock(async (_url: string) => {}),
  },
}))

describe('WindowManager spellcheck context menu', () => {
  beforeEach(() => {
    createdOptions.length = 0
    createdWindows.length = 0
    lastMenuTemplate = null
    lastPopupArgs = null
    addWordToSpellCheckerDictionary.mockClear()
    replaceMisspelling.mockClear()
    cut.mockClear()
    copy.mockClear()
    paste.mockClear()
    selectAll.mockClear()
    delete process.env.VITE_DEV_SERVER_URL
  })

  it('enables Electron spellcheck for app windows', async () => {
    const { WindowManager } = await import('../window-manager')

    new WindowManager().createWindow({ workspaceId: 'ws-1' })

    expect(createdOptions[0]?.webPreferences?.spellcheck).toBe(true)
  })

  it('shows a focused spelling and edit menu without dev-only items', async () => {
    const { WindowManager } = await import('../window-manager')

    new WindowManager().createWindow({ workspaceId: 'ws-1' })
    const win = createdWindows[0]
    const contextMenuHandler = win.webContents._listeners['context-menu'][0]

    contextMenuHandler({}, {
      x: 12,
      y: 24,
      misspelledWord: 'teh',
      dictionarySuggestions: ['the', 'tech'],
      editFlags: {
        canCut: true,
        canCopy: true,
        canPaste: false,
        canSelectAll: true,
      },
    })

    expect(lastMenuTemplate?.some(item => item.label === 'Inspect Element')).toBe(false)
    expect(lastMenuTemplate?.some(item => item.label === 'No spelling suggestions')).toBe(false)
    expect(lastMenuTemplate?.some(item => item.label === 'Paste')).toBe(false)
    expect(lastMenuTemplate?.map(item => item.label ?? item.type)).toEqual([
      'the',
      'tech',
      'separator',
      'Learn Spelling',
      'separator',
      'Cut',
      'Copy',
      'Select All',
    ])
    expect(lastPopupArgs).toEqual({ window: win })

    const suggestionItem = lastMenuTemplate?.find(item => item.label === 'the')
    suggestionItem.click()
    expect(replaceMisspelling).toHaveBeenCalledWith('the')

    const dictionaryItem = lastMenuTemplate?.find(item => item.label === 'Learn Spelling')
    dictionaryItem.click()
    expect(addWordToSpellCheckerDictionary).toHaveBeenCalledWith('teh')

    const copyItem = lastMenuTemplate?.find(item => item.label === 'Copy')
    copyItem.click()
    expect(copy).toHaveBeenCalled()
  })

  it('omits spelling-only rows when no misspelling is present', async () => {
    const { WindowManager } = await import('../window-manager')

    new WindowManager().createWindow({ workspaceId: 'ws-1' })
    const win = createdWindows[0]
    const contextMenuHandler = win.webContents._listeners['context-menu'][0]

    contextMenuHandler({}, {
      x: 12,
      y: 24,
      misspelledWord: '',
      dictionarySuggestions: [],
      editFlags: {
        canCut: false,
        canCopy: true,
        canPaste: true,
        canSelectAll: true,
      },
    })

    expect(lastMenuTemplate?.map(item => item.label ?? item.type)).toEqual([
      'Copy',
      'Paste',
      'Select All',
    ])
  })
})
