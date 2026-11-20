import { describe, expect, it } from 'bun:test'
import { Linter } from 'eslint'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const rule = require('../no-nonstandard-shadows.cjs')

function runRule(code: string) {
  const linter = new Linter({ configType: 'eslintrc' })
  linter.defineRule('craft-styles/no-nonstandard-shadows', rule)

  return linter.verify(code, {
    parserOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
    },
    rules: {
      'craft-styles/no-nonstandard-shadows': ['error', {
        allowedClasses: ['shadow-none', 'shadow-minimal', 'shadow-modal-small'],
        allowInlineNone: true,
      }],
    },
  })
}

describe('no-nonstandard-shadows (electron)', () => {
  it('flags disallowed shadow utility classes', () => {
    const messages = runRule('const cls = "shadow-foo"')
    expect(messages.length).toBe(1)
    expect(messages[0]?.message).toContain('Disallowed shadow class')
  })

  it('flags arbitrary shadow-[...] classes', () => {
    const messages = runRule('const cls = "shadow-[0_0_10px_red]"')
    expect(messages.length).toBe(1)
  })

  it('flags inline boxShadow style', () => {
    const messages = runRule("const style = { boxShadow: '5px 5px red' }")
    expect(messages.length).toBe(1)
    expect(messages[0]?.message).toContain('Avoid inline boxShadow')
  })

  it('allows approved shadow classes', () => {
    const messages = runRule('const cls = "shadow-minimal"')
    expect(messages.length).toBe(0)
  })

  it('allows inline boxShadow: none', () => {
    const messages = runRule("const style = { boxShadow: 'none' }")
    expect(messages.length).toBe(0)
  })
})
