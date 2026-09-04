import { afterEach, describe, expect, it } from 'bun:test'
import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { AccountSkillLibrary } from '@craft-agent/shared/skills'
import { decodeBundle, erpSkillLibrary, type Release } from '../erp-resource-bundle'

const roots: string[] = []
function temp() { const path = mkdtempSync(join(tmpdir(), 'erp-resource-test-')); roots.push(path); return path }
afterEach(() => {
  for (const root of roots.splice(0)) {
    if (!resolve(root).startsWith(`${resolve(tmpdir())}${process.platform === 'win32' ? '\\' : '/'}`)) throw new Error('Unsafe cleanup')
    rmSync(root, { recursive: true, force: true })
  }
})

const markdown = '---\nname: Public example\ndescription: Contract fixture, not a production skill\n---\nTest only.\n'
const file = (path = 'SKILL.md', content = markdown) => ({ path, base64: Buffer.from(content).toString('base64') })
function encoded(files = [file()], slug = 'example', version = '1.0.0') {
  const bundle = JSON.stringify(files)
  const release: Release = { name: `${slug}@${version}`, slug, version, content_hash: createHash('sha256').update(bundle).digest('hex') }
  return { release, bundle }
}

describe('ERP resource bundle', () => {
  it('decodes a valid signed resource bundle into a read-only skill', () => {
    const { release, bundle } = encoded()
    const result = decodeBundle(release, bundle)
    expect(result.skill.slug).toBe('example')
    expect(result.skill.visibility).toBe('public')
    expect(result.skill.readOnly).toBe(true)
    expect(result.files).toHaveLength(1)
  })

  it('rejects traversal, hidden files, invalid base64, unsafe frontmatter and missing SKILL.md', () => {
    for (const files of [
      [file(), file('../escape')], [file(), file('C:/escape')], [file(), file('a\\b')],
      [file(), file('.env')], [file(), file('credentials.json')], [file(), file('NUL.txt')],
      [file(), file('dir /file')], [file(), file('skill.md')], [file('readme.md')],
      [{ path: 'SKILL.md', base64: '!!!' }], [file('SKILL.md', 'no frontmatter')],
      [file('SKILL.md', '---\nname: [\ndescription: broken\n---')],
      [file('SKILL.md', '---javascript\n({ name: "unsafe", description: "must not execute" })\n---\nbody')],
    ]) {
      const { release, bundle } = encoded(files)
      expect(() => decodeBundle(release, bundle)).toThrow()
    }
  })

  it('combines ERP public resources with owner-private skills and observes withdrawal', async () => {
    const published = encoded()
    let releases = [published.release]
    const provider = {
      async catalog() { return releases },
      async bundle(_account: string, release: Release) {
        expect(release).toEqual(published.release)
        return decodeBundle(release, published.bundle)
      },
    }
    const root = temp()
    const privateRoot = join(root, 'alice')
    const local = new AccountSkillLibrary(join(root, 'unused-public'), privateRoot)
    local.save({ slug: 'mine', content: markdown, expectedRevision: null })

    let library = await erpSkillLibrary(provider, 'alice', privateRoot)
    expect((await library.snapshot()).skills.map(item => item.skill.slug).sort()).toEqual(['example', 'mine'])
    expect(() => library.save({ slug: 'example', content: markdown, expectedRevision: null })).toThrow('只读')
    expect(() => library.delete('example', 'any')).toThrow('只读')
    expect(existsSync(join(privateRoot, 'example'))).toBe(false)

    releases = []
    library = await erpSkillLibrary(provider, 'alice', privateRoot)
    expect((await library.snapshot()).skills.map(item => item.skill.slug)).toEqual(['mine'])
    expect(await library.get('example')).toBeNull()
  })
})
