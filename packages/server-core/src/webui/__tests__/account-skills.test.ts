import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AccountSkillLibrary, materializeAccountSkills, setAccountSkillRoots, loadAllSkills, loadSkillBySlug, type AccountSkillBundle } from '@craft-agent/shared/skills'
import { AccountStore } from '../accounts'
import { createWebuiHandler } from '../http-server'
import { createSessionToken } from '../auth'

const roots: string[] = []
const dispose: Array<() => void> = []
const markdown = (name: string) => `---\nname: ${name}\ndescription: Test skill\n---\n\nInstructions for ${name}.\n`
const temp = () => { const root = mkdtempSync(join(tmpdir(), 'jonwork-skill-test-')); roots.push(root); return root }
afterEach(() => {
  setAccountSkillRoots(null)
  while (dispose.length) dispose.pop()!()
  while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true })
})

describe('account skill ownership', () => {
  it('shares public skills, isolates private skills, and rejects stale writes', () => {
    const root = temp()
    const publicRoot = join(root, 'public')
    mkdirSync(join(publicRoot, 'shared'), { recursive: true })
    writeFileSync(join(publicRoot, 'shared', 'SKILL.md'), markdown('Public'))
    const alice = new AccountSkillLibrary(publicRoot, join(root, 'alice'))
    const bob = new AccountSkillLibrary(publicRoot, join(root, 'bob'))
    const first = alice.save({ slug: 'private', content: markdown('Alice'), expectedRevision: null })
    expect(bob.get('private')).toBeNull()
    expect(bob.get('shared')?.skill.readOnly).toBe(true)
    expect(() => bob.save({ slug: 'shared', content: markdown('Changed'), expectedRevision: null })).toThrow('只读')
    expect(() => bob.delete('shared', bob.get('shared')!.revision)).toThrow('只读')
    alice.save({ slug: 'private', content: markdown('Updated'), expectedRevision: first.revision })
    expect(() => alice.save({ slug: 'private', content: markdown('Stale'), expectedRevision: first.revision })).toThrow('其他设备')
    expect(() => alice.delete('private', first.revision)).toThrow('其他设备')
    alice.delete('private', alice.get('private')!.revision)
    expect(alice.get('private')).toBeNull()
    expect(existsSync(join(root, 'alice', '.trash'))).toBe(true)
  })

  it('rejects traversal, junction escapes and confidential attachments', () => {
    const root = temp()
    const publicRoot = join(root, 'public')
    const privateRoot = join(root, 'private')
    const library = new AccountSkillLibrary(publicRoot, privateRoot)
    for (const slug of ['..', '../other', '..\\other', '/absolute', 'C:\\file']) expect(() => library.get(slug)).toThrow()
    library.save({ slug: 'safe', content: markdown('Safe'), expectedRevision: null })
    writeFileSync(join(privateRoot, 'safe', '.env'), 'FAKE_TEST_VALUE')
    writeFileSync(join(privateRoot, 'safe', 'credentials.json'), 'FAKE_TEST_VALUE')
    expect(library.get('safe')!.files.map(file => file.path)).toEqual(['SKILL.md'])
    const outside = join(root, 'outside')
    mkdirSync(outside)
    writeFileSync(join(outside, 'SKILL.md'), markdown('Other account'))
    symlinkSync(outside, join(privateRoot, 'linked'), process.platform === 'win32' ? 'junction' : 'dir')
    expect(() => library.get('linked')).toThrow('符号链接')
    expect(library.snapshot().skills.map(bundle => bundle.skill.slug)).toEqual(['safe'])
  })

  it('materializes only the active cloud library for desktop execution', () => {
    const root = temp()
    const alice = new AccountSkillLibrary(join(root, 'public'), join(root, 'alice'))
    alice.save({ slug: 'alice-skill', content: markdown('Alice'), expectedRevision: null })
    const snapshot = alice.snapshot()
    setAccountSkillRoots(materializeAccountSkills(snapshot, join(root, 'cache-alice')))
    expect(loadAllSkills(root).map(skill => skill.slug)).toEqual(['alice-skill'])
    expect(loadSkillBySlug(root, 'alice-skill')?.metadata.name).toBe('Alice')
    setAccountSkillRoots(materializeAccountSkills({ skills: [] }, join(root, 'cache-bob')))
    expect(loadAllSkills(root)).toEqual([])
    expect(loadSkillBySlug(root, 'alice-skill')).toBeNull()
    snapshot.skills[0]!.files.push({ path: '../../escape', base64: 'aGVsbG8=' })
    expect(() => materializeAccountSkills(snapshot, join(root, 'cache-invalid'))).toThrow('无效')
  })

  it('uses the same library for desktop bearer tokens and browser cookies', async () => {
    const root = temp()
    let sequence = 0
    const store = new AccountStore({ filePath: join(root, 'accounts.json'), usersRoot: join(root, 'users'), createWorkspace: () => ({ id: `ws-${++sequence}` }) })
    const alice = await store.register('alice', 'test-password')
    const bob = await store.register('bob', 'test-password')
    const secret = 'test-only-skill-library-secret'
    const aliceToken = await createSessionToken(secret, alice.id)
    const bobToken = await createSessionToken(secret, bob.id)
    const handler = createWebuiHandler({ webuiDir: root, secret, accountStore: store, publicSkillsRoot: join(root, 'public'), wsProtocol: 'ws', wsPort: 9100, getHealthCheck: () => ({ status: 'ok' }), logger: { info() {}, warn() {}, error() {} } as any })
    dispose.push(handler.dispose)
    const request = (token: string, desktop: boolean, path: string, method = 'GET', body?: unknown, origin?: string) => handler.fetch(new Request(`http://localhost/api/account/skills${path}`, {
      method,
      headers: { ...(desktop ? { Authorization: `Bearer ${token}` } : { Cookie: `craft_session=${token}` }), ...(origin ? { Origin: origin } : {}), 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }))
    expect((await handler.fetch(new Request('http://localhost/api/account/skills'))).status).toBe(401)
    expect((await request(aliceToken, true, '/mine', 'PUT', { content: markdown('Mine'), expectedRevision: null })).status).toBe(200)
    const browser = await request(aliceToken, false, '/mine')
    expect(browser.status).toBe(200)
    const bundle = await browser.json() as AccountSkillBundle
    expect(bundle.skill.visibility).toBe('private')
    expect(bundle.skill.path).not.toContain(root)
    expect((await request(bobToken, false, '/mine')).status).toBe(404)
    expect((await request(bobToken, true, '/mine', 'DELETE', { expectedRevision: bundle.revision })).status).toBe(404)
    expect((await request(bobToken, false, `?workspaceId=${alice.workspaceId}`)).status).toBe(400)
    expect((await request(aliceToken, false, '/mine', 'PUT', { content: markdown('CSRF'), expectedRevision: bundle.revision }, 'https://evil.example')).status).toBe(403)
    expect((await request(aliceToken, false, '/mine', 'PUT', { content: markdown('Browser edit'), expectedRevision: bundle.revision })).status).toBe(200)
    const updatedBundle = await (await request(aliceToken, true, '/mine')).json() as AccountSkillBundle
    expect(updatedBundle.skill.metadata.name).toBe('Browser edit')
  })
})
