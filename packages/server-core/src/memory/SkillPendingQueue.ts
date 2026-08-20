/**
 * SkillPendingQueue — approval queue for distilled skill candidates.
 *
 * Layout (spec §4):
 *   {workspaceRoot}/skills/
 *     .pending/<slug>/{SKILL.md,.meta.json}   — candidates awaiting approval
 *     .pending/.dismissed.jsonl               — anti-repeat log of dismissals
 *     <slug>/{SKILL.md,.versions/v1-SKILL.md} — approved skills
 *
 * A candidate is approved by snapshotting its SKILL.md into `.versions/` and
 * atomically moving the directory from `.pending/` into `skills/` via rename
 * (same filesystem). loadAllSkills ignores dot-dirs, so pending candidates
 * are never picked up as real skills.
 *
 * S3 versioning: a candidate whose slug matches an already-approved skill is
 * NOT skipped — it is enqueued as an update (`.meta.json` gains `updates`
 * plus a `nextVersion` hint). Approving an update snapshots the live SKILL.md
 * into `.versions/v{N}-SKILL.md` (N = next version) before overwriting it
 * with the candidate content.
 *
 * S2 validation: fenced bash/sh blocks in the candidate body are scanned for
 * forbidden tokens by `validateSkillContent`; violations are persisted into
 * `.meta.json` and block `approve()` unless forced.
 *
 * All reads are resilient: missing/corrupt files skip the candidate instead
 * of throwing.
 */
import {
  appendFileSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
  type Dirent,
} from 'fs'
import { join } from 'path'
import type { PendingSkill, PendingSkillDiff, SkillCandidate } from '@craft-agent/shared/memory/types'
import { invalidateSkillsCache } from '@craft-agent/shared/skills/storage'
import { AuditLog } from './AuditLog'

const PENDING_DIR = '.pending'
const DISMISSED_LOG = '.dismissed.jsonl'
const VERSIONS_DIR = '.versions'

/** Normalized anti-repeat key for a candidate description. */
export function normalizeDescription(description: string): string {
  return description.trim().toLowerCase()
}

/**
 * Slugs are joined into filesystem paths in enqueue/approve/dismiss and flow
 * in from RPC clients and from LLM distillation output (user-influenced
 * transcripts). Anything outside this charset could traverse out of
 * `.pending/` (CWE-22/CWE-73) — reject hard.
 */
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,63}$/

function assertValidSlug(slug: string): void {
  if (!SLUG_RE.test(slug)) {
    throw new Error(`Invalid skill slug: ${JSON.stringify(slug)}`)
  }
}

export interface DismissedEntry {
  slug: string
  ts: string
  normalizedDescription: string
}

/**
 * S2 violation codes surfaced in .meta.json and the pending-card UI. Kept as
 * stable machine codes — the renderer maps them to localized labels.
 */
export type SkillViolationCode =
  | 'sudo'
  | 'rm-rf-root'
  | 'curl-pipe-shell'
  | 'eval'
  | 'hardcoded-secret'

export interface SkillValidationResult {
  ok: boolean
  violations: SkillViolationCode[]
}

/** Language tags whose fenced code blocks are treated as shell scripts. */
const SHELL_FENCE_RE = /```(?:bash|sh|shell|zsh)\b[^\n]*\n([\s\S]*?)(?:```|$)/gi
const SUDO_RE = /\bsudo\b/
const CURL_PIPE_SHELL_RE = /\b(?:curl|wget)\b[^\n|]*\|\s*(?:sudo\s+)?(?:bash|sh|zsh)\b/
const EVAL_RE = /\beval\b/
const HARDCODED_SECRET_RE =
  /(?:AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]{20,}|xox[baprs]-[A-Za-z0-9-]{10,}|-----BEGIN [A-Z ]*PRIVATE KEY-----)/i
const SECRET_ASSIGN_RE = /\b(?:api[_-]?key|secret|password|passwd|access[_-]?token)\b\s*=\s*["'][^"'\n]{8,}["']/i
/** rm targets that destroy the root, the user's home, or system trees. */
const RM_DANGER_TARGET_RE = /^(?:\/\*?|~(?:\/.*)?|\$\{?HOME\}?(?:\/.*)?|\/(?:bin|boot|etc|lib|opt|root|sbin|usr|var|System|Users|Applications|Library)(?:\/.*)?)$/

/**
 * Does one rm-argument string (flags + targets) request a destructive
 * recursive force-delete outside the workspace? Token-based: handles `-rf`,
 * `-fr`, split `-r -f`, and long flags.
 */
function isDangerousRm(args: string): boolean {
  const tokens = args.split(/\s+/).filter(t => t && t !== '--')
  const flags = tokens.filter(t => t.startsWith('-'))
  const targets = tokens.filter(t => !t.startsWith('-'))
  const flagChars = flags.filter(t => !t.startsWith('--')).join('')
  const hasLong = (name: string) => flags.some(t => t === `--${name}`)
  const recursive = flagChars.includes('r') || flagChars.includes('R') || hasLong('recursive')
  const forced = flagChars.includes('f') || hasLong('force')
  if (!recursive || !forced) return false
  return targets.some(t => RM_DANGER_TARGET_RE.test(t))
}

/**
 * S2: statically scan the fenced bash/sh blocks of a candidate body for
 * forbidden constructs. Pure and deterministic — same input, same verdict on
 * enqueue, approve, and in the renderer's explanation of the block.
 */
export function validateSkillContent(body: string): SkillValidationResult {
  const found = new Set<SkillViolationCode>()
  for (const match of body.matchAll(SHELL_FENCE_RE)) {
    const script = match[1]
    if (SUDO_RE.test(script)) found.add('sudo')
    if (EVAL_RE.test(script)) found.add('eval')
    if (CURL_PIPE_SHELL_RE.test(script)) found.add('curl-pipe-shell')
    if (HARDCODED_SECRET_RE.test(script) || SECRET_ASSIGN_RE.test(script)) {
      found.add('hardcoded-secret')
    }
    for (const rmMatch of script.matchAll(/\brm\s+([^#\n;&|]+)/g)) {
      if (isDangerousRm(rmMatch[1])) {
        found.add('rm-rf-root')
        break
      }
    }
  }
  const violations = [...found]
  return { ok: violations.length === 0, violations }
}

/** `v{N}-SKILL.md` numbers present in a skill's `.versions/` dir, ascending. */
function listVersionNumbers(skillDir: string): number[] {
  let names: string[]
  try {
    names = readdirSync(join(skillDir, VERSIONS_DIR))
  } catch {
    return []
  }
  const out: number[] = []
  for (const name of names) {
    const m = /^v(\d+)-SKILL\.md$/.exec(name)
    if (m) out.push(parseInt(m[1], 10))
  }
  return out.sort((a, b) => a - b)
}

/** Highest `v{N}` number in `.versions/`, or 0 when no snapshots exist. */
function latestVersionNumber(skillDir: string): number {
  const versions = listVersionNumbers(skillDir)
  return versions.length > 0 ? versions[versions.length - 1] : 0
}

function readJsonl<T>(path: string): T[] {
  let raw: string
  try {
    raw = readFileSync(path, 'utf8')
  } catch {
    return []
  }
  const out: T[] = []
  for (const line of raw.split('\n')) {
    const t = line.trim()
    if (!t) continue
    try {
      out.push(JSON.parse(t) as T)
    } catch {
      // skip corrupt line
    }
  }
  return out
}

export class SkillPendingQueue {
  /** {workspaceRoot}/skills */
  readonly skillsDir: string
  /** {workspaceRoot}/skills/.pending */
  readonly pendingDir: string
  /** Workspace-scope audit log ({workspaceRoot}/memory/audit.jsonl, spec F2). */
  private readonly audit: AuditLog

  constructor(workspaceRoot: string) {
    this.skillsDir = join(workspaceRoot, 'skills')
    this.pendingDir = join(this.skillsDir, PENDING_DIR)
    this.audit = new AuditLog('workspace', workspaceRoot)
  }

  private get dismissedPath(): string {
    return join(this.pendingDir, DISMISSED_LOG)
  }

  /**
   * Enqueue a distilled candidate. Skips (returns false) when the candidate
   * was previously dismissed or when a pending entry with the same slug
   * already exists. A slug matching an already-approved skill is NOT skipped:
   * the candidate becomes an update (`.meta.json` gains `updates` + a
   * `nextVersion` hint), approved by snapshotting the live skill into
   * `.versions/` before overwriting. Anti-repeat suppression applies to
   * updates exactly as it does to new candidates.
   *
   * S2: shell blocks of the candidate body are scanned and any violations
   * are persisted into `.meta.json` for the UI and the approve guard.
   */
  enqueue(candidate: SkillCandidate): boolean {
    // LLM-produced slugs are untrusted: invalid ones are dropped, not thrown.
    if (!SLUG_RE.test(candidate.slug)) return false
    if (this.wasDismissed(candidate.slug, candidate.description)) return false
    const dir = join(this.pendingDir, candidate.slug)
    if (existsSync(dir)) return false
    const approvedDir = join(this.skillsDir, candidate.slug)
    const isUpdate = existsSync(approvedDir)
    mkdirSync(dir, { recursive: true })
    const skillMd = `---\nname: ${candidate.slug}\ndescription: ${candidate.description.replace(/\n/g, ' ')}\n---\n\n${candidate.body.replace(/\n*$/, '\n')}`
    writeFileSync(join(dir, 'SKILL.md'), skillMd)
    const violations = validateSkillContent(candidate.body).violations
    const meta: {
      slug: string
      description: string
      source: SkillCandidate['source']
      updates?: string
      nextVersion?: number
      violations?: string[]
    } = {
      slug: candidate.slug,
      description: candidate.description,
      source: candidate.source,
    }
    if (isUpdate) {
      meta.updates = candidate.slug
      // Versions are 1-based; a skill without snapshots implicitly is v1.
      meta.nextVersion = Math.max(latestVersionNumber(approvedDir), 1) + 1
    }
    if (violations.length > 0) meta.violations = violations
    writeFileSync(join(dir, '.meta.json'), JSON.stringify(meta, null, 2))
    return true
  }

  /** All pending candidates (parsed meta + raw SKILL.md content), corrupt entries skipped. */
  list(): PendingSkill[] {
    if (!existsSync(this.pendingDir)) return []
    const out: PendingSkill[] = []
    let entries: Dirent[]
    try {
      entries = readdirSync(this.pendingDir, { withFileTypes: true })
    } catch {
      return []
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue
      const dir = join(this.pendingDir, entry.name)
      const skillPath = join(dir, 'SKILL.md')
      if (!existsSync(skillPath)) continue
      let content: string
      try {
        content = readFileSync(skillPath, 'utf8')
      } catch {
        continue
      }
      // .meta.json is optional/corrupt-tolerant: fall back to slug + dir mtime.
      let meta: {
        slug?: string
        description?: string
        source?: PendingSkill['source']
        updates?: string
        nextVersion?: number
        violations?: unknown
      } = {}
      try {
        meta = JSON.parse(readFileSync(join(dir, '.meta.json'), 'utf8'))
      } catch {
        // fall through with defaults
      }
      let ts = ''
      try {
        ts = statSync(dir).mtime.toISOString()
      } catch {
        // leave empty
      }
      // S2: candidates enqueued before validation existed (or with a hand-
      // edited SKILL.md) carry no persisted verdict — compute it so the UI
      // and approve always see the same truth.
      const persisted = Array.isArray(meta.violations)
        ? meta.violations.filter((v): v is string => typeof v === 'string')
        : []
      const violations = persisted.length > 0 ? persisted : validateSkillContent(content).violations
      const isUpdate = typeof meta.updates === 'string' && existsSync(join(this.skillsDir, entry.name))
      out.push({
        slug: typeof meta.slug === 'string' ? meta.slug : entry.name,
        description: typeof meta.description === 'string' ? meta.description : '',
        content,
        source: {
          ts: meta.source?.ts ?? ts,
          ...(meta.source?.sessionId ? { sessionId: meta.source.sessionId } : {}),
          ...(meta.source?.toolCallStats ? { toolCallStats: meta.source.toolCallStats } : {}),
        },
        ...(isUpdate
          ? {
              updates: meta.updates,
              nextVersion: Math.max(
                typeof meta.nextVersion === 'number' ? meta.nextVersion : 0,
                latestVersionNumber(join(this.skillsDir, entry.name)) + 1,
              ),
            }
          : {}),
        ...(violations.length > 0 ? { violations } : {}),
      })
    }
    return out
  }

  /**
   * Approve a candidate.
   *
   * Fresh skill: snapshot SKILL.md as `.versions/v1-SKILL.md` inside the
   * candidate dir, then atomically move the dir to
   * `{workspaceRoot}/skills/<slug>/`. Throws when the target slug already
   * exists (unless the candidate was enqueued as an update of it).
   *
   * Update candidate (meta.updates set, approved skill present): the CURRENT
   * approved SKILL.md is snapshotted to `.versions/v{N}-SKILL.md`
   * (N = next version number) BEFORE the candidate content overwrites it in
   * place, atomically (tmp + rename).
   *
   * S2: re-validated here, not trusted from `.meta.json` — throws when the
   * candidate has violations unless `opts.force` is set.
   */
  approve(slug: string, opts?: { force?: boolean }): void {
    assertValidSlug(slug)
    const src = join(this.pendingDir, slug)
    const dest = join(this.skillsDir, slug)
    const srcSkill = join(src, 'SKILL.md')
    if (!existsSync(srcSkill)) {
      throw new Error(`No pending skill candidate: ${slug}`)
    }
    const candidateContent = readFileSync(srcSkill, 'utf8')
    const { violations } = validateSkillContent(candidateContent)
    if (violations.length > 0 && !opts?.force) {
      throw new Error(
        `Skill '${slug}' failed script validation (${violations.join(', ')}); pass force=true to approve anyway`,
      )
    }
    let isUpdate = false
    if (existsSync(dest)) {
      try {
        const meta = JSON.parse(readFileSync(join(src, '.meta.json'), 'utf8'))
        isUpdate = typeof meta?.updates === 'string' && existsSync(join(dest, 'SKILL.md'))
      } catch {
        isUpdate = false
      }
    }
    if (existsSync(dest) && !isUpdate) {
      throw new Error(`Skill '${slug}' already exists in workspace`)
    }

    if (isUpdate) {
      const versionsDir = join(dest, VERSIONS_DIR)
      mkdirSync(versionsDir, { recursive: true })
      const n = latestVersionNumber(dest) + 1
      copyFileSync(join(dest, 'SKILL.md'), join(versionsDir, `v${n}-SKILL.md`))
      // Atomic in-place overwrite of the live SKILL.md (tmp + rename), so a
      // crash mid-write can never leave a truncated skill.
      const tmp = join(dest, `.SKILL.md.tmp-${process.pid}`)
      writeFileSync(tmp, candidateContent)
      renameSync(tmp, join(dest, 'SKILL.md'))
      rmSync(src, { recursive: true, force: true })
    } else {
      const versionsDir = join(src, VERSIONS_DIR)
      mkdirSync(versionsDir, { recursive: true })
      copyFileSync(srcSkill, join(versionsDir, 'v1-SKILL.md'))
      try {
        renameSync(src, dest)
      } catch (err) {
        // Restore: rename is same-filesystem atomic, so a partial dest should
        // not exist — but never trust, remove a half-moved dir if one appeared.
        try {
          if (existsSync(dest) && !existsSync(src)) renameSync(dest, src)
        } catch {
          // leave as-is; original error wins
        }
        throw err instanceof Error ? err : new Error(String(err))
      }
    }
    // Make the approved skill visible to loadAllSkills immediately instead of
    // waiting on the ConfigWatcher debounce or TTL.
    invalidateSkillsCache()
    try {
      this.audit.append({ actor: 'queue', action: 'approved', target: slug })
    } catch {
      // auditing is best-effort; the approval already landed
    }
  }

  /**
   * S3: diff payload for the pending-detail UI. Base is the latest
   * `.versions/` snapshot of the approved skill, falling back to its live
   * SKILL.md when no snapshots exist yet; null for brand-new candidates.
   * Throws when the candidate slug is unknown.
   */
  diff(slug: string): PendingSkillDiff {
    assertValidSlug(slug)
    const candidatePath = join(this.pendingDir, slug, 'SKILL.md')
    if (!existsSync(candidatePath)) {
      throw new Error(`No pending skill candidate: ${slug}`)
    }
    const candidate = readFileSync(candidatePath, 'utf8')
    const approvedDir = join(this.skillsDir, slug)
    const versions = listVersionNumbers(approvedDir)
    let base: string | null = null
    try {
      if (versions.length > 0) {
        base = readFileSync(
          join(approvedDir, VERSIONS_DIR, `v${versions[versions.length - 1]}-SKILL.md`),
          'utf8',
        )
      } else if (existsSync(join(approvedDir, 'SKILL.md'))) {
        base = readFileSync(join(approvedDir, 'SKILL.md'), 'utf8')
      }
    } catch {
      // unreadable base — treat as brand-new
      base = null
    }
    return { base, candidate }
  }

  /** Remove the candidate and log it to .dismissed.jsonl for anti-repeat. */
  dismiss(slug: string, description?: string): void {
    assertValidSlug(slug)
    const dir = join(this.pendingDir, slug)
    let desc = description
    if (desc === undefined) {
      // Recover the description from .meta.json before deleting.
      try {
        const meta = JSON.parse(readFileSync(join(dir, '.meta.json'), 'utf8'))
        if (typeof meta.description === 'string') desc = meta.description
      } catch {
        // no meta available
      }
    }
    rmSync(dir, { recursive: true, force: true })
    mkdirSync(this.pendingDir, { recursive: true })
    const entry: DismissedEntry = {
      slug,
      ts: new Date().toISOString(),
      normalizedDescription: normalizeDescription(desc ?? ''),
    }
    appendFileSync(this.dismissedPath, JSON.stringify(entry) + '\n')
    invalidateSkillsCache()
    try {
      this.audit.append({ actor: 'queue', action: 'dismissed', target: slug })
    } catch {
      // auditing is best-effort; the dismissal already landed
    }
  }

  /** Dismissed-log entries, oldest first, corrupt lines skipped. */
  dismissed(): DismissedEntry[] {
    return readJsonl<DismissedEntry>(this.dismissedPath)
      .filter(e => e && typeof e.slug === 'string')
  }

  /**
   * Anti-repeat check: has this candidate been dismissed before? Matches on
   * the slug OR the normalized description (case-insensitive, trimmed), so a
   * re-distilled candidate under a new slug is still suppressed.
   */
  wasDismissed(slug: string, description: string): boolean {
    const norm = normalizeDescription(description)
    return this.dismissed().some(
      e => e.slug === slug || (norm !== '' && e.normalizedDescription === norm),
    )
  }

  /**
   * Remove candidates older than `ttlDays` (based on .meta.json source.ts,
   * falling back to the directory mtime). Returns the pruned slugs.
   */
  prune(ttlDays = 30): string[] {
    if (!existsSync(this.pendingDir)) return []
    const cutoff = Date.now() - ttlDays * 24 * 60 * 60 * 1000
    const pruned: string[] = []
    let entries: Dirent[]
    try {
      entries = readdirSync(this.pendingDir, { withFileTypes: true })
    } catch {
      return []
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue
      const dir = join(this.pendingDir, entry.name)
      let ts = NaN
      try {
        const meta = JSON.parse(readFileSync(join(dir, '.meta.json'), 'utf8'))
        ts = Date.parse(meta?.source?.ts)
      } catch {
        // no usable meta timestamp
      }
      if (Number.isNaN(ts)) {
        try {
          ts = statSync(dir).mtimeMs
        } catch {
          continue
        }
      }
      if (ts < cutoff) {
        rmSync(dir, { recursive: true, force: true })
        pruned.push(entry.name)
      }
    }
    return pruned
  }
}
