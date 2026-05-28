import { describe, it, expect } from 'bun:test'

import { Renderer, type SessionEvent } from '../renderer'
import {
  DEFAULT_BINDING_CONFIG,
  type ChannelBinding,
  type PlatformAdapter,
  type AdapterCapabilities,
  type SentMessage,
  type SendOptions,
} from '../types'

interface Send {
  text: string
}

function makeWechatAdapter(): PlatformAdapter & { sends: Send[] } {
  const sends: Send[] = []
  let nextId = 1
  const caps: AdapterCapabilities = {
    messageEditing: false,
    inlineButtons: false,
    maxButtons: 0,
    maxMessageLength: 4000,
    markdown: 'wechat',
    webhookSupport: false,
  }
  return {
    platform: 'wechat',
    capabilities: caps,
    sends,
    async initialize() {},
    async destroy() {},
    isConnected() {
      return true
    },
    onMessage() {},
    onButtonPress() {},
    async sendText(channelId: string, text: string, _opts?: SendOptions): Promise<SentMessage> {
      sends.push({ text })
      return { platform: 'wechat', channelId, messageId: String(nextId++) }
    },
    async editMessage() {},
    async sendButtons(channelId: string): Promise<SentMessage> {
      return { platform: 'wechat', channelId, messageId: String(nextId++) }
    },
    async sendTyping() {},
    async sendFile(channelId: string): Promise<SentMessage> {
      return { platform: 'wechat', channelId, messageId: String(nextId++) }
    },
  }
}

function wechatBinding(): ChannelBinding {
  return {
    id: 'bind-wx',
    workspaceId: 'ws-1',
    sessionId: 'sess-1',
    platform: 'wechat',
    channelId: 'u1@im.wechat',
    enabled: true,
    createdAt: Date.now(),
    config: { ...DEFAULT_BINDING_CONFIG, responseMode: 'progress' },
  }
}

const ev = {
  intermediate: (text: string): SessionEvent => ({
    type: 'text_complete',
    sessionId: 's',
    text,
    isIntermediate: true,
  }),
  final: (text: string): SessionEvent => ({
    type: 'text_complete',
    sessionId: 's',
    text,
    isIntermediate: false,
  }),
  toolStart: (name: string): SessionEvent => ({
    type: 'tool_start',
    sessionId: 's',
    toolName: name,
    toolDisplayName: name,
  }),
  toolResult: (): SessionEvent => ({ type: 'tool_result', sessionId: 's' }),
  complete: (): SessionEvent => ({ type: 'complete', sessionId: 's' }),
}

async function play(
  r: Renderer,
  b: ChannelBinding,
  a: PlatformAdapter,
  events: SessionEvent[],
): Promise<void> {
  for (const e of events) await r.handle(e, b, a)
}

// The renderer stays silent for WeChat during processing — it sends only the
// final answer (one FINISH) on `complete`. Holding the turn open during slow
// runs is the WeChatAdapter's job (an inbound-driven keep-alive timer), not the
// renderer's, so the renderer must never emit progress/keep-alive sends here.
describe('WeChat renderer is silent until the final answer', () => {
  it('fast no-tool reply sends exactly one FINISH', async () => {
    const a = makeWechatAdapter()
    await play(new Renderer(), wechatBinding(), a, [ev.final('hello'), ev.complete()])
    expect(a.sends).toEqual([{ text: 'hello' }])
  })

  it('reply with tool events still sends only the final FINISH (no renderer keep-alive)', async () => {
    const a = makeWechatAdapter()
    await play(new Renderer(), wechatBinding(), a, [
      ev.toolStart('web_search'),
      ev.toolResult(),
      ev.final('今日要闻…'),
      ev.complete(),
    ])
    expect(a.sends).toEqual([{ text: '今日要闻…' }])
  })

  it('intermediate text before the final does not produce extra sends', async () => {
    const a = makeWechatAdapter()
    await play(new Renderer(), wechatBinding(), a, [
      ev.intermediate('let me check'),
      ev.toolStart('web_search'),
      ev.final('done'),
      ev.complete(),
    ])
    expect(a.sends).toEqual([{ text: 'done' }])
  })
})
