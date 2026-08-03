import { describe, expect, it } from 'bun:test'
import { ComfyClientError, ComfyUIClient, type ComfyFetch } from './client'

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  })
}

describe('ComfyUIClient', () => {
  it('normalizes the base URL and reads system health', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = []
    const client = new ComfyUIClient({
      baseUrl: 'http://127.0.0.1:8188///',
      fetch: (async (url, init) => {
        calls.push({ url: String(url), init })
        return jsonResponse({ system: { comfyui_version: '0.28.3' }, devices: [{ type: 'cuda' }] })
      }) as ComfyFetch,
    })

    const stats = await client.getSystemStats()

    expect(client.baseUrl).toBe('http://127.0.0.1:8188')
    expect(calls[0]?.url).toBe('http://127.0.0.1:8188/system_stats')
    expect(stats.system.comfyui_version).toBe('0.28.3')
    expect(stats.devices[0]?.type).toBe('cuda')
  })

  it('queues API-format workflows with an optional client id', async () => {
    let request: { url: string; init?: RequestInit } | null = null
    const client = new ComfyUIClient({
      fetch: (async (url, init) => {
        request = { url: String(url), init }
        return jsonResponse({ prompt_id: 'prompt-42', number: 7, node_errors: {} })
      }) as ComfyFetch,
    })

    const result = await client.queuePrompt({ '1': { class_type: 'AgnesImage', inputs: {} } }, 'archstudio')
    const captured = request as { url: string; init?: RequestInit } | null

    expect(result.prompt_id).toBe('prompt-42')
    expect(captured?.url).toBe('http://127.0.0.1:8188/prompt')
    expect(captured?.init?.method).toBe('POST')
    expect(JSON.parse(String(captured?.init?.body))).toEqual({
      prompt: { '1': { class_type: 'AgnesImage', inputs: {} } },
      client_id: 'archstudio',
    })
  })

  it('builds encoded output URLs without fetching binary data', () => {
    const client = new ComfyUIClient({ baseUrl: 'http://localhost:8188/' })
    expect(client.getViewUrl({
      filename: 'Agnes result 01.png',
      subfolder: 'ARCHstudio/renders',
      type: 'output',
    })).toBe('http://localhost:8188/view?filename=Agnes+result+01.png&subfolder=ARCHstudio%2Frenders&type=output')
  })

  it('surfaces HTTP status and structured ComfyUI errors', async () => {
    const client = new ComfyUIClient({
      fetch: (async () => jsonResponse(
        { error: { type: 'prompt_outputs_failed_validation', message: 'Invalid workflow' } },
        { status: 400, statusText: 'Bad Request' },
      )) as ComfyFetch,
    })

    try {
      await client.queuePrompt({})
      throw new Error('Expected queuePrompt to fail')
    } catch (error) {
      expect(error).toBeInstanceOf(ComfyClientError)
      expect((error as ComfyClientError).status).toBe(400)
      expect((error as ComfyClientError).detail).toEqual({
        error: { type: 'prompt_outputs_failed_validation', message: 'Invalid workflow' },
      })
    }
  })

  it('normalizes connection failures', async () => {
    const client = new ComfyUIClient({
      fetch: (async () => { throw new TypeError('ECONNREFUSED') }) as ComfyFetch,
    })

    await expect(client.getQueue()).rejects.toMatchObject({
      name: 'ComfyClientError',
      message: 'Unable to reach ComfyUI at http://127.0.0.1:8188',
    })
  })

  it('posts interrupt requests without requiring a JSON response body', async () => {
    let method = ''
    const client = new ComfyUIClient({
      fetch: (async (_url, init) => {
        method = init?.method ?? ''
        return new Response(null, { status: 200 })
      }) as ComfyFetch,
    })

    await client.interrupt()
    expect(method).toBe('POST')
  })
})
