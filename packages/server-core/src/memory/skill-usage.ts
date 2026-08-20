/**
 * Skill usage metrics (spec S4), prune/archive, and team export (spec T1).
 *
 * Usage ledger: {workspaceRoot}/skills/.usage.jsonl — append-only JSONL, one
 * record per session spawn whose prompt carried skill mentions:
 *   {"ts":"...","sessionId":"...","skills":["slug",...]}
 *
 * Written by the SessionManager provenance hunk (spec F4): skills attach
 * per-message as [skill:slug] mentions (sessions and CoreBackendConfig carry
 * no per-session skills list), so the prompt-hit set is recovered from the
 * session's own message contents — exactly what the prompt assembly resolved.
 *
 * Both sidecars (.usage.jsonl file, .archive/ dir) live inside the skills
 * directory: the shared loader skips dot-entries (the .pending/.versions
 * precedent), so metrics and archived skills stay invisible to loadAllSkills.
 *
 * Sync fs on purpose: payloads are tiny, writes are append-only, and the
 * skills storage layer (shared/skills/storage.ts) is sync throughout.
 */
import { appendFileSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync } from 'fs'
import { dirname, join, resolve, sep } from 'path'
import { listSkillSlugs, invalidateSkillsCache } from '@craft-agent/shared/skills'
import { getWorkspaceSkillsPath } from '@craft-agent/shared/workspaces'
import type { SkillExportResult, SkillPruneResult, SkillUsageMap } from '@craft-agent/shared/memory/types'
import { AuditLog } from './AuditLog'

/** Same grammar as SkillPendingQueue: lowercase slug, the on-disk folder name. */
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,63}$/

/**
 * [skill:slug] and workspace-prefixed [skill:<wsId>:slug] mentions — mirrors
 * the strip regex in domain/title-sanitizer.ts and the parser shapes used at
 * dispatch time. Captures only the slug segment.
 */
const SKILL_MENTION_RE = /\[skill:(?:[a-z0-9-]+:)?([\w-]+)\]/g

/** One append-only usage record in skills/.usage.jsonl. */
export interface SkillUsageRecord {
  ts: string
  sessionId: string
  skills: string[]
}

export interface PruneOptions {
  /** Age cutoff for the computed candidate list (default 30). */
  olderThanDays?: number
  /** Explicit slugs to archive; when omitted, candidates are computed from the ledger. */
  slugs?: string[]
  /** Audit sink (tests inject one); defaults to the workspace audit log. */
  audit?: AuditLog
}

/** Absolute path of the workspace's usage ledger. */
export function getUsagePath(workspaceRoot: string): string {
  return join(getWorkspaceSkillsPath(workspaceRoot), '.usage.jsonl')
}

/**
 * Unique skill slugs mentioned as [skill:slug] / [skill:ws:slug] across the
 * given message contents. Lowercased + slug-validated, sorted for stability.
 */
export function extractSkillMentions(contents: Iterable<string | undefined | null>): string[] {
  const slugs = new Set<string>()
  for (const content of contents) {
    if (!content || !content.includes('[skill:')) continue
    SKILL_MENTION_RE.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = SKILL_MENTION_RE.exec(content)) !== null) {
      const slug = match[1].toLowerCase()
      if (SLUG_RE.test(slug)) slugs.add(slug)
    }
  }
  return [...slugs].sort((a, b) => a.localeCompare(b))
}

/**
 * Append one usage record. No-op for empty/invalid skill sets. Throws on fs
 * errors by design — the callsite (SessionManager) wraps it in the same
 * try/catch that guards writeProvenance.
 */
export function appendSkillUsage(workspaceRoot: string, sessionId: string, skills: string[]): void {
  const unique = [...new Set(skills.map(s => s.toLowerCase()).filter(s => SLUG_RE.test(s)))].sort((a, b) => a.localeCompare(b))
  if (unique.length === 0) return
  const filePath = getUsagePath(workspaceRoot)
  mkdirSync(dirname(filePath), { recursive: true })
  const record: SkillUsageRecord = { ts: new Date().toISOString(), sessionId, skills: unique }
  appendFileSync(filePath, JSON.stringify(record) + '\n', 'utf-8')
}

/**
 * Aggregate the ledger per slug: spawn count + most recent hit. Missing or
 * unreadable file → empty map; corrupt lines are skipped (JSONL convention
 * across memory stores). Reads are uncached — the panel polls and the volume
 * is small.
 */
export function readUsage(workspaceRoot: string): SkillUsageMap {
  const filePath = getUsagePath(workspaceRoot)
  if (!existsSync(filePath)) return {}
  let content: string
  try {
    content = readFileSync(filePath, 'utf-8')
  } catch {
    return {}
  }
  const usage: SkillUsageMap = {}
  for (const line of content.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    let parsed: Partial<SkillUsageRecord>
    try {
      parsed = JSON.parse(trimmed)
    } catch {
      continue
    }
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.skills)) continue
    const ts = typeof parsed.ts === 'string' ? parsed.ts : ''
    const slugs = new Set(parsed.skills.filter((s): s is string => typeof s === 'string' && SLUG_RE.test(s)))
    for (const slug of slugs) {
      const entry = usage[slug] ?? { used: 0, lastUsedAt: '' }
      entry.used += 1
      // ISO 8601 strings compare correctly lexicographically.
      if (ts > entry.lastUsedAt) entry.lastUsedAt = ts
      usage[slug] = entry
    }
  }
  return usage
}

/**
 * S4 prune: move unused workspace skills into skills/.archive/<slug>/ — never
 * delete. An explicit `slugs` list is archived as-is (the panel already
 * confirmed); without one, candidates are computed as installed skills with
 * no ledger hit newer than `olderThanDays` (30 by default). Each archived
 * slug lands in the workspace audit log as {actor:'queue', action:'delete',
 * detail:'archived'} — the action vocabulary lessons already use for removal.
 */
export function pruneUnusedSkills(workspaceRoot: string, opts: PruneOptions = {}): SkillPruneResult {
  const olderThanDays = typeof opts.olderThanDays === 'number' && opts.olderThanDays > 0 ? opts.olderThanDays : 30
  const skillsDir = getWorkspaceSkillsPath(workspaceRoot)
  const archiveDir = join(skillsDir, '.archive')
  let slugs = opts.slugs
  if (!slugs) {
    const usage = readUsage(workspaceRoot)
    const cutoff = Date.now() - olderThanDays * 24 * 60 * 60 * 1000
    slugs = listSkillSlugs(workspaceRoot).filter((slug) => {
      const stats = usage[slug]
      return !stats || Date.parse(stats.lastUsedAt) <= cutoff
    })
  }
  const archived: string[] = []
  const skipped: string[] = []
  const audit = opts.audit ?? new AuditLog('workspace', workspaceRoot)
  for (const slug of slugs) {
    if (typeof slug !== 'string' || !SLUG_RE.test(slug)) {
      skipped.push(slug)
      continue
    }
    const src = join(skillsDir, slug)
    if (!existsSync(src) || !statSync(src).isDirectory()) {
      skipped.push(slug)
      continue
    }
    let target = join(archiveDir, slug)
    if (existsSync(target)) {
      // Re-archive after a manual restore: keep both, suffix with the move ts.
      target = `${target}.${new Date().toISOString().replace(/[:.]/g, '-')}`
    }
    try {
      mkdirSync(archiveDir, { recursive: true })
      renameSync(src, target)
    } catch {
      skipped.push(slug)
      continue
    }
    archived.push(slug)
    try {
      audit.append({ actor: 'queue', action: 'delete', target: slug, detail: 'archived' })
    } catch {
      // auditing is best-effort; the archive move already landed
    }
  }
  if (archived.length > 0) invalidateSkillsCache()
  return { archived, skipped }
}

/** Recursively compare two directories (relative file sets + byte equality). */
function dirsIdentical(a: string, b: string): boolean {
  const listFiles = (root: string): string[] => {
    const out: string[] = []
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const abs = join(dir, entry.name)
        if (entry.isDirectory()) walk(abs)
        else if (entry.isFile()) out.push(abs.slice(root.length + 1))
      }
    }
    walk(root)
    return out.sort((a, b) => a.localeCompare(b))
  }
  const filesA = listFiles(a)
  const filesB = listFiles(b)
  if (filesA.length !== filesB.length) return false
  for (let i = 0; i < filesA.length; i++) {
    if (filesA[i] !== filesB[i]) return false
    const bufA = readFileSync(join(a, filesA[i]))
    const bufB = readFileSync(join(b, filesB[i]))
    if (!bufA.equals(bufB)) return false
  }
  return true
}

/**
 * T1 team export: copy {workspace}/skills/<slug> → {projectRoot}/.agents/skills/<slug>
 * (project scope is natively supported by the loader). Guards:
 * - slug must be a valid skill slug (no traversal);
 * - projectRoot must be an existing directory; all writes stay strictly
 *   beneath it (resolve + containment check);
 * - an existing target is left untouched iff its content is byte-identical
 *   (idempotent re-export); a differing target is refused, never overwritten.
 */
export function exportSkillToProject(workspaceRoot: string, slug: string, projectRoot: string): SkillExportResult {
  if (typeof slug !== 'string' || !SLUG_RE.test(slug)) {
    throw new Error(`Invalid skill slug: ${JSON.stringify(slug)}`)
  }
  const src = join(getWorkspaceSkillsPath(workspaceRoot), slug)
  if (!existsSync(join(src, 'SKILL.md'))) {
    throw new Error(`Skill not found in workspace: ${slug}`)
  }
  if (typeof projectRoot !== 'string' || projectRoot.length === 0) {
    throw new Error('projectRoot is required')
  }
  const resolvedRoot = resolve(projectRoot)
  if (!existsSync(resolvedRoot) || !statSync(resolvedRoot).isDirectory()) {
    throw new Error(`projectRoot is not an existing directory: ${projectRoot}`)
  }
  const targetParent = join(resolvedRoot, '.agents', 'skills')
  const target = join(targetParent, slug)
  // Defense in depth: the join can never escape projectRoot with a sanitized
  // slug, but assert containment before touching the filesystem.
  if (target !== resolvedRoot && !target.startsWith(resolvedRoot + sep)) {
    throw new Error(`Refusing to write outside projectRoot: ${target}`)
  }
  if (existsSync(target)) {
    if (dirsIdentical(src, target)) return { slug, path: target, alreadyExisted: true }
    throw new Error(`Refusing to overwrite a different skill already present at ${target}`)
  }
  mkdirSync(targetParent, { recursive: true })
  cpSync(src, target, { recursive: true })
  return { slug, path: target, alreadyExisted: false }
}
