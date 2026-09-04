export class RequestBodyError extends Error {
  constructor(readonly status: 408 | 413, message: string) { super(message) }
}

export const MAX_WEBUI_BODY_BYTES = 2 * 1024 * 1024
export const MAX_AUTH_BODY_BYTES = 16 * 1024

/** Bound streamed/chunked input as well as Content-Length; never log body contents. */
export async function boundRequestBody(request: Request, limit = MAX_WEBUI_BODY_BYTES, timeoutMs = 15_000): Promise<Request> {
  if (!request.body) return request
  const declared = Number(request.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > limit) throw new RequestBodyError(413, 'Request body too large')
  const reader = request.body.getReader()
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const body = await Promise.race([
      (async () => {
        const chunks: Uint8Array[] = []
        let size = 0
        for (;;) {
          const { value, done } = await reader.read()
          if (done) break
          size += value.byteLength
          if (size > limit) throw new RequestBodyError(413, 'Request body too large')
          chunks.push(value)
        }
        return Buffer.concat(chunks)
      })(),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new RequestBodyError(408, 'Request body timeout')), timeoutMs) }),
    ])
    return new Request(request.url, { method: request.method, headers: request.headers, body })
  } finally {
    if (timer) clearTimeout(timer)
    void reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}
