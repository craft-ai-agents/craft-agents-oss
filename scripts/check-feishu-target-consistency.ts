#!/usr/bin/env bun
/**
 * Catches config drift between SKILL.md / dispatch automation prompts and the
 * Feishu base registry (deploy/feishu-bases.json). Root-caused 2026-07-09:
 * SKILL.md's write target was corrected from a retired base back to the real
 * one, but deploy/dispatch-automations.json (a prod cron prompt, previously
 * unversioned) still hardcoded the retired token — nothing caught the drift
 * until the demand table was found empty. Same shape as
 * check-procurement-tool-routing.ts (scan live contracts, grep, fail loud),
 * but the needles here are Feishu base_token values instead of tool names.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = join(import.meta.dir, '..')
const SKIP_DIR_NAMES = new Set(['node_modules', '__pycache__', 'tests', '.git'])

type BaseEntry = {
  name: string
  role: 'write_target' | 'reference_only' | 'retired'
  owner_skill?: string
  retired_reason?: string
}

const registry = JSON.parse(readFileSync(join(ROOT, 'deploy/feishu-bases.json'), 'utf8')) as {
  bases: Record<string, BaseEntry>
}
const knownTokens = Object.keys(registry.bases)
// base_token 形状：实测 27 位字母数字混大小写（LclTbYAOia6es1sdFbacDCgKnld 等）——
// 留一点余量（25-30）防止未来 token 长度微调，但仍够窄不会误伤普通英文单词/路径
const TOKEN_RE = /\b([A-Za-z][A-Za-z0-9]{24,29})\b/g

function isLiveContract(abs: string): boolean {
  const rel = relative(ROOT, abs).replace(/\\/g, '/')
  const base = rel.split('/').pop() ?? ''
  if (base === 'AGENTS.md' || base === 'SKILL.md') return true
  if (rel.includes('/references/') && base.endsWith('.md')) return true
  if (rel === 'deploy/dispatch-automations.json') return true
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

const files = [...walk(join(ROOT, 'procurement-skills')), join(ROOT, 'deploy/dispatch-automations.json')]

// 只在"看起来是在真正当参数值用"的行上判定——base-token/base_token/larkdepot --app 关键词、
// 或 JSON 的 "base_token": 键。纯叙事散文提历史(如 SKILL.md 的"架构订正"说明段)不含这些
// 关键词，天然不会命中，不需要额外的豁免名单。
const USAGE_RE = /--base-token|--app\b|base[-_]token\s*[=:]/i

type Hit = { file: string; line: number; token: string; text: string }
const unknown: Hit[] = []
const retired: Hit[] = []
// skill 目录 -> 该目录里出现过的 write_target token 集合，用来抓"同一个 skill 目录下两个不同写目标互相矛盾"
const writeTargetsBySkillDir = new Map<string, Set<string>>()

for (const file of files) {
  const rel = relative(ROOT, file).replace(/\\/g, '/')
  let body: string
  try {
    body = readFileSync(file, 'utf8')
  } catch {
    continue
  }
  const skillDir = rel.startsWith('procurement-skills/') ? rel.split('/')[1] : '(deploy)'
  const lines = body.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (!USAGE_RE.test(line)) continue
    for (const m of line.matchAll(TOKEN_RE)) {
      const token = m[1]
      const hit: Hit = { file: rel, line: i + 1, token, text: line.trim().slice(0, 160) }
      if (!knownTokens.includes(token)) {
        unknown.push(hit)
        continue
      }
      const entry = registry.bases[token]
      if (entry.role === 'retired') {
        retired.push(hit)
      } else if (entry.role === 'write_target') {
        if (!writeTargetsBySkillDir.has(skillDir)) writeTargetsBySkillDir.set(skillDir, new Set())
        writeTargetsBySkillDir.get(skillDir)!.add(token)
      }
    }
  }
}

let failed = false

if (retired.length) {
  failed = true
  console.error('feishu-target-consistency: retired base_token referenced in live contract:\n')
  for (const h of retired) {
    const entry = registry.bases[h.token]
    console.error(`  ${h.file}:${h.line}  [${h.token}] ${entry.name} (retired: ${entry.retired_reason ?? '?'})`)
    console.error(`    ${h.text}`)
  }
}

if (unknown.length) {
  failed = true
  console.error('\nfeishu-target-consistency: unregistered base_token-shaped value near "base_token":\n')
  for (const h of unknown) {
    console.error(`  ${h.file}:${h.line}  [${h.token}]`)
    console.error(`    ${h.text}`)
  }
  console.error('\n  Register it in deploy/feishu-bases.json first (or it is a typo).')
}

for (const [skillDir, tokens] of writeTargetsBySkillDir) {
  if (tokens.size > 1) {
    failed = true
    console.error(`\nfeishu-target-consistency: ${skillDir} references ${tokens.size} different write_target bases: ${[...tokens].join(', ')}`)
    console.error('  A skill should have exactly one write target — pick one and fix the rest.')
  }
}

if (failed) {
  console.error('\nSee deploy/feishu-bases.json for the registry.')
  process.exit(1)
}
console.log('feishu-target-consistency: OK')
