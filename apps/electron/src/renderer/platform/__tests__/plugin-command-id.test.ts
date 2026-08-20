import { describe, expect, it } from 'bun:test'
import { pluginCommandId } from '../omnibox-bootstrap'

describe('pluginCommandId', () => {
  it('namespaces bare plugin + bare contribute id', () => {
    expect(pluginCommandId('demo-plugin', 'hello')).toBe('siyuan-plugin:demo-plugin:hello')
  })

  it('namespaces bare plugin + dotted contribute id (never bare dotted)', () => {
    expect(pluginCommandId('demo-plugin', 'demo.hello')).toBe(
      'siyuan-plugin:demo-plugin:demo.hello',
    )
  })

  it('strips one leading siyuan-plugin: from plugin id (no double prefix)', () => {
    expect(pluginCommandId('siyuan-plugin:demo-plugin', 'run')).toBe(
      'siyuan-plugin:demo-plugin:run',
    )
    expect(pluginCommandId('siyuan-plugin:demo-plugin', 'demo.hello')).toBe(
      'siyuan-plugin:demo-plugin:demo.hello',
    )
  })

  it('does not double-prefix an already fully namespaced contribute id', () => {
    expect(pluginCommandId('demo-plugin', 'siyuan-plugin:demo-plugin:run')).toBe(
      'siyuan-plugin:demo-plugin:run',
    )
    expect(
      pluginCommandId('siyuan-plugin:demo-plugin', 'siyuan-plugin:demo-plugin:run'),
    ).toBe('siyuan-plugin:demo-plugin:run')
  })
})
