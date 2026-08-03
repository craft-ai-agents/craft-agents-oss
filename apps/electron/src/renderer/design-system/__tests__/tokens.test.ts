import { describe, expect, test } from 'bun:test'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const DS_DIR = join(import.meta.dir, '..')
const CSS_FILES = ['tokens.css', 'typography.css', 'motion.css', 'elevation.css']

const readCss = (name: string) => readFileSync(join(DS_DIR, name), 'utf8')
const allCss = () => CSS_FILES.map(readCss).join('\n')

describe('design tokens', () => {
  test('every css module is present', () => {
    const present = readdirSync(DS_DIR)
    for (const file of CSS_FILES) expect(present).toContain(file)
  })

  test('declares the semantic groups the shell depends on', () => {
    const css = allCss()
    const required = [
      '--ds-canvas',
      '--ds-panel',
      '--ds-text',
      '--ds-command-surface',
      '--ds-state-running',
      '--ds-mode-owner-auto',
      '--ds-media-image',
      '--ds-z-modal',
      '--ds-elevation-3',
      '--ds-duration-fast',
      '--ds-font-mono',
    ]
    for (const token of required) expect(css).toContain(token)
  })
})

describe('token discipline', () => {
  // The brand ramp is the ONLY place literal colours may appear. Everything
  // else must derive from theme vars so light/dark/scenic keep working.
  test('literal colours are confined to the brand ramp and dark overrides', () => {
    const lines = readCss('tokens.css').split('\n')
    const offenders: string[] = []

    for (const line of lines) {
      const decl = line.trim()
      if (!decl.startsWith('--') || decl.startsWith('--brand-')) continue
      // oklch(1 0 0) / oklch(0.99 0 0) are neutral white anchors used for
      // mixing; anything else with raw chroma is a hardcoded colour.
      const literal = decl.match(/oklch\([^)]*\)/g) ?? []
      for (const value of literal) {
        const isNeutral = /oklch\(\s*(0?\.99|1)\s+0\s+0\s*\)/.test(value)
        if (!isNeutral) offenders.push(decl)
      }
      if (/#[0-9a-fA-F]{3,8}\b/.test(decl) || /\brgba?\(/.test(decl)) offenders.push(decl)
    }

    expect(offenders).toEqual([])
  })

  test('no hardcoded z-index values outside the scale', () => {
    const css = allCss()
    const zIndexes = css.match(/z-index:\s*\d+/g) ?? []
    expect(zIndexes).toEqual([])
  })
})
