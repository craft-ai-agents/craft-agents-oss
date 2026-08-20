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
function isSessionPayload(v: unknown): v is { id: string; messages: unknown[] } {
  if (!v || typeof v !== 'object') return false
  const o = v as Record<string, unknown>
  return typeof o.id === 'string' && Array.isArray(o.messages)
}
export const onRequestOptions: PagesFunction<Env> = async () =>
  new Response(null, { status: 204, headers: CORS })
export const onRequestGet: PagesFunction<Env> = async ({ params, env }) => {
  if (!env.SHARES) return json({ error: 'Share storage not configured' }, 503)
  const id = String(params.id || '')
  const obj = await env.SHARES.get(id)
  if (!obj) return json({ error: 'Not found' }, 404)
  const body = await obj.text()
  return new Response(body, {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=60', ...CORS },
  })
}
export const onRequestPut: PagesFunction<Env> = async ({ request, params, env }) => {
  if (!env.SHARES) return json({ error: 'Share storage not configured' }, 503)
  const id = String(params.id || '')
  const existing = await env.SHARES.head(id)
  if (!existing) return json({ error: 'Not found' }, 404)
  let body: unknown
  try { body = await request.json() } catch { return json({ error: 'Invalid JSON body' }, 400) }
  if (!isSessionPayload(body)) {
    return json({ error: 'Invalid session: must have id (string) and messages (array)' }, 400)
  }
  const raw = JSON.stringify(body)
  if (raw.length > 25 * 1024 * 1024) return json({ error: 'Session file is too large to share' }, 413)
  await env.SHARES.put(id, raw, {
    httpMetadata: { contentType: 'application/json' },
    customMetadata: { sessionId: body.id, updatedAt: String(Date.now()), ...(existing.customMetadata || {}) },
  })
  return json({ id, url: `${originOf(request, env)}/s/${id}` })
}
export const onRequestDelete: PagesFunction<Env> = async ({ params, env }) => {
  if (!env.SHARES) return json({ error: 'Share storage not configured' }, 503)
  const id = String(params.id || '')
  const existing = await env.SHARES.head(id)
  if (!existing) return json({ error: 'Not found' }, 404)
  await env.SHARES.delete(id)
  return new Response(null, { status: 204, headers: CORS })
}
