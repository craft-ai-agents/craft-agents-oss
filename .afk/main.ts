#!/usr/bin/env bun
/**
 * AFK agent loop — local version of the sandcastle pattern.
 *
 * Each iteration:
 *  1. Planner  — reads open issues, picks unblocked ready-for-agent work
 *  2. Implement + Review — runs in parallel git worktrees (max MAX_PARALLEL)
 *  3. Merger   — merges completed branches back to main
 *
 * Network resilience:
 *  - If a branch already has commits from a prior interrupted run, the
 *    implement+review phase is skipped and we go straight to push retry.
 *  - git push is retried up to PUSH_RETRIES times with exponential backoff.
 *  - Stale branches are only deleted when they have no commits (truly empty).
 */

import { execFileSync, execSync } from 'child_process'
import { readFileSync } from 'fs'
import { join, resolve } from 'path'

function parseArg(flag: string, fallback: number): number {
  const idx = process.argv.indexOf(flag)
  if (idx !== -1 && process.argv[idx + 1]) {
    const n = parseInt(process.argv[idx + 1], 10)
    if (!isNaN(n) && n > 0) return n
  }
  return fallback
}

const MAX_ITERATIONS = parseArg('--iterations', 10)
const MAX_PARALLEL = parseArg('--parallel', 4)
const PUSH_RETRIES = 3
const CLAUDE_RETRIES = 3
const ROOT = resolve(import.meta.dir, '..')
const PROMPTS = import.meta.dir

// ── helpers ──────────────────────────────────────────────────────────────────

function sh(cmd: string, args: string[], cwd: string, stdio?: 'pipe' | 'inherit'): string {
  return execFileSync(cmd, args, {
    cwd,
    encoding: 'utf8',
    stdio: stdio ? [stdio, stdio, stdio] : ['pipe', 'pipe', 'pipe'],
  }) as string
}

function pushWithRetry(branch: string, cwd: string): void {
  for (let attempt = 1; attempt <= PUSH_RETRIES; attempt++) {
    try {
      sh('git', ['push', '-u', 'origin', branch], cwd, 'pipe')
      return
    } catch (err: any) {
      if (attempt === PUSH_RETRIES) throw err
      const delayMs = attempt * 3000
      console.log(`  push failed, retrying in ${delayMs / 1000}s… (${attempt}/${PUSH_RETRIES})`)
      Bun.sleepSync(delayMs)
    }
  }
}

function branchExists(branch: string, cwd: string): boolean {
  try {
    sh('git', ['rev-parse', '--verify', branch], cwd)
    return true
  } catch {
    return false
  }
}

function branchCommits(branch: string, cwd: string): string[] {
  try {
    const log = sh('git', ['log', '--format=%H', `main..${branch}`], cwd).trim()
    return log ? log.split('\n').filter(Boolean) : []
  } catch {
    return []
  }
}

function loadPrompt(name: string, cwd: string, args: Record<string, string> = {}): string {
  let content = readFileSync(join(PROMPTS, `${name}.md`), 'utf8')

  // Substitute args first so !`cmd` blocks can reference {{KEY}} placeholders
  for (const [key, value] of Object.entries(args)) {
    content = content.replaceAll(`{{${key}}}`, value)
  }

  // Then evaluate !`command` blocks from trusted prompt files
  content = content.replace(/!\`([^`]+)\`/g, (_, cmd) => {
    try {
      return execSync(cmd, { cwd, encoding: 'utf8' }).trim()
    } catch {
      return ''
    }
  })

  return content
}

function runClaude(label: string, prompt: string, cwd: string): { stdout: string } {
  for (let attempt = 1; attempt <= CLAUDE_RETRIES; attempt++) {
    console.log(`  [${label}] starting… (attempt ${attempt}/${CLAUDE_RETRIES})`)
    try {
      const stdout = execFileSync(
        'claude',
        ['--print', '--dangerously-skip-permissions', '--model', 'claude-sonnet-4-5', '--effort', 'medium'],
        {
          input: prompt,
          cwd,
          encoding: 'utf8',
          timeout: 12 * 60 * 60 * 1000,
          maxBuffer: 100 * 1024 * 1024,
        }
      ) as string
      console.log(`  [${label}] done.`)
      return { stdout }
    } catch (err: any) {
      console.error(`  [${label}] attempt ${attempt} failed: ${err.message}`)
      if (attempt === CLAUDE_RETRIES) return { stdout: err.stdout ?? '' }
      const delayMs = attempt * 5000
      console.log(`  [${label}] retrying in ${delayMs / 1000}s…`)
      Bun.sleepSync(delayMs)
    }
  }
  return { stdout: '' }
}

function newCommits(cwd: string): string[] {
  try {
    const log = sh('git', ['log', '--format=%H', 'HEAD', '^origin/main'], cwd).trim()
    return log ? log.split('\n').filter(Boolean) : []
  } catch {
    try {
      return sh('git', ['log', '--format=%H', '-5', 'HEAD'], cwd)
        .trim().split('\n').filter(Boolean)
    } catch {
      return []
    }
  }
}

// ── semaphore ─────────────────────────────────────────────────────────────────

function makeSemaphore(limit: number) {
  let running = 0
  const queue: (() => void)[] = []

  const acquire = (): Promise<void> =>
    running < limit
      ? (running++, Promise.resolve())
      : new Promise<void>((resolve) => queue.push(resolve))

  const release = () => {
    running--
    const next = queue.shift()
    if (next) { running++; next() }
  }

  return { acquire, release }
}

// ── main loop ─────────────────────────────────────────────────────────────────

for (let i = 1; i <= MAX_ITERATIONS; i++) {
  console.log(`\n=== Iteration ${i}/${MAX_ITERATIONS} ===\n`)

  // Phase 1 — Plan
  const plan = runClaude('Planner', loadPrompt('plan-prompt', ROOT), ROOT)

  const planMatch = plan.stdout.match(/<plan>([\s\S]*?)<\/plan>/)
  if (!planMatch) {
    throw new Error('Planner did not produce a <plan> tag.\n\n' + plan.stdout)
  }

  const { issues } = JSON.parse(planMatch[1]) as {
    issues: { number: number; title: string; branch: string }[]
  }

  if (issues.length === 0) {
    console.log('No unblocked issues. Exiting.')
    break
  }

  console.log(`${issues.length} issue(s) to work on:`)
  for (const issue of issues) {
    console.log(`  #${issue.number}: ${issue.title} → ${issue.branch}`)
  }

  // Phase 2 — Implement + Review in parallel worktrees
  const sem = makeSemaphore(MAX_PARALLEL)

  const settled = await Promise.allSettled(
    issues.map(async (issue) => {
      await sem.acquire()

      const wtPath = join(ROOT, '..', `craft-afk-${issue.number}`)

      try {
        // Resume: if branch already has commits from a prior interrupted run,
        // skip implement+review and go straight to push retry.
        const existingCommits = branchExists(issue.branch, ROOT)
          ? branchCommits(issue.branch, ROOT)
          : []

        if (existingCommits.length > 0) {
          console.log(`  #${issue.number}: resuming — ${existingCommits.length} existing commit(s), retrying push…`)
          pushWithRetry(issue.branch, ROOT)
          return { issue, commits: existingCommits }
        }

        // Fresh start: clean up any truly stale (empty) branch or orphaned worktree
        try { sh('git', ['worktree', 'remove', wtPath, '--force'], ROOT) } catch {}
        if (branchExists(issue.branch, ROOT)) {
          try { sh('git', ['branch', '-D', issue.branch], ROOT) } catch {}
        }

        sh('git', ['worktree', 'add', wtPath, '-b', issue.branch], ROOT)
        sh('bun', ['install'], wtPath, 'pipe')

        runClaude(
          `Implementer #${issue.number}`,
          loadPrompt('implement-prompt', wtPath, {
            ISSUE_NUMBER: String(issue.number),
            ISSUE_TITLE: issue.title,
            BRANCH: issue.branch,
          }),
          wtPath
        )

        const commits = newCommits(wtPath)

        if (commits.length > 0) {
          runClaude(
            `Reviewer #${issue.number}`,
            loadPrompt('review-prompt', wtPath, {
              ISSUE_NUMBER: String(issue.number),
              ISSUE_TITLE: issue.title,
              BRANCH: issue.branch,
            }),
            wtPath
          )
          try {
            pushWithRetry(issue.branch, wtPath)
          } catch (pushErr: any) {
            console.warn(`  #${issue.number}: push failed (work committed locally): ${pushErr.message?.split('\n')[0]}`)
          }
        }

        return { issue, commits }
      } finally {
        try { sh('git', ['worktree', 'remove', wtPath, '--force'], ROOT) } catch {}
        sem.release()
      }
    })
  )

  for (const [idx, outcome] of settled.entries()) {
    if (outcome.status === 'rejected') {
      console.error(`  ✗ #${issues[idx].number} failed: ${outcome.reason}`)
    }
  }

  const completed = settled
    .filter(
      (o): o is PromiseFulfilledResult<{ issue: (typeof issues)[number]; commits: string[] }> =>
        o.status === 'fulfilled' && o.value.commits.length > 0
    )
    .map((o) => o.value.issue)

  console.log(`\n${completed.length} branch(es) ready to merge.`)

  if (completed.length === 0) {
    console.log('Nothing to merge.')
    continue
  }

  // Phase 3 — Merge
  runClaude(
    'Merger',
    loadPrompt('merge-prompt', ROOT, {
      BRANCHES: completed.map((iss) => `- ${iss.branch}`).join('\n'),
      ISSUES: completed.map((iss) => `- #${iss.number}: ${iss.title}`).join('\n'),
    }),
    ROOT
  )

  console.log('Branches merged.')
}

console.log('\nAll done.')
