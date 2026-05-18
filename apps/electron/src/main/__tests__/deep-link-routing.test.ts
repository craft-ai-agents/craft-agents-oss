import { afterEach, describe, expect, it } from 'bun:test'
import { handleDeepLink, parseDeepLink } from '../deep-link'
import { RPC_CHANNELS } from '../../shared/types'
import type { EventSink } from '@craft-agent/server-core/transport'
import type { WindowManager } from '../window-manager'

const originalDeepLinkScheme = process.env.CRAFT_DEEPLINK_SCHEME

function createMockWindow(webContentsId: number) {
  return {
    isMinimized: () => false,
    restore: () => {},
    focus: () => {},
    isDestroyed: () => false,
    webContents: {
      id: webContentsId,
      isLoading: () => false,
      isDestroyed: () => false,
      once: () => {},
    },
  }
}

describe('handleDeepLink routing', () => {
  afterEach(() => {
    if (originalDeepLinkScheme === undefined) {
      delete process.env.CRAFT_DEEPLINK_SCHEME
    } else {
      process.env.CRAFT_DEEPLINK_SCHEME = originalDeepLinkScheme
    }
  })

  it('rejects non-mdp protocols', () => {
    const legacyScheme = ['craft', 'agents'].join('')
    expect(parseDeepLink(`${legacyScheme}://workspace/ws-target/allSessions`)).toBeNull()
  })

  it('accepts the configured development protocol override', () => {
    process.env.CRAFT_DEEPLINK_SCHEME = 'mdp2'
    expect(parseDeepLink('mdp2://workspace/ws-target/allSessions')).toMatchObject({
      workspaceId: 'ws-target',
      view: 'allSessions',
    })
    expect(parseDeepLink('mdp://workspace/ws-target/allSessions')).toBeNull()
  })

  it('prefers resolved target client over preferred caller client', async () => {
    const targetWindow = createMockWindow(22)

    const windowManager = {
      focusOrCreateWindow: () => targetWindow,
      getFocusedWindow: () => targetWindow,
      getLastActiveWindow: () => targetWindow,
      getWorkspaceForWindow: (webContentsId: number) => webContentsId === 22 ? 'ws-target' : 'ws-other',
    } as unknown as WindowManager

    const sent: Array<{ channel: string; target: unknown; args: unknown[] }> = []
    const sink: EventSink = (channel, target, ...args) => {
      sent.push({ channel, target, args })
    }

    await handleDeepLink(
      'mdp://workspace/ws-target/allSessions',
      windowManager,
      {
        sink,
        resolveClientId: (wcId) => wcId === 22 ? 'client-target' : undefined,
        preferredClientId: 'client-caller',
      },
    )

    expect(sent.length).toBe(1)
    expect(sent[0]?.channel).toBe(RPC_CHANNELS.deeplink.NAVIGATE)
    expect(sent[0]?.target).toEqual({ to: 'client', clientId: 'client-target' })
  })

  it('uses preferred client only when no resolver is provided', async () => {
    const targetWindow = createMockWindow(31)

    const windowManager = {
      focusOrCreateWindow: () => targetWindow,
      getFocusedWindow: () => targetWindow,
      getLastActiveWindow: () => targetWindow,
      getWorkspaceForWindow: () => 'ws-target',
    } as unknown as WindowManager

    const sent: Array<{ channel: string; target: unknown; args: unknown[] }> = []
    const sink: EventSink = (channel, target, ...args) => {
      sent.push({ channel, target, args })
    }

    await handleDeepLink(
      'mdp://workspace/ws-target/allSessions',
      windowManager,
      {
        sink,
        preferredClientId: 'client-caller',
      },
    )

    expect(sent.length).toBe(1)
    expect(sent[0]?.target).toEqual({ to: 'client', clientId: 'client-caller' })
  })

  it('falls back to workspace routing when resolver exists but target client is unresolved', async () => {
    const targetWindow = createMockWindow(44)

    const windowManager = {
      focusOrCreateWindow: () => targetWindow,
      getFocusedWindow: () => targetWindow,
      getLastActiveWindow: () => targetWindow,
      getWorkspaceForWindow: () => 'ws-target',
    } as unknown as WindowManager

    const sent: Array<{ channel: string; target: unknown; args: unknown[] }> = []
    const sink: EventSink = (channel, target, ...args) => {
      sent.push({ channel, target, args })
    }

    await handleDeepLink(
      'mdp://workspace/ws-target/allSessions',
      windowManager,
      {
        sink,
        resolveClientId: () => undefined,
        preferredClientId: 'client-caller',
      },
    )

    expect(sent.length).toBe(1)
    expect(sent[0]?.target).toEqual({ to: 'workspace', workspaceId: 'ws-target' })
  })

  it('routes sso-callback links to the main-process callback handler', async () => {
    const targetWindow = createMockWindow(55)

    const windowManager = {
      getFocusedWindow: () => targetWindow,
      getLastActiveWindow: () => targetWindow,
      getWorkspaceForWindow: () => 'ws-target',
    } as unknown as WindowManager

    const sent: Array<{ channel: string; target: unknown; args: unknown[] }> = []
    const sink: EventSink = (channel, target, ...args) => {
      sent.push({ channel, target, args })
    }
    const callbacks: Array<{ code: string; state?: string }> = []

    const result = await handleDeepLink(
      'mdp://sso-callback?code=abc123&state=nonce123',
      windowManager,
      {
        sink,
        resolveClientId: (wcId) => wcId === 55 ? 'client-target' : undefined,
        handleSsoCallback: async (code, state) => {
          callbacks.push({ code, state })
          return { success: true }
        },
      },
    )

    expect(result.success).toBe(true)
    expect(callbacks).toEqual([{ code: 'abc123', state: 'nonce123' }])
    expect(sent).toEqual([
      {
        channel: RPC_CHANNELS.sso.LOGIN_RESULT,
        target: { to: 'client', clientId: 'client-target' },
        args: [{ success: true }],
      },
    ])
  })
})
