import { afterEach, describe, expect, it } from 'bun:test'
import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { AccountSkillLibrary } from '@craft-agent/shared/skills'
import { JonworkControl, controlFromEnvironment, controlSkillLibrary } from '../jonwork-control'
import { AccountStore } from '../accounts'
import { createSessionToken } from '../auth'
import { createWebuiHandler } from '../http-server'

const roots: string[] = []
const disposers: Array<() => void> = []
function temp() { const path = mkdtempSync(join(tmpdir(), 'jw-control-test-')); roots.push(path); return path }
afterEach(() => {
  while (disposers.length) disposers.pop()!()
  for (const root of roots.splice(0)) {
    if (!resolve(root).startsWith(resolve(tmpdir()) + '\\') && !resolve(root).startsWith(resolve(tmpdir()) + '/')) throw new Error('Unsafe cleanup')
    rmSync(root, { recursive: true, force: true })
  }
})
const markdown = '---\nname: Public example\ndescription: Contract fixture, not a production skill\n---\nTest only.\n'
const file = (path = 'SKILL.md', content = markdown) => ({ path, base64: Buffer.from(content).toString('base64') })
const binding = { subscription: 'JW-SUB-001', apiKey: 'test-key', apiSecret: 'test-secret' }
function fixture(account = 'alice') {
  const calls: Array<{ method: string; body: Record<string, unknown>; init: RequestInit }> = []
  const state = {
    active: true, remaining: 25, account,
    releases: [] as Array<{ name: string; slug: string; version: string; content_hash: string }>,
    bundles: new Map<string, Record<string, unknown>>(),
    failure: false,
  }
  function publish(version = '1.0.0', files = [file()], slug = 'example') {
    const bundle_json = JSON.stringify(files)
    const release = { name: `${slug}@${version}`, slug, version, content_hash: createHash('sha256').update(bundle_json).digest('hex') }
    state.releases.push(release)
    state.bundles.set(release.name, { ...release, bundle_json })
    return release
  }
  const request = (async (_url: string | URL | Request, init: RequestInit) => {
    const method = String(_url).split('.').pop()!
    const body = JSON.parse(init.body as string)
    calls.push({ method, body, init })
    if (state.failure) return new Response('secret upstream traceback test-secret', { status: 500 })
    const message = method === 'get_entitlement'
      ? { subscription: binding.subscription, account_id: state.account, active: state.active, remaining_units: state.remaining,
          can_use: state.active && state.remaining > 0, unit: 'credit', valid_until: '2099-01-01 00:00:00', enforcement: 'ledger_only', secret_field: 'must-not-leak' }
      : method === 'public_releases' ? { schema_version: 1, releases: state.releases }
        : state.bundles.get(body.release)
    return Response.json({ message })
  }) as typeof fetch
  return { state, calls, publish, control: new JonworkControl('https://erp.example', { [account]: binding }, request) }
}

describe('optional Jonwork ERP bridge', () => {
  it('is opt-in, rejects partial config, insecure origins and shared service identities', () => {
    expect(controlFromEnvironment({})).toBeUndefined()
    expect(() => controlFromEnvironment({ JONWORK_CONTROL_URL: 'https://erp.example' })).toThrow('不完整')
    expect(() => new JonworkControl('http://erp.example', { alice: binding })).toThrow('HTTPS')
    expect(() => new JonworkControl('https://user:pass@erp.example', { alice: binding })).toThrow('HTTPS')
    expect(() => new JonworkControl('https://erp.example/path', { alice: binding })).toThrow('HTTPS')
    expect(() => new JonworkControl('https://erp.example', { alice: binding, bob: binding })).toThrow('专属')
    expect(() => new JonworkControl('https://erp.example', { alice: { subscription: 'test' } } as any)).toThrow('专属')
    expect(new JonworkControl('http://127.0.0.1:8081', { alice: binding })).toBeDefined()
  })

  it('uses only server bindings, validates the account and allowlists responses', async () => {
    const f = fixture()
    const result = await f.control.entitlement('alice')
    expect(result.remaining_units).toBe(25)
    expect(result).not.toHaveProperty('secret_field')
    expect(f.calls[0]!.body).toEqual({ subscription: binding.subscription })
    expect(f.calls[0]!.init.redirect).toBe('error')
    expect(f.calls[0]!.init.signal).toBeDefined()
    await expect(f.control.entitlement('bob')).rejects.toThrow('尚未绑定')
    expect(f.calls).toHaveLength(1)
    f.state.account = 'bob'
    await expect(f.control.entitlement('alice')).rejects.toThrow('响应无效')
  })

  it('selects numeric versions, exposes only remote public plus owner-private skills, and observes withdrawal', async () => {
    const f = fixture()
    f.publish('1.9.0')
    f.publish('1.10.0')
    const root = temp()
    const privateRoot = join(root, 'alice')
    const local = new AccountSkillLibrary(join(root, 'local-public'), privateRoot)
    local.save({ slug: 'mine', content: markdown, expectedRevision: null })
    new AccountSkillLibrary(join(root, 'local-public'), join(root, 'bob')).save({ slug: 'bob-only', content: markdown, expectedRevision: null })
    let library = await controlSkillLibrary(f.control, 'alice', privateRoot)
    let snapshot = await library.snapshot()
    expect(snapshot.skills.map(item => item.skill.slug).sort()).toEqual(['example', 'mine'])
    expect(f.calls.filter(call => call.method === 'public_release_bundle').map(call => call.body.release)).toEqual(['example@1.10.0'])
    expect(snapshot.skills.find(item => item.skill.slug === 'example')!.skill.readOnly).toBe(true)
    expect(() => library.save({ slug: 'example', content: markdown, expectedRevision: null })).toThrow('只读')
    expect(() => library.delete('example', 'any')).toThrow('只读')
    expect(existsSync(join(privateRoot, 'example'))).toBe(false)
    f.state.releases = []
    library = await controlSkillLibrary(f.control, 'alice', privateRoot)
    snapshot = await library.snapshot()
    expect(snapshot.skills.map(item => item.skill.slug)).toEqual(['mine'])
    expect(await library.get('example')).toBeNull()
  })

  it('does not overwrite or upload a private skill whose slug later becomes public', async () => {
    const f = fixture()
    const root = temp()
    const local = new AccountSkillLibrary(root, root)
    const saved = local.save({ slug: 'example', content: markdown.replace('Test only.', 'Private content.'), expectedRevision: null })
    f.publish()
    const library = await controlSkillLibrary(f.control, 'alice', root)
    expect((await library.get('example'))!.skill.visibility).toBe('private')
    expect(library.save({ slug: 'example', content: markdown, expectedRevision: saved.revision }).skill.visibility).toBe('private')
    expect(JSON.stringify(f.calls)).not.toContain('Private content')
  })

  it('rejects expired access, malformed catalogs and forged content without stale fallback', async () => {
    const f = fixture()
    f.state.active = false
    await expect(f.control.catalog('alice')).rejects.toThrow('授权')
    f.state.active = true
    const release = f.publish()
    f.state.bundles.get(release.name)!.bundle_json = '[]'
    await expect(f.control.bundle('alice', release)).rejects.toThrow('内容校验失败')
    f.state.releases.push(release)
    await expect(f.control.catalog('alice')).rejects.toThrow('响应无效')
    f.state.failure = true
    await expect(f.control.entitlement('alice')).rejects.toThrow('中控请求失败')
  })

  it('rejects unsafe paths, hidden files, duplicates, invalid base64, YAML and missing SKILL.md', async () => {
    for (const files of [
      [file(), file('../escape')], [file(), file('C:/escape')], [file(), file('a\\b')],
      [file(), file('.env')], [file(), file('credentials.json')], [file(), file('NUL.txt')],
      [file(), file('dir /file')], [file(), file('skill.md')], [file('readme.md')],
      [{ path: 'SKILL.md', base64: '!!!' }], [file('SKILL.md', 'no frontmatter')],
      [file('SKILL.md', '---\nname: [\ndescription: broken\n---')],
      [file('SKILL.md', '---javascript\n({ name: "unsafe", description: "must not execute" })\n---\nbody')],
    ]) {
      const f = fixture()
      const release = f.publish('1.0.0', files)
      await expect(f.control.bundle('alice', release)).rejects.toThrow()
    }
  })

  it('integrates authenticated desktop/browser routes without client-selected tenants or changing credits', async () => {
    const root = temp()
    let seq = 0
    const accounts = new AccountStore({ filePath: join(root, 'accounts.json'), usersRoot: join(root, 'users'), createWorkspace: () => ({ id: `ws-${++seq}` }) })
    const alice = await accounts.register('alice', 'test-password')
    const bob = await accounts.register('bob', 'test-password')
    const f = fixture(alice.id)
    f.publish()
    const secret = 'contract-test-secret'
    const token = await createSessionToken(secret, alice.id)
    const bobToken = await createSessionToken(secret, bob.id)
    const handler = createWebuiHandler({ webuiDir: root, secret, accountStore: accounts, jonworkControl: f.control,
      wsProtocol: 'ws', wsPort: 9100, getHealthCheck: () => ({ status: 'ok' }), logger: { info() {}, warn() {}, error() {} } as any })
    disposers.push(handler.dispose)
    const request = (path: string, auth = token, browser = false) => handler.fetch(new Request(`http://localhost${path}`, {
      headers: browser ? { Cookie: `craft_session=${auth}` } : { Authorization: `Bearer ${auth}` },
    }))
    expect((await handler.fetch(new Request('http://localhost/api/account/entitlement'))).status).toBe(401)
    expect((await request('/api/account/entitlement?account=bob')).status).toBe(400)
    expect((await request('/api/account/entitlement', bobToken)).status).toBe(403)
    const entitlement = await request('/api/account/entitlement', token, true)
    expect(entitlement.headers.get('cache-control')).toBe('no-store')
    expect((await entitlement.json() as { enforcement: string }).enforcement).toBe('ledger_only')
    const skills = await request('/api/account/skills')
    expect(skills.status).toBe(200)
    expect((await skills.json() as { skills: Array<{ skill: { slug: string } }> }).skills[0]!.skill.slug).toBe('example')
    expect((await request('/api/account/skills', bobToken)).status).toBe(403)
    expect((await request('/api/account/skills?account=alice')).status).toBe(400)
    f.state.failure = true
    const failure = await request('/api/account/skills')
    expect(failure.status).toBe(503)
    expect(await failure.text()).not.toContain('test-secret')
    expect(accounts.getById(alice.id)!.credits).toBe(alice.credits)
    expect(f.calls.every(call => ['get_entitlement', 'public_releases', 'public_release_bundle'].includes(call.method))).toBe(true)
  })
})
