import { describe, expect, it } from 'bun:test'
import { parseError } from '../errors.ts'

describe('parseError proxy interception handling', () => {
  it('maps interceptor proxy marker message to proxy_error', () => {
    const message = 'Received an unexpected HTML error page (HTTP 400) instead of a JSON API response. This may be caused by your network proxy (http://example.com:8080). Check your proxy settings in Settings > Network.'
    const parsed = parseError(new Error(message))

    expect(parsed.code).toBe('proxy_error')
    expect(parsed.message).toBe(message)
  })

  it('maps raw Cloudflare HTML error page to proxy_error with sanitized message', () => {
    const rawHtml = `<html>
<head><title>400 Bad Request</title></head>
<body>
<center><h1>400 Bad Request</h1></center>
<hr><center>cloudflare</center>
</body>
</html>`

    const parsed = parseError(new Error(rawHtml))

    expect(parsed.code).toBe('proxy_error')
    expect(parsed.message).toContain('unexpected HTML error page')
    expect(parsed.message).toContain('HTTP 400')
    expect(parsed.message.toLowerCase()).toContain('proxy settings')
    expect(parsed.message.toLowerCase()).not.toContain('<html')
    expect(parsed.originalError).toBe(rawHtml)
  })

  it('does not remap regular 401 auth errors as proxy_error', () => {
    const parsed = parseError(new Error('401 Unauthorized'))

    expect(parsed.code).toBe('invalid_api_key')
  })
})

describe('parseError context overflow detection (#666)', () => {
  it('maps context_length_exceeded error to context_overflow', () => {
    const parsed = parseError(new Error('Error: context_length_exceeded - this turn would exceed the model context window'))
    expect(parsed.code).toBe('context_overflow')
  })

  it('maps "exceeds the context window" message to context_overflow', () => {
    const parsed = parseError(new Error('The request exceeds the context window of 200000 tokens'))
    expect(parsed.code).toBe('context_overflow')
  })

  it('maps "too many tokens" message to context_overflow', () => {
    const parsed = parseError(new Error('Request rejected: too many tokens for this model'))
    expect(parsed.code).toBe('context_overflow')
  })

  it('maps "token limit exceeded" message to context_overflow', () => {
    const parsed = parseError(new Error('Token limit exceeded'))
    expect(parsed.code).toBe('context_overflow')
  })

  it('returns a typed error definition with title and retry action', () => {
    const parsed = parseError(new Error('context_length_exceeded'))
    expect(parsed.title).toBeTruthy()
    expect(parsed.message).toBeTruthy()
    expect(parsed.canRetry).toBe(true)
  })

  it('does not misclassify image-too-large errors as context_overflow', () => {
    const parsed = parseError(new Error('Image dimensions exceed the 8000px limit'))
    expect(parsed.code).toBe('image_too_large')
  })

  it('does not misclassify unrelated errors as context_overflow', () => {
    const parsed = parseError(new Error('500 Internal Server Error'))
    expect(parsed.code).toBe('service_error')
  })
})
