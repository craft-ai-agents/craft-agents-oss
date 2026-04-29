import { describe, expect, it } from 'bun:test'
import { TelegramAdapter } from './index'

function makeAdapterWithApi(api: Record<string, (...args: unknown[]) => Promise<unknown>>): TelegramAdapter {
  const adapter = new TelegramAdapter()
  ;(adapter as unknown as { bot: { api: typeof api } }).bot = { api }
  return adapter
}

describe('TelegramAdapter outbound formatting', () => {
  it('sendText formats content and passes HTML parse_mode', async () => {
    const calls: unknown[][] = []
    const adapter = makeAdapterWithApi({
      sendMessage: async (...args) => {
        calls.push(args)
        return { message_id: 42 }
      },
    })

    const sent = await adapter.sendText('123', '**bold**')

    expect(calls).toEqual([[123, '<b>bold</b>', { parse_mode: 'HTML' }]])
    expect(sent).toEqual({ platform: 'telegram', channelId: '123', messageId: '42' })
  })

  it('editMessage formats content and passes HTML parse_mode', async () => {
    const calls: unknown[][] = []
    const adapter = makeAdapterWithApi({
      editMessageText: async (...args) => {
        calls.push(args)
      },
    })

    await adapter.editMessage('123', '77', '*italic*')

    expect(calls).toEqual([[123, 77, '<i>italic</i>', { parse_mode: 'HTML' }]])
  })

  it('sendButtons formats content and keeps the inline keyboard', async () => {
    const calls: unknown[][] = []
    const adapter = makeAdapterWithApi({
      sendMessage: async (...args) => {
        calls.push(args)
        return { message_id: 7 }
      },
    })

    await adapter.sendButtons('123', '# Plan', [{ id: 'accept', label: 'Accept' }])

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

  it('sendFile formats caption and passes HTML parse_mode', async () => {
    const calls: unknown[][] = []
    const adapter = makeAdapterWithApi({
      sendDocument: async (...args) => {
        calls.push(args)
        return { message_id: 8 }
      },
    })

    await adapter.sendFile('123', Buffer.from('hello'), 'note.txt', '**caption**')

    expect(calls).toHaveLength(1)
    expect(calls[0]?.[0]).toBe(123)
    expect(calls[0]?.[2]).toEqual({
      caption: '<b>caption</b>',
      parse_mode: 'HTML',
    })
  })
})
