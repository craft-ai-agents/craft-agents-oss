import { afterEach, describe, expect, it } from 'bun:test'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { outputHashes, verifyBuildStamp } from '../desktop-build-stamp'
import { DESKTOP_RELEASE, requireShareServerUrl, validateDesktopReleaseConfig } from '../../packages/shared/src/deployment'
import { validateProductionRelease } from '../validate-desktop-release'

const base = { schemaVersion: 1, channel: 'internal', accountServerUrl: '', allowCustomAccountServer: true,
  updatesEnabled: false, updateServerUrl: '', sharingEnabled: false, shareServerUrl: '' }
const temporaryRoots: string[] = []
afterEach(() => { temporaryRoots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true })) })

describe('independent desktop releases', () => {
  it('fails closed for unconfigured outbound services', () => {
    expect(validateDesktopReleaseConfig(base).updatesEnabled).toBe(false)
    if (!DESKTOP_RELEASE.sharingEnabled) expect(requireShareServerUrl).toThrow('未启用公开分享')
    expect(() => validateDesktopReleaseConfig({ ...base, updatesEnabled: true })).toThrow()
    expect(() => validateDesktopReleaseConfig({ ...base, sharingEnabled: true })).toThrow()
  })
  it('rejects upstream, plaintext, credential-bearing and placeholder endpoints', () => {
    for (const url of ['http://service.test', 'https://thecraftagents.com', 'https://a.craft.do', 'https://example.com',
      'https://user:pass@service.test', 'https://service.test?token=x', 'https://service.test/path', 'https://localhost']) {
      expect(() => validateDesktopReleaseConfig({ ...base, accountServerUrl: url })).toThrow()
    }
    expect(() => validateDesktopReleaseConfig({ ...base, apiKey: 'not-a-real-secret' })).toThrow()
  })
  it('requires production endpoints and signing without exposing values', () => {
    expect(() => validateProductionRelease(base, {}, 'win32')).toThrow('channel=production')
    const config = { ...base, channel: 'production', accountServerUrl: 'https://v2.jonwork.com', updatesEnabled: true,
      updateServerUrl: 'https://v2.jonwork.com/desktop/updates/' }
    expect(() => validateProductionRelease(config, {}, 'win32')).toThrow('signing')
    expect(() => validateProductionRelease(config, { CSC_LINK: 'test-certificate-path' }, 'win32')).not.toThrow()
    expect(() => validateProductionRelease(config, { CSC_LINK: 'test', SLACK_OAUTH_CLIENT_SECRET: 'test-value' }, 'win32')).toThrow('server-side OAuth broker')
    expect(() => validateProductionRelease(config, { CSC_LINK: 'test', CRAFT_DEV_RUNTIME: '1' }, 'win32')).toThrow('Development')
    expect(() => validateProductionRelease(config, { CSC_LINK: 'test' }, 'darwin')).toThrow('notarization')
    expect(() => validateProductionRelease({ ...config, updateServerUrl: 'https://download.jonwork.com/desktop/updates/' }, { CSC_LINK: 'test' }, 'win32')).toThrow('v2.jonwork.com')
  })
  it('rejects mismatched release profiles and changed build artifacts', () => {
    const root = mkdtempSync(join(tmpdir(), 'jonwork-release-stamp-')); temporaryRoots.push(root)
    const dist = join(root, 'apps/electron/dist')
    mkdirSync(join(dist, 'renderer'), { recursive: true })
    mkdirSync(join(root, 'packages/shared/src'), { recursive: true })
    const config = JSON.stringify(base)
    const profile = join(root, 'packages/shared/src/desktop-release.json')
    writeFileSync(profile, config)
    for (const file of ['main.cjs', 'bootstrap-preload.cjs', 'renderer/index.html']) writeFileSync(join(dist, file), 'test build')
    writeFileSync(join(dist, 'release-build.json'), JSON.stringify({ schemaVersion: 1,
      profileHash: createHash('sha256').update(config).digest('hex'), outputs: outputHashes(root) }))
    expect(() => verifyBuildStamp(root)).not.toThrow()
    writeFileSync(profile, JSON.stringify({ ...base, allowCustomAccountServer: false }))
    expect(() => verifyBuildStamp(root)).toThrow('profile changed')
    writeFileSync(profile, config)
    writeFileSync(join(dist, 'main.cjs'), 'changed output')
    expect(() => verifyBuildStamp(root)).toThrow('output changed')
  })
})
