import { describe, test, expect } from 'bun:test'
import { Buffer } from 'node:buffer'
import { unlinkSync } from 'node:fs'
import { processUpsertMessage, type UpsertSession } from '../upsert'
import type { BaileysModule } from '../worker'
import type { IncomingEvent } from '../protocol'

const SELF_BARE = '3612345678@s.whatsapp.net'

interface CapturedEmit {
  events: IncomingEvent[]
  emit: (event: IncomingEvent) => void
}

function captureEmit(): CapturedEmit {
  const events: IncomingEvent[] = []
  return {
    events,
    emit: (event) => events.push(event),
  }
}

const noopLog = (..._args: unknown[]): void => {}

interface SessionOpts {
  baileys?: BaileysModule
  selfChatMode?: boolean
  responsePrefix?: string
  sentIds?: Set<string>
}

function makeSession(opts: SessionOpts = {}): UpsertSession {
  return {
    selfChatMode: opts.selfChatMode ?? false,
    responsePrefix: opts.responsePrefix ?? '🤖',
    sentIds: opts.sentIds ?? new Set<string>(),
    baileys:
      opts.baileys ??
      ({
        downloadMediaMessage: async () => Buffer.alloc(0),
      } as unknown as BaileysModule),
  }
}

function makeBaileys(buffer: Buffer): BaileysModule {
  return {
    downloadMediaMessage: async () => buffer,
  } as unknown as BaileysModule
}

function cleanup(events: IncomingEvent[]): void {
  for (const ev of events) {
    for (const a of ev.attachments ?? []) {
      try {
        unlinkSync(a.localPath)
      } catch {
        // ignore
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Regression for #719: voice note with empty text must still emit.
// ---------------------------------------------------------------------------

describe('processUpsertMessage', () => {
  test('voice note with empty caption still emits with attachments', async () => {
    const buf = Buffer.from('voice-bytes')
    const session = makeSession({ baileys: makeBaileys(buf) })
    const { events, emit } = captureEmit()

    const msg = {
      key: { id: 'MID1', remoteJid: SELF_BARE, fromMe: false },
      messageTimestamp: Math.floor(Date.now() / 1000),
      message: {
        audioMessage: { ptt: true, mimetype: 'audio/ogg', fileLength: buf.byteLength },
      },
    }

    await processUpsertMessage(
      msg,
      { cutoff: 0, selfJid: SELF_BARE, selfLid: null },
      session,
      emit,
      noopLog,
    )

    expect(events.length).toBe(1)
    const [ev] = events
    expect(ev?.text).toBe('')
    expect(ev?.attachments?.length).toBe(1)
    expect(ev?.attachments?.[0]?.type).toBe('voice')
    cleanup(events)
  })

  test('empty text + no media is still skipped', async () => {
    const session = makeSession()
    const { events, emit } = captureEmit()

    const msg = {
      key: { id: 'MID2', remoteJid: SELF_BARE, fromMe: false },
      messageTimestamp: Math.floor(Date.now() / 1000),
      message: {}, // no caption, no media
    }

    await processUpsertMessage(
      msg,
      { cutoff: 0, selfJid: SELF_BARE, selfLid: null },
      session,
      emit,
      noopLog,
    )

    expect(events.length).toBe(0)
  })

  test('own_outbound (fromMe outside self-chat) is NOT overridden by media', async () => {
    // Even with media attached, an outbound message from the user's other
    // device to a non-self chat must still be skipped — the 'empty' override
    // applies only to `empty`, never to `own_outbound`.
    const buf = Buffer.from('image-bytes')
    let downloadedAttempted = false
    const baileys = {
      downloadMediaMessage: async () => {
        downloadedAttempted = true
        return buf
      },
    } as unknown as BaileysModule

    const session = makeSession({ selfChatMode: true, baileys })
    const { events, emit } = captureEmit()

    const msg = {
      key: { id: 'MID3', remoteJid: '4412345678@s.whatsapp.net', fromMe: true },
      messageTimestamp: Math.floor(Date.now() / 1000),
      message: { imageMessage: { fileLength: buf.byteLength } },
    }

    await processUpsertMessage(
      msg,
      { cutoff: 0, selfJid: SELF_BARE, selfLid: null },
      session,
      emit,
      noopLog,
    )

    expect(events.length).toBe(0)
    // Defensive: no media download attempted for skipped messages, no temp file leak.
    expect(downloadedAttempted).toBe(false)
  })

  test('history-cutoff messages are skipped silently', async () => {
    const session = makeSession()
    const { events, emit } = captureEmit()

    const msg = {
      key: { id: 'OLD', remoteJid: SELF_BARE, fromMe: false },
      messageTimestamp: 1000, // way before cutoff
      message: { conversation: 'old text' },
    }

    await processUpsertMessage(
      msg,
      { cutoff: 9_999_999_999, selfJid: SELF_BARE, selfLid: null },
      session,
      emit,
      noopLog,
    )

    expect(events.length).toBe(0)
  })

  test('text + media → emit with both text and attachments', async () => {
    const buf = Buffer.from('img')
    const session = makeSession({ baileys: makeBaileys(buf) })
    const { events, emit } = captureEmit()

    const msg = {
      key: { id: 'MID4', remoteJid: SELF_BARE, fromMe: false },
      messageTimestamp: Math.floor(Date.now() / 1000),
      message: {
        imageMessage: { caption: 'hello', fileLength: buf.byteLength },
      },
    }

    await processUpsertMessage(
      msg,
      { cutoff: 0, selfJid: SELF_BARE, selfLid: null },
      session,
      emit,
      noopLog,
    )

    expect(events.length).toBe(1)
    expect(events[0]?.text).toBe('hello')
    expect(events[0]?.attachments?.length).toBe(1)
    cleanup(events)
  })
})
