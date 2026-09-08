import { describe, expect, it } from 'bun:test'
import { Linter } from 'eslint'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const rule = require('../no-hardcoded-path-separator.cjs')

function runRule(code: string) {
  const linter = new Linter({ configType: 'eslintrc' })
  linter.defineRule('craft-paths/no-hardcoded-path-separator', rule)

  return linter.verify(code, {
    parserOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
    },
    rules: {
      'craft-paths/no-hardcoded-path-separator': 'warn',
    },
  })
}

describe('no-hardcoded-path-separator (electron)', () => {
  it('flags hardcoded separator inside startsWith', () => {
    const messages = runRule("filePath.startsWith(dir + '/')")
    expect(messages.length).toBe(1)
    expect(messages[0]?.message).toContain('Avoid hardcoded')
  })

  it('flags hardcoded backslash separator inside endsWith', () => {
    const messages = runRule("p.endsWith(prefix + '\\\\')")
    expect(messages.length).toBe(1)
  })

  it('allows path.sep based concatenation', () => {
    const messages = runRule("filePath.startsWith(dir + sep)")
    expect(messages.length).toBe(0)
  })

  it('allows non-path operations', () => {
    const messages = runRule("const x = 'a' + '/'")
    expect(messages.length).toBe(0)
  })
})
