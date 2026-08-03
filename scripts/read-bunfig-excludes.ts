#!/usr/bin/env bun
/**
 * scripts/read-bunfig-excludes.ts
 *
 * Parses the [[config.test.excludePaths]] array-of-tables from bunfig.toml
 * and returns typed ExcludedPath records.  Used by:
 *
 *   - scripts/test-setup.ts          (prints exclusion summary on test startup)
 *   - bun run test:why-excluded <q>  (looks up why a path is hidden)
 *   - scripts/find-build-outputs.ts  (keeps metadata in sync)
 *
 * The [[config.test.excludePaths]] section lives right after the
 * [test].pathIgnorePatterns array.  Each entry mirrors a pattern in that
 * array but carries provenance so humans and bots can explain *why* a
 * path is excluded from test discovery.
 *
 * bunfig.toml example:
 *
 *   [[config.test.excludePaths]]
 *   pattern = "dist"
 *   reason  = "esbuild / vite / bun build --target node"
 *   since   = "2026-07-29"
 *
 * Run directly:
 *   bun scripts/read-bunfig-excludes.ts           # print all exclusions
 *   bun scripts/read-bunfig-excludes.ts <glob>    # match a path
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// ── Types ────────────────────────────────────────────────────────────

export interface ExcludedPath {
  /** picomatch pattern, e.g. "dist" or a glob star pattern. */
  pattern: string
  /** Human-readable reason the path is excluded. */
  reason: string
  /** ISO date string when the exclusion was first added. */
  since: string
}

// ── Parser ───────────────────────────────────────────────────────────

const ROOT = resolve(fileURLToPath(import.meta.url), '../..')
const BUNFIG = resolve(ROOT, 'bunfig.toml')

/**
 * Parse [[config.test.excludePaths]] entries from raw bunfig.toml text.
 *
 * This is a targeted regex parser — we don't use a full TOML library
 * because bunfig.toml has Bun-specific sections that generic parsers
 * may choke on, and we only need one specific array-of-tables block.
 */
export function parseExcludePaths(tomlText: string): ExcludedPath[] {
  const results: ExcludedPath[] = []

  // Split on [[config.test.excludePaths]] headers.  Each block is
  // terminated by the next TOML section header or EOF.
  // Terminates on the next TOML section header or end-of-string.
  // NOTE: no `m` flag — $ must match end-of-string, not end-of-line,
  // so blank lines between TOML blocks don't truncate the match.
  const sectionRe =
    /\[\[config\.test\.excludePaths\]\]\s*\n([\s\S]*?)(?=\n\[\[|\n\[test\]|\n\[install\]|\n\[preload\]|$)/g

  let blockMatch: RegExpExecArray | null
  while ((blockMatch = sectionRe.exec(tomlText)) !== null) {
    const block = blockMatch[1]!
    const pattern = extractField(block, 'pattern')
    const reason = extractField(block, 'reason')
    const since = extractField(block, 'since')
    if (pattern) {
      results.push({
        pattern,
        reason: reason ?? '',
        since: since ?? '',
      })
    }
  }

  return results
}

/** Extract a TOML string field (key = "value") from a text block. */
function extractField(block: string, key: string): string | null {
  const re = new RegExp(`^\\s*${key}\\s*=\\s*['"]([^'"]*)['"]\\s*$`, 'm')
  const m = re.exec(block)
  return m ? m[1]! : null
}

// ── Glob matcher ─────────────────────────────────────────────────────

/**
 * Test whether a file path is excluded by a pattern.
 *
 * Patterns are typically bare directory names like "dist" or
 * glob-star patterns.  For bare names we do a segment-level match:
 * the path is excluded if any segment equals the pattern.
 * For glob-style patterns we convert to a regex.
 */
export function matchesPattern(filePath: string, pattern: string): boolean {
  const normalized = filePath.replace(/\\/g, '/')

  // Glob-star patterns: star-star/X/star-star means any path containing X as a segment
  const globStarRe = /^\*\*\/(.+?)\/\*\*$/
  const globStarMatch = globStarRe.exec(pattern)
  if (globStarMatch) {
    const seg = globStarMatch[1]!
    return normalized.split('/').includes(seg)
  }

  // Bare directory name: match as a path segment
  if (!pattern.includes('/') && !pattern.includes('*')) {
    return normalized.split('/').includes(pattern)
  }

  // Fallback: convert simple globs to regex
  const regexStr = pattern
    .replace(/\*\*/g, '.*')
    .replace(/\*/g, '[^/]*')
    .replace(/\?/g, '[^/]')
  try {
    return new RegExp(`(?:^|/)${regexStr}(?:/|$)`).test(normalized)
  } catch {
    return false
  }
}

// ── CLI ──────────────────────────────────────────────────────────────

if (import.meta.main) {
  const tomlText = readFileSync(BUNFIG, 'utf-8')
  const excludes = parseExcludePaths(tomlText)

  const query = process.argv[2]

  if (query) {
    // Lookup mode: find which exclusion matches the query
    const matches = excludes.filter((e) => matchesPattern(query, e.pattern))
    if (matches.length === 0) {
      console.log(`"${query}" is not excluded by any pattern.`)
      console.log(
        `  Current exclusions: ${excludes.map((e) => e.pattern).join(', ')}`,
      )
      process.exit(0)
    }
    console.log(`"${query}" is excluded by ${matches.length} pattern(s):\n`)
    for (const m of matches) {
      console.log(`  pattern : ${m.pattern}`)
      console.log(`  reason  : ${m.reason}`)
      console.log(`  since   : ${m.since}`)
      console.log('')
    }
  } else {
    // List mode: print all exclusions
    if (excludes.length === 0) {
      console.log('No [[config.test.excludePaths]] entries found in bunfig.toml.')
      process.exit(0)
    }
    console.log(
      `${excludes.length} excluded path(s) in bunfig.toml:\n`,
    )
    for (const e of excludes) {
      const reasonShort =
        e.reason.length > 60 ? e.reason.slice(0, 57) + '...' : e.reason
      console.log(
        `  ${e.pattern.padEnd(20)}  ${reasonShort}${e.since ? `  (${e.since})` : ''}`,
      )
    }
  }
}
