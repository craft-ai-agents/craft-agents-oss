#!/usr/bin/env bun

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = resolve(import.meta.dir, '..')
const EN_LOCALE = resolve(ROOT, 'packages', 'shared', 'src', 'i18n', 'locales', 'en.json')
const SCAN_DIRS = ['apps', 'packages'].map((dir) => resolve(ROOT, dir))
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx'])
const IGNORED_PARTS = new Set(['node_modules', '.sandcastle', 'dist', 'build', 'out', 'release', 'coverage'])
const PLURAL_SUFFIX = /_(?:zero|one|two|few|many|other)$/

type Locale = Record<string, string>

const locale = JSON.parse(readFileSync(EN_LOCALE, 'utf-8')) as Locale
const localeKeys = new Set(Object.keys(locale))

const usedKeys = new Map<string, Set<string>>()

function addUse(key: string, file: string) {
  if (!usedKeys.has(key)) usedKeys.set(key, new Set())
  usedKeys.get(key)?.add(file)
}

function isCovered(key: string): boolean {
  if (localeKeys.has(key)) return true
  const base = key.replace(PLURAL_SUFFIX, '')
  if (base !== key && localeKeys.has(base)) return true
  return localeKeys.has(`${key}_one`) || localeKeys.has(`${key}_other`)
}

function sourceFiles(dir: string): string[] {
  const entries = readdirSync(dir)
  const files: string[] = []

  for (const entry of entries) {
    if (IGNORED_PARTS.has(entry)) continue
    const path = resolve(dir, entry)
    const stat = statSync(path)

    if (stat.isDirectory()) {
      files.push(...sourceFiles(path))
      continue
    }

    if (stat.isFile() && SOURCE_EXTENSIONS.has(path.slice(path.lastIndexOf('.')))) {
      files.push(path)
    }
  }

  return files
}

const callPattern = /(?:\bt|\bi18n\.t)\(\s*(['"`])([A-Za-z0-9_.:-]+)\1/g
const i18nKeyPattern = /\bi18nKey\s*=\s*(['"`])([A-Za-z0-9_.:-]+)\1/g

for (const dir of SCAN_DIRS) {
  for (const file of sourceFiles(dir)) {
    const source = readFileSync(file, 'utf-8')
    for (const pattern of [callPattern, i18nKeyPattern]) {
      pattern.lastIndex = 0
      let match: RegExpExecArray | null
      while ((match = pattern.exec(source))) {
        addUse(match[2], file)
      }
    }
  }
}

const missing = [...usedKeys.entries()]
  .filter(([key]) => !isCovered(key))
  .sort(([a], [b]) => a.localeCompare(b))

if (missing.length > 0) {
  console.error('i18n coverage check failed:')
  for (const [key, files] of missing.slice(0, 50)) {
    const relativeFiles = [...files].slice(0, 3).map((file) => file.slice(ROOT.length + 1)).join(', ')
    console.error(`  ${key} (${relativeFiles})`)
  }
  if (missing.length > 50) console.error(`  ...and ${missing.length - 50} more`)
  process.exit(1)
}

console.log(`i18n coverage OK (${usedKeys.size} literal keys checked)`)
