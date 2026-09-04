import { describe, expect, test } from 'bun:test'
import { createServer } from 'node:http'
import { boundRequestBody, RequestBodyError, MAX_AUTH_BODY_BYTES } from '../request-limits'
import { nodeHttpAdapter } from '../node-adapter'

describe('bounded HTTP input', () => {
  test('rejects declared and streamed oversized bodies', async () => {
    await expect(boundRequestBody(new Request('http://localhost/', { method: 'POST', body: 'abc', headers: { 'Content-Length': '1000' } }), 8)).rejects.toMatchObject({ status: 413 })
    const stream = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(9)); controller.close() } })
    await expect(boundRequestBody(new Request('http://localhost/', { method: 'POST', body: stream }), 8)).rejects.toBeInstanceOf(RequestBodyError)
  })
  test('times out a stalled stream and cancels it', async () => {
    let cancelled = false
    const stream = new ReadableStream({ cancel() { cancelled = true } })
    await expect(boundRequestBody(new Request('http://localhost/', { method: 'POST', body: stream }), 1024, 10)).rejects.toMatchObject({ status: 408 })
    expect(cancelled).toBe(true)
  })
  test('preserves a bounded JSON body and authorization metadata', async () => {
    const result = await boundRequestBody(new Request('http://localhost/', { method: 'POST', headers: { authorization: 'Bearer test-token' }, body: JSON.stringify({ value: 'test' }) }))
    expect(await result.json()).toEqual({ value: 'test' })
    expect(result.headers.get('authorization')).toBe('Bearer test-token')
  })
  test('Node HTTP adapter rejects oversized auth input before invoking application code', async () => {
    let invoked = false
    const server = createServer(nodeHttpAdapter(() => { invoked = true; return new Response('unexpected') }))
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    try {
      const address = server.address() as { port: number }
      const response = await fetch(`http://127.0.0.1:${address.port}/api/auth`, { method: 'POST', body: 'x'.repeat(MAX_AUTH_BODY_BYTES + 1) })
      expect(response.status).toBe(413)
      expect(invoked).toBe(false)
    } finally { await new Promise<void>(resolve => server.close(() => resolve())) }
  })
})
