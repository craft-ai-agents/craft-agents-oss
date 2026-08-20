/**
 * SiYuan detect assist (P7-prep) — path candidates, TCP probe, no download.
 */
import { describe, it, expect } from 'bun:test'
import { createServer } from 'node:net'
import {
  detectSiyuanEngine,
  findSiyuanInstallPaths,
  probeTcpPort,
  SIYUAN_DEFAULT_PORT,
  SIYUAN_INSTALL_DOCS_URL,
} from '../siyuan-detect'

describe('findSiyuanInstallPaths', () => {
  it('returns only existing candidates for the current platform', () => {
    const found = findSiyuanInstallPaths()
    expect(Array.isArray(found)).toBe(true)
    for (const p of found) {
      expect(typeof p).toBe('string')
      expect(p.length).toBeGreaterThan(0)
    }
  })
})

describe('probeTcpPort', () => {
  it('returns true when something listens and false on closed port', async () => {
    const server = createServer()
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
    const addr = server.address()
    if (!addr || typeof addr === 'string') throw new Error('expected TCP address')
    try {
      await expect(probeTcpPort('127.0.0.1', addr.port, 500)).resolves.toBe(true)
      // high unused port
      await expect(probeTcpPort('127.0.0.1', 1, 200)).resolves.toBe(false)
    } finally {
      await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())))
    }
  })
})

describe('detectSiyuanEngine', () => {
  it('returns shape with install docs URL and never implies download', async () => {
    const result = await detectSiyuanEngine({ timeoutMs: 150 })
    expect(result.suggestedBaseUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/)
    expect(result.installDocsUrl).toBe(SIYUAN_INSTALL_DOCS_URL)
    expect(typeof result.installed).toBe('boolean')
    expect(typeof result.runningOnDefaultPort).toBe('boolean')
    expect(Array.isArray(result.installPathsFound)).toBe(true)
    expect(result.platform).toBe(process.platform)
    // Default port constant documented
    expect(SIYUAN_DEFAULT_PORT).toBe(6806)
  })
})
