import { describe, expect, it } from 'bun:test'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { assertDesktopAccount, boundedAccountFetch, isTrustedAccountFrame } from '../account-security'

describe('desktop account boundary', () => {
  const renderer = resolve('test-app/renderer/index.html')
  it('rejects malformed account data before saving login state', () => {
    const valid = { id: 'test-account', username: 'alice', workspaceId: 'ws-one', credits: 3, role: 'user' }
    expect(() => assertDesktopAccount(valid)).not.toThrow()
    for (const value of [null, {}, { ...valid, credits: -1 }, { ...valid, credits: '3' }, { ...valid, role: 'owner' }]) {
      expect(() => assertDesktopAccount(value)).toThrow('无效')
    }
  })
  it('accepts only the exact desktop renderer file', () => {
    expect(isTrustedAccountFrame(`${pathToFileURL(renderer)}?workspaceId=one`, renderer)).toBe(true)
    expect(isTrustedAccountFrame(pathToFileURL(resolve('test-app/renderer/infinite-canvas/index.html')).href, renderer)).toBe(false)
    expect(isTrustedAccountFrame('https://untrusted.test', renderer)).toBe(false)
    expect(isTrustedAccountFrame('file:///elsewhere/index.html', renderer)).toBe(false)
  })
  it('limits development origins and paths', () => {
    expect(isTrustedAccountFrame('http://localhost:5173/?workspaceId=one', renderer, 'http://localhost:5173')).toBe(true)
    expect(isTrustedAccountFrame('http://localhost:5174/', renderer, 'http://localhost:5173')).toBe(false)
    expect(isTrustedAccountFrame('http://localhost:5173/infinite-canvas/index.html', renderer, 'http://localhost:5173')).toBe(false)
  })
  it('forces redirect rejection and a timeout signal', async () => {
    const fetcher = (async (_url: unknown, init: RequestInit) => {
      expect(init.redirect).toBe('error')
      expect(init.signal).toBeInstanceOf(AbortSignal)
      return Response.json({ ok: true })
    })
    expect(await (await boundedAccountFetch(fetcher, 'https://account.test')).json()).toEqual({ ok: true })
  })
  it('rejects oversized streamed responses and supports empty logout responses', async () => {
    const large = async () => new Response(new Uint8Array(16 * 1024 * 1024 + 1))
    await expect(boundedAccountFetch(large, 'https://account.test')).rejects.toThrow('响应过大')
    const empty = async () => new Response(null, { status: 204 })
    expect((await boundedAccountFetch(empty, 'https://account.test')).status).toBe(204)
  })
})
