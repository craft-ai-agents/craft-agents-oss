/**
 * Log redaction helpers for WeChat protocol traces.
 *
 * Tokens, ticket payloads, and CDN parameters are sensitive — these helpers
 * keep enough of each value visible for debugging while masking the rest. They
 * are intentionally tiny and dependency-free so the protocol layer can log
 * without pulling in larger logging utilities.
 */

const KEEP_HEAD = 6
const KEEP_TAIL = 4

/**
 * Mask everything between `KEEP_HEAD` and `KEEP_TAIL` of `value` with `***`.
 * Short values (≤ keepHead+keepTail) are fully replaced with `***` to avoid
 * leaking the entire payload through "redaction".
 */
export function redactToken(value: string | undefined): string {
  if (!value) return ''
  if (value.length <= KEEP_HEAD + KEEP_TAIL) return '***'
  return `${value.slice(0, KEEP_HEAD)}***${value.slice(-KEEP_TAIL)}`
}

const SENSITIVE_FIELDS = new Set([
  'bot_token',
  'token',
  'authorization',
  'context_token',
  'typing_ticket',
  'aes_key',
  'aeskey',
  'upload_param',
  'thumb_upload_param',
  'encrypt_query_param',
  'get_updates_buf',
  'sync_buf',
])

/**
 * Best-effort body redaction: parse JSON, mask known sensitive fields, return
 * the serialized result. On parse failure return a length marker — never the
 * raw body.
 */
export function redactBody(body: string | undefined): string {
  if (!body) return ''
  try {
    const parsed = JSON.parse(body)
    return JSON.stringify(maskSensitive(parsed))
  } catch {
    return `[non-json body, ${body.length} bytes]`
  }
}

function maskSensitive(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(maskSensitive)
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_FIELDS.has(k.toLowerCase())) {
        out[k] = typeof v === 'string' ? redactToken(v) : '***'
      } else {
        out[k] = maskSensitive(v)
      }
    }
    return out
  }
  return value
}

/** Strip query strings from log lines so tokens in URLs never get printed. */
export function redactUrl(url: string): string {
  const idx = url.indexOf('?')
  return idx === -1 ? url : `${url.slice(0, idx)}?***`
}
