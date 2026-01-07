/**
 * Cloudflare Pages Function for session storage
 *
 * Routes:
 * - POST /s/api - Create new session, upload JSON
 * - GET /s/api/{id} - Fetch session JSON
 * - DELETE /s/api/{id} - Delete session
 */

interface Env {
  SESSIONS: R2Bucket
}

// nanoid implementation (no external deps in CF Functions)
const urlAlphabet = 'useandom-26T198340PX75pxJACKVERYMINDBUSHWOLF_GQZbfghjklqvwyzrict'
function nanoid(size = 15): string {
  let id = ''
  const bytes = crypto.getRandomValues(new Uint8Array(size))
  for (let i = 0; i < size; i++) {
    id += urlAlphabet[bytes[i] & 63]
  }
  return id
}

export const onRequest: PagesFunction<Env> = async (context) => {
  const { request, env, params } = context
  const method = request.method
  const pathParts = (params.path as string[]) || []

  // CORS headers
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  }

  // Handle preflight
  if (method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    // POST /s/api - Create new session
    if (method === 'POST' && pathParts.length === 0) {
      const body = await request.json()

      // Validate it's a session object
      if (!body || typeof body !== 'object') {
        return Response.json({ error: 'Invalid session data' }, { status: 400, headers: corsHeaders })
      }

      const id = nanoid(15)
      const key = `${id}.json`

      await env.SESSIONS.put(key, JSON.stringify(body), {
        httpMetadata: { contentType: 'application/json' },
      })

      const baseUrl = new URL(request.url).origin
      return Response.json(
        {
          id,
          url: `${baseUrl}/s/${id}`,
        },
        { headers: corsHeaders }
      )
    }

    // GET /s/api/{id} - Fetch session
    if (method === 'GET' && pathParts.length === 1) {
      const id = pathParts[0]
      const key = `${id}.json`

      const object = await env.SESSIONS.get(key)
      if (!object) {
        return Response.json({ error: 'Session not found' }, { status: 404, headers: corsHeaders })
      }

      const data = await object.text()
      return new Response(data, {
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
          'Cache-Control': 'public, max-age=60',
        },
      })
    }

    // DELETE /s/api/{id} - Delete session
    if (method === 'DELETE' && pathParts.length === 1) {
      const id = pathParts[0]
      const key = `${id}.json`

      // Check if exists first
      const object = await env.SESSIONS.head(key)
      if (!object) {
        return Response.json({ error: 'Session not found' }, { status: 404, headers: corsHeaders })
      }

      await env.SESSIONS.delete(key)
      return Response.json({ success: true }, { headers: corsHeaders })
    }

    return Response.json({ error: 'Not found' }, { status: 404, headers: corsHeaders })
  } catch (error) {
    console.error('Session API error:', error)
    return Response.json({ error: 'Internal server error' }, { status: 500, headers: corsHeaders })
  }
}
