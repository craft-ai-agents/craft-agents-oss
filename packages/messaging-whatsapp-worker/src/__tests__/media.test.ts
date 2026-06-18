import { describe, test, expect } from 'bun:test'
import { readFileSync, statSync, unlinkSync } from 'node:fs'
import { Buffer } from 'node:buffer'
import { extractAttachments, MAX_ATTACHMENT_BYTES } from '../media'
import type { BaileysModule } from '../worker'

// ---------------------------------------------------------------------------
// Fake BaileysModule — only `downloadMediaMessage` is exercised here.
// ---------------------------------------------------------------------------

interface DownloadCall {
  message: unknown
  type: string
  options: Record<string, unknown>
}

function makeBaileys(downloader: () => Promise<Buffer> | Buffer): {
  baileys: BaileysModule
  calls: DownloadCall[]
} {
  const calls: DownloadCall[] = []
  const baileys = {
    downloadMediaMessage: async (
      message: unknown,
      type: 'buffer',
      options: Record<string, unknown>,
    ) => {
      calls.push({ message, type, options })
      return downloader()
    },
  } as unknown as BaileysModule
  return { baileys, calls }
}

const noopLog = (..._args: unknown[]): void => {}

function cleanup(paths: string[]): void {
  for (const p of paths) {
    try {
      unlinkSync(p)
    } catch {
      // ignore
    }
  }
}

// ---------------------------------------------------------------------------

describe('extractAttachments', () => {
  test('audioMessage with ptt=true is classified as voice', async () => {
    const buf = Buffer.from('voice-bytes')
    const { baileys, calls } = makeBaileys(() => buf)
    const msg = {
      message: {
        audioMessage: { ptt: true, mimetype: 'audio/ogg', fileLength: buf.byteLength },
      },
    }
    const out = await extractAttachments(baileys, msg, noopLog)

    expect(calls.length).toBe(1)
    expect(out.length).toBe(1)
    const [att] = out
    expect(att?.type).toBe('voice')
    expect(att?.mimeType).toBe('audio/ogg')
    expect(att?.fileSize).toBe(buf.byteLength)
    expect(att?.localPath).toBeTruthy()
    expect(readFileSync(att!.localPath).equals(buf)).toBe(true)
    cleanup([att!.localPath])
  })

  test('audioMessage without ptt is classified as audio', async () => {
    const buf = Buffer.from('music-bytes')
    const { baileys } = makeBaileys(() => buf)
    const msg = {
      message: {
        audioMessage: { ptt: false, mimetype: 'audio/mpeg', fileLength: buf.byteLength },
      },
    }
    const out = await extractAttachments(baileys, msg, noopLog)

    expect(out.length).toBe(1)
    expect(out[0]?.type).toBe('audio')
    expect(out[0]?.mimeType).toBe('audio/mpeg')
    cleanup(out.map((a) => a.localPath))
  })

  test('imageMessage uses photo type and image/jpeg default', async () => {
    const buf = Buffer.from('image-bytes')
    const { baileys } = makeBaileys(() => buf)
    const msg = { message: { imageMessage: { fileLength: buf.byteLength } } }

    const out = await extractAttachments(baileys, msg, noopLog)

    expect(out.length).toBe(1)
    expect(out[0]?.type).toBe('photo')
    expect(out[0]?.mimeType).toBe('image/jpeg')
    cleanup(out.map((a) => a.localPath))
  })

  test('multiple media variants are extracted in order', async () => {
    const buf = Buffer.from('payload')
    const { baileys, calls } = makeBaileys(() => buf)
    const msg = {
      message: {
        imageMessage: { fileLength: buf.byteLength },
        documentMessage: {
          mimetype: 'application/pdf',
          fileName: 'doc.pdf',
          fileLength: buf.byteLength,
        },
      },
    }

    const out = await extractAttachments(baileys, msg, noopLog)

    expect(calls.length).toBe(2)
    expect(out.map((a) => a.type)).toEqual(['photo', 'document'])
    expect(out[1]?.fileName).toBe('doc.pdf')
    cleanup(out.map((a) => a.localPath))
  })

  test('declared size over cap skips download', async () => {
    let downloaded = false
    const { baileys } = makeBaileys(() => {
      downloaded = true
      return Buffer.alloc(0)
    })
    const msg = {
      message: {
        videoMessage: {
          mimetype: 'video/mp4',
          fileLength: MAX_ATTACHMENT_BYTES + 1,
        },
      },
    }

    const out = await extractAttachments(baileys, msg, noopLog)

    expect(downloaded).toBe(false)
    expect(out.length).toBe(0)
  })

  test('downloader throwing skips the variant but does not bubble', async () => {
    const { baileys } = makeBaileys(() => {
      throw new Error('boom')
    })
    const msg = { message: { audioMessage: { ptt: true, fileLength: 100 } } }

    const out = await extractAttachments(baileys, msg, noopLog)

    expect(out.length).toBe(0)
  })

  test('post-download buffer over cap is skipped', async () => {
    // Caller declared size under cap, but the actual buffer is larger —
    // the post-download guard kicks in.
    const oversized = Buffer.alloc(MAX_ATTACHMENT_BYTES + 1)
    const { baileys } = makeBaileys(() => oversized)
    const msg = { message: { audioMessage: { ptt: true, fileLength: 100 } } }

    const out = await extractAttachments(baileys, msg, noopLog)

    expect(out.length).toBe(0)
  })

  test('messages with no media payload return empty array', async () => {
    let downloaded = false
    const { baileys } = makeBaileys(() => {
      downloaded = true
      return Buffer.alloc(0)
    })
    const msg = { message: { conversation: 'just text' } }

    const out = await extractAttachments(baileys, msg, noopLog)

    expect(downloaded).toBe(false)
    expect(out.length).toBe(0)
  })

  test('written file size matches declared fileSize', async () => {
    const buf = Buffer.from('exact-size-test-payload')
    const { baileys } = makeBaileys(() => buf)
    const msg = {
      message: {
        audioMessage: { ptt: true, mimetype: 'audio/ogg', fileLength: buf.byteLength },
      },
    }

    const out = await extractAttachments(baileys, msg, noopLog)
    expect(out.length).toBe(1)
    const stat = statSync(out[0]!.localPath)
    expect(stat.size).toBe(buf.byteLength)
    cleanup(out.map((a) => a.localPath))
  })
})
