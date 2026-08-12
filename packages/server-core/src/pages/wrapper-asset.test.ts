/**
 * The wrapper's postMessage bridge.
 *
 * This is the seam between a sandboxed page and the connector bridge, and it is
 * the only trusted code in the chain that a hostile page can talk to directly.
 * The page cannot reach `/internal/query` itself — its CSP is `connect-src
 * 'none'` and its origin is opaque, so the Origin pin would refuse it anyway.
 * Everything therefore goes through this script.
 *
 * WRAPPER_JS ships as a string, so the tests below evaluate the REAL string
 * against a minimal DOM harness. A rewritten copy would test the copy; adding a
 * full DOM library for one file this small buys nothing.
 */
import { describe, expect, it, beforeEach } from 'bun:test'
import { WRAPPER_JS, renderWrapperHtml } from './wrapper-asset.ts'

interface Harness {
  /** Deliver a message as if it came from the framed page. */
  fromPage: (data: unknown) => Promise<void>
  /** Deliver a message from some other window — must be ignored. */
  fromOther: (data: unknown, source?: object) => Promise<void>
  /** Everything the wrapper posted back into the frame. */
  replies: Array<{ data: Record<string, unknown>; targetOrigin: string }>
  fetches: Array<{ url: string; init: RequestInit }>
  /** Next bridge response; set per test. */
  respond: (url: string, init: RequestInit) => Promise<Response> | Response
}

/** Drain the microtask queue; the wrapper chains fetch → text → postMessage. */
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve() }

function mount(grantMap: Record<string, string> = { unread: 'g_abc' }): Harness {
  const replies: Harness['replies'] = []
  const fetches: Harness['fetches'] = []
  const listeners: Array<(e: unknown) => void> = []

  const contentWindow = {
    postMessage: (data: Record<string, unknown>, targetOrigin: string) => {
      replies.push({ data, targetOrigin })
    },
  }

  const h: Harness = {
    replies,
    fetches,
    respond: () => new Response(JSON.stringify({ ok: true, data: null }), { status: 200 }),
    fromPage: async (data) => {
      for (const l of listeners) l({ source: contentWindow, origin: 'null', data })
      await flush()
    },
    fromOther: async (data, source = { postMessage() {} }) => {
      for (const l of listeners) l({ source, origin: 'null', data })
      await flush()
    },
  }

  const els: Record<string, unknown> = {
    'ca-frame': { contentWindow },
    'ca-title': { textContent: '' },
    'ca-sources': { textContent: '', hidden: true },
  }

  const scriptEl = {
    getAttribute: (n: string) =>
      ({
        'data-title': 'Dash',
        'data-page-id': 'pg_1',
        'data-rev': '1',
        // Inlined by the server: the page's handles, resolved to the grants the
        // user approved. The page never sees a grant id.
        'data-grants': JSON.stringify(grantMap),
      })[n] ?? null,
  }

  const fakeWindow = {
    addEventListener: (type: string, fn: (e: unknown) => void) => {
      if (type === 'message') listeners.push(fn)
    },
    location: { origin: 'http://127.0.0.1:51234' },
  }

  const fakeDocument = {
    currentScript: scriptEl,
    getElementById: (id: string) => els[id] ?? null,
  }

  // async, so a `respond` that throws surfaces as a REJECTION — real fetch never
  // throws synchronously, and a harness that did would let a missing .catch pass.
  const fakeFetch = async (url: string, init: RequestInit = {}) => {
    fetches.push({ url, init })
    return h.respond(url, init)
  }

  // eslint-disable-next-line no-new-func -- evaluating the shipped asset is the point
  new Function('window', 'document', 'fetch', WRAPPER_JS)(fakeWindow, fakeDocument, fakeFetch)
  return h
}

let h: Harness
beforeEach(() => { h = mount() })

const QUERY = { craftPage: true, kind: 'query', id: 'q1', name: 'unread', params: { q: 'hi' } }
const lastReply = () => h.replies.at(-1)?.data ?? {}

describe('message authentication', () => {
  it('ignores a message from any window that is not the framed page', async () => {
    // The identity check must be by e.source. Sandboxed frames all report
    // origin "null", so an origin comparison would accept every one of them.
    await h.fromOther(QUERY)
    expect(h.fetches).toHaveLength(0)
    expect(h.replies).toHaveLength(0)
  })

  it('ignores messages that are not craft-page messages', async () => {
    for (const junk of [null, 'string', 42, {}, { kind: 'query' }, { craftPage: false, kind: 'query' }]) {
      await h.fromPage(junk)
    }
    expect(h.fetches).toHaveLength(0)
  })

  it('ignores craft-page messages of an unknown kind', async () => {
    await h.fromPage({ craftPage: true, kind: 'evaluate', id: 'x', code: 'alert(1)' })
    expect(h.fetches).toHaveLength(0)
  })
})

describe('query → bridge', () => {
  it('POSTs the grant and params to the bridge and returns the data', async () => {
    h.respond = () => new Response(
      JSON.stringify({ ok: true, data: { rows: [{ id: 1 }] } }), { status: 200 })

    await h.fromPage(QUERY)

    expect(h.fetches).toHaveLength(1)
    const { url, init } = h.fetches[0]!
    expect(url).toBe('/internal/query')
    expect(init.method).toBe('POST')
    expect(JSON.parse(String(init.body))).toEqual({ grantId: 'g_abc', params: { q: 'hi' } })

    expect(lastReply()).toEqual({
      craftPage: true, kind: 'query-result', id: 'q1', data: { rows: [{ id: 1 }] },
    })
  })

  it('sends only the grant id and params — the page cannot choose a URL or tool', async () => {
    await h.fromPage({
      ...QUERY,
      url: 'https://evil.example/steal',
      sourceSlug: 'gmail',
      toolName: 'send_message',
      fixedArgs: { to: 'attacker@evil.example' },
    })

    expect(h.fetches[0]!.url).toBe('/internal/query')
    expect(Object.keys(JSON.parse(String(h.fetches[0]!.init.body))).sort())
      .toEqual(['grantId', 'params'])
  })

  it('replies to the frame with targetOrigin "*", the only value an opaque origin accepts', async () => {
    // Not a weakness: the message is posted to that one frame's contentWindow,
    // and an opaque origin cannot be named any other way.
    await h.fromPage(QUERY)
    expect(h.replies[0]!.targetOrigin).toBe('*')
  })

  it('keeps concurrent queries distinct by id', async () => {
    const seen: string[] = []
    h.respond = (_u, init) => {
      const id = JSON.parse(String(init.body)).params.tag
      seen.push(id)
      return new Response(JSON.stringify({ ok: true, data: { tag: id } }), { status: 200 })
    }

    await h.fromPage({ craftPage: true, kind: 'query', id: 'a', name: 'unread', params: { tag: 'a' } })
    await h.fromPage({ craftPage: true, kind: 'query', id: 'b', name: 'unread', params: { tag: 'b' } })

    expect(seen).toEqual(['a', 'b'])
    expect(h.replies.map(r => [r.data.id, (r.data.data as { tag: string }).tag]))
      .toEqual([['a', 'a'], ['b', 'b']])
  })
})

describe('errors stay opaque', () => {
  it('passes the bridge error code through without inventing detail', async () => {
    h.respond = () => new Response(JSON.stringify({ error: 'forbidden' }), { status: 403 })
    await h.fromPage(QUERY)
    expect(lastReply()).toEqual({
      craftPage: true, kind: 'query-result', id: 'q1', error: 'forbidden',
    })
  })

  it('never leaks an HTTP status or body text the bridge did not name', async () => {
    h.respond = () => new Response('Internal Server Error: db at 10.0.0.4 refused', { status: 500 })
    await h.fromPage(QUERY)
    const reply = JSON.stringify(lastReply())
    expect(reply).not.toContain('10.0.0.4')
    expect(reply).not.toContain('500')
    expect(lastReply().error).toBe('request_failed')
  })

  it('reports a transport failure without surfacing the exception', async () => {
    h.respond = () => { throw new Error('ECONNREFUSED 127.0.0.1:51234') }
    await h.fromPage(QUERY)
    expect(JSON.stringify(lastReply())).not.toContain('ECONNREFUSED')
    expect(lastReply().error).toBe('request_failed')
  })

  it('does not treat a failed response as success just because the body says ok', async () => {
    // The status is checked as well as the envelope. Trusting the body alone
    // would let any upstream that can shape a response — a proxy, an error
    // page, a future bridge bug — hand a page data it was refused.
    h.respond = () => new Response(
      JSON.stringify({ ok: true, data: { secret: 'leaked' } }), { status: 502 })
    await h.fromPage(QUERY)
    expect(JSON.stringify(lastReply())).not.toContain('leaked')
    expect(lastReply().error).toBe('request_failed')
  })

  it('always answers a query, so a page never hangs waiting', async () => {
    h.respond = () => new Response('{}', { status: 502 })
    await h.fromPage(QUERY)
    expect(h.replies).toHaveLength(1)
    expect(lastReply().id).toBe('q1')
  })
})

describe('wrapper document', () => {
  it('escapes an agent-authored title everywhere it appears', () => {
    const html = renderWrapperHtml({
      pageId: 'pg_1', rev: 1, title: '</title><script>alert(1)</script>',
    })
    expect(html).not.toContain('<script>alert(1)')
    expect(html).toContain('&lt;script&gt;')
  })

  it('names granted sources in always-visible chrome', () => {
    const html = renderWrapperHtml({ pageId: 'pg_1', rev: 1, title: 'D', sources: ['gmail'] })
    expect(html).toContain('Live data: gmail')
  })
})

describe('names, not grant ids', () => {
  it('resolves the page\'s handle to the grant the user approved', async () => {
    await h.fromPage(QUERY)
    expect(JSON.parse(String(h.fetches[0]!.init.body)).grantId).toBe('g_abc')
  })

  it('never lets the page name a grant id directly', async () => {
    // A page that could pass a raw grantId could try ids it was never given.
    // The only thing it may name is its own handle.
    await h.fromPage({
      craftPage: true, kind: 'query', id: 'q1', name: 'unread',
      grantId: 'g_someone_elses', params: {},
    })
    expect(JSON.parse(String(h.fetches[0]!.init.body)).grantId).toBe('g_abc')
  })

  it('refuses a handle the user never approved, without asking the bridge', async () => {
    await h.fromPage({ craftPage: true, kind: 'query', id: 'q1', name: 'invented', params: {} })
    expect(h.fetches).toHaveLength(0)
    expect(lastReply()).toEqual({
      craftPage: true, kind: 'query-result', id: 'q1', error: 'forbidden',
    })
  })

  it('refuses a query with no handle at all', async () => {
    await h.fromPage({ craftPage: true, kind: 'query', id: 'q1', params: {} })
    expect(h.fetches).toHaveLength(0)
    expect(lastReply().error).toBe('forbidden')
  })

  it('does not resolve inherited property names as handles', async () => {
    // 'constructor' and 'toString' exist on every object; a lookup that walked
    // the prototype chain would turn them into truthy "grants".
    for (const name of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
      const w = mount({ unread: 'g_abc' })
      await w.fromPage({ craftPage: true, kind: 'query', id: 'x', name, params: {} })
      expect(w.fetches).toHaveLength(0)
    }
  })

  it('treats a page with no approved grants as having no handles', async () => {
    const w = mount({})
    await w.fromPage(QUERY)
    expect(w.fetches).toHaveLength(0)
    expect(w.replies.at(-1)!.data.error).toBe('forbidden')
  })
})

describe('the server inlines the handle map', () => {
  it('carries approved handles into the document', () => {
    const html = renderWrapperHtml({
      pageId: 'pg_1', rev: 1, title: 'D', grants: { unread: 'g_abc' },
    })
    expect(html).toContain('data-grants=')
    expect(html).toContain('g_abc')
  })

  it('emits an empty map for a page with no grants', () => {
    const html = renderWrapperHtml({ pageId: 'pg_1', rev: 1, title: 'D' })
    expect(html).toContain('data-grants="{}"')
  })

  it('escapes a handle so it cannot break out of the attribute', () => {
    // Handles are validated on both sides, but this string reaches the DOM as
    // an attribute value — escaping is the property that must hold regardless.
    const html = renderWrapperHtml({
      pageId: 'pg_1', rev: 1, title: 'D',
      grants: { '"><script>alert(1)</script>': 'g_x' },
    })
    expect(html).not.toContain('<script>alert(1)')
  })
})
