import { describe, expect, it } from 'bun:test'

describe('network proxy helpers', () => {
  it('bypasses exact hosts and subdomains from noProxy rules', async () => {
    const { parseNoProxyRules, shouldBypassProxy } = await import('../network-proxy-utils')
    const rules = parseNoProxyRules('localhost,.internal.example.com,example.com')

    expect(shouldBypassProxy(new URL('http://localhost:3000'), rules)).toBe(true)
    expect(shouldBypassProxy(new URL('https://api.internal.example.com'), rules)).toBe(true)
    expect(shouldBypassProxy(new URL('https://example.com'), rules)).toBe(true)
    expect(shouldBypassProxy(new URL('https://sub.example.com'), rules)).toBe(true)
    expect(shouldBypassProxy(new URL('https://example.net'), rules)).toBe(false)
  })

  it('respects port-scoped rules and wildcard bypass', async () => {
    const { parseNoProxyRules, shouldBypassProxy } = await import('../network-proxy-utils')
    const portRules = parseNoProxyRules('localhost:6152,[::1]:8080')

    expect(shouldBypassProxy(new URL('http://localhost:6152'), portRules)).toBe(true)
    expect(shouldBypassProxy(new URL('http://localhost:6153'), portRules)).toBe(false)
    expect(shouldBypassProxy(new URL('http://[::1]:8080'), portRules)).toBe(true)

    const wildcardRules = parseNoProxyRules('*')
    expect(shouldBypassProxy(new URL('https://anything.example.com'), wildcardRules)).toBe(true)
  })

  it('does not treat IP literals as domain suffix matches', async () => {
    const { parseNoProxyRules, shouldBypassProxy } = await import('../network-proxy-utils')
    const rules = parseNoProxyRules('0.0.1,10.0.0.1')

    expect(shouldBypassProxy(new URL('http://10.0.0.1'), rules)).toBe(true)
    expect(shouldBypassProxy(new URL('http://10.0.0.2'), rules)).toBe(false)
  })
})
