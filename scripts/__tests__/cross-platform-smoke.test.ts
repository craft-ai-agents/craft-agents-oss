/**
 * Tests for scripts/cross-platform-smoke.mjs — the reusable cross-OS smoke
 * runner (aj-geddes cross-platform-compatibility Quick Start fixture + the
 * repo's path/env bug classes, composed with the 3-OS CI matrix).
 *
 * The script must:
 *   1. Pass every probe on whatever OS it runs on (ubuntu/windows/macos).
 *   2. Emit a machine-readable --json report for artifact upload.
 *   3. Detect divergence when a probe passes on one OS but fails on another
 *      (--diff) — that is the "surfaces as workflow noise" contract.
 */

import { describe, expect, it } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const SCRIPT = join(import.meta.dir, '..', 'cross-platform-smoke.mjs')

function runScript(args: string[]): { status: number; stdout: string; stderr: string } {
  const res = spawnSync(process.execPath, [SCRIPT, ...args], {
    encoding: 'utf8',
    timeout: 60_000,
  })
  return {
    status: res.status ?? -1,
    stdout: String(res.stdout ?? ''),
    stderr: String(res.stderr ?? ''),
  }
}

describe('scripts/cross-platform-smoke.mjs', () => {
  it('passes every probe on the current OS and writes a --json report', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cpsmoke-'))
    try {
      const json = join(dir, 'report.json')
      const { status, stdout } = runScript(['--json', json])
      expect(status).toBe(0)

      const report = JSON.parse(readFileSync(json, 'utf8')) as {
        platform: string
        probes: Array<{ id: string; pass: boolean; skipped?: boolean }>
      }
      expect(report.platform).toBe(process.platform)
      expect(report.probes.length).toBeGreaterThan(0)

      const failed = report.probes.filter(r => !r.pass)
      expect(failed, `failed probes on ${process.platform}:\n${stdout}`).toEqual([])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('reports divergence when a probe passes on one OS but fails on another', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cpsmoke-'))
    try {
      // Real pass report from this OS.
      const ok = join(dir, 'ok.json')
      const { status } = runScript(['--json', ok])
      expect(status).toBe(0)

      const passReport = JSON.parse(readFileSync(ok, 'utf8')) as {
        platform: string
        probes: Array<{ id: string; pass: boolean; skipped?: boolean }>
      }

      // Fabricate a report where one probe fails (e.g. a Windows-only
      // regression that would never fire on linux) and the rest pass.
      const bad = join(dir, 'bad.json')
      const failId = passReport.probes[0]?.id ?? 'quickstart.path-join-homedir'
      writeFileSync(
        bad,
        JSON.stringify({
          ...passReport,
          platform: 'windows-latest',
          probes: passReport.probes.map(r =>
            r.id === failId ? { ...r, pass: false, detail: 'fabricated failure' } : r,
          ),
        }),
      )

      const { status: diffStatus, stdout } = runScript(['--diff', ok, bad])
      expect(diffStatus).toBe(1)
      expect(stdout).toContain(failId)

      // Two identical reports must NOT diverge.
      const same = join(dir, 'same.json')
      writeFileSync(same, JSON.stringify(passReport))
      const { status: sameStatus } = runScript(['--diff', ok, same])
      expect(sameStatus).toBe(0)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('treats a missing/unparseable report as divergence', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cpsmoke-'))
    try {
      const ok = join(dir, 'ok.json')
      const { status } = runScript(['--json', ok])
      expect(status).toBe(0)

      const missing = join(dir, 'does-not-exist.json')
      const { status: diffStatus } = runScript(['--diff', ok, missing])
      expect(diffStatus).toBe(1)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
