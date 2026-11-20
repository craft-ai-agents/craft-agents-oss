import { describe, expect, it } from 'bun:test'
import { Linter } from 'eslint'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const rule = require('../no-localstorage.cjs')

function runRule(code: string) {
  const linter = new Linter({ configType: 'eslintrc' })
  linter.defineRule('craft-agent/no-localstorage', rule)

  return linter.verify(code, {
    parserOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
    },
    rules: {
      'craft-agent/no-localstorage': 'warn',
    },
  })
}

describe('no-localstorage (electron)', () => {
  it('flags localStorage.getItem', () => {
    const messages = runRule("localStorage.getItem('key')")
    expect(messages.length).toBe(1)
    expect(messages[0]?.message).toContain('Avoid localStorage')
  })

  it('flags localStorage.setItem', () => {
    const messages = runRule("localStorage.setItem('key', 'value')")
    expect(messages.length).toBe(1)
  })

  it('flags window.localStorage access', () => {
    const messages = runRule("window.localStorage.getItem('key')")
    expect(messages.length).toBeGreaterThanOrEqual(1)
  })

  it('allows file-based preferences via electronAPI', () => {
    const messages = runRule("window.electronAPI.readPreferences()")
    expect(messages.length).toBe(0)
  })
})
