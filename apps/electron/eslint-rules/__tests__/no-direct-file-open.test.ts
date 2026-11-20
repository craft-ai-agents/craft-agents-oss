import { describe, expect, it } from 'bun:test'
import { Linter } from 'eslint'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const rule = require('../no-direct-file-open.cjs')

function runRule(code: string, filename = 'src/renderer/components/Foo.tsx') {
  const linter = new Linter({ configType: 'eslintrc' })
  linter.defineRule('craft-links/no-direct-file-open', rule)

  return linter.verify(code, {
    parserOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
    },
    rules: {
      'craft-links/no-direct-file-open': 'error',
    },
  }, { filename })
}

describe('no-direct-file-open (electron)', () => {
  it('flags direct window.electronAPI.openFile calls', () => {
    const messages = runRule("window.electronAPI.openFile(path)")
    expect(messages.length).toBe(1)
    expect(messages[0]?.message).toContain('Use onOpenFile')
  })

  it('allows the link interceptor implementation in App.tsx', () => {
    const messages = runRule(
      "window.electronAPI.openFile(path)",
      'src/renderer/App.tsx',
    )
    expect(messages.length).toBe(0)
  })

  it('allows the link interceptor fallback in useLinkInterceptor.ts', () => {
    const messages = runRule(
      "window.electronAPI.openFile(path)",
      'src/renderer/hooks/useLinkInterceptor.ts',
    )
    expect(messages.length).toBe(0)
  })
})
