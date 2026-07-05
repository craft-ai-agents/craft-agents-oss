import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// Issue #840: both Accept-Plan triggers use `asChild`, so Radix/vaul put
// `data-state="open"` on the host <button>, never on the nested chevron <svg>.
// A self-scoped `data-[state=open]:rotate-180` on the chevron therefore never
// fires. The fix scopes the rotation to a named group on the button
// (`group/accept` + `group-data-[state=open]/accept:rotate-180`). This is a
// source-text guard because packages/ui has no RTL/jsdom harness.
const files = [
  join(__dirname, '../AcceptPlanDropdown.tsx'),
  join(__dirname, '../CompactAcceptPlanDrawer.tsx'),
]

describe('Accept-Plan chevron rotates on open (issue #840)', () => {
  for (const file of files) {
    it(`${file}: trigger has group/accept and chevron uses the named group-data variant`, () => {
      const src = readFileSync(file, 'utf8')
      expect(src).toContain('group/accept')
      expect(src).toContain('group-data-[state=open]/accept:rotate-180')
      // the broken self-scoped variant must be gone
      expect(src).not.toContain('duration-150 data-[state=open]:rotate-180')
    })
  }
})
