import { afterEach, describe, expect, it } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  getUrlAllowlist,
  normalizeUrlPrefixes,
  resetUrlAllowlistCacheForTests,
  setUrlAllowlist,
  urlAllowlistPath,
} from '../extension-url-allowlist'

describe('extension-url-allowlist', () => {
  let tmp: string

  afterEach(() => {
    resetUrlAllowlistCacheForTests()
    if (tmp) {
      try {
        rmSync(tmp, { recursive: true, force: true })
      } catch {
        // ignore
      }
    }
  })

  it('defaults to empty prefixes when unset', () => {
    tmp = mkdtempSync(join(tmpdir(), 'url-al-'))
    expect(getUrlAllowlist('ext-a', tmp)).toEqual([])
    expect(existsSync(urlAllowlistPath(tmp))).toBe(false)
  })

  it('set/get roundtrip and normalizes prefixes', () => {
    tmp = mkdtempSync(join(tmpdir(), 'url-al-'))
    const saved = setUrlAllowlist(
      'ext-a',
      [' https://api.example/ ', '', 'https://api.example/', '  ', 'https://cdn.example/'],
      tmp,
    )
    expect(saved).toEqual(['https://api.example/', 'https://cdn.example/'])
    expect(getUrlAllowlist('ext-a', tmp)).toEqual([
      'https://api.example/',
      'https://cdn.example/',
    ])
    expect(getUrlAllowlist('other', tmp)).toEqual([])
  })

  it('persists file shape and reloads after cache reset', () => {
    tmp = mkdtempSync(join(tmpdir(), 'url-al-'))
    setUrlAllowlist('demo', ['https://ok.test/'], tmp)
    const path = urlAllowlistPath(tmp)
    expect(existsSync(path)).toBe(true)
    const raw = JSON.parse(readFileSync(path, 'utf8')) as {
      version: number
      byExtension: Record<string, string[]>
    }
    expect(raw.version).toBe(1)
    expect(raw.byExtension).toEqual({ demo: ['https://ok.test/'] })

    resetUrlAllowlistCacheForTests()
    expect(getUrlAllowlist('demo', tmp)).toEqual(['https://ok.test/'])
  })

  it('empty set removes extension entry', () => {
    tmp = mkdtempSync(join(tmpdir(), 'url-al-'))
    setUrlAllowlist('demo', ['https://a/'], tmp)
    expect(setUrlAllowlist('demo', [], tmp)).toEqual([])
    resetUrlAllowlistCacheForTests()
    expect(getUrlAllowlist('demo', tmp)).toEqual([])
    const raw = JSON.parse(readFileSync(urlAllowlistPath(tmp), 'utf8')) as {
      byExtension: Record<string, string[]>
    }
    expect(raw.byExtension.demo).toBeUndefined()
  })

  it('normalizeUrlPrefixes drops non-strings and blanks', () => {
    expect(normalizeUrlPrefixes(['a', 1, null, '  b  ', 'a', ''])).toEqual(['a', 'b'])
    expect(normalizeUrlPrefixes(undefined)).toEqual([])
  })
})
