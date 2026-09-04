import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'

export function assertDesktopAccount(value: unknown): asserts value is {
  id: string; username: string; credits: number; workspaceId: string; role: 'admin' | 'user'
} {
  const account = value as Record<string, unknown> | null
  if (!account || typeof account.id !== 'string' || !account.id || account.id.length > 128
    || typeof account.username !== 'string' || !account.username || account.username.length > 128
    || typeof account.workspaceId !== 'string' || !account.workspaceId || account.workspaceId.length > 256
    || typeof account.credits !== 'number' || !Number.isSafeInteger(account.credits) || account.credits < 0
    || !['admin', 'user'].includes(String(account.role))) throw new Error('账户服务返回了无效的账号数据')
}

export function isTrustedAccountFrame(urlInput: string, rendererFile: string, devServerUrl?: string): boolean {
  try {
    const url = new URL(urlInput)
    if (devServerUrl) {
      const dev = new URL(devServerUrl)
      return url.origin === dev.origin && ['/', '/index.html'].includes(url.pathname)
    }
    if (url.protocol !== 'file:') return false
    url.search = ''; url.hash = ''
    const normalize = (path: string) => process.platform === 'win32' ? resolve(path).toLowerCase() : resolve(path)
    return normalize(fileURLToPath(url)) === normalize(rendererFile)
  } catch { return false }
}

/** Refuse redirects and bound both connection and response-body time/size. */
export async function boundedAccountFetch(fetcher: (url: string, init: RequestInit) => Promise<Response>, url: string, init: RequestInit = {}): Promise<Response> {
  const response = await fetcher(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(15_000) })
  if (!response.body) return response
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > 16 * 1024 * 1024) throw new Error('账户服务响应过大')
      chunks.push(value)
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock() }
  return new Response(Buffer.concat(chunks), { status: response.status, statusText: response.statusText, headers: response.headers })
}
