import { createHash, randomBytes } from 'node:crypto'

/** Only connect the account token to the configured Craft host, with TLS outside loopback. */
export function managedWebSocketUrl(serverUrl: string, value: unknown): string {
  if (typeof value !== 'string') throw new Error('企业服务未返回 WebSocket 地址')
  const server = new URL(serverUrl)
  const ws = new URL(value)
  const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(server.hostname)
  if (ws.username || ws.password || ws.hash || ws.search || ws.hostname !== server.hostname
    || (ws.protocol !== 'wss:' && !(loopback && ws.protocol === 'ws:' && server.protocol === 'http:'))
    || (!loopback && ws.port !== server.port)) throw new Error('企业 WebSocket 地址不可信')
  return ws.href
}

/** PKCE verifier and resulting token stay in main, never in renderer state. */
export async function desktopErpLogin(serverUrl: string, deps: {
  request: (url: string, init?: RequestInit) => Promise<Response>
  open: (url: string) => Promise<unknown>
  cancelled: () => boolean
  wait?: () => Promise<void>
  now?: () => number
}): Promise<{ accessToken: string }> {
  const now = deps.now ?? Date.now
  const verifier = randomBytes(32).toString('base64url')
  const post = (path: string, body: unknown) => deps.request(`${serverUrl}${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })
  const response = await post('/api/auth/sso/device/start', {
    challenge: createHash('sha256').update(verifier).digest('base64url'),
  })
  if (!response.ok) throw new Error('无法发起 ERP 登录，请确认企业服务器已启用 SSO')
  const data = await response.json() as { device?: unknown; login_url?: unknown } | null
  if (!data || typeof data.device !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(data.device)) throw new Error('ERP 登录响应无效')
  const expected = new URL(`/api/auth/sso/start?device=${data.device}`, serverUrl).href
  if (data.login_url !== expected) throw new Error('ERP 登录地址不可信')
  if (deps.cancelled()) throw new Error('登录已取消')
  await deps.open(expected)
  const deadline = now() + 290_000
  while (now() < deadline) {
    await (deps.wait ?? (() => new Promise<void>(resolve => setTimeout(resolve, 5000))))()
    if (deps.cancelled()) throw new Error('登录已取消')
    const poll = await post('/api/auth/sso/device/poll', { device: data.device, verifier })
    if (poll.status === 202) continue
    if (!poll.ok) throw new Error('ERP 登录未完成或已过期，请重试')
    const result = await poll.json() as { accessToken?: unknown } | null
    if (!result || typeof result.accessToken !== 'string' || !result.accessToken || result.accessToken.length > 16_384) throw new Error('ERP 登录响应无效')
    if (deps.cancelled()) throw new Error('登录已取消')
    return { accessToken: result.accessToken }
  }
  throw new Error('ERP 登录已超时，请重新登录')
}
