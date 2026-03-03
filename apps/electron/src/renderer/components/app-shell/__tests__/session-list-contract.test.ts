import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'fs'
import { resolve } from 'path'

/**
 * Contract tests for SessionList changes.
 *
 * We verify the source code directly rather than importing the component,
 * since its deep dependency tree includes modules (pdfjs-dist) incompatible
 * with the Bun test runner.
 */
describe('SessionList contract', () => {
  const filePath = resolve(import.meta.dir, '../SessionList.tsx')
  const source = readFileSync(filePath, 'utf-8')

  it('does not accept onSearchClose prop', () => {
    // The prop was removed from the interface
    expect(source).not.toContain('onSearchClose')
  })

  it('always renders SessionSearchHeader (not conditional on searchActive)', () => {
    // Previously: {searchActive && <SessionSearchHeader .../>}
    // Now: <SessionSearchHeader .../> is always in the JSX (inside header prop)
    expect(source).toContain('<SessionSearchHeader')
    // Ensure there is no pattern like `{searchActive && (\n...<SessionSearchHeader`
    // that would make SessionSearchHeader conditional
    expect(source).not.toMatch(/\{searchActive\s*&&\s*\(\s*\n\s*<SessionSearchHeader/)
    expect(source).not.toMatch(/\{searchActive\s*&&\s*<SessionSearchHeader/)
  })

  it('imports SessionSearchHeader', () => {
    expect(source).toContain("import { SessionSearchHeader }")
  })
})
