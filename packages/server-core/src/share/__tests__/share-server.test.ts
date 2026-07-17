import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { startShareHttpServer } from '../share-server'
import { HashShareStore, generateShareId, isSafeShareId } from '../store'

const TEMP_DIRS: string[] = []
const SERVERS: Array<{ stop: () => void }> = []

const logger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} } as any

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  TEMP_DIRS.push(dir)
  return dir
}

/** A built-viewer dir with a recognisable index.html for SPA-fallback assertions. */
function viewerDir(): string {
  const dir = tempDir('craft-share-viewer-')
  writeFileSync(join(dir, 'index.html'), '<!doctype html><html><body>viewer</body></html>')
  return dir
}

async function startServer(overrides?: {
  basicAuth?: { user: string; pass: string }
  maxBodyBytes?: number
}): Promise<{ base: string; storeDir: string }> {
  const storeDir = tempDir('craft-share-store-')
  const server = await startShareHttpServer({
    port: 0,
    host: '127.0.0.1',
    viewerDir: viewerDir(),
    store: new HashShareStore(storeDir),
    maxBodyBytes: overrides?.maxBodyBytes ?? 1_000_000,
    basicAuth: overrides?.basicAuth,
    logger,
  })
  SERVERS.push(server)
  return { base: `http://127.0.0.1:${server.port}`, storeDir }
}

const SAMPLE = { id: 'my-session', messages: [{ role: 'user', text: 'hi' }] }

afterEach(() => {
  while (SERVERS.length) SERVERS.pop()!.stop()
  while (TEMP_DIRS.length) rmSync(TEMP_DIRS.pop()!, { recursive: true, force: true })
})

describe('share id helpers', () => {
  it('generates 21-char url-safe ids', () => {
    const id = generateShareId()
    expect(id).toHaveLength(21)
    expect(isSafeShareId(id)).toBe(true)
  })

  it('rejects path-traversal and unsafe ids', () => {
    expect(isSafeShareId('../etc/passwd')).toBe(false)
    expect(isSafeShareId('a/b')).toBe(false)
    expect(isSafeShareId('has space')).toBe(false)
    expect(isSafeShareId('')).toBe(false)
    expect(isSafeShareId('ok_id-123')).toBe(true)
  })
})

describe('share server — hash mode CRUD', () => {
  it('POST creates a share and returns { id, url }', async () => {
    const { base } = await startServer()
    const res = await fetch(`${base}/s/api`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(SAMPLE),
    })
    expect(res.status).toBe(200)
    const body = await res.json() as { id: string; url: string }
    expect(isSafeShareId(body.id)).toBe(true)
    expect(body.url).toBe(`${base}/s/${body.id}`)
  })

  it('round-trips create → get → update → revoke', async () => {
    const { base } = await startServer()
    const { id } = await (await fetch(`${base}/s/api`, {
      method: 'POST', body: JSON.stringify(SAMPLE),
    })).json() as { id: string }

    // GET returns the stored session
    const got = await fetch(`${base}/s/api/${id}`)
    expect(got.status).toBe(200)
    expect(await got.json()).toEqual(SAMPLE)

    // PUT updates it
    const updated = { ...SAMPLE, messages: [...SAMPLE.messages, { role: 'assistant', text: 'yo' }] }
    const put = await fetch(`${base}/s/api/${id}`, { method: 'PUT', body: JSON.stringify(updated) })
    expect(put.status).toBe(204)
    expect(await (await fetch(`${base}/s/api/${id}`)).json()).toEqual(updated)

    // DELETE revokes it → subsequent GET is 404
    const del = await fetch(`${base}/s/api/${id}`, { method: 'DELETE' })
    expect(del.status).toBe(204)
    expect((await fetch(`${base}/s/api/${id}`)).status).toBe(404)
  })

  it('404s unknown and unsafe ids', async () => {
    const { base } = await startServer()
    expect((await fetch(`${base}/s/api/nope`)).status).toBe(404)
    expect((await fetch(`${base}/s/api/..%2f..%2fetc`)).status).toBe(404)
  })

  it('rejects oversized uploads with 413', async () => {
    const { base } = await startServer({ maxBodyBytes: 50 })
    const res = await fetch(`${base}/s/api`, {
      method: 'POST',
      body: JSON.stringify({ id: 'x', messages: new Array(100).fill('padding') }),
    })
    expect(res.status).toBe(413)
  })
})

describe('share server — viewer + health', () => {
  it('serves the SPA index for /s/<id> routes', async () => {
    const { base } = await startServer()
    const res = await fetch(`${base}/s/someShareId`)
    expect(res.status).toBe(200)
    expect(await res.text()).toContain('viewer')
  })

  it('exposes an unauthenticated /health endpoint', async () => {
    const { base } = await startServer({ basicAuth: { user: 'u', pass: 'p' } })
    const res = await fetch(`${base}/health`)
    expect(res.status).toBe(200)
    expect((await res.json() as { status: string }).status).toBe('ok')
  })
})

describe('share server — built-in basic auth', () => {
  it('challenges /s/* without credentials', async () => {
    const { base } = await startServer({ basicAuth: { user: 'admin', pass: 'secret' } })
    const res = await fetch(`${base}/s/api/anything`)
    expect(res.status).toBe(401)
    expect(res.headers.get('www-authenticate')).toContain('Basic')
  })

  it('rejects wrong credentials and accepts correct ones', async () => {
    const { base } = await startServer({ basicAuth: { user: 'admin', pass: 'secret' } })

    const wrong = await fetch(`${base}/s/api`, {
      method: 'POST',
      headers: { authorization: `Basic ${btoa('admin:nope')}` },
      body: JSON.stringify(SAMPLE),
    })
    expect(wrong.status).toBe(401)

    const right = await fetch(`${base}/s/api`, {
      method: 'POST',
      headers: { authorization: `Basic ${btoa('admin:secret')}` },
      body: JSON.stringify(SAMPLE),
    })
    expect(right.status).toBe(200)
  })
})
