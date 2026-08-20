import { beforeEach, describe, expect, it, mock } from 'bun:test'
import type { RpcServer } from '@craft-agent/server-core/transport'
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
    hasClientCapability() { return false },
    findClientsWithCapability() { return [] },
  }
}

function createMockDeps(): HandlerDeps {
  return {
    sessionManager: {} as HandlerDeps['sessionManager'],
    platform: {
      appRootPath: '',
      resourcesPath: '',
      isPackaged: false,
      appVersion: '0.0.0-test',
      isDebugMode: true,
      logger: console,
      imageProcessor: {
        getMetadata: async () => null,
        process: async () => Buffer.from(''),
      },
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
    // Required so registerMessagingHandlers doesn't early-return and skip channel registration.
    messagingRegistry: {} as unknown as NonNullable<HandlerDeps['messagingRegistry']>,
  }
}

async function getExpectedChannels(): Promise<Set<string>> {
  // Core handler channels (now in server-core)
  const [
    auth,
    automations,
    cloudRuns,
    identity,
    extensions,
    pluginBridge,
    files,
    labels,
    orgs,
    llm,
    memory,
    memoryIo,
    memoryInsights,
    knowledge,
    mindmap,
    notes,
    oauth,
    sessions,
    coreSettings,
    skills,
    skillsPending,
    sources,
    statuses,
    contextDocs,
    bundledSkills,
    marketplace,
    coreSystem,
    coreWorkspace,
    onboarding,
    resources,
    transfer,
    tasks,
    toolchain,
    projects,
    kanban,
    collection,
    gamification,
    messaging,
  ] = await Promise.all([
    import('@craft-agent/server-core/handlers/rpc/auth'),
    import('@craft-agent/server-core/handlers/rpc/automations'),
    import('@craft-agent/server-core/handlers/rpc/cloud-runs'),
    import('@craft-agent/server-core/handlers/rpc/identity'),
    import('@craft-agent/server-core/handlers/rpc/extensions'),
    import('@craft-agent/server-core/handlers/rpc/plugin-bridge'),
    import('@craft-agent/server-core/handlers/rpc/files'),
    import('@craft-agent/server-core/handlers/rpc/labels'),
    import('@craft-agent/server-core/handlers/rpc/orgs'),
    import('@craft-agent/server-core/handlers/rpc/llm-connections'),
    import('@craft-agent/server-core/handlers/rpc/memory'),
    import('@craft-agent/server-core/handlers/rpc/memory-io'),
    import('@craft-agent/server-core/handlers/rpc/memory-insights'),
    import('@craft-agent/server-core/handlers/rpc/knowledge'),
    import('@craft-agent/server-core/handlers/rpc/mindmap'),
    import('@craft-agent/server-core/handlers/rpc/notes'),
    import('@craft-agent/server-core/handlers/rpc/oauth'),
    import('@craft-agent/server-core/handlers/rpc/sessions'),
    import('@craft-agent/server-core/handlers/rpc/settings'),
    import('@craft-agent/server-core/handlers/rpc/skills'),
    import('@craft-agent/server-core/handlers/rpc/skills-pending'),
    import('@craft-agent/server-core/handlers/rpc/sources'),
    import('@craft-agent/server-core/handlers/rpc/statuses'),
    import('@craft-agent/server-core/handlers/rpc/context-docs'),
    import('@craft-agent/server-core/handlers/rpc/bundled-skills'),
    import('@craft-agent/server-core/handlers/rpc/marketplace'),
    import('@craft-agent/server-core/handlers/rpc/system'),
    import('@craft-agent/server-core/handlers/rpc/workspace'),
    import('@craft-agent/server-core/handlers/rpc/onboarding'),
    import('@craft-agent/server-core/handlers/rpc/resources'),
    import('@craft-agent/server-core/handlers/rpc/transfer'),
    import('@craft-agent/server-core/handlers/rpc/tasks'),
    import('@craft-agent/server-core/handlers/rpc/toolchain'),
    import('@craft-agent/server-core/handlers/rpc/projects'),
    import('@craft-agent/server-core/handlers/rpc/kanban'),
    import('@craft-agent/server-core/handlers/rpc/collection'),
    import('@craft-agent/server-core/handlers/rpc/gamification'),
    import('@craft-agent/server-core/handlers/rpc/messaging'),
  ])

  const [browser, guiSystem, guiWorkspace, guiSettings, siyuan, extensionHost, extensionSurface] = await Promise.all([
    import('../browser'),
    import('../system'),
    import('../workspace'),
    import('../settings'),
    import('../siyuan'),
    import('../extension-host'),
    import('../extension-surface'),
  ])

  return new Set([
    ...auth.HANDLED_CHANNELS,
    ...automations.HANDLED_CHANNELS,
    ...cloudRuns.HANDLED_CHANNELS,
    ...identity.HANDLED_CHANNELS,
    ...extensions.HANDLED_CHANNELS,
    ...pluginBridge.HANDLED_CHANNELS,
    ...files.HANDLED_CHANNELS,
    ...labels.HANDLED_CHANNELS,
    ...orgs.HANDLED_CHANNELS,
    ...llm.HANDLED_CHANNELS,
    ...memory.HANDLED_CHANNELS,
    ...memoryIo.HANDLED_CHANNELS,
    ...memoryInsights.HANDLED_CHANNELS,
    ...knowledge.HANDLED_CHANNELS,
    ...mindmap.HANDLED_CHANNELS,
    ...notes.HANDLED_CHANNELS,
    ...oauth.HANDLED_CHANNELS,
    ...sessions.HANDLED_CHANNELS,
    ...coreSettings.HANDLED_CHANNELS,
    ...skills.HANDLED_CHANNELS,
    ...skillsPending.HANDLED_CHANNELS,
    ...sources.HANDLED_CHANNELS,
    ...statuses.HANDLED_CHANNELS,
    ...contextDocs.HANDLED_CHANNELS,
    ...bundledSkills.HANDLED_CHANNELS,
    ...marketplace.HANDLED_CHANNELS,
    ...coreSystem.CORE_HANDLED_CHANNELS,
    ...coreWorkspace.CORE_HANDLED_CHANNELS,
    ...onboarding.HANDLED_CHANNELS,
    ...resources.HANDLED_CHANNELS,
    ...transfer.HANDLED_CHANNELS,
    ...tasks.HANDLED_CHANNELS,
    ...toolchain.HANDLED_CHANNELS,
    ...projects.HANDLED_CHANNELS,
    ...kanban.HANDLED_CHANNELS,
    ...collection.HANDLED_CHANNELS,
    ...gamification.HANDLED_CHANNELS,
    ...messaging.HANDLED_CHANNELS,
    ...browser.HANDLED_CHANNELS,
    ...guiSystem.GUI_HANDLED_CHANNELS,
    ...guiWorkspace.GUI_HANDLED_CHANNELS,
    ...guiSettings.GUI_HANDLED_CHANNELS,
    ...siyuan.HANDLED_CHANNELS,
    ...extensionHost.HANDLED_CHANNELS,
    ...extensionSurface.HANDLED_CHANNELS,
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
    const { HANDLED_CHANNELS } = await import('@craft-agent/server-core/handlers/rpc/onboarding')
    const { registerAllRpcHandlers } = await import('../index')

    registerAllRpcHandlers(createMockServer(), createMockDeps())

    const actual = new Set(registeredChannels)
    const missingOnboarding = HANDLED_CHANNELS.filter(ch => !actual.has(ch))

    expect(missingOnboarding).toEqual([])
  })
})
