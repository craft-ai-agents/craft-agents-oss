#!/usr/bin/env bun
/**
 * check-page-sandbox.ts — guard ADR 0001 D2.
 *
 * Craft Pages sandboxes agent-authored content with a CSP *response header*
 * (`sandbox allow-scripts`). Adding an iframe `sandbox` ATTRIBUTE on top of it
 * is the natural defence-in-depth instinct and it is WRONG: measured in WS0,
 * the combination makes **WebKit execute no scripts at all** — not even the
 * first <head> script — while Chromium is unaffected. The page renders blank
 * with no error, in Safari only.
 *
 * That is a silent, browser-specific total failure that a reviewer will not
 * catch by reading a diff, so it gets a lint guard instead.
 *
 * Scope: files that render or serve Craft Pages content. Other iframes in the
 * app (html-preview, OAuth) legitimately use the attribute and are untouched.
 *
 * Exit 0 clean, 1 on violation, 2 if it cannot check (never silently pass).
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'

const ROOT = resolve(import.meta.dir ?? new URL('.', import.meta.url).pathname, '..')

/** Directories whose iframes must rely on the CSP header alone. */
const SCOPES = [
  'packages/server-core/src/pages',
  'packages/ui/src/components/pages',
  'spike/ws0-pages-security/fixtures',
]

/** Individual files elsewhere that render a Craft Page. */
const EXTRA_FILES = [
  'packages/ui/src/components/markdown/CraftPageBlock.tsx',
]

const EXT = /\.(?:ts|tsx|js|jsx|html)$/

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist') continue
    const full = join(dir, name)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (EXT.test(name)) out.push(full)
  }
  return out
}

/**
 * Find an iframe tag carrying a sandbox attribute. Matches both HTML and JSX,
 * across newlines, and tolerates attributes in any order.
 */
function findViolations(content: string): Array<{ line: number; text: string }> {
  const hits: Array<{ line: number; text: string }> = []
  const tagRe = /<iframe\b[^>]*>/gis
  let m: RegExpExecArray | null
  while ((m = tagRe.exec(content)) !== null) {
    const tag = m[0]
    if (!/\bsandbox\b/i.test(tag)) continue
    const line = content.slice(0, m.index).split('\n').length
    hits.push({ line, text: tag.replace(/\s+/g, ' ').slice(0, 120) })
  }
  return hits
}

function main(): void {
  const files = [
    ...SCOPES.flatMap(s => walk(join(ROOT, s))),
    ...EXTRA_FILES.map(f => join(ROOT, f)).filter(f => existsSync(f)),
  ]

  // A guard that checks nothing must not report success. If every scope is
  // missing, the paths have moved and the guard is stale.
  const anyScopeExists = SCOPES.some(s => existsSync(join(ROOT, s)))
    || EXTRA_FILES.some(f => existsSync(join(ROOT, f)))
  if (!anyScopeExists) {
    console.error('ERROR: no Craft Pages scopes found — check-page-sandbox.ts is stale.')
    console.error('Scopes searched:')
    for (const s of [...SCOPES, ...EXTRA_FILES]) console.error(`  ${s}`)
    process.exit(2)
  }

  const violations: string[] = []
  for (const file of files) {
    for (const v of findViolations(readFileSync(file, 'utf-8'))) {
      violations.push(`${file.slice(ROOT.length + 1)}:${v.line}\n    ${v.text}`)
    }
  }

  if (violations.length > 0) {
    console.error('ERROR: iframe "sandbox" attribute in Craft Pages content:\n')
    for (const v of violations) console.error(`  ${v}\n`)
    console.error('Craft Pages sandboxes via the CSP response header (sandbox allow-scripts).')
    console.error('Adding the iframe attribute as well makes WebKit run NO scripts at all —')
    console.error('a blank page in Safari, with no error, while Chromium looks fine.')
    console.error('See docs/adr/0001-craft-pages-trust-model.md (D2) and')
    console.error('spike/ws0-pages-security/FINDINGS.md (section 0).')
    process.exit(1)
  }

  console.log(`OK: no iframe sandbox attribute in Craft Pages content (${files.length} files checked).`)
}

main()
