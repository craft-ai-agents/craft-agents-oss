import { describe, it, expect, afterEach } from 'bun:test'

import { sendMessage } from '../adapters/wechat/ilink/api/api'
import { sendMessageWeixin } from '../adapters/wechat/ilink/messaging/send'
import { MessageType, MessageState } from '../adapters/wechat/ilink/api/types'
import type { SendMessageReq } from '../adapters/wechat/ilink/api/types'

const realFetch = globalThis.fetch

/** Captures the parsed request body of the most recent stubbed fetch. */
let lastRequestBody: { msg?: { message_state?: number; client_id?: string } } | null = null

/** Replace global fetch with a stub returning a fixed HTTP status + body. */
function stubFetch(status: number, body: string): void {
  lastRequestBody = null
  globalThis.fetch = (async (_url: string, init?: { body?: string }) => {
    lastRequestBody = init?.body ? JSON.parse(init.body) : null
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => body,
    }
  }) as unknown as typeof fetch
}

const req: { body: SendMessageReq } = {
  body: {
    msg: {
      from_user_id: '',
      to_user_id: 'u1',
      client_id: 'c1',
      message_type: MessageType.BOT,
      message_state: MessageState.FINISH,
      item_list: [{ type: 1, text_item: { text: 'hi' } }],
    },
  },
}

const opts = { baseUrl: 'https://x.example', token: 'tok', ...req }

afterEach(() => {
  globalThis.fetch = realFetch
})

describe('sendMessage server-rejection handling', () => {
  it('throws when the server rejects with a non-zero ret on an HTTP 200 body', async () => {
    // iLink returns 200 + {ret:-14} when the session/context expired; the user
    // sees WeChat's "请稍后再试。" fallback. This must surface, not silently pass.
    stubFetch(200, JSON.stringify({ ret: -14, errmsg: 'session timeout' }))
    await expect(sendMessage(opts)).rejects.toThrow(/ret=-14/)
  })

  it('throws when the server rejects with a non-zero errcode', async () => {
    stubFetch(200, JSON.stringify({ errcode: 1001, errmsg: 'bad token' }))
    await expect(sendMessage(opts)).rejects.toThrow(/errcode=1001/)
  })

  it('resolves on an empty success body', async () => {
    stubFetch(200, '')
    await expect(sendMessage(opts)).resolves.toBeUndefined()
  })

  it('resolves on an explicit ret:0 success body', async () => {
    stubFetch(200, JSON.stringify({ ret: 0 }))
    await expect(sendMessage(opts)).resolves.toBeUndefined()
  })

  it('resolves (treats as success) on a non-JSON body', async () => {
    stubFetch(200, 'OK')
    await expect(sendMessage(opts)).resolves.toBeUndefined()
  })
})

describe('sendMessageWeixin', () => {
  const sendOpts = { baseUrl: 'https://x.example', token: 'tok', contextToken: 'ctx' }

  it('sends a single FINISH text message with a generated client_id', async () => {
    stubFetch(200, '')
    await sendMessageWeixin({ to: 'u1', text: 'hi', opts: sendOpts })
    expect(lastRequestBody?.msg?.message_state).toBe(MessageState.FINISH)
    expect(lastRequestBody?.msg?.client_id).toBeTruthy()
  })
})
