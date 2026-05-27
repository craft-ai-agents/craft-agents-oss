import { afterEach, describe, expect, it, mock } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { CONCIERGE_SLUG } from '@craft-agent/shared/agent-definitions/types'
import { MessagingGatewayRegistry } from '../registry'
import type { IncomingMessage, PlatformAdapter, SentMessage } from '../types'

const tempDirs: string[] = []

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function makeRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'registry-home-'))
  tempDirs.push(dir)
  return dir
}

function makeSessionManager() {
  const workspaces = [
    { id: 'home', name: 'Home', rootPath: '/tmp/home' },
    { id: 'target', name: 'Target Space', rootPath: '/tmp/target' },
  ]
  return {
    getWorkspaces: mock(() => workspaces),
    resolveAgentSessionOptions: mock(async () => ({ model: 'gpt-test' })),
    createSession: mock(async (workspaceId: string, options: { name?: string }) => ({
      id: 'sess-new',
      workspaceId,
      workspaceName: workspaceId,
      name: options.name,
      messages: [],
      isProcessing: false,
      lastMessageAt: Date.now(),
    })),
    sendMessage: mock(async () => {}),
  }
}

function makeRegistry(root: string, sessionManager = makeSessionManager()) {
  return {
    sessionManager,
    registry: new MessagingGatewayRegistry({
      sessionManager: sessionManager as any,
      credentialManager: {} as any,
      getMessagingDir: (workspaceId) => join(root, workspaceId, 'messaging'),
    }),
  }
}

function makeAdapter(): PlatformAdapter & { sent: string[] } {
  const sent: string[] = []
  const noop = async () => {}
  return {
    platform: 'whatsapp',
    capabilities: {
      messageEditing: false,
      inlineButtons: false,
      maxButtons: 0,
      maxMessageLength: 4096,
      markdown: 'whatsapp',
      webhookSupport: false,
    },
    sent,
    async initialize() {},
    async destroy() {},
    isConnected() { return true },
    onMessage() {},
    onButtonPress() {},
    async sendText(_channelId: string, text: string): Promise<SentMessage> {
      sent.push(text)
      return { platform: 'whatsapp', channelId: 'chat-1', messageId: String(sent.length) }
    },
    editMessage: noop,
    sendButtons: async (_channelId, text) => {
      sent.push(text)
      return { platform: 'whatsapp', channelId: 'chat-1', messageId: String(sent.length) }
    },
    sendTyping: noop,
    async sendFile(): Promise<SentMessage> {
      return { platform: 'whatsapp', channelId: 'chat-1', messageId: String(sent.length + 1) }
    },
  }
}

function makeMessage(text: string): IncomingMessage {
  return {
    platform: 'whatsapp',
    channelId: 'chat-1',
    messageId: 'msg-1',
    senderId: 'sender-1',
    senderName: 'Mikey',
    text,
    timestamp: Date.now(),
    raw: {},
  }
}

describe('MessagingGatewayRegistry WhatsApp Home Gateway', () => {
  it('blocks Home Gateway workspace commands when WhatsApp self-chat mode is disabled', async () => {
    const root = makeRoot()
    const { registry } = makeRegistry(root)
    registry.getConfig('home')
    await registry.updateConfig('home', {
      enabled: true,
      platforms: { whatsapp: { enabled: true, selfChatMode: false } },
    } as any)
    const adapter = makeAdapter()

    const handled = await (registry as any).handleWhatsAppHomeMessage(
      'home',
      adapter,
      makeMessage('/workspaces'),
      false,
    )

    expect(handled).toBe(true)
    expect(adapter.sent.at(-1)).toContain('self-chat mode')
  })

  it('creates and binds an HNIC session in the selected workspace from an unbound WhatsApp message', async () => {
    const root = makeRoot()
    const { registry, sessionManager } = makeRegistry(root)
    registry.getConfig('home')
    const adapter = makeAdapter()

    await (registry as any).handleWhatsAppUseWorkspace('home', adapter, makeMessage('/use target'))
    const handled = await (registry as any).handleWhatsAppHomeMessage(
      'home',
      adapter,
      makeMessage('start here'),
      false,
    )

    const homeState = (registry as any).workspaces.get('home')
    const binding = homeState.gateway.getBindingStore().findByChannel('whatsapp', 'chat-1')

    expect(handled).toBe(true)
    expect(sessionManager.resolveAgentSessionOptions).toHaveBeenCalledWith('target', CONCIERGE_SLUG)
    expect(sessionManager.createSession).toHaveBeenCalled()
    expect(sessionManager.sendMessage).toHaveBeenCalledWith(
      'sess-new',
      'start here',
      undefined,
      undefined,
      undefined,
    )
    expect(binding?.workspaceId).toBe('target')
    expect(binding?.sessionId).toBe('sess-new')
  })

  it('lists cross-workspace WhatsApp bindings from the target workspace view', () => {
    const root = makeRoot()
    const { registry } = makeRegistry(root)
    registry.getConfig('home')

    const homeState = (registry as any).workspaces.get('home')
    const binding = homeState.gateway.getBindingStore().bind('target', 'sess-1', 'whatsapp', 'chat-1', 'Mikey')

    expect(registry.getBindings('target')).toEqual([
      expect.objectContaining({
        id: binding.id,
        workspaceId: 'target',
        sessionId: 'sess-1',
        platform: 'whatsapp',
        channelId: 'chat-1',
      }),
    ])
  })

  it('unbinds cross-workspace WhatsApp bindings by id from the target workspace view', () => {
    const root = makeRoot()
    const { registry } = makeRegistry(root)
    registry.getConfig('home')

    const homeState = (registry as any).workspaces.get('home')
    const binding = homeState.gateway.getBindingStore().bind('target', 'sess-1', 'whatsapp', 'chat-1', 'Mikey')

    expect(registry.unbindBinding('target', binding.id)).toBe(true)

    expect(homeState.gateway.getBindingStore().findByChannel('whatsapp', 'chat-1')).toBeUndefined()
    expect(registry.getBindings('target')).toEqual([])
  })

  it('removes cross-workspace WhatsApp bindings when the target session is unbound', () => {
    const root = makeRoot()
    const { registry } = makeRegistry(root)
    registry.getConfig('home')

    const homeState = (registry as any).workspaces.get('home')
    homeState.gateway.getBindingStore().bind('target', 'sess-1', 'whatsapp', 'chat-1', 'Mikey')

    registry.unbindSession('target', 'sess-1', 'whatsapp')

    expect(homeState.gateway.getBindingStore().findByChannel('whatsapp', 'chat-1')).toBeUndefined()
  })
})
