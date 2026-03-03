import { beforeEach, describe, expect, it, mock } from 'bun:test'
import type { RpcServer } from '../../../transport/types'
import type { HandlerDeps } from '../handler-deps'

const registeredChannels: string[] = []

mock.module('electron', () => ({
  ipcMain: {
    handle: () => {},
    on: () => {},
  },
  // Minimal stubs for symbols imported by IPC domain modules
  app: {
    isPackaged: false,
    getAppPath: () => '/',
    quit: () => {},
    dock: { setIcon: () => {}, setBadge: () => {} },
  },
  nativeTheme: { shouldUseDarkColors: false },
  nativeImage: {
    createFromPath: () => ({ isEmpty: () => true }),
    createFromDataURL: () => ({}),
  },
  dialog: {
    showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
    showMessageBox: async () => ({ response: 0 }),
  },
  shell: {
    openExternal: async () => {},
    openPath: async () => '',
    showItemInFolder: () => {},
  },
  BrowserWindow: {
    fromWebContents: () => null,
    getFocusedWindow: () => null,
    getAllWindows: () => [],
  },
  BrowserView: class {},
  Menu: {
    buildFromTemplate: () => ({ popup: () => {} }),
  },
  session: {},
}))

function createMockServer(): RpcServer {
  return {
    handle(channel: string, _handler: unknown) {
      registeredChannels.push(channel)
    },
    push() {},
    async invokeClient() {},
  }
}

function createMockDeps(): HandlerDeps {
  return {
    sessionManager: {} as HandlerDeps['sessionManager'],
    platform: {
      appRootPath: '',
      resourcesPath: '',
      isPackaged: false,
      logger: console,
    },
    windowManager: {} as HandlerDeps['windowManager'],
    browserPaneManager: {
      onStateChange: () => {},
      onRemoved: () => {},
      onInteracted: () => {},
    } as unknown as NonNullable<HandlerDeps['browserPaneManager']>,
    oauthFlowStore: {
      store: () => {},
      getByState: () => null,
      remove: () => {},
      cleanup: () => {},
      dispose: () => {},
      size: 0,
    } as unknown as HandlerDeps['oauthFlowStore'],
  }
}

async function getExpectedChannels(): Promise<Set<string>> {
  const [
    auth,
    automations,
    browser,
    files,
    labels,
    llm,
    oauth,
    sessions,
    settings,
    skills,
    sources,
    statuses,
    system,
    workspace,
    onboarding,
  ] = await Promise.all([
    import('../auth'),
    import('../automations'),
    import('../browser'),
    import('../files'),
    import('../labels'),
    import('../llm-connections'),
    import('../oauth'),
    import('../sessions'),
    import('../settings'),
    import('../skills'),
    import('../sources'),
    import('../statuses'),
    import('../system'),
    import('../workspace'),
    import('../../onboarding'),
  ])

  return new Set([
    ...auth.HANDLED_CHANNELS,
    ...automations.HANDLED_CHANNELS,
    ...browser.HANDLED_CHANNELS,
    ...files.HANDLED_CHANNELS,
    ...labels.HANDLED_CHANNELS,
    ...llm.HANDLED_CHANNELS,
    ...oauth.HANDLED_CHANNELS,
    ...sessions.HANDLED_CHANNELS,
    ...settings.HANDLED_CHANNELS,
    ...skills.HANDLED_CHANNELS,
    ...sources.HANDLED_CHANNELS,
    ...statuses.HANDLED_CHANNELS,
    ...system.HANDLED_CHANNELS,
    ...workspace.HANDLED_CHANNELS,
    ...onboarding.HANDLED_CHANNELS,
  ])
}

describe('RPC handler registration', () => {
  beforeEach(() => {
    registeredChannels.length = 0
  })

  it('registers all declared handled channels exactly once', async () => {
    const expected = await getExpectedChannels()
    const { registerAllRpcHandlers } = await import('../index')

    registerAllRpcHandlers(createMockServer(), createMockDeps())

    const appChannels = registeredChannels.filter(ch => ch.includes(':'))
    const actual = new Set(appChannels)

    const missing = [...expected].filter(ch => !actual.has(ch)).sort()
    const unexpected = [...actual].filter(ch => !expected.has(ch)).sort()

    expect(missing).toEqual([])
    expect(unexpected).toEqual([])

    // Check for duplicates
    const counts = new Map<string, number>()
    for (const ch of appChannels) {
      counts.set(ch, (counts.get(ch) ?? 0) + 1)
    }
    const duplicates = [...counts.entries()]
      .filter(([, count]) => count > 1)
      .map(([channel, count]) => `${channel} (${count}x)`)
      .sort()

    expect(duplicates).toEqual([])
  })

  it('keeps onboarding channels in registration coverage', async () => {
    const { HANDLED_CHANNELS } = await import('../../onboarding')
    const { registerAllRpcHandlers } = await import('../index')

    registerAllRpcHandlers(createMockServer(), createMockDeps())

    const actual = new Set(registeredChannels)
    const missingOnboarding = HANDLED_CHANNELS.filter(ch => !actual.has(ch))

    expect(missingOnboarding).toEqual([])
  })
})
