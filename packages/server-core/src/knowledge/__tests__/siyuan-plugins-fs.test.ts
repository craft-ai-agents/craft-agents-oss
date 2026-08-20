/**
 * Filesystem feed for installed SiYuan plugins + conf.json api.token readers.
 */
import { afterEach, describe, expect, it } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  __setSiyuanDataDirCandidatesForTests,
  candidateSiyuanConfPaths,
  candidateSiyuanDataDirs,
  findSiyuanConfPaths,
  findSiyuanDataDirs,
  listInstalledPluginManifests,
  listInstalledPluginsFromFilesystem,
  readFirstSiyuanApiTokenFromConf,
  readPetalsEnabledMap,
  readSiyuanApiTokenFromConf,
} from '../siyuan-plugins-fs'

function makeTempDataDir(): string {
  const root = mkdtempSync(join(tmpdir(), 'craft-siyuan-data-'))
  mkdirSync(join(root, 'plugins'), { recursive: true })
  mkdirSync(join(root, 'storage', 'petal'), { recursive: true })
  return root
}

function writePlugin(dataDir: string, name: string, body: Record<string, unknown>): void {
  const dir = join(dataDir, 'plugins', name)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'plugin.json'), JSON.stringify(body), 'utf8')
}

let prevConfPaths: string | undefined

afterEach(() => {
  __setSiyuanDataDirCandidatesForTests(null)
  if (prevConfPaths === undefined) delete process.env.CRAFT_SIYUAN_CONF_PATHS
  else process.env.CRAFT_SIYUAN_CONF_PATHS = prevConfPaths
  prevConfPaths = undefined
})
describe('candidateSiyuanDataDirs / findSiyuanDataDirs', () => {
  it('returns platform candidates and only existing dirs from find', () => {
    const candidates = candidateSiyuanDataDirs(process.platform)
    expect(Array.isArray(candidates)).toBe(true)
    expect(candidates.length).toBeGreaterThan(0)
    const found = findSiyuanDataDirs(process.platform)
    expect(Array.isArray(found)).toBe(true)
    for (const p of found) {
      expect(candidates).toContain(p)
    }
  })

  it('honors test override for candidates', () => {
    const dir = makeTempDataDir()
    try {
      __setSiyuanDataDirCandidatesForTests([dir, join(dir, 'missing')])
      expect(candidateSiyuanDataDirs()).toEqual([dir, join(dir, 'missing')])
      expect(findSiyuanDataDirs()).toEqual([dir])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('honors empty override [] as forced empty (no platform fallback)', () => {
    __setSiyuanDataDirCandidatesForTests([])
    expect(candidateSiyuanDataDirs()).toEqual([])
    expect(findSiyuanDataDirs()).toEqual([])
    expect(listInstalledPluginsFromFilesystem()).toEqual([])
  })
})

describe('listInstalledPluginManifests + petals', () => {
  it('lists N manifests and merges petals enabled flags', () => {
    const dataDir = makeTempDataDir()
    try {
      writePlugin(dataDir, 'alpha-plugin', {
        name: 'alpha-plugin',
        version: '1.0.0',
        craft: { level: 2 },
      })
      writePlugin(dataDir, 'beta-plugin', {
        name: 'beta-plugin',
        version: '2.0.0',
      })
      writePlugin(dataDir, 'broken-plugin', { notAPlugin: true })
      writeFileSync(
        join(dataDir, 'storage', 'petal', 'petals.json'),
        JSON.stringify([
          { name: 'alpha-plugin', enabled: false, version: '1.0.0' },
          { name: 'beta-plugin', enabled: true, version: '2.0.0' },
        ]),
        'utf8',
      )

      const manifests = listInstalledPluginManifests(dataDir)
      expect(manifests.map((m) => m.name).sort()).toEqual(['alpha-plugin', 'beta-plugin'])
      expect(manifests.find((m) => m.name === 'alpha-plugin')?.craft?.level).toBe(2)

      const petals = readPetalsEnabledMap(dataDir)
      expect(petals.get('alpha-plugin')).toBe(false)
      expect(petals.get('beta-plugin')).toBe(true)

      __setSiyuanDataDirCandidatesForTests([dataDir])
      const feed = listInstalledPluginsFromFilesystem()
      expect(feed).toHaveLength(2)
      const alpha = feed.find((f) => f.manifest.name === 'alpha-plugin')
      expect(alpha?.petalsEnabled).toBe(false)
      expect(feed.find((f) => f.manifest.name === 'beta-plugin')?.petalsEnabled).toBe(true)
    } finally {
      rmSync(dataDir, { recursive: true, force: true })
    }
  })

  it('skips malformed plugin.json and missing plugins dir', () => {
    const dataDir = makeTempDataDir()
    try {
      writePlugin(dataDir, 'good', { name: 'good', version: '0.1.0' })
      const badDir = join(dataDir, 'plugins', 'bad')
      mkdirSync(badDir, { recursive: true })
      writeFileSync(join(badDir, 'plugin.json'), '{not-json', 'utf8')

      const manifests = listInstalledPluginManifests(dataDir)
      expect(manifests).toHaveLength(1)
      expect(manifests[0]?.name).toBe('good')

      expect(listInstalledPluginManifests(join(dataDir, 'nope'))).toEqual([])
    } finally {
      rmSync(dataDir, { recursive: true, force: true })
    }
  })
})

describe('readSiyuanApiTokenFromConf', () => {
  it('reads api.token and prefers loopback serverAddrs', () => {
    const root = mkdtempSync(join(tmpdir(), 'craft-siyuan-conf-'))
    try {
      const confPath = join(root, 'conf.json')
      writeFileSync(
        confPath,
        JSON.stringify({
          api: { token: 'test-token-value' },
          serverAddrs: ['http://192.168.1.10:6806', 'http://127.0.0.1:6806'],
        }),
        'utf8',
      )
      const hit = readSiyuanApiTokenFromConf(confPath)
      expect(hit).not.toBeNull()
      expect(hit!.token).toBe('test-token-value')
      expect(hit!.baseUrl).toBe('http://127.0.0.1:6806')
      expect(hit!.confPath).toBe(confPath)
      // Never embed token in confPath / baseUrl strings accidentally
      expect(hit!.baseUrl.includes('test-token-value')).toBe(false)
      expect(hit!.confPath.includes('test-token-value')).toBe(false)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('returns null for empty token / missing file / malformed json', () => {
    const root = mkdtempSync(join(tmpdir(), 'craft-siyuan-conf-empty-'))
    try {
      const emptyTok = join(root, 'empty.json')
      writeFileSync(emptyTok, JSON.stringify({ api: { token: '   ' } }), 'utf8')
      expect(readSiyuanApiTokenFromConf(emptyTok)).toBeNull()

      const noApi = join(root, 'no-api.json')
      writeFileSync(noApi, JSON.stringify({ system: {} }), 'utf8')
      expect(readSiyuanApiTokenFromConf(noApi)).toBeNull()

      const bad = join(root, 'bad.json')
      writeFileSync(bad, '{nope', 'utf8')
      expect(readSiyuanApiTokenFromConf(bad)).toBeNull()

      expect(readSiyuanApiTokenFromConf(join(root, 'missing.json'))).toBeNull()
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('findSiyuanConfPaths honors CRAFT_SIYUAN_CONF_PATHS exclusive override', () => {
    const root = mkdtempSync(join(tmpdir(), 'craft-siyuan-conf-paths-'))
    try {
      const confPath = join(root, 'conf.json')
      writeFileSync(confPath, JSON.stringify({ api: { token: 'from-env-path' } }), 'utf8')
      prevConfPaths = process.env.CRAFT_SIYUAN_CONF_PATHS
      process.env.CRAFT_SIYUAN_CONF_PATHS = confPath

      expect(candidateSiyuanConfPaths()).toEqual([confPath])
      expect(findSiyuanConfPaths()).toEqual([confPath])

      const first = readFirstSiyuanApiTokenFromConf()
      expect(first?.token).toBe('from-env-path')
      expect(first?.baseUrl).toMatch(/^http:\/\/127\.0\.0\.1:6806$/)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
