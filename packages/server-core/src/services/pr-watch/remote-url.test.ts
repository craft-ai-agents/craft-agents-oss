import { describe, expect, it } from 'bun:test'
import { graphqlEndpoint, parseRemoteUrl } from './remote-url'

describe('parseRemoteUrl', () => {
  it('parses the forms git accepts', () => {
    const expected = { host: 'github.com', owner: 'craft-ai-agents', repo: 'craft-agents' }
    expect(parseRemoteUrl('git@github.com:craft-ai-agents/craft-agents.git')).toEqual(expected)
    expect(parseRemoteUrl('git@github.com:craft-ai-agents/craft-agents')).toEqual(expected)
    expect(parseRemoteUrl('https://github.com/craft-ai-agents/craft-agents.git')).toEqual(expected)
    expect(parseRemoteUrl('https://github.com/craft-ai-agents/craft-agents')).toEqual(expected)
    expect(parseRemoteUrl('https://x-access-token:abc@github.com/craft-ai-agents/craft-agents.git')).toEqual(expected)
    expect(parseRemoteUrl('ssh://git@github.com/craft-ai-agents/craft-agents.git')).toEqual(expected)
    expect(parseRemoteUrl('ssh://git@github.com:22/craft-ai-agents/craft-agents.git')).toEqual(expected)
    expect(parseRemoteUrl('git://github.com/craft-ai-agents/craft-agents.git')).toEqual(expected)
    expect(parseRemoteUrl('  https://GitHub.com/craft-ai-agents/craft-agents/  ')).toEqual(expected)
  })

  it('keeps enterprise hosts and repo names with dots', () => {
    expect(parseRemoteUrl('git@ghe.acme.io:platform/api.v2.git')).toEqual({ host: 'ghe.acme.io', owner: 'platform', repo: 'api.v2' })
  })

  it('rejects what is not owner/repo on a host', () => {
    expect(parseRemoteUrl('/Users/me/repos/local-mirror')).toBeNull()
    expect(parseRemoteUrl('file:///tmp/repo.git')).toBeNull()
    expect(parseRemoteUrl('https://gitlab.com/group/subgroup/repo.git')).toBeNull()
    expect(parseRemoteUrl('')).toBeNull()
  })
})

describe('graphqlEndpoint', () => {
  it('uses api.github.com for github.com and /api/graphql for enterprise', () => {
    expect(graphqlEndpoint('github.com')).toBe('https://api.github.com/graphql')
    expect(graphqlEndpoint('ghe.acme.io')).toBe('https://ghe.acme.io/api/graphql')
  })
})
