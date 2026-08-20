interface Env {
  SHARES: R2Bucket
  VIEWER_ORIGIN?: string
}
const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}
function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  })
}
function originOf(request: Request, env: Env): string {
  const configured = (env.VIEWER_ORIGIN || '').replace(/\/$/, '')
  if (configured) return configured
  const url = new URL(request.url)
  return `${url.protocol}//${url.host}`
}
function newId(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-'
  let out = ''
  for (let i = 0; i < 21; i++) out += alphabet[bytes[i % 16]! % alphabet.length]!
  return out
}
function isSessionPayload(v: unknown): v is { id: string; messages: unknown[] } {
  if (!v || typeof v !== 'object') return false
  const o = v as Record<string, unknown>
  return typeof o.id === 'string' && Array.isArray(o.messages)
}
export const onRequestOptions: PagesFunction<Env> = async () =>
  new Response(null, { status: 204, headers: CORS })
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  if (!env.SHARES) return json({ error: 'Share storage not configured' }, 503)
  let body: unknown
  try { body = await request.json() } catch { return json({ error: 'Invalid JSON body' }, 400) }
  if (!isSessionPayload(body)) {
    return json({ error: 'Invalid session: must have id (string) and messages (array)' }, 400)
  }
  const raw = JSON.stringify(body)
  if (raw.length > 25 * 1024 * 1024) return json({ error: 'Session file is too large to share' }, 413)
  const shareId = newId()
  await env.SHARES.put(shareId, raw, {
    httpMetadata: { contentType: 'application/json' },
    customMetadata: { sessionId: body.id, createdAt: String(Date.now()) },
  })
  return json({ id: shareId, url: `${originOf(request, env)}/s/${shareId}` }, 201)
}
export const onRequestGet: PagesFunction<Env> = async () => json({ error: 'Not found' }, 404)
