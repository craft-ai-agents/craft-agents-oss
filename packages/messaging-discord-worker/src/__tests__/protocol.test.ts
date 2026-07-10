import { describe, it, expect } from 'bun:test'
import {
  encodeMessage,
  parseFrames,
  type WorkerCommand,
  type WorkerEvent,
} from '../protocol'

describe('discord worker protocol', () => {
  it('round-trips every command through encode → parse', () => {
    const commands: WorkerCommand[] = [
      { type: 'start', token: 'abc.def.ghi' },
      { id: '1', type: 'send_text', channelId: 'c1', text: 'hello' },
      { id: '2', type: 'edit_message', channelId: 'c1', messageId: 'm1', text: 'edited' },
      {
        id: '3',
        type: 'send_buttons',
        channelId: 'c1',
        text: 'approve?',
        buttons: [
          { id: 'yes', label: 'Yes' },
          { id: 'no', label: 'No', data: 'payload' },
        ],
      },
      {
        id: '4',
        type: 'send_file',
        channelId: 'c1',
        dataBase64: 'ZGF0YQ==',
        filename: 'a.txt',
        caption: 'cap',
      },
      { type: 'send_typing', channelId: 'c1' },
      { id: '5', type: 'clear_buttons', channelId: 'c1', messageId: 'm1' },
      { type: 'shutdown' },
    ]

    const stream = commands.map(encodeMessage).join('')
    const { messages, rest } = parseFrames<WorkerCommand>(stream)
    expect(rest).toBe('')
    expect(messages).toEqual(commands)
  })

  it('round-trips every event through encode → parse', () => {
    const events: WorkerEvent[] = [
      { type: 'ready', discordJsVersion: '14.16.0', buildId: 'b', gitSha: 'sha' },
      { type: 'connected', botId: 'bot1', username: 'craft-bot' },
      { type: 'disconnected', loggedOut: true, reason: 'invalid token' },
      {
        type: 'incoming',
        channelId: 'c1',
        messageId: 'm1',
        senderId: 'u1',
        senderName: 'Alice',
        senderIsBot: false,
        text: 'hi',
        isDM: true,
        mentionedBot: false,
        attachments: [
          { type: 'document', fileName: 'a.pdf', mimeType: 'application/pdf', fileSize: 10, localPath: '/tmp/a.pdf' },
        ],
        timestamp: 123,
      },
      {
        type: 'button_press',
        channelId: 'c1',
        messageId: 'm1',
        senderId: 'u1',
        senderName: 'Alice',
        buttonId: 'yes',
        data: 'x',
      },
      { type: 'send_result', id: '1', ok: true, messageId: 'm2' },
      { type: 'send_result', id: '2', ok: false, error: 'boom' },
      { type: 'error', message: 'non-fatal' },
      { type: 'unavailable', reason: 'disallowed_intents', message: 'enable intent' },
    ]

    const stream = events.map(encodeMessage).join('')
    const { messages, rest } = parseFrames<WorkerEvent>(stream)
    expect(rest).toBe('')
    expect(messages).toEqual(events)
  })

  it('buffers a partial trailing frame', () => {
    const full = encodeMessage({ type: 'shutdown' })
    const partial = '{"type":"start","tok'
    const { messages, rest } = parseFrames<WorkerCommand>(full + partial)
    expect(messages).toEqual([{ type: 'shutdown' }])
    expect(rest).toBe(partial)
  })

  it('skips malformed lines without dropping valid ones', () => {
    const stream = 'not json\n' + encodeMessage({ type: 'shutdown' })
    const { messages } = parseFrames<WorkerCommand>(stream)
    expect(messages).toEqual([{ type: 'shutdown' }])
  })
})
