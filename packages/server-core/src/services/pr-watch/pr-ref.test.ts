import { describe, expect, it } from 'bun:test'
import { parsePrReference } from './pr-ref'

const FALLBACK = { host: 'github.com', owner: 'me', repo: 'proj' }

describe('parsePrReference', () => {
  it('parses a full PR URL (any host; trailing path and .git ok)', () => {
    expect(parsePrReference('https://github.com/acme/app/pull/7')).toEqual({ host: 'github.com', owner: 'acme', repo: 'app', number: 7 })
    expect(parsePrReference('https://ghe.corp/acme/app/pull/12/files')).toEqual({ host: 'ghe.corp', owner: 'acme', repo: 'app', number: 12 })
    expect(parsePrReference('https://github.com/acme/app.git/pull/9')).toEqual({ host: 'github.com', owner: 'acme', repo: 'app', number: 9 })
  })

  it('lower-cases the host from a URL', () => {
    expect(parsePrReference('https://GitHub.com/Acme/App/pull/3')?.host).toBe('github.com')
  })

  it('parses owner/repo refs, inheriting only the host from the fallback', () => {
    expect(parsePrReference('acme/app#5', FALLBACK)).toEqual({ host: 'github.com', owner: 'acme', repo: 'app', number: 5 })
    expect(parsePrReference('acme/app/pull/5')).toEqual({ host: 'github.com', owner: 'acme', repo: 'app', number: 5 })
    expect(parsePrReference('acme/app/5')).toMatchObject({ owner: 'acme', repo: 'app', number: 5 })
  })

  it('parses a bare number only with a fallback repo', () => {
    expect(parsePrReference('7', FALLBACK)).toEqual({ host: 'github.com', owner: 'me', repo: 'proj', number: 7 })
    expect(parsePrReference('#7', FALLBACK)).toEqual({ host: 'github.com', owner: 'me', repo: 'proj', number: 7 })
    expect(parsePrReference('7')).toBeNull()
  })

  it('returns null for junk and incomplete refs', () => {
    expect(parsePrReference('not a pr')).toBeNull()
    expect(parsePrReference('')).toBeNull()
    expect(parsePrReference('https://github.com/acme/app')).toBeNull()
    expect(parsePrReference('acme/app')).toBeNull()
  })
})
