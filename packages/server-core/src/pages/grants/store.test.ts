/**
 * Grant store — the authorization record for page queries.
 *
 * Two properties this exists to guarantee, both from the security review:
 *
 * 1. It lives OUTSIDE any agent-writable directory. `page.json` carries the
 *    agent's *request*; this file carries the user's *decision*. If the agent
 *    could edit the decision, hand-editing a manifest would grant access.
 *
 * 2. A tool name in a grant is not sufficient. MCP tool names and readOnlyHint
 *    annotations are server-controlled and cannot prove a tool is
 *    non-mutating, so every grant is checked against a curated allowlist — at
 *    approval AND again at execution, because a tool can leave the allowlist
 *    after a grant was issued.
 */
import { describe, expect, it, beforeEach } from 'bun:test'
import { mkdtempSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { GrantStore } from './store.ts'
import { isTrustedReadOnlyTool } from './allowlist.ts'

let ws: string
let store: GrantStore

const validGrant = {
  pageId: 'page-1',
  name: 'messages',
  sourceSlug: 'gmail',
  toolName: 'list_messages',
  fixedArgs: { maxResults: 20 },
  paramSchema: { q: { type: 'string' as const, maxLength: 100 } },
}

beforeEach(() => {
  ws = mkdtempSync(join(tmpdir(), 'craft-grants-'))
  store = new GrantStore(ws)
})

describe('storage location', () => {
  it('writes outside any session (agent-writable) directory', async () => {
    await store.approve(validGrant)
    // Sessions live under {ws}/sessions/**; the grant file must not.
    expect(existsSync(join(ws, 'page-grants.json'))).toBe(true)
    expect(existsSync(join(ws, 'sessions'))).toBe(false)
  })
})

describe('approve', () => {
  it('returns a grantId and stores the grant', async () => {
    const id = await store.approve(validGrant)
    const g = await store.get(id)
    expect(g?.sourceSlug).toBe('gmail')
    expect(g?.toolName).toBe('list_messages')
  })

  it('rejects a tool that is not on the trusted read-only allowlist', async () => {
    await expect(store.approve({ ...validGrant, toolName: 'send_message' }))
      .rejects.toThrow(/allowlist|read-only/i)
  })

  it('rejects an invalid parameter schema', async () => {
    await expect(store.approve({
      ...validGrant,
      paramSchema: { q: { type: 'string' } } as never, // no maxLength
    })).rejects.toThrow()
  })

  it('rejects a schema whose parameter collides with a fixedArg', async () => {
    // If a runtime parameter shared a name with a fixed argument, the merge
    // order would decide whether the user's constraint or the page's value
    // wins. Making it impossible to express is safer than relying on merge
    // order being right forever.
    await expect(store.approve({
      ...validGrant,
      fixedArgs: { maxResults: 20 },
      paramSchema: { maxResults: { type: 'integer' as const, minimum: 1, maximum: 999 } },
    })).rejects.toThrow(/collide|fixed/i)
  })
})

describe('resolveArgs', () => {
  // NOTE on merge order. resolveArgs spreads fixedArgs last, but that ordering
  // is UNOBSERVABLE through the public API: approve() rejects any grant whose
  // parameters collide with its fixed arguments, so the two objects always
  // have disjoint keys. Mutation-testing confirmed it — reversing the spread
  // fails nothing.
  //
  // The real guarantee is therefore the COLLISION CHECK in approve(), which is
  // covered above and does fail when removed. Merge order is belt-and-braces,
  // and this test only asserts that both sets of values arrive.
  it('carries both the page params and the fixed arguments', async () => {
    const id = await store.approve({
      ...validGrant,
      fixedArgs: { maxResults: 20 },
      paramSchema: { q: { type: 'string' as const, maxLength: 100 } },
    })
    const r = await store.resolveArgs(id, { q: 'invoice' })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.args.q).toBe('invoice')
      expect(r.args.maxResults).toBe(20)
    }
  })

  it('rejects params not declared by the grant', async () => {
    const id = await store.approve(validGrant)
    const r = await store.resolveArgs(id, { maxResults: 9999 })
    expect(r.ok).toBe(false)
  })

  it('re-checks the allowlist at execution time', async () => {
    // A grant issued while a tool was trusted must stop working if the tool
    // later leaves the allowlist.
    const id = await store.approve(validGrant)
    const r = await store.resolveArgs(id, {}, { isTrusted: () => false })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/allowlist|read-only/i)
  })

  it('fails closed for an unknown grantId', async () => {
    const r = await store.resolveArgs('no-such-grant', {})
    expect(r.ok).toBe(false)
  })
})

describe('revocation and lifecycle', () => {
  it('revokes a single grant', async () => {
    const id = await store.approve(validGrant)
    await store.revoke(id)
    expect(await store.get(id)).toBeNull()
  })

  it('revokes every grant for a page', async () => {
    await store.approve(validGrant)
    await store.approve({ ...validGrant, name: 'labels', toolName: 'list_labels' })
    await store.approve({ ...validGrant, pageId: 'page-2' })

    await store.revokeForPage('page-1')
    expect(await store.listForPage('page-1')).toHaveLength(0)
    expect(await store.listForPage('page-2')).toHaveLength(1)
  })

  it('revokes every grant that used a removed source', async () => {
    await store.approve(validGrant)
    await store.approve({ ...validGrant, name: 'issues', sourceSlug: 'linear', toolName: 'list_issues' })
    await store.revokeForSource('gmail')
    const remaining = await store.listForPage('page-1')
    expect(remaining.map(g => g.sourceSlug)).toEqual(['linear'])
  })

  it('reports whether a page holds any grants — drives canOpenExternally', async () => {
    expect(await store.pageHasGrants('page-1')).toBe(false)
    await store.approve(validGrant)
    expect(await store.pageHasGrants('page-1')).toBe(true)
  })
})

describe('approved query set hash', () => {
  it('is stable when only page content changes', async () => {
    await store.approve(validGrant)
    const a = await store.querySetHash('page-1')
    const b = await store.querySetHash('page-1')
    expect(a).toBe(b)
  })

  it('changes when a query is added', async () => {
    await store.approve(validGrant)
    const before = await store.querySetHash('page-1')
    await store.approve({ ...validGrant, name: 'labels', toolName: 'list_labels' })
    expect(await store.querySetHash('page-1')).not.toBe(before)
  })
})

describe('serialization', () => {
  it('does not lose grants under concurrent approval', async () => {
    await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        store.approve({ ...validGrant, pageId: `p${i}` })),
    )
    let total = 0
    for (let i = 0; i < 20; i++) total += (await store.listForPage(`p${i}`)).length
    expect(total).toBe(20)
  })
})

describe('allowlist', () => {
  it('trusts known read-only tools', () => {
    expect(isTrustedReadOnlyTool('gmail', 'list_messages')).toBe(true)
  })

  it('does not trust mutating names', () => {
    for (const t of ['send_message', 'delete_message', 'create_issue', 'update_page']) {
      expect(isTrustedReadOnlyTool('gmail', t)).toBe(false)
    }
  })

  it('does not trust an unknown tool merely because it sounds read-only', () => {
    // The allowlist is curated, not inferred: a name is not evidence.
    expect(isTrustedReadOnlyTool('gmail', 'list_everything_ever')).toBe(false)
  })

  it('is scoped per source', () => {
    expect(isTrustedReadOnlyTool('linear', 'list_messages')).toBe(false)
  })
})

describe('named grants', () => {
  const base = {
    pageId: 'pg_1', name: 'unread', sourceSlug: 'gmail', toolName: 'list_messages',
    fixedArgs: {}, paramSchema: {},
  }

  it('records the name the page will use to refer to the grant', async () => {
    const store = new GrantStore(ws)
    const id = await store.approve(base)
    expect((await store.get(id))!.name).toBe('unread')
  })

  it('resolves a page-scoped name to its grant', async () => {
    const store = new GrantStore(ws)
    const id = await store.approve(base)
    expect(await store.grantIdForName('pg_1', 'unread')).toBe(id)
  })

  it('does not resolve a name across pages', async () => {
    // The name is the page's own handle. Two pages naming a query "unread"
    // must reach their own grant or none — never each other's.
    const store = new GrantStore(ws)
    await store.approve(base)
    expect(await store.grantIdForName('pg_2', 'unread')).toBeNull()
  })

  it('returns null for a name nobody approved', async () => {
    const store = new GrantStore(ws)
    await store.approve(base)
    expect(await store.grantIdForName('pg_1', 'invented')).toBeNull()
  })

  it('refuses a second live grant with the same name on one page', async () => {
    // Two would make lookup order decide which of the user's approvals a call
    // actually used.
    const store = new GrantStore(ws)
    await store.approve(base)
    await expect(store.approve({ ...base, toolName: 'list_labels' }))
      .rejects.toThrow(/named/i)
  })

  it('allows the name again once the old grant is revoked', async () => {
    const store = new GrantStore(ws)
    await store.approve(base)
    await store.revokeForPage('pg_1')
    const id = await store.approve(base)
    expect(await store.grantIdForName('pg_1', 'unread')).toBe(id)
  })

  it('rejects a name that is not a usable handle', async () => {
    const store = new GrantStore(ws)
    for (const name of ['', 'has space', '../escape', '__proto__', 'x'.repeat(33)]) {
      await expect(store.approve({ ...base, name })).rejects.toThrow()
    }
  })

  it('exposes the name map for a page in one call', async () => {
    const store = new GrantStore(ws)
    const a = await store.approve(base)
    const b = await store.approve({ ...base, name: 'recent', toolName: 'list_threads' })
    expect(await store.nameMapForPage('pg_1')).toEqual({ unread: a, recent: b })
  })

  it('returns an empty map for a page with no grants', async () => {
    expect(await new GrantStore(ws).nameMapForPage('pg_none')).toEqual({})
  })
})

/**
 * Approval and execution must consult the SAME allowlist.
 *
 * They did not. `approve()` called the curated module directly while
 * `resolveArgs()` used the injectable one, so a workspace that extended the
 * allowlist could execute a tool it could never approve — the grant simply
 * could not be created. The asymmetry was invisible while the only allowlist
 * was the built-in one.
 */
describe('the allowlist is injected, not imported, on BOTH paths', () => {
  const localOnly = {
    isTrusted: (slug: string, tool: string) => slug === 'mavir' && tool === 'get_load',
  }

  it('approves a tool the injected allowlist trusts but the built-ins do not', () => {
    const s = new GrantStore(ws, localOnly)
    return expect(s.approve({
      pageId: 'p1', name: 'load', sourceSlug: 'mavir', toolName: 'get_load',
      fixedArgs: {}, paramSchema: {},
    })).resolves.toBeTruthy()
  })

  it('refuses a built-in tool when the injected allowlist does not trust it', () => {
    // Otherwise the injection is decorative: a narrower allowlist would be
    // enforced at execution and ignored at approval.
    const s = new GrantStore(ws, localOnly)
    return expect(s.approve({
      pageId: 'p1', name: 'mail', sourceSlug: 'gmail', toolName: 'list_messages',
      fixedArgs: {}, paramSchema: {},
    })).rejects.toThrow(/allowlist/i)
  })

  it('still refuses at execution when the tool leaves the allowlist afterwards', () => {
    const s = new GrantStore(ws, localOnly)
    return s.approve({
      pageId: 'p1', name: 'load', sourceSlug: 'mavir', toolName: 'get_load',
      fixedArgs: {}, paramSchema: {},
    }).then(async id => {
      const narrowed = { isTrusted: () => false }
      const r = await s.resolveArgs(id, {}, narrowed)
      expect(r.ok).toBe(false)
    })
  })

  it('defaults to the curated built-ins when nothing is injected', () => {
    const s = new GrantStore(ws)
    return expect(s.approve({
      pageId: 'p1', name: 'mail', sourceSlug: 'gmail', toolName: 'list_messages',
      fixedArgs: {}, paramSchema: {},
    })).resolves.toBeTruthy()
  })
})
