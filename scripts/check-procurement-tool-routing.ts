#!/usr/bin/env bun
/**
 * Hard cut: live agent contracts must not teach dead tool stacks.
 * Scans only agent-facing files (SKILL.md / AGENTS.md / references / eval cases / permissions).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = join(import.meta.dir, '..')

const FORBIDDEN = [
  'scrape-engine',
  'browserdepot',
  'engine.py',
  '--source-set direct',
  '--list-source-set',
] as const

const SKIP_DIR_NAMES = new Set(['node_modules', '__pycache__', 'tests', '.git'])

function isLiveContract(abs: string): boolean {
  const rel = relative(ROOT, abs).replace(/\\/g, '/')
  const base = rel.split('/').pop() ?? ''
  if (base === 'AGENTS.md' || base === 'SKILL.md') return true
  if (rel.includes('/references/') && base.endsWith('.md')) return true
  if (rel.startsWith('packages/eval/cases/') && (base.endsWith('.yaml') || base.endsWith('.yml'))) return true
  if (rel === 'deploy/permissions.json') return true
  return false
}

function walk(dir: string, out: string[] = []): string[] {
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return out
  }
  for (const name of entries) {
    if (SKIP_DIR_NAMES.has(name)) continue
    const p = join(dir, name)
    let st
    try {
      st = statSync(p)
    } catch {
      continue
    }
    if (st.isDirectory()) walk(p, out)
    else if (isLiveContract(p)) out.push(p)
  }
  return out
}

const files = [
  ...walk(join(ROOT, 'procurement-skills')),
  ...walk(join(ROOT, 'packages/eval/cases')),
  join(ROOT, 'deploy/permissions.json'),
]

const hits: { file: string; needle: string; line: number; text: string }[] = []

for (const file of files) {
  const rel = relative(ROOT, file).replace(/\\/g, '/')
  // 禁止栏可点名死工具；其它 live 文件零容忍
  if (rel === 'procurement-skills/TOOL-ROUTING.md') continue
  let body: string
  try {
    body = readFileSync(file, 'utf8')
  } catch {
    continue
  }
  const lines = body.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const lower = line.toLowerCase()
    for (const needle of FORBIDDEN) {
      if (lower.includes(needle.toLowerCase())) {
        hits.push({ file: rel, needle, line: i + 1, text: line.trim().slice(0, 160) })
      }
    }
  }
}

const agents = readFileSync(join(ROOT, 'procurement-skills/AGENTS.md'), 'utf8')
const requiredInAgents = [
  'larkdepot',
  'component-data',
  'procurement-local-inventory-lookup',
  'procurement-platform-search',
]
const missingAgents = requiredInAgents.filter((s) => !agents.includes(s))

const perms = readFileSync(join(ROOT, 'deploy/permissions.json'), 'utf8')
const missingPerms = ['component-data', 'larkdepot'].filter((s) => !perms.includes(s))

const substitutes = readFileSync(join(ROOT, 'packages/eval/cases/procurement-substitutes.yaml'), 'utf8')
if (!substitutes.includes('component-data')) {
  missingPerms.push('(eval substitutes missing component-data)')
}

let failed = false
if (hits.length) {
  failed = true
  console.error('procurement tool-routing: forbidden names in live contracts:\n')
  for (const h of hits) console.error(`  ${h.file}:${h.line}  [${h.needle}]  ${h.text}`)
}
if (missingAgents.length) {
  failed = true
  console.error('\nAGENTS.md missing required routes:', missingAgents.join(', '))
}
if (missingPerms.length) {
  failed = true
  console.error('\npermissions/eval missing required tools:', missingPerms.join(', '))
}
if (failed) {
  console.error('\nSingle stack only: larkdepot + component-data. No dual-track.')
  process.exit(1)
}
console.log('procurement tool-routing: OK')
