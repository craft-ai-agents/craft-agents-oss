import { describe, expect, it } from 'bun:test'
import { Linter } from 'eslint'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const rule = require('../no-direct-navigation-state.cjs')

function runRule(code: string, filename = 'src/renderer/components/app-shell/AppShell.tsx') {
  const linter = new Linter({ configType: 'eslintrc' })
  linter.defineRule('craft-agent/no-direct-navigation-state', rule)

  return linter.verify(code, {
    parserOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
    },
    rules: {
      'craft-agent/no-direct-navigation-state': 'error',
    },
  }, { filename })
}

describe('no-direct-navigation-state (electron)', () => {
  it('flags direct setSidebarMode outside the navigation handler', () => {
    const messages = runRule("function onClick() { setSidebarMode({ type: 'sources' }) }")
    expect(messages.length).toBe(1)
    expect(messages[0]?.message).toContain("Do not call 'setSidebarMode()'")
  })

  it('allows setSidebarMode inside handleSidebarNavigate (function declaration)', () => {
    const messages = runRule(
      "function handleSidebarNavigate() { setSidebarMode({ type: 'sources' }) }",
    )
    expect(messages.length).toBe(0)
  })

  it('allows setSidebarMode inside handleSidebarNavigate (useCallback)', () => {
    const messages = runRule(
      "const handleSidebarNavigate = useCallback(() => { setSidebarMode({ type: 'sources' }) }, [])",
    )
    expect(messages.length).toBe(0)
  })

  it('does nothing when not in AppShell.tsx', () => {
    const messages = runRule(
      "function onClick() { setSidebarMode({ type: 'sources' }) }",
      'src/renderer/components/Foo.tsx',
    )
    expect(messages.length).toBe(0)
  })
})
