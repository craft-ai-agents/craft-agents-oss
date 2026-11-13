import { describe, expect, it } from 'bun:test'
import { Linter } from 'eslint'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const rule = require('../no-inline-source-auth-check.cjs')

function runRule(code: string, filename = 'src/renderer/components/Foo.tsx') {
  const linter = new Linter({ configType: 'eslintrc' })
  linter.defineRule('craft-sources/no-inline-source-auth-check', rule)

  return linter.verify(code, {
    parserOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
    },
    rules: {
      'craft-sources/no-inline-source-auth-check': 'error',
    },
  }, { filename })
}

describe('no-inline-source-auth-check (electron)', () => {
  it('flags inline source.config.isAuthenticated checks', () => {
    const messages = runRule("if (source.config.isAuthenticated) {}")
    expect(messages.length).toBe(1)
    expect(messages[0]?.message).toContain('isSourceUsable')
  })

  it('flags enabled && isAuthenticated checks', () => {
    const messages = runRule("if (s.config.enabled && s.config.isAuthenticated) {}")
    expect(messages.length).toBe(1)
  })

  it('allows the isSourceUsable definition site', () => {
    const messages = runRule(
      "if (source.config.isAuthenticated) {}",
      'src/sources/storage.ts',
    )
    expect(messages.length).toBe(0)
  })

  it('allows credential-manager and server-builder', () => {
    expect(runRule("if (source.config.isAuthenticated) {}", 'src/sources/credential-manager.ts').length).toBe(0)
    expect(runRule("if (source.config.isAuthenticated) {}", 'src/sources/server-builder.ts').length).toBe(0)
  })
})
