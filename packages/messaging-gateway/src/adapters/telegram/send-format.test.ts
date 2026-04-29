import { describe, expect, it } from 'bun:test'
import { TelegramAdapter } from './index'

function makeAdapterWithApi(api: Record<string, (...args: unknown[]) => Promise<unknown>>): TelegramAdapter {
  const adapter = new TelegramAdapter()
  ;(adapter as unknown as { bot: { api: typeof api } }).bot = { api }
  return adapter
}

describe('TelegramAdapter outbound formatting', () => {
  it('sendText keeps plain text plain by default', async () => {
    const calls: unknown[][] = []
    const adapter = makeAdapterWithApi({
      sendMessage: async (...args) => {
        calls.push(args)
        return { message_id: 42 }
      },
    })

    const sent = await adapter.sendText('123', '<b>bold</b>')

    expect(calls).toEqual([[123, '<b>bold</b>']])
    expect(sent).toEqual({ platform: 'telegram', channelId: '123', messageId: '42' })
  })

  it('sendText uses parse_mode HTML only when explicitly requested', async () => {
    const calls: unknown[][] = []
    const adapter = makeAdapterWithApi({
      sendMessage: async (...args) => {
        calls.push(args)
        return { message_id: 43 }
      },
    })

    await adapter.sendText('123', '<b>bold</b>', { format: 'html' })

    expect(calls).toEqual([[123, '<b>bold</b>', { parse_mode: 'HTML' }]])
  })

  it('editMessage forwards explicit HTML format', async () => {
    const calls: unknown[][] = []
    const adapter = makeAdapterWithApi({
      editMessageText: async (...args) => {
        calls.push(args)
      },
    })

    await adapter.editMessage('123', '77', '<i>italic</i>', { format: 'html' })

    expect(calls).toEqual([[123, 77, '<i>italic</i>', { parse_mode: 'HTML' }]])
  })

  it('sendButtons preserves inline keyboard and optional HTML format', async () => {
    const calls: unknown[][] = []
    const adapter = makeAdapterWithApi({
      sendMessage: async (...args) => {
        calls.push(args)
        return { message_id: 7 }
      },
    })

    await adapter.sendButtons('123', '<b>Plan</b>', [{ id: 'accept', label: 'Accept' }], { format: 'html' })

    expect(calls).toEqual([[
      123,
      '<b>Plan</b>',
      {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [[{ text: 'Accept', callback_data: 'accept' }]],
        },
      },
    ]])
  })

  it('sendFile keeps captions plain by default and formats explicitly when requested', async () => {
    const calls: unknown[][] = []
    const adapter = makeAdapterWithApi({
      sendDocument: async (...args) => {
        calls.push(args)
        return { message_id: 8 }
      },
    })

    await adapter.sendFile('123', Buffer.from('hello'), 'note.txt', '<b>plain</b>')
    await adapter.sendFile('123', Buffer.from('hello'), 'note.txt', '<b>html</b>', { format: 'html' })

    expect(calls).toHaveLength(2)
    expect(calls[0]?.[2]).toEqual({ caption: '<b>plain</b>' })
    expect(calls[1]?.[2]).toEqual({
      caption: '<b>html</b>',
      parse_mode: 'HTML',
    })
  })
})
