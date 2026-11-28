import { describe, expect, it } from 'bun:test'
import { Linter } from 'eslint'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const rule = require('../no-direct-platform-check.cjs')

function runRule(code: string, filename = 'src/renderer/Foo.tsx') {
  const linter = new Linter({ configType: 'eslintrc' })
  linter.defineRule('craft-platform/no-direct-platform-check', rule)

  return linter.verify(code, {
    parserOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
    },
    rules: {
      'craft-platform/no-direct-platform-check': 'error',
    },
  }, { filename })
}

describe('no-direct-platform-check (electron)', () => {
  it('flags direct navigator.platform access', () => {
    const messages = runRule("const isMac = navigator.platform.toLowerCase().includes('mac')")
    expect(messages.length).toBe(1)
    expect(messages[0]?.message).toContain("Don't access 'navigator.platform'")
  })

  it('allows the platform utility source of truth', () => {
    const messages = runRule(
      "const isMac = navigator.platform.toLowerCase().includes('mac')",
      'src/renderer/lib/platform.ts',
    )
    expect(messages.length).toBe(0)
  })

  it('allows importing from @/lib/platform', () => {
    const messages = runRule("import { isMac } from '@/lib/platform'")
    expect(messages.length).toBe(0)
  })
})
