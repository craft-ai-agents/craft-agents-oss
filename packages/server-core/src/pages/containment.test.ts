import { describe, expect, it, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir, homedir } from 'node:os'
import { realpathSync } from 'node:fs'
import { realpath } from 'node:fs/promises'
import { resolveWithinPublicRoot, isReadMethod } from './containment.ts'

let root: string
let publicRoot: string
let outside: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'craft-contain-'))
  publicRoot = join(root, 'revisions', '1', 'public')
  mkdirSync(join(publicRoot, 'assets'), { recursive: true })
  writeFileSync(join(publicRoot, 'index.html'), '<h1>ok</h1>')
  writeFileSync(join(publicRoot, 'assets', 'logo.png'), 'png')
  // A sibling file the page must never be able to reach.
  outside = join(root, 'page.json')
  writeFileSync(outside, '{"secret":true}')
})
afterEach(() => { rmSync(root, { recursive: true, force: true }) })

describe('legitimate requests', () => {
  it('serves a file', async () => {
    const r = await resolveWithinPublicRoot(publicRoot, 'index.html')
    expect(r.ok).toBe(true)
  })

  it('serves a nested asset', async () => {
    const r = await resolveWithinPublicRoot(publicRoot, 'assets/logo.png')
    expect(r.ok).toBe(true)
  })

  it('maps an empty path and a trailing slash to index.html', async () => {
    for (const p of ['', '/']) {
      const r = await resolveWithinPublicRoot(publicRoot, p)
      expect(r.ok).toBe(true)
      if (r.ok) expect(r.absolutePath.endsWith('index.html')).toBe(true)
    }
  })
})

describe('traversal', () => {
  it('rejects literal ../', async () => {
    const r = await resolveWithinPublicRoot(publicRoot, '../../page.json')
    expect(r.ok).toBe(false)
  })

  it('rejects single-encoded traversal', async () => {
    const r = await resolveWithinPublicRoot(publicRoot, '%2e%2e%2f%2e%2e%2fpage.json')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.status).toBe(400)
  })

  it('rejects DOUBLE-encoded traversal rather than normalising it', async () => {
    // %252e%252e decodes once to %2e%2e — a second decode would yield "..".
    // Decoding once and then refusing any remaining "%" is what stops this.
    const r = await resolveWithinPublicRoot(publicRoot, '%252e%252e%252fpage.json')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.status).toBe(400)
  })

  it('rejects malformed percent-encoding', async () => {
    const r = await resolveWithinPublicRoot(publicRoot, '%zz')
    expect(r.ok).toBe(false)
  })

  it('rejects backslash traversal (Windows separator)', async () => {
    const r = await resolveWithinPublicRoot(publicRoot, '..%5c..%5cpage.json')
    expect(r.ok).toBe(false)
  })

  it('rejects NUL', async () => {
    expect((await resolveWithinPublicRoot(publicRoot, 'index.html%00.png')).ok).toBe(false)
  })

  it('rejects ADS / drive-relative colons', async () => {
    expect((await resolveWithinPublicRoot(publicRoot, 'index.html::%24DATA')).ok).toBe(false)
  })
})

describe('symlink escape — the reason validateFilePath is unsuitable', () => {
  it('rejects a symlinked FILE pointing outside the root', async () => {
    symlinkSync(outside, join(publicRoot, 'leak.json'))
    const r = await resolveWithinPublicRoot(publicRoot, 'leak.json')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toContain('symlink')
  })

  it('rejects a symlinked DIRECTORY component mid-path', async () => {
    // Only checking the final resolved path would miss this: the last segment
    // is an ordinary file, but it is reached through a symlinked directory.
    symlinkSync(root, join(publicRoot, 'up'))
    const r = await resolveWithinPublicRoot(publicRoot, 'up/page.json')
    expect(r.ok).toBe(false)
  })

  it('rejects a symlink into the real home directory', async () => {
    // The concrete WS0 scenario: validateFilePath accepts this because the
    // resolved target lives under homedir().
    symlinkSync(homedir(), join(publicRoot, 'home'))
    const r = await resolveWithinPublicRoot(publicRoot, 'home/.craft-agent/credentials.enc')
    expect(r.ok).toBe(false)
  })
})

describe('metadata, dotfiles, listings', () => {
  it('never escapes to the manifest one level above public/', async () => {
    writeFileSync(join(publicRoot, 'page.json'), '{}')
    const r = await resolveWithinPublicRoot(publicRoot, 'page.json')
    // Canonicalise with the SAME api the guard uses (fs/promises realpath), not
    // realpathSync. They disagree on Windows about 8.3 short names — the
    // runner's tmpdir is C:\Users\RUNNER~1\… and one of the two expands it to
    // \runneradmin\ while the other does not. Comparing across the two APIs
    // tests which realpath Node happened to use, not containment.
    const realPublic = await realpath(publicRoot)
    expect(r.ok).toBe(true)
    if (r.ok) {
      if (!r.absolutePath.startsWith(realPublic)) {
        throw new Error(
          `resolved path escaped the root:\n  resolved: ${r.absolutePath}\n  root:     ${realPublic}`,
        )
      }
      expect(r.absolutePath).not.toBe(await realpath(outside))
    }
  })

  it('rejects dotfiles', async () => {
    writeFileSync(join(publicRoot, '.env'), 'SECRET=1')
    expect((await resolveWithinPublicRoot(publicRoot, '.env')).ok).toBe(false)
  })

  it('resolves an extensionless path to its index.html (pretty URLs)', async () => {
    // The reference site uses /en/ style URLs and links routinely drop the
    // trailing slash, so this must work rather than 400.
    mkdirSync(join(publicRoot, 'en'), { recursive: true })
    writeFileSync(join(publicRoot, 'en', 'index.html'), '<h1>en</h1>')
    for (const p of ['en', 'en/']) {
      const r = await resolveWithinPublicRoot(publicRoot, p)
      expect(r.ok).toBe(true)
      if (r.ok) expect(r.absolutePath.endsWith(join('en', 'index.html'))).toBe(true)
    }
  })

  it('does not serve a directory listing when there is no index.html', async () => {
    // `assets/` has files but no index.html — must 404, never enumerate.
    const r = await resolveWithinPublicRoot(publicRoot, 'assets')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.status).toBe(404)
  })

  it('404s a missing file', async () => {
    const r = await resolveWithinPublicRoot(publicRoot, 'nope.html')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.status).toBe(404)
  })

  it('404s when the revision directory does not exist', async () => {
    const r = await resolveWithinPublicRoot(join(root, 'revisions', '99', 'public'), 'index.html')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.status).toBe(404)
  })
})

describe('isReadMethod', () => {
  it('permits only GET and HEAD', () => {
    expect(isReadMethod('GET')).toBe(true)
    expect(isReadMethod('HEAD')).toBe(true)
    for (const m of ['POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS']) {
      expect(isReadMethod(m)).toBe(false)
    }
  })
})
