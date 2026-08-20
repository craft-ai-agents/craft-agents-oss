import { describe, expect, it } from 'bun:test'
import { parseSshConfig } from '../ssh-config-parser.ts'

describe('parseSshConfig', () => {
  it('parses a basic host entry', () => {
    const out = parseSshConfig(
      [
        'Host myserver',
        '  HostName 10.0.0.5',
        '  User deploy',
        '  Port 2222',
        '  IdentityFile ~/.ssh/id_ed25519',
      ].join('\n'),
    )
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({
      alias: 'myserver',
      host: '10.0.0.5',
      user: 'deploy',
      port: 2222,
    })
    expect(out[0]!.identityFile).toMatch(/\.ssh\/id_ed25519$/)
    expect(out[0]!.identityFile).not.toContain('~')
  })

  it('defaults host to alias and port to 22', () => {
    const out = parseSshConfig('Host box\n  User root')
    expect(out[0]).toMatchObject({ alias: 'box', host: 'box', port: 22, user: 'root' })
  })

  it('skips wildcard-only Host patterns', () => {
    const out = parseSshConfig(
      ['Host *', '  User all', 'Host git.*', '  User git', 'Host real', '  HostName r'].join('\n'),
    )
    expect(out.map((h) => h.alias)).toEqual(['real'])
  })

  it('keeps non-wildcard aliases on a mixed Host line', () => {
    const out = parseSshConfig('Host prod prod.* backup\n  HostName h')
    expect(out.map((h) => h.alias)).toEqual(['prod', 'backup'])
  })

  it('accepts key=value form and ignores comments', () => {
    const out = parseSshConfig(['# comment', 'Host=kv', 'HostName=1.2.3.4', 'Port=22'].join('\n'))
    expect(out[0]).toMatchObject({ alias: 'kv', host: '1.2.3.4', port: 22 })
  })

  it('takes only the first IdentityFile', () => {
    const out = parseSshConfig('Host m\n  IdentityFile ~/.ssh/a\n  IdentityFile ~/.ssh/b')
    expect(out[0]!.identityFile).toMatch(/a$/)
  })

  it('ignores invalid port values', () => {
    const out = parseSshConfig('Host m\n  Port notanumber')
    expect(out[0]!.port).toBe(22)
  })

  it('does not attribute Match block options to the prior Host', () => {
    const out = parseSshConfig(
      [
        'Host real',
        '  HostName 1.2.3.4',
        'Match user deploy',
        '  User matched',
        '  Port 9999',
        'Host after',
        '  User later',
      ].join('\n'),
    )
    expect(out).toHaveLength(2)
    expect(out[0]).toMatchObject({ alias: 'real', host: '1.2.3.4', port: 22 })
    expect(out[0]!.user).toBeUndefined()
    expect(out[1]).toMatchObject({ alias: 'after', user: 'later' })
  })

  it('returns empty for empty input', () => {
    expect(parseSshConfig('')).toEqual([])
  })
})
